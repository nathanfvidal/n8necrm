import "server-only";

import { prisma } from "@/lib/prisma";

import { TIPO_CONVERSA_AGUARDANDO, type ConversaAguardandoPayload } from "./notificacao-tipos";

/**
 * Rótulo de última instância para uma conversa sem nome nenhum: os quatro
 * últimos dígitos, e só.
 *
 * Risco corrigido (auditoria da fatia): a cadeia de rótulo terminava em
 * `conversa.telefone ?? conversa.waId`, então uma conversa nova — sem contato
 * cadastrado e sem push name, que é o caso comum da PRIMEIRA mensagem de um
 * cliente — copiava o telefone COMPLETO para uma linha de `Notification` por
 * usuário ativo. Numa equipe de dez pessoas, dez cópias do número; e como a
 * tabela não é limpa, cópias permanentes.
 *
 * Quatro dígitos bastam para o que o aviso precisa fazer: distinguir uma
 * conversa da outra no sino. Quem realmente vai atender clica e chega em
 * `/conversas/[id]`, onde o número aparece inteiro — atrás de autenticação,
 * em UMA linha, e não replicado por toda a equipe. Menor privilégio aplicado
 * ao conteúdo da notificação, não só ao acesso.
 *
 * Sem quatro dígitos disponíveis (identificador atípico), não inventa: devolve
 * um rótulo neutro em vez de vazar o que sobrou.
 */
function rotuloMascarado(identificador: string): string {
  const digitos = identificador.replace(/\D/g, "");
  if (digitos.length < 4) return "Cliente sem nome";
  return `Cliente ···${digitos.slice(-4)}`;
}

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

  // Nunca nulo: um aviso sem rótulo nenhum não ajuda ninguém a decidir se
  // atende. Mas quando não há nome, o que entra é o número MASCARADO — ver
  // `rotuloMascarado` abaixo.
  const nomeExibicao =
    conversa.contact?.nome ??
    conversa.nomeExibicao ??
    rotuloMascarado(conversa.telefone ?? conversa.waId);

  const payload: ConversaAguardandoPayload = { conversationId, nomeExibicao };

  // Todos os ativos. O usuário de sistema do WhatsApp é `ativo: false` no seed,
  // então o filtro já o exclui — sem lista de exceções para alguém manter.
  const ativos = await prisma.user.findMany({ where: { ativo: true }, select: { id: true } });
  if (ativos.length === 0) return true;

  // `Notification.companyId` é `NOT NULL` desde a Task 1 do Ciclo 1a. `conversa`
  // já está em mãos (buscada acima, sem `select`, então `companyId` já veio
  // junto) — origem preferida das três, sem consulta extra.
  await prisma.notification.createMany({
    data: ativos.map((usuario) => ({
      companyId: conversa.companyId,
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
