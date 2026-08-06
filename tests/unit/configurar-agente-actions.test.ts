// Teste de unidade puro (sem Prisma real, sem Next em pé) — mesmo padrão de
// tests/unit/whatsapp-actions.test.ts: mocka `@/core/auth/session`
// (usuarioAtual) e o módulo de domínio (`./agente`, resolvido aqui como
// `src/modules/whatsapp/agente`) e `next/cache` (revalidatePath lança fora de
// uma requisição real do Next). `@/core/auth/permissions` NÃO é mockado —
// `hasPermission` é lógica pura, sem I/O, então usar a implementação real
// testa a guarda de fato, não uma suposição sobre ela.
//
// Isola a lógica das duas Server Actions de
// `src/modules/whatsapp/agente-actions.ts` — guarda de permissão, validação
// de entrada, e o ponto que derrubou uma rodada de revisão anterior nesta
// fatia (Task 5, ver o comentário em `src/modules/whatsapp/actions.ts`):
// `usuarioAtual()` precisa rodar DENTRO do `try`, porque fora dele uma sessão
// inválida rejeita a promise sem nunca produzir um `ResultadoAcao`, e a tela
// não mostra nada, nem sucesso nem erro.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { User } from "@prisma/client";
import { MAX_PERSONA_NOME, MAX_PERSONA_PAPEL, MAX_REGRA, MAX_FAQ } from "../../src/modules/whatsapp/agente-limites";

const usuarioAtualMock = vi.fn();
vi.mock("@/core/auth/session", () => ({ usuarioAtual: () => usuarioAtualMock() }));

const salvarConfigBotMock = vi.fn();
const restaurarConfigPadraoMock = vi.fn();
vi.mock("../../src/modules/whatsapp/agente", () => ({
  salvarConfigBot: (...args: unknown[]) => salvarConfigBotMock(...args),
  restaurarConfigPadrao: (...args: unknown[]) => restaurarConfigPadraoMock(...args),
}));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

const { salvarConfigAgenteAction, restaurarConfigPadraoAction } = await import(
  "../../src/modules/whatsapp/agente-actions"
);

const MENSAGEM_SESSAO_INVALIDA = "Sua sessão expirou. Recarregue a página e entre de novo.";
const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão para configurar o agente.";

function usuarioFake(overrides: Partial<User> = {}): User {
  return {
    id: "usuario-fake-id",
    nome: "Usuário Fake",
    email: "fake@teste.local",
    senhaHash: "hash",
    papel: "ADMIN",
    ativo: true,
    criadoEm: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

const CONFIG_VALIDA = {
  ativo: true,
  personaNome: "Ana",
  personaPapel: "atendente virtual",
  regras: ["regra 1"],
  faq: "faq",
};

beforeEach(() => {
  usuarioAtualMock.mockReset();
  salvarConfigBotMock.mockReset();
  restaurarConfigPadraoMock.mockReset();
  revalidatePathMock.mockReset();
});

describe("sessão inválida (usuarioAtual rejeita — expirada ou usuário desativado)", () => {
  beforeEach(() => {
    usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));
  });

  it("salvarConfigAgenteAction devolve ResultadoAcao amigável, não rejeita a promise", async () => {
    const resultado = await salvarConfigAgenteAction(CONFIG_VALIDA);
    expect(resultado).toEqual({ ok: false, erro: MENSAGEM_SESSAO_INVALIDA });
    expect(salvarConfigBotMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("restaurarConfigPadraoAction devolve ResultadoAcao amigável, não rejeita a promise", async () => {
    const resultado = await restaurarConfigPadraoAction();
    expect(resultado).toEqual({ ok: false, erro: MENSAGEM_SESSAO_INVALIDA });
    expect(restaurarConfigPadraoMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("sessão válida, mas sem a permissão configurar_agente (GESTOR/VENDEDOR)", () => {
  it.each(["GESTOR", "VENDEDOR"] as const)("salvarConfigAgenteAction recusa %s e não toca a config", async (papel) => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel }));
    const resultado = await salvarConfigAgenteAction(CONFIG_VALIDA);
    expect(resultado).toEqual({ ok: false, erro: MENSAGEM_SEM_PERMISSAO });
    expect(salvarConfigBotMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it.each(["GESTOR", "VENDEDOR"] as const)("restaurarConfigPadraoAction recusa %s e não toca a config", async (papel) => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel }));
    const resultado = await restaurarConfigPadraoAction();
    expect(resultado).toEqual({ ok: false, erro: MENSAGEM_SEM_PERMISSAO });
    expect(restaurarConfigPadraoMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("ADMIN autenticado", () => {
  beforeEach(() => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));
  });

  it("salvarConfigAgenteAction: sucesso apara espaços, descarta regras em branco e revalida a rota", async () => {
    salvarConfigBotMock.mockResolvedValue(undefined);

    const resultado = await salvarConfigAgenteAction({
      ativo: true,
      personaNome: "  Ana  ",
      personaPapel: "  atendente  ",
      regras: ["  regra 1  ", "   ", "regra 2"],
      faq: "  faq  ",
    });

    expect(resultado).toEqual({ ok: true });
    expect(salvarConfigBotMock).toHaveBeenCalledWith(
      {
        ativo: true,
        personaNome: "Ana",
        personaPapel: "atendente",
        regras: ["regra 1", "regra 2"],
        faq: "faq",
      },
      "usuario-fake-id"
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/conversas/agente");
  });

  it("salvarConfigAgenteAction: nome vazio é rejeitado sem chamar salvarConfigBot", async () => {
    const resultado = await salvarConfigAgenteAction({ ...CONFIG_VALIDA, personaNome: "   " });
    expect(resultado).toEqual({ ok: false, erro: "Nome e papel da persona são obrigatórios." });
    expect(salvarConfigBotMock).not.toHaveBeenCalled();
  });

  it("salvarConfigAgenteAction: papel vazio é rejeitado sem chamar salvarConfigBot", async () => {
    const resultado = await salvarConfigAgenteAction({ ...CONFIG_VALIDA, personaPapel: "" });
    expect(resultado).toEqual({ ok: false, erro: "Nome e papel da persona são obrigatórios." });
    expect(salvarConfigBotMock).not.toHaveBeenCalled();
  });

  it("salvarConfigAgenteAction: nenhuma regra sobrevivendo ao trim é rejeitada sem chamar salvarConfigBot", async () => {
    const resultado = await salvarConfigAgenteAction({ ...CONFIG_VALIDA, regras: ["   ", ""] });
    expect(resultado).toEqual({ ok: false, erro: "O agente precisa de pelo menos uma regra." });
    expect(salvarConfigBotMock).not.toHaveBeenCalled();
  });

  // Rodada de correção 1, achado I1: nenhum campo tinha teto de tamanho —
  // personaNome/personaPapel/regra/faq entram no prompt de sistema em TODO
  // turno de TODA conversa, então um campo gigante multiplica o custo de
  // token de cada resposta, em silêncio. Os quatro testes abaixo provam que
  // a action recusa antes de tocar `salvarConfigBot`, não só que a tela
  // desencoraja digitar demais.
  it("salvarConfigAgenteAction: nome da persona acima do limite é rejeitado sem chamar salvarConfigBot", async () => {
    const resultado = await salvarConfigAgenteAction({
      ...CONFIG_VALIDA,
      personaNome: "a".repeat(MAX_PERSONA_NOME + 1),
    });
    expect(resultado).toEqual({
      ok: false,
      erro: `Nome da persona acima do limite de ${MAX_PERSONA_NOME} caracteres.`,
    });
    expect(salvarConfigBotMock).not.toHaveBeenCalled();
  });

  it("salvarConfigAgenteAction: papel da persona acima do limite é rejeitado sem chamar salvarConfigBot", async () => {
    const resultado = await salvarConfigAgenteAction({
      ...CONFIG_VALIDA,
      personaPapel: "a".repeat(MAX_PERSONA_PAPEL + 1),
    });
    expect(resultado).toEqual({
      ok: false,
      erro: `Papel da persona acima do limite de ${MAX_PERSONA_PAPEL} caracteres.`,
    });
    expect(salvarConfigBotMock).not.toHaveBeenCalled();
  });

  it("salvarConfigAgenteAction: uma regra acima do limite é rejeitada sem chamar salvarConfigBot", async () => {
    const resultado = await salvarConfigAgenteAction({
      ...CONFIG_VALIDA,
      regras: ["regra normal", "a".repeat(MAX_REGRA + 1)],
    });
    expect(resultado).toEqual({
      ok: false,
      erro: `Cada regra pode ter no máximo ${MAX_REGRA} caracteres.`,
    });
    expect(salvarConfigBotMock).not.toHaveBeenCalled();
  });

  it("salvarConfigAgenteAction: FAQ acima do limite é rejeitada sem chamar salvarConfigBot", async () => {
    const resultado = await salvarConfigAgenteAction({
      ...CONFIG_VALIDA,
      faq: "a".repeat(MAX_FAQ + 1),
    });
    expect(resultado).toEqual({ ok: false, erro: `FAQ acima do limite de ${MAX_FAQ} caracteres.` });
    expect(salvarConfigBotMock).not.toHaveBeenCalled();
  });

  it("salvarConfigAgenteAction: exatamente no limite é aceito (limite não é off-by-one)", async () => {
    salvarConfigBotMock.mockResolvedValue(undefined);
    const resultado = await salvarConfigAgenteAction({
      ativo: true,
      personaNome: "a".repeat(MAX_PERSONA_NOME),
      personaPapel: "a".repeat(MAX_PERSONA_PAPEL),
      regras: ["a".repeat(MAX_REGRA)],
      faq: "a".repeat(MAX_FAQ),
    });
    expect(resultado).toEqual({ ok: true });
    expect(salvarConfigBotMock).toHaveBeenCalledTimes(1);
  });

  it("salvarConfigAgenteAction: erro inesperado (banco) vira mensagem genérica, não vaza detalhe interno", async () => {
    salvarConfigBotMock.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5432"));
    const resultado = await salvarConfigAgenteAction(CONFIG_VALIDA);
    expect(resultado).toEqual({
      ok: false,
      erro: "Falha ao salvar a configuração do agente. Tente novamente.",
    });
  });

  it("restaurarConfigPadraoAction: sucesso chama restaurarConfigPadrao com o id da sessão e revalida a rota", async () => {
    restaurarConfigPadraoMock.mockResolvedValue(undefined);
    const resultado = await restaurarConfigPadraoAction();
    expect(resultado).toEqual({ ok: true });
    expect(restaurarConfigPadraoMock).toHaveBeenCalledWith("usuario-fake-id");
    expect(revalidatePathMock).toHaveBeenCalledWith("/conversas/agente");
  });

  it("restaurarConfigPadraoAction: erro inesperado (banco) vira mensagem genérica, não vaza detalhe interno", async () => {
    restaurarConfigPadraoMock.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5432"));
    const resultado = await restaurarConfigPadraoAction();
    expect(resultado).toEqual({
      ok: false,
      erro: "Falha ao restaurar a configuração padrão. Tente novamente.",
    });
  });
});
