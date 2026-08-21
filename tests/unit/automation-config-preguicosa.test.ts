import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Trava, para `automation/n8n/index.ts`, o mesmo defeito documentado em
 * `whatsapp-config-preguicosa.test.ts` para `gateway/index.ts` e `llm/index.ts`:
 * `next build` avalia todo módulo alcançável para coletar a configuração das
 * rotas, e validar env no escopo do módulo faz essa validação rodar em tempo
 * de BUILD — foi assim que o deploy quebrou por três dias em 2026-08-07.
 * `automation/n8n/index.ts` adiou a validação para o primeiro USO (comentário
 * em `obterCliente()`, index.ts linhas 48-56), mas até esta correção não havia
 * teste nenhum provando isso — lacuna achada na revisão da Task 1 do Ciclo 4.
 *
 * Arquivo NOVO em vez de acrescentar ao de WhatsApp: aquele arquivo se chama
 * `whatsapp-config-preguicosa` e seu `VARIAVEIS` é dos segredos da Evolution —
 * misturar `N8N_API_URL`/`N8N_API_KEY` lá dentro deixaria o nome do arquivo
 * errado sobre o que ele cobre. Espelha a mesma estrutura.
 *
 * `vi.mock("server-only")` é local a este arquivo pelo mesmo motivo do
 * original: `automation/n8n/index.ts` importa `server-only`, que lança fora
 * do bundler do Next, e um alias global mudaria o comportamento da suíte
 * inteira para resolver um problema de um arquivo.
 */
vi.mock("server-only", () => ({}));

const VARIAVEIS = ["N8N_API_URL", "N8N_API_KEY"] as const;

const guardadas: Record<string, string | undefined> = {};

beforeEach(() => {
  // `automation/n8n/index.ts` memoiza `instancia` no módulo (linha 46); sem
  // `resetModules()`, um teste que construiu com sucesso deixaria o próximo
  // passar por engano, mascarando exatamente o defeito que este arquivo prova
  // que não existe mais.
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
  vi.unstubAllGlobals();
});

describe("módulo de automação (n8n)", () => {
  it("pode ser importado sem N8N_API_URL/N8N_API_KEY — é isso que mantém o build de pé", async () => {
    const modulo = await import("../../src/modules/automation/n8n");
    expect(modulo.clienteN8n).toBeDefined();
  });

  it("mas lança, nomeando a variável que falta, quando alguém tenta USAR sem configurar", async () => {
    const { clienteN8n } = await import("../../src/modules/automation/n8n");

    // `clienteN8n` é um Proxy (index.ts linhas 64-70): qualquer acesso de
    // propriedade já passa pelo `get` trap, que chama `obterCliente()` e
    // dispara a validação — não é preciso invocar um método.
    expect(() => clienteN8n.listarWorkflows).toThrow(/Configuração do módulo de automação inválida/);
    // O NOME entra à força na mensagem porque, com valor `undefined`, o Zod
    // falha na checagem de tipo antes de chegar em `.url()`/`.min()` — sem
    // isso sobraria "expected string, received undefined" sem dizer qual
    // variável (comentário em index.ts, linhas 33-37).
    expect(() => clienteN8n.listarWorkflows).toThrow(/N8N_API_URL/);
  });

  it("com as variáveis definidas, clienteN8n funciona e delega ao adapter HTTP real", async () => {
    process.env.N8N_API_URL = "https://n8n.exemplo.invalid";
    process.env.N8N_API_KEY = "chave-teste-nao-usada-em-rede";

    // fetch mockado — nenhuma requisição sai daqui. n8n.nateksoft.com é
    // produção, atendendo clientes reais; este teste nunca fala com rede.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    const { clienteN8n } = await import("../../src/modules/automation/n8n");
    const workflows = await clienteN8n.listarWorkflows();

    // Prova a DELEGAÇÃO, não só a ausência de erro: o Proxy precisa repassar
    // a chamada para uma instância real de `ClienteN8nHttp`, que por sua vez
    // precisa montar a URL e o header certos.
    expect(workflows).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://n8n.exemplo.invalid/api/v1/workflows?limit=100",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-N8N-API-KEY": "chave-teste-nao-usada-em-rede" }),
      })
    );
  });
});
