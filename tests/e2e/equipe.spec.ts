// Prova, num navegador de verdade, o que esta fatia existe para entregar: um
// ADMIN instala o CRM num cliente novo sem programador junto. Cadastra a
// pessoa pela tela, ela entra com as credenciais que acabaram de ser criadas,
// e desativá-la derruba a sessão dela na navegação seguinte.
//
// Esse último passo é o que nenhum teste unitário alcança. `definirAtivo` só
// grava uma coluna; quem faz a revogação valer é `usuarioAtual()`
// (`core/auth/session.ts`), consultando `User.ativo` a cada chamada — a sessão
// é JWT, sem store no servidor, então um cookie já emitido continuaria válido
// se aquela consulta sumisse. Um teste de unidade sobre o serviço passaria
// feliz com a desativação virando teatro; só um navegador com cookie de
// verdade mostra a diferença.
//
// Mesmo padrão de `whatsapp-agente.spec.ts` para tocar o Postgres real e
// compartilhado: PrismaClient próprio (não `@/lib/prisma`, que tem
// `import "server-only"` e quebraria fora do pipeline de build do Next) e
// limpeza por PREFIXO, antes e depois — `test.afterAll` roda mesmo quando um
// teste falha, então uma asserção quebrada não deixa lixo no banco de todo
// mundo.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { test, expect, type Page } from "@playwright/test";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// E-mail fixo, não aleatório: só existe um por vez, e um valor fixo é o que
// permite a limpeza encontrá-lo mesmo se uma execução anterior tiver travado
// antes de apagar.
const PREFIXO_EMAIL = "e2e-equipe-";
const EMAIL_NOVA_PESSOA = `${PREFIXO_EMAIL}nova-pessoa@teste.local`;
const NOME_NOVA_PESSOA = "Pessoa Nova E2E";
const SENHA_NOVA_PESSOA = "senha-teste-e2e-123";

/**
 * Apaga os usuários deste spec e os registros de auditoria QUE APONTAM PARA
 * ELES.
 *
 * O escopo da auditoria é por `entidadeId`, nunca por `userId`: quem grava
 * essas linhas é o `admin@exemplo.com`, e apagar "os AuditLog do admin"
 * levaria junto o histórico real de tudo que já foi feito no CRM.
 */
async function limparDadosDeTeste(): Promise<void> {
  const usuarios = await prisma.user.findMany({
    where: { email: { startsWith: PREFIXO_EMAIL } },
    select: { id: true },
  });
  if (usuarios.length === 0) return;

  const ids = usuarios.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { entidade: "User", entidadeId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

// MODO SERIAL, mesmo raciocínio de `whatsapp-agente.spec.ts`: `beforeAll` e
// `afterAll` do Playwright rodam por WORKER, não por arquivo. Com
// `fullyParallel` e limpeza por prefixo compartilhado, um grupo apagaria o
// usuário que o outro está usando. Há um único teste aqui hoje, mas a
// configuração fica para que acrescentar o segundo não reintroduza a corrida.
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await limparDadosDeTeste();
});

test.afterAll(async () => {
  await limparDadosDeTeste();
  await prisma.$disconnect();
});

async function login(page: Page, email: string, senha: string): Promise<void> {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("/");
}

test("ADMIN cadastra uma pessoa, ela entra, e desativar derruba a sessão dela", async ({
  page,
  browser,
}) => {
  // UM login de admin no arquivo inteiro, de propósito. O limite de
  // tentativas é de 10 por conta a cada 10 minutos (`core/rate-limit/login.ts`)
  // e a suíte já consome a maior parte disso com `admin@exemplo.com` — é por
  // isso que a segunda sessão abaixo é um CONTEXTO NOVO com a pessoa recém
  // criada (chave de rate limit própria), e não um segundo login do admin.
  await login(page, "admin@exemplo.com", "senha123");

  await page.goto("/usuarios");
  await expect(page.getByRole("heading", { name: "Equipe" })).toBeVisible();

  // `exact: true` nos rótulos: as linhas em modo de edição usam
  // `aria-label="Nome de ..."` e `aria-label="Papel de ..."`, que a busca por
  // substring do Playwright também casaria.
  await page.getByLabel("Nome", { exact: true }).fill(NOME_NOVA_PESSOA);
  await page.getByLabel("E-mail", { exact: true }).fill(EMAIL_NOVA_PESSOA);
  await page.getByLabel("Senha inicial", { exact: true }).fill(SENHA_NOVA_PESSOA);
  await page.getByLabel("Papel", { exact: true }).selectOption("VENDEDOR");
  await page.getByRole("button", { name: "Adicionar pessoa" }).click();

  const linha = page.getByRole("row").filter({ hasText: EMAIL_NOVA_PESSOA });
  await expect(linha).toBeVisible();
  await expect(linha).toContainText("Ativo");

  // A pessoa entra de verdade, com a senha que o ADMIN acabou de definir.
  // Contexto separado para não herdar o cookie do admin — sem isso, um teste
  // de autorização passaria por engano, que é o pior resultado possível.
  const contextoDaPessoa = await browser.newContext();
  const paginaDaPessoa = await contextoDaPessoa.newPage();

  try {
    await login(paginaDaPessoa, EMAIL_NOVA_PESSOA, SENHA_NOVA_PESSOA);
    await expect(paginaDaPessoa.getByTestId("usuario-logado")).toHaveText(NOME_NOVA_PESSOA);

    // VENDEDOR não vê o link da gestão de equipe. Não é a defesa (a página
    // redireciona e cada Server Action checa a permissão), mas é o sintoma
    // visível de o papel ter sido aplicado de verdade, e não ignorado.
    await expect(paginaDaPessoa.getByRole("link", { name: "Equipe" })).toHaveCount(0);

    // E a rota direta também não abre, mesmo digitando a URL.
    await paginaDaPessoa.goto("/usuarios");
    await expect(paginaDaPessoa).toHaveURL(/^http:\/\/localhost:3000\/$/);

    // O ADMIN desativa.
    await linha.getByRole("button", { name: "Desativar" }).click();
    await expect(linha).toContainText("Desativado");
    await expect(linha.getByRole("button", { name: "Reativar" })).toBeVisible();

    // A sessão da pessoa cai na navegação seguinte — o cookie dela continua
    // no navegador, intacto e não expirado. É exatamente por isso que este
    // teste existe: o cookie sozinho não basta mais.
    await paginaDaPessoa.goto("/leads");
    await expect(paginaDaPessoa).toHaveURL(/\/login/);
  } finally {
    await contextoDaPessoa.close();
  }
});
