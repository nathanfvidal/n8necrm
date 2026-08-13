// Prova as duas metades do interruptor de tema (Task 8):
//   1. o clique alterna a classe `dark` no `<html>` e a escolha sobrevive a
//      uma navegação de verdade, não só ao clique — é onde persistência mal
//      ligada quebra;
//   2. o script anti-flash do `next-themes` roda sob `strict-dynamic` porque
//      carrega o mesmo nonce que `src/proxy.ts` grava no header CSP.
//
// O segundo teste mede a CAUSA, não o sintoma. "Piscou branco?" pede captura
// de vídeo e dá teste instável; o que realmente quebra quando o nonce falta é
// o script inline sendo recusado pelo `script-src` com `strict-dynamic`, e
// isso o navegador reporta como violação de CSP no console — mesma técnica de
// `seguranca-headers.spec.ts`.
//
// Sessão reaproveitada de `auth.setup.ts`: este spec só precisa estar logado
// para chegar no painel, não testa login em si.
import { test, expect } from "@playwright/test";
import { SESSAO_ADMIN } from "./credenciais";

test.use({ storageState: SESSAO_ADMIN });

test.describe("tema", () => {
  test("alterna e sobrevive à navegação", async ({ page }) => {
    await page.goto("/");

    const html = page.locator("html");
    await expect(html).toHaveClass(/dark/);

    // Achar o botão PELO NOME é a metade que importa, não um detalhe de
    // localizador. O `next-themes` devolve `resolvedTheme === undefined` no
    // servidor e o valor real já no primeiro render do cliente; como o React
    // não confere atributo durante a hidratação, um `aria-label` que dependa
    // do tema sem passar pela guarda de mount congela com o texto do servidor
    // e nunca mais muda — o botão passa a anunciar o oposto do que faz.
    // Ninguém vê isso na tela (o ícone está certo) e nada estático pega: foi
    // este `getByRole` que pegou. Se alguém tirar a guarda de
    // `theme-toggle.tsx`, este passo volta a estourar por tempo.
    const alternador = page.getByRole("button", { name: "Usar tema claro" });
    await alternador.click();
    await expect(html).not.toHaveClass(/dark/);

    // E o rótulo tem que virar junto, senão ele só estava certo por sorte no
    // estado inicial.
    await expect(page.getByRole("button", { name: "Usar tema escuro" })).toBeVisible();

    // A escolha precisa sobreviver a uma navegação de verdade, não só ao
    // clique — é onde persistência mal ligada quebra.
    await page.getByRole("link", { name: "Leads", exact: true }).first().click();
    await page.waitForURL("**/leads");
    await expect(html).not.toHaveClass(/dark/);
  });

  test("o script de tema não é bloqueado pelo CSP", async ({ page }) => {
    // Testa a CAUSA, não o sintoma. "Piscou branco?" é difícil de medir sem
    // captura de vídeo e daria teste instável; o que realmente quebra é o
    // script inline sem nonce sendo recusado pelo `strict-dynamic`, e isso
    // o navegador reporta no console.
    const violacoes: string[] = [];
    page.on("console", (m) => {
      if (/content security policy|refused to (load|execute|apply)/i.test(m.text())) {
        violacoes.push(m.text());
      }
    });

    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/dark/);
    expect(violacoes).toEqual([]);
  });
});
