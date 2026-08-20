import { prismaDaEmpresa } from "@/core/tenancy/escopo";
import { aplicarTeto, LIMITE_LISTAGEM, type Listagem } from "@/core/listagem";
import { formatarValorBR } from "@/lib/dinheiro";
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

/**
 * O que o quadro precisa, e SÓ isso.
 *
 * Antes daqui esta função devolvia `Lead & { contact: Contact }` — a linha
 * inteira das duas tabelas — e `kanban/page.tsx` passava o objeto direto para
 * `KanbanBoard`, que é Client Component. Medido contra o servidor de produção
 * antes da mudança: **11 campos que o cartão nunca lê chegavam no navegador**
 * (`utm`, `sessionId`, `itemId`, `valorEstimado`, `ultimaInteracaoEm`,
 * `arquivadoEm`, `criadoEm`, `email`, `stageId`, `contactId`,
 * `responsavelId`), mais o valor do e-mail do contato em texto.
 *
 * Era a única superfície do sistema servindo linha crua de banco ao cliente —
 * `/leads`, `/tasks`, `/leads/[id]`, `/contatos` e o CSV todos projetam antes
 * da fronteira. O perigo não era o e-mail de hoje: é que `Contact` vai ganhar
 * documento e endereço, e uma consulta curinga serviria os dois ao navegador
 * sem uma linha de código nova e sem nenhum teste ficar vermelho.
 *
 * `valorFormatado` e não `valorEstimado`: `Decimal` não é serializável para
 * Client Component (o que chegava era a saída do `toJSON`, então o tipo mentia
 * em runtime — `.toFixed(2)` compilaria e explodiria). Formatar aqui também
 * evita puxar o namespace do Prisma para o bundle do navegador, já que
 * `formatarValorBR` importa `@prisma/client`.
 *
 * `null` continua `null`: o cartão escreve "Sem valor estimado", como já faz
 * com "Sem contato identificado". String vazia num cartão é indistinguível de
 * campo quebrado.
 */
export type LeadDoQuadro = {
  id: string;
  canal: Lead["canal"];
  contatoNome: string | null;
  contatoTelefone: string | null;
  responsavelNome: string | null;
  valorFormatado: string | null;
};

/**
 * O contato, reduzido ao que a tabela e o CSV leem.
 *
 * Era `Contact` inteiro (`include: { contact: true }`). Os dois consumidores
 * de `listarLeads` — `/leads/page.tsx` e `export/leads/route.ts` — projetam
 * antes da fronteira e só leem `nome` e `telefone`, então nunca vazou. Mas a
 * rota de exportação chama com `semTeto: true`, a única chamada do sistema
 * que pede a base inteira: com `Contact` carregando `documento`, `endereco` e
 * `observacoes` desde a branch 3, o CPF de todo cliente passou a ser lido do
 * banco e mantido em memória para montar um arquivo que não contém nenhum
 * deles.
 *
 * Mesma lição do funil (ver `LeadDoQuadro` acima): a consulta curinga não
 * piora quando alguém a edita — piora quando a TABELA cresce, em silêncio, e
 * nenhum teste fica vermelho.
 */
type ContatoDaListagem = Pick<Contact, "id" | "nome" | "telefone">;

export type LeadListado = Lead & {
  contact: ContatoDaListagem | null;
  responsavel: ResponsavelResumido | null;
  stage: PipelineStage;
};

/**
 * Lê todos os leads, agrupados por etapa do funil — o formato que a Task 15
 * consome diretamente para renderizar as colunas do kanban. Toda etapa do
 * funil aparece como chave, mesmo sem nenhum lead (array vazio), para que a
 * UI não precise checar existência antes de renderizar uma coluna.
 */
export async function listarLeadsPorEtapa(
  companyId: string,
  opcoes?: {
    /** Só para teste — ver `listarLeads`. */
    limite?: number;
  }
): Promise<{ porEtapa: Record<string, LeadDoQuadro[]>; truncado: boolean }> {
  const limite = opcoes?.limite ?? LIMITE_LISTAGEM;
  const db = prismaDaEmpresa(companyId);
  const etapas = await db.pipelineStage.findMany({ orderBy: { ordem: "asc" } });
  const linhas = await db.lead.findMany({
    // Teto no TOTAL de leads carregados, não por coluna. Um teto por coluna
    // exigiria uma consulta por etapa; este basta para o que o teto existe
    // para fazer — impedir que uma única requisição carregue a tabela
    // inteira. O corte cai nos leads mais antigos (a ordenação é
    // `criadoEm desc`), e a tela avisa que cortou.
    // Arquivado sai do funil por definição — ver `arquivarLead`
    // (`leads/service.ts`). Este filtro cobre DUAS telas de uma vez, o kanban
    // e o painel, porque as duas consomem esta função;
    // `tests/unit/leads-arquivar.test.ts` percorre todos os caminhos de
    // listagem, porque esquecer um faz o lead reaparecer justamente onde
    // arquivar deveria tê-lo removido.
    where: { arquivadoEm: null },
    // `select` e não `include`: `include` traz TODAS as colunas escalares da
    // tabela junto com a relação, e é exatamente por isso que 11 campos
    // vazavam. `stageId` entra aqui porque o agrupamento precisa dele, e
    // NÃO entra no DTO — agrupa primeiro, mapeia depois.
    select: {
      id: true,
      canal: true,
      stageId: true,
      valorEstimado: true,
      contact: { select: { nome: true, telefone: true } },
      responsavel: { select: { nome: true } },
    },
    orderBy: { criadoEm: "desc" },
    take: limite + 1,
  });

  const { itens: leads, truncado } = aplicarTeto(linhas, limite);

  const agrupado: Record<string, LeadDoQuadro[]> = {};
  for (const etapa of etapas) {
    agrupado[etapa.id] = leads
      .filter((lead) => lead.stageId === etapa.id)
      .map((lead) => ({
        id: lead.id,
        canal: lead.canal,
        contatoNome: lead.contact?.nome ?? null,
        contatoTelefone: lead.contact?.telefone ?? null,
        responsavelNome: lead.responsavel?.nome ?? null,
        valorFormatado: lead.valorEstimado === null ? null : formatarValorBR(lead.valorEstimado),
      }));
  }
  return { porEtapa: agrupado, truncado };
}

/**
 * Quantos leads ativos há em cada etapa. Chaves são `stageId`; etapa sem lead
 * simplesmente não aparece (quem lê usa `?? 0`).
 *
 * ## Por que uma função separada, e não `listarLeadsPorEtapa().length`
 *
 * O painel fazia exatamente isso, e estava errado de um jeito caro. Toda
 * listagem deste sistema tem teto (`LIMITE_LISTAGEM`, 1000 — ver
 * `core/listagem.ts`), e o teto existe por um bom motivo. Só que o painel
 * DESCARTAVA o `truncado` que a consulta devolve e contava o tamanho dos
 * arrays: acima de 1000 leads ele passaria a mostrar "1000" como total, e a
 * taxa de conversão — o número grande no meio da tela, com uma casa decimal,
 * a primeira coisa que qualquer pessoa vê ao entrar no CRM — sairia calculada
 * sobre os 1000 mais RECENTES. Um funil saudável acumula leads ganhos ao
 * longo do tempo e recebe leads novos ainda não convertidos: cortar pelos
 * mais recentes enviesa a taxa para BAIXO, e nada na tela avisaria.
 *
 * A correção óbvia seria repetir o aviso amarelo que o kanban e `/leads` já
 * mostram. Seria honesto e ainda assim errado: um painel que estampa uma taxa
 * inexata com uma nota de rodapé explicando que é inexata não serve para
 * decidir nada. O painel não precisa de LINHA nenhuma — precisa de contagem,
 * e contagem o Postgres faz exata, por etapa, sem transferir uma linha
 * sequer. Some o teto, some o viés, some o aviso, e some também a leitura de
 * até 1000 leads (com dois joins e o mapeamento para DTO) da página mais
 * visitada do sistema.
 *
 * `arquivadoEm: null` pelo mesmo motivo de todas as outras listagens:
 * arquivado sai do funil por definição, e as somas do painel são o lugar onde
 * um arquivado reaparecendo mentiria mais.
 */
export async function contarLeadsPorEtapa(companyId: string): Promise<Record<string, number>> {
  const grupos = await prismaDaEmpresa(companyId).lead.groupBy({
    by: ["stageId"],
    where: { arquivadoEm: null },
    _count: { _all: true },
  });

  const porEtapa: Record<string, number> = {};
  for (const grupo of grupos) {
    porEtapa[grupo.stageId] = grupo._count._all;
  }
  return porEtapa;
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
export async function listarLeads(
  /**
   * O escopo, explícito e POSICIONAL — não um campo a mais dentro de
   * `opcoes`. A diferença importa: como campo opcional, uma chamada existente
   * continuaria compilando sem escopo nenhum, e o compilador ficaria calado
   * exatamente onde o silêncio custa caro. Como primeiro parâmetro
   * obrigatório, TODA chamada precisou ser revisitada nesta tarefa.
   *
   * A origem em produção é `UsuarioAtivo.companyId` (`core/auth/session.ts`),
   * nunca um parâmetro vindo do cliente e nunca `prisma.company.findFirst()`.
   */
  companyId: string,
  opcoes?: {
    incluirArquivados?: boolean;
    /**
     * Desliga o teto. Existe para UM chamador: a exportação CSV
     * (`app/(painel)/export/leads/route.ts`), onde truncar seria pior que
     * qualquer coisa — um arquivo com 1000 de 1500 leads, indistinguível de um
     * arquivo completo, viraria decisão de negócio tomada sobre dado faltando.
     * Aquela rota já documenta o próprio teto de escala e o sintoma de quando
     * ele chegar.
     *
     * O padrão é COM teto, e não o contrário, pelo mesmo raciocínio de
     * `incluirArquivados` acima: chamada nova que esqueça o parâmetro erra
     * para o lado seguro.
     */
    semTeto?: boolean;
    /** Só para teste — permite exercitar o truncamento sem criar 1001 linhas. */
    limite?: number;
  }
): Promise<Listagem<LeadListado>> {
  const limite = opcoes?.limite ?? LIMITE_LISTAGEM;

  const linhas = await prismaDaEmpresa(companyId).lead.findMany({
    // Filtra arquivados por PADRÃO — quem quiser vê-los pede explicitamente
    // (o alternador "mostrar arquivados" da tela `/leads`). O padrão seguro é
    // o de esconder: uma chamada nova que esqueça o parâmetro erra para o lado
    // de omitir, não para o de fazer o lead arquivado reaparecer.
    where: opcoes?.incluirArquivados ? {} : { arquivadoEm: null },
    include: {
      // `select` no contato pelo mesmo motivo de `responsavel` — ver
      // `ContatoDaListagem`. `stage` continua inteiro: `PipelineStage` é
      // nome, cor, ordem e os dois marcadores de funil, nada pessoal, e a
      // tabela usa `stage.nome` enquanto `lead-table.tsx` monta a lista de
      // filtros a partir dela.
      contact: { select: { id: true, nome: true, telefone: true } },
      responsavel: { select: { id: true, nome: true } },
      stage: true,
    },
    orderBy: { criadoEm: "desc" },
    // `limite + 1` de propósito: a linha extra é o que distingue "exatamente
    // `limite` leads" de "`limite` e tem mais" — ver `aplicarTeto`.
    ...(opcoes?.semTeto ? {} : { take: limite + 1 }),
  });

  return opcoes?.semTeto ? { itens: linhas, truncado: false } : aplicarTeto(linhas, limite);
}
