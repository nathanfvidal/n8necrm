import { prisma } from "@/lib/prisma";
import type { Lead, Contact, User } from "@prisma/client";

export type LeadComRelacoes = Lead & {
  contact: Contact | null;
  responsavel: User | null;
};

/**
 * Lê todos os leads, agrupados por etapa do funil — o formato que a Task 15
 * consome diretamente para renderizar as colunas do kanban. Toda etapa do
 * funil aparece como chave, mesmo sem nenhum lead (array vazio), para que a
 * UI não precise checar existência antes de renderizar uma coluna.
 */
export async function listarLeadsPorEtapa(): Promise<Record<string, LeadComRelacoes[]>> {
  const etapas = await prisma.pipelineStage.findMany({ orderBy: { ordem: "asc" } });
  const leads = await prisma.lead.findMany({
    include: { contact: true, responsavel: true },
    orderBy: { criadoEm: "desc" },
  });

  const agrupado: Record<string, LeadComRelacoes[]> = {};
  for (const etapa of etapas) {
    agrupado[etapa.id] = leads.filter((lead) => lead.stageId === etapa.id);
  }
  return agrupado;
}
