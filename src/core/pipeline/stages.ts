import { prismaDaEmpresa } from "@/core/tenancy/escopo";
import type { PipelineStage } from "@prisma/client";

/**
 * Lê as etapas do funil DE UMA EMPRESA, na ordem de exibição.
 *
 * O `orderBy: { ordem: "asc" }` não é incidental: a Task 15 renderiza as
 * colunas do kanban na ordem em que esta função devolve as etapas, e a
 * Task 13 sempre cria o Lead na primeira etapa (a de menor `ordem`). Uma
 * ordenação implícita (por `id`/criação) quebraria as duas silenciosamente
 * assim que o seed fosse re-executado ou as etapas fossem editadas.
 *
 * ## Por que `companyId` entra na assinatura (Ciclo 1a, conversão de `pipeline`)
 *
 * Era `prisma.pipelineStage.findMany({ orderBy })`, sem `where` nenhum, e
 * `PipelineStage` É modelo de tenant. Esta função alimenta QUATRO telas — `/`,
 * `/etapas`, `/leads/kanban` e `/leads/[id]` —, então era por ela que o funil
 * de todas as empresas aparecia em todas elas. A anotação da fila em
 * `eslint.config.mjs` chamava este defeito de ALTA por isso: mesmo depois de o
 * `auditLog` da home ser corrigido, a página continuaria vazando por aqui.
 *
 * O `companyId` viaja como PARÂMETRO, e não por estado global: a origem é
 * `UsuarioAtivo.companyId` (`core/auth/session.ts`) nas páginas, e o parâmetro
 * é o que mantém a função utilizável fora do ciclo de requisição — job de fila,
 * seed, script —, que é exatamente onde `AsyncLocalStorage` deixaria de valer
 * sem ninguém perceber.
 */
export async function listarEtapas(companyId: string): Promise<PipelineStage[]> {
  return prismaDaEmpresa(companyId).pipelineStage.findMany({ orderBy: { ordem: "asc" } });
}

/**
 * Quantos leads DA EMPRESA seguram cada etapa — arquivados incluídos.
 *
 * É o número que o `ON DELETE RESTRICT` de `Lead_stageId_fkey` enxerga, e
 * portanto o único que pode decidir se uma etapa é apagável.
 *
 * **Não confundir com `contarLeadsPorEtapa`** (`core/leads/queries.ts`), que
 * filtra `arquivadoEm: null` de propósito porque arquivado sai do funil por
 * definição. As duas divergem sempre que alguém arquivou um lead sem tirá-lo da
 * etapa, que é o caso comum — e usar aquela aqui produziria o pior desfecho
 * desta tela: uma etapa com 5 arquivados e nenhum ativo apareceria vazia, o
 * diálogo de exclusão não pediria destino, e o `delete` morreria na chave
 * estrangeira com uma mensagem que manda "tentar de novo" para uma condição
 * permanente.
 *
 * Mesma distinção que `core/contacts/queries.ts:173-176` já registra: arquivado
 * some das listagens, não some das referências.
 *
 * O `groupBy` era sobre `Lead` inteiro, sem empresa: a tela `/etapas` da
 * empresa A recebia um mapa com as chaves das etapas da B junto. Chave de etapa
 * que a empresa não tem não aparecia na tela (o `.map()` da página itera sobre
 * `listarEtapas`), mas o mapa atravessava a fronteira servidor→cliente com ids
 * de outro tenant dentro — e, no dia em que `listarEtapas` devolvesse etapa de
 * fora, os números casariam. O escopo injeta `where: { companyId }` no
 * `groupBy` (ver `OPERACOES_COM_WHERE` em `core/tenancy/escopo.ts`).
 */
export async function contarLeadsQueSeguramEtapa(
  companyId: string
): Promise<Record<string, number>> {
  const grupos = await prismaDaEmpresa(companyId).lead.groupBy({
    by: ["stageId"],
    _count: { _all: true },
  });

  const porEtapa: Record<string, number> = {};
  for (const grupo of grupos) {
    porEtapa[grupo.stageId] = grupo._count._all;
  }
  return porEtapa;
}
