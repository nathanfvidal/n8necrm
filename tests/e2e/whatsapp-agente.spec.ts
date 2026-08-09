// Prova, num navegador de verdade, o ciclo que a Fatia 2 inteira existe para
// entregar: humano assume a conversa, o bot cala, o humano devolve — mais o
// gate de permissão da tela de configuração do agente e o efeito imediato de
// editar a persona na prévia do prompt.
//
// A entrada da mensagem do cliente é simulada escrevendo direto no banco (o
// webhook real depende da Evolution, que não existe no ambiente de teste) —
// mas tudo depois disso é o sistema de verdade: a tela, as Server Actions, o
// estado em `Conversation`. O envio de uma resposta humana de verdade
// (`ConversaResponder`/`responderConversaAction`) fica FORA deste arquivo de
// propósito: chamaria a Evolution real e mandaria WhatsApp para um telefone
// real — ver "Verificação que só um humano pode fazer" no brief da Task 8.
//
// Mesmo padrão de tests/e2e/lead-to-won.spec.ts para tocar o Postgres real e
// compartilhado: PrismaClient próprio (não `@/lib/prisma`, que tem
// `import "server-only"` e quebraria fora do pipeline de build do Next) e uma
// função de limpeza por PREFIXO, chamada antes (limpa resíduo de uma execução
// anterior que tenha falhado no meio) e depois (limpa o que esta execução
// criou) — `test.afterAll` roda mesmo quando um teste falha, o que garante
// que uma asserção quebrada não deixa lixo no banco de dev de todo mundo.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { EMAIL_VENDEDOR_E2E, SESSAO_ADMIN, senhaE2e } from "./credenciais";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// Prefixo exclusivo deste arquivo (não colide com "teste-ingest-"/"teste-turno-"
// dos testes unitários nem com nenhum outro spec e2e). `Conversation.waId` é
// único, então cada conversa criada abaixo ainda soma um `randomUUID()` ao
// prefixo — o prefixo sozinho é só o que a limpeza usa para encontrá-las.
const PREFIXO_WAID = "e2e-agente-";

// Usuário descartável do teste 4 (sessão inválida) — e-mail fixo, não
// aleatório: só existe um por vez, e um valor fixo é o que permite a
// `limparDadosDeTeste` encontrá-lo mesmo se a execução anterior tiver
// travado antes de apagá-lo.
const EMAIL_USUARIO_TESTE = "e2e-agente-sessao-invalida@teste.local";
const SENHA_USUARIO_TESTE = "senha-teste-e2e-123";

/**
 * Remove tudo que este arquivo pode ter criado no Postgres real e
 * compartilhado: `Conversation` por prefixo de `waId` (o `onDelete: Cascade`
 * de `WhatsappMessage.conversation` já leva as mensagens junto — não precisa
 * de um `deleteMany` separado) e o usuário descartável do teste 4 por e-mail
 * fixo. Nunca toca `BotConfig`: nenhum teste deste arquivo chama
 * `salvarConfigAgenteAction`/`restaurarConfigPadraoAction` (o teste 3 só edita
 * estado local do formulário, nunca clica em "Salvar"), então a linha única
 * do bot não precisa de captura/restauração aqui.
 */
async function limparDadosDeTeste(): Promise<void> {
  await prisma.conversation.deleteMany({ where: { waId: { startsWith: PREFIXO_WAID } } });
  await prisma.user.deleteMany({ where: { email: EMAIL_USUARIO_TESTE } });
}

// MODO SERIAL DE PROPÓSITO — não é excesso de cautela, é o que evita uma
// corrida real entre workers. NÃO REMOVA esta linha sem entender o raciocínio
// abaixo primeiro.
//
// `test.beforeAll`/`test.afterAll` do Playwright rodam UMA VEZ POR WORKER
// PROCESS, não uma vez por arquivo (`node_modules/playwright/lib/runner/`,
// `createTestGroups`). Com `fullyParallel: true` e `workers: 3`
// (`playwright.config.ts`) e os seis testes abaixo, o Playwright pode
// despachar grupos deste MESMO arquivo para workers diferentes, sobrepostos
// no tempo — e `limparDadosDeTeste()` apaga por PREFIXO COMPARTILHADO
// (`Conversation.waId` começando com `PREFIXO_WAID`) e por e-mail fixo do
// usuário descartável, sem escopo por teste individual. Sem `serial`, dois
// grupos concorrentes deste arquivo pisam um no outro:
// - o `beforeAll` do grupo que começa depois apaga a `Conversation` que o
//   OUTRO grupo acabou de criar e ainda está usando;
// - o `afterAll` do grupo que termina primeiro apaga tudo do prefixo,
//   inclusive o que o outro grupo ainda está exercitando;
// - se o `User` descartável do teste de sessão inválida for apagado por
//   engano no meio do teste, `usuarioAtual()` lança um erro DIFERENTE de
//   "Não autenticado" e aquele teste falha por um motivo que não tem nada a
//   ver com o que ele pretende provar — o pior tipo de falha, porque manda
//   investigar o lugar errado.
//
// `mode: "serial"` força os seis testes deste arquivo ao MESMO worker, em
// sequência — os hooks deste arquivo passam a rodar de fato uma vez só, sem
// sobreposição. `fullyParallel` continua paralelizando ENTRE arquivos (este
// roda em paralelo com auth.spec.ts, lead-to-won.spec.ts etc.), então a
// suíte não fica mais lenta de forma relevante — só os seis testes AQUI
// DENTRO deixam de disputar workers entre si.
//
// O defeito que isto evita é INTERMITENTE: só se manifesta quando o
// Playwright de fato despacha este arquivo em mais de um grupo, o que
// depende de quantos outros testes/arquivos competem pelos mesmos workers
// naquele instante. Uma bateria de execuções verdes sem este `configure`
// NÃO prova que o problema não existe — só que não se manifestou desta vez.
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await limparDadosDeTeste();
});

test.afterAll(async () => {
  await limparDadosDeTeste();
  await prisma.$disconnect();
});

/**
 * Login pela UI real, reaproveitando o MESMO caminho que `tests/e2e/auth.spec.ts`,
 * `tests/e2e/lead-to-won.spec.ts` e `tests/e2e/seguranca-headers.spec.ts` já
 * usam (campos "E-mail"/"Senha", botão "Entrar") — não um atalho por API ou
 * cookie injetado. Um segundo caminho de autenticação é mais uma coisa para
 * quebrar sem cobertura.
 *
 * `waitForLoadState("networkidle")` antes de preencher, mesma razão
 * documentada em `seguranca-headers.spec.ts`: o formulário só é interceptado
 * pelo React depois que o bundle hidrata; um clique antes disso dispara o
 * submit nativo do navegador, a página recarrega e o login não acontece. Já
 * apareceu de verdade numa suíte rodando em paralelo (`workers: 3`).
 *
 * Cada `test()` do Playwright recebe um `page`/contexto isolado por padrão
 * (nenhum `storageState` é compartilhado em `playwright.config.ts` — sem
 * projeto de "setup" com sessão salva, sem `use.storageState` global) —
 * confirmado lendo a config antes de escrever testes com contas diferentes
 * (ADMIN vs VENDEDOR) neste arquivo: sem isolamento, um teste de permissão
 * herdaria a sessão do teste anterior e passaria por engano, o pior resultado
 * possível para um teste de autorização.
 */
async function login(page: Page, email: string, senha = senhaE2e()): Promise<void> {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("/");
}

// Sessao reaproveitada de `auth.setup.ts`: este teste so precisa ESTAR
// logado como ADMIN, e cada login gasta cota do teto de 10 por conta a
// cada 10 minutos (`core/rate-limit/login.ts`). Foi o estouro desse teto
// que derrubou o ULTIMO teste da fila ao integrar esta fatia.
test.describe(() => {
  test.use({ storageState: SESSAO_ADMIN });
  test("pausar, responder e religar a IA numa conversa", async ({ page }) => {
    // `nomeExibicao` único (não só o prefixo do `waId`, que não aparece na
    // tela) para escopar a asserção na lista de /conversas a ESTA linha —
    // `page.getByText("IA pausada")` sozinho quebraria em modo estrito do
    // Playwright se outra conversa pausada já existisse no banco compartilhado.
    const nomeExibicao = `E2E Ciclo IA ${randomUUID().slice(0, 8)}`;
    const conversa = await prisma.conversation.create({
      data: { waId: `${PREFIXO_WAID}${randomUUID()}`, telefone: "5511999990000", nomeExibicao },
    });
    await prisma.whatsappMessage.create({
      data: {
        conversationId: conversa.id,
        idExterno: `${PREFIXO_WAID}msg-${randomUUID()}`,
        direcao: "ENTRADA",
        autor: "CLIENTE",
        tipo: "TEXTO",
        texto: "Bom dia, tem carro na faixa de 60 mil?",
      },
    });


    await page.goto(`/conversas/${conversa.id}`);
    await expect(page.getByText("IA respondendo")).toBeVisible();

    await page.getByRole("button", { name: "Pausar IA" }).click();
    await expect(page.getByText("IA pausada")).toBeVisible();

    // O estado tem que aparecer TAMBÉM na lista — é o que evita conversa
    // pausada e esquecida. `getByRole("link", ...)` mira o mesmo `<Link>` que
    // envolve nome E badge em `conversas/page.tsx` (`ConversasPage`); o nome
    // acessível do link inclui os dois textos, então buscar por `nomeExibicao`
    // (substring, não `exact`) chega na linha certa antes de checar o badge
    // dentro dela.
    await page.goto("/conversas");
    const linkConversa = page.getByRole("link", { name: nomeExibicao });
    await expect(linkConversa.getByText("IA pausada")).toBeVisible();

    await page.goto(`/conversas/${conversa.id}`);
    await page.getByRole("button", { name: "Religar IA" }).click();
    await expect(page.getByText("IA respondendo")).toBeVisible();
  });
});

test("a tela do agente é inacessível a quem não é ADMIN", async ({ page }) => {
  await login(page, EMAIL_VENDEDOR_E2E);
  await page.goto("/conversas/agente");
  await expect(page).toHaveURL(/\/conversas$/);
});

// Sessao reaproveitada de `auth.setup.ts`: este teste so precisa ESTAR
// logado como ADMIN, e cada login gasta cota do teto de 10 por conta a
// cada 10 minutos (`core/rate-limit/login.ts`). Foi o estouro desse teto
// que derrubou o ULTIMO teste da fila ao integrar esta fatia.
test.describe(() => {
  test.use({ storageState: SESSAO_ADMIN });
  test("editar a persona muda a prévia do prompt", async ({ page }) => {
    await page.goto("/conversas/agente");
    await page.getByLabel("Nome da persona").fill("Beatriz");
    await expect(page.getByTestId("previa-prompt")).toContainText("Você é Beatriz");
    // Nenhum clique em "Salvar" — a prévia é estado local (`AgenteForm` monta o
    // texto no cliente com a mesma `montarPromptSistema` que o servidor usa,
    // sobre o `useState` do formulário), então este teste nunca escreve na
    // linha única de `BotConfig`. É por isso que `limparDadosDeTeste` acima não
    // precisa capturar/restaurar a persona original.
  });
});

/**
 * Quarto teste, além dos três do brief da Task 8 — cobre uma lacuna que só o
 * e2e prova: erro de SESSÃO INVÁLIDA chegando à tela ao clicar num botão da
 * conversa, não só erro de validação de entrada (já coberto por
 * `tests/unit/whatsapp-actions.test.ts`, que mocka `usuarioAtual`).
 *
 * Este exato caminho foi corrigido nesta fatia (commit "fix: sessao invalida
 * nas actions de WhatsApp nao chegava a tela como erro"): antes da correção,
 * `usuarioAtual()` rodava FORA do `try` das actions em `actions.ts`, então
 * uma sessão inválida rejeitava a promise sem nunca produzir um
 * `ResultadoAcao` — a Server Action mesmo assim redigia o erro cru do Next e
 * a tela não mostrava nada, nem sucesso nem erro. Um atendente com aba aberta
 * há horas, ou desativado no meio do expediente, clicava e nada visível
 * acontecia. Um teste unitário que mocka `usuarioAtual()` para rejeitar prova
 * que a Server Action DEVOLVE o `ResultadoAcao` certo, mas não prova que esse
 * retorno chega a aparecer na tela — só um navegador real fecha essa lacuna.
 *
 * Simulado sem tocar o gateway: `usuarioAtual()` (`core/auth/session.ts`)
 * relê `User.ativo` do banco A CADA chamada — um cookie de sessão (JWT) já
 * emitido continua válido depois que o usuário é desativado, então desativar
 * o usuário DEPOIS do login (sem derrubar o cookie) reproduz "sessão
 * inválida" sem expirar nada de verdade. `pausarIaAction` nunca chama
 * `whatsappGateway` — a rejeição acontece antes, dentro de `usuarioAtual()`.
 * Usuário descartável (não as contas fixas de `credenciais.ts`) para
 * não desativar, ainda que por um instante, uma conta que outros specs desta
 * suíte usam em paralelo (`workers: 3`, `fullyParallel: true`).
 */
test("erro de sessão inválida chega à tela ao tentar pausar a IA", async ({ page }) => {
  const senhaHash = await bcrypt.hash(SENHA_USUARIO_TESTE, 10);
  const usuarioTeste = await prisma.user.create({
    data: {
      nome: "E2E Sessão Inválida",
      email: EMAIL_USUARIO_TESTE,
      senhaHash,
      papel: "VENDEDOR",
    },
  });
  const conversa = await prisma.conversation.create({
    data: { waId: `${PREFIXO_WAID}${randomUUID()}`, telefone: "5511999990002" },
  });

  await login(page, EMAIL_USUARIO_TESTE, SENHA_USUARIO_TESTE);

  await page.goto(`/conversas/${conversa.id}`);
  await expect(page.getByText("IA respondendo")).toBeVisible();

  // Desativa DEPOIS do login e da navegação: o cookie de sessão continua
  // válido, só `usuarioAtual()` (chamado dentro da Server Action, não pelo
  // middleware/proxy) passa a rejeitar na próxima chamada.
  await prisma.user.update({ where: { id: usuarioTeste.id }, data: { ativo: false } });

  await page.getByRole("button", { name: "Pausar IA" }).click();
  await expect(
    page.getByText("Sua sessão expirou. Recarregue a página e entre de novo.")
  ).toBeVisible();

  // Não é só a mensagem que precisa aparecer — a IA também não pode ter sido
  // pausada de verdade. Sem isto, um erro cosmético (texto certo, ação
  // executada mesmo assim) passaria despercebido.
  const conversaAposClique = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversa.id },
  });
  expect(conversaAposClique.iaAtiva).toBe(true);
});

/**
 * Task 4 da fatia "conversa aguardando humano" — prova pela tela real o que
 * as Tasks 1-3 só garantem no servidor: `Conversation.aguardandoHumanoDesde`
 * marcado vira o selo "Aguardando há X" em `/conversas`
 * (`ConversasPage`, `Badge variant="destructive"`).
 *
 * `nomeExibicao` único escopa a asserção a ESTA linha, não à página inteira
 * — o banco é compartilhado e outra conversa aguardando já faria
 * `getByText(/Aguardando há/)` bater em algum lugar da tela pelo motivo
 * errado, o que num teste é pior que falhar. `telefone` não serve para
 * escopar: a tabela de `/conversas` não renderiza esse campo em nenhuma
 * célula (só a tela de detalhe, `conversas/[id]/page.tsx`, mostra
 * `conversa.telefone`) — mesma técnica de escopo do teste "pausar,
 * responder e religar a IA" acima, por essa mesma razão.
 */
test("conversa aguardando humano aparece com o selo na lista", async ({ page }) => {
  const nomeExibicao = `E2E Aguardando ${randomUUID().slice(0, 8)}`;
  await prisma.conversation.create({
    data: {
      waId: `${PREFIXO_WAID}${randomUUID()}`,
      telefone: "5511999990001",
      nomeExibicao,
      iaAtiva: false,
      aguardandoHumanoDesde: new Date(),
    },
  });

  // Este teste entrava com `admin@exemplo.com`, conta de demonstração que a
  // correção da auditoria de segurança DESATIVOU (senha literal em arquivo
  // versionado, com deploy público no ar). Usuário inativo não faz login, e o
  // sintoma era timeout em `waitForURL("/")` — parece falha do selo, é falha
  // de autenticação.
  //
  // Conta de VENDEDOR, e não a de admin, por duas razões: `/conversas` não tem
  // checagem de papel (o teste "a tela do agente é inacessível a quem não é
  // ADMIN", acima, depende justamente de um vendedor conseguir cair nela), e o
  // orçamento de login por conta é 10 a cada 10 minutos
  // (`core/rate-limit/login.ts`). Jogar estes dois testes no admin levava a
  // suíte a ~11 logins dele por execução e derrubava o ÚLTIMO teste da fila,
  // por rate limit — um sintoma que não se parece nada com a causa.
  await login(page, EMAIL_VENDEDOR_E2E);
  await page.goto("/conversas");

  const linkConversa = page.getByRole("link", { name: nomeExibicao });
  await expect(linkConversa.getByText(/Aguardando há/)).toBeVisible();
});

/**
 * Cobertura extra além do que o brief da Task 4 pedia: `listarConversas()`
 * (`modules/whatsapp/queries.ts`) já tem teste unitário para a ordenação
 * (`aguardandoHumanoDesde` ASC com nulls last, antes de `atualizadoEm`
 * DESC), mas aquilo só prova a CONSULTA — não prova que `ConversasPage`
 * renderiza o resultado na ordem em que chega. Só um navegador real fecha
 * essa lacuna.
 *
 * Compara as posições das DUAS conversas que este teste cria, não a posição
 * absoluta na tabela: o banco de dev é compartilhado, então nada garante
 * que estas sejam as duas primeiras linhas se outra conversa já estiver
 * aguardando. `nomeExibicao` único em cada uma permite achar a linha de
 * cada uma no texto de todas as linhas e comparar os índices — a aguardando
 * tem que vir antes da comum, não importa o que mais exista no banco.
 *
 * `listarConversas()` usa `take: 100`; se o banco de dev algum dia passar
 * de ~100 conversas, a comum (sem `aguardandoHumanoDesde`, portanto no fim
 * da ordenação) pode ficar de fora da página e este teste passa a falhar
 * por um motivo alheio ao que ele prova. Conferido por consulta direta ao
 * escrever este teste: o banco de desenvolvimento tinha 0 conversas, longe
 * do teto — ver o relatório da Task 4 para o número exato no dia.
 */
test("conversa aguardando aparece antes de uma conversa comum na lista", async ({ page }) => {
  const nomeAguardando = `E2E Aguardando Ordem ${randomUUID().slice(0, 8)}`;
  const nomeComum = `E2E Comum Ordem ${randomUUID().slice(0, 8)}`;

  await prisma.conversation.create({
    data: {
      waId: `${PREFIXO_WAID}${randomUUID()}`,
      telefone: "5511999990003",
      nomeExibicao: nomeAguardando,
      aguardandoHumanoDesde: new Date(),
    },
  });
  await prisma.conversation.create({
    data: {
      waId: `${PREFIXO_WAID}${randomUUID()}`,
      telefone: "5511999990004",
      nomeExibicao: nomeComum,
    },
  });

  // Mesma troca do teste acima, pelas mesmas duas razões: conta de
  // demonstração desativada, e orçamento de login do admin já apertado.
  await login(page, EMAIL_VENDEDOR_E2E);
  await page.goto("/conversas");

  await expect(page.getByRole("link", { name: nomeAguardando })).toBeVisible();
  await expect(page.getByRole("link", { name: nomeComum })).toBeVisible();

  const linhas = await page.locator("tbody tr").allTextContents();
  const indiceAguardando = linhas.findIndex((linha) => linha.includes(nomeAguardando));
  const indiceComum = linhas.findIndex((linha) => linha.includes(nomeComum));
  expect(indiceAguardando).toBeGreaterThanOrEqual(0);
  expect(indiceComum).toBeGreaterThanOrEqual(0);
  expect(indiceAguardando).toBeLessThan(indiceComum);
});
