// Este arquivo toca o MESMO Postgres real que o app usa em dev (não há banco de
// teste isolado — ⚠️ R1 da auditoria do Ciclo 1a) e por isso cria seu próprio
// PrismaClient. NÃO importamos `@/lib/prisma`: esse módulo tem
// `import "server-only"`, que lança fora da condição de resolução
// "react-server" do Next — e o runner do Playwright é um processo Node comum.
// Mesmo padrão, e mesmo motivo, de `tests/e2e/lead-to-won.spec.ts`.
//
// O que este arquivo prova, e nenhum teste de unidade desta árvore pode:
//
// 1. **O mapeamento nome→fonte por empresa.** `next/font/google` LANÇA sob
//    Vitest (`Geist is not a function`, medido na Task 5), e por isso
//    `tests/unit/painel-layout-marca.test.tsx` mocka `@/lib/tema/fontes` por
//    inteiro. Com o mock no lugar, o que aquele arquivo mede é que o layout
//    CHAMA `fonteDaMarca` com o nome certo — não que `Manrope` chega ao
//    navegador como família de fonte de verdade.
// 2. **A cascata entre os DOIS blocos `<style>`.** O do layout raiz vai no
//    `<head>` com o padrão de `config/client.ts`; o do layout do painel vai no
//    `<body>` com a marca da empresa. A subárvore que o teste de unidade
//    renderiza não tem `<head>`, então a ordem entre os dois — que é o que
//    decide quem vence, já que os dois usam `:root:root` e têm a MESMA
//    especificidade (0,2,0) — só existe num documento completo.
//
// A regra usada é do CSS, mas a medição é de UM navegador: o Chromium do
// Playwright (único projeto em `playwright.config.ts`). Está registrado como
// NV4 do spec do Ciclo 1c.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { test, expect } from "@playwright/test";

import { client } from "../../config/client";
import { hexParaOklch } from "../../src/lib/tema/cor";
import { EMAIL_ADMIN_E2E, SESSAO_ADMIN } from "./credenciais";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

test.use({ storageState: SESSAO_ADMIN });

/**
 * `playwright.config.ts` declara `fullyParallel: true`, e isso vale também
 * DENTRO de um arquivo: sem esta linha, os casos abaixo iriam para workers
 * diferentes ao mesmo tempo. Todos eles escrevem na MESMA linha de
 * `CompanyConfig` — o caso do padrão do arquivo zera as colunas, os da marca
 * as preenchem —, então em paralelo um apagaria a precondição do outro e o
 * resultado dependeria de quem chegasse primeiro no banco. Serial é o que
 * torna cada precondição observável pelo caso que a declara.
 */
test.describe.configure({ mode: "serial" });

/**
 * Azul, bem longe do roxo `#6D4AFF` de `config/client.ts`, e com croma acima do
 * piso: `marcaSchema` RECUSA cinza (`CROMA_MINIMO`, `config/client.schema.ts`)
 * e a recusa apareceria como painel derrubado — `configDaEmpresa` não degrada,
 * lança `ConfigDaEmpresaInvalidaError` — em vez de asserção falhando.
 */
const COR_DA_EMPRESA = "#0F62FE";
const FONTE_DA_EMPRESA = "Manrope";

/**
 * Os dois matizes NÃO são digitados: saem de `hexParaOklch`, a mesma função que
 * `derivarTema` usa, aplicada de um lado à cor deste teste e de outro à cor que
 * está de fato em `config/client.ts` hoje.
 *
 * Isso existe porque a versão anterior deste arquivo afirmava uma FAIXA de
 * 240 a 285 graus, com o comentário "o roxo do arquivo fica acima de 285". O
 * número medido do roxo `#6D4AFF` é **283.658** — dentro da faixa. Ou seja: a
 * asserção passaria com o painel servindo a cor do ARQUIVO, exatamente o
 * defeito que ela existia para pegar. Medido em 2026-08-20 com
 * `node_modules/.bin/tsx` sobre `hexParaOklch`; `#0F62FE` dá 261.953.
 *
 * Derivar dos dois lados também torna a PREMISSA do arquivo verificável: se
 * alguém trocar a cor de `config/client.ts` por um azul vizinho deste, a
 * asserção de distância abaixo falha e diz o porquê, em vez de o arquivo virar
 * um teste que não testa nada.
 */
const MATIZ_DA_EMPRESA = hexParaOklch(COR_DA_EMPRESA).H;
const MATIZ_DO_ARQUIVO = hexParaOklch(client.marca.corPrimaria).H;
const FONTE_DO_ARQUIVO = client.marca.fonte;

/** O estado da linha antes deste arquivo mexer, para restaurar no fim. */
let empresaId: string;
let anterior: { corPrimaria: string | null; fonte: string | null } | null = null;
let linhaCriadaAqui = false;

/** Escreve (ou apaga, com `null`) a sobreposição de marca da empresa. */
async function gravarMarca(dados: { corPrimaria: string | null; fonte: string | null }) {
  await prisma.companyConfig.updateMany({ where: { companyId: empresaId }, data: dados });
}

/** Lê `--primary` COMPUTADA no `<html>` e devolve o matiz OKLCH. */
async function matizDaPrimaria(pagina: import("@playwright/test").Page): Promise<number> {
  const primaria = await pagina.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--primary").trim(),
  );

  expect(primaria.length, "--primary não foi definida no <html>").toBeGreaterThan(0);
  expect(primaria, `--primary não veio no formato de formatarOklch: ${primaria}`).toMatch(
    /^oklch\(/,
  );

  // `formatarOklch` (`src/lib/tema/cor.ts`) emite exatamente
  // `oklch(<L> <C> <H>)`, com três casas — é dele que vem a forma casada aqui.
  const matiz = Number(primaria.match(/^oklch\([^ ]+ [^ ]+ ([\d.]+)\)$/)?.[1]);
  expect(Number.isFinite(matiz), `matiz não pôde ser lido de ${primaria}`).toBe(true);
  return matiz;
}

/** Lê o `font-family` COMPUTADO no `<main>` do painel. */
async function familiaDoConteudo(pagina: import("@playwright/test").Page): Promise<string> {
  const familia = await pagina.evaluate(() => {
    const main = document.querySelector("main");
    return main ? getComputedStyle(main).fontFamily : "";
  });
  expect(familia.length, "não há <main> no painel, ou ele está sem font-family").toBeGreaterThan(0);
  return familia;
}

/** Conta os blocos de tema do documento — os `<style>` que o CRM injeta. */
function contarBlocosDeTema(pagina: import("@playwright/test").Page): Promise<number> {
  return pagina.evaluate(
    () =>
      [...document.querySelectorAll("style")]
        .map((s) => s.textContent ?? "")
        .filter((t) => t.includes(":root:root{")).length,
  );
}

test.beforeAll(async () => {
  // A empresa vem do VÍNCULO da conta que a suíte usa, não de um
  // `company.findFirst()`: é a empresa que `usuarioAtual()` resolve para essa
  // sessão (`src/core/auth/session.ts` lê `Membership`), e portanto a única
  // cuja config o painel desta sessão vai ler. Com `findFirst`, o dia em que
  // existir uma segunda empresa no banco de dev, este arquivo pintaria uma e
  // mediria a outra.
  const vinculo = await prisma.membership.findFirstOrThrow({
    where: { user: { email: EMAIL_ADMIN_E2E } },
    select: { companyId: true },
  });
  empresaId = vinculo.companyId;

  const existente = await prisma.companyConfig.findFirst({
    where: { companyId: empresaId },
    select: { corPrimaria: true, fonte: true },
  });

  if (existente) {
    anterior = existente;
  } else {
    linhaCriadaAqui = true;
    // `modulos` recebe os do ARQUIVO, não `[]`. A regra de `mesclarConfig`
    // (`src/core/config/schema.ts`) é explícita: "se a linha existe, `modulos`
    // dela manda, INCLUSIVE VAZIA". Uma linha com `[]` desligaria todos os
    // módulos da empresa enquanto este arquivo roda, e `exigirModulo` devolve
    // 404 — `/conversas`, `/conversas/[id]` e `/fluxos` cairiam, derrubando
    // specs que não têm nada a ver com marca.
    await prisma.companyConfig.create({
      data: { companyId: empresaId, modulos: [...client.modulos] },
    });
  }
});

test.afterAll(async () => {
  // Restaura EXATAMENTE o estado anterior. Deixar a cor de teste gravada no
  // banco de desenvolvimento é a mesma classe de resíduo que a auditoria do
  // Ciclo 1a mediu com as empresas e usuários órfãos de fixture — e aqui o
  // sintoma seria pior que uma linha sobrando: o painel de quem estivesse
  // usando o CRM na outra janela mudaria de cor sem explicação.
  //
  // `try/finally` porque `$disconnect` precisa acontecer mesmo se a restauração
  // falhar; sem ele, um erro aqui deixaria a conexão pendurada e o runner do
  // Playwright não encerraria.
  try {
    if (linhaCriadaAqui) {
      await prisma.companyConfig.deleteMany({ where: { companyId: empresaId } });
    } else if (anterior) {
      await gravarMarca(anterior);
    }
  } finally {
    await prisma.$disconnect();
  }
});

test.describe("marca por empresa", () => {
  // A SEGUNDA METADE da prova, e ela vem primeiro de propósito: sem um caso que
  // exercite a empresa SEM sobreposição, "não aplicar marca nenhuma" passaria
  // por toda a suíte abaixo desde que a cor do arquivo casasse. Este caso é o
  // que fixa o ponto de partida contra o qual os seguintes medem uma MUDANÇA.
  test("sem sobreposição, o painel cai no padrão do arquivo", async ({ page }) => {
    await gravarMarca({ corPrimaria: null, fonte: null });
    await page.goto("/");

    expect(
      Math.abs(MATIZ_DA_EMPRESA - MATIZ_DO_ARQUIVO),
      `a premissa deste arquivo caiu: a cor de config/client.ts (${client.marca.corPrimaria}, ` +
        `matiz ${MATIZ_DO_ARQUIVO.toFixed(3)}) ficou perto demais da cor deste teste ` +
        `(${COR_DA_EMPRESA}, matiz ${MATIZ_DA_EMPRESA.toFixed(3)}). Escolha outra cor de teste.`,
    ).toBeGreaterThan(10);

    expect(await matizDaPrimaria(page)).toBeCloseTo(MATIZ_DO_ARQUIVO, 2);
    expect(await familiaDoConteudo(page)).toContain(FONTE_DO_ARQUIVO);

    // DOIS blocos mesmo sem sobreposição, e isso não é contradição com o caso
    // de `/login` abaixo: o painel emite o bloco dele sempre que há sessão, e
    // `mesclarConfig` já resolveu o conteúdo — colunas nulas caem no padrão do
    // arquivo campo a campo. O que muda com a sobreposição é o VALOR dentro do
    // segundo bloco, não a existência dele.
    expect(await contarBlocosDeTema(page)).toBe(2);
  });

  test("a cor da empresa vence o padrão do arquivo no `<html>`", async ({ page }) => {
    await gravarMarca({ corPrimaria: COR_DA_EMPRESA, fonte: FONTE_DA_EMPRESA });
    await page.goto("/");

    // `--primary` é `marca` sem alteração de matiz — `derivarPaleta`
    // (`src/lib/tema/paleta.ts`) copia `H` da marca para `primary` nos dois
    // temas e só põe PISO em `L` no escuro. Por isso o matiz é a identidade da
    // cor de origem, e não um número que qualquer ajuste de paleta mudaria: a
    // asserção é apertada de propósito.
    //
    // Medir o valor COMPUTADO no `<html>` é o que prova a cascata. Os dois
    // blocos casam o MESMO elemento com a MESMA especificidade; o do painel só
    // vence ali por estar depois no documento.
    expect(await matizDaPrimaria(page)).toBeCloseTo(MATIZ_DA_EMPRESA, 2);
  });

  test("o documento tem DOIS blocos `:root:root` — o do arquivo e o da empresa", async ({
    page,
  }) => {
    await gravarMarca({ corPrimaria: COR_DA_EMPRESA, fonte: FONTE_DA_EMPRESA });
    await page.goto("/");

    // Um só significaria que o painel não emitiu o dele — e a asserção de cor
    // acima poderia estar verde por outro caminho (alguém movendo a leitura da
    // marca para o layout raiz, por exemplo), sem que a cascata que este
    // arquivo existe para medir estivesse acontecendo.
    expect(await contarBlocosDeTema(page)).toBe(2);
  });

  test("a fonte da empresa chega ao conteúdo do painel", async ({ page }) => {
    await gravarMarca({ corPrimaria: COR_DA_EMPRESA, fonte: FONTE_DA_EMPRESA });
    await page.goto("/");

    expect(
      FONTE_DA_EMPRESA,
      "a fonte deste teste é a mesma de config/client.ts — o caso não mede nada",
    ).not.toBe(FONTE_DO_ARQUIVO);

    const familia = await familiaDoConteudo(page);

    // `next/font` gera um nome de família próprio por chamada (algo como
    // `__Manrope_<hash>`), então a asserção é por SUBSTRING e não por igualdade.
    //
    // Sem a classe `font-sans` no elemento de conteúdo do painel, o
    // `font-family` computado aqui seria o herdado do `<html>` — que já
    // resolveu `var(--font-marca)` com o valor do arquivo — e traria
    // `FONTE_DO_ARQUIVO`. É a falha silenciosa descrita em
    // `(painel)/layout.tsx`: a tela continua bonita, com a fonte errada.
    expect(familia).toContain(FONTE_DA_EMPRESA);
    expect(familia).not.toContain(FONTE_DO_ARQUIVO);
  });

  test("a tela de login NÃO usa a marca da empresa", async ({ browser }) => {
    await gravarMarca({ corPrimaria: COR_DA_EMPRESA, fonte: FONTE_DA_EMPRESA });

    // Contexto sem sessão: `/login` fica fora de `(painel)` (mora em
    // `src/app/login/page.tsx`), então o layout do painel não roda e não há
    // empresa para consultar. É o ovo-e-galinha do desenho, e este caso é o que
    // impede alguém de "consertar" isso movendo a leitura para a raiz — mover
    // faria aparecer um segundo bloco aqui e o número abaixo mudaria.
    //
    // `storageState: undefined` EXPLÍCITO, e isto não é redundância.
    //
    // Dentro de um teste, a fixture `browser` do Playwright é embrulhada: as
    // opções de `test.use` deste arquivo — a sessão do admin — entram também no
    // `browser.newContext()` sem argumento. Medido em 2026-08-20 neste projeto:
    // com `newContext()` vazio, `page.url()` depois de `goto("/login")` era
    // `http://localhost:3000/` (a página de login manda quem já tem sessão para
    // o painel) e o documento trazia DOIS blocos. Ou seja, o caso media o
    // painel achando que media o login.
    const contexto = await browser.newContext({ storageState: undefined });
    try {
      const pagina = await contexto.newPage();
      await pagina.goto("/login");

      // A URL faz parte da asserção pelo mesmo motivo: se um dia o contexto
      // voltar a nascer com sessão, este caso precisa falhar dizendo QUE página
      // ele mediu, em vez de contar blocos da tela errada.
      expect(new URL(pagina.url()).pathname, "o contexto não estava anônimo").toBe("/login");

      expect(await contarBlocosDeTema(pagina)).toBe(1);
    } finally {
      await contexto.close();
    }
  });
});
