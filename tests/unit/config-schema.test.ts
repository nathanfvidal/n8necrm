import { describe, it, expect } from "vitest";

import { client } from "../../config/client";
import { CROMA_MINIMO } from "../../src/lib/tema/paleta";
import {
  ConfigDaEmpresaInvalidaError,
  marcaDaEmpresaSchema,
  mesclarConfig,
  padraoDoArquivo,
  type LinhaDeConfig,
} from "../../src/core/config/schema";

/**
 * A forma da configuração por empresa é DERIVADA de `config/client.schema.ts`,
 * não redigitada — e é isso que estes casos travam.
 *
 * Se `marcaDaEmpresaSchema` fosse escrito à mão, o piso de croma, o enum
 * fechado de fontes e o regex de caminho de asset existiriam em duas cópias, e
 * a segunda envelheceria em silêncio. O modo de falha é exatamente o que o
 * comentário de `client.schema.ts` descreve para o croma: "abaixo desse piso as
 * superfícies derivadas ficam indistinguíveis de neutro e o white-label para de
 * funcionar em silêncio". Um schema derivado não tem como divergir.
 *
 * Nada aqui toca banco nem Prisma: `mesclarConfig` é função pura, e é de
 * propósito — a decisão "banco vence arquivo, campo a campo" fica exercitável
 * sem nenhuma infraestrutura.
 */

const EMPRESA = "empresa-teste-1c";

/** Linha "não decidi nada" — todas as sobreposições nulas, módulos vazios. */
function linhaVazia(): LinhaDeConfig {
  return {
    corPrimaria: null,
    fonte: null,
    logoClaro: null,
    logoEscuro: null,
    modulos: [],
  };
}

describe("marcaDaEmpresaSchema", () => {
  it("é o marcaSchema SEM o campo `nome` — o nome da empresa é `Company.nome`", () => {
    const analisado = marcaDaEmpresaSchema.parse({
      nome: "NomeQueDeveSerDescartado",
      corPrimaria: "#6D4AFF",
      fonte: "Geist",
    });

    // Zod descarta chave desconhecida por padrão. O caso afirma o conjunto
    // EXATO de chaves, e não só a ausência de `nome`: uma asserção "não tem
    // nome" passaria mesmo se o schema tivesse ganhado um campo novo por
    // engano.
    expect(Object.keys(analisado).sort()).toEqual(["corPrimaria", "fonte"]);
  });

  it("herda o piso de croma — cinza continua recusado", () => {
    // `#808080` tem croma 0 em OKLCH. O piso é `CROMA_MINIMO`.
    expect(CROMA_MINIMO).toBeGreaterThan(0);
    const r = marcaDaEmpresaSchema.safeParse({ corPrimaria: "#808080", fonte: "Geist" });
    expect(r.success).toBe(false);
  });

  it("herda o enum fechado de fontes", () => {
    const r = marcaDaEmpresaSchema.safeParse({ corPrimaria: "#6D4AFF", fonte: "Comic Sans" });
    expect(r.success).toBe(false);
  });

  it("herda o regex de caminho de asset — `//outro-dominio` continua recusado", () => {
    const r = marcaDaEmpresaSchema.safeParse({
      corPrimaria: "#6D4AFF",
      fonte: "Geist",
      logo: { claro: "//outro-dominio/logo.svg", escuro: "/logo-branco.svg" },
    });
    expect(r.success).toBe(false);
  });
});

describe("padraoDoArquivo", () => {
  it("devolve a marca e os módulos de `config/client.ts`, sem o `nome` da marca", () => {
    const padrao = padraoDoArquivo();
    expect(padrao.marca.corPrimaria).toBe(client.marca.corPrimaria);
    expect(padrao.marca.fonte).toBe(client.marca.fonte);
    expect(padrao.modulos).toEqual([...client.modulos]);
    expect(Object.keys(padrao.marca)).not.toContain("nome");

    // A segunda metade do contrato do ciclo: sem sobreposição nenhuma, a saída
    // é EXATAMENTE `client.marca` menos o `nome` — nem uma chave a mais, nem
    // uma a menos. Objeto inteiro e não campo a campo: campo a campo passaria
    // mesmo se o schema derivado tivesse ganhado ou perdido uma chave. A
    // filtragem é por chave e não uma lista literal para que acrescentar um
    // `logo` a `config/client.ts` não reprove este caso sem defeito nenhum.
    expect(padrao.marca).toEqual(
      Object.fromEntries(Object.entries(client.marca).filter(([chave]) => chave !== "nome")),
    );
  });

  it("não devolve a MESMA referência de `client.modulos` — mutar a saída não muda o arquivo", () => {
    // O padrão é lido em toda requisição do painel. Se ele devolvesse a
    // referência do módulo, um chamador que fizesse `padrao.modulos.push(...)`
    // envenenaria o config do processo inteiro, e o sintoma apareceria numa
    // requisição depois.
    expect(padraoDoArquivo().modulos).not.toBe(client.modulos);
  });
});

describe("mesclarConfig — o banco sobrepõe o arquivo, campo a campo", () => {
  it("SEM linha, devolve exatamente o padrão do arquivo", () => {
    const config = mesclarConfig(EMPRESA, "Empresa Um", null);
    expect(config).toEqual({
      nome: "Empresa Um",
      marca: padraoDoArquivo().marca,
      modulos: padraoDoArquivo().modulos,
    });
  });

  it("campo nulo cai no padrão; campo preenchido vence", () => {
    const config = mesclarConfig(EMPRESA, "Empresa Um", {
      ...linhaVazia(),
      corPrimaria: "#0F62FE",
      modulos: ["whatsapp"],
    });

    expect(config.marca.corPrimaria).toBe("#0F62FE");
    // `fonte` ficou nula na linha: continua vindo do arquivo.
    expect(config.marca.fonte).toBe(client.marca.fonte);
  });

  it("a fonte do banco vence a do arquivo", () => {
    const config = mesclarConfig(EMPRESA, "Empresa Um", { ...linhaVazia(), fonte: "Manrope" });
    expect(config.marca.fonte).toBe("Manrope");
  });

  it("os dois logos preenchidos viram o par; nenhum preenchido cai no padrão", () => {
    const comLogo = mesclarConfig(EMPRESA, "Empresa Um", {
      ...linhaVazia(),
      logoClaro: "/logo-preto.svg",
      logoEscuro: "/logo-branco.svg",
    });
    expect(comLogo.marca.logo).toEqual({ claro: "/logo-preto.svg", escuro: "/logo-branco.svg" });

    const semLogo = mesclarConfig(EMPRESA, "Empresa Um", linhaVazia());
    expect(semLogo.marca.logo).toBe(padraoDoArquivo().marca.logo);
  });

  it("linha com `modulos: []` desliga TODOS os módulos e NÃO cai no padrão do arquivo", () => {
    // Esta é a assimetria declarada em 4.2 do spec, e é o caso que a exercita.
    // `String[]` no Prisma nunca é nulo, então não existe "não decidi" dentro
    // da linha: se a linha existe, `modulos` dela manda. Sem este caso, a
    // frase "inclusive quando está vazia" seria prosa.
    expect(padraoDoArquivo().modulos.length).toBeGreaterThan(0);
    expect(mesclarConfig(EMPRESA, "Empresa Um", linhaVazia()).modulos).toEqual([]);
  });

  it("`modulos` do banco vence a lista do arquivo", () => {
    const config = mesclarConfig(EMPRESA, "Empresa Um", { ...linhaVazia(), modulos: ["whatsapp"] });
    expect(config.modulos).toEqual(["whatsapp"]);
  });
});

describe("mesclarConfig — linha inválida RECUSA, não degrada", () => {
  // A escolha é a mesma que `CROMA_MINIMO` encarna: white-label quebrado em
  // SILÊNCIO é o defeito; painel que quebra alto é o diagnóstico. Toda mensagem
  // carrega o companyId, mesmo padrão de `EscopoDeEmpresaError`.
  const casos: [string, Partial<LinhaDeConfig>][] = [
    ["cor de croma abaixo do piso (cinza)", { corPrimaria: "#808080" }],
    ["cor malformada", { corPrimaria: "roxo" }],
    ["fonte fora do enum", { fonte: "Comic Sans" }],
    ["módulo desconhecido", { modulos: ["modulo-que-nao-existe"] }],
    ["logo só claro", { logoClaro: "/logo-preto.svg" }],
    ["logo só escuro", { logoEscuro: "/logo-branco.svg" }],
    ["caminho de logo que sai do domínio", { logoClaro: "//fora/a.svg", logoEscuro: "/b.svg" }],
  ];

  for (const [rotulo, sobreposicao] of casos) {
    it(`recusa: ${rotulo}`, () => {
      const chamada = () => mesclarConfig(EMPRESA, "Empresa Um", { ...linhaVazia(), ...sobreposicao });
      expect(chamada).toThrow(ConfigDaEmpresaInvalidaError);
      expect(chamada).toThrow(EMPRESA);
    });
  }

  it("nome de empresa vazio é recusado — `Company.nome` é o que a barra mostra", () => {
    expect(() => mesclarConfig(EMPRESA, "", null)).toThrow(ConfigDaEmpresaInvalidaError);
  });
});
