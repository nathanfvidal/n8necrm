// Fluxo de negócio principal de ponta a ponta (Task 22): login real, criação
// manual de um lead pela UI, e a movimentação dele pelo funil até a etapa
// final ("Fechado", `ehGanho: true` — ver config/client.ts e prisma/seed.ts)
// no kanban (Task 15) — por ponteiro E por teclado, os dois mecanismos reais
// do `DndContext` (`kanban-board.tsx`), não um "tenta A, se não der finge que
// tanto faz e tenta B" (ver fix round 1/5 abaixo sobre por que a versão
// anterior deste arquivo escondia exatamente esse tipo de falha).
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
import { SESSAO_ADMIN } from "./credenciais";

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
 *
 * `test.afterAll` do Playwright roda mesmo quando o teste falha (não é um
 * `try/finally` manual que alguém poderia esquecer de colocar em volta de um
 * `expect` novo) — é o que garante que uma falha real de asserção no meio do
 * teste (inclusive as introduzidas de propósito no fix round 1/5, ver
 * task-22-report.md) não deixa resíduo no Postgres compartilhado.
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

function escapeRegExp(valor: string): string {
  return valor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Localiza a coluna do kanban pelo NOME DA ETAPA, ancorada no `<h3>` que
 * `kanban-board.tsx` renderiza como "{etapa.nome} ({leads.length})" — não
 * mais `page.locator("div").filter({ hasText })` (fix round 1/5, achado do
 * revisor): esse seletor antigo não tinha nenhuma garantia estrutural de que
 * `.last()` resolvia para o `<div>` da coluna certa, só uma coincidência de
 * ordem no DOM (funcionava, mas por acidente de quantos `<div>` continham
 * aquele texto em cada momento).
 *
 * `getByRole("heading", ...)` mira o `<h3>` pelo texto (com o contador entre
 * parênteses tratado como curinga — o número muda a cada lead que entra ou
 * sai da coluna), e `.locator("..")` sobe para o pai imediato — que, na
 * estrutura de `Coluna` (`kanban-board.tsx`: `<div ref={setNodeRef}>` como
 * único ancestral direto do `<h3>`), É o próprio `<div>` da coluna, sempre,
 * por construção do componente — não por coincidência de conteúdo.
 */
function colunaPorNome(page: Page, nomeEtapa: string): Locator {
  const padrao = new RegExp(`^${escapeRegExp(nomeEtapa)} \\(\\d+\\)$`);
  return page.getByRole("heading", { name: padrao }).locator("..");
}

/**
 * Localiza o card de um lead DENTRO de uma coluna já resolvida, pelo
 * `aria-label` real do componente (`kanban-card.tsx`: `aria-label={`Lead
 * ${nomeContato}, canal ...`}`, com `role="button"` vindo de `attributes` do
 * `useDraggable`). Fix round 1/5 (achado do revisor, CRITICAL): a versão
 * anterior usava `page.getByText(NOME_TESTE)`, que resolve para o `<p>`
 * INTERNO com o nome do contato — não o `<div>` externo que de fato tem
 * `tabIndex`/`role`/os `listeners` do dnd-kit (`{...listeners} {...attributes}`
 * espalhados no `<Card>`, não no `<p>` dentro dele). Um `.focus()` num `<p>`
 * sem `tabindex` é um no-op silencioso — o revisor confirmou isso
 * instrumentando `document.activeElement` (permanecia `BODY`) — e por isso o
 * `KeyboardSensor` nunca recebia o `keydown` (seu activator exige
 * `event.target === active.activatorNode.current`, e um `keydown` disparado
 * com foco em `BODY` nunca "desce" até um `<div>` descendente). Mirar direto
 * o elemento com `role="button"` é o que torna `.focus()` real.
 */
function cardEm(coluna: Locator, nomeContato: string): Locator {
  return coluna.getByRole("button", { name: `Lead ${nomeContato}`, exact: false });
}

/**
 * Espera a escrita realmente terminar no Postgres antes de qualquer
 * `page.reload()` — consultando o banco de verdade, com retentativa, não um
 * `waitForTimeout` arbitrário. Fix round 1/5 (achado do revisor, CRITICAL):
 * a versão anterior dava `page.reload()` imediatamente depois do gesto de
 * arrasto, torcendo para que o round-trip da Server Action
 * (`moverLeadDeEtapa` → `moverEtapa`, ambas em `src/core/leads/`) já tivesse
 * terminado. Às vezes não tinha — o reload vencia a corrida, a tela recém
 * carregada mostrava o estado ANTIGO, e um `isVisible()` de uma vez só (sem
 * retentativa) lia isso como "o arrasto falhou", silenciosamente. Consultar
 * o próprio banco até ele confirmar a etapa esperada (ou estourar o timeout,
 * que aí sim é uma falha real, não uma corrida) é a fonte de verdade
 * correta: não há como um reload "vencer" uma escrita que já está commitada.
 */
async function esperarLeadNaEtapaNoBanco(
  telefone: string,
  nomeEtapaEsperado: string,
  // 5000ms flakou uma vez (achado da revisão final de branch): o orçamento
  // precisa cobrir ativação do sensor de arrasto + round-trip da Server
  // Action + a escrita chegar no Postgres REMOTO do Supabase, não um banco
  // local — 15s dá folga real para jitter de rede sem esconder uma
  // regressão de verdade (o teste segue falhando se o lead nunca chegar na
  // etapa esperada, só espera mais antes de declarar isso).
  timeoutMs = 15_000
): Promise<void> {
  const inicio = Date.now();
  let ultimaEtapaObservada: string | undefined;

  while (Date.now() - inicio < timeoutMs) {
    const lead = await prisma.lead.findFirst({
      where: { contact: { telefone } },
      include: { stage: true },
    });
    ultimaEtapaObservada = lead?.stage.nome;
    if (ultimaEtapaObservada === nomeEtapaEsperado) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(
    `Timeout (${timeoutMs}ms) esperando o lead de telefone "${telefone}" chegar na etapa ` +
      `"${nomeEtapaEsperado}" no Postgres — última etapa observada: "${ultimaEtapaObservada}". ` +
      "Isto significa que o gesto de arrasto NÃO moveu o lead de verdade (não é uma corrida de " +
      "reload: esta função consulta o banco até bater ou estourar o prazo)."
  );
}

/**
 * Move o card por um gesto de ponteiro real (mousedown → vários mousemove →
 * mouseup), não `locator.dragTo` (que faz só um pulo direto de origem a
 * destino) — o `PointerSensor` do dnd-kit (kanban-board.tsx) tem
 * `activationConstraint: { distance: 8 }`, ou seja, só reconhece um arrasto
 * depois de mexer o ponteiro pelo menos 8px sem soltar; um "salto" único do
 * `dragTo` corre risco de nunca dar ao sensor a chance de calcular essa
 * distância antes do mouseup.
 *
 * Fix round 1/5 (achado do revisor): o relato original desta task dizia que
 * este caminho "não funciona em modo headless" — CONCLUSÃO INVERTIDA. O
 * ponteiro funciona; o que não funcionava era o teste, que dava
 * `page.reload()` imediatamente após o `mouseup()`, torcendo contra o
 * round-trip da Server Action ainda em voo (ver `esperarLeadNaEtapaNoBanco`
 * acima) — a corrida quase sempre terminava com o reload vencendo, o teste
 * lendo isso como "ponteiro falhou" e caindo, sem aviso, para uma segunda
 * tentativa por teclado que também estava quebrada por um motivo
 * DIFERENTE (`cardEm` abaixo). As duas quebras se mascaravam mutuamente: a
 * suíte ficava verde, mas por um motivo que não tinha relação com o que o
 * relato afirmava.
 */
async function arrastarComPonteiro(page: Page, card: Locator, colunaDestino: Locator): Promise<void> {
  const cardBox = await card.boundingBox();
  const colunaBox = await colunaDestino.boundingBox();
  if (!cardBox || !colunaBox) {
    throw new Error("boundingBox() indisponível para o card ou para a coluna de destino — elemento fora da tela?");
  }

  const origemX = cardBox.x + cardBox.width / 2;
  const origemY = cardBox.y + cardBox.height / 2;
  const destinoX = colunaBox.x + colunaBox.width / 2;
  const destinoY = colunaBox.y + colunaBox.height / 2;

  await page.mouse.move(origemX, origemY);
  await page.mouse.down();
  // Primeiro movimento pequeno, só para ultrapassar o activationConstraint
  // de 8px — depois disso o dnd-kit já está "armado" e o resto do gesto até
  // a coluna de destino é reconhecido como o arrasto em si.
  await page.mouse.move(origemX + 15, origemY + 15, { steps: 5 });
  await page.mouse.move(destinoX, destinoY, { steps: 20 });
  // Pausa curta antes de soltar: dá tempo do `closestCenter` (collision
  // detection) do dnd-kit recalcular sobre a coluna de destino antes do
  // `mouseup`. Sem relação com a corrida de reload corrigida acima — isto é
  // só sobre o instante do drop em si, dentro do próprio gesto.
  await page.waitForTimeout(150);
  await page.mouse.up();
}

/**
 * Move o card uma coluna para a esquerda ou direita via `KeyboardSensor`
 * (kanban-board.tsx): Espaço para pegar o card focado, uma seta para
 * atravessar exatamente uma coluna (o `coordinateGetter` customizado pula
 * uma coluna inteira por toque — 304px, ver o comentário em
 * kanban-board.tsx), Espaço de novo para soltar. É o caminho acessível real
 * que uma pessoa sem mouse usaria.
 *
 * Fix round 1/5 (achado do revisor, CRITICAL): a versão anterior focava
 * `page.getByText(NOME_TESTE)` — o `<p>` interno, não o `<div>` com
 * `tabIndex`/`role`/os listeners do dnd-kit — então `.focus()` era um no-op
 * e o `Space` nunca ativava o sensor (`event.target` chegava como `BODY`,
 * nunca o `activatorNode` real). O teste só passava porque a tentativa 1
 * (ponteiro) já tinha movido o lead de verdade antes do reload — a suíte
 * ficava verde sem o caminho de teclado ter feito nada. Corrigido usando
 * `cardEm` (mira o `<div role="button">` de verdade); confirmado que
 * `.focus()` agora move `document.activeElement` para esse elemento antes de
 * remover a instrumentação de diagnóstico.
 */
/**
 * Fix (achado do revisor na verificação da rodada final): a versão anterior
 * apostava num `page.waitForTimeout(100)` fixo entre a seta e o Space de
 * soltar, torcendo para que o `handleDragMove`/colisão do dnd-kit já tivesse
 * re-renderizado sobre a coluna de destino nesse intervalo. Sob 4 workers
 * paralelos (`playwright.config.ts`) nem sempre bastava: o revisor rodou a
 * suíte 3x e pegou uma falha real — "última etapa observada: Fechado" depois
 * de 15s, ou seja, o Space de soltar chegou com `over` ainda `null`
 * (`handleDragEnd` em kanban-board.tsx devolve cedo quando `!over`, sem
 * mover nada) — não uma execução lenta que só precisava de mais tempo.
 *
 * A correção segue o mesmo princípio de `esperarLeadNaEtapaNoBanco`: esperar
 * por um sinal observável real, não chutar uma duração. `Coluna` (
 * kanban-board.tsx) usa `useDroppable` e aplica a classe `bg-muted/50`
 * exatamente quando `isOver` fica `true` para aquela coluna — esse estado é
 * calculado pelo mesmo motor de colisão do `DndContext` (`closestCenter`)
 * para os dois sensores, ponteiro e teclado, então esperar essa classe
 * aparecer na coluna de destino é prova de que o dnd-kit já reconhece a
 * coluna como alvo, não uma suposição sobre timing de re-render do React.
 */
async function arrastarComTeclado(
  page: Page,
  card: Locator,
  colunaDestino: Locator,
  tecla: "ArrowLeft" | "ArrowRight"
): Promise<void> {
  // Espera a hidratação antes de mexer no teclado. O card fica VISÍVEL já no
  // HTML do servidor, mas o `KeyboardSensor` do dnd-kit só passa a escutar
  // depois que o React hidrata — antes disso, o Space de pegar não é ouvido
  // por ninguém, `over` fica `null`, e a coluna de destino nunca recebe
  // `bg-muted/50`. O sintoma é exatamente o de um arrasto que "não funciona".
  //
  // Este passo faltava, e a suíte só não cobrava porque era lenta o
  // bastante: a hidratação terminava durante a espera de outra coisa. Ao
  // desligar o prefetch da navegação do painel (`painel-nav.tsx`), a suíte
  // ficou ~25% mais rápida e esta folga não declarada sumiu — o teste passou
  // a falhar sempre, no mesmo ponto. Mesmo `waitForLoadState("networkidle")`
  // que o helper de login de `whatsapp-agente.spec.ts` já usa pelo mesmo
  // motivo.
  await page.waitForLoadState("networkidle");

  // A tomada do card é REPETIDA até funcionar, e isto não é chute de timing —
  // é a única forma de esperar por algo que não tem sinal observável próprio.
  //
  // `networkidle` acima garante que os scripts chegaram, mas não que o React
  // já hidratou. Antes da hidratação o card está visível (veio no HTML do
  // servidor) e o `KeyboardSensor` do dnd-kit ainda não escuta: o Space de
  // pegar não é ouvido por ninguém, `over` fica `null`, e a coluna de destino
  // nunca recebe `bg-muted/50`. Não há atributo no DOM que diga "hidratado",
  // então o único sinal confiável é o próprio arrasto responder.
  //
  // `toPass` repete o bloco inteiro até ele passar. O `Escape` no começo de
  // cada tentativa cancela um arrasto que porventura tenha começado na
  // tentativa anterior — sem ele, um segundo Space viraria "soltar" em vez de
  // "pegar", e a repetição alternaria entre os dois estados para sempre.
  //
  // Isto NÃO afrouxa o que o teste prova: a asserção continua sendo a coluna
  // de destino acender, e se o arrasto por teclado estiver realmente quebrado
  // nenhuma repetição salva — o `toPass` estoura e o teste falha.
  //
  // Ficou visível ao desligar o prefetch da navegação do painel
  // (`painel-nav.tsx`): a suíte ficou ~25% mais rápida e a folga não
  // declarada de que este teste dependia sumiu.
  await expect(async () => {
    await page.keyboard.press("Escape");
    await card.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press(tecla);
    await expect(colunaDestino).toHaveClass(/bg-muted\/50/, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  await page.keyboard.press("Space");
}

// Arquivo de um teste só, e ele apenas precisa estar logado como ADMIN —
// então a sessão gravada por `auth.setup.ts` serve ao arquivo inteiro.
test.use({ storageState: SESSAO_ADMIN });

test("cria um lead manualmente e move até a etapa final do funil", async ({ page }) => {
  // O quadro (kanban-board.tsx) tem colunas de 288px + 16px de gap dentro de
  // um container `overflow-x-auto`, mais largo que o viewport padrão de
  // `devices["Desktop Chrome"]` (1280px). Este valor inicial só cobre as
  // telas de ANTES do quadro (criar o lead) — depois de navegar para
  // `/leads/kanban`, o viewport é realargado de novo, conforme o número real
  // de colunas do funil (ver comentário mais abaixo). Desde o CRUD de etapas
  // esse número deixou de ser fixo em 5, e um viewport calibrado só para 5
  // colunas é, ele mesmo, um defeito represado — mesmo raciocínio do
  // `md:grid-cols-5` do painel, corrigido na Task do CRUD de etapas.
  await page.setViewportSize({ width: 1600, height: 900 });

  // Sem passo de login: a sessão vem de `auth.setup.ts` (ver `test.use`
  // acima). O login aqui sempre foi pré-requisito, nunca o objeto do teste —
  // e cada um gasta cota do teto de 10 por conta a cada 10 minutos.

  await test.step("cria o lead manualmente (Task 14)", async () => {
    await page.goto("/leads");
    await page.getByLabel("Nome").fill(NOME_TESTE);
    await page.getByLabel("Telefone").fill(TELEFONE_TESTE);
    await page.getByRole("button", { name: "Adicionar lead" }).click();

    await expect(page.getByText("Lead criado com sucesso.")).toBeVisible();
    await expect(page.getByText(NOME_TESTE)).toBeVisible();
  });

  await page.goto("/leads/kanban");

  // Até o CRUD de etapas o funil tinha cinco colunas fixas e 1600px bastava.
  // Agora o tamanho do funil é variável, e uma coluna a mais empurra a última
  // para fora do viewport: `boundingBox()` passa a devolver coordenada fora
  // da tela, o `autoScroll` do dnd-kit assume o gesto (fica rolando o quadro
  // enquanto o ponteiro fica parado além da borda — ver `arrastarComPonteiro`
  // abaixo) e o card cai numa coluna diferente da que o teste mirou. O
  // viewport passa a acompanhar o funil em vez de presumir cinco colunas.
  // `304` é `COLUNA_PASSO_PX` (`kanban-board.tsx`: `w-72` = 288px + `gap-4` =
  // 16px, a distância entre o início de uma coluna e o início da próxima);
  // `200` é folga para a margem/padding fora do `flex` de colunas em si.
  const totalDeColunas = await page.getByRole("heading", { name: /^.+ \(\d+\)$/ }).count();
  await page.setViewportSize({
    width: Math.max(1600, totalDeColunas * 304 + 200),
    height: 900,
  });

  const colunaNovo = colunaPorNome(page, "Novo");
  const colunaProposta = colunaPorNome(page, "Proposta");
  const colunaFechado = colunaPorNome(page, "Fechado");

  await test.step("lead nasce na primeira etapa do funil", async () => {
    await expect(cardEm(colunaNovo, NOME_TESTE)).toBeVisible();
  });

  // --- Caminho 1: ponteiro (mouse real), do início ao fim do funil. Esta é
  // a movimentação que corresponde ao fluxo de negócio da task ("do lead
  // manual ao funil ganho"). Nenhum fallback aqui: se o arrasto não mover o
  // lead de verdade, `esperarLeadNaEtapaNoBanco` estoura e o teste FALHA —
  // não cai silenciosamente para outra tentativa (ver fix round 1/5 acima).
  await test.step("arrasto por ponteiro: Novo → Fechado", async () => {
    await arrastarComPonteiro(page, cardEm(colunaNovo, NOME_TESTE), colunaFechado);
    await esperarLeadNaEtapaNoBanco(TELEFONE_TESTE, "Fechado");
    await page.reload();
    await expect(cardEm(colunaFechado, NOME_TESTE)).toBeVisible();
  });

  // --- Caminho 2: teclado (KeyboardSensor), verificado como uma segunda
  // afirmação REAL e independente — não como rede de segurança do caminho
  // 1. Vai e volta (Fechado → Proposta → Fechado) para provar o mecanismo
  // nos dois sentidos e terminar o teste com o lead de volta na etapa final
  // (o estado de negócio que a task pede).
  await test.step("arrasto por teclado: Fechado → Proposta", async () => {
    await arrastarComTeclado(page, cardEm(colunaFechado, NOME_TESTE), colunaProposta, "ArrowLeft");
    await esperarLeadNaEtapaNoBanco(TELEFONE_TESTE, "Proposta");
    await page.reload();
    await expect(cardEm(colunaProposta, NOME_TESTE)).toBeVisible();
  });

  await test.step("arrasto por teclado: Proposta → Fechado", async () => {
    await arrastarComTeclado(page, cardEm(colunaProposta, NOME_TESTE), colunaFechado, "ArrowRight");
    await esperarLeadNaEtapaNoBanco(TELEFONE_TESTE, "Fechado");
    await page.reload();
    await expect(cardEm(colunaFechado, NOME_TESTE)).toBeVisible();
  });

  // Confirmação final a nível de banco, além da aparência do DOM: garante
  // que o que a UI mostra corresponde ao que `moverLeadDeEtapa` (Server
  // Action, actions.ts) de fato persistiu via `moverEtapa` (service.ts), e
  // que a etapa final é genuinamente a etapa "ganha" do funil (não só uma
  // etapa qualquer chamada "Fechado").
  const leadNoBanco = await prisma.lead.findFirstOrThrow({
    where: { contact: { telefone: TELEFONE_TESTE } },
    include: { stage: true },
  });
  expect(leadNoBanco.stage.nome).toBe("Fechado");
  expect(leadNoBanco.stage.ehGanho).toBe(true);
});
