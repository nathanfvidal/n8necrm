import { prismaDaEmpresa } from "@/core/tenancy/escopo";
import { aplicarTeto, LIMITE_LISTAGEM, type Listagem } from "@/core/listagem";

/**
 * Consultas da agenda de contatos, escopadas por empresa (Ciclo 1a).
 *
 * ## Por que `Contact` virou entidade de primeira classe
 *
 * Até esta fatia, um `Contact` só nascia como efeito colateral de criar um
 * lead (`encontrarOuCriarContact`, `core/leads/dedupe.ts`). Não havia tela,
 * listagem nem edição: um telefone digitado errado ficava errado para sempre,
 * e não havia como responder "quem é essa pessoa e o que já aconteceu com
 * ela" sem caçar lead por lead.
 *
 * ## As duas funções ganharam `companyId` como PRIMEIRO parâmetro
 *
 * Nenhuma das duas tinha noção de empresa: `listarContatos` fazia `findMany`
 * sem `where` nenhum — a agenda de todos os clientes numa tela só — e
 * `buscarContatoComHistorico` fazia `findUnique` pelo id que vem da rota
 * `/contatos/[id]`, entregando nome, telefone, CPF/CNPJ, endereço, observações
 * e os leads de um contato de qualquer empresa a quem soubesse (ou chutasse) o
 * id.
 *
 * A origem do `companyId` é `usuarioAtual().companyId` na página, nunca
 * parâmetro de formulário nem `prisma.company.findFirst()`. Ele viaja como
 * PARÂMETRO e não por `AsyncLocalStorage`: estado global funciona até o
 * primeiro caminho que roda fora do ciclo de requisição (job de fila, seed,
 * script), que é onde ninguém está olhando quando o escopo some.
 *
 * ## O escopo NÃO filtra leitura aninhada — e as duas consultas têm uma
 *
 * `core/tenancy/escopo.ts`, seção "Leitura ANINHADA": `include`/`select` que
 * atravessa relação desce INTACTO até o motor, porque a extensão enxerga uma
 * operação só. As duas consultas daqui trazem os `leads` do contato, então o
 * `where: { companyId }` dentro do aninhado é escrito À MÃO — é a única linha
 * deste arquivo em que o filtro depende de alguém ter lembrado dele.
 *
 * Sem ele o que segura é a FK, e a FK NÃO carrega empresa: `Lead.contactId`
 * aponta para `Contact` sem exigir que os dois estejam na mesma empresa
 * (`prisma/schema.prisma`), então "um lead da B pendurado num contato da A" é
 * estado expressável hoje. `tests/unit/contact-isolamento.test.ts` cria
 * exatamente essa linha e afirma que ela não aparece nem no histórico nem no
 * `totalLeads`.
 *
 * A relação `responsavel` é `User`, que é o caso que o escopo avisa ser o mais
 * fácil de errar — `User` não é modelo de tenant e as relações inversas dele
 * saem do tenant. Aqui ela para em `select: { nome: true }`: um campo escalar,
 * sem descer para `leadsAtribuidos` nem para nenhuma outra inversa. Não
 * acrescente relação abaixo dela sem filtrar à mão.
 *
 * ## O que estas consultas NÃO fazem
 *
 * Não tocam `Conversation`, que é conceito do módulo `whatsapp`. A tela de
 * detalhe mostra as conversas da pessoa, mas busca esse dado pelo módulo
 * (`listarConversasDoContato`, que também recebe `companyId`), não por aqui —
 * `src/core` não conhece módulo, e um fork com WhatsApp desligado não deve nem
 * consultar aquela tabela.
 */

export type ContatoListado = {
  id: string;
  nome: string;
  telefone: string;
  email: string | null;
  /**
   * Só `empresa` entra na listagem, e nenhum outro campo do cadastro.
   *
   * É o que identifica uma pessoa num CRM B2B quando há dois "Carlos" na
   * agenda — o resto (documento, endereço, observações) é dado de detalhe, e
   * trazê-lo para a lista significaria mandar o documento de TODA a agenda
   * para o navegador a cada abertura de `/contatos`, para desenhar nada.
   */
  empresa: string | null;
  criadoEm: Date;
  totalLeads: number;
};

/**
 * Lista os contatos DA EMPRESA, mais recentes primeiro, opcionalmente
 * filtrados por `busca`.
 *
 * A busca cobre nome, e-mail e telefone. Para telefone, compara **só os
 * dígitos** do que foi digitado: quem procura por "(11) 99999-8888" não
 * encontraria nada num banco que guarda "11999998888". É a mesma assimetria
 * que `normalizarTelefone` resolve na escrita, aplicada agora à leitura — mas
 * aqui sem normalização completa de propósito, porque busca parcial é o caso
 * comum ("quem tem DDD 11?") e normalizar exigiria um número inteiro e
 * válido.
 *
 * `mode: "insensitive"` no nome e no e-mail: procurar "maria" tem que achar
 * "Maria Silva". O Postgres compara maiúsculas por padrão.
 *
 * O `companyId` do escopo entra no TOPO do `where` e compõe em AND com o `OR`
 * da busca (ver `exigirCoerencia` em `core/tenancy/escopo.ts`) — um termo que
 * casaria com alguém de outra empresa deixa de encontrá-lo, em vez de
 * encontrá-lo e depender da tela para escondê-lo.
 */
export async function listarContatos(
  companyId: string,
  busca?: string,
  opcoes?: { limite?: number }
): Promise<Listagem<ContatoListado>> {
  const termo = busca?.trim() ?? "";
  const digitos = termo.replace(/\D/g, "");
  const limite = opcoes?.limite ?? LIMITE_LISTAGEM;

  const contatos = await prismaDaEmpresa(companyId).contact.findMany({
    // `limite + 1`: a linha extra distingue "exatamente `limite` contatos" de
    // "`limite` e tem mais" — ver `core/listagem.ts`. Sem teto, esta consulta
    // carrega a agenda inteira na memória do processo a cada abertura de
    // `/contatos`, e num fork com dezenas de milhares de contatos é onde a
    // tela deixa de renderizar devagar e passa a estourar o tempo da função.
    take: limite + 1,
    where:
      termo.length === 0
        ? undefined
        : {
            OR: [
              { nome: { contains: termo, mode: "insensitive" } },
              { email: { contains: termo, mode: "insensitive" } },
              // Empresa entra na busca junto com o nome: num CRM B2B, "quem
              // são meus contatos na Acme?" é a pergunta tão comum quanto
              // "onde está o Carlos?". Sem isto, a coluna apareceria na tabela
              // e não responderia quando alguém a digitasse na busca — que é
              // pior que não ter a coluna.
              { empresa: { contains: termo, mode: "insensitive" } },
              // Só entra no OR quando há dígito no termo: `contains: ""`
              // casaria com TODOS os telefones e anularia o filtro inteiro,
              // fazendo uma busca por "maria" devolver o banco completo.
              ...(digitos.length > 0 ? [{ telefone: { contains: digitos } }] : []),
            ],
          },
    orderBy: { criadoEm: "desc" },
    select: {
      id: true,
      nome: true,
      telefone: true,
      email: true,
      empresa: true,
      criadoEm: true,
      // Contagem FILTRADA, e o filtro é escrito à mão de propósito: o escopo
      // não desce em relação aninhada (ver o cabeçalho deste arquivo). Sem
      // ele, um lead de outra empresa apontando para este contato somaria na
      // coluna "Leads" da agenda — número errado numa tela, e a pista de que
      // existe dado de outro cliente do outro lado do link.
      _count: { select: { leads: { where: { companyId } } } },
    },
  });

  return aplicarTeto(
    contatos.map(({ _count, ...contato }) => ({ ...contato, totalLeads: _count.leads })),
    limite
  );
}

export type ContatoComHistorico = {
  id: string;
  nome: string;
  telefone: string;
  email: string | null;
  empresa: string | null;
  cargo: string | null;
  documento: string | null;
  endereco: string | null;
  cidade: string | null;
  uf: string | null;
  observacoes: string | null;
  criadoEm: Date;
  atualizadoEm: Date;
  leads: Array<{
    id: string;
    canal: string;
    criadoEm: Date;
    etapaNome: string;
    responsavelNome: string;
    arquivado: boolean;
  }>;
};

/**
 * Um contato DA EMPRESA, com o histórico de leads dele. `null` quando não
 * existe **ou quando é de outra empresa** — a tela chama `notFound()`, e as
 * duas causas devem parecer a mesma para quem está do outro lado: distinguir
 * "não existe" de "existe e não é seu" confirmaria o id a quem estivesse
 * varrendo.
 *
 * `findFirst`, e não `findUnique`: o escopo RECUSA `findUnique` em modelo de
 * tenant, lançando — o `where` dela só aceita campo único e `companyId` não é
 * único em `Contact` (ver "Recusa, lançando" em `core/tenancy/escopo.ts`).
 */
export async function buscarContatoComHistorico(
  companyId: string,
  id: string,
  opcoes?: {
    /**
     * Traz o CPF/CNPJ. Padrão **falso**, e o padrão é o ponto: uma chamada
     * nova que esqueça o parâmetro erra para o lado seguro — mesmo raciocínio
     * de `incluirArquivados` em `listarLeads`. Quem pode passar `true` é
     * `hasPermission(papel, "ver_documento_contato")`, conferido em quem tem
     * a sessão (a página), nunca aqui: `core/` não conhece sessão.
     *
     * A permissão e a empresa são travas INDEPENDENTES: `true` aqui libera o
     * campo dentro do escopo, e não o escopo. Há caso de teste para a
     * combinação perigosa — `incluirDocumento: true` sobre id de outra
     * empresa continua devolvendo `null`.
     */
    incluirDocumento?: boolean;
  }
): Promise<ContatoComHistorico | null> {
  const incluirDocumento = opcoes?.incluirDocumento ?? false;
  const contato = await prismaDaEmpresa(companyId).contact.findFirst({
    where: { id },
    // `select` explícito, campo a campo, e não `include`/linha crua: esta
    // consulta alimenta a página de detalhe, que é Server Component mas passa
    // o contato ao `ContactForm`, que é Client Component. Todo campo listado
    // aqui ATRAVESSA a fronteira para o navegador — é a mesma decisão que o
    // funil pagou caro para aprender (`core/leads/queries.ts`). A diferença é
    // que aqui a tela realmente edita todos eles.
    select: {
      id: true,
      nome: true,
      telefone: true,
      email: true,
      empresa: true,
      cargo: true,
      documento: true,
      endereco: true,
      cidade: true,
      uf: true,
      observacoes: true,
      criadoEm: true,
      atualizadoEm: true,
      leads: {
        // `where: { companyId }` escrito à mão porque o escopo não desce em
        // relação aninhada — ver o cabeçalho deste arquivo. Sem ele, "o que
        // aconteceu com esta pessoa" mostraria a etapa e o responsável de um
        // lead de OUTRA empresa, com link para `/leads/<id>`.
        where: { companyId },
        // Lead arquivado APARECE aqui de propósito — é a exceção da § 8 da
        // spec. "O que aconteceu com esta pessoa" precisa ser completo; é o
        // FUNIL que precisa ser limpo. NÃO acrescente `arquivadoEm: null` a
        // esta consulta: as quatro listagens do funil filtram, esta não.
        orderBy: { criadoEm: "desc" },
        select: {
          id: true,
          canal: true,
          criadoEm: true,
          arquivadoEm: true,
          // `stage` fica DENTRO da empresa por construção: o lead já está
          // filtrado por `companyId` logo acima, e `PipelineStage` é modelo de
          // tenant alcançado pela FK daquele lead.
          stage: { select: { nome: true } },
          // `select` explícito no responsável, NUNCA `include: { responsavel: true }`:
          // aquilo traria a linha inteira de `User`, com `senhaHash`, para
          // mostrar um nome — o mesmo achado que já apareceu neste projeto.
          //
          // É também a única relação deste arquivo que atravessa `User`, o
          // caso que `core/tenancy/escopo.ts` nomeia como o mais fácil de
          // errar. Ela para num campo escalar: nada aqui desce para
          // `leadsAtribuidos` nem para outra inversa de `User`, que é onde a
          // travessia sairia da empresa.
          responsavel: { select: { nome: true } },
        },
      },
    },
  });

  if (!contato) return null;

  const { leads, ...dados } = contato;
  return {
    ...dados,
    // O documento é zerado AQUI, no mapeamento, e não escondido na tela.
    //
    // A distinção não é estilística: `/contatos/[id]` passa este objeto para
    // `ContactForm`, que é Client Component, então tudo que sair desta função
    // vai para o navegador dentro do payload — visível em "ver código-fonte"
    // mesmo que nenhum pixel o desenhe. É exatamente o defeito que o funil
    // teve (`core/leads/queries.ts`), e a lição que ficou de lá é que a
    // barreira é o mapeamento, não a consulta nem o CSS.
    documento: incluirDocumento ? dados.documento : null,
    leads: leads.map((lead) => ({
      id: lead.id,
      canal: lead.canal,
      criadoEm: lead.criadoEm,
      etapaNome: lead.stage.nome,
      responsavelNome: lead.responsavel?.nome ?? "Sem responsável",
      arquivado: lead.arquivadoEm !== null,
    })),
  };
}
