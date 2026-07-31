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
