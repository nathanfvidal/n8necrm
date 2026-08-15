import { test, expect } from "@playwright/test";

import { SESSAO_ADMIN } from "./credenciais";

/**
 * A troca de aba dá sinal de vida.
 *
 * ## O defeito que estes testes travam
 *
 * Toda navegação do painel é `prefetch={false}` — correção de segurança do
 * logout, que não se mexe (AGENTS.md). Somado à ausência de `loading.tsx`,
 * clicar num item do menu não mudava NADA na tela até o servidor terminar:
 * a página antiga ficava inteira e clicável, e a pessoa clicava de novo.
 *
 * Medido contra o build de produção antes do conserto: trocar para `/leads`
 * custa 6 consultas e ~1000 ms, com mediana de 85 ms por consulta. Nada aqui
 * torna isso mais rápido — o que muda é que o segundo passa a ser um segundo
 * em que a tela responde.
 *
 * ## Por que o atraso artificial
 *
 * Sem ele, este arquivo seria um teste de sorte de cronômetro: numa máquina
 * rápida a navegação pode terminar antes da primeira asserção e o esqueleto
 * nunca ser observado — verde por acaso, e vermelho por acaso no dia seguinte.
 * `page.route` segura a resposta da navegação por um tempo conhecido, e a
 * afirmação passa a ser exatamente a que interessa: *enquanto a resposta não
 * chega, existe sinal na tela.*
 */

test.use({ storageState: SESSAO_ADMIN });

/**
 * Segura QUALQUER requisição para `/leads` por `ms` e devolve uma função que
 * solta a torneira, para o resto do teste correr na velocidade normal.
 *
 * O filtro é por FUNÇÃO, comparando `pathname`, e não pelo glob `"**‌/leads"`.
 * O glob parece certo e não é: a navegação client-side do Next pede
 * `/leads?_rsc=<hash>`, o casamento de rota do Playwright considera a query
 * string, e o padrão simplesmente não casa. Custou uma execução verde falsa
 * para descobrir — os testes passaram em 2,1 s com um atraso de 3 s
 * configurado, o que só é possível se o atraso nunca tiver sido aplicado.
 * Comparar `pathname` ignora a query de propósito, que é o que se quer aqui.
 */
async function comNavegacaoLenta(page: import("@playwright/test").Page, ms: number) {
  const ehLeads = (url: URL) => url.pathname === "/leads";
  await page.route(ehLeads, async (rota) => {
    await new Promise((resolva) => setTimeout(resolva, ms));
    await rota.continue();
  });
  return () => page.unroute(ehLeads);
}

test("o esqueleto aparece enquanto a próxima aba não chega", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();

  const soltar = await comNavegacaoLenta(page, 3000);

  await page.getByRole("link", { name: "Leads", exact: true }).first().click();

  // O fallback de `(painel)/loading.tsx`. Se alguém apagar aquele arquivo,
  // é aqui que aparece — e não numa queixa de usuário meses depois.
  await expect(page.locator('[data-slot="skeleton"]').first()).toBeVisible();

  // E some sozinho quando o conteúdo real chega: esqueleto que fica é pior
  // que esqueleto nenhum.
  await expect(page.getByRole("heading", { name: "Leads", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);

  await soltar();
});

test("o link clicado acende enquanto a navegação está a caminho", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();

  const soltar = await comNavegacaoLenta(page, 3000);

  const linkLeads = page.getByRole("link", { name: "Leads", exact: true }).first();
  const pista = linkLeads.locator(".pista-de-link");

  // Antes do clique o elemento JÁ existe — o espaço fica reservado para o
  // item de menu não mudar de largura ao ser clicado.
  await expect(pista).toHaveCount(1);
  await expect(pista).not.toHaveClass(/pendente/);

  await linkLeads.click();
  await expect(pista).toHaveClass(/pendente/);

  await expect(page.getByRole("heading", { name: "Leads", exact: true })).toBeVisible({
    timeout: 15_000,
  });

  await soltar();
});

/**
 * O nome acessível do link não pode carregar o indicador junto.
 *
 * `nav-links.test.tsx` já trava isso em unidade, mas a consequência de
 * quebrá-lo é a suíte e2e INTEIRA falhar de uma vez, em specs sem relação
 * nenhuma com navegação — vale a asserção redundante no navegador de verdade,
 * onde o cálculo do nome acessível é o do próprio Chromium e não o de uma
 * biblioteca.
 */
test("o indicador não entra no nome acessível dos links", async ({ page }) => {
  await page.goto("/");
  for (const rotulo of ["Leads", "Contatos", "Tarefas", "Etapas"]) {
    await expect(page.getByRole("link", { name: rotulo, exact: true }).first()).toBeVisible();
  }
});
