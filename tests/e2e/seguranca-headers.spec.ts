// Prova, num navegador de verdade contra o build de produção, que:
//   1. os headers de segurança chegam ao cliente;
//   2. o CSP com nonce NÃO quebra nenhuma tela do CRM.
//
// O item 2 é o que justifica este arquivo existir. CSP é a correção de
// segurança que mais quebra site em silêncio: o servidor responde 200, o
// HTML chega, e só o JavaScript morre — a tela aparece "quase certa" e
// nenhum teste de status HTTP percebe. A única verificação que vale é abrir
// cada página num navegador e ler o console.
import "dotenv/config";
import { type Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { test, expect, type Page } from "@playwright/test";
import { EMAIL_ADMIN_E2E, SESSAO_ADMIN, senhaE2e } from "./credenciais";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

/**
 * Faixa de telefone reservada a este arquivo, e o telefone DESTE WORKER
 * dentro dela.
 *
 * ## Por que não pode ser um literal
 *
 * `test.beforeAll` roda uma vez por WORKER, não por arquivo, e
 * `playwright.config.ts` tem `fullyParallel: true` com `workers: 3`. Com
 * telefone fixo, o segundo worker a chegar recebia:
 *
 *     Invalid `prisma.contact.create()` invocation
 *     Unique constraint failed on the fields: (`telefone`)
 *
 * Não era instabilidade: `--workers=1` dava 22 verdes SEMPRE, e qualquer
 * execução focada deste arquivo dava vermelho SEMPRE. Na suíte inteira o
 * defeito ficava invisível porque a distribuição costumava concentrar os seis
 * casos num worker só.
 *
 * ## E o Ciclo 1e NÃO tornou isto desnecessário
 *
 * O comentário anterior culpava `Contact.telefone` ser `@unique` GLOBAL. Desde
 * o Ciclo 1e a chave é `@@unique([companyId, telefone])` — e os três workers
 * gravam na MESMA empresa (a do seed). Um telefone literal colidiria
 * exatamente igual. Reverter esta montagem para um literal reabre a quebra;
 * esta seção existe para que ninguém "limpe" isso achando que a composição
 * resolveu.
 *
 * ## Como o valor é montado
 *
 * `1193777` identifica o arquivo · `E2E_ID_EXECUCAO` (2 dígitos, posto por
 * `global-setup.ts` no processo pai e herdado por todo worker) identifica a
 * EXECUÇÃO · `TEST_PARALLEL_INDEX` (2 dígitos, posto pelo Playwright em cada
 * worker — `node_modules/playwright/lib/worker/workerProcessEntry.js`)
 * identifica o WORKER. Onze dígitos no total, o mesmo formato dos demais
 * telefones de fixture.
 *
 * A faixa `1193333xxxx` que este arquivo usava ANTES não era exclusiva, ao
 * contrário do que o comentário afirmava: `tests/unit/lead-isolamento.test.ts`
 * grava `11933330001`, o mesmo valor, byte a byte. Vitest e Playwright não
 * rodam juntos hoje (regra do projeto), então a colisão nunca se manifestou —
 * mas a frase "não colide com nenhum outro prefixo em uso" era falsa quando
 * foi escrita e apontava para um arquivo, `tests/unit/stage-transition.test.ts`,
 * que não tem lista nenhuma. Ela foi trocada por esta faixa, verificada em
 * 2026-08-20 contra todo `TELEFONE* = "..."` de `tests/`.
 */
const PREFIXO_TELEFONE = "1193777";
const ID_DA_EXECUCAO = (process.env.E2E_ID_EXECUCAO ?? "00").padStart(2, "0").slice(-2);
const SLOT_DO_WORKER = (process.env.TEST_PARALLEL_INDEX ?? "0").padStart(2, "0").slice(-2);
const TELEFONE_TESTE = `${PREFIXO_TELEFONE}${ID_DA_EXECUCAO}${SLOT_DO_WORKER}`;
const NOME_TESTE = "E2E CSP Detalhe";

/**
 * Cria o contato e o lead que a caminhada por telas de DETALHE precisa.
 *
 * ## Por que isto passou a ser necessário
 *
 * Este arquivo NÃO criava dado nenhum: percorria `/leads` e `/contatos` e
 * clicava no primeiro link de registro que encontrasse, contando com o que já
 * existisse no banco compartilhado. Funcionava por acidente de ORDEM — o
 * login deste spec levava alguns segundos, e nesse intervalo
 * `lead-to-won.spec.ts` já tinha criado o lead dele.
 *
 * Ao trocar o login por sessão reaproveitada (`auth.setup.ts`), este teste
 * passou a partir direto para as telas e chegou em `/leads` antes de existir
 * lead — ou depois de `lead-edicao.spec.ts` arquivar o dele, que some da
 * listagem por definição. O sintoma era `locator.click` estourando timeout em
 * `a[href^="/leads/"]`, que parece quebra de CSP e é dado ausente.
 *
 * A dependência oculta entre specs já existia; a sessão reaproveitada só a
 * revelou. Um teste que depende do que outro arquivo criou passa ou falha por
 * motivo que não é o dele.
 */
test.beforeAll(async () => {
  await varrerResiduoDeExecucoesAnteriores();
  await limparDadosDeTeste();

  const etapa = await prisma.pipelineStage.findFirstOrThrow({ orderBy: { ordem: "asc" } });
  const responsavel = await prisma.user.findFirstOrThrow({ where: { email: EMAIL_ADMIN_E2E } });
  // Empresa única do Ciclo 1a (mesma suposição de `prisma/seed.ts`, que
  // criou tanto ela quanto o admin/vendedor de e2e usados aqui) — não há
  // seletor de empresa na sessão e2e, então é a única Company do banco.
  const empresa = await prisma.company.findFirstOrThrow();
  const contato = await prisma.contact.create({
    data: { companyId: empresa.id, nome: NOME_TESTE, telefone: TELEFONE_TESTE },
  });
  await prisma.lead.create({
    data: {
      companyId: empresa.id,
      contactId: contato.id,
      stageId: etapa.id,
      responsavelId: responsavel.id,
      canal: "MANUAL",
    },
  });
});

test.afterAll(async () => {
  await limparDadosDeTeste();
  await prisma.$disconnect();
});

/**
 * Apaga o contato e o lead DESTE worker, e só eles.
 *
 * `afterAll` do Playwright roda mesmo quando um teste falha ou estoura o
 * tempo — é a razão de a limpeza morar num hook e não num `finally` dentro do
 * caso.
 */
async function limparDadosDeTeste(): Promise<void> {
  await apagarContatos({ telefone: TELEFONE_TESTE });
}

/**
 * Apaga o que execuções ANTERIORES da suíte deixaram nesta faixa.
 *
 * A varredura é por prefixo do arquivo, EXCLUINDO o carimbo desta execução:
 * qualquer linha `1193777…` que não seja desta execução é, por construção,
 * resíduo de uma execução que morreu antes do `afterAll`. Sem o `NOT`, o
 * `beforeAll` do segundo worker apagaria o contato que o primeiro acabou de
 * criar e ainda está usando — trocaria um defeito de paralelismo por outro.
 *
 * Isto existe porque o telefone é único por execução: sem varredura, cada
 * execução interrompida deixaria uma linha para sempre, e o banco de
 * desenvolvimento é compartilhado.
 */
async function varrerResiduoDeExecucoesAnteriores(): Promise<void> {
  await apagarContatos({
    telefone: {
      startsWith: PREFIXO_TELEFONE,
      not: { startsWith: `${PREFIXO_TELEFONE}${ID_DA_EXECUCAO}` },
    },
  });
}

async function apagarContatos(onde: Prisma.ContactWhereInput): Promise<void> {
  const contatos = await prisma.contact.findMany({ where: onde, select: { id: true } });
  if (contatos.length === 0) return;
  const contatoIds = contatos.map((contato) => contato.id);

  const leads = await prisma.lead.findMany({ where: { contactId: { in: contatoIds } } });
  const leadIds = leads.map((lead) => lead.id);

  if (leadIds.length > 0) {
    // `Notification` não tem FK para `Lead` (o `leadId` é um campo solto no
    // JSON do payload), então filtra em memória — mesmo padrão de
    // `lead-to-won.spec.ts`.
    const notificacoes = await prisma.notification.findMany({ where: { tipo: "NOVO_LEAD" } });
    const ids = notificacoes
      .filter((n) => leadIds.includes((n.payload as { leadId?: string } | null)?.leadId ?? ""))
      .map((n) => n.id);
    if (ids.length > 0) await prisma.notification.deleteMany({ where: { id: { in: ids } } });

    await prisma.auditLog.deleteMany({ where: { entidade: "Lead", entidadeId: { in: leadIds } } });
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  }

  await prisma.contact.deleteMany({ where: { id: { in: contatoIds } } });
}

const CREDENCIAIS = { email: EMAIL_ADMIN_E2E, senha: senhaE2e() };

/** Telas que um usuário logado realmente usa. Se o CSP quebrar, quebra aqui. */
const TELAS = ["/", "/leads", "/leads/kanban", "/tasks", "/conversas"];

/**
 * Telas de DETALHE, alcançadas pelo primeiro link da listagem — o id muda a
 * cada banco, então não dá para escrever o caminho fixo aqui.
 *
 * Achado da auditoria de segurança: a lista acima só tinha telas de índice, e
 * `/leads/[id]` — a que mais concentra componentes de cliente (formulário de
 * edição, campo de dinheiro, notas e tarefas em linha) — nunca era aberta por
 * este teste. Era justamente onde uma quebra de CSP passaria despercebida.
 */
const DETALHES = [
  { listagem: "/leads", descricao: "detalhe do lead" },
  { listagem: "/contatos", descricao: "detalhe do contato" },
];

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

// Sessão reaproveitada de `auth.setup.ts` em vez de mais um login: este teste
// só precisa ESTAR logado para percorrer as telas, e cada login gasta cota do
// teto de 10 por conta a cada 10 minutos (`core/rate-limit/login.ts`). O teste
// acima ("a tela de login carrega e funciona sob o CSP") continua logando de
// verdade — lá o login É o objeto do teste, não um pré-requisito.
test.describe(() => {
  test.use({ storageState: SESSAO_ADMIN });

  test("nenhuma tela do painel viola o CSP", async ({ page }) => {
  const problemas = coletarProblemas(page);

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

  for (const { listagem, descricao } of DETALHES) {
    await page.goto(listagem);
    await page.waitForLoadState("networkidle");

    // Primeiro link que aponta para um registro daquela listagem. Falha alto
    // se não houver nenhum: um teste que "passa" porque não achou o que
    // testar não prova nada.
    const primeiro = page.locator(`a[href^="${listagem}/"]`).first();
    await expect(primeiro, `nenhum registro em ${listagem} para abrir o ${descricao}`).toBeVisible();

    await primeiro.click();
    await page.waitForLoadState("networkidle");
    expect(
      problemas,
      `violações de CSP no ${descricao} (${page.url()}):\n${problemas.join("\n")}`
    ).toEqual([]);
  }
  });
});
