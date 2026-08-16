// Prova, num navegador de verdade, o ciclo que esta fatia abriu: registrar
// quanto vale um negócio, tirar o lead do funil e devolvê-lo.
//
// ## O passo que mais importa
//
// Arquivar só funciona se TODAS as listagens filtrarem. O teste percorre a
// lista, o kanban e — logo depois — o histórico do contato, onde o lead
// arquivado PRECISA continuar aparecendo. Essa assimetria é deliberada (§ 8
// da spec): o funil fica limpo, o histórico da pessoa continua completo.
//
// ## Por que loga como VENDEDOR
//
// Editar e arquivar reusam a permissão `mover_lead`, que todo papel tem —
// lead é colaborativo neste CRM. Logar como vendedor é o que garante que a
// tela não ganhou um gate de ADMIN por descuido. De quebra, distribui o
// orçamento de tentativas de login (10 por conta a cada 10 minutos, ver
// core/rate-limit/login.ts), que os testes de admin já consomem quase todo.
//
// Limpeza por MARCA no nome, antes e depois — `test.afterAll` roda mesmo com
// teste falhando, então uma asserção quebrada não deixa lixo no banco
// compartilhado com produção.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { test, expect } from "@playwright/test";
import { EMAIL_VENDEDOR_E2E, senhaE2e } from "./credenciais";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// Marca que nenhum contato real tem, e faixa de telefone que nem o seed
// (1199999000x), nem os unitários (11988887xxx), nem os outros e2e
// (11988886001/6002 em contatos, 11922223300 em lead-to-won) usam.
const MARCA = "ZZE2EEdicao";
const TELEFONE = "11977775001";

async function limparDadosDeTeste(): Promise<void> {
  const contatos = await prisma.contact.findMany({
    where: { OR: [{ nome: { contains: MARCA } }, { telefone: TELEFONE }] },
    select: { id: true },
  });
  const idsContatos = contatos.map((c) => c.id);
  if (idsContatos.length === 0) return;

  const leads = await prisma.lead.findMany({
    where: { contactId: { in: idsContatos } },
    select: { id: true },
  });
  const idsLeads = leads.map((l) => l.id);

  // Escopo por `entidadeId`, nunca por `userId`: a auditoria é gravada em
  // nome do vendedor de teste, e apagar "os AuditLog dele" levaria junto
  // histórico real.
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { entidade: "Contact", entidadeId: { in: idsContatos } },
        { entidade: "Lead", entidadeId: { in: idsLeads } },
      ],
    },
  });
  await prisma.task.deleteMany({ where: { leadId: { in: idsLeads } } });
  await prisma.leadNote.deleteMany({ where: { leadId: { in: idsLeads } } });
  await prisma.lead.deleteMany({ where: { id: { in: idsLeads } } });
  await prisma.contact.deleteMany({ where: { id: { in: idsContatos } } });
}

// Serial pelo mesmo motivo dos outros arquivos: `beforeAll`/`afterAll` do
// Playwright rodam por WORKER, não por arquivo, e com limpeza por marca
// compartilhada um grupo apagaria o dado do outro.
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await limparDadosDeTeste();
});

test.afterAll(async () => {
  await limparDadosDeTeste();
  await prisma.$disconnect();
});

test("vendedor registra o valor, arquiva e desarquiva um lead", async ({ page }) => {
  const nome = `Cliente ${MARCA}`;

  await test.step("login", async () => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("E-mail").fill(EMAIL_VENDEDOR_E2E);
    await page.getByLabel("Senha").fill(senhaE2e());
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL("/");
  });

  await test.step("cria o lead", async () => {
    await page.goto("/leads");
    await page.getByLabel("Nome", { exact: true }).fill(nome);
    await page.getByLabel("Telefone", { exact: true }).fill(TELEFONE);
    await page.getByRole("button", { name: "Adicionar lead" }).click();
    await expect(page.getByText("Lead criado com sucesso.")).toBeVisible();
  });

  await page.getByRole("link", { name: nome }).click();
  await page.waitForURL(/\/leads\/.+/);

  const campoValor = page.getByLabel("Valor estimado");

  await test.step("o valor se monta pela direita, sem separador digitado", async () => {
    // Os algarismos são CENTAVOS: 150000000 centavos = R$ 1.500.000,00. É a
    // conferência visual que protege contra confundir 150 mil com 1,5 milhão.
    await campoValor.fill("150000000");
    await expect(campoValor).toHaveValue("1.500.000,00");
  });

  await test.step("salva e o valor persiste ao recarregar", async () => {
    // `exact` obrigatório: a mesma página tem "Salvar nota", e o nome
    // acessível casa por substring quando não é exato.
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.getByText("Lead salvo.")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Valor estimado")).toHaveValue("1.500.000,00");
  });

  await test.step("arquiva", async () => {
    // Arquivar faz o lead sumir de quatro telas — por isso a confirmação.
    //
    // Antes isto era `window.confirm`, e este passo dependia de
    // `page.once("dialog", d => d.accept())`: um canal lateral que precisa ser
    // armado ANTES do clique e que, se ninguém armar, faz o Playwright
    // descartar o diálogo sozinho — o clique "funciona", nada acontece, e a
    // falha aparece na asserção seguinte sem dizer por quê. Com `Dialog` a
    // confirmação é DOM de verdade: clicável, inspecionável, e um passo que
    // esqueça de confirmar falha apontando para o botão que não foi clicado.
    //
    // `exact` de novo, e aqui por um motivo pior: "Arquivar" é substring de
    // "Desarquivar", então sem isto o localizador casaria com o botão do
    // estado oposto. É também por isso que o botão do diálogo se chama
    // "Arquivar lead" e não "Arquivar" — os dois coexistem no DOM enquanto o
    // diálogo está aberto.
    await page.getByRole("button", { name: "Arquivar", exact: true }).click();

    const dialogo = page.getByRole("dialog");
    await expect(dialogo).toBeVisible();
    // Cancelar primeiro: confirmação que não dá para recusar não é
    // confirmação, e um diálogo que fecha sem agir é o que garante que o
    // "sim" abaixo é o que de fato arquiva.
    await dialogo.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialogo).toBeHidden();
    await expect(page.getByRole("button", { name: "Arquivar", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Arquivar", exact: true }).click();
    await page.getByRole("button", { name: "Arquivar lead" }).click();
    await expect(page.getByRole("button", { name: "Desarquivar", exact: true })).toBeVisible();
  });

  await test.step("sumiu da lista", async () => {
    await page.goto("/leads");
    await expect(page.getByRole("link", { name: nome })).toHaveCount(0);
  });

  await test.step("sumiu do kanban", async () => {
    // O painel (`/`) consome exatamente a mesma `listarLeadsPorEtapa` que o
    // kanban, e `tests/unit/leads-arquivar.test.ts` prova o filtro nas duas
    // chamadas. Aqui não afirmamos nada sobre a CONTAGEM do painel de
    // propósito: ela é um número global, e `lead-to-won.spec.ts` cria leads
    // em paralelo (3 workers) — a asserção passaria a depender de quem
    // terminou primeiro. Um teste que falha por corrida é ignorado, e um
    // teste ignorado não protege nada.
    await page.goto("/leads/kanban");
    await expect(page.getByText(nome)).toHaveCount(0);
  });

  await test.step("CONTINUA no histórico do contato, marcado", async () => {
    const contato = await prisma.contact.findUnique({
      where: { telefone: TELEFONE },
      select: { id: true },
    });
    expect(contato).not.toBeNull();

    await page.goto(`/contatos/${contato!.id}`);
    await expect(page.getByRole("heading", { name: "Leads (1)" })).toBeVisible();
    // `visible: true`: este `getByText` roda logo depois de um `goto`, e
    // desde o `(painel)/loading.tsx` o SSR do painel faz streaming — o React
    // entrega o conteúdo dentro de um `<div hidden>` e um script inline o
    // move para o lugar, então nessa janela o selo existe DUAS vezes no DOM
    // e o modo estrito do Playwright falha na hora. A explicação completa,
    // com a verificação de que não é defeito de produção, está em
    // `whatsapp-agente.spec.ts` (função `seloVisivel`).
    await expect(page.getByText("Arquivado").filter({ visible: true })).toBeVisible();
  });

  await test.step("o alternador acha o arquivado e o desarquiva", async () => {
    await page.goto("/leads?arquivados=1");
    const linha = page.getByRole("row").filter({ hasText: nome });
    await expect(linha).toContainText("Arquivado");

    await page.getByRole("link", { name: nome }).click();
    await page.waitForURL(/\/leads\/.+/);

    await page.getByRole("button", { name: "Desarquivar", exact: true }).click();
    // "Devolver ao funil", e não "Desarquivar": mesma regra do outro sentido —
    // gatilho e confirmação coexistem no DOM e precisam de nomes distintos.
    await page.getByRole("button", { name: "Devolver ao funil" }).click();
    await expect(page.getByRole("button", { name: "Arquivar", exact: true })).toBeVisible();

    await page.goto("/leads");
    await expect(page.getByRole("link", { name: nome })).toBeVisible();
  });
});
