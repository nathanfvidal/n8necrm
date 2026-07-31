import { listarEtapas } from "@/core/pipeline/stages";
import { listarLeadsPorEtapa } from "@/core/leads/queries";
import { KanbanBoard } from "@/components/leads/kanban-board";

/**
 * `(painel)/layout.tsx` já chama `usuarioAtual()` e redireciona para
 * `/login` quando ela rejeita (sessão ausente OU usuário desativado) — esta
 * página não repete essa checagem, só busca o que o quadro precisa.
 */
export default async function KanbanPage() {
  const [etapas, leadsPorEtapa] = await Promise.all([listarEtapas(), listarLeadsPorEtapa()]);

  return (
    <div className="space-y-2">
      <h1 className="px-6 pt-6 text-xl font-semibold">Funil de leads</h1>
      <KanbanBoard etapas={etapas} leadsPorEtapa={leadsPorEtapa} />
    </div>
  );
}
