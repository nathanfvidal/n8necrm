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

/**
 * O esqueleto é do CARREGAMENTO COMPLETO, não da troca de aba — e essa
 * distinção custou caro para ser aprendida.
 *
 * A primeira versão deste teste clicava na barra lateral e exigia o esqueleto.
 * Passava, e falhava, sem padrão: 2 de 3 execuções da suíte completa. A
 * explicação está numa frase do doc do próprio `loading.js`, que eu tinha lido
 * e não tinha entendido —
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md,
 * seção "Navigation": *"The Fallback UI is **prefetched**, making navigation
 * immediate unless prefetching hasn't completed."*
 *
 * A navegação deste painel é `prefetch={false}` — correção de segurança do
 * logout, que não se mexe. Sem prefetch, o roteador **não tem o fallback em
 * mãos** quando o clique acontece: ele precisa buscar o segmento, e quando a
 * resposta chega, já vem o conteúdo junto. O esqueleto só aparecia nas
 * execuções em que o render do servidor demorava o suficiente para o fallback
 * ser pintado no meio do streaming — ou seja, por sorte de cronômetro.
 *
 * Num carregamento completo é diferente e é determinístico: o SSR streama o
 * shell primeiro, e o esqueleto vai no primeiro pedaço, antes de as consultas
 * terminarem. É onde `loading.tsx` paga de verdade — o F5 em `/leads` media
 * 1738 ms de tela em branco antes desta branch.
 *
 * **Quem cobre a troca de aba é o teste seguinte**, do `useLinkStatus` — que é
 * exatamente o que o doc daquele hook recomenda para o caso `prefetch={false}`.
 * Os dois mecanismos existem porque atendem caminhos diferentes; trocá-los de
 * lugar foi o meu erro, não do desenho.
 */
test("o esqueleto vai no HTML do carregamento completo, ANTES da tabela", async ({ page }) => {
  // A afirmação é sobre o que o SSR MANDA, e em que ordem — não sobre pegar um
  // quadro de animação no ar.
  //
  // Tentei antes cronometrar o esqueleto na tela, dos dois jeitos: clicando na
  // barra lateral e recarregando a página, os dois com a resposta segurada por
  // `page.route`. Os dois falharam de forma instável, e por motivos diferentes
  // — no clique porque sem prefetch o fallback não está em mãos; no reload
  // porque `page.route` segura o INÍCIO da resposta, e não o render do
  // servidor, então o navegador fica 3 s com a página antiga e depois recebe o
  // HTML inteiro de uma vez. Em nenhum dos dois o atraso caía onde precisava.
  //
  // O que importa de verdade é uma propriedade do documento, e ela é estável:
  // o esqueleto é emitido no PRIMEIRO pedaço do stream, antes de as consultas
  // terminarem, e a tabela só aparece depois. É isso que faz o F5 deixar de
  // ser 1738 ms de tela em branco. Se `(painel)/loading.tsx` for apagado, o
  // marcador some do HTML e este teste fica vermelho.
  const resposta = await page.request.get("/leads");
  expect(resposta.status()).toBe(200);
  const html = await resposta.text();

  const posEsqueleto = html.indexOf('data-slot="skeleton"');
  const posTabela = html.indexOf("<table");

  expect(posEsqueleto, "o esqueleto de (painel)/loading.tsx não foi emitido no HTML").toBeGreaterThan(-1);
  expect(posTabela, "a tabela de leads não foi emitida no HTML — a página não renderizou").toBeGreaterThan(-1);
  expect(
    posEsqueleto,
    "o esqueleto veio DEPOIS da tabela: o fallback deixou de ser a primeira coisa que o SSR manda"
  ).toBeLessThan(posTabela);

  // E, na tela de verdade, ele não fica pendurado: quem abre a página termina
  // vendo o conteúdo, não o esqueleto.
  await page.goto("/leads");
  await expect(page.getByRole("heading", { name: "Leads", exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
});

test("o link clicado acende enquanto a navegação está a caminho", async ({ page }) => {
  await page.goto("/");
  // Espera a hidratacao antes de clicar na barra lateral. Sem isto, sob
  // carga, o clique chega antes de o React assumir o <Link> e o navegador faz
  // uma navegacao de PAGINA INTEIRA em vez de client-side -- outro caminho de
  // render, com outro comportamento de esqueleto e de cache. E a mesma
  // armadilha ja documentada em auth.setup.ts (clicar antes da hidratacao
  // recarrega a pagina em vez de submeter o formulario).
  await page.waitForLoadState("networkidle");
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
  // Espera a hidratacao antes de clicar na barra lateral. Sem isto, sob
  // carga, o clique chega antes de o React assumir o <Link> e o navegador faz
  // uma navegacao de PAGINA INTEIRA em vez de client-side -- outro caminho de
  // render, com outro comportamento de esqueleto e de cache. E a mesma
  // armadilha ja documentada em auth.setup.ts (clicar antes da hidratacao
  // recarrega a pagina em vez de submeter o formulario).
  await page.waitForLoadState("networkidle");
  for (const rotulo of ["Leads", "Contatos", "Tarefas", "Etapas"]) {
    await expect(page.getByRole("link", { name: rotulo, exact: true }).first()).toBeVisible();
  }
});
