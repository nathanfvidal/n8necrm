import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Trava o defeito que derrubou o deploy de produção por três dias.
 *
 * `gateway/index.ts` e `llm/index.ts` validavam `EVOLUTION_*` e
 * `OPENAI_API_KEY` no escopo do módulo. `next build` avalia todo módulo
 * alcançável para coletar a configuração das rotas, e a cadeia
 * `api/queues/whatsapp-turn` → `turno.ts` → `gateway` fazia essa validação
 * rodar em tempo de BUILD. Sem aquelas variáveis na Vercel, o build inteiro
 * falhava — inclusive leads, funil e login, que não têm relação nenhuma com
 * WhatsApp:
 *
 *     Failed to collect configuration for /api/queues/whatsapp-turn
 *     [cause]: Configuração do gateway de WhatsApp inválida: ...
 *
 * Ninguém percebeu porque o sintoma aparece só na Vercel: numa máquina de
 * desenvolvimento o `.env` tem tudo, e o build passa.
 *
 * As duas metades importam e o teste cobre as duas:
 *
 * 1. **Importar não pode lançar** — senão o build quebra.
 * 2. **Usar sem configuração ainda tem que lançar**, com a mensagem que
 *    explica o que falta. Adiar a validação não pode virar engolir a
 *    validação.
 *
 * `vi.mock("server-only")` é local a este arquivo de propósito: aqueles
 * módulos importam `server-only`, que lança fora do bundler do Next. Um alias
 * global no `vitest.config.ts` mudaria o comportamento de toda a suíte para
 * resolver um problema de dois arquivos.
 */
vi.mock("server-only", () => ({}));

const VARIAVEIS = [
  "EVOLUTION_DOMAIN",
  "EVOLUTION_INSTANCE",
  "EVOLUTION_APIKEY",
  "OPENAI_API_KEY",
] as const;

const guardadas: Record<string, string | undefined> = {};

beforeEach(() => {
  // Os módulos memoizam a instância no primeiro uso; sem resetar, um teste
  // que construiu com sucesso deixaria o próximo passar por engano.
  vi.resetModules();
  for (const nome of VARIAVEIS) {
    guardadas[nome] = process.env[nome];
    delete process.env[nome];
  }
});

afterEach(() => {
  for (const nome of VARIAVEIS) {
    if (guardadas[nome] === undefined) delete process.env[nome];
    else process.env[nome] = guardadas[nome];
  }
});

describe("gateway do WhatsApp", () => {
  it("pode ser importado sem as variáveis da Evolution — é isso que mantém o build de pé", async () => {
    const modulo = await import("../../src/modules/whatsapp/gateway");
    expect(modulo.whatsappGateway).toBeDefined();
  });

  it("mas lança, dizendo o que falta, quando alguém tenta USAR sem configurar", async () => {
    const { whatsappGateway } = await import("../../src/modules/whatsapp/gateway");

    expect(() => whatsappGateway.enviarTexto("5511999998888", "oi")).toThrow(
      /Configuração do gateway de WhatsApp inválida/
    );
    expect(() => whatsappGateway.enviarTexto("5511999998888", "oi")).toThrow(/EVOLUTION_DOMAIN/);
  });

  it("constrói normalmente quando as variáveis existem", async () => {
    process.env.EVOLUTION_DOMAIN = "https://evo.exemplo.com";
    process.env.EVOLUTION_INSTANCE = "instancia-teste";
    process.env.EVOLUTION_APIKEY = "chave-teste";

    const { whatsappGateway } = await import("../../src/modules/whatsapp/gateway");
    expect(typeof whatsappGateway.enviarTexto).toBe("function");
  });
});

describe("provedor de LLM", () => {
  it("pode ser importado sem OPENAI_API_KEY", async () => {
    const modulo = await import("../../src/modules/whatsapp/llm");
    expect(modulo.llmProvider).toBeDefined();
  });

  it("mas lança ao ser usado sem a chave", async () => {
    const { llmProvider } = await import("../../src/modules/whatsapp/llm");

    expect(() => llmProvider.gerarResposta).toThrow(/Configuração do provedor de LLM inválida/);
  });

  it("constrói normalmente quando a chave existe", async () => {
    process.env.OPENAI_API_KEY = "sk-teste-nao-usada-em-rede";

    const { llmProvider } = await import("../../src/modules/whatsapp/llm");
    expect(typeof llmProvider.gerarResposta).toBe("function");
  });
});
