import { listarEtapas } from "@/core/pipeline/stages";
import { listarLeadsPorEtapa } from "@/core/leads/queries";
import { LIMITE_LISTAGEM } from "@/core/listagem";
import { KanbanBoard } from "@/components/leads/kanban-board";

/**
 * `(painel)/layout.tsx` já chama `usuarioAtual()` e redireciona para
 * `/login` quando ela rejeita (sessão ausente OU usuário desativado) — esta
 * página não repete essa checagem, só busca o que o quadro precisa.
 */
export default async function KanbanPage() {
  const [etapas, { porEtapa, truncado }] = await Promise.all([
    listarEtapas(),
    listarLeadsPorEtapa(),
  ]);

  return (
    <div className="space-y-2">
      <h1 className="px-6 pt-6 text-xl font-semibold">Funil de leads</h1>
      {/* O quadro é o lugar onde truncar em silêncio enganaria mais: as
          colunas mostram contagem, e uma contagem parcial parecida com o total
          faria alguém concluir que o funil encolheu. */}
      {truncado && (
        <p role="status" className="mx-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          Mostrando os {LIMITE_LISTAGEM} leads mais recentes — as contagens por etapa não incluem
          os mais antigos. Use a tabela em /leads para trabalhar a base completa.
        </p>
      )}
      <KanbanBoard etapas={etapas} leadsPorEtapa={porEtapa} />
    </div>
  );
}
