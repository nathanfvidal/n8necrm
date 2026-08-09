import { describe, it, expect } from "vitest";
import { clientConfigSchema, marcaSchema } from "../../config/client.schema";
import { client } from "../../config/client";

describe("marcaSchema", () => {
  it("aceita uma marca completa", () => {
    const r = marcaSchema.safeParse({
      nome: "AutoCenter",
      corPrimaria: "#0F62FE",
      fonte: "Geist",
      logo: "/logo.svg",
    });
    expect(r.success).toBe(true);
  });

  it("aceita marca sem logo — o logo é opcional", () => {
    const r = marcaSchema.safeParse({
      nome: "AutoCenter",
      corPrimaria: "#0F62FE",
      fonte: "Geist",
    });
    expect(r.success).toBe(true);
  });

  it("recusa hex malformado", () => {
    for (const cor of ["0F62FE", "#FFF", "#GGGGGG", "azul"]) {
      expect(marcaSchema.safeParse({ nome: "X", corPrimaria: cor, fonte: "Geist" }).success)
        .toBe(false);
    }
  });

  it("recusa cinza — croma abaixo do piso", () => {
    const r = marcaSchema.safeParse({
      nome: "X",
      corPrimaria: "#808080",
      fonte: "Geist",
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r)).toMatch(/croma/i);
  });

  it("recusa fonte fora da lista fechada", () => {
    const r = marcaSchema.safeParse({
      nome: "X",
      corPrimaria: "#0F62FE",
      fonte: "Comic Sans",
    });
    expect(r.success).toBe(false);
  });
});

describe("config/client.ts", () => {
  it("é válido segundo o schema", () => {
    expect(() => clientConfigSchema.parse(client)).not.toThrow();
  });

  it("passa pela validação de verdade, não só pelo tipo", async () => {
    // Antes desta task o arquivo só DECLARAVA o tipo e o schema nunca rodava.
    // Se esta importação lançar, o fork está mal configurado — e é para
    // quebrar aqui, no build, e não em produção.
    const { client: clienteImportado } = await import("../../config/client");
    expect(clienteImportado.marca.corPrimaria).toMatch(/^#[0-9a-fA-F]{6}$/);
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
