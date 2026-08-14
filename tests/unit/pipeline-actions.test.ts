import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePathMock(...a) }));

const usuarioAtualMock = vi.fn();
vi.mock("@/core/auth/session", () => ({ usuarioAtual: () => usuarioAtualMock() }));

const { EtapaInvalidaErroFalso } = vi.hoisted(() => {
  class EtapaInvalidaErroFalso extends Error {
    constructor(m: string) {
      super(m);
      this.name = "EtapaInvalidaError";
    }
  }
  return { EtapaInvalidaErroFalso };
});

const criarEtapaMock = vi.fn();
const editarEtapaMock = vi.fn();
const moverNaOrdemMock = vi.fn();
const definirFechamentoMock = vi.fn();
const excluirEtapaMock = vi.fn();

vi.mock("@/core/pipeline/service", () => ({
  EtapaInvalidaError: EtapaInvalidaErroFalso,
  criarEtapa: (...a: unknown[]) => criarEtapaMock(...a),
  editarEtapa: (...a: unknown[]) => editarEtapaMock(...a),
  moverNaOrdem: (...a: unknown[]) => moverNaOrdemMock(...a),
  definirEtapaDeFechamento: (...a: unknown[]) => definirFechamentoMock(...a),
  excluirEtapa: (...a: unknown[]) => excluirEtapaMock(...a),
}));

const acoes = await import("../../src/core/pipeline/actions");

beforeEach(() => {
  revalidatePathMock.mockReset();
  usuarioAtualMock.mockReset().mockResolvedValue({ id: "admin-1", papel: "ADMIN" });
  criarEtapaMock.mockReset().mockResolvedValue({ id: "etapa-1" });
  editarEtapaMock.mockReset().mockResolvedValue({ id: "etapa-1" });
  moverNaOrdemMock.mockReset().mockResolvedValue(undefined);
  definirFechamentoMock.mockReset().mockResolvedValue(undefined);
  excluirEtapaMock.mockReset().mockResolvedValue(0);
});

describe("permissão", () => {
  it.each([
    ["GESTOR"],
    ["VENDEDOR"],
  ])("%s não gerencia o funil: recusa sem chamar o serviço", async (papel) => {
    usuarioAtualMock.mockResolvedValue({ id: "u-1", papel });

    const resultado = await acoes.criarEtapaAction({ nome: "Nova", cor: "#0f62fe" });

    expect(resultado).toEqual({ ok: false, erro: expect.stringMatching(/permissão/i) });
    expect(criarEtapaMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("contrato ResultadoAcao", () => {
  it("sucesso devolve { ok: true } e NUNCA a linha do banco", async () => {
    criarEtapaMock.mockResolvedValue({
      id: "etapa-1", nome: "Nova", cor: "#0f62fe", ordem: 5, ehGanho: false, ehPerdido: false,
    });

    const resultado = await acoes.criarEtapaAction({ nome: "Nova", cor: "#0f62fe" });

    // O retorno de Server Action é serializado para o navegador. Devolver a
    // linha mandaria colunas que a tela não pede — mesmo padrão que produziu o
    // vazamento do funil e que a branch anterior fechou.
    expect(resultado).toEqual({ ok: true });
  });

  it("erro de domínio vira { ok: false } com a frase do serviço, sem lançar", async () => {
    criarEtapaMock.mockRejectedValue(new EtapaInvalidaErroFalso('Já existe uma etapa chamada "Proposta".'));

    const resultado = await acoes.criarEtapaAction({ nome: "Proposta", cor: "#0f62fe" });

    expect(resultado).toEqual({ ok: false, erro: 'Já existe uma etapa chamada "Proposta".' });
  });

  it("erro inesperado NÃO vaza detalhe para a tela", async () => {
    const erroDoConsole = vi.spyOn(console, "error").mockImplementation(() => {});
    criarEtapaMock.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:5432"));

    const resultado = await acoes.criarEtapaAction({ nome: "Nova", cor: "#0f62fe" });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro).not.toMatch(/ECONNREFUSED/);
    erroDoConsole.mockRestore();
  });

  it("sessão inválida vira a mensagem de sessão, não a genérica", async () => {
    const erroDoConsole = vi.spyOn(console, "error").mockImplementation(() => {});
    usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));

    const resultado = await acoes.criarEtapaAction({ nome: "Nova", cor: "#0f62fe" });

    expect(resultado).toEqual({ ok: false, erro: expect.stringMatching(/sessão expirou/i) });
    erroDoConsole.mockRestore();
  });
});

describe("invalidação de cache", () => {
  const CINCO_CAMINHOS = [
    ["/"],
    ["/leads"],
    ["/leads/kanban"],
    ["/(painel)/leads/[id]", "page"],
    ["/(painel)/contatos/[id]", "page"],
  ];

  it("uma etapa criada invalida os CINCO caminhos", async () => {
    await acoes.criarEtapaAction({ nome: "Nova", cor: "#0f62fe" });
    expect(revalidatePathMock.mock.calls).toEqual(CINCO_CAMINHOS);
  });

  // `/contatos/[id]` é o mais fácil de esquecer, e o que motivou esta asserção:
  // `contatos/[id]/page.tsx` renderiza a coluna "Etapa" via `lead.etapaNome`.
  it("renomear invalida o detalhe do CONTATO também", async () => {
    await acoes.editarEtapaAction({ etapaId: "etapa-1", nome: "Renomeada", cor: "#0f62fe" });
    expect(revalidatePathMock).toHaveBeenCalledWith("/(painel)/contatos/[id]", "page");
  });

  it("ação recusada não invalida nada", async () => {
    criarEtapaMock.mockRejectedValue(new EtapaInvalidaErroFalso("Nome repetido."));
    await acoes.criarEtapaAction({ nome: "Proposta", cor: "#0f62fe" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it.each([
    ["moverEtapaNaOrdemAction", () => acoes.moverEtapaNaOrdemAction({ etapaId: "e-1", direcao: "cima" as const })],
    ["definirEtapaDeFechamentoAction", () => acoes.definirEtapaDeFechamentoAction("e-1")],
    ["excluirEtapaAction", () => acoes.excluirEtapaAction({ etapaId: "e-1", destinoId: "e-2" })],
  ])("%s invalida os cinco caminhos", async (_nome, chamar) => {
    await chamar();
    expect(revalidatePathMock.mock.calls).toEqual(CINCO_CAMINHOS);
  });
});
