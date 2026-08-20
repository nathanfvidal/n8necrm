/**
 * A tela de conexões, de ponta a ponta.
 *
 * O que só um navegador prova, e por isso está aqui e não num teste de
 * unidade: que o valor digitado na apikey **não aparece no HTML servido**
 * depois de salvo, e que quem não é ADMIN não alcança a rota.
 *
 * A conexão criada aqui é apagada no `afterEach`, **por nome com prefixo
 * exclusivo**: o banco é o mesmo de desenvolvimento (⚠️ R1 da auditoria do
 * Ciclo 1a), e a auditoria do Ciclo 1c mediu fixture órfã envenenando execução
 * seguinte (⚠️ N2). A limpeza é pela própria tela, não por SQL, para que ela
 * também exercite o caminho de apagar — e um `afterAll` por SQL fica atrás
 * dela como rede, para o caso de a execução morrer com a tela pelo meio
 * (`finally` não roda em timeout; `afterAll` do Playwright roda mesmo com
 * teste vermelho).
 *
 * ## Por que o teste DESATIVA a conexão antes do fim
 *
 * Duas conexões ATIVAS na mesma empresa fazem `credencialAtivaUnica`
 * (`core/conexoes/leitura.ts`) recusar em vez de escolher — é o desenho, e é
 * certo. Só que a empresa de desenvolvimento pode já ter a sua, e esta suíte
 * divide o banco com quem estiver usando o CRM na outra janela. Desativar
 * antes de apagar encurta a janela em que existe uma segunda ativa, e de
 * quebra é a única cobertura e2e do botão Ativar/Desativar.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { test, expect } from "@playwright/test";

import { SESSAO_ADMIN, SESSAO_VENDEDOR } from "./credenciais";

// PrismaClient próprio, e não `@/lib/prisma` — aquele tem `import "server-only"`
// e quebraria fora do pipeline de build do Next. Mesmo padrão de
// `whatsapp-agente.spec.ts` e `lead-to-won.spec.ts`.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

// Prefixo exclusivo deste arquivo. `WhatsappConnection.nome` não tem
// unicidade, então o sufixo de tempo não existe para evitar colisão de
// constraint: existe para que a limpeza de uma execução não apague a linha de
// um worker vizinho (`test.beforeAll` roda uma vez POR WORKER — ver o
// comentário de `carimbarExecucao` em `global-setup.ts`).
const PREFIXO = "ZZE2EConexao-";
const NOME = `${PREFIXO}${process.env.E2E_ID_EXECUCAO ?? "00"}-${Date.now()}`;
const APIKEY = "apikey-de-teste-descartavel-9z8y";

test.describe("Configurações → Conexões", () => {
  test.use({ storageState: SESSAO_ADMIN });

  test("ADMIN cadastra, vê a máscara, substitui a chave e a máscara muda", async ({ page }) => {
    await page.goto("/configuracoes/conexoes");

    // `exact: true` porque "Nome" é prefixo de "Nome da instância": sem isso o
    // seletor casa com dois campos e o Playwright falha por ambiguidade, num
    // erro que parece problema de rótulo e é de seletor.
    await page.getByLabel("Nome", { exact: true }).fill(NOME);
    await page.getByLabel("Domínio da instância").fill("https://evolution.exemplo.invalid");
    await page.getByLabel("Nome da instância").fill(NOME);
    await page.getByLabel("Chave de API (apikey)").fill(APIKEY);
    await page.getByRole("button", { name: "Cadastrar conexão" }).click();

    // A URL do webhook aparece UMA vez, com a origem do navegador na frente.
    const url = page.getByTestId("url-webhook");
    await expect(url).toBeVisible();
    await expect(url).toContainText("/api/whatsapp/evolution/");

    const linha = page.getByRole("row", { name: new RegExp(NOME) });
    await expect(linha).toContainText("••••••••9z8y");

    // O HTML servido NÃO contém a apikey. É a prova de que a máscara é montada
    // no servidor a partir da coluna de 4 caracteres, e não recortada de um
    // valor real que tivesse viajado até aqui.
    await page.reload();
    expect(await page.content()).not.toContain(APIKEY);

    // A URL do webhook também não volta numa leitura: o servidor guardou só o
    // sha256 dela. Depois do recarregamento, o aviso não existe mais.
    await expect(page.getByTestId("url-webhook")).toHaveCount(0);

    const linhaRecarregada = page.getByRole("row", { name: new RegExp(NOME) });
    await linhaRecarregada.getByRole("button", { name: "Substituir chave" }).click();
    await page.getByLabel("Chave nova").fill("apikey-substituida-4c3d");
    await page.getByRole("button", { name: "Substituir", exact: true }).click();

    await expect(page.getByRole("row", { name: new RegExp(NOME) })).toContainText("••••••••4c3d");

    await page
      .getByRole("row", { name: new RegExp(NOME) })
      .getByRole("button", { name: "Desativar" })
      .click();
    await expect(page.getByRole("row", { name: new RegExp(NOME) })).toContainText("Inativa");
  });

  test.afterEach(async ({ page }) => {
    // Limpeza pela própria tela — exercita o caminho de apagar e não deixa
    // resíduo no banco compartilhado.
    await page.goto("/configuracoes/conexoes");
    const linha = page.getByRole("row", { name: new RegExp(NOME) });
    if ((await linha.count()) === 0) return;
    await linha.getByRole("button", { name: "Apagar" }).click();
    // O rótulo é o que `ConfirmarDialogo` monta para `exigirDigitar`:
    // "Digite <nome> para confirmar".
    await page.getByLabel(/digite/i).fill(NOME);
    await page.getByRole("button", { name: "Apagar conexão" }).click();
    await expect(page.getByRole("row", { name: new RegExp(NOME) })).toHaveCount(0);
  });

  test.afterAll(async () => {
    // Rede de segurança para o caso de a tela não ter chegado ao fim. Apaga só
    // o nome DESTA execução — resíduo de outra ficaria com outro sufixo, e
    // apagá-lo poderia derrubar um worker vizinho ainda em uso.
    await prisma.whatsappConnection.deleteMany({ where: { nome: NOME } });
    await prisma.$disconnect();
  });
});

test.describe("quem não é ADMIN", () => {
  test.use({ storageState: SESSAO_VENDEDOR });

  test("VENDEDOR não alcança /configuracoes/conexoes", async ({ page }) => {
    await page.goto("/configuracoes/conexoes");
    // `redirect("/")`, não 404: quem clicou num link antigo entende melhor
    // voltar ao painel. A defesa de verdade são as Server Actions.
    await expect(page).toHaveURL(/\/$/);
  });

  test("VENDEDOR também não vê o item de menu, e /configuracoes não abre seção", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Configurações" })).toHaveCount(0);

    await page.goto("/configuracoes");
    await expect(page).toHaveURL(/\/$/);
  });
});
