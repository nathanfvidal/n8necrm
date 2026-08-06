import { defineConfig, devices } from "@playwright/test";

// webServer roda contra build de produção (`next build` + `next start`), não
// `next dev`. Decisão deliberada, não a do brief original:
// - A própria doc do Next 16 (node_modules/next/dist/docs/01-app/02-guides/
//   testing/playwright.md, seção "Running your Playwright tests") recomenda
//   rodar E2E contra o build de produção "to more closely resemble how your
//   application will behave" — dev mode compila rotas sob demanda (primeira
//   navegação fica lenta/instável) e roda com otimizações desligadas.
// - Verificado manualmente: `npm run build` termina em ~25s neste projeto,
//   então o custo por execução é pequeno.
//
// reuseExistingServer: !!process.env.CI é invertido de propósito (fica
// `true` fora de CI). Não existe pipeline de CI neste repo ainda (nenhum
// .github/workflows), mas a guarda já fica correta para quando existir:
// numa máquina de dev, se já houver um `npm run start`/`next start` de pé na
// porta 3000, o Playwright reaproveita e SÓ o processo que ele mesmo inicia
// é encerrado ao final — nunca mata um servidor que já era do desenvolvedor.
// Em CI, força sempre subir um processo novo, para não reaproveitar por
// engano um servidor de um job anterior. Em ambos os casos, quando é o
// Playwright quem sobe o processo, ele mata a árvore inteira (taskkill /T no
// Windows) ao fim da suíte — sem processo node/next órfão preso na porta.
//
// timeout generoso (o padrão do Playwright é 60s): build + start já usam uns
// 25-30s isolados; com margem para máquinas mais lentas, 120s evita abortar
// no meio do build e deixar artefato parcial.
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: "list",
  /**
   * Limitado de propósito, e não pelo número de núcleos (o padrão do
   * Playwright).
   *
   * Nasceu de uma restrição de banco: com o `DATABASE_URL` no pooler em
   * *session mode* (15 conexões para tudo), a suíte em paralelo derrubava o
   * servidor com `(EMAXCONNSESSION) max clients reached in session mode`, e
   * os sintomas apareciam em testes sem relação nenhuma com a mudança sendo
   * feita — um login "inválido" que era só lento demais. Caro de
   * diagnosticar.
   *
   * O `DATABASE_URL` já migrou para *transaction mode*, então essa restrição
   * específica acabou. O limite continua porque a suíte compartilha o MESMO
   * Postgres de desenvolvimento com o app e com os testes unitários que tocam
   * banco: manter a concorrência modesta é o que evita que uma execução de
   * teste atrapalhe quem está usando o CRM na outra janela. A suíte inteira
   * roda em ~30s assim.
   */
  workers: 3,
  // Zera o contador de tentativas de login antes da suíte. Sem isto, rodar
  // a suíte duas vezes dentro de 10 minutos faz a segunda esbarrar no limite
  // de tentativas e falhar em testes que não têm relação com login — ver o
  // comentário longo em tests/e2e/global-setup.ts.
  globalSetup: "./tests/e2e/global-setup.ts",
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Auth.js v5 só confia no Host da requisição por padrão quando
    // NODE_ENV !== "production" (ver node_modules/@auth/core/lib/utils/
    // env.js#setEnvDefaults) — em dev isso é implícito, mas `next start`
    // roda com NODE_ENV=production e sem essa variável toda rota de auth
    // responde UntrustedHost (verificado rodando a suíte sem esta linha:
    // login falha, e o teste de credenciais inválidas nunca chega na
    // mensagem de erro porque a request nem entra no authorize()).
    // AUTH_TRUST_HOST (não AUTH_URL) é a variável certa aqui: AUTH_URL
    // também redefine `basePath` a partir do pathname da URL, o que
    // quebraria as rotas em /api/auth/* se a URL não incluir esse path.
    // Escopado só ao processo do webServer — não entra em .env nem muda
    // o comportamento de um deploy real (lá, o host de produção real
    // teria que ser configurado de qualquer forma).
    env: {
      AUTH_TRUST_HOST: "true",
    },
  },
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
