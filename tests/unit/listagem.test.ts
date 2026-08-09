// Teto das listagens de tela.
//
// Duas camadas de prova, de propósito:
//
// 1. `aplicarTeto` como função pura — a regra de "quando truncou", incluindo
//    a fronteira exata que motiva buscar `limite + 1` linhas.
// 2. `listarLeads` contra o POSTGRES REAL — que o `take` chega mesmo à
//    consulta. A função pura passaria feliz mesmo se o `take` tivesse sido
//    esquecido no `findMany`, e aí o teto não existiria onde importa: o banco
//    continuaria devolvendo a tabela inteira.
import "dotenv/config";

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { aplicarTeto, LIMITE_LISTAGEM } from "../../src/core/listagem";

const { listarLeads } = await import("../../src/core/leads/queries");

describe("aplicarTeto", () => {
  it("abaixo do limite: devolve tudo, sem truncar", () => {
    expect(aplicarTeto([1, 2], 5)).toEqual({ itens: [1, 2], truncado: false });
  });

  // A fronteira que justifica buscar `limite + 1` no banco: com exatamente
  // `limite` linhas NÃO houve truncamento, e avisar aqui seria alarme falso.
  it("exatamente no limite: devolve tudo, e NAO marca como truncado", () => {
    expect(aplicarTeto([1, 2, 3], 3)).toEqual({ itens: [1, 2, 3], truncado: false });
  });

  it("uma linha acima do limite: corta no limite e marca truncado", () => {
    expect(aplicarTeto([1, 2, 3, 4], 3)).toEqual({ itens: [1, 2, 3], truncado: true });
  });

  it("o teto padrao e' folgado o bastante para nenhum cliente atual encostar", () => {
    expect(LIMITE_LISTAGEM).toBeGreaterThanOrEqual(500);
  });
});

describe("listarLeads — o teto chega na consulta", () => {
  // Usa o dado que já existe no banco (o seed tem leads) com um limite
  // pequeno, em vez de criar 1001 linhas: o que precisa ser provado é que o
  // `take` é aplicado, não qual é o número.
  it("com limite 1 devolve UMA linha e avisa que truncou", async () => {
    const resultado = await listarLeads({ limite: 1 });

    expect(resultado.itens).toHaveLength(1);
    expect(resultado.truncado).toBe(true);
  });

  // Sem esta prova, a exportação CSV poderia passar a truncar em silêncio —
  // um arquivo incompleto indistinguível de um completo.
  it("semTeto devolve mais que o limite pedido, e nunca marca truncado", async () => {
    const comTeto = await listarLeads({ limite: 1 });
    const semTeto = await listarLeads({ semTeto: true });

    expect(semTeto.truncado).toBe(false);
    expect(semTeto.itens.length).toBeGreaterThan(comTeto.itens.length);
  });
});
