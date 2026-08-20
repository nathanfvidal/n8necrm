import "server-only";

import { prismaDaEmpresa } from "@/core/tenancy/escopo";

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
 * chamada foi quem fez a transição**, notifica a equipe DA EMPRESA DA
 * CONVERSA — ver o comentário dos destinatários no corpo.
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
export async function marcarAguardandoHumano(
  companyId: string,
  conversationId: string
): Promise<boolean> {
  const db = prismaDaEmpresa(companyId);

  // O `where` ganhou `companyId` sem ninguém escrevê-lo: o escopo o injeta.
  // Antes este `updateMany` alcançava a conversa por id sozinho — e id de
  // conversa nasce dentro do servidor (`ingest.ts` → fila), o que segurava o
  // caso comum e não é garantia: bastava um caminho futuro aceitar o id de
  // fora para a empresa A marcar a conversa da B como "aguardando humano" e
  // disparar o fan-out de avisos lá dentro.
  const { count } = await db.conversation.updateMany({
    where: { id: conversationId, aguardandoHumanoDesde: null },
    data: { aguardandoHumanoDesde: new Date() },
  });

  if (count === 0) return false;

  // `findFirstOrThrow` e não `findUniqueOrThrow`: a segunda é recusada pelo
  // escopo em modelo de tenant (ver "Recusa, lançando" em
  // `core/tenancy/escopo.ts`).
  const conversa = await db.conversation.findFirstOrThrow({
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

  // Destinatários: usuário ativo COM VÍNCULO (`Membership`) na empresa DESTA
  // conversa. `conversa.companyId` já está em mãos (a busca acima não usa
  // `select`), então o escopo não custa consulta extra.
  //
  // Correção de reparo (2026-08-20): a versão anterior era
  // `prisma.user.findMany({ where: { ativo: true } })` — "todos os ativos",
  // sem empresa nenhuma — e cada linha saía carimbada com o `companyId` da
  // conversa. Não é hipótese: o banco de desenvolvimento tinha 11
  // `Notification` com `companyId: "company-migracao-1a"` e `userId` de
  // usuários de 8 empresas de teste, cada uma carregando o rótulo do cliente
  // no `payload`. Rótulo de cliente de uma empresa entregue no sino de gente
  // de outra — mesma família do vazamento já corrigido em
  // `core/audit/alerta.ts`, e resolvido do mesmo jeito: a consulta parte de
  // `Membership`, que é o que define "pessoa desta empresa", e não de `User`,
  // que não sabe de empresa alguma.
  //
  // O que o comentário antigo protegia continua valendo: o usuário de sistema
  // do WhatsApp TEM `Membership` (o seed o vincula como ADMIN da empresa —
  // ver `semearUsuarioSistemaWhatsapp` em `prisma/seed.ts`), então quem o
  // exclui é, como antes, o `ativo: false` — aqui em `user: { ativo: true }`.
  // Sem lista de exceções para alguém manter.
  const destinatarios = await db.membership.findMany({
    where: { user: { ativo: true } },
    select: { userId: true },
  });
  if (destinatarios.length === 0) return true;

  // `Notification.companyId` é `NOT NULL` desde a Task 1 do Ciclo 1a. Continua
  // escrito, e não omitido para o escopo injetar, porque aqui o escopo age como
  // VERIFICADOR: `conversa.companyId` e o `companyId` do cliente têm de ser o
  // mesmo valor, e divergência entre eles RECUSA, lançando. Omitir trocaria essa
  // conferência por uma injeção silenciosa.
  await db.notification.createMany({
    data: destinatarios.map((destinatario) => ({
      companyId: conversa.companyId,
      userId: destinatario.userId,
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
export async function limparAguardandoHumano(
  companyId: string,
  conversationId: string
): Promise<void> {
  await prismaDaEmpresa(companyId).conversation.updateMany({
    where: { id: conversationId },
    data: { aguardandoHumanoDesde: null },
  });
}
