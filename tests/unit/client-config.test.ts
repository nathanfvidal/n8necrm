import { describe, it, expect } from "vitest";
import { clientConfigSchema } from "../../config/client.schema";
import { client } from "../../config/client";

describe("config/client.ts", () => {
  it("é válido segundo o schema", () => {
    expect(() => clientConfigSchema.parse(client)).not.toThrow();
  });

  describe("clientConfigSchema rejeita configs inválidas", () => {
    it("rejeita um módulo desconhecido", () => {
      const invalido = {
        ...client,
        modulos: [...client.modulos, "modulo-inexistente"],
      };
      expect(() => clientConfigSchema.parse(invalido)).toThrow();
    });

    it("rejeita funil vazio", () => {
      const invalido = { ...client, funil: [] };
      expect(() => clientConfigSchema.parse(invalido)).toThrow();
    });

    it("rejeita um campo de entidade com tipo inválido", () => {
      const invalido = {
        ...client,
        entidade: {
          ...client.entidade,
          campos: [
            ...client.entidade.campos,
            { nome: "extra", tipo: "invalido", obrigatorio: false, filtravel: false },
          ],
        },
      };
      expect(() => clientConfigSchema.parse(invalido)).toThrow();
    });
  });

  describe("contratos consumidos pelas próximas tasks", () => {
    it("funil não tem etapas duplicadas (Task 9 cria uma PipelineStage por etapa e marca a última como ehGanho)", () => {
      const unicos = new Set(client.funil);
      expect(unicos.size).toBe(client.funil.length);
    });

    it("modulos não tem entradas duplicadas (Task 10 monta o menu iterando sobre client.modulos)", () => {
      const unicos = new Set(client.modulos);
      expect(unicos.size).toBe(client.modulos.length);
    });
  });
});
