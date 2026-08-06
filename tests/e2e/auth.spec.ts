import { test, expect } from "@playwright/test";

// Smoke test do harness do Playwright (Task 11). O teste de e2e "de verdade"
// é a Task 22 — este arquivo só prova que a suíte sobe o build de produção,
// dirige um browser real contra o app real e enxerga efeitos reais do
// proxy (src/proxy.ts) e do login (Auth.js + Postgres), não é um placeholder
// que sempre passa.

test("visitante não autenticado é redirecionado para /login", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
});

test("login com credenciais válidas leva ao painel autenticado", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel("E-mail").fill("admin@exemplo.com");
  await page.getByLabel("Senha").fill("senha123");
  await page.getByRole("button", { name: "Entrar" }).click();

  // Só renderiza depois de login (ver src/app/(painel)/layout.tsx: PainelNav
  // só aparece quando existe sessão) — prova que a autenticação contra o
  // banco real (seed da Task 9) funcionou de ponta a ponta.
  await expect(page).toHaveURL(/^http:\/\/localhost:3000\/$/);
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Leads" })).toBeVisible();
});

test("o botão Sair encerra a sessão de verdade, não só troca de tela", async ({ page }) => {
  // Antes desta correção não havia NENHUMA forma de sair pela interface: a
  // sessão só terminava quando o cookie expirava (e expirava em 30 dias).
  // Num computador compartilhado da revenda, isso é a próxima pessoa
  // sentando na conta de quem saiu.
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("admin@exemplo.com");
  await page.getByLabel("Senha").fill("senha123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // O teste que importa: voltar para uma rota protegida DEPOIS de sair.
  // Se o cookie sobrevivesse, o painel abriria de novo — "sair" seria só
  // uma navegação, não uma revogação.
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeHidden();
});

test("credenciais inválidas permanecem em /login com mensagem de erro", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel("E-mail").fill("admin@exemplo.com");
  await page.getByLabel("Senha").fill("senha-errada");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page.getByText("E-mail ou senha inválidos.")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
