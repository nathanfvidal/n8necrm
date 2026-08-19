import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { FluxosTable } from "@/components/automation/fluxos-table";
import { hasPermission } from "@/core/auth/permissions";
import { usuarioAtualOuLogin } from "@/core/auth/session";
import { exigirModulo } from "@/lib/module-gate";
import { listarFluxos } from "@/modules/automation/queries";

/**
 * Cada estado de falha do n8n tem texto próprio, e isso não é zelo:
 * "instância fora do ar", "chave recusada" e "lista vazia" exigem ações
 * completamente diferentes de quem lê, e os três seriam a mesma tela em
 * branco se o erro virasse lista vazia.
 */
const MOTIVOS: Record<string, { titulo: string; descricao: string }> = {
  inalcancavel: {
    titulo: "Não foi possível falar com o n8n",
    descricao: "A instância pode estar fora do ar ou o endereço em N8N_API_URL pode estar errado.",
  },
  nao_autorizado: {
    titulo: "O n8n recusou a chave do CRM",
    descricao: "Gere uma chave nova em n8n → Settings → n8n API e atualize N8N_API_KEY.",
  },
  nao_encontrado: {
    titulo: "Endpoint não encontrado no n8n",
    descricao: "A API pública pode estar desabilitada nesta instância.",
  },
  recusado: {
    titulo: "O n8n recusou a consulta",
    descricao: "Veja os logs da instância para entender o motivo.",
  },
};

export default async function FluxosPage() {
  exigirModulo("automation");

  const usuario = await usuarioAtualOuLogin();

  // `ver_fluxos` (ADMIN e GESTOR), não `gerenciar_fluxos`.
  //
  // Esconder o link do menu não é gate: a rota continua alcançável digitando a
  // URL, e Server Action é endpoint HTTP público. `notFound()` e não
  // `redirect()` pelo mesmo motivo que `exigirModulo` usa 404 — quem não pode
  // ver não deveria nem saber que a rota existe.
  if (!hasPermission(usuario.papel, "ver_fluxos")) notFound();

  const resultado = await listarFluxos();

  if (!resultado.ok) {
    const m = MOTIVOS[resultado.motivo] ?? MOTIVOS.recusado;
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Fluxos</h1>
        {/* `EmptyState` usa `title`/`description`, não `titulo`/`descricao`
            — conferido em `src/components/empty-state.tsx` antes de usar. */}
        <EmptyState title={m.titulo} description={m.descricao} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Fluxos</h1>
      {resultado.fluxos.length === 0 ? (
        <EmptyState title="Nenhum fluxo" description="Esta instância do n8n não tem workflow nenhum." />
      ) : (
        <FluxosTable
          fluxos={resultado.fluxos}
          podeGerenciar={hasPermission(usuario.papel, "gerenciar_fluxos")}
        />
      )}
    </div>
  );
}
