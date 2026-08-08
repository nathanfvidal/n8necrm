import { usuarioAtualOuLogin } from "@/core/auth/session";
import { listarTasksComLead } from "@/core/tasks/queries";
import { TaskForm } from "@/components/tasks/task-form";
import { TaskList, type TaskLinha } from "@/components/tasks/task-list";

/**
 * `(painel)/layout.tsx` já garante sessão válida e usuário ativo antes de
 * qualquer página sob este route group renderizar (mesma observação já
 * feita em `leads/page.tsx`, Task 16) — não repetimos essa checagem aqui.
 * Chamamos `usuarioAtual()` de novo só para saber QUEM está logado: é o
 * escopo de `listarTasksComLead` — tarefa é lembrete pessoal, sempre
 * escopada ao próprio usuário (ver a checagem de dono em `concluirTask`,
 * `core/tasks/service.ts`), diferente do pipeline de leads (sem escopo por
 * responsável, decisão de negócio documentada em `leads/queries.ts`).
 */
export default async function TasksPage() {
  const usuario = await usuarioAtualOuLogin();
  const tasks = await listarTasksComLead(usuario.id);

  const linhas: TaskLinha[] = tasks.map((t) => ({
    id: t.id,
    titulo: t.titulo,
    vencimento: t.vencimento,
    descricao: t.descricao,
    leadId: t.leadId,
    leadContatoNome: t.lead?.contact?.nome,
  }));

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-xl font-semibold">Tarefas</h1>
      <TaskForm />
      <TaskList tasks={linhas} />
    </div>
  );
}
