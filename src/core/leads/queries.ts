import { prisma } from "@/lib/prisma";
import type { Lead, Contact, User, PipelineStage } from "@prisma/client";

export type LeadComRelacoes = Lead & {
  contact: Contact | null;
  responsavel: User | null;
};

export type LeadListado = Lead & {
  contact: Contact | null;
  responsavel: User | null;
  stage: PipelineStage;
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

/**
 * Lê leads em lista única (não agrupada por etapa) para a tabela da Task 16,
 * com a etapa (`stage`) incluída — a tabela mostra "Etapa" como coluna, algo
 * que `listarLeadsPorEtapa` não precisa expor porque a etapa já é a própria
 * chave do agrupamento.
 *
 * `filtro.responsavelId`, quando presente, RESTRINGE a consulta no servidor
 * a leads daquele responsável — não é um filtro de conveniência, é a mesma
 * fronteira de visibilidade que `criarLeadManual` já aplica na escrita (Task
 * 13: só ADMIN/GESTOR, via `ver_dashboard_geral`, atribuem lead a outra
 * pessoa) e que a Task 14 já aplicou na leitura da lista de vendedores. Quem
 * chama esta função (a página) decide QUANDO passar o filtro; esta função só
 * garante que, uma vez passado, nenhuma linha de outro responsável escapa —
 * um filtro aplicado depois, no cliente, não seria uma permissão de verdade
 * (os dados já teriam saído do servidor).
 */
export async function listarLeads(filtro: { responsavelId?: string } = {}): Promise<LeadListado[]> {
  return prisma.lead.findMany({
    where: filtro.responsavelId ? { responsavelId: filtro.responsavelId } : undefined,
    include: { contact: true, responsavel: true, stage: true },
    orderBy: { criadoEm: "desc" },
  });
}
