// Mesmo motivo de `tests/e2e/equipe.spec.ts` e `tests/e2e/lead-to-won.spec.ts`
// para ter um `PrismaClient` PRÓPRIO aqui (não `@/lib/prisma`, que tem
// `import "server-only"` e quebraria fora do pipeline de build do Next): a
// limpeza por prefixo abaixo precisa falar com o banco fora do navegador.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { test, expect, type Page } from "@playwright/test";

import { SESSAO_ADMIN } from "./credenciais";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

/**
 * Este arquivo toca o MESMO Postgres real e compartilhado que o app usa, e roda
 * em PARALELO com os outros arquivos de e2e (`fullyParallel: true`,
 * `workers: 3`, `playwright.config.ts`).
 *
 * Por isso ele nunca escreve numa etapa que não criou. As duas etapas abaixo
 * nascem no FIM do funil (`ordem = max + 1`, `criarEtapa` em
 * `core/pipeline/service.ts`), e a troca ↑/↓ acontece entre elas — nunca com
 * "Fechado". Uma troca com "Fechado" mudaria a adjacência Proposta↔Fechado de
 * que `lead-to-won.spec.ts` depende (`arrastarComTeclado` anda uma coluna por
 * toque), e o quebraria de forma intermitente enquanto os dois arquivos
 * rodassem juntos — exatamente a assinatura de defeito que motivou a regra de
 * auditoria do `AGENTS.md`.
 *
 * O sufixo aleatório evita colisão de nome entre duas execuções simultâneas —
 * o serviço recusa nome repetido (`recusarNomeRepetido`, `core/pipeline/service.ts`).
 */
const SUFIXO = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const PRIMEIRA = `ZZ E2E Alfa ${SUFIXO}`;
const SEGUNDA = `ZZ E2E Beta ${SUFIXO}`;

/** Prefixo comum às duas etapas acima — inclusive depois de renomeadas (o teste só acrescenta " renomeada"). */
const PREFIXO_ETAPA = "ZZ E2E";

/**
 * Apaga, por PREFIXO, as etapas que este arquivo cria — e o AuditLog que
 * aponta para elas. Roda antes (varre resíduo de uma execução anterior que
 * tenha travado no meio do teste, antes do `for` que remove as duas no fim)
 * e depois (limpa o que esta execução criou), mesmo padrão de
 * `tests/e2e/equipe.spec.ts`/`tests/e2e/lead-to-won.spec.ts`.
 *
 * Sem isto, uma asserção quebrada no meio do teste deixava "ZZ E2E Alfa
 * <ts>"/"ZZ E2E Beta <ts>" no funil de PRODUÇÃO — visíveis no kanban, no
 * painel, no `<select>` de etapa de todo lead — e o estrago é silencioso:
 * com mais de 5 etapas `seed-demo.test.ts` passa a pular testes para sempre.
 *
 * `PipelineStage.id` tem `ON DELETE RESTRICT` em `Lead.stageId` — uma etapa
 * só pode ser apagada se nenhum lead a referenciar. Este arquivo nunca
 * deveria deixar lead nenhum numa etapa "ZZ E2E ..." (nenhum teste aqui cria
 * lead), mas se uma execução anterior travou de um jeito que deixasse um
 * lead preso a uma delas, a limpeza move esses leads para a PRIMEIRA etapa
 * do funil (por `ordem`, excluindo as próprias etapas "ZZ E2E") antes de
 * apagar — em vez de travar para sempre na chave estrangeira.
 */
async function limparDadosDeTeste(): Promise<void> {
  const etapas = await prisma.pipelineStage.findMany({
    where: { nome: { startsWith: PREFIXO_ETAPA } },
    select: { id: true },
  });
  if (etapas.length === 0) return;
  const ids = etapas.map((etapa) => etapa.id);

  const leadsPresos = await prisma.lead.count({ where: { stageId: { in: ids } } });
  if (leadsPresos > 0) {
    const primeiraEtapaDoFunil = await prisma.pipelineStage.findFirstOrThrow({
      where: { id: { notIn: ids } },
      orderBy: { ordem: "asc" },
    });
    await prisma.lead.updateMany({
      where: { stageId: { in: ids } },
      data: { stageId: primeiraEtapaDoFunil.id },
    });
  }

  await prisma.auditLog.deleteMany({ where: { entidade: "PipelineStage", entidadeId: { in: ids } } });
  await prisma.pipelineStage.deleteMany({ where: { id: { in: ids } } });
}

/**
 * Linha da tabela pelo nome, por seletor de DOM (`tbody tr`) — não
 * `page.getByRole("row")`.
 *
 * Enquanto um diálogo modal está aberto (Editar, Remover), o Base UI aplica
 * `aria-hidden` em tudo que fica FORA da árvore do diálogo — inclusive a
 * tabela inteira (`FloatingFocusManager`, node_modules/@base-ui/react/
 * floating-ui-react/components/FloatingFocusManager.mjs: "Hide everything
 * outside the floating tree from assistive tech while open"). Um seletor por
 * PAPEL não encontra a linha nesse estado, mesmo com ela visível na tela — só
 * o seletor de DOM atravessa isso.
 */
/**
 * A linha da tabela QUE ESTÁ NA TELA.
 *
 * O `visible: true` não é zelo: sem ele este teste quebra por modo estrito
 * logo depois de um `page.goto("/etapas")`, com a mensagem "resolved to 2
 * elements" apontando para um segundo `<tbody>` dentro de `[id="S:0"]`.
 *
 * A causa é o `(painel)/loading.tsx`. Ele cria uma fronteira de `<Suspense>`,
 * e com ela o SSR passa a fazer streaming: o React entrega o conteúdo dentro
 * de um `<div hidden>` e um script inline o move para o lugar. Na janela
 * entre a entrega e a troca — sub-milissegundo numa máquina ociosa, larga o
 * bastante com a suíte em três workers — a tabela existe DUAS vezes no DOM.
 *
 * Nenhuma delas é bug de aplicação: a cópia extra nasce dentro de `hidden` e
 * nunca é vista por ninguém. Mas violação de modo estrito é erro imediato no
 * Playwright, não algo que ele espere passar, então o localizador precisa
 * dizer o que sempre quis dizer — a linha visível. Se outro spec começar a
 * falhar com "resolved to 2 elements" depois de um `goto`, a causa é esta.
 */
function linhaDa(page: Page, nome: string) {
  return page.locator("tbody tr").filter({ visible: true }).filter({ hasText: nome });
}

/**
 * Índice da linha que contém o nome, dentro do corpo da tabela de `/etapas`.
 *
 * Lança se não encontrar, em vez de devolver `-1`: `findIndex` devolve `-1`
 * quando não acha nada, e `expect(-1).toBeLessThan(n)` passa para QUALQUER
 * `n` — as duas asserções que usam esta função são justamente as que provam
 * a contenção contra `lead-to-won.spec.ts` (que "Fechado" nunca troca de
 * vizinha enquanto este arquivo roda). Sem isto, renomear "Fechado" faria
 * essas asserções pararem de provar qualquer coisa sem NUNCA ficar vermelhas.
 */
async function posicaoNaTabela(page: Page, nome: string): Promise<number> {
  const linhas = await page.locator("tbody tr").allTextContents();
  const indice = linhas.findIndex((texto) => texto.includes(nome));
  if (indice === -1) {
    throw new Error(`Nenhuma linha contendo "${nome}" foi encontrada na tabela de /etapas.`);
  }
  return indice;
}

// Sessão salva por `auth.setup.ts`, e não login por teste: o limite é 10
// tentativas por conta a cada 10 minutos, e estourá-lo derruba um teste
// distante por timeout. Ver `tests/e2e/credenciais.ts`.
test.use({ storageState: SESSAO_ADMIN });

// `mode: "serial"` serializa os testes DENTRO deste arquivo — não entre
// arquivos. A contenção contra `lead-to-won.spec.ts` é o desenho das etapas
// nascerem no fim, não isto.
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await limparDadosDeTeste();
});

test.afterAll(async () => {
  await limparDadosDeTeste();
  await prisma.$disconnect();
});

test.describe("gestão de etapas do funil", () => {
  test("cria, renomeia, reordena e remove — sem tocar nas etapas semeadas", async ({ page }) => {
    await page.goto("/etapas");

    // ─── criar as duas ─────────────────────────────────────────────────
    for (const nome of [PRIMEIRA, SEGUNDA]) {
      await page.getByLabel("Nome da etapa").fill(nome);
      await page.getByRole("button", { name: "Adicionar etapa" }).click();
      await expect(linhaDa(page, nome)).toBeVisible();
    }

    // ─── as duas nasceram no fim, nesta ordem ──────────────────────────
    expect(await posicaoNaTabela(page, PRIMEIRA)).toBeLessThan(
      await posicaoNaTabela(page, SEGUNDA)
    );
    // E nasceram DEPOIS de todas as semeadas — é o que mantém a adjacência
    // Proposta↔Fechado, de que `lead-to-won.spec.ts` depende.
    expect(await posicaoNaTabela(page, "Fechado")).toBeLessThan(
      await posicaoNaTabela(page, PRIMEIRA)
    );

    // ─── renomear ──────────────────────────────────────────────────────
    // `getByLabel`, ao contrário de `getByRole`, NÃO respeita o `aria-hidden`
    // que o Base UI aplica no resto da página enquanto o diálogo está aberto
    // (confirmado rodando este teste: `getByLabel("Nome")` sem escopo bateu
    // em DOIS campos — o "Nome" do diálogo e o "Nome da etapa" do formulário
    // de criar, que continua no DOM atrás do diálogo). Por isso todo campo de
    // diálogo aqui é buscado DENTRO de `page.getByRole("dialog")`, nunca solto.
    const RENOMEADA = `${PRIMEIRA} renomeada`;
    await linhaDa(page, PRIMEIRA).getByLabel("Editar etapa").click();
    const dialogoEditar = page.getByRole("dialog");
    await dialogoEditar.getByLabel("Nome").fill(RENOMEADA);
    await dialogoEditar.getByRole("button", { name: "Salvar" }).click();
    await expect(linhaDa(page, RENOMEADA)).toBeVisible();

    // ─── subir a ÚLTIMA: a troca é entre as duas etapas deste teste ────
    await linhaDa(page, SEGUNDA).getByLabel("Subir etapa").click();
    await expect
      .poll(async () => (await posicaoNaTabela(page, SEGUNDA)) < (await posicaoNaTabela(page, RENOMEADA)))
      .toBe(true);

    // "Fechado" continua onde estava: a troca escreveu só as duas linhas que
    // este teste criou.
    expect(await posicaoNaTabela(page, "Fechado")).toBeLessThan(
      await posicaoNaTabela(page, SEGUNDA)
    );

    // ─── e descer de volta ─────────────────────────────────────────────
    await linhaDa(page, SEGUNDA).getByLabel("Descer etapa").click();
    await expect
      .poll(async () => (await posicaoNaTabela(page, RENOMEADA)) < (await posicaoNaTabela(page, SEGUNDA)))
      .toBe(true);

    // ─── o painel mostra um cartão por etapa, com o funil maior ────────
    // A única coisa nesta branch que exercita um funil de tamanho diferente na
    // tela onde todo mundo entra primeiro. Barato porque as etapas extras já
    // existem por outro motivo.
    //
    // O total é lido ANTES de navegar. Ler depois exigiria voltar para
    // `/etapas` no meio da asserção, e aí o número comparado não seria mais o
    // da tela que está aberta. `tbody tr` já exclui o cabeçalho — sem o `-1`
    // que um `getByRole("row")` precisaria.
    const totalDeEtapas = await page.locator("tbody tr").count();
    await page.goto("/");
    await expect(page.getByTestId("cartao-de-etapa")).toHaveCount(totalDeEtapas);

    // ─── remover as duas ───────────────────────────────────────────────
    await page.goto("/etapas");
    for (const nome of [SEGUNDA, RENOMEADA]) {
      await linhaDa(page, nome).getByLabel("Remover etapa").click();
      await page.getByRole("dialog").getByRole("button", { name: "Remover etapa" }).click();
      await expect(linhaDa(page, nome)).toHaveCount(0);
    }
  });

  // O teste "a etapa de fechamento não pode ser removida" que morava aqui foi
  // REMOVIDO de propósito — não corrigido para parar antes do clique.
  //
  // Ele selecionava um destino e confirmava a exclusão da etapa "Fechado" DE
  // PRODUÇÃO. Passava hoje só porque `excluirEtapa` (`core/pipeline/
  // service.ts`) recusa antes de escrever. Se essa guarda regredisse, o
  // próprio teste executaria a destruição: moveria todos os leads reais de
  // "Fechado" para uma etapa arbitrária e apagaria a etapa, no MESMO Postgres
  // compartilhado com produção que o resto deste arquivo evita tocar (ver o
  // comentário no topo).
  //
  // A propriedade que ele provava já está provada DUAS vezes, sem tocar em
  // nenhuma linha real:
  // - `tests/unit/pipeline-service.test.ts` ("recusa apagar a etapa de
  //   fechamento") — contra o Postgres real, mas contra uma etapa `ZZ Teste`
  //   criada e apagada pelo próprio teste, nunca "Fechado".
  // - `tests/unit/pipeline-transacoes.test.ts` ("recusa apagar a etapa de
  //   fechamento, antes de qualquer escrita") — com Prisma MOCKADO, provando
  //   que a recusa acontece ANTES de `$transaction` ser sequer chamado.
  //
  // Mesmo raciocínio já aplicado uma vez nesta branch (Tarefa 8): a sabotagem
  // equivalente contra a guarda de exclusão foi trocada por prova com Prisma
  // mockado exatamente para não correr este risco. Repeti-la aqui, contra o
  // banco real, reintroduziria o problema que aquela decisão fechou — só que
  // com o raio de explosão de uma regressão não detectada a tempo sendo a
  // etapa de fechamento real do funil de produção.
});
