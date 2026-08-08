import { prisma } from "@/lib/prisma";
import type { Lead, Contact, User, PipelineStage } from "@prisma/client";

// `responsavel` narrowed para só `id`/`nome` (Task 17, fix round 1/5,
// achado do revisor): as duas funções abaixo já carregavam a linha inteira
// de `User` — `senhaHash` incluído — só para que o kanban (Task 15) e a
// tabela (Task 16) renderizassem `responsavel?.nome`. O hash não chegava ao
// cliente nesses dois usos (`kanban-card.tsx`/`page.tsx` só leem `.nome`),
// mas carregar dado sensível "porque não faz mal hoje" é o tipo de coisa
// que vaza no dia em que alguém passar o objeto inteiro um nível adiante.
// `contact` continua com o tipo completo — `Contact` não guarda senha.
type ResponsavelResumido = Pick<User, "id" | "nome">;

export type LeadComRelacoes = Lead & {
  contact: Contact | null;
  responsavel: ResponsavelResumido | null;
};

export type LeadListado = Lead & {
  contact: Contact | null;
  responsavel: ResponsavelResumido | null;
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
    // Arquivado sai do funil por definição — ver `arquivarLead`
    // (`leads/service.ts`). Este filtro cobre DUAS telas de uma vez, o kanban
    // e o painel, porque as duas consomem esta função;
    // `tests/unit/leads-arquivar.test.ts` percorre todos os caminhos de
    // listagem, porque esquecer um faz o lead reaparecer justamente onde
    // arquivar deveria tê-lo removido.
    where: { arquivadoEm: null },
    include: { contact: true, responsavel: { select: { id: true, nome: true } } },
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
 * Devolve TODOS os leads, para qualquer papel — sem escopo por
 * `responsavelId`. Fix round 1/5: a primeira versão desta função filtrava
 * por responsável para VENDEDOR, mas o revisor encontrou a mesma
 * inconsistência que motivou a reversão (ver decisão de negócio em
 * `page.tsx`): `/leads/kanban` (Task 15, `listarLeadsPorEtapa` acima) já
 * lista todo lead para todo papel, sem filtro nenhum, e `moverEtapa`
 * (service.ts) nunca checou dono — uma restrição só nesta tabela escondia
 * dado numa tela e servia o mesmo dado, sem controle nenhum, a um clique de
 * distância. Uma revenda pequena com equipe colaborativa (qualquer
 * vendedor pode atender um cliente que "pertence" a outro) tornou a barreira
 * errada por decisão de produto, não só por bug de superfície — daí ter sido
 * removida aqui em vez de espalhada para as outras telas.
 */
export async function listarLeads(opcoes?: {
  incluirArquivados?: boolean;
}): Promise<LeadListado[]> {
  return prisma.lead.findMany({
    // Filtra arquivados por PADRÃO — quem quiser vê-los pede explicitamente
    // (o alternador "mostrar arquivados" da tela `/leads`). O padrão seguro é
    // o de esconder: uma chamada nova que esqueça o parâmetro erra para o lado
    // de omitir, não para o de fazer o lead arquivado reaparecer.
    where: opcoes?.incluirArquivados ? {} : { arquivadoEm: null },
    include: {
      contact: true,
      responsavel: { select: { id: true, nome: true } },
      stage: true,
    },
    orderBy: { criadoEm: "desc" },
  });
}
