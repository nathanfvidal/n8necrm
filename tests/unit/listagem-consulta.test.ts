// Prova que o teto chega à CONSULTA, não só ao retorno.
//
// Arquivo separado de `listagem.test.ts` (que usa o Postgres real) porque aqui
// o Prisma é mockado de propósito — e é o único jeito de provar o que precisa
// ser provado.
//
// A sabotagem que motivou este arquivo: removendo `take` do `findMany`, os
// seis testes de `listagem.test.ts` continuaram verdes. E com razão —
// `aplicarTeto` fatia em memória, então o valor DEVOLVIDO fica idêntico com ou
// sem `take`. Só que o `take` existe justamente para o banco não carregar a
// tabela inteira: sem ele o teto vira enfeite, e o problema que ele deveria
// resolver (uma listagem que cresce sem freio junto com o banco) continua
// inteiro, invisível para qualquer teste que olhe só o retorno.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const findManyMock = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { lead: { findMany: (...args: unknown[]) => findManyMock(...args) } },
}));

const { listarLeads } = await import("../../src/core/leads/queries");
const { LIMITE_LISTAGEM } = await import("../../src/core/listagem");

beforeEach(() => {
  findManyMock.mockReset().mockResolvedValue([]);
});

/** Argumento único que `listarLeads` passou ao `findMany`. */
function argumentos(): Record<string, unknown> {
  return findManyMock.mock.calls[0][0] as Record<string, unknown>;
}

describe("listarLeads — forma da consulta", () => {
  it("pede ao banco LIMITE + 1 linhas por padrao", async () => {
    await listarLeads();

    expect(argumentos().take).toBe(LIMITE_LISTAGEM + 1);
  });

  // O "+1" não é detalhe de implementação: é o que distingue "exatamente
  // `limite` linhas" de "`limite` e tem mais". Pedir exatamente `limite`
  // tornaria impossível saber se truncou, e o aviso na tela viraria chute.
  it("com limite explicito, pede limite + 1 — nunca o limite cru", async () => {
    await listarLeads({ limite: 25 });

    expect(argumentos().take).toBe(26);
  });

  it("semTeto NAO manda take nenhum — a exportacao precisa de tudo", async () => {
    await listarLeads({ semTeto: true });

    expect(argumentos().take).toBeUndefined();
  });

  it("o teto nao atropela o filtro de arquivados", async () => {
    await listarLeads();
    expect(argumentos().where).toEqual({ arquivadoEm: null });

    findManyMock.mockClear();
    await listarLeads({ incluirArquivados: true });
    expect(argumentos().where).toEqual({});
  });
});
