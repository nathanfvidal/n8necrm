import { test as setup, expect } from "@playwright/test";

import {
  EMAIL_ADMIN_E2E,
  EMAIL_VENDEDOR_E2E,
  SESSAO_ADMIN,
  SESSAO_VENDEDOR,
  senhaE2e,
} from "./credenciais";

/**
 * Faz UM login por conta e grava a sessão em disco, antes de qualquer spec.
 *
 * Projeto de setup do Playwright (`playwright.config.ts` declara este arquivo
 * como projeto `setup`, e o projeto `chromium` depende dele). Roda como teste
 * normal, então o `webServer` já está de pé — diferente de `globalSetup`, que
 * só toca o banco e não teria navegador.
 *
 * O porquê está em `credenciais.ts`, junto das constantes: em resumo, a suíte
 * fazia ~9 logins de admin por execução contra um teto de 10 a cada 10
 * minutos, e o modo de falha era o último teste da fila estourar timeout como
 * se a tela estivesse quebrada.
 *
 * `globalSetup` continua existindo e continua zerando o contador — ele resolve
 * um problema diferente (duas execuções da suíte dentro da mesma janela). Os
 * dois juntos: o contador começa limpo, e a execução gasta 3 tentativas em vez
 * de 9.
 */
async function entrar(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  // Espera a hidratação antes de preencher, mesmo motivo documentado em
  // `seguranca-headers.spec.ts`: o formulário é Client Component, e clicar
  // antes de o React assumir o submit faz a página recarregar sem logar.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(senhaE2e());
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("/");
}

setup("grava a sessao do admin", async ({ page }) => {
  await entrar(page, EMAIL_ADMIN_E2E);

  // Confirma que a sessão é utilizável antes de gravá-la: um `storageState`
  // salvo a partir de um login que não completou geraria falha em TODO spec
  // que dependesse dele, e a mensagem apontaria para o spec, não para aqui.
  await expect(page.getByRole("link", { name: "Equipe" })).toBeVisible();

  await page.context().storageState({ path: SESSAO_ADMIN });
});

setup("grava a sessao do vendedor", async ({ page }) => {
  await entrar(page, EMAIL_VENDEDOR_E2E);

  // Vendedor não tem "Equipe" (só ADMIN — ver a matriz em
  // `core/auth/permissions.ts`); "Leads" serve de prova de sessão viva para
  // qualquer papel.
  await expect(page.getByRole("link", { name: "Leads" }).first()).toBeVisible();

  await page.context().storageState({ path: SESSAO_VENDEDOR });
});
