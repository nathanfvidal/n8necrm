import { describe, it, expect } from "vitest";

import { parseValorBR, formatarValorBR, mascararValorBR } from "../../src/lib/dinheiro";

describe("parseValorBR", () => {
  it("aceita o formato brasileiro completo", () => {
    expect(parseValorBR("1.500,50").toString()).toBe("1500.5");
  });

  it("aceita valor sem separador de milhar", () => {
    expect(parseValorBR("1500,50").toString()).toBe("1500.5");
  });

  it("aceita inteiro sem decimais", () => {
    expect(parseValorBR("1500").toString()).toBe("1500");
  });

  // O caso que dá o bug silencioso: parseFloat("1.500") devolve 1.5.
  it("trata ponto como MILHAR, nunca como decimal", () => {
    expect(parseValorBR("1.500").toString()).toBe("1500");
    expect(parseValorBR("1.500.000").toString()).toBe("1500000");
  });

  // Ambíguo entre 1,5 e 15 — recusar é a única resposta honesta.
  it("recusa ponto que não forma grupo de milhar", () => {
    expect(() => parseValorBR("1.5")).toThrow(/Valor inválido/);
    expect(() => parseValorBR("1.50")).toThrow(/Valor inválido/);
    expect(() => parseValorBR("12.34")).toThrow(/Valor inválido/);
  });

  it("recusa mais de duas casas decimais", () => {
    expect(() => parseValorBR("10,123")).toThrow(/Valor inválido/);
  });

  it("recusa texto que não é número", () => {
    expect(() => parseValorBR("mil e quinhentos")).toThrow(/Valor inválido/);
    expect(() => parseValorBR("")).toThrow(/Valor inválido/);
    expect(() => parseValorBR("-100")).toThrow(/Valor inválido/);
  });
});

describe("mascararValorBR", () => {
  // Os algarismos são CENTAVOS: "15050" são 15.050 centavos = R$ 150,50.
  it("monta o valor pela direita, como caixa de banco", () => {
    expect(mascararValorBR("15050")).toBe("150,50");
    expect(mascararValorBR("150050")).toBe("1.500,50");
    expect(mascararValorBR("15000000")).toBe("150.000,00");
    expect(mascararValorBR("150000000")).toBe("1.500.000,00");
  });

  it("preenche centavos quando há poucos dígitos", () => {
    expect(mascararValorBR("5")).toBe("0,05");
    expect(mascararValorBR("")).toBe("");
  });

  it("ignora tudo que não é algarismo", () => {
    expect(mascararValorBR("R$ 1.500,50")).toBe("1.500,50");
  });
});

describe("formatarValorBR", () => {
  it("devolve string vazia para valor ausente", () => {
    expect(formatarValorBR(null)).toBe("");
  });

  it("formata com duas casas e separador de milhar", () => {
    expect(formatarValorBR("1500.5")).toBe("1.500,50");
  });

  // Prova a ida e volta: o que a máscara mostra, o parse aceita.
  it("o que mascararValorBR produz, parseValorBR aceita", () => {
    const mascarado = mascararValorBR("150000000");
    expect(parseValorBR(mascarado).toString()).toBe("1500000");
  });
});
