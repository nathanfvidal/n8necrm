import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const usuarioAtualMock = vi.fn();
vi.mock("@/core/auth/session", () => ({ usuarioAtual: () => usuarioAtualMock() }));

const registrarAuditoriaMock = vi.fn();
vi.mock("@/core/audit/log", () => ({ registrarAuditoria: (...a: unknown[]) => registrarAuditoriaMock(...a) }));

const clienteMock = {
  buscarWorkflow: vi.fn(),
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
const { MENSAGEM_SESSAO_INVALIDA } = await import("../../src/lib/acao");

const ADMIN = { id: "u1", papel: "ADMIN" };
const GESTOR = { id: "u2", papel: "GESTOR" };
const VENDEDOR = { id: "u3", papel: "VENDEDOR" };

describe("actions do modulo automation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usuarioAtualMock.mockResolvedValue(ADMIN);
  });

  it("desativar LE o estado real do n8n e grava auditoria com o nome e o ativo VERDADEIROS, nao os do parametro", async () => {
    // Achado I1 da revisao final: antes/depois vinham de parametro que quem
    // chama a Server Action escolhe. Aqui o mock devolve um nome DIFERENTE
    // do que qualquer chamador poderia ter digitado, provando que quem
    // decide o que vai pro AuditLog e a LEITURA, nao o parametro.
    clienteMock.buscarWorkflow.mockResolvedValueOnce({
      id: "wf-1",
      nome: "Noiva Inteligente",
      ativo: true,
      nos: 65,
      tags: [],
      atualizadoEm: "",
    });
    clienteMock.desativarWorkflow.mockResolvedValueOnce(undefined);

    const r = await acoes.desativarFluxoAction("wf-1");

    expect(r).toEqual({ ok: true });
    expect(clienteMock.buscarWorkflow).toHaveBeenCalledWith("wf-1");
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

  it("ativar um fluxo que JA estava ativo grava o antes.ativo REAL (true), nao um antes forjado", async () => {
    // Este e o problema concreto #1 do achado I1: o codigo antigo gravava
    // sempre `antes: { ativo: false }` para ativar, mesmo quando o fluxo ja
    // estava ativo — uma transicao que nao aconteceu.
    clienteMock.buscarWorkflow.mockResolvedValueOnce({
      id: "wf-1",
      nome: "X",
      ativo: true,
      nos: 1,
      tags: [],
      atualizadoEm: "",
    });
    clienteMock.ativarWorkflow.mockResolvedValueOnce(undefined);

    await acoes.ativarFluxoAction("wf-1");

    expect(registrarAuditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({ antes: { nome: "X", ativo: true }, depois: { nome: "X", ativo: true } })
    );
  });

  it("GESTOR e recusado, NADA e chamado no n8n e o estado real nem chega a ser lido", async () => {
    usuarioAtualMock.mockResolvedValue(GESTOR);

    const r = await acoes.desativarFluxoAction("wf-1");

    expect(r.ok).toBe(false);
    expect(clienteMock.buscarWorkflow).not.toHaveBeenCalled();
    expect(clienteMock.desativarWorkflow).not.toHaveBeenCalled();
    expect(registrarAuditoriaMock).not.toHaveBeenCalled();
  });

  it("apagar LE o nome real do n8n ANTES do DELETE, nao usa nome de parametro (a action nem aceita mais)", async () => {
    clienteMock.buscarWorkflow.mockResolvedValueOnce({
      id: "wf-9",
      nome: "Barbearia BOX64",
      ativo: true,
      nos: 3,
      tags: [],
      atualizadoEm: "",
    });
    clienteMock.apagarWorkflow.mockResolvedValueOnce(undefined);

    await acoes.apagarFluxoAction("wf-9");

    // A ordem importa: ler antes de apagar, nunca depois — depois do DELETE
    // nao ha de onde reconstituir o nome.
    const ordemLeitura = clienteMock.buscarWorkflow.mock.invocationCallOrder[0];
    const ordemDelete = clienteMock.apagarWorkflow.mock.invocationCallOrder[0];
    expect(ordemLeitura).toBeLessThan(ordemDelete);

    expect(registrarAuditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({ acao: "apagar_fluxo", entidadeId: "wf-9", antes: { nome: "Barbearia BOX64" } })
    );
  });

  it("se a LEITURA do estado real falha, aborta — o n8n nunca chega a ser chamado para agir", async () => {
    // Decisao registrada no comentario de `apagarFluxoAction`: para uma
    // operacao irreversivel, falhar sem agir e mais seguro que seguir com um
    // nome de parametro nao confirmado.
    clienteMock.buscarWorkflow.mockRejectedValueOnce(new ErroN8nFake("fora do ar", "inalcancavel"));

    const r = await acoes.apagarFluxoAction("wf-9");

    expect(r.ok).toBe(false);
    expect(clienteMock.apagarWorkflow).not.toHaveBeenCalled();
    expect(registrarAuditoriaMock).not.toHaveBeenCalled();
  });

  it("se o n8n recusa a ESCRITA (depois de ler o estado com sucesso), NAO grava auditoria de sucesso", async () => {
    clienteMock.buscarWorkflow.mockResolvedValueOnce({
      id: "wf-1",
      nome: "X",
      ativo: true,
      nos: 1,
      tags: [],
      atualizadoEm: "",
    });
    clienteMock.desativarWorkflow.mockRejectedValueOnce(new ErroN8nFake("recusou", "recusado"));

    const r = await acoes.desativarFluxoAction("wf-1");

    expect(r.ok).toBe(false);
    expect(registrarAuditoriaMock).not.toHaveBeenCalled();
  });

  it("instancia fora do ar vira mensagem legivel, nao erro cru", async () => {
    clienteMock.buscarWorkflow.mockResolvedValueOnce({
      id: "wf-1",
      nome: "X",
      ativo: false,
      nos: 1,
      tags: [],
      atualizadoEm: "",
    });
    clienteMock.ativarWorkflow.mockRejectedValueOnce(new ErroN8nFake("timeout", "inalcancavel"));

    const r = await acoes.ativarFluxoAction("wf-1");

    expect(r).toEqual({ ok: false, erro: expect.stringContaining("n8n") });
  });

  it("reexecutar nao exige gerenciar_fluxos, so ver_fluxos — e diagnostico, nao destruicao", async () => {
    usuarioAtualMock.mockResolvedValue(GESTOR);
    clienteMock.reexecutarExecucao.mockResolvedValueOnce(undefined);

    const r = await acoes.reexecutarExecucaoAction("exec-1", "wf-1");

    expect(r).toEqual({ ok: true });
    expect(clienteMock.reexecutarExecucao).toHaveBeenCalledWith("exec-1");
    expect(registrarAuditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u2",
        acao: "reexecutar_execucao",
        entidade: "N8nExecucao",
        entidadeId: "exec-1",
        depois: { workflowId: "wf-1" },
      })
    );
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

    const r = await acoes.desativarFluxoAction("wf-1");

    expect(r.ok).toBe(false);
    expect(r).toEqual({ ok: false, erro: MENSAGEM_SESSAO_INVALIDA });
  });
});
