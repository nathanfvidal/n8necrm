import Link from "next/link";
import { notFound } from "next/navigation";

import { ApagarFluxo } from "@/components/automation/apagar-fluxo";
import { EditorN8n } from "@/components/automation/editor-n8n";
import { ExecucoesTable } from "@/components/automation/execucoes-table";
import { StatusFluxo } from "@/components/automation/status-fluxo";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/core/auth/permissions";
import { usuarioAtualOuLogin } from "@/core/auth/session";
import { exigirModulo } from "@/core/config/modulos";
import { clienteN8n, ErroN8n, urlBaseN8n } from "@/modules/automation/n8n";

export default async function FluxoDetalhePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aba?: string }>;
}) {
  const { id } = await params;
  const { aba } = await searchParams;
  const usuario = await usuarioAtualOuLogin();
  // Mesma ordem da lista (`fluxos/page.tsx`): sessao, modulo, permissao.
  await exigirModulo(usuario.companyId, "automation");

  // Mesmo gate de `ver_fluxos` da lista (`src/app/(painel)/fluxos/page.tsx`):
  // ADMIN e GESTOR, não `gerenciar_fluxos`. `notFound()` e não `redirect()`
  // pelo mesmo motivo — quem não pode ver não deveria nem saber que a rota
  // existe.
  if (!hasPermission(usuario.papel, "ver_fluxos")) notFound();

  const podeGerenciar = hasPermission(usuario.papel, "gerenciar_fluxos");

  let fluxo;
  let execucoes;
  let urlEditor: string;
  try {
    // Em paralelo: são duas chamadas independentes, e serializá-las dobraria
    // o tempo de uma tela cujo propósito é diagnosticar rápido.
    [fluxo, execucoes] = await Promise.all([
      clienteN8n.buscarWorkflow(id),
      clienteN8n.listarExecucoes({ workflowId: id, limite: 20 }),
    ]);

    // Montada NO SERVIDOR e passada pronta. `N8N_API_KEY` não acompanha: o
    // editor autentica pelo cookie de sessão do próprio n8n, não pela chave
    // da API — que nunca deve sair daqui.
    //
    // `urlBaseN8n()` valida a env (achado M5 da revisão final): a versão
    // anterior lia `process.env.N8N_API_URL?.replace(...)` cru, e com a env
    // ausente ou inválida isso deixava passar `src="undefined/workflow/<id>"`
    // pro navegador sem erro nenhum no servidor. Se a validação falhar, o
    // `throw` cai no mesmo `catch` abaixo — e o `erro` NÃO é `ErroN8n`, então
    // ele bate no ramo genérico do `description`, que tem texto próprio para
    // isso (M6): não manda o leitor procurar em log de instância nenhuma.
    urlEditor = `${urlBaseN8n().replace(/\/$/, "")}/workflow/${encodeURIComponent(id)}`;
  } catch (erro) {
    // `nao_encontrado` vira 404 de verdade, e não uma tela de erro: o fluxo
    // pode ter sido apagado por outra pessoa entre a lista e o clique.
    if (erro instanceof ErroN8n && erro.tipo === "nao_encontrado") notFound();
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Fluxo</h1>
        <EmptyState
          title="Não foi possível carregar este fluxo"
          description={
            erro instanceof ErroN8n
              ? erro.tipo === "inalcancavel"
                ? "A instância do n8n pode estar fora do ar."
                : "O n8n recusou a consulta. Veja os logs da instância."
              : // Achado M6 da revisão final: um erro que NÃO é `ErroN8n` — por
                // exemplo `urlBaseN8n()`/`lerEnv()` rejeitando uma env
                // ausente ou inválida — não é o n8n recusando nada. É
                // configuração DESTE CRM. "Veja os logs da instância" manda
                // o leitor procurar no lugar errado; aqui o problema está no
                // servidor do CRM, não em `n8n.nateksoft.com`.
                "A configuração do módulo de automação está incompleta. Veja os logs do servidor do CRM."
          }
        />
      </div>
    );
  }

  const mostrandoEditor = aba === "editar";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{fluxo.nome}</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <StatusFluxo ativo={fluxo.ativo} />
            <span>{fluxo.nos} nós</span>
            {fluxo.tags.length > 0 ? <span>· {fluxo.tags.join(", ")}</span> : null}
          </div>
        </div>
        {podeGerenciar ? <ApagarFluxo id={fluxo.id} nome={fluxo.nome} /> : null}
      </div>

      <nav className="flex gap-2 border-b">
        {/* `prefetch={false}` nas duas abas pelo motivo de segurança de
            `nav-links.tsx`, não por performance: a pré-busca padrão do `<Link>`
            bate no servidor com o cookie de sessão, o Auth.js o reemite, e uma
            resposta em voo no momento do "Sair" desfaz a revogação (o defeito
            de `0a81737`). Este `<nav>` tinha ficado de fora daquela correção.
            Cobrado por `tests/unit/prefetch-do-painel.test.ts`. */}
        <Link
          href={`/fluxos/${id}`}
          prefetch={false}
          aria-current={!mostrandoEditor ? "page" : undefined}
        >
          <Button variant={!mostrandoEditor ? "default" : "ghost"} size="sm">
            Execuções
          </Button>
        </Link>
        {/* A aba "Editar" NÃO tem gate além de `ver_fluxos` — quem alcança são
            ADMIN e GESTOR, não só ADMIN. Isso é DELIBERADO, decidido pelo
            dono em 2026-08-19 depois de a revisão final do Ciclo 4 apontar
            que a auditoria do próprio ciclo
            (docs/auditorias/2026-08-19-ciclo-4-fluxos.md) descrevia isso
            errado, como se o gate fosse `gerenciar_fluxos` (achado I2).
            O argumento: quem já tem conta no n8n alcança tudo isso pelo
            domínio dele de qualquer forma — o CRM só poupa um clique, não
            concede poder novo. A barreira real é a conta separada do n8n,
            que este CRM não provisiona. O gate NÃO é `gerenciar_fluxos` DE
            PROPÓSITO — não "consertar" isso depois achando que foi
            esquecimento. */}
        <Link
          href={`/fluxos/${id}?aba=editar`}
          prefetch={false}
          aria-current={mostrandoEditor ? "page" : undefined}
        >
          <Button variant={mostrandoEditor ? "default" : "ghost"} size="sm">
            Editar
          </Button>
        </Link>
      </nav>

      {mostrandoEditor ? (
        <EditorN8n url={urlEditor} nome={fluxo.nome} />
      ) : execucoes.itens.length === 0 ? (
        <EmptyState
          title="Nenhuma execução"
          description="Este fluxo ainda não rodou, ou as execuções antigas já foram podadas pelo n8n."
        />
      ) : (
        <ExecucoesTable execucoes={execucoes.itens} />
      )}
    </div>
  );
}
