// `import "server-only"` — mesma decisão de `service.ts` (ver comentário
// lá): este módulo importa Prisma diretamente, e nada aqui precisa (nem
// deveria) ser alcançável de um Client Component.
import "server-only";

import { prisma } from "@/lib/prisma";
import type { Task, Lead, Contact, User } from "@prisma/client";

export type TaskComLead = Task & { lead: (Lead & { contact: Contact | null }) | null };

// `responsavel` narrowed para só `id`/`nome` — mesmo padrão de
// `leads/queries.ts` (`ResponsavelResumido`) e `leads/[id]/page.tsx`:
// nenhum consumidor destas duas queries precisa de `senhaHash`, então ele
// nunca sai do banco.
type ResponsavelResumido = Pick<User, "id" | "nome">;

export type TaskDoLead = Task & { responsavel: ResponsavelResumido };

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
 * Lê TODAS as tarefas PENDENTES vinculadas a um lead específico — usada
 * pela seção "Tarefas" da página de detalhe do lead (`/leads/[id]`, Task
 * 18 — a Task 17 deixou essa seção de fora de propósito, ver histórico de
 * `leads/[id]/page.tsx`).
 *
 * SEM escopo por responsável — fix round 1/5, achado do revisor,
 * revertendo a decisão original desta função (que filtrava por
 * `responsavelId`, mesmo escopo de `listarTasksComLead`). A versão
 * original argumentava que mostrar o lembrete de um colega, sem o viewer
 * poder concluí-lo, seria "mais confuso que útil" — mas o efeito prático
 * era pior: colega A cria "Ligar para Fernanda às 15h" nesse lead; colega
 * B abre o MESMO lead, vê a seção de tarefas vazia (nenhum sinal de que
 * alguém já agendou algo) e liga de novo — contato duplicado com o mesmo
 * cliente é exatamente o tipo de erro que um CRM existe para evitar, pior
 * que um botão "Concluir" que não faz nada. Também quebrava a coerência da
 * própria página: notas são compartilhadas (Task 17), o lead é
 * compartilhado (decisão de negócio documentada em `leads/queries.ts`:
 * equipe colaborativa, qualquer vendedor cobre qualquer lead) — só tarefa
 * ficava escondida, sem motivo que se sustente ao lado das outras duas.
 *
 * `responsavel` (`id`/`nome`) vem incluído propositalmente: é o que permite
 * a UI (`TaskList`, `leads/[id]/page.tsx`) mostrar de quem é cada tarefa e
 * decidir, por tarefa, se mostra o botão "Concluir" (só quando
 * `responsavel.id` é o usuário logado) ou só o nome do dono (senão) — nunca
 * um botão que renderiza para todo mundo e falha silenciosamente pra quem
 * não é dono. A checagem de dono em `concluirTask` (service.ts) continua
 * intacta e é a barreira real; isto aqui é só a UI não mentir sobre o que
 * cada pessoa pode fazer.
 */
export async function listarTasksPendentesDoLead(leadId: string): Promise<TaskDoLead[]> {
  return prisma.task.findMany({
    where: { leadId, concluidaEm: null },
    include: { responsavel: { select: { id: true, nome: true } } },
    orderBy: { vencimento: "asc" },
  });
}
