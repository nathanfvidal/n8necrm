import { describe, it, expect } from "vitest";
import { moduloAtivo } from "../../src/lib/module-gate";
import { client } from "../../config/client";

describe("moduloAtivo", () => {
  it("retorna true para módulo listado em config/client.ts", () => {
    const primeiro = client.modulos[0];
    expect(moduloAtivo(primeiro)).toBe(true);
  });

  it("retorna false para módulo não listado", () => {
    const todos = ["catalog", "analytics", "automation", "campaigns", "finance"] as const;
    const desligado = todos.find((m) => !client.modulos.includes(m));
    if (!desligado) throw new Error("Teste exige ao menos um módulo desligado no config");
    expect(moduloAtivo(desligado)).toBe(false);
  });
});
