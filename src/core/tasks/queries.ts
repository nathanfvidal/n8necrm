// `import "server-only"` — mesma decisão de `service.ts` (ver comentário
// lá): este módulo importa Prisma diretamente, e nada aqui precisa (nem
// deveria) ser alcançável de um Client Component.
import "server-only";

import { prisma } from "@/lib/prisma";
import type { Task, Lead, Contact } from "@prisma/client";

export type TaskComLead = Task & { lead: (Lead & { contact: Contact | null }) | null };

/**
 * Lê as tarefas PENDENTES de um responsável, com o lead vinculado (e o
 * contato do lead) incluído — o formato que `/tasks` (`page.tsx`) consome
 * direto para renderizar "Vence em ... · Nome do Contato" em cada linha.
 *
 * Sempre escopada por `responsavelId`, sem exceção: diferente de
 * `listarLeads` (`leads/queries.ts`, sem escopo — decisão de negócio:
 * pipeline compartilhado numa equipe colaborativa), tarefa é lembrete
 * pessoal (ver a checagem de dono em `concluirTask`, `service.ts`) — não
 * faz sentido a tela principal de tarefas de uma pessoa mostrar o lembrete
 * de outra, que ela nem consegue concluir.
 */
export async function listarTasksComLead(responsavelId: string): Promise<TaskComLead[]> {
  return prisma.task.findMany({
    where: { responsavelId, concluidaEm: null },
    include: { lead: { include: { contact: true } } },
    orderBy: { vencimento: "asc" },
  });
}

/**
 * Lê as tarefas PENDENTES de um responsável vinculadas a um lead
 * específico — usada pela seção "Tarefas" da página de detalhe do lead
 * (`/leads/[id]`, Task 18 — a Task 17 deixou essa seção de fora de
 * propósito, ver histórico de `leads/[id]/page.tsx`).
 *
 * Mesmo escopo por responsável de `listarTasksComLead`, e pelo mesmo
 * motivo: uma tarefa é lembrete pessoal de quem a criou, não informação
 * compartilhada do lead como as notas (Task 17, sem escopo por autor).
 * Mostrar aqui o lembrete de um colega — que a pessoa vendo a página nem
 * consegue concluir (`concluirTask` verifica dono) — seria mais confuso do
 * que útil: uma lista de "tarefas" onde metade dos botões "Concluir" falha
 * silenciosamente por não pertencer a quem clicou.
 */
export async function listarTasksPendentesDoLead(input: {
  leadId: string;
  responsavelId: string;
}): Promise<Task[]> {
  return prisma.task.findMany({
    where: { leadId: input.leadId, responsavelId: input.responsavelId, concluidaEm: null },
    orderBy: { vencimento: "asc" },
  });
}
