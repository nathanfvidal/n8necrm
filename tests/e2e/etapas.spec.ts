import { test, expect, type Page } from "@playwright/test";

import { SESSAO_ADMIN } from "./credenciais";

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
function linhaDa(page: Page, nome: string) {
  return page.locator("tbody tr").filter({ hasText: nome });
}

/** Índice da linha que contém o nome, dentro do corpo da tabela de `/etapas`. */
async function posicaoNaTabela(page: Page, nome: string): Promise<number> {
  const linhas = await page.locator("tbody tr").allTextContents();
  return linhas.findIndex((texto) => texto.includes(nome));
}

// Sessão salva por `auth.setup.ts`, e não login por teste: o limite é 10
// tentativas por conta a cada 10 minutos, e estourá-lo derruba um teste
// distante por timeout. Ver `tests/e2e/credenciais.ts`.
test.use({ storageState: SESSAO_ADMIN });

// `mode: "serial"` serializa os testes DENTRO deste arquivo — não entre
// arquivos. A contenção contra `lead-to-won.spec.ts` é o desenho das etapas
// nascerem no fim, não isto.
test.describe.configure({ mode: "serial" });

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

  test("a etapa de fechamento não pode ser removida", async ({ page }) => {
    await page.goto("/etapas");

    // "Fechado", não "Fechamento": TODAS as outras linhas têm o botão "Marcar
    // como fechamento", e `hasText` é substring case-insensitive — um filtro
    // por "Fechamento" bate nas cinco linhas ao mesmo tempo (achado ao rodar
    // este teste). "Fechado" é só o nome da etapa, único nesta tabela.
    const linhaDeFechamento = linhaDa(page, "Fechado");
    await linhaDeFechamento.getByLabel("Remover etapa").click();

    // Campos do diálogo buscados DENTRO de `page.getByRole("dialog")`, nunca
    // soltos — `getByLabel` não respeita o `aria-hidden` que o Base UI aplica
    // no resto da página com o diálogo aberto (achado ao rodar o teste
    // anterior: bateu em mais de um campo). O diálogo já nasce com todo o
    // conteúdo (nada é buscado depois — os dados já vieram do servidor no
    // carregamento da página), então esperar ele aparecer garante que o
    // `<select>` condicional, se existir, já está no DOM.
    const dialogoRemover = page.getByRole("dialog");
    await expect(dialogoRemover).toBeVisible();

    // "Fechado" pode ter leads DE VERDADE neste banco compartilhado com
    // produção — nesse caso o diálogo exige um destino antes de habilitar o
    // botão de confirmar (`ExcluirEtapaDialogo`). A recusa que este teste
    // prova acontece no servidor, pelo `ehGanho` da etapa, ANTES de
    // qualquer checagem de destino (`excluirEtapa`, `core/pipeline/
    // service.ts`) — então qualquer opção válida serve só para habilitar o
    // botão e disparar a chamada.
    const selectDestino = dialogoRemover.getByLabel("Mover os leads para");
    if (await selectDestino.count()) {
      await selectDestino.selectOption({ index: 1 });
    }

    await dialogoRemover.getByRole("button", { name: "Remover etapa" }).click();

    // `[role="alert"]` sozinho bate em DOIS elementos: o alerta de erro da
    // tabela E o `#__next-route-announcer__` que o próprio Next injeta (mesmo
    // papel ARIA, usado para anunciar navegação a leitor de tela — vazio o
    // tempo todo aqui, já que não navegamos). `.filter({ hasText })` descarta
    // o announcer vazio e sobra só o alerta real.
    await expect(page.locator('[role="alert"]').filter({ hasText: /etapa de fechamento/i })).toBeVisible();
    // E ela continua lá: a recusa aconteceu antes de qualquer escrita.
    await expect(linhaDeFechamento).toBeVisible();
  });
});
