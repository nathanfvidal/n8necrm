import { redirect } from "next/navigation";

import { usuarioAtualOuLogin } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";
import { listarEtapas, contarLeadsQueSeguramEtapa } from "@/core/pipeline/stages";
import { contarLeadsPorEtapa } from "@/core/leads/queries";
import { EtapaForm } from "@/components/pipeline/etapa-form";
import { EtapasTable, type EtapaNaTela } from "@/components/pipeline/etapas-table";

/**
 * Gestão do funil — ADMIN apenas (`gerenciar_funil`).
 *
 * `usuarioAtualOuLogin()` e não `usuarioAtual()`: esta rota vira item de MENU, e
 * `<Link>` pré-carrega — o porquê está no docstring daquela função
 * (`core/auth/session.ts`) e no comentário de `usuarios/page.tsx`.
 *
 * `redirect` em vez de `notFound()` para quem não é ADMIN: um GESTOR que clicou
 * num link antigo entende melhor voltar ao painel. Não é a defesa — a defesa é a
 * checagem dentro de cada Server Action (`core/pipeline/actions.ts`), que vale
 * mesmo para um POST que nunca passou por esta página.
 */
export default async function EtapasPage() {
  const usuario = await usuarioAtualOuLogin();

  if (!hasPermission(usuario.papel, "gerenciar_funil")) {
    redirect("/");
  }

  const [etapas, ativosPorEtapa, totaisPorEtapa] = await Promise.all([
    listarEtapas(usuario.companyId),
    contarLeadsPorEtapa(usuario.companyId),
    contarLeadsQueSeguramEtapa(usuario.companyId),
  ]);

  // O `.map()` é a fronteira servidor→cliente, não o `select`: é aqui que se
  // decide o que atravessa.
  const paraTela: EtapaNaTela[] = etapas.map((etapa) => ({
    id: etapa.id,
    nome: etapa.nome,
    cor: etapa.cor,
    ehGanho: etapa.ehGanho,
    leadsAtivos: ativosPorEtapa[etapa.id] ?? 0,
    leadsTotais: totaisPorEtapa[etapa.id] ?? 0,
  }));

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Etapas</h1>
        <p className="text-sm text-muted-foreground">
          As etapas do funil, na ordem em que aparecem no quadro. Remover uma etapa move os
          leads dela para a etapa que você escolher.
        </p>
      </div>

      <div className="rounded-md border p-4">
        <h2 className="mb-3 text-sm font-medium">Adicionar etapa</h2>
        <EtapaForm />
      </div>

      <EtapasTable etapas={paraTela} />
    </div>
  );
}
