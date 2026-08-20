import "server-only";

import { prisma } from "@/lib/prisma";
import { checarRateLimit } from "@/core/rate-limit/limiter";
import { idsDeSistema } from "@/core/users/sistema";
import { companyIdDoUsuario } from "@/core/users/empresa";
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
 * de um ADMIN; um falso negativo custa a empresa não descobrir a tempo. É o
 * inverso de um limite de taxa, onde errar para o lado apertado barra quem
 * está trabalhando. Por isso o gatilho aqui pode ser — e é — bem mais
 * sensível do que qualquer teto de escrita poderia ser.
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
 */
export async function avaliarAtividadeSuspeita(input: {
  userId: string;
  acao: string;
}): Promise<void> {
  if (!ehAcaoSensivel(input.acao)) return;

  // Conta de sistema (o atendente de WhatsApp) age em nome do robô, em
  // volume, por desenho — ver `core/users/sistema.ts`. Alertar sobre ela
  // seria alarme garantido e falso.
  if (idsDeSistema().includes(input.userId)) return;

  // Conjunto contado JUNTO, não por tipo: quem apaga 4 notas, arquiva 4 leads
  // e apaga 3 tarefas passaria por baixo de qualquer limite por tipo, estando
  // claramente destruindo coisa. É a mesma armadilha de "regra numa tela,
  // esquecida na outra", só que em forma de contador.
  const total = await prisma.auditLog.count({
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

  // `Notification.companyId` é `NOT NULL` desde a Task 1 do Ciclo 1a. O
  // alerta é sobre uma rajada de AÇÕES DE `input.userId` — a empresa dele é a
  // origem certa (mesma lógica de `gravarLinhaDeAuditoria`, `core/audit/log.ts`,
  // que resolve `AuditLog.companyId` da mesma forma para o mesmo autor).
  //
  // Resolvida ANTES da busca de destinatários porque agora ela também serve
  // para ESCOPAR quem recebe — ver comentário abaixo.
  const companyId = await companyIdDoUsuario(input.userId);

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
  // `core/users/queries.ts`), não de `User.papel`, que é espelho depreciado
  // (ver comentário do campo em `prisma/schema.prisma`).
  //
  // Excluir o autor não é cortesia — avisar o suspeito não protege nada e só
  // entrega que ele foi percebido. Se o autor for o ÚNICO ADMIN ativo desta
  // empresa, a lista fica vazia e nenhum alerta é enviado: é o limite honesto
  // deste controle, e o `AuditLog` continua guardando tudo para depois.
  const destinatarios = await prisma.membership.findMany({
    where: {
      companyId,
      papel: "ADMIN",
      userId: { notIn: [...idsDeSistema(), input.userId] },
      user: { ativo: true },
    },
    select: { userId: true },
  });
  if (destinatarios.length === 0) return;

  const autor = await prisma.user.findUnique({
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

  await prisma.notification.createMany({
    data: destinatarios.map((destinatario) => ({
      companyId,
      userId: destinatario.userId,
      tipo: TIPO_ALERTA_ATIVIDADE,
      payload,
    })),
  });
}
