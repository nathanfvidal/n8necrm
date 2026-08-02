// Fluxo de negócio principal de ponta a ponta (Task 22): login real, criação
// manual de um lead pela UI, e a movimentação dele pelo funil até a etapa
// final ("Fechado", `ehGanho: true` — ver config/client.ts e prisma/seed.ts)
// no kanban (Task 15).
//
// Este arquivo toca o MESMO Postgres real e compartilhado que o app usa em
// dev (não há banco de teste isolado neste projeto — ver AGENTS.md/tasks
// anteriores) e por isso, como tests/unit/stage-transition.test.ts,
// tests/unit/lead-creation-resilience.test.ts etc., cria seu próprio
// PrismaClient para preparar/limpar dados. NÃO importamos `@/lib/prisma`:
// esse módulo tem `import "server-only"` (Task 17), que lança fora da
// condição de resolução "react-server" do Next — correto dentro do app, mas
// este arquivo roda como um processo Node comum sob o test runner do
// Playwright, não sob o pipeline de build do Next, então importar
// `@/lib/prisma` aqui quebraria só por isso, antes de qualquer teste rodar.
// Um PrismaClient próprio, escopado a este arquivo, é o mesmo padrão que os
// testes de banco em tests/unit/*.test.ts já usam para o mesmo problema (lá,
// contornado com `vi.mock("server-only", ...)`, que não existe fora do
// Vitest).
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { test, expect, type Page, type Locator } from "@playwright/test";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// Prefixo exclusivo deste arquivo — não colide com nenhum outro (ver a lista
// de prefixos em uso documentada em tests/unit/stage-transition.test.ts e
// tests/unit/lead-creation-resilience.test.ts: 1199999000{0..3} é o seed,
// 119977*/119888*/119555*/119666*/119444* já são de outros arquivos).
// Digitado sem formatação: `normalizarTelefone` (src/core/leads/dedupe.ts)
// não precisa inserir o 9º dígito nem remover código de país aqui (11
// dígitos, DDD 11 + celular já começando com 9), então o valor gravado é
// exatamente este literal — a limpeza abaixo pode usar o mesmo valor sem
// adivinhar a normalização.
const TELEFONE_TESTE = "11922223300";
const NOME_TESTE = "Cliente E2E";

/**
 * Remove tudo que este arquivo pode ter criado no Postgres real e
 * compartilhado: Notification (por tipo + leadId no payload, sem FK real —
 * mesmo raciocínio de stage-transition.test.ts), AuditLog, Lead e Contact.
 * Roda antes (limpa resíduo de uma execução anterior que tenha falhado no
 * meio) e depois (limpa o que esta execução criou) — seguro rodar quando não
 * há nada a limpar (`findUnique` devolve null e a função retorna cedo).
 */
async function limparDadosDeTeste(): Promise<void> {
  const contato = await prisma.contact.findUnique({ where: { telefone: TELEFONE_TESTE } });
  if (!contato) return;

  const leads = await prisma.lead.findMany({ where: { contactId: contato.id } });
  const leadIds = leads.map((lead) => lead.id);

  if (leadIds.length > 0) {
    const notificacoes = await prisma.notification.findMany({ where: { tipo: "NOVO_LEAD" } });
    const notificacaoIds = notificacoes
      .filter((notificacao) =>
        leadIds.includes((notificacao.payload as { leadId?: string } | null)?.leadId ?? "")
      )
      .map((notificacao) => notificacao.id);
    if (notificacaoIds.length > 0) {
      await prisma.notification.deleteMany({ where: { id: { in: notificacaoIds } } });
    }

    await prisma.auditLog.deleteMany({ where: { entidade: "Lead", entidadeId: { in: leadIds } } });
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  }

  await prisma.contact.deleteMany({ where: { telefone: TELEFONE_TESTE } });
}

test.beforeAll(async () => {
  await limparDadosDeTeste();
});

test.afterAll(async () => {
  await limparDadosDeTeste();
  await prisma.$disconnect();
});

function colunaPorNome(page: Page, nomeEtapa: string): Locator {
  return page.locator("div").filter({ hasText: nomeEtapa }).last();
}

/**
 * Primeiro caminho tentado para mover o card: um gesto de ponteiro real
 * (mousedown → vários mousemove → mouseup), não `locator.dragTo` (que faz só
 * um pulo direto de origem a destino) — o `PointerSensor` do dnd-kit
 * (kanban-board.tsx) tem `activationConstraint: { distance: 8 }`, ou seja,
 * só reconhece um arrasto depois de mexer o ponteiro pelo menos 8px sem
 * soltar; um "salto" único do `dragTo` corre risco de nunca dar ao sensor a
 * chance de calcular essa distância antes do mouseup.
 *
 * Verificado empiricamente (ver task-22-report.md): mesmo com viewport
 * alargado para caber as 5 colunas sem scroll horizontal, este caminho não
 * move o card em execução headless — o card permanece intacto na coluna de
 * origem depois do mouseup. Fica aqui, tentado de verdade antes do fallback
 * de teclado (não removido), porque é o gesto que corresponde ao uso real de
 * mouse, e o objetivo desta task é tentar o caminho genuíno antes de cair
 * para o caminho acessível.
 */
async function tentarArrastarComPonteiro(page: Page, card: Locator, colunaFinal: Locator): Promise<void> {
  const cardBox = await card.boundingBox();
  const colunaBox = await colunaFinal.boundingBox();
  if (!cardBox || !colunaBox) return;

  const origemX = cardBox.x + cardBox.width / 2;
  const origemY = cardBox.y + cardBox.height / 2;
  const destinoX = colunaBox.x + colunaBox.width / 2;
  const destinoY = colunaBox.y + colunaBox.height / 2;

  await page.mouse.move(origemX, origemY);
  await page.mouse.down();
  // Primeiro movimento pequeno, só para ultrapassar o activationConstraint
  // de 8px — depois disso o dnd-kit já está "armado" e o resto do gesto até
  // a coluna final é reconhecido como o arrasto em si.
  await page.mouse.move(origemX + 15, origemY + 15, { steps: 5 });
  await page.mouse.move(destinoX, destinoY, { steps: 20 });
  // Pausa curta antes de soltar: dá tempo do `closestCenter` (collision
  // detection) do dnd-kit recalcular sobre a coluna de destino antes do
  // `mouseup`.
  await page.waitForTimeout(150);
  await page.mouse.up();
}

/**
 * Segundo caminho, via `KeyboardSensor` (kanban-board.tsx): Espaço para
 * pegar o card, Setas para atravessar colunas (o `coordinateGetter`
 * customizado pula uma coluna inteira por toque — 304px, ver o comentário em
 * kanban-board.tsx), Espaço de novo para soltar. É o caminho acessível real
 * que uma pessoa sem mouse usaria — não um atalho de teste.
 *
 * Task 15 não conseguiu produzir esse gesto de forma confiável fora do
 * Playwright (nem screenshot nem `Space` sintético chegavam com
 * `event.code` preenchido nas ferramentas usadas até então). Aqui,
 * `page.keyboard.press` roda contra um Chromium real por trás do protocolo
 * do próprio Playwright — verificado empiricamente (ver task-22-report.md)
 * que isso funciona de ponta a ponta: o lead é realmente movido no banco
 * (não só na aparência do DOM), confirmado consultando `Lead.stageId` via
 * Prisma depois do gesto.
 */
async function tentarArrastarComTeclado(page: Page, card: Locator, colunasParaAvancar: number): Promise<void> {
  await card.focus();
  await page.keyboard.press("Space");
  for (let i = 0; i < colunasParaAvancar; i++) {
    await page.keyboard.press("ArrowRight");
    // Pequena folga entre toques: o `handleDragMove`/colisão do dnd-kit
    // reage a cada tecla via re-render do React; sem qualquer pausa, alguns
    // toques em sequência muito rápida (mais rápida que o event loop do
    // Chromium processa o re-render) podem ser processados sobre coordenadas
    // ainda não atualizadas.
    await page.waitForTimeout(100);
  }
  await page.keyboard.press("Space");
}

test("cria um lead manualmente e move até a etapa final do funil", async ({ page }) => {
  // O quadro (kanban-board.tsx) tem 5 colunas de 288px + 16px de gap dentro
  // de um container `overflow-x-auto` — 5 colunas cabem em ~1544px, mais que
  // o viewport padrão de `devices["Desktop Chrome"]` (1280px). Sem alargar,
  // a coluna "Fechado" fica parcialmente fora da área visível e
  // `boundingBox()` devolve coordenadas além do viewport, que `page.mouse`
  // não consegue mirar de verdade — alarga antes de qualquer tentativa de
  // arrasto para que nenhum dos dois caminhos perca só por geometria de
  // tela.
  await page.setViewportSize({ width: 1600, height: 900 });

  await test.step("login", async () => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill("admin@exemplo.com");
    await page.getByLabel("Senha").fill("senha123");
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL("/");
  });

  await test.step("cria o lead manualmente (Task 14)", async () => {
    await page.goto("/leads");
    await page.getByLabel("Nome").fill(NOME_TESTE);
    await page.getByLabel("Telefone").fill(TELEFONE_TESTE);
    await page.getByRole("button", { name: "Adicionar lead" }).click();

    await expect(page.getByText("Lead criado com sucesso.")).toBeVisible();
    await expect(page.getByText(NOME_TESTE)).toBeVisible();
  });

  await page.goto("/leads/kanban");
  const card = page.getByText(NOME_TESTE);
  const colunaFinal = colunaPorNome(page, "Fechado");

  await test.step("lead nasce na primeira etapa do funil", async () => {
    await expect(card).toBeVisible();
    await expect(colunaPorNome(page, "Novo").getByText(NOME_TESTE)).toBeVisible();
  });

  let cardNaColunaFinal = await test.step("tentativa 1: arrasto por ponteiro", async () => {
    await tentarArrastarComPonteiro(page, card, colunaFinal);
    await page.reload();
    return colunaFinal.getByText(NOME_TESTE).isVisible();
  });

  if (!cardNaColunaFinal) {
    cardNaColunaFinal = await test.step("tentativa 2: arrasto por teclado (fallback acessível)", async () => {
      // "Novo" é a etapa de índice 0 e "Fechado" é a última do funil
      // (config/client.ts) — 4 toques de seta para a direita atravessam as
      // 4 colunas intermediárias.
      await tentarArrastarComTeclado(page, page.getByText(NOME_TESTE), 4);
      await page.reload();
      return colunaFinal.getByText(NOME_TESTE).isVisible();
    });
  }

  expect(
    cardNaColunaFinal,
    "O card não chegou na coluna 'Fechado' nem por arrasto de ponteiro nem por teclado — " +
      "ver task-22-report.md para o que foi tentado e o que isso significa."
  ).toBe(true);

  await expect(colunaFinal.getByText(NOME_TESTE)).toBeVisible();

  // Confirmação a nível de banco, além da aparência do DOM: garante que o
  // que a UI mostra corresponde ao que `moverLeadDeEtapa` (Server Action,
  // actions.ts) de fato persistiu via `moverEtapa` (service.ts), não uma
  // coincidência de layout.
  const leadNoBanco = await prisma.lead.findFirstOrThrow({
    where: { contact: { telefone: TELEFONE_TESTE } },
    include: { stage: true },
  });
  expect(leadNoBanco.stage.nome).toBe("Fechado");
  expect(leadNoBanco.stage.ehGanho).toBe(true);
});
