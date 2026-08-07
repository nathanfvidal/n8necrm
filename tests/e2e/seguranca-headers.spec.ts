// Prova, num navegador de verdade contra o build de produção, que:
//   1. os headers de segurança chegam ao cliente;
//   2. o CSP com nonce NÃO quebra nenhuma tela do CRM.
//
// O item 2 é o que justifica este arquivo existir. CSP é a correção de
// segurança que mais quebra site em silêncio: o servidor responde 200, o
// HTML chega, e só o JavaScript morre — a tela aparece "quase certa" e
// nenhum teste de status HTTP percebe. A única verificação que vale é abrir
// cada página num navegador e ler o console.
import { test, expect, type Page } from "@playwright/test";
import { EMAIL_ADMIN_E2E, senhaE2e } from "./credenciais";

const CREDENCIAIS = { email: EMAIL_ADMIN_E2E, senha: senhaE2e() };

/** Telas que um usuário logado realmente usa. Se o CSP quebrar, quebra aqui. */
const TELAS = ["/", "/leads", "/leads/kanban", "/tasks", "/conversas"];

/**
 * Coleta violações de CSP e erros de página.
 *
 * O navegador reporta violação de CSP como mensagem de console de nível
 * "error" contendo "Content Security Policy". Um script bloqueado costuma
 * gerar TAMBÉM um erro de página (a hidratação do React falha), então os
 * dois são capturados.
 */
function coletarProblemas(page: Page) {
  const problemas: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const texto = msg.text();
    if (/content security policy|refused to (load|execute|apply)/i.test(texto)) {
      problemas.push(`[CSP] ${texto}`);
    }
  });

  page.on("pageerror", (erro) => {
    problemas.push(`[pageerror] ${erro.message}`);
  });

  return problemas;
}

async function entrar(page: Page) {
  await page.goto("/login");
  // Espera a hidratação ANTES de clicar. O formulário de login é um Client
  // Component: `<form action={handleSubmit}>` só é interceptado pelo React
  // depois que o bundle carrega e hidrata. Um clique antes disso dispara o
  // submit NATIVO do navegador, que não vai a lugar nenhum — a página
  // recarrega e o login simplesmente não acontece.
  //
  // Isso apareceu de verdade: rodando a suíte inteira em paralelo (máquina
  // mais carregada, hidratação mais lenta) este login falhou, e o contador
  // de tentativas no banco provou que o POST nunca saiu. Uma pessoa real
  // leva segundos digitando e nunca cai nesse caso, mas o teste preenche em
  // milissegundos.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("E-mail").fill(CREDENCIAIS.email);
  await page.getByLabel("Senha").fill(CREDENCIAIS.senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
}

test("os headers de segurança chegam na resposta", async ({ page }) => {
  const resposta = await page.goto("/login");
  const headers = resposta!.headers();

  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["strict-transport-security"]).toContain("max-age=");
  expect(headers["permissions-policy"]).toContain("camera=()");

  // Anunciar o framework entrega de graça a lista de CVEs que vale tentar.
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("o CSP é estrito onde importa e traz um nonce novo por requisição", async ({ page }) => {
  const primeira = await page.goto("/login");
  const csp = primeira!.headers()["content-security-policy"];
  expect(csp).toBeTruthy();

  // O que realmente barra XSS: script sem nonce não roda.
  expect(csp).toContain("'nonce-");
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  // Clickjacking, sequestro de POST do login, injeção de <base>, plugin legado.
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("form-action 'self'");
  expect(csp).toContain("base-uri 'self'");
  expect(csp).toContain("object-src 'none'");

  // Nonce reaproveitado entre requisições é nonce que não serve para nada:
  // o atacante lê o valor de uma resposta e usa na próxima injeção.
  const segunda = await page.goto("/login");
  const cspSegunda = segunda!.headers()["content-security-policy"];
  const extrair = (v: string) => v.match(/'nonce-([^']+)'/)?.[1];
  expect(extrair(csp!)).toBeTruthy();
  expect(extrair(cspSegunda!)).not.toBe(extrair(csp!));
});

test("a tela de login carrega e funciona sob o CSP", async ({ page }) => {
  const problemas = coletarProblemas(page);

  await entrar(page);

  expect(problemas, `violações de CSP em /login:\n${problemas.join("\n")}`).toEqual([]);
});

test("o nonce do header CSP é o mesmo carimbado nas tags <script> da página", async () => {
  // Esta é a engrenagem da qual tudo depende: o Next lê o CSP da requisição,
  // extrai o nonce e carimba nos próprios scripts. Se essa ligação
  // arrebentar (o Next parar de reconhecer o header, o proxy mandar valores
  // diferentes na requisição e na resposta), o CSP passa a bloquear os
  // scripts do PRÓPRIO app — e o sintoma é uma tela em branco em produção.
  const resposta = await fetch("http://localhost:3000/login");
  const csp = resposta.headers.get("content-security-policy")!;
  const html = await resposta.text();

  const nonceDoHeader = csp.match(/'nonce-([^']+)'/)?.[1];
  expect(nonceDoHeader, "o header CSP não trouxe nonce").toBeTruthy();

  const noncesNoHtml = new Set([...html.matchAll(/nonce="([^"]+)"/g)].map((m) => m[1]));
  expect(noncesNoHtml.size, "nenhuma tag recebeu nonce — o Next não aplicou").toBeGreaterThan(0);
  // Um único valor, e igual ao do header. Valor diferente = script do
  // próprio app bloqueado.
  expect([...noncesNoHtml]).toEqual([nonceDoHeader]);
});

test("CANÁRIO: script inline sem nonce que chega pela REDE não executa", async ({ page }) => {
  // Sem este teste, os dois testes de "nenhuma violação" abaixo não provam
  // nada: passariam igual se o CSP não estivesse sendo aplicado.
  //
  // A injeção é feita com `page.route`, reescrevendo o HTML na resposta de
  // rede, e NÃO com `page.addScriptTag`/`page.evaluate`. Esses dois rodam
  // pelo protocolo de DevTools, que ignora CSP por design — um canário
  // escrito com eles "falha" mesmo com o CSP funcionando perfeitamente
  // (aconteceu ao escrever este arquivo). Pela rota, o script entra no
  // documento pelo mesmo caminho que um XSS de verdade entraria.
  const problemas = coletarProblemas(page);

  await page.route("**/login", async (rota) => {
    const original = await rota.fetch();
    const html = (await original.text()).replace(
      "</body>",
      '<script>window.__invasor_executou = true;</script></body>'
    );
    await rota.fulfill({ response: original, body: html });
  });

  await page.goto("/login");
  await page.waitForLoadState("networkidle");

  const executou = await page.evaluate(() => "__invasor_executou" in window);
  expect(executou, "script injetado sem nonce EXECUTOU — o CSP não está protegendo").toBe(false);
  expect(problemas.length, "CSP bloqueou, mas o detector não registrou nada").toBeGreaterThan(0);
});

test("nenhuma tela do painel viola o CSP", async ({ page }) => {
  const problemas = coletarProblemas(page);
  await entrar(page);

  for (const tela of TELAS) {
    await page.goto(tela);
    // Espera a hidratação: sem isso o teste poderia terminar antes do
    // script bloqueado sequer ser avaliado, e passaria por engano.
    await page.waitForLoadState("networkidle");
    expect(
      problemas,
      `violações de CSP ao abrir ${tela}:\n${problemas.join("\n")}`
    ).toEqual([]);
  }
});
