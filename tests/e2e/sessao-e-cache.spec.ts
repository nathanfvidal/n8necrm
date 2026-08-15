import { test, expect } from "@playwright/test";

import { EMAIL_ADMIN_E2E, senhaE2e } from "./credenciais";

/**
 * O cache de cliente não sobrevive ao logout.
 *
 * ## Por que este arquivo existe
 *
 * `next.config.ts` liga `experimental.staleTimes.dynamic: 30`: uma aba
 * visitada nos últimos 30 segundos volta do cache do navegador, sem tocar no
 * servidor. É o que torna a troca de aba instantânea — e é exatamente o tipo
 * de mecanismo capaz de ressuscitar, por outro caminho, o defeito que este
 * projeto já teve: um logout que um prefetch de `<Link>` desfazia, com o
 * Auth.js reemitindo o cookie de sessão (AGENTS.md, e a tabela de armadilhas
 * da skill de auditoria em *"Sessão que sobrevive"*).
 *
 * A pergunta que isto responde é concreta: numa revenda com computador
 * compartilhado, alguém clica em "Sair", levanta, e a próxima pessoa aperta o
 * botão voltar. O que aparece?
 *
 * ## Login próprio, sem `storageState`
 *
 * Este teste PRECISA deslogar de verdade, e o `storageState` é um arquivo
 * compartilhado por toda a suíte (`auth.setup.ts`). Deslogar a partir dele
 * não corromperia o arquivo — ele é lido, não reescrito — mas o login aqui é
 * o objeto do teste, não um pré-requisito, mesma razão de `auth.spec.ts` e
 * `equipe.spec.ts` logarem por conta própria.
 */
test("depois de sair, o botão voltar não traz o painel de volta", async ({ page }) => {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("E-mail").fill(EMAIL_ADMIN_E2E);
  await page.getByLabel("Senha").fill(senhaE2e());
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("/");

  // Duas telas com dado real, para que exista MESMO algo em cache quando o
  // logout acontecer. Sem visitar nada, o teste passaria por não haver o que
  // ressuscitar — verde sem provar nada.
  await page.getByRole("link", { name: "Leads", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Leads", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Contatos", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Contatos", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Sair" }).first().click();
  await page.waitForURL("**/login");

  // O voltar acontece BEM dentro da janela de 30 s — é o caso difícil. Se
  // esperássemos a janela expirar, o teste passaria por decurso de prazo e
  // não por revogação, que é o que precisa ser provado.
  await page.goBack();

  // A régua é o DADO, não a URL: um painel servido do cache com a URL
  // "certa" seria pior que um redirecionamento tardio. Nenhuma das duas telas
  // visitadas pode reaparecer.
  await expect(page.getByRole("heading", { name: "Contatos", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Leads", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Equipe", exact: true })).toHaveCount(0);

  // E voltar mais uma vez, alcançando a outra tela em cache, também não pode
  // trazer nada.
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Leads", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("usuario-logado")).toHaveCount(0);
});

/**
 * A outra metade da mesma pergunta: com a sessão VIVA, o cache pode servir a
 * tela — é para isso que ele foi ligado. Sem esta asserção, alguém poderia
 * "consertar" o teste acima desligando o cache por inteiro e a suíte ficaria
 * verde tendo perdido a coisa que a branch entrega.
 */
test("com sessão viva, voltar para uma aba recente não recarrega do servidor", async ({
  page,
}) => {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("E-mail").fill(EMAIL_ADMIN_E2E);
  await page.getByLabel("Senha").fill(senhaE2e());
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("/");

  await page.getByRole("link", { name: "Leads", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Leads", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Contatos", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Contatos", exact: true })).toBeVisible();

  // A partir daqui, qualquer pedido de `/leads` ao servidor é falha: a volta
  // tem que sair do cache do cliente. É a asserção que dá sentido aos 30 s.
  let foiAoServidor = false;
  page.on("request", (requisicao) => {
    if (new URL(requisicao.url()).pathname === "/leads") foiAoServidor = true;
  });

  await page.getByRole("link", { name: "Leads", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Leads", exact: true })).toBeVisible();

  expect(
    foiAoServidor,
    "voltar para /leads dentro da janela de 30 s foi ao servidor — staleTimes.dynamic não está valendo"
  ).toBe(false);
});
