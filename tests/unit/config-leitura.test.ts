import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { prismaFalsoEscopavel } from "./helpers/prisma-falso-escopavel";
import { semComentarios } from "./helpers/codigo-fonte";

vi.mock("server-only", () => ({}));

const { companyFindUniqueOrThrowMock } = vi.hoisted(() => ({
  companyFindUniqueOrThrowMock: vi.fn(),
}));

// O `$extends` de VERDADE (ver `tests/unit/helpers/prisma-falso-escopavel.ts`):
// `leitura.ts` alcança o banco por `prismaDaEmpresa(companyId)`, e um mock sem
// `$extends` quebra com `TypeError`. Um `$extends: () => cru` seria pior: faria
// o escopo virar no-op silencioso e as asserções abaixo passariam mesmo se a
// leitura tivesse perdido o escopo inteiro.
vi.mock("@/lib/prisma", () => ({
  prisma: prismaFalsoEscopavel({
    company: { findUniqueOrThrow: companyFindUniqueOrThrowMock },
  }),
}));

const { configDaEmpresa } = await import("../../src/core/config/leitura");
const { padraoDoArquivo, ConfigDaEmpresaInvalidaError } = await import(
  "../../src/core/config/schema"
);

const EMPRESA_A = "cmp_a";
const EMPRESA_B = "cmp_b";

beforeEach(() => {
  companyFindUniqueOrThrowMock.mockReset();
});

describe("configDaEmpresa — a consulta", () => {
  it("lê `Company` PELO ID que recebeu, e carrega a config junto numa consulta só", async () => {
    companyFindUniqueOrThrowMock.mockResolvedValue({ nome: "Empresa A", config: null });

    await configDaEmpresa(EMPRESA_A);

    expect(companyFindUniqueOrThrowMock).toHaveBeenCalledTimes(1);
    const args = companyFindUniqueOrThrowMock.mock.calls[0][0];

    // PELO ID, e não `findFirst()`: `prisma.company.findFirst()` como origem de
    // empresa é proibido no programa inteiro — ele devolve "alguma" empresa.
    // Aqui o id VEIO da sessão; isto é lookup, não origem.
    expect(args.where).toEqual({ id: EMPRESA_A });

    // Uma consulta só. Buscar a config à parte seria uma segunda ida ao banco
    // em TODA navegação do painel, e a relação `CompanyConfig -> Company` fica
    // DENTRO do tenant (ver a regra "relação que fica dentro de `Company` é
    // segura" no topo de core/tenancy/escopo.ts).
    expect(Object.keys(args.select).sort()).toEqual(["config", "nome"]);
    expect(Object.keys(args.select.config.select).sort()).toEqual([
      "corPrimaria",
      "fonte",
      "logoClaro",
      "logoEscuro",
      "modulos",
    ]);
  });

  it("`Company` passa INTACTA pelo escopo — nenhum `companyId` é injetado nela", async () => {
    companyFindUniqueOrThrowMock.mockResolvedValue({ nome: "Empresa A", config: null });

    await configDaEmpresa(EMPRESA_A);

    // `Company` está FORA de MODELOS_DE_TENANT: `escoparArgumentos` devolve os
    // argumentos sem tocar. Injetar `where.companyId` aqui quebraria a consulta
    // com erro de coluna inexistente. O caso existe porque a Task 1 mexeu
    // naquele Set, e mexer nele errado é como este caminho quebra.
    const args = companyFindUniqueOrThrowMock.mock.calls[0][0];
    expect(args.where).not.toHaveProperty("companyId");
  });
});

describe("configDaEmpresa — a mescla chega inteira", () => {
  it("sem linha, devolve o padrão do arquivo", async () => {
    companyFindUniqueOrThrowMock.mockResolvedValue({ nome: "Empresa A", config: null });

    await expect(configDaEmpresa(EMPRESA_A)).resolves.toEqual({
      nome: "Empresa A",
      marca: padraoDoArquivo().marca,
      modulos: padraoDoArquivo().modulos,
    });
  });

  it("com linha, o banco vence campo a campo", async () => {
    companyFindUniqueOrThrowMock.mockResolvedValue({
      nome: "Empresa A",
      config: {
        corPrimaria: "#0F62FE",
        fonte: null,
        logoClaro: null,
        logoEscuro: null,
        modulos: ["whatsapp"],
      },
    });

    const config = await configDaEmpresa(EMPRESA_A);
    expect(config.marca.corPrimaria).toBe("#0F62FE");
    expect(config.marca.fonte).toBe(padraoDoArquivo().marca.fonte);
    expect(config.modulos).toEqual(["whatsapp"]);
  });

  it("linha inválida RECUSA, com o companyId na mensagem", async () => {
    companyFindUniqueOrThrowMock.mockResolvedValue({
      nome: "Empresa A",
      config: {
        corPrimaria: "#808080",
        fonte: null,
        logoClaro: null,
        logoEscuro: null,
        modulos: [],
      },
    });

    await expect(configDaEmpresa(EMPRESA_A)).rejects.toThrow(ConfigDaEmpresaInvalidaError);
    await expect(configDaEmpresa(EMPRESA_A)).rejects.toThrow(EMPRESA_A);
  });
});

describe("configDaEmpresa — a corretude NÃO depende do cache", () => {
  it("duas chamadas fora de requisição fazem DUAS consultas e devolvem o mesmo resultado", async () => {
    // `cache()` do React memoiza dentro de UM render de requisição e nada além
    // disso. Fora de contexto de requisição — job de fila, seed, Vitest — ele
    // não memoiza: a função consulta de novo. `src/core/auth/session.ts` já
    // depende exatamente disso, e o comentário dele registra
    // `tests/unit/session.test.ts` como o canário.
    //
    // Este caso é a versão executável de "degrada em custo, nunca em resposta":
    // é o que separa memoização com chave no ARGUMENTO de estado global, que o
    // plano do programa proíbe.
    companyFindUniqueOrThrowMock.mockResolvedValue({ nome: "Empresa A", config: null });

    const primeira = await configDaEmpresa(EMPRESA_A);
    const segunda = await configDaEmpresa(EMPRESA_A);

    expect(companyFindUniqueOrThrowMock).toHaveBeenCalledTimes(2);
    expect(segunda).toEqual(primeira);
  });

  it("empresas diferentes recebem respostas diferentes na mesma execução", async () => {
    companyFindUniqueOrThrowMock
      .mockResolvedValueOnce({
        nome: "Empresa A",
        config: { corPrimaria: null, fonte: null, logoClaro: null, logoEscuro: null, modulos: ["whatsapp"] },
      })
      .mockResolvedValueOnce({
        nome: "Empresa B",
        config: { corPrimaria: null, fonte: null, logoClaro: null, logoEscuro: null, modulos: [] },
      });

    expect((await configDaEmpresa(EMPRESA_A)).modulos).toEqual(["whatsapp"]);
    expect((await configDaEmpresa(EMPRESA_B)).modulos).toEqual([]);
  });
});

describe("configDaEmpresa — nenhum estado de módulo", () => {
  it("`leitura.ts` não tem binding mutável nem coleção em escopo de módulo", () => {
    // A versão executável de "sem estado global". Sem este caso, a frase é
    // prosa: um `const cachePorEmpresa = new Map()` no topo do arquivo passaria
    // por todos os outros casos deste arquivo, porque eles não repetem
    // `companyId` numa mesma execução com resultados diferentes... e depois
    // serviria a marca da empresa A para a B, entre requisições, num processo
    // de longa duração.
    //
    // `semComentarios` é obrigatório: este projeto documenta a própria regra em
    // comentário longo, e a prosa cita o padrão proibido literalmente.
    const caminho = fileURLToPath(new URL("../../src/core/config/leitura.ts", import.meta.url));
    const codigo = semComentarios(readFileSync(caminho, "utf8"));

    const linhasDeModulo = codigo
      .split("\n")
      .filter((l) => l.length > 0 && !/^\s/.test(l));

    const proibidos = linhasDeModulo.filter((l) =>
      /^\s*(let|var)\s|new Map\(|new Set\(|new WeakMap\(|globalThis/.test(l)
    );

    expect(proibidos).toEqual([]);
  });
});
