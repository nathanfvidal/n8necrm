import { describe, it, expect } from "vitest";
import { clientConfigSchema, marcaSchema } from "../../config/client.schema";
import { client } from "../../config/client";

describe("marcaSchema", () => {
  it("aceita uma marca completa", () => {
    const r = marcaSchema.safeParse({
      nome: "AutoCenter",
      corPrimaria: "#0F62FE",
      fonte: "Geist",
      logo: { claro: "/logo-preto.svg", escuro: "/logo-branco.svg" },
    });
    expect(r.success).toBe(true);
  });

  it("exige as duas artes do logo, não uma", () => {
    // Um arquivo só cobriria metade dos temas. O schema não deixa escolher
    // metade: ou vem o par, ou não vem logo nenhum.
    for (const logo of [{ claro: "/a.svg" }, { escuro: "/b.svg" }, "/a.svg"]) {
      expect(marcaSchema.safeParse({
        nome: "X", corPrimaria: "#0F62FE", fonte: "Geist", logo,
      }).success).toBe(false);
    }
  });

  it("recusa caminho de logo que sai do domínio ou tem espaço", () => {
    // `startsWith("/")` sozinho aceitaria os dois primeiros: `//host/x` é URL
    // protocolo-relativa e busca fora do domínio. O terceiro vira `%20` na
    // URL. O CSP barraria a carga externa, mas a validação não deve depender
    // de outra camada para dizer a verdade.
    for (const ruim of ["//evil.example/x.svg", "/\\evil.example/x.svg", "/Logo Insta.svg"]) {
      const r = marcaSchema.safeParse({
        nome: "X",
        corPrimaria: "#0F62FE",
        fonte: "Geist",
        logo: { claro: ruim, escuro: "/ok.svg" },
      });
      expect(r.success, `deveria recusar ${ruim}`).toBe(false);
    }
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
  // Havia aqui um `expect(() => clientConfigSchema.parse(client)).not.toThrow()`.
  // Ele NÃO PODIA falhar: `client` já é a SAÍDA de `clientConfigSchema.parse`
  // (config/client.ts), e reparsear uma saída válida sempre passa. Dava a
  // impressão de cobrir a validação sem cobrir nada.
  //
  // O que de fato protege é o teste abaixo — a importação do módulo, que
  // lança no build se o config for inválido — e este, que prova que os
  // arquivos apontados pelo config EXISTEM em disco. Schema válido com
  // caminho quebrado passaria pelo Zod e daria imagem quebrada na tela: o
  // Zod valida o formato do caminho, não a existência do arquivo.
  it("os arquivos de logo apontados pelo config existem em disco", async () => {
    const { logo } = client.marca;
    if (!logo) return; // fork sem logo é caminho normal — ver marcaSchema

    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const caminho of [logo.claro, logo.escuro]) {
      const emDisco = join(process.cwd(), "public", caminho);
      expect(existsSync(emDisco), `nao existe: public${caminho}`).toBe(true);
    }
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
