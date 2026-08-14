import { describe, it, expect } from "vitest";

import { etapaSchema, LIMITE_NOME_ETAPA } from "../../src/core/pipeline/schema";

describe("etapaSchema — nome", () => {
  it("aceita um nome comum e apara os espaços das pontas", () => {
    const analisado = etapaSchema.safeParse({ nome: "  Negociação  ", cor: "#0f62fe" });
    expect(analisado.success).toBe(true);
    if (analisado.success) expect(analisado.data.nome).toBe("Negociação");
  });

  it("recusa nome em branco, e a mensagem diz o que fazer", () => {
    const analisado = etapaSchema.safeParse({ nome: "   ", cor: "#0f62fe" });
    expect(analisado.success).toBe(false);
    if (!analisado.success) {
      expect(analisado.error.issues[0].message).toMatch(/em branco/i);
    }
  });

  it(`recusa nome acima de ${LIMITE_NOME_ETAPA} caracteres`, () => {
    const analisado = etapaSchema.safeParse({
      nome: "x".repeat(LIMITE_NOME_ETAPA + 1),
      cor: "#0f62fe",
    });
    expect(analisado.success).toBe(false);
  });
});

describe("etapaSchema — cor", () => {
  it("normaliza para minúsculas: #0F62FE vira #0f62fe", () => {
    const analisado = etapaSchema.safeParse({ nome: "Proposta", cor: "#0F62FE" });
    expect(analisado.success).toBe(true);
    if (analisado.success) expect(analisado.data.cor).toBe("#0f62fe");
  });

  // O teste que dá razão a esta validação existir. `etapa.cor` cai direto num
  // `style={{ borderTopColor }}` do kanban e num `fill=` do gráfico do painel;
  // o `<input type="color">` da tela só produz #rrggbb, mas Server Action é
  // endpoint HTTP e responde a qualquer POST.
  it.each([
    "red",
    "#fff",
    "#0f62f",
    "#0f62fee",
    "red; background: url(x)",
    "rgb(0,0,0)",
    "",
  ])("recusa a cor %j", (cor) => {
    expect(etapaSchema.safeParse({ nome: "Proposta", cor }).success).toBe(false);
  });
});
