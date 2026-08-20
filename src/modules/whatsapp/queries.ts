import "server-only";

import { prismaDaEmpresa } from "@/core/tenancy/escopo";

/**
 * Consultas de leitura para a inbox de conversas (`(painel)/conversas`).
 * Vivem em `src/modules/whatsapp` (não em `core/`, mesma fronteira
 * arquitetural do resto do módulo) — não há regra de negócio aqui, só shape
 * de leitura para a UI.
 *
 * ## Por que `companyId` entra na assinatura das três (Ciclo 1d)
 *
 * `Conversation` É modelo de tenant (`core/tenancy/escopo.ts`), e nenhuma das
 * três consultas filtrava por empresa. A anotação da fila em
 * `eslint.config.mjs` contava três defeitos aqui, dois deles ALTA:
 * `listarConversas` fazia `findMany` sem `where` de empresa (a inbox era
 * global) e `buscarConversaComMensagens` fazia `findUnique` pelo id que vem
 * da rota `/conversas/[id]`, devolvendo a thread INTEIRA de qualquer empresa
 * a quem soubesse o id. `listarConversasDoContato` completava a cadeia pelo
 * `contactId`.
 *
 * O `companyId` viaja como PARÂMETRO POSICIONAL, e é o primeiro — mesmo
 * padrão de `core/leads/queries.ts` e `core/pipeline/stages.ts`. Como
 * primeiro parâmetro obrigatório, toda chamada existente parou de compilar e
 * precisou ser revisitada; como campo opcional, uma chamada antiga
 * continuaria compilando sem escopo nenhum e o compilador ficaria calado
 * exatamente onde o silêncio custa caro. Nada de `AsyncLocalStorage`: ele
 * vale até o primeiro caminho que roda fora do ciclo de requisição (job de
 * fila, seed, script), que é onde este módulo mora.
 *
 * A origem do valor nas páginas é `usuarioAtualOuLogin().companyId`
 * (`core/auth/usuario-ativo.ts`) — nunca `prisma.company.findFirst()`, nunca
 * um parâmetro de rota ou de formulário.
 */

/**
 * Lista conversas DA EMPRESA para a tela de inbox, com quem aguarda humano no
 * topo (mais antiga espera primeiro — a que mais precisa de atenção) e o
 * resto por atividade recente, com a última mensagem (qualquer direção) para
 * a prévia.
 *
 * `nulls: "last"` explícito: o padrão do Postgres em `ASC` já manda nulos
 * para o fim, então omitir funcionaria — por acaso. Escrito explícito para
 * não depender desse acaso: no dia em que alguém trocar para `desc` (nulos
 * viram primeiro por padrão), a falha seria silenciosa — conversas sem
 * espera subiriam ao topo e esconderiam exatamente as que esperam.
 *
 * `take: 100` — mesmo raciocínio de teto simples que outras listagens deste
 * projeto (ex.: export/leads/route.ts): sem sinal real de volume que
 * justifique paginação ainda nesta fatia; quando isso mudar, a correção é
 * paginação de verdade, não um teto maior.
 *
 * O teto e o escopo se cruzam de um jeito que vale registrar: enquanto a
 * consulta era global, o `take: 100` era gasto com conversa de qualquer
 * empresa — uma inbox podia ficar TRUNCADA por movimento de outro cliente.
 * O escopo conserta os dois lados de uma vez.
 *
 * O `include` desce intacto até o motor (o escopo não filtra leitura
 * aninhada — ver "Leitura ANINHADA" em `core/tenancy/escopo.ts`), e aqui isso
 * não abre porta: `contact` e `mensagens` são relações a partir da linha de
 * `Conversation` já escopada, e nenhuma das duas atravessa `User`, que é o
 * modelo sem `companyId` por onde a leitura aninhada sai do tenant.
 */
export async function listarConversas(companyId: string) {
  return prismaDaEmpresa(companyId).conversation.findMany({
    orderBy: [
      { aguardandoHumanoDesde: { sort: "asc", nulls: "last" } },
      { atualizadoEm: "desc" },
    ],
    take: 100,
    include: {
      contact: { select: { id: true, nome: true } },
      mensagens: {
        orderBy: { criadoEm: "desc" },
        take: 1,
      },
    },
  });
}

export type ConversaComUltimaMensagem = Awaited<ReturnType<typeof listarConversas>>[number];

/**
 * Busca uma conversa DA EMPRESA e todas as suas mensagens (mais antiga
 * primeiro, ordem de leitura natural de um thread) para a tela de detalhe.
 * `null` quando o id não existe **ou é de outra empresa** — a página decide
 * chamar `notFound()`, e os dois casos merecem a mesma resposta: quem pede
 * uma conversa que não é dele não tem por que saber se ela existe.
 *
 * `findFirst`, e não `findUnique`: o escopo RECUSA `findUnique` (o `where`
 * dela só aceita campo único, e `companyId` não é único em `Conversation` —
 * ver "Recusa, lançando" em `core/tenancy/escopo.ts`). O `id` continua sendo
 * chave primária, então a consulta devolve no máximo uma linha; o que muda é
 * que o `companyId` do escopo entra em AND com ela.
 *
 * Inclui `iaPausadaPor` para a tela mostrar QUEM pausou a IA, não só que ela
 * está pausada — ver `ConversaEstadoIa`. Esse `include` toca `User`, que não
 * é modelo de tenant, mas o `select` para nos campos escalares dele (`id`,
 * `nome`) e não desce para nenhuma relação inversa — que é o caminho pelo
 * qual a leitura aninhada sai do tenant (`core/tenancy/escopo.ts`).
 */
export async function buscarConversaComMensagens(companyId: string, id: string) {
  return prismaDaEmpresa(companyId).conversation.findFirst({
    where: { id },
    include: {
      contact: { select: { id: true, nome: true } },
      iaPausadaPor: { select: { id: true, nome: true } },
      mensagens: { orderBy: { criadoEm: "asc" } },
    },
  });
}

export type ConversaComMensagens = NonNullable<Awaited<ReturnType<typeof buscarConversaComMensagens>>>;

/**
 * Conversas DA EMPRESA para um contato, para a tela de detalhe da agenda
 * (`/contatos/[id]`).
 *
 * Mora AQUI, no módulo, e não em `core/contacts/queries.ts`, mesmo sendo a
 * agenda quem consome: `Conversation` é conceito do módulo `whatsapp`, e
 * `src/core` não pode conhecê-lo (regra de ESLint, § 3.3 da spec base). A
 * página de detalhe vive em `src/app/`, que pode importar dos dois lados — e
 * só chama esta função quando `moduloAtivo("whatsapp")`, então num fork com o
 * módulo desligado a tabela nem é consultada.
 *
 * ## O elo do meio de uma cadeia que ainda não fechou inteira
 *
 * O `contactId` chega de `buscarContatoComHistorico`
 * (`core/contacts/queries.ts`), que faz `findUnique` pelo id da rota
 * `/contatos/[id]` e ainda **não** confere empresa — está na fila do lint
 * como o próximo bloco de conversão. Enquanto isso, o escopo aqui compõe em
 * AND: um `contactId` de outra empresa devolve lista VAZIA em vez das
 * conversas dela. Isto é o que este arquivo pode fazer sozinho, e é
 * exercitado em `tests/unit/whatsapp-isolamento.test.ts`; o cabeçalho e os
 * DADOS do contato continuam vazando por `contacts/` até aquele bloco rodar.
 *
 * `nomeExibicao` pode ser nulo (a Evolution nem sempre manda o nome do
 * perfil); quem renderiza cai para o telefone ou o `waId`, mesma cadeia da
 * inbox.
 */
export async function listarConversasDoContato(companyId: string, contactId: string) {
  return prismaDaEmpresa(companyId).conversation.findMany({
    where: { contactId },
    orderBy: { atualizadoEm: "desc" },
    select: {
      id: true,
      waId: true,
      telefone: true,
      nomeExibicao: true,
      iaAtiva: true,
      atualizadoEm: true,
    },
  });
}

export type ConversaDoContato = Awaited<ReturnType<typeof listarConversasDoContato>>[number];
