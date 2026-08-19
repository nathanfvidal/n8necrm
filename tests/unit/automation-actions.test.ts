import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const usuarioAtualMock = vi.fn();
vi.mock("@/core/auth/session", () => ({ usuarioAtual: () => usuarioAtualMock() }));

const registrarAuditoriaMock = vi.fn();
vi.mock("@/core/audit/log", () => ({ registrarAuditoria: (...a: unknown[]) => registrarAuditoriaMock(...a) }));

const clienteMock = {
  ativarWorkflow: vi.fn(),
  desativarWorkflow: vi.fn(),
  apagarWorkflow: vi.fn(),
  reexecutarExecucao: vi.fn(),
};
class ErroN8nFake extends Error {
  constructor(msg: string, readonly tipo: string) {
    super(msg);
    this.name = "ErroN8n";
  }
}
vi.mock("@/modules/automation/n8n", () => ({ clienteN8n: clienteMock, ErroN8n: ErroN8nFake }));

const acoes = await import("../../src/modules/automation/actions");

const ADMIN = { id: "u1", papel: "ADMIN" };
const GESTOR = { id: "u2", papel: "GESTOR" };
const VENDEDOR = { id: "u3", papel: "VENDEDOR" };

describe("actions do modulo automation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usuarioAtualMock.mockResolvedValue(ADMIN);
  });

  it("desativar chama o n8n e grava auditoria com o NOME, nao so o id", async () => {
    clienteMock.desativarWorkflow.mockResolvedValueOnce(undefined);

    const r = await acoes.desativarFluxoAction("wf-1", "Noiva Inteligente");

    expect(r).toEqual({ ok: true });
    expect(clienteMock.desativarWorkflow).toHaveBeenCalledWith("wf-1");
    expect(registrarAuditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        acao: "desativar_fluxo",
        entidade: "N8nWorkflow",
        entidadeId: "wf-1",
        antes: { nome: "Noiva Inteligente", ativo: true },
        depois: { nome: "Noiva Inteligente", ativo: false },
      })
    );
  });

  it("GESTOR e recusado e NADA e chamado no n8n", async () => {
    usuarioAtualMock.mockResolvedValue(GESTOR);

    const r = await acoes.desativarFluxoAction("wf-1", "Noiva Inteligente");

    expect(r.ok).toBe(false);
    expect(clienteMock.desativarWorkflow).not.toHaveBeenCalled();
    expect(registrarAuditoriaMock).not.toHaveBeenCalled();
  });

  it("apagar grava auditoria ANTES de nao poder mais ler o workflow", async () => {
    clienteMock.apagarWorkflow.mockResolvedValueOnce(undefined);

    await acoes.apagarFluxoAction("wf-9", "Barbearia BOX64");

    expect(registrarAuditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({ acao: "apagar_fluxo", entidadeId: "wf-9", antes: { nome: "Barbearia BOX64" } })
    );
  });

  it("se o n8n recusa, NAO grava auditoria de sucesso", async () => {
    clienteMock.desativarWorkflow.mockRejectedValueOnce(new ErroN8nFake("recusou", "recusado"));

    const r = await acoes.desativarFluxoAction("wf-1", "X");

    expect(r.ok).toBe(false);
    expect(registrarAuditoriaMock).not.toHaveBeenCalled();
  });

  it("instancia fora do ar vira mensagem legivel, nao erro cru", async () => {
    clienteMock.ativarWorkflow.mockRejectedValueOnce(new ErroN8nFake("timeout", "inalcancavel"));

    const r = await acoes.ativarFluxoAction("wf-1", "X");

    expect(r).toEqual({ ok: false, erro: expect.stringContaining("n8n") });
  });

  it("reexecutar nao exige gerenciar_fluxos, so ver_fluxos — e diagnostico, nao destruicao", async () => {
    usuarioAtualMock.mockResolvedValue(GESTOR);
    clienteMock.reexecutarExecucao.mockResolvedValueOnce(undefined);

    const r = await acoes.reexecutarExecucaoAction("exec-1", "wf-1");

    expect(r).toEqual({ ok: true });
    expect(clienteMock.reexecutarExecucao).toHaveBeenCalledWith("exec-1");
  });

  it("VENDEDOR e recusado no reexecutar e NADA e chamado no n8n", async () => {
    usuarioAtualMock.mockResolvedValue(VENDEDOR);

    const r = await acoes.reexecutarExecucaoAction("exec-1", "wf-1");

    expect(r.ok).toBe(false);
    expect(clienteMock.reexecutarExecucao).not.toHaveBeenCalled();
    expect(registrarAuditoriaMock).not.toHaveBeenCalled();
  });

  it("sessao invalida vira mensagem de sessao, nao erro cru", async () => {
    usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));

    const r = await acoes.desativarFluxoAction("wf-1", "X");

    expect(r.ok).toBe(false);
  });
});
