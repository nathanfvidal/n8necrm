// Testa o adapter contra `fetch` mockado. NUNCA contra a instância real:
// n8n.nateksoft.com atende clientes em produção, e este arquivo exercita
// ativar/desativar/apagar.
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

process.env.N8N_API_URL = "https://n8n.exemplo.invalid";
process.env.N8N_API_KEY = "chave-de-teste";

const { ClienteN8nHttp, ErroN8n } = await import("../../src/modules/automation/n8n/cliente");

function resposta(corpo: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => corpo, text: async () => JSON.stringify(corpo) };
}

const cliente = () => new ClienteN8nHttp({ baseUrl: "https://n8n.exemplo.invalid", apiKey: "chave-de-teste" });

describe("ClienteN8nHttp", () => {
  beforeEach(() => fetchMock.mockReset());

  it("lista workflows normalizando o formato bruto da API", async () => {
    fetchMock.mockResolvedValueOnce(
      resposta({
        data: [
          { id: "abc", name: "Noiva Inteligente", active: true, nodes: [{}, {}, {}], tags: [{ name: "prod" }], updatedAt: "2026-08-19T21:00:00.000Z" },
        ],
      })
    );

    const workflows = await cliente().listarWorkflows();

    expect(workflows).toEqual([
      { id: "abc", nome: "Noiva Inteligente", ativo: true, nos: 3, tags: ["prod"], atualizadoEm: "2026-08-19T21:00:00.000Z" },
    ]);
  });

  it("manda a chave no header X-N8N-API-KEY, nunca na URL", async () => {
    fetchMock.mockResolvedValueOnce(resposta({ data: [] }));

    await cliente().listarWorkflows();

    const [url, opcoes] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).not.toContain("chave-de-teste");
    expect((opcoes as RequestInit).headers).toMatchObject({ "X-N8N-API-KEY": "chave-de-teste" });
  });

  it("devolve o cursor de paginação das execuções", async () => {
    fetchMock.mockResolvedValueOnce(
      resposta({
        data: [{ id: "1", workflowId: "abc", status: "success", mode: "webhook", startedAt: "2026-08-19T21:00:00.000Z", stoppedAt: "2026-08-19T21:00:02.000Z" }],
        nextCursor: "cursor-2",
      })
    );

    const pagina = await cliente().listarExecucoes({ workflowId: "abc", limite: 20 });

    expect(pagina.proximoCursor).toBe("cursor-2");
    expect(pagina.itens[0]).toEqual({
      id: "1",
      workflowId: "abc",
      status: "success",
      modo: "webhook",
      iniciadoEm: "2026-08-19T21:00:00.000Z",
      terminadoEm: "2026-08-19T21:00:02.000Z",
    });
  });

  it("status desconhecido vira 'unknown' em vez de estourar", async () => {
    fetchMock.mockResolvedValueOnce(
      resposta({ data: [{ id: "1", workflowId: "abc", status: "inventado_no_futuro", mode: "trigger", startedAt: "2026-08-19T21:00:00.000Z", stoppedAt: null }] })
    );

    const pagina = await cliente().listarExecucoes({});

    expect(pagina.itens[0]?.status).toBe("unknown");
  });

  it("reexecutar manda loadWorkflow: true — reexecuta contra a versão ATUAL do fluxo", async () => {
    fetchMock.mockResolvedValueOnce(resposta({ id: "99" }));

    await cliente().reexecutarExecucao("42");

    const [url, opcoes] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://n8n.exemplo.invalid/api/v1/executions/42/retry");
    expect((opcoes as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((opcoes as RequestInit).body))).toEqual({ loadWorkflow: true });
  });

  it("HTTP 401 vira ErroN8n tipo 'nao_autorizado'", async () => {
    fetchMock.mockResolvedValueOnce(resposta({ message: "unauthorized" }, 401));

    await expect(cliente().listarWorkflows()).rejects.toMatchObject({ tipo: "nao_autorizado" });
  });

  it("HTTP 404 vira ErroN8n tipo 'nao_encontrado'", async () => {
    fetchMock.mockResolvedValueOnce(resposta({ message: "not found" }, 404));

    await expect(cliente().buscarWorkflow("sumiu")).rejects.toMatchObject({ tipo: "nao_encontrado" });
  });

  it("falha de rede vira ErroN8n tipo 'inalcancavel', não o erro cru do fetch", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    const erro = await cliente().listarWorkflows().catch((e) => e);

    expect(erro).toBeInstanceOf(ErroN8n);
    expect(erro.tipo).toBe("inalcancavel");
  });

  it("a mensagem do erro nunca contém a chave da API", async () => {
    fetchMock.mockResolvedValueOnce(resposta({ message: "boom" }, 500));

    const erro = await cliente().listarWorkflows().catch((e) => e);

    expect(String(erro.message)).not.toContain("chave-de-teste");
  });
});
