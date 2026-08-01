// `import "server-only"` — mesmo padrão de `src/lib/prisma.ts`,
// `src/core/leads/notes.ts` e `src/core/tasks/service.ts`: este módulo
// importa Prisma diretamente (e, agora, também o SDK do Resend, que espera
// rodar em servidor). Sem esta linha, o único motivo pelo qual um Client
// Component não conseguiria importar isto seria coincidência do bundler, não
// uma garantia.
import "server-only";

import { Resend } from "resend";

import { prisma } from "@/lib/prisma";
import { NovoLeadEmail } from "./email";
import type { NovoLeadPayload } from "./types";
import type { Notification } from "@prisma/client";

// `resend` é `null` quando `RESEND_API_KEY` não está definida — o caso real
// deste projeto hoje: a Task 19 é explícita que a chave fica de fora do
// `.env` (não há conta Resend real disponível), então o caminho de e-mail
// nunca é exercitado de verdade, nem em dev nem nos testes. `null` em vez de
// instanciar `Resend("")` é deliberado: o SDK não valida a chave na
// construção, então um `new Resend("")` "funcionaria" até a primeira
// chamada de rede falhar com um erro de autenticação genérico — pior sinal
// para debugar do que simplesmente nunca tentar enviar.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

/**
 * Notifica o responsável por um lead recém-criado: grava uma notificação
 * in-app (sempre) e, quando o Resend está configurado, tenta também enviar
 * um e-mail (melhor esforço).
 *
 * Chamada por `criarLead` (`leads/service.ts`) depois que o lead e a
 * auditoria já estão persistidos — ver o comentário lá sobre por que a
 * chamada inteira é envolvida num `try/catch` que nunca deixa uma falha
 * de notificação derrubar a criação do lead (spec seção 6: "falha de
 * módulo secundário nunca derruba o principal").
 *
 * Dentro desta função, a notificação in-app e o e-mail têm tratamento de
 * erro DIFERENTE, de propósito:
 * - A gravação da notificação in-app (`prisma.notification.create`) NÃO é
 *   envolvida em try/catch aqui — se o banco estiver fora do ar, é um erro
 *   real que deve propagar (o `try/catch` de `criarLead` do lado de fora é
 *   quem decide não deixar isso quebrar a criação do lead; aqui dentro não
 *   faz sentido fingir sucesso).
 * - O envio de e-mail É envolvido em try/catch, e SEMPRE roda depois da
 *   notificação in-app já estar gravada: um Resend fora do ar (ou, no caso
 *   comum deste projeto, `resend === null` porque a chave não existe) nunca
 *   deveria impedir a pessoa de ver a notificação dentro do próprio CRM.
 *   `console.error` é o único registro de uma falha de e-mail — sem retry,
 *   sem fila (a spec descreve entrega com retry via QStash como alvo
 *   futuro; esta fase implementa só o "melhor esforço" mais simples).
 */
export async function notificarNovoLead(leadId: string): Promise<void> {
  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: { contact: true, stage: true, responsavel: true },
  });

  // Lead sem responsável atribuído: nada a notificar (ninguém para
  // notificar) e nenhum e-mail a enviar. `criarLead` (service.ts) sempre
  // exige `responsavelId`, então este ramo não é alcançado pelo fluxo
  // principal hoje — mas `Lead.responsavelId` é opcional no schema, e
  // outros caminhos de escrita (um script administrativo futuro, uma
  // importação em massa) podem criar leads sem responsável.
  if (!lead.responsavel) return;

  const payload: NovoLeadPayload = {
    leadId: lead.id,
    contatoNome: lead.contact?.nome ?? "Sem contato",
  };

  await prisma.notification.create({
    data: {
      userId: lead.responsavel.id,
      tipo: "NOVO_LEAD",
      payload,
    },
  });

  if (!resend) return;

  try {
    await resend.emails.send({
      from: "CRM <notificacoes@exemplo.com>",
      to: lead.responsavel.email,
      subject: "Novo lead recebido",
      react: NovoLeadEmail({
        contatoNome: payload.contatoNome,
        etapaNome: lead.stage.nome,
      }),
    });
  } catch (erro) {
    console.error("Falha ao enviar e-mail de notificação de novo lead:", erro);
  }
}

/**
 * Lista as notificações não lidas de um usuário, mais recente primeiro.
 * Sempre escopada por `userId` — quem chama (o sino, `notification-bell.tsx`,
 * via layout do painel) sempre passa o id do usuário da sessão atual, nunca
 * um id arbitrário vindo do cliente.
 */
export async function listarNotificacoesNaoLidas(userId: string): Promise<Notification[]> {
  return prisma.notification.findMany({
    where: { userId, lidaEm: null },
    orderBy: { criadoEm: "desc" },
  });
}

/**
 * Marca uma notificação como lida.
 *
 * Confere que `userId` é o dono da notificação (`notification.userId`) ANTES
 * de marcar — mesmo padrão de `concluirTask` (`tasks/service.ts`, Task 18):
 * `marcarComoLida` é chamada a partir de uma Server Action pública
 * (`marcarNotificacaoComoLidaAction`, `actions.ts`) com um id que veio do
 * cliente. Sem esta checagem, qualquer usuário autenticado marcaria como
 * lida a notificação de qualquer colega só adivinhando um id vizinho
 * (`cuid()` não impede a tentativa) — o mesmo buraco que a checagem de dono
 * de tarefa fechou na Task 18.
 *
 * A mensagem de erro é a MESMA ("Notificação não encontrada") tanto para
 * "id não existe" quanto para "existe mas não é minha" — de propósito, mesmo
 * raciocínio de `concluirTask`: não diferenciar os dois casos evita
 * confirmar, a quem está adivinhando ids, que aquele id específico existe.
 *
 * Assinatura deliberadamente DIFERENTE do brief original da Task 19
 * (`marcarComoLida(notificationId: string)`, sem `userId`): o brief está
 * desatualizado neste ponto — sem o id de quem está chamando, esta função
 * não tem como aplicar a checagem de dono acima, e viraria a mesma classe de
 * falha que a Task 13/18 já fechou para lead/tarefa.
 */
export async function marcarComoLida(input: { notificationId: string; userId: string }): Promise<void> {
  const notificacao = await prisma.notification.findUnique({ where: { id: input.notificationId } });
  if (!notificacao || notificacao.userId !== input.userId) {
    throw new Error("Notificação não encontrada");
  }

  await prisma.notification.update({
    where: { id: input.notificationId },
    data: { lidaEm: new Date() },
  });
}
