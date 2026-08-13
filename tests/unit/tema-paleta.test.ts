import { describe, it, expect } from "vitest";
import { hexParaOklch, luminancia, contraste } from "@/lib/tema/cor";
import { derivarPaleta, CROMA_MINIMO } from "@/lib/tema/paleta";

describe("derivarPaleta", () => {
  it("recusa cor de croma abaixo do piso", () => {
    // #808080 é cinza puro: croma zero.
    expect(() => derivarPaleta(hexParaOklch("#808080"))).toThrow(/croma/i);
  });

  it("aceita marca escura sem reclamar da luminosidade", () => {
    // Azul-marinho: L baixo, croma suficiente. Recusar seria o sistema
    // sendo burro — a identidade é matiz e croma, não luminosidade.
    expect(() => derivarPaleta(hexParaOklch("#0B2545"))).not.toThrow();
  });

  it("mantém o vermelho de destructive fora da derivação", () => {
    const azul = derivarPaleta(hexParaOklch("#0F62FE"));
    const verde = derivarPaleta(hexParaOklch("#0E8A16"));
    expect(azul.claro.destructive).toEqual(verde.claro.destructive);
    expect(azul.claro.destructive.H).toBeCloseTo(27, 6);
  });

  it("dá às cinco cores de gráfico L e C iguais entre si", () => {
    const { claro } = derivarPaleta(hexParaOklch("#0F62FE"));
    const series = [1, 2, 3, 4, 5].map((n) => claro[`chart-${n}`]);
    for (const s of series) {
      expect(s.L).toBeCloseTo(series[0].L, 6);
      expect(s.C).toBeCloseTo(series[0].C, 6);
    }
    // ...e matizes distintos, senão não dá para diferenciar série nenhuma.
    const matizes = new Set(series.map((s) => Math.round(s.H)));
    expect(matizes.size).toBe(5);
  });

  it("aplica piso de croma nos gráficos, mesmo com marca pálida", () => {
    // Oklch construída, não hex: precisa de croma ENTRE o piso de entrada
    // (0.04) e o piso dos gráficos (0.10) para o caso significar alguma
    // coisa, e adivinhar um hex nessa faixa é chute.
    const { claro } = derivarPaleta({ L: 0.6, C: 0.05, H: 250 });
    expect(claro["chart-1"].C).toBeGreaterThanOrEqual(0.1);
  });

  it("deixa fundo e cartão do tema claro sem croma nenhum", () => {
    const { claro } = derivarPaleta(hexParaOklch("#0F62FE"));
    expect(claro.background.C).toBe(0);
    expect(claro.card.C).toBe(0);
  });

  it("mantém as superfícies abaixo do teto de sussurro", () => {
    const { claro, escuro } = derivarPaleta(hexParaOklch("#0F62FE"));
    expect(claro.muted.C).toBeLessThanOrEqual(0.006);
    expect(claro.accent.C).toBeLessThanOrEqual(0.012);
    expect(escuro.border.C).toBeLessThanOrEqual(0.01);
  });

  it("dá à primária o croma cheio da marca", () => {
    const marca = hexParaOklch("#0F62FE");
    const { claro } = derivarPaleta(marca);
    expect(claro.primary.C).toBeCloseTo(marca.C, 6);
    expect(claro.primary.H).toBeCloseTo(marca.H, 6);
  });

  it("iguala o ring à primária", () => {
    const { claro, escuro } = derivarPaleta(hexParaOklch("#0F62FE"));
    expect(claro.ring).toEqual(claro.primary);
    expect(escuro.ring).toEqual(escuro.primary);
  });
});

describe("invariante de contraste", () => {
  // O teste central da spec. Roda sobre uma GRADE, não sobre um caso: um
  // único exemplo passaria com o texto fixado em branco, que é exatamente o
  // defeito que este teste existe para pegar.
  it("garante 4.5:1 entre primary e primary-foreground para toda marca válida", () => {
    let casos = 0;

    for (let H = 0; H < 360; H += 15) {
      for (let C = CROMA_MINIMO; C <= 0.37; C += 0.03) {
        for (let L = 0.1; L <= 0.9; L += 0.1) {
          const { claro, escuro } = derivarPaleta({ L, C, H });

          for (const tema of [claro, escuro]) {
            const razao = contraste(
              luminancia(tema.primary),
              luminancia(tema["primary-foreground"]),
            );
            expect(razao).toBeGreaterThanOrEqual(4.5);
            casos++;
          }
        }
      }
    }

    // Prova que a grade rodou de verdade — um laço com limite errado
    // passaria em silêncio sem esta linha.
    expect(casos).toBeGreaterThan(4000);
  });

  it("escolhe preto sobre marca clara e branco sobre marca escura", () => {
    const clara = derivarPaleta({ L: 0.9, C: 0.15, H: 90 });
    expect(clara.claro["primary-foreground"].L).toBeCloseTo(0, 3);

    const escura = derivarPaleta({ L: 0.2, C: 0.15, H: 260 });
    expect(escura.claro["primary-foreground"].L).toBeCloseTo(1, 3);
  });
});
