import { describe, it, expect, vi, beforeEach } from "vitest";

const usuarioAtualMock = vi.hoisted(() => vi.fn());
const atualizarLeadMock = vi.hoisted(() => vi.fn());
const arquivarLeadMock = vi.hoisted(() => vi.fn());
const temPermissaoMock = vi.hoisted(() => vi.fn());

// `LeadInvalidoError` mora em `leads/service.ts`, que este teste mocka
// inteiro — sem reexportá-la aqui, o `instanceof` de `paraResultadoErro`
// receberia `undefined` e estouraria. A classe falsa serve ao mesmo
// propósito: marcar "erro seguro de mostrar".
const LeadInvalidoErrorMock = vi.hoisted(() => class LeadInvalidoError extends Error {});

vi.mock("server-only", () => ({}));
vi.mock("@/core/auth/session", () => ({ usuarioAtual: usuarioAtualMock }));
vi.mock("@/core/auth/permissions", () => ({ hasPermission: temPermissaoMock }));
vi.mock("@/core/leads/service", () => ({
  atualizarLead: atualizarLeadMock,
  arquivarLead: arquivarLeadMock,
  desarquivarLead: vi.fn(),
  criarLead: vi.fn(),
  moverEtapa: vi.fn(),
  LeadInvalidoError: LeadInvalidoErrorMock,
}));
vi.mock("@/core/leads/notes", () => ({
  adicionarNota: vi.fn(),
  editarNota: vi.fn(),
  excluirNota: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { atualizarLeadAction } from "../../src/core/leads/actions";

const ENTRADA = {
  leadId: "lead-1",
  valorEstimado: "1.500,50",
  responsavelId: "user-1",
  stageId: "etapa-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  usuarioAtualMock.mockResolvedValue({ id: "user-9", papel: "VENDEDOR" });
  temPermissaoMock.mockReturnValue(true);
  atualizarLeadMock.mockResolvedValue({ id: "lead-1" });
});

describe("atualizarLeadAction", () => {
  it("deriva o autor da sessao, nunca do parametro", async () => {
    await atualizarLeadAction(ENTRADA);
    expect(atualizarLeadMock).toHaveBeenCalledWith(
      expect.objectContaining({ autorId: "user-9" })
    );
  });

  it("devolve ok em caso de sucesso", async () => {
    await expect(atualizarLeadAction(ENTRADA)).resolves.toEqual({ ok: true });
  });

  // Hoje TODO papel tem `mover_lead` (ver a matriz em `auth/permissions.ts`),
  // então nenhum usuário real bate neste caminho. O portão existe mesmo
  // assim, e este teste prova que ele está ligado — no dia em que a matriz
  // ganhar um papel só-leitura, a recusa já funciona.
  it("recusa quem nao tem mover_lead", async () => {
    temPermissaoMock.mockReturnValue(false);
    const resultado = await atualizarLeadAction(ENTRADA);
    expect(resultado).toEqual({ ok: false, erro: expect.stringMatching(/permissão/) });
    expect(atualizarLeadMock).not.toHaveBeenCalled();
  });

  it("usa a permissao mover_lead, nao uma nova", async () => {
    await atualizarLeadAction(ENTRADA);
    expect(temPermissaoMock).toHaveBeenCalledWith("VENDEDOR", "mover_lead");
  });

  it("traduz sessao invalida em vez de vazar o erro cru", async () => {
    usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));
    const resultado = await atualizarLeadAction(ENTRADA);
    expect(resultado.ok).toBe(false);
  });

  it("devolve a mensagem de dominio quando o valor e invalido", async () => {
    atualizarLeadMock.mockRejectedValue(
      new Error('Valor inválido: "1.5" não é um valor em reais.')
    );
    const resultado = await atualizarLeadAction({ ...ENTRADA, valorEstimado: "1.5" });
    expect(resultado).toEqual({ ok: false, erro: expect.stringMatching(/Valor inválido/) });
  });
});
