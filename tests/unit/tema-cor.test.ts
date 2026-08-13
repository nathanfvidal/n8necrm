import { describe, it, expect } from "vitest";
import {
  hexParaOklch,
  oklchParaRgbLinear,
  luminancia,
  contraste,
  girarMatiz,
  formatarOklch,
} from "@/lib/tema/cor";

describe("hexParaOklch", () => {
  it("leva preto e branco aos extremos de L, com croma zero", () => {
    const preto = hexParaOklch("#000000");
    expect(preto.L).toBeCloseTo(0, 3);
    expect(preto.C).toBeCloseTo(0, 3);

    const branco = hexParaOklch("#FFFFFF");
    expect(branco.L).toBeCloseTo(1, 3);
    expect(branco.C).toBeCloseTo(0, 3);
  });

  // Valor de referência publicado para o azul puro de sRGB. Serve de âncora:
  // se a matriz de conversão for trocada por engano, este caso quebra.
  it("converte o azul puro para o valor de referência", () => {
    const azul = hexParaOklch("#0000FF");
    expect(azul.L).toBeCloseTo(0.452, 2);
    expect(azul.C).toBeCloseTo(0.313, 2);
    expect(azul.H).toBeCloseTo(264.05, 0);
  });

  it("aceita minúsculas e converte a cor da marca padrão", () => {
    const marca = hexParaOklch("#0f62fe");
    expect(marca.L).toBeCloseTo(0.556, 1);
    expect(marca.C).toBeCloseTo(0.243, 1);
    expect(marca.H).toBeCloseTo(262, 0);
  });

  it("recusa formato inválido", () => {
    expect(() => hexParaOklch("0F62FE")).toThrow();
    expect(() => hexParaOklch("#FFF")).toThrow();
    expect(() => hexParaOklch("#GGGGGG")).toThrow();
  });
});

describe("luminancia e contraste", () => {
  it("dá 21:1 entre preto e branco", () => {
    const yPreto = luminancia(hexParaOklch("#000000"));
    const yBranco = luminancia(hexParaOklch("#FFFFFF"));
    expect(contraste(yPreto, yBranco)).toBeCloseTo(21, 0);
  });

  it("é simétrico na ordem dos argumentos", () => {
    const a = luminancia(hexParaOklch("#0F62FE"));
    const b = luminancia(hexParaOklch("#FFFFFF"));
    expect(contraste(a, b)).toBeCloseTo(contraste(b, a), 6);
  });

  it("dá 1:1 para a cor contra ela mesma", () => {
    const y = luminancia(hexParaOklch("#0F62FE"));
    expect(contraste(y, y)).toBeCloseTo(1, 6);
  });

  it("pesa o verde mais que o vermelho, como o WCAG manda", () => {
    const yVerde = luminancia(hexParaOklch("#00FF00"));
    const yVermelho = luminancia(hexParaOklch("#FF0000"));
    expect(yVerde).toBeGreaterThan(yVermelho * 3);
  });
});

describe("oklchParaRgbLinear", () => {
  // Cor fora do gamute sRGB: o navegador mapeia sozinho no CSS, mas o cálculo
  // de contraste precisa de um RGB possível. Grampear é aproximação
  // deliberada — sem ela, a luminância sai de um canal negativo e o contraste
  // vira número sem sentido.
  it("grampeia canais fora de 0..1", () => {
    const canais = oklchParaRgbLinear({ L: 0.9, C: 0.37, H: 150 });
    for (const c of canais) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});

describe("girarMatiz", () => {
  it("preserva L e C e normaliza para 0..360", () => {
    const base = { L: 0.5, C: 0.2, H: 350 };
    const girado = girarMatiz(base, 40);
    expect(girado.L).toBe(0.5);
    expect(girado.C).toBe(0.2);
    expect(girado.H).toBeCloseTo(30, 6);
  });

  it("normaliza giro negativo", () => {
    expect(girarMatiz({ L: 0.5, C: 0.2, H: 10 }, -40).H).toBeCloseTo(330, 6);
  });
});

describe("formatarOklch", () => {
  it("emite a função CSS com três casas", () => {
    // Valores escolhidos para não cair em ambiguidade de arredondamento
    // binário: 0.5565.toFixed(3) depende da representação IEEE754 e não é
    // base confiável para um teste.
    expect(formatarOklch({ L: 0.5, C: 0.2, H: 261.9143 }))
      .toBe("oklch(0.5 0.2 261.914)");
  });
});
