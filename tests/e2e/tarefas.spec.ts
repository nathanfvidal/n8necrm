// Primeiro e2e de tarefas do projeto. Até esta branch a tela mais reclamada
// pelo dono ("não tem nada para adicionar em tarefas, apenas uma data e
// título") não tinha nenhuma cobertura de navegador.
//
// Prova o ciclo inteiro num navegador de verdade: criar com descrição e
// contato, VER a descrição na tela (o defeito que abriu a branch — o campo
// existia no banco, era gravado, e nada o exibia), editar, concluir, achar em
// "concluídas", reabrir, e excluir passando pelo diálogo.
//
// ## Por que o diálogo importa para ESTE arquivo
//
// Enquanto excluir usava `window.confirm`, um e2e de tarefas precisaria de
// `page.on("dialog")` — um canal lateral que precisa ser armado ANTES do
// clique e que falha em silêncio se ninguém armar. A troca por `Dialog` na
// mesma branch não foi gosto: é o que torna este arquivo escrevível sem
// armadilha embutida.
//
// Loga como VENDEDOR pelos dois motivos de `contatos.spec.ts`: tarefa é
// lembrete pessoal, sem gate de papel, e o limite de login é POR CONTA — a
// conta de admin já está perto do teto por causa dos outros specs.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { test, expect } from "@playwright/test";
import { EMAIL_VENDEDOR_E2E, senhaE2e } from "./credenciais";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const MARCA = "ZZE2ETarefa";
const TELEFONE_CONTATO = "11988886101";
const NOME_CONTATO = `Contato ${MARCA}`;

// Data fixa e distante: `<input type="date">` recebe "AAAA-MM-DD", e uma data
// no futuro evita que a tarefa apareça como vencida e mude o visual da linha.
const VENCIMENTO = "2027-03-15";

const DESCRICAO = "Levar a proposta impressa, ele pediu duas vias.";
const DESCRICAO_EDITADA = "Levar a proposta em PDF, ele mudou de ideia.";

/**
 * A ordem importa e é imposta pelo banco: `Task.contactId` tem
 * `ON DELETE RESTRICT` (migração desta branch), então apagar o contato antes
 * das tarefas falha com violação de FK. Isso não é inconveniência do teste —
 * é a proteção funcionando, e a limpeza respeitá-la é a prova mais barata de
 * que ela existe.
 */
/**
 * Espera a escrita chegar no Postgres antes de navegar.
 *
 * Não é paranoia nem `waitForTimeout` disfarçado: a lista faz remoção
 * OTIMISTA (`useTaskList`), então `toHaveCount(0)` é satisfeito no mesmo
 * quadro do clique, muito antes de a Server Action responder. Navegar em
 * seguida tira a página do ar com a escrita ainda em voo, e o sintoma é uma
 * lista de concluídas vazia — que parece defeito de consulta e não é.
 *
 * `lead-to-won.spec.ts` já carrega a mesma lição, escrita depois de o mesmo
 * erro flakar aquele arquivo ("o reload vencia a corrida"). Este helper é a
 * aplicação dela aqui.
 */
async function esperarConclusaoNoBanco(concluida: boolean): Promise<void> {
  await expect
    .poll(
      () =>
        prisma.task.count({
          where: {
            titulo: { contains: MARCA },
            concluidaEm: concluida ? { not: null } : null,
          },
        }),
      { timeout: 15_000 }
    )
    .toBe(1);
}

async function limparDadosDeTeste(): Promise<void> {
  const tarefas = await prisma.task.findMany({
    where: { titulo: { contains: MARCA } },
    select: { id: true },
  });
  const ids = tarefas.map((t) => t.id);
  if (ids.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entidade: "Task", entidadeId: { in: ids } } });
    await prisma.task.deleteMany({ where: { id: { in: ids } } });
  }

  await prisma.contact.deleteMany({
    where: { OR: [{ nome: { contains: MARCA } }, { telefone: TELEFONE_CONTATO }] },
  });
}

// Serial pelo mesmo motivo dos outros arquivos com limpeza por marca:
// `beforeAll`/`afterAll` rodam por WORKER, não por arquivo.
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await limparDadosDeTeste();
  // O seletor de contato só aparece quando existe pelo menos um contato — um
  // `<select>` com uma opção só não é escolha. Criar aqui, e não pela tela,
  // mantém este arquivo sobre TAREFAS.
  // Empresa única do Ciclo 1a (mesma suposição de `prisma/seed.ts`).
  const empresa = await prisma.company.findFirstOrThrow();
  await prisma.contact.create({
    data: { companyId: empresa.id, nome: NOME_CONTATO, telefone: TELEFONE_CONTATO },
  });
});

test.afterAll(async () => {
  await limparDadosDeTeste();
  await prisma.$disconnect();
});

test("vendedor registra uma tarefa com descrição e contato, conclui, reabre e exclui", async ({
  page,
}) => {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("E-mail").fill(EMAIL_VENDEDOR_E2E);
  await page.getByLabel("Senha").fill(senhaE2e());
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("/");

  await page.getByRole("link", { name: "Tarefas" }).click();
  await expect(page.getByRole("heading", { name: "Tarefas" })).toBeVisible();

  // ── Criar, com os campos que não existiam ────────────────────────────
  const titulo = `Ligar pro fornecedor ${MARCA}`;
  await page.getByLabel("Título").fill(titulo);
  await page.getByLabel("Vencimento").fill(VENCIMENTO);
  await page.getByLabel("Descrição").fill(DESCRICAO);
  await page.getByLabel("Contato").selectOption({ label: NOME_CONTATO });
  await page.getByRole("button", { name: "Adicionar tarefa" }).click();

  const linha = page.getByRole("listitem").filter({ hasText: titulo });
  await expect(linha).toBeVisible();

  // O defeito que abriu a branch: a descrição era gravada e NUNCA exibida.
  // Dava para digitar, salvar, e vê-la sumir da tela.
  await expect(linha).toContainText(DESCRICAO);
  // A decisão de ligar tarefa a contato, visível onde importa.
  await expect(linha).toContainText(NOME_CONTATO);

  // ── Editar a descrição ───────────────────────────────────────────────
  await linha.getByRole("button", { name: "Editar" }).click();
  await page.getByLabel("Descrição da tarefa").fill(DESCRICAO_EDITADA);
  await page.getByRole("button", { name: "Salvar" }).click();

  await expect(page.getByRole("listitem").filter({ hasText: titulo })).toContainText(
    DESCRICAO_EDITADA
  );

  // ── Concluir: sai das pendentes ──────────────────────────────────────
  await page
    .getByRole("listitem")
    .filter({ hasText: titulo })
    .getByRole("button", { name: "Concluir" })
    .click();
  await expect(page.getByRole("listitem").filter({ hasText: titulo })).toHaveCount(0);
  // A contagem zero acima é a remoção otimista, não a escrita. Só o banco
  // distingue "concluída" de "sumiu da tela".
  await esperarConclusaoNoBanco(true);

  // ── Achar em concluídas, pela URL ────────────────────────────────────
  // O filtro mora na query string (`?concluidas=1`), no molde de
  // `?arquivados=1` em /leads: compartilhável, sobrevive ao F5, e filtra no
  // Postgres em vez de esconder no navegador.
  await page.getByRole("button", { name: "Ver concluídas" }).click();
  await expect(page).toHaveURL(/concluidas=1/);
  await expect(page.getByRole("heading", { name: "Tarefas concluídas" })).toBeVisible();

  const linhaConcluida = page.getByRole("listitem").filter({ hasText: titulo });
  await expect(linhaConcluida).toBeVisible();
  // Concluída não oferece "Concluir" de novo.
  await expect(linhaConcluida.getByRole("button", { name: "Concluir" })).toHaveCount(0);

  // ── Reabrir: volta para as pendentes ─────────────────────────────────
  await linhaConcluida.getByRole("button", { name: "Reabrir" }).click();
  await esperarConclusaoNoBanco(false);
  await expect(page.getByRole("listitem").filter({ hasText: titulo })).toHaveCount(0);

  await page.getByRole("button", { name: "Ver pendentes" }).click();
  await expect(page).not.toHaveURL(/concluidas=1/);
  const linhaReaberta = page.getByRole("listitem").filter({ hasText: titulo });
  await expect(linhaReaberta).toBeVisible();

  // ── Excluir pelo diálogo, não por window.confirm ─────────────────────
  await linhaReaberta.getByRole("button", { name: "Excluir tarefa" }).click();

  // `role="dialog"` de verdade no DOM. Se isto fosse `window.confirm`, este
  // localizador não encontraria nada e o teste travaria esperando um diálogo
  // nativo que só `page.on("dialog")` enxerga.
  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toBeVisible();

  // Cancelar primeiro: confirmação que não dá para recusar não é confirmação.
  await dialogo.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: titulo })).toBeVisible();

  await page.getByRole("listitem").filter({ hasText: titulo }).getByRole("button", { name: "Excluir tarefa" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Excluir", exact: true }).click();

  await expect(page.getByRole("listitem").filter({ hasText: titulo })).toHaveCount(0);

  // Fonte de verdade: o banco, não a tela. Uma remoção otimista que não
  // chegou ao Postgres pareceria idêntica daqui.
  await expect
    .poll(() => prisma.task.count({ where: { titulo: { contains: MARCA } } }), { timeout: 10_000 })
    .toBe(0);
});
