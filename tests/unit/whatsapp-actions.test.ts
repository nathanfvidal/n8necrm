// Teste de unidade puro (sem Prisma real, sem Next em pé) — mesmo padrão de
// `lead-actions.test.ts`: mocka `@/core/auth/session` (usuarioAtual), o
// módulo de domínio (`./agente`, resolvido aqui como
// `src/modules/whatsapp/agente`) e `next/cache` (revalidatePath lança fora de
// uma requisição real do Next). Isola a lógica das três Server Actions —
// derivação de usuário, tratamento de erro, `revalidatePath` condicional —
// de tudo o que exigiria o Next rodando de verdade.
//
// Cobre especificamente o achado Importante da rodada de correção 1: antes
// desta correção, `usuarioAtual()` rodava FORA do `try` nas três actions, e
// uma sessão inválida (expirada ou usuário desativado — mesma mensagem
// "Não autenticado", ver `src/core/auth/session.ts`) rejeitava a promise sem
// nunca produzir um `ResultadoAcao`: o erro cru atravessava a Server Action e
// a tela não mostrava nada, nem sucesso nem erro. Estes testes provam que as
// três actions agora devolvem `{ ok: false, erro: "Sua sessão expirou..." }`
// em vez de deixar a promise rejeitar.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { User } from "@prisma/client";

const usuarioAtualMock = vi.fn();
vi.mock("@/core/auth/session", () => ({ usuarioAtual: () => usuarioAtualMock() }));

class RespostaHumanaInvalidaErrorMock extends Error {}
const pausarIaMock = vi.fn();
const religarIaMock = vi.fn();
const responderComoHumanoMock = vi.fn();
vi.mock("../../src/modules/whatsapp/agente", () => ({
  pausarIa: (...args: unknown[]) => pausarIaMock(...args),
  religarIa: (...args: unknown[]) => religarIaMock(...args),
  responderComoHumano: (...args: unknown[]) => responderComoHumanoMock(...args),
  RespostaHumanaInvalidaError: RespostaHumanaInvalidaErrorMock,
}));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

const { responderConversaAction, pausarIaAction, religarIaAction } = await import(
  "../../src/modules/whatsapp/actions"
);

const MENSAGEM_SESSAO_INVALIDA = "Sua sessão expirou. Recarregue a página e entre de novo.";

function usuarioFake(overrides: Partial<User> = {}): User {
  return {
    id: "usuario-fake-id",
    nome: "Usuário Fake",
    email: "fake@teste.local",
    senhaHash: "hash",
    papel: "VENDEDOR",
    ativo: true,
    criadoEm: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  usuarioAtualMock.mockReset();
  pausarIaMock.mockReset();
  religarIaMock.mockReset();
  responderComoHumanoMock.mockReset();
  revalidatePathMock.mockReset();
});

describe("sessão inválida (usuarioAtual rejeita — expirada ou usuário desativado)", () => {
  // A MESMA mensagem "Não autenticado" cobre os dois casos, de propósito
  // (ver src/core/auth/session.ts) — por isso um único cenário de mock basta
  // para as três actions: não há um segundo caminho "desativado" a testar
  // separadamente.
  beforeEach(() => {
    usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));
  });

  it("responderConversaAction devolve ResultadoAcao amigável, não rejeita a promise", async () => {
    const resultado = await responderConversaAction("conversa-1", "oi");
    expect(resultado).toEqual({ ok: false, erro: MENSAGEM_SESSAO_INVALIDA });
    expect(responderComoHumanoMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("pausarIaAction devolve ResultadoAcao amigável, não rejeita a promise", async () => {
    const resultado = await pausarIaAction("conversa-1");
    expect(resultado).toEqual({ ok: false, erro: MENSAGEM_SESSAO_INVALIDA });
    expect(pausarIaMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("religarIaAction devolve ResultadoAcao amigável, não rejeita a promise", async () => {
    const resultado = await religarIaAction("conversa-1");
    expect(resultado).toEqual({ ok: false, erro: MENSAGEM_SESSAO_INVALIDA });
    expect(religarIaMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("sessão válida", () => {
  beforeEach(() => {
    usuarioAtualMock.mockResolvedValue(usuarioFake());
  });

  it("responderConversaAction: sucesso chama responderComoHumano com o id da sessão e revalida os dois caminhos", async () => {
    responderComoHumanoMock.mockResolvedValue(undefined);

    const resultado = await responderConversaAction("conversa-1", "oi");

    expect(resultado).toEqual({ ok: true });
    expect(responderComoHumanoMock).toHaveBeenCalledWith("conversa-1", "oi", "usuario-fake-id");
    expect(revalidatePathMock).toHaveBeenCalledWith("/conversas/conversa-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/conversas");
  });

  it("responderConversaAction: erro de validação (RespostaHumanaInvalidaError) repassa a própria mensagem", async () => {
    responderComoHumanoMock.mockRejectedValue(new RespostaHumanaInvalidaErrorMock("Mensagem vazia — nada a enviar."));

    const resultado = await responderConversaAction("conversa-1", "  ");

    expect(resultado).toEqual({ ok: false, erro: "Mensagem vazia — nada a enviar." });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("responderConversaAction: erro inesperado (gateway/banco) vira mensagem genérica, não vaza detalhe interno", async () => {
    responderComoHumanoMock.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5432"));

    const resultado = await responderConversaAction("conversa-1", "oi");

    expect(resultado).toEqual({ ok: false, erro: "Falha ao enviar a resposta. Tente novamente." });
  });

  it("religarIaAction: sucesso chama religarIa e revalida os dois caminhos", async () => {
    religarIaMock.mockResolvedValue(undefined);

    const resultado = await religarIaAction("conversa-1");

    expect(resultado).toEqual({ ok: true });
    expect(religarIaMock).toHaveBeenCalledWith("conversa-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/conversas/conversa-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/conversas");
  });
});
