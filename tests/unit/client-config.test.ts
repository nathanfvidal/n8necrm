import { describe, it, expect } from "vitest";
import { clientConfigSchema } from "../../config/client.schema";
import { client } from "../../config/client";

describe("config/client.ts", () => {
  it("é válido segundo o schema", () => {
    expect(() => clientConfigSchema.parse(client)).not.toThrow();
  });

  it("tem ao menos uma etapa de funil", () => {
    expect(client.funil.length).toBeGreaterThan(0);
  });

  it("só referencia módulos conhecidos", () => {
    const modulosValidos = ["catalog", "analytics", "automation", "campaigns", "finance"];
    for (const m of client.modulos) {
      expect(modulosValidos).toContain(m);
    }
  });
});
