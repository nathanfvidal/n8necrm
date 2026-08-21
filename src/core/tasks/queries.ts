// `import "server-only"` — mesma decisão de `service.ts` (ver comentário
// lá): este módulo importa Prisma diretamente, e nada aqui precisa (nem
// deveria) ser alcançável de um Client Component.
import "server-only";

import { prismaDaEmpresa } from "@/core/tenancy/escopo";
import { aplicarTeto, LIMITE_LISTAGEM, type Listagem } from "@/core/listagem";
import type { Task, User } from "@prisma/client";

/**
 * O que a tela de tarefas precisa, e só isso.
 *
 * Substitui o antigo `TaskComLead`, que era `Task & { lead: Lead & { contact:
 * Contact } }` — a linha inteira de três tabelas para ler UM nome. Não era
 * vazamento (a `page.tsx` já projetava antes de entregar ao componente de
 * cliente, diferente do que o kanban fazia), mas era o mesmo desperdício: o
 * banco montava e transportava `utm`, `sessionId` e o e-mail do contato a
 * cada carregamento de `/tasks`, para nada.
 *
 * Projetar aqui também evita que a próxima pessoa que precise de mais um
 * campo na tela seja tentada a passar o objeto inteiro um nível adiante —
 * que é exatamente como o vazamento do kanban nasceu.
 */
export type TarefaListada = {
  id: string;
  titulo: string;
  descricao: string | null;
  vencimento: Date;
  concluidaEm: Date | null;
  leadId: string | null;
  leadContatoNome: string | null;
  contactId: string | null;
  contatoNome: string | null;
};

// `responsavel` narrowed para só `id`/`nome` — mesmo padrão de
// `leads/queries.ts` (`ResponsavelResumido`) e `leads/[id]/page.tsx`:
// nenhum consumidor destas duas queries precisa de `senhaHash`, então ele
// nunca sai do banco.
type ResponsavelResumido = Pick<User, "id" | "nome">;

export type TaskDoLead = Task & { responsavel: ResponsavelResumido };

/**
 * Lê as tarefas de um responsável — pendentes por padrão, concluídas sob
 * pedido — já projetadas em `TarefaListada`.
 *
 * Com teto e `truncado`, como toda listagem da casa (`aplicarTeto`,
 * `core/listagem.ts`). Antes desta branch a consulta não tinha teto nenhum:
 * a lista de pendentes de uma pessoa dificilmente passa de algumas dezenas,
 * mas a de CONCLUÍDAS cresce para sempre — sem teto, a tela de histórico de
 * quem usa o CRM há um ano carregaria a tabela inteira numa requisição.
 *
 * Sempre escopada por `responsavelId`, sem exceção: diferente de
 * `listarLeads` (`leads/queries.ts`, sem escopo — decisão de negócio:
 * pipeline compartilhado numa equipe colaborativa), tarefa é lembrete
 * pessoal (ver a checagem de dono em `concluirTask`, `service.ts`) — não
 * faz sentido a tela principal de tarefas de uma pessoa mostrar o lembrete
 * de outra, que ela nem consegue concluir.
 */
export async function listarMinhasTasks(
  companyId: string,
  responsavelId: string,
  opcoes?: {
    /**
     * `false` (o padrão) lista as PENDENTES. O padrão é o seguro no sentido
     * que importa aqui: uma chamada nova que esqueça o parâmetro mostra a
     * lista de trabalho, não um histórico de tarefas mortas.
     */
    concluidas?: boolean;
    /** Só para teste — exercita o truncamento sem criar 1001 linhas. */
    limite?: number;
  }
): Promise<Listagem<TarefaListada>> {
  const limite = opcoes?.limite ?? LIMITE_LISTAGEM;
  const concluidas = opcoes?.concluidas ?? false;

  // `companyId` além de `responsavelId`, e o "além" é o ponto: escopo por
  // DONO não é escopo por EMPRESA. Enquanto ninguém tem vínculo em duas
  // empresas os dois coincidem — toda tarefa de que eu sou dono é da minha
  // empresa — e é por isso que este filtro parecia suficiente. `criarUsuario`
  // (`core/users/service.ts`) já sabe criar `Membership`, então dois vínculos é
  // estado expressável hoje, e nele a lista de `/tasks` misturaria os lembretes
  // das duas empresas numa tela só. O caso está em
  // `tests/unit/task-isolamento.test.ts`, com a sonda da consulta antiga ao
  // lado.
  //
  // As relações trazidas no `select` (`lead.contact`, `contact`) NÃO são
  // filtradas pelo escopo — leitura aninhada nunca é (ver a seção em
  // `core/tenancy/escopo.ts`). Elas são seguras aqui por outro motivo: as duas
  // ficam DENTRO de `Company` a partir de uma `Task` que o escopo já filtrou, e
  // nenhuma atravessa `User`, que é onde a fronteira de empresa se perde.
  const linhas = await prismaDaEmpresa(companyId).task.findMany({
    where: {
      responsavelId,
      concluidaEm: concluidas ? { not: null } : null,
    },
    select: {
      id: true,
      titulo: true,
      descricao: true,
      vencimento: true,
      concluidaEm: true,
      leadId: true,
      contactId: true,
      lead: { select: { contact: { select: { nome: true } } } },
      contact: { select: { nome: true } },
    },
    // Pendente ordena por vencimento (a mais urgente primeiro); concluída
    // ordena pela conclusão mais recente. São perguntas diferentes: numa
    // "o que faço agora", na outra "o que acabei de fazer". Manter
    // `vencimento asc` nas concluídas deixaria no topo a tarefa vencida há
    // mais tempo, que é a menos interessante das duas listas.
    orderBy: concluidas ? { concluidaEm: "desc" } : { vencimento: "asc" },
    take: limite + 1,
  });

  const { itens, truncado } = aplicarTeto(linhas, limite);

  return {
    truncado,
    itens: itens.map((t) => ({
      id: t.id,
      titulo: t.titulo,
      descricao: t.descricao,
      vencimento: t.vencimento,
      concluidaEm: t.concluidaEm,
      leadId: t.leadId,
      leadContatoNome: t.lead?.contact?.nome ?? null,
      contactId: t.contactId,
      contatoNome: t.contact?.nome ?? null,
    })),
  };
}

/**
 * Lê TODAS as tarefas PENDENTES vinculadas a um lead específico — usada
 * pela seção "Tarefas" da página de detalhe do lead (`/leads/[id]`, Task
 * 18 — a Task 17 deixou essa seção de fora de propósito, ver histórico de
 * `leads/[id]/page.tsx`).
 *
 * SEM escopo por responsável — fix round 1/5, achado do revisor,
 * revertendo a decisão original desta função (que filtrava por
 * `responsavelId`, mesmo escopo de `listarTasksComLead`). A versão
 * original argumentava que mostrar o lembrete de um colega, sem o viewer
 * poder concluí-lo, seria "mais confuso que útil" — mas o efeito prático
 * era pior: colega A cria "Ligar para Fernanda às 15h" nesse lead; colega
 * B abre o MESMO lead, vê a seção de tarefas vazia (nenhum sinal de que
 * alguém já agendou algo) e liga de novo — contato duplicado com o mesmo
 * cliente é exatamente o tipo de erro que um CRM existe para evitar, pior
 * que um botão "Concluir" que não faz nada. Também quebrava a coerência da
 * própria página: notas são compartilhadas (Task 17), o lead é
 * compartilhado (decisão de negócio documentada em `leads/queries.ts`:
 * equipe colaborativa, qualquer vendedor cobre qualquer lead) — só tarefa
 * ficava escondida, sem motivo que se sustente ao lado das outras duas.
 *
 * `responsavel` (`id`/`nome`) vem incluído propositalmente: é o que permite
 * a UI (`TaskList`, `leads/[id]/page.tsx`) mostrar de quem é cada tarefa e
 * decidir, por tarefa, se mostra o botão "Concluir" (só quando
 * `responsavel.id` é o usuário logado) ou só o nome do dono (senão) — nunca
 * um botão que renderiza para todo mundo e falha silenciosamente pra quem
 * não é dono. A checagem de dono em `concluirTask` (service.ts) continua
 * intacta e é a barreira real; isto aqui é só a UI não mentir sobre o que
 * cada pessoa pode fazer.
 */
export async function listarTasksPendentesDoLead(
  companyId: string,
  leadId: string
): Promise<TaskDoLead[]> {
  // `Task.leadId` é FK para `Lead` e não carrega empresa: "tarefa da empresa A
  // pendurada no Lead da empresa B" é estado EXPRESSÁVEL no schema, e era
  // exatamente o que esta consulta mostraria a quem abrisse o detalhe do lead
  // da B. A fixture de `tests/unit/task-isolamento.test.ts` fabrica essa linha
  // de propósito (`TASK_CRUZADA`) — a pergunta "a FK basta?" é respondida com
  // dado, não com raciocínio, e a resposta é não.
  return prismaDaEmpresa(companyId).task.findMany({
    where: { leadId, concluidaEm: null },
    include: { responsavel: { select: { id: true, nome: true } } },
    orderBy: { vencimento: "asc" },
  });
}
