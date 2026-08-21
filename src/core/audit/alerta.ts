import "server-only";

import { prismaDaEmpresa } from "@/core/tenancy/escopo";
import { checarRateLimit } from "@/core/rate-limit/limiter";
import { idsDeSistema } from "@/core/users/sistema";
import { enviarEmailMelhorEsforco } from "@/core/notifications/email-envio";
import { AlertaAtividadeEmail } from "@/core/notifications/email";
import {
  TIPO_ALERTA_ATIVIDADE,
  type AlertaAtividadePayload,
} from "@/core/notifications/types";

// Reexportado para que quem lida com a detecção não precise saber que o
// formato mora no módulo de notificações (ele mora lá porque o sino, sendo
// Client Component, não pode importar deste arquivo — `server-only`).
export { TIPO_ALERTA_ATIVIDADE };
export type { AlertaAtividadePayload };

/**
 * Detecção de atividade destrutiva em rajada.
 *
 * ## Por que isto existe
 *
 * A decisão do dono do projeto na auditoria foi: exclusão precisa deixar log
 * "por se alguém quiser sabotar a empresa". O log passou a existir — mas log
 * que ninguém lê não impede nada, apenas permite reconstituir o estrago
 * depois que ele terminou. Isto é a outra metade do controle: alguém FICA
 * SABENDO enquanto ainda está acontecendo.
 *
 * É também o controle correto para essa ameaça, e um teto de escrita não
 * seria. Quem chama uma Server Action já está autenticado; sabotagem por
 * dentro é LENTA e cabe folgada em qualquer limite de taxa que não atrapalhe
 * trabalho legítimo. Detecção não tem esse dilema.
 *
 * ## A assimetria que permite um gatilho apertado
 *
 * Alertar não bloqueia nada. Um falso positivo custa uma notificação no sino
 * de um ADMIN — e, desde o reparo do achado 40, um e-mail para ele; um falso
 * negativo custa a empresa não descobrir a tempo. É o inverso de um limite de
 * taxa, onde errar para o lado apertado barra quem está trabalhando. Por isso
 * o gatilho aqui pode ser — e é — bem mais sensível do que qualquer teto de
 * escrita poderia ser.
 *
 * A assimetria ficou MENOS folgada com o e-mail: falso positivo agora chega na
 * caixa de entrada, que é o canal que as pessoas aprendem a filtrar. O que
 * segura isso não é o limiar ser alto — é o silêncio de 30 minutos
 * (`SILENCIO_ENTRE_ALERTAS_MS`), que limita o pior caso a dois e-mails por
 * hora por conta suspeita, por mais longa que seja a rajada.
 */

/**
 * As ações que contam. Critério: destroem conteúdo, tiram alguém do sistema,
 * ou extraem dado em massa. Ficam de FORA as ações de trabalho normal
 * (`criar_lead`, `mover_etapa`, `atualizar_lead`, `editar_nota`,
 * `criar_contato`, ...) — mover 40 leads pelo funil numa segunda-feira é uso
 * legítimo e intenso, e um alerta ali seria ruído que treina o ADMIN a
 * ignorar o sino, que é o pior resultado possível para um detector.
 *
 * `desarquivar_lead` não entra: desfazer é reparo, não estrago.
 *
 * `excluir_etapa` entra: destrói estrutura do funil e reescreve `stageId` de
 * leads em massa. As outras operações de funil (`criar_etapa`, `editar_etapa`,
 * `reordenar_etapa`) ficam de fora, junto com o trabalho normal.
 *
 * `desativar_fluxo` e `apagar_fluxo` entram: cada um derruba o atendimento de
 * um cliente inteiro, e a instância n8n é compartilhada por vários. Uma
 * rajada aqui é o cenário exato que a detecção existe para pegar.
 *
 * `ativar_fluxo` fica de fora: religar é reparo, não estrago.
 *
 * `reexecutar_execucao` ENTRA — correção da revisão final do Ciclo 4. Até ali
 * este comentário dizia "reexecutar um caso real é diagnóstico — nenhum dos
 * dois destrói nada", e estava errado: reexecutar roda o fluxo INTEIRO de
 * novo, nós de envio inclusos, contra a instância de produção de um cliente
 * — se o fluxo manda mensagem por WhatsApp, o cliente final pode recebê-la de
 * novo. Não é sem custo só porque é reversível "rodando de novo"; uma rajada
 * de reexecuções reais é exatamente o padrão que este detector existe para
 * pegar, e `execucoes-table.tsx` já exige confirmação por causa disso.
 *
 * As quatro de CONEXÃO (Ciclo 2a) entram pelo mesmo critério das de fluxo, e
 * cada uma por um motivo próprio:
 *
 * - `apagar_conexao` e `desativar_conexao` derrubam o atendimento de WhatsApp
 *   da empresa inteira — é o par de `apagar_fluxo`/`desativar_fluxo`.
 * - `regenerar_webhook_conexao` corta a ENTRADA de mensagens até alguém
 *   recolar a URL no painel da Evolution. O efeito é o de desativar, com o
 *   agravante de a tela continuar dizendo "Ativa" — o que torna a detecção
 *   mais valiosa aqui, não menos.
 * - `substituir_segredo_conexao` é tomada de canal: quem troca a apikey passa
 *   a responder os clientes daquela empresa pela instância que ele controlar.
 *   Mesma família de `redefinir_senha`, e por isso está ao lado dela.
 *
 * `criar_conexao` e `editar_conexao` ficam de fora, junto com o trabalho
 * normal. `ativar_conexao` fica de fora pelo mesmo motivo de `ativar_fluxo`:
 * religar é reparo, não estrago.
 */
export const ACOES_SENSIVEIS = [
  "excluir_task",
  "excluir_nota",
  "arquivar_lead",
  "desativar_usuario",
  "redefinir_senha",
  "excluir_etapa",
  "exportar_leads",
  "desativar_fluxo",
  "apagar_fluxo",
  "reexecutar_execucao",
  "substituir_segredo_conexao",
  "desativar_conexao",
  "apagar_conexao",
  "regenerar_webhook_conexao",
] as const;

/**
 * Quantas ações sensíveis da MESMA conta, na mesma janela, disparam o alerta.
 *
 * O número sai do ritmo humano, e desta vez ele tem onde se apoiar: apagar
 * coisa é ato deliberado — a pessoa lê o que vai destruir, confirma o
 * diálogo, segue. Uma faxina honesta faz alguns por minuto e para. 10 em 5
 * minutos é destruição sustentada, não faxina.
 *
 * Se errar, erra barato: ninguém é bloqueado, um ADMIN recebe um aviso a
 * mais. Baixar este número é seguro; subir é que custa.
 */
export const LIMITE_ALERTA = 10;

export const JANELA_ALERTA_MS = 5 * 60_000;

/**
 * Silêncio depois de um alerta, por conta. Sem isto, a 11ª, 12ª e 13ª ação
 * gerariam um alerta cada uma, e o sino do ADMIN viraria ruído exatamente
 * durante o incidente que ele deveria tornar visível.
 *
 * Reaproveita o limiter (janela fixa, atômico) com limite 1: a primeira
 * avaliação da janela passa, as seguintes não.
 */
export const SILENCIO_ENTRE_ALERTAS_MS = 30 * 60_000;

function ehAcaoSensivel(acao: string): boolean {
  return (ACOES_SENSIVEIS as readonly string[]).includes(acao);
}

/**
 * Avalia se a ação recém-auditada fecha uma rajada destrutiva e, se fechar,
 * notifica os ADMINs ativos — exceto o próprio autor.
 *
 * Chamada por `registrarAuditoria` (`./log.ts`) para TODA ação auditada, e
 * sai barata e cedo para as que não interessam: a consulta ao banco só
 * acontece depois de `ehAcaoSensivel`, então o trabalho normal do CRM não
 * paga nada por este controle existir.
 *
 * `companyId` chega de `ParamsDeAuditoria` — é a empresa da ENTIDADE que
 * acabou de ser mexida, a mesma que a linha de auditoria recebeu. Antes do
 * Ciclo 1d ele era deduzido aqui dentro por `companyIdDoUsuario(input.userId)`,
 * e a contagem logo abaixo nem o usava.
 */
export async function avaliarAtividadeSuspeita(input: {
  companyId: string;
  userId: string;
  acao: string;
}): Promise<void> {
  if (!ehAcaoSensivel(input.acao)) return;

  // Conta de sistema (o atendente de WhatsApp) age em nome do robô, em
  // volume, por desenho — ver `core/users/sistema.ts`. Alertar sobre ela
  // seria alarme garantido e falso.
  if (idsDeSistema().includes(input.userId)) return;

  const db = prismaDaEmpresa(input.companyId);

  // Conjunto contado JUNTO, não por tipo: quem apaga 4 notas, arquiva 4 leads
  // e apaga 3 tarefas passaria por baixo de qualquer limite por tipo, estando
  // claramente destruindo coisa. É a mesma armadilha de "regra numa tela,
  // esquecida na outra", só que em forma de contador.
  //
  // Contado DENTRO da empresa desde o Ciclo 1d — o escopo põe o `companyId` no
  // `where` sozinho. A versão anterior contava só por `userId`, e para quem tem
  // vínculo em duas empresas as ações das duas somavam num contador único: cinco
  // exclusões na A mais cinco na B fechavam a rajada e alertavam o ADMIN de uma
  // delas sobre uma faxina que, naquela empresa, nunca aconteceu. O caso que
  // trava isso é "metade em cada empresa NÃO fecha rajada em nenhuma das duas"
  // (`tests/unit/audit-isolamento.test.ts`), com a sonda da contagem ANTIGA ao
  // lado provando que ela somava mesmo.
  const total = await db.auditLog.count({
    where: {
      userId: input.userId,
      acao: { in: [...ACOES_SENSIVEIS] },
      criadoEm: { gte: new Date(Date.now() - JANELA_ALERTA_MS) },
    },
  });
  if (total < LIMITE_ALERTA) return;

  const primeiroDaJanela = await checarRateLimit(
    `alerta:atividade:${input.userId}`,
    1,
    SILENCIO_ENTRE_ALERTAS_MS
  );
  if (!primeiroDaJanela) return;

  // Destinatários: ADMIN ativo DA MESMA EMPRESA do suspeito, menos o autor e
  // menos as contas de sistema.
  //
  // Correção de reparo (2026-08-19): a versão anterior buscava ADMIN em
  // `prisma.user` direto, sem `companyId` nenhum — ADMIN de QUALQUER empresa
  // era destinatário de QUALQUER rajada. Com uma empresa só no banco isso não
  // se via; no dia em que existir uma segunda, um alerta sobre a empresa A
  // chegaria ao ADMIN da empresa B, que não tem nada a ver com aquilo, não
  // pode agir sobre aquilo, e passaria a receber sinal de segurança de um
  // cliente que não é dele. Alerta de segurança de um cliente não pode
  // vazar para outro — a consulta agora parte de `Membership`, o vínculo que
  // define "ADMIN desta empresa" (mesmo padrão de `listarUsuarios`,
  // `core/users/queries.ts`), não de `User.papel`. Aquela coluna era espelho
  // depreciado e saiu do banco no Ciclo 1f
  // (`20260821130000_derruba_user_papel_de_vez`); o comentário de campo que
  // esta linha citava saiu junto, e o que restou está no bloco acima de
  // `model User`, em `prisma/schema.prisma`.
  //
  // Excluir o autor não é cortesia — avisar o suspeito não protege nada e só
  // entrega que ele foi percebido. Se o autor for o ÚNICO ADMIN ativo desta
  // empresa, a lista fica vazia e nenhum alerta é enviado: é o limite honesto
  // deste controle, e o `AuditLog` continua guardando tudo para depois.
  //
  // `select` traz o `email` junto desde o reparo do achado 40 (o alerta passou
  // a sair também por e-mail, logo abaixo). É `user: { select: { email: true } }`
  // e NUNCA `user: true`: a linha inteira de `User` traria `senhaHash`, que é
  // o padrão que `tests/unit/consultas-estreitas.test.ts` reprova — e reprovaria
  // esta linha, por nome de campo, se ela fosse escrita assim.
  const destinatarios = await db.membership.findMany({
    where: {
      papel: "ADMIN",
      userId: { notIn: [...idsDeSistema(), input.userId] },
      user: { ativo: true },
    },
    select: { userId: true, user: { select: { email: true } } },
  });
  if (destinatarios.length === 0) return;

  // `User` NÃO é modelo de tenant (`core/tenancy/escopo.ts`, os 11), então esta
  // operação atravessa o escopo INTACTA — inclusive o `findUnique`, que o escopo
  // recusaria num modelo de tenant. É o comportamento correto e é medido lá:
  // injetar `where.companyId` em `User` produziria erro de coluna inexistente,
  // não proteção. Quem delimita a empresa aqui é o `Membership` acima.
  const autor = await db.user.findUnique({
    where: { id: input.userId },
    select: { nome: true },
  });

  // Só o NOME vai no payload. `Notification.payload` é copiado para uma linha
  // por destinatário e fica legível no sino de cada um — e-mail ou qualquer
  // outro dado da pessoa ali seria espalhar identificação sem necessidade,
  // exatamente o padrão que a auditoria da outra branch marcou como risco
  // (telefone de cliente copiado para a notificação de todo usuário ativo).
  const payload: AlertaAtividadePayload = {
    autorNome: autor?.nome ?? "Conta removida",
    total,
    janelaMinutos: Math.round(JANELA_ALERTA_MS / 60_000),
  };

  await db.notification.createMany({
    data: destinatarios.map((destinatario) => ({
      companyId: input.companyId,
      userId: destinatario.userId,
      tipo: TIPO_ALERTA_ATIVIDADE,
      payload,
    })),
  });

  // ## O e-mail, e por que ele passou a existir (achado 40 da auditoria)
  //
  // Até 2026-08-21 a função terminava na linha acima. A auditoria mediu a
  // consequência: **lead novo rendia e-mail (`core/notifications/dispatch.ts`)
  // e rajada destrutiva rendia só um badge no sino** — o canal mais fraco para
  // o evento mais grave. Sino só é visto por quem está logado e olha; uma
  // sabotagem às 3h da manhã, ou num fim de semana, ficava esperando alguém
  // abrir o CRM.
  //
  // ORDEM: in-app PRIMEIRO, e-mail depois. Mesma regra de `dispatch.ts` e pelo
  // mesmo motivo — o canal que não depende de terceiro é o que não pode
  // faltar. Se o Resend estiver fora do ar, o alerta já está gravado.
  //
  // O SILÊNCIO DE 30 MINUTOS VALE PARA OS DOIS, e isto é o ponto mais
  // importante deste bloco: o `return` de `primeiroDaJanela`, lá em cima, é o
  // que impede que a 11ª, a 12ª e a 13ª ação da rajada rendam um e-mail cada.
  // E-mail repetido é pior que e-mail nenhum — ensina o ADMIN a criar regra de
  // caixa de entrada para o alerta, e aí o controle morre em silêncio. Por
  // isso o envio mora DEPOIS da trava, e não em qualquer ponto acima dela.
  // Caso que trava: "nao repete o alerta a cada acao seguinte dentro da janela
  // de silencio" (`tests/unit/alerta-atividade.test.ts`) e o par mockado em
  // `tests/unit/alerta-email.test.ts`.
  //
  // UM ENVIO POR DESTINATÁRIO, e não um `to: [a, b, c]`: um envio só exporia a
  // caixa de cada ADMIN para os outros, e uma recusa do provedor a UM endereço
  // derrubaria a mensagem dos demais. Sequencial, e não `Promise.all`, porque
  // são poucos endereços (ADMINs de uma empresa) e um disparo simultâneo
  // contra o limite de taxa do Resend faria justamente o alerta de incidente
  // ser o que estoura a cota.
  //
  // FALHA AQUI NÃO DERRUBA NADA: `enviarEmailMelhorEsforco` registra e engole
  // (ver o docstring dele), e `registrarAuditoria` (`./log.ts`) ainda envolve a
  // chamada inteira num `try/catch`. Sem `RESEND_API_KEY` — o caso real deste
  // projeto hoje — ele devolve `false` sem tentar rede nenhuma, e o
  // comportamento observável volta a ser exatamente o de antes deste bloco.
  for (const destinatario of destinatarios) {
    await enviarEmailMelhorEsforco({
      para: destinatario.user.email,
      assunto: "Alerta: atividade destrutiva em rajada",
      react: AlertaAtividadeEmail(payload),
      contexto: `alerta de atividade suspeita, empresa ${input.companyId}`,
    });
  }
}
