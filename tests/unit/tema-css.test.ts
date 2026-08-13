import { describe, it, expect } from "vitest";
import { derivarTema } from "@/lib/tema";

const css = derivarTema({ corPrimaria: "#0F62FE" });

describe("derivarTema", () => {
  it("dobra a especificidade dos dois blocos", () => {
    // `:root:root` casa o mesmo elemento que `:root`, com especificidade
    // maior — é o que torna a vitória sobre globals.css independente da
    // ordem em que o Next insere o bundle de CSS.
    expect(css).toContain(":root:root{");
    expect(css).toContain(":root:root.dark{");
  });

  it("emite os tokens obrigatórios nos dois temas", () => {
    for (const bloco of css.split(":root:root").slice(1)) {
      for (const token of ["--primary", "--primary-foreground", "--background",
                           "--sidebar", "--ring", "--destructive", "--chart-1"]) {
        expect(bloco).toContain(`${token}:`);
      }
    }
  });

  it("usa a função oklch do CSS", () => {
    expect(css).toMatch(/--primary:oklch\([\d.]+ [\d.]+ [\d.]+\)/);
  });

  it("não emite quebra de linha — vai inline no HTML", () => {
    expect(css).not.toContain("\n");
  });

  it("propaga a recusa de cor inválida", () => {
    expect(() => derivarTema({ corPrimaria: "#808080" })).toThrow(/croma/i);
  });
});
