import { prisma } from "@/lib/prisma";
import type { PipelineStage } from "@prisma/client";

/**
 * Lê as etapas do funil na ordem de exibição.
 *
 * O `orderBy: { ordem: "asc" }` não é incidental: a Task 15 renderiza as
 * colunas do kanban na ordem em que esta função devolve as etapas, e a
 * Task 13 sempre cria o Lead na primeira etapa (a de menor `ordem`). Uma
 * ordenação implícita (por `id`/criação) quebraria as duas silenciosamente
 * assim que o seed fosse re-executado ou as etapas fossem editadas.
 */
export async function listarEtapas(): Promise<PipelineStage[]> {
  return prisma.pipelineStage.findMany({ orderBy: { ordem: "asc" } });
}

/**
 * Quantos leads SEGURAM cada etapa — arquivados incluídos.
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
 */
export async function contarLeadsQueSeguramEtapa(): Promise<Record<string, number>> {
  const grupos = await prisma.lead.groupBy({
    by: ["stageId"],
    _count: { _all: true },
  });

  const porEtapa: Record<string, number> = {};
  for (const grupo of grupos) {
    porEtapa[grupo.stageId] = grupo._count._all;
  }
  return porEtapa;
}
