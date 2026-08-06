import "server-only";

import { prisma } from "@/lib/prisma";

import { TIPO_CONVERSA_AGUARDANDO, type ConversaAguardandoPayload } from "./notificacao-tipos";

/**
 * Marca a conversa como aguardando atendimento humano e, **só quando esta
 * chamada foi quem fez a transição**, notifica toda a equipe.
 *
 * ## Por que um UPDATE condicional e não "consulta, decide, grava"
 *
 * Turnos concorrentes na mesma conversa são normais neste sistema — o lease em
 * `turno.ts` existe justamente porque acontecem. Um check-then-act teria janela
 * entre a leitura e a escrita, e o resultado visível seria a equipe recebendo
 * dois avisos da mesma conversa. Aqui o banco decide: `WHERE
 * "aguardandoHumanoDesde" IS NULL` faz a transição acontecer no máximo uma vez,
 * e `count` diz quem ganhou. Mesmo idioma de `claimLease`, `pausarIa` e
 * `checarRateLimit`.
 *
 * O UPDATE também **não reescreve** o instante quando já havia um: quem espera
 * há mais tempo continua no topo da lista.
 *
 * Devolve `true` quando esta chamada ganhou a transição (e portanto notificou),
 * `false` quando outra já havia marcado.
 */
export async function marcarAguardandoHumano(conversationId: string): Promise<boolean> {
  const { count } = await prisma.conversation.updateMany({
    where: { id: conversationId, aguardandoHumanoDesde: null },
    data: { aguardandoHumanoDesde: new Date() },
  });

  if (count === 0) return false;

  const conversa = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { contact: { select: { nome: true } } },
  });

  // Cadeia igual à da tela de detalhe. Nunca nulo: um aviso dizendo
  // "conversa sem nome" não ajuda ninguém a decidir se atende.
  const nomeExibicao =
    conversa.contact?.nome ?? conversa.nomeExibicao ?? conversa.telefone ?? conversa.waId;

  const payload: ConversaAguardandoPayload = { conversationId, nomeExibicao };

  // Todos os ativos. O usuário de sistema do WhatsApp é `ativo: false` no seed,
  // então o filtro já o exclui — sem lista de exceções para alguém manter.
  const ativos = await prisma.user.findMany({ where: { ativo: true }, select: { id: true } });
  if (ativos.length === 0) return true;

  await prisma.notification.createMany({
    data: ativos.map((usuario) => ({
      userId: usuario.id,
      tipo: TIPO_CONVERSA_AGUARDANDO,
      payload,
    })),
  });

  return true;
}

/**
 * Limpa o estado de espera — alguém falou com o cliente.
 *
 * Incondicional de propósito: não há corrida a resolver, porque limpar duas
 * vezes tem o mesmo efeito de limpar uma. `updateMany` em vez de `update` para
 * não lançar se a conversa tiver sido apagada nesse meio tempo.
 */
export async function limparAguardandoHumano(conversationId: string): Promise<void> {
  await prisma.conversation.updateMany({
    where: { id: conversationId },
    data: { aguardandoHumanoDesde: null },
  });
}
