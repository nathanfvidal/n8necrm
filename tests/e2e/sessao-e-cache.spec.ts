// `dotenv/config` primeiro, e `PrismaClient` próprio em vez de `@/lib/prisma`
// (que tem `import "server-only"` e quebraria fora do pipeline de build do
// Next) — mesmo padrão de `equipe.spec.ts`, pelo mesmo motivo.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { test, expect, type Page } from "@playwright/test";

import { EMAIL_ADMIN_E2E, senhaE2e } from "./credenciais";

/**
 * O cache de cliente não sobrevive ao logout.
 *
 * ## Por que este arquivo existe
 *
 * `next.config.ts` liga `experimental.staleTimes.dynamic: 30`: uma aba
 * visitada nos últimos 30 segundos volta do cache do navegador, sem tocar no
 * servidor. É o que torna a troca de aba instantânea — e é exatamente o tipo
 * de mecanismo capaz de ressuscitar, por outro caminho, o defeito que este
 * projeto já teve: um logout que um prefetch de `<Link>` desfazia, com o
 * Auth.js reemitindo o cookie de sessão (AGENTS.md, e a tabela de armadilhas
 * da skill de auditoria em *"Sessão que sobrevive"*).
 *
 * A pergunta que isto responde é concreta: numa revenda com computador
 * compartilhado, alguém clica em "Sair", levanta, e a próxima pessoa aperta o
 * botão voltar. O que aparece?
 *
 * ## Login próprio, sem `storageState`
 *
 * Este teste PRECISA deslogar de verdade, e o `storageState` é um arquivo
 * compartilhado por toda a suíte (`auth.setup.ts`). Deslogar a partir dele
 * não corromperia o arquivo — ele é lido, não reescrito — mas o login aqui é
 * o objeto do teste, não um pré-requisito, mesma razão de `auth.spec.ts` e
 * `equipe.spec.ts` logarem por conta própria.
 */
test("depois de sair, o botão voltar não traz o painel de volta", async ({ page }) => {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("E-mail").fill(EMAIL_ADMIN_E2E);
  await page.getByLabel("Senha").fill(senhaE2e());
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("/");
  // Espera a hidratacao antes de clicar na barra lateral. Sem isto, sob
  // carga, o clique chega antes de o React assumir o <Link> e o navegador faz
  // uma navegacao de PAGINA INTEIRA em vez de client-side -- outro caminho de
  // render, com outro comportamento de esqueleto e de cache. E a mesma
  // armadilha ja documentada em auth.setup.ts (clicar antes da hidratacao
  // recarrega a pagina em vez de submeter o formulario).
  await page.waitForLoadState("networkidle");

  // Duas telas com dado real, para que exista MESMO algo em cache quando o
  // logout acontecer. Sem visitar nada, o teste passaria por não haver o que
  // ressuscitar — verde sem provar nada.
  await page.getByRole("link", { name: "Leads", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Leads", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Contatos", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Contatos", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Sair" }).first().click();
  await page.waitForURL("**/login");

  // O voltar acontece BEM dentro da janela de 30 s — é o caso difícil. Se
  // esperássemos a janela expirar, o teste passaria por decurso de prazo e
  // não por revogação, que é o que precisa ser provado.
  await page.goBack();
  await esperarARevogacaoAcontecer(page);

  // A régua é o DADO, não a URL: um painel servido do cache com a URL
  // "certa" seria pior que um redirecionamento tardio. Nenhuma das duas telas
  // visitadas pode reaparecer.
  await expect(page.getByRole("heading", { name: "Contatos", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Leads", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Equipe", exact: true })).toHaveCount(0);

  // E voltar mais uma vez, alcançando a outra tela em cache, também não pode
  // trazer nada.
  await page.goBack();
  await esperarARevogacaoAcontecer(page);
  await expect(page.getByRole("heading", { name: "Leads", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("usuario-logado")).toHaveCount(0);
});

/**
 * Espera o roteador POUSAR em `/login` depois de um `goBack`.
 *
 * ## Por que sem isto o teste falha 1 vez em 3
 *
 * Medido em 2026-08-20, quatro execuções focadas deste arquivo: duas verdes,
 * duas com
 *
 *     page.goBack: net::ERR_ABORTED; maybe frame was detached?
 *
 * **no SEGUNDO** `goBack`. `page.goBack()` espera o evento `load` do
 * documento, e é só isso: a tela em cache volta do histórico sem tocar o
 * servidor (é o que `staleTimes.dynamic: 30` compra), o roteador do Next então
 * busca o RSC, recebe a recusa de `usuarioAtual()` e faz a troca para
 * `/login` — uma navegação de CLIENTE que começa depois do `load` e que o
 * `goBack` não espera.
 *
 * As três asserções entre um `goBack` e o outro não seguram nada:
 * `toHaveCount(0)` é verdadeira NA HORA enquanto a página está em trânsito,
 * justamente porque não há elemento nenhum. O segundo `goBack` saía então em
 * cima da troca ainda em voo, e o Chromium abortava a que chegou depois.
 *
 * Isto NÃO afrouxa a asserção: se a revogação não acontecesse — painel
 * servido do cache com a URL "certa", que é o pior caso descrito na docstring
 * do teste —, esta espera estouraria o tempo e o teste falharia aqui, antes
 * mesmo de chegar às contagens. É um ponto de pouso, não uma tolerância.
 */
async function esperarARevogacaoAcontecer(page: Page): Promise<void> {
  await page.waitForURL(/\/login/);
}

/**
 * A outra metade da mesma pergunta: com a sessão VIVA, o cache pode servir a
 * tela — é para isso que ele foi ligado. Sem esta asserção, alguém poderia
 * "consertar" o teste acima desligando o cache por inteiro e a suíte ficaria
 * verde tendo perdido a coisa que a branch entrega.
 */
test("com sessão viva, voltar para uma aba recente não recarrega do servidor", async ({
  page,
}) => {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("E-mail").fill(EMAIL_ADMIN_E2E);
  await page.getByLabel("Senha").fill(senhaE2e());
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("/");
  // Espera a hidratacao antes de clicar na barra lateral. Sem isto, sob
  // carga, o clique chega antes de o React assumir o <Link> e o navegador faz
  // uma navegacao de PAGINA INTEIRA em vez de client-side -- outro caminho de
  // render, com outro comportamento de esqueleto e de cache. E a mesma
  // armadilha ja documentada em auth.setup.ts (clicar antes da hidratacao
  // recarrega a pagina em vez de submeter o formulario).
  await page.waitForLoadState("networkidle");

  await page.getByRole("link", { name: "Leads", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Leads", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Contatos", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Contatos", exact: true })).toBeVisible();

  // A partir daqui, qualquer pedido de `/leads` ao servidor é falha: a volta
  // tem que sair do cache do cliente. É a asserção que dá sentido aos 30 s.
  let foiAoServidor = false;
  page.on("request", (requisicao) => {
    if (new URL(requisicao.url()).pathname === "/leads") foiAoServidor = true;
  });

  await page.getByRole("link", { name: "Leads", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Leads", exact: true })).toBeVisible();

  expect(
    foiAoServidor,
    "voltar para /leads dentro da janela de 30 s foi ao servidor — staleTimes.dynamic não está valendo"
  ).toBe(false);
});

/**
 * O que a janela de 30 s NÃO pode custar: desativar alguém precisa continuar
 * revogando o que importa, na hora.
 *
 * ## O buraco que este teste fecha
 *
 * A auditoria (`docs/auditorias/2026-08-15-tempo-de-resposta-do-painel.md`,
 * R1) mediu que, com `staleTimes.dynamic: 30`, uma pessoa desativada no meio
 * da sessão CONTINUA vendo, por até 30 segundos, as telas que já tinha
 * aberto: a navegação client-side é servida do cache do próprio navegador e
 * nunca chama o servidor, logo nunca passa por `usuarioAtual()`.
 *
 * Isso é decisão registrada do dono, não descuido — e o alcance é estreito
 * porque o payload daquelas telas já estava na memória do navegador dela
 * antes da desativação. Quem apenas não fechasse a aba veria o mesmo, e isso
 * sempre foi verdade.
 *
 * `equipe.spec.ts` já prova a revogação, mas só pelo caminho fácil: ele usa
 * `page.goto("/leads")`, carregamento completo, que sempre bate no servidor.
 * Ele passaria verde mesmo que o cache tivesse aberto um buraco de verdade.
 * Este teste cobre o caminho que faltava.
 *
 * ## Por que ele afirma as GARANTIAS, e não a janela
 *
 * Seria fácil (e errado) escrever "a aba em cache ainda renderiza". Essa
 * asserção ficaria vermelha no dia em que alguém baixasse `staleTimes` para
 * 0 — ou seja, ficaria vermelha por o sistema ter ficado MAIS seguro. Um
 * teste que pune o conserto é pior que nenhum.
 *
 * O que precisa valer para qualquer valor de `staleTimes` é o que está aqui:
 * quem foi desativado não ESCREVE e não alcança tela nova.
 */
const EMAIL_REVOGACAO = "e2e-revogacao-cache@teste.invalid";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

/**
 * A conta de teste nasce DENTRO do teste, não num `beforeAll`.
 *
 * `playwright.config.ts` usa `fullyParallel: true`, então os testes deste
 * arquivo se espalham entre workers — e cada worker executa o `beforeAll` do
 * arquivo por conta própria. Com a fixture lá fora, dois workers disputavam o
 * mesmo e-mail único e o Postgres respondia
 * `Unique constraint failed on the fields: (email)`, derrubando inclusive o
 * teste vizinho, que não tem nada a ver com esta conta.
 *
 * ## O `Membership`, e por que sem ele o teste não roda
 *
 * Desde o Ciclo 1a `usuarioAtual()` (`src/core/auth/session.ts`) resolve
 * `companyId` e `papel` pelo vínculo e LANÇA quando não há nenhum;
 * `(painel)/layout.tsx` captura e manda para `/login`. Uma conta sem
 * `Membership` LOGA e não entra em lugar nenhum — o que este arquivo via era
 * o clique em "Leads" estourando 30 s de timeout, sintoma que não aponta para
 * a causa. É a mesma família de `e67e1e6` (fixtures de unidade) e `c06b1fe`
 * (`global-setup.ts` da e2e); esta função ficou de fora das duas varreduras.
 *
 * O papel do vínculo é `VENDEDOR` porque é o que o teste exercita: alguém que
 * enxerga `/leads` e `/tasks` e não precisa de nada de ADMIN.
 */
async function comContaDescartavel(corpo: () => Promise<void>) {
  await apagarContaDescartavel();
  esteWorkerCriouAConta = true;

  // A empresa mais antiga do banco, pelo mesmo critério (e pelo mesmo motivo)
  // de `garantirContasDeTeste` em `global-setup.ts`: a fixture não inventa
  // empresa nova, porque empresa órfã por execução é exatamente o resíduo que
  // a auditoria do Ciclo 1a mediu.
  const empresa = await prisma.company.findFirstOrThrow({
    orderBy: { criadoEm: "asc" },
    select: { id: true },
  });

  await prisma.user.create({
    data: {
      nome: "E2E Revogacao Cache",
      email: EMAIL_REVOGACAO,
      // Custo 10, o mesmo de `core/auth/credenciais.ts` — um custo diferente
      // aqui faria o login falhar por motivo que não tem nada a ver com o
      // que este teste mede.
      senhaHash: await bcrypt.hash(senhaE2e(), 10),
      papel: "VENDEDOR",
      ativo: true,
      memberships: { create: { companyId: empresa.id, papel: "VENDEDOR" } },
    },
  });
  try {
    await corpo();
  } finally {
    await apagarContaDescartavel();
  }
}

/**
 * Apaga a conta descartável em ordem de chave estrangeira.
 *
 * `Notification.userId` e `AuditLog.userId` são `RESTRICT` (o padrão do Prisma
 * para relação obrigatória, e é o que `63cecd2` teve de aprender depois de uma
 * fixture deixar 11 usuários e 8 empresas para trás porque
 * `Notification_userId_fkey` barrou o `deleteMany`). `Membership` é `Cascade`,
 * então some junto com o usuário e não precisa de linha própria aqui.
 *
 * A conta é destinatária real de notificação enquanto existe: ela tem vínculo
 * ativo na empresa, e `marcarAguardandoHumano`
 * (`src/modules/whatsapp/notificacoes.ts`) grava uma `Notification` por
 * membro ativo da empresa da conversa.
 */
async function apagarContaDescartavel(): Promise<void> {
  const conta = await prisma.user.findUnique({
    where: { email: EMAIL_REVOGACAO },
    select: { id: true },
  });
  if (!conta) return;

  await prisma.notification.deleteMany({ where: { userId: conta.id } });
  await prisma.auditLog.deleteMany({ where: { userId: conta.id } });
  await prisma.user.delete({ where: { id: conta.id } });
}

/**
 * A rede de segurança que o `finally` do `comContaDescartavel` NÃO é.
 *
 * Medido: quando o Playwright estoura o tempo de um teste, ele abandona a
 * função do caso sem rejeitar o `await` pendente — o `finally` fica preso e
 * NUNCA roda. Foi assim que `e2e-revogacao-cache@teste.invalid` sobrou ATIVA
 * no banco compartilhado, com senha conhecida, e reincidiu depois de duas
 * remoções à mão (Task 7 e auditoria da Task 8 do Ciclo 1c).
 *
 * Conta esquecida ATIVA é pior que inativa: ela loga. E `credenciais.ts`
 * documenta que este banco é o mesmo de produção.
 *
 * `afterAll` roda mesmo depois de falha ou timeout — é o hook, não o
 * `finally`, que fecha o buraco. Os dois ficam: o `finally` limpa cedo no
 * caminho feliz, o hook limpa sempre.
 *
 * ## Por que a bandeira, e não uma limpeza incondicional
 *
 * `afterAll` roda uma vez POR WORKER. Com `fullyParallel: true`, os três
 * testes deste arquivo podem cair em workers diferentes, e só UM deles cria a
 * conta. Um `afterAll` incondicional no worker que terminou primeiro apagaria
 * a conta que o outro worker ainda está usando — o mesmo defeito de
 * paralelismo que a docstring de `comContaDescartavel` descreve, na direção
 * oposta. A bandeira mora no módulo, que é por worker: só limpa quem criou.
 */
let esteWorkerCriouAConta = false;

test.afterAll(async () => {
  if (esteWorkerCriouAConta) await apagarContaDescartavel();
  await prisma.$disconnect();
});

test("desativado no meio da sessão não escreve nem alcança tela nova, mesmo com o cache quente", async ({
  page,
}) => {
  await comContaDescartavel(async () => {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("E-mail").fill(EMAIL_REVOGACAO);
  await page.getByLabel("Senha").fill(senhaE2e());
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("/");
  // Espera a hidratacao antes de clicar na barra lateral. Sem isto, sob
  // carga, o clique chega antes de o React assumir o <Link> e o navegador faz
  // uma navegacao de PAGINA INTEIRA em vez de client-side -- outro caminho de
  // render, com outro comportamento de esqueleto e de cache. E a mesma
  // armadilha ja documentada em auth.setup.ts (clicar antes da hidratacao
  // recarrega a pagina em vez de submeter o formulario).
  await page.waitForLoadState("networkidle");

  // Aquece o cache: `/leads` passa a existir na memória do navegador. Sem
  // este passo o teste passaria por não haver nada em cache — verde sem
  // exercitar a situação que ele descreve.
  await page.getByRole("link", { name: "Leads", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Leads", exact: true })).toBeVisible();

  // Desativada AGORA, com a sessão viva e o cache quente. O cookie dela
  // continua no navegador, intacto e não expirado.
  await prisma.user.update({ where: { email: EMAIL_REVOGACAO }, data: { ativo: false } });

  // ─── Garantia 1: não escreve ───────────────────────────────────────────
  // Tudo dentro da janela de 30 s, de propósito: esperar ela expirar faria o
  // teste provar decurso de prazo em vez de revogação.
  const TELEFONE = "11955559876";
  await page.getByLabel("Nome").fill("E2E Revogacao Escrita");
  await page.getByLabel("Telefone").fill(TELEFONE);
  await page.getByRole("button", { name: "Adicionar lead" }).click();
  // Pelo TEXTO, não por `getByRole("alert")`: o Next mantém um
  // `<div role="alert" id="__next-route-announcer__">` permanente e vazio no
  // documento para anunciar troca de rota a leitor de tela, então a busca por
  // papel casa com dois elementos e morre em modo estrito.
  await expect(page.getByText(/sua sessão expirou/i)).toBeVisible();

  // A régua final é o BANCO, não a mensagem na tela: um alerta bonito sobre
  // uma linha que foi gravada seria o pior dos dois mundos.
  expect(
    await prisma.lead.count({ where: { contact: { telefone: { contains: "955559876" } } } }),
    "usuário desativado conseguiu gravar um lead a partir da tela em cache"
  ).toBe(0);

  // ─── Garantia 2: não alcança tela nova ─────────────────────────────────
  // "Tarefas" nunca foi visitada nesta sessão, então não há cache para servir
  // e a navegação precisa ir ao servidor — onde `usuarioAtual()` rejeita.
  await page.getByRole("link", { name: "Tarefas", exact: true }).first().click();
  await expect(page).toHaveURL(/\/login/);
  });
});
