// Prova a agenda de contatos num navegador de verdade: cadastrar com telefone
// formatado, encontrar pela busca, abrir o detalhe, e a recusa de telefone
// repetido dizendo de quem ele é.
//
// ## Por que loga como VENDEDOR, e não como ADMIN
//
// Dois motivos, e os dois importam.
//
// 1. É o comportamento que a fatia decidiu: contatos NÃO têm permissão
//    própria, porque o projeto já decidiu que todos os papéis veem e
//    trabalham todos os leads. Um vendedor que não pudesse corrigir o
//    telefone de quem ele mesmo atende pediria para um gestor, e o cadastro
//    errado sobreviveria por atrito. Este teste é o que garante que a tela
//    não ganhou um gate de ADMIN por descuido.
// 2. O limite de tentativas de login é POR CONTA (10 a cada 10 minutos, ver
//    core/rate-limit/login.ts), e a suíte já consome quase todo o orçamento
//    de `e2e-admin@teste.invalid`. Mais um login de admin aqui deixaria a suíte na
//    borda, e o sintoma seria "credenciais inválidas" em testes sem relação
//    nenhuma com login. `e2e-vendedor@teste.invalid` tem chave própria.
//
// Limpeza por MARCA no nome, antes e depois — `test.afterAll` roda mesmo com
// teste falhando, então uma asserção quebrada não deixa lixo no banco
// compartilhado.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { test, expect } from "@playwright/test";
import { EMAIL_VENDEDOR_E2E, senhaE2e } from "./credenciais";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// Marcador que nenhum contato de verdade tem, e faixa de telefone que nem o
// seed (1199999000x) nem os testes unitários (11988887xxx) usam.
const MARCA = "ZZE2EContato";
const TELEFONE_DIGITADO = "(11) 98888-6001";
const TELEFONE_NORMALIZADO = "11988886001";
const SEGUNDO_TELEFONE = "11988886002";

async function limparDadosDeTeste(): Promise<void> {
  const contatos = await prisma.contact.findMany({
    where: {
      OR: [{ nome: { contains: MARCA } }, { telefone: { in: [TELEFONE_NORMALIZADO, SEGUNDO_TELEFONE] } }],
    },
    select: { id: true },
  });
  const ids = contatos.map((c) => c.id);
  if (ids.length === 0) return;

  // Escopo por `entidadeId`, nunca por `userId`: os registros de auditoria são
  // gravados em nome do vendedor do seed, e apagar "os AuditLog dele" levaria
  // junto histórico real.
  await prisma.auditLog.deleteMany({ where: { entidade: "Contact", entidadeId: { in: ids } } });
  await prisma.lead.deleteMany({ where: { contactId: { in: ids } } });
  await prisma.contact.deleteMany({ where: { id: { in: ids } } });
}

// Serial pelo mesmo motivo de `whatsapp-agente.spec.ts` e `equipe.spec.ts`:
// `beforeAll`/`afterAll` do Playwright rodam por WORKER, não por arquivo, e
// com limpeza por marca compartilhada um grupo apagaria o dado do outro.
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await limparDadosDeTeste();
});

test.afterAll(async () => {
  await limparDadosDeTeste();
  await prisma.$disconnect();
});

test("vendedor cadastra, encontra e abre um contato, e o telefone repetido é recusado", async ({
  page,
}) => {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("E-mail").fill(EMAIL_VENDEDOR_E2E);
  await page.getByLabel("Senha").fill(senhaE2e());
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("/");

  // O link existe para VENDEDOR — contatos é núcleo, sem gate de papel.
  await page.getByRole("link", { name: "Contatos" }).click();
  await expect(page.getByRole("heading", { name: "Contatos" })).toBeVisible();

  await page.getByLabel("Nome", { exact: true }).fill(`Cliente ${MARCA}`);
  await page.getByLabel("Telefone", { exact: true }).fill(TELEFONE_DIGITADO);
  await page.getByRole("button", { name: "Adicionar contato" }).click();

  // Gravado com o telefone NORMALIZADO, não com a formatação digitada: é o
  // que impede a mesma pessoa de virar dois contatos por ter sido digitada de
  // outro jeito num outro dia.
  const linha = page.getByRole("row").filter({ hasText: `Cliente ${MARCA}` });
  await expect(linha).toContainText(TELEFONE_NORMALIZADO);

  // Telefone repetido: recusado, e a mensagem diz de quem o número é — sem
  // isso, quem preenche não sabe se é a mesma pessoa ou se errou um dígito.
  await page.getByLabel("Nome", { exact: true }).fill(`Outra Pessoa ${MARCA}`);
  await page.getByLabel("Telefone", { exact: true }).fill(TELEFONE_DIGITADO);
  await page.getByRole("button", { name: "Adicionar contato" }).click();
  // Escopado ao formulário: `getByRole("alert")` solto encontra mais de um
  // elemento na página e o modo estrito do Playwright recusa — o próprio
  // formulário tem o parágrafo de erro, e o sino de notificações também
  // renderiza um `role="alert"`.
  const formulario = page.locator("form").filter({ has: page.getByRole("button", { name: "Adicionar contato" }) });
  await expect(formulario.getByRole("alert")).toContainText(`já está cadastrado para Cliente ${MARCA}`);

  // Busca por nome, pela URL (a busca é uma navegação, não estado local).
  await page.goto(`/contatos?q=${encodeURIComponent(`Cliente ${MARCA}`)}`);
  const encontrada = page.getByRole("row").filter({ hasText: `Cliente ${MARCA}` });
  await expect(encontrada).toHaveCount(1);

  // Detalhe.
  await page.getByRole("link", { name: `Cliente ${MARCA}` }).click();
  await expect(page.getByRole("heading", { name: `Cliente ${MARCA}` })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Leads (0)" })).toBeVisible();

  // A seção de conversas aparece porque este fork tem o módulo `whatsapp`
  // ligado (`config/client.ts`). Num fork sem ele, a seção não é renderizada
  // e a tabela nem chega a ser consultada — ver o comentário na page sobre a
  // fronteira core/modules.
  await expect(page.getByRole("heading", { name: /^Conversas \(/ })).toBeVisible();

  // Editar pelo detalhe: corrigir um telefone digitado errado é o caso que
  // motivou a fatia.
  await page.getByLabel("Telefone", { exact: true }).fill(SEGUNDO_TELEFONE);
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByRole("status")).toContainText("Contato salvo");
});
