// Toca o Postgres real, então carrega DATABASE_URL do .env aqui — não em
// vitest.config.ts — para não injetar credenciais em testes que não tocam
// banco. Precisa ser o primeiro import.
import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import { configDaEmpresa } from "../../src/core/config/leitura";
import { padraoDoArquivo } from "../../src/core/config/schema";

/**
 * As duas metades, no formato dos `*-isolamento.test.ts` do Ciclo 1d: a
 * consulta ESCOPADA não atravessa a fronteira, e uma SONDA afirma que a
 * consulta sem escopo atravessaria. Sem a sonda, "não vazou" poderia ser
 * coincidência do dado.
 *
 * Prefixo exclusivo deste arquivo, e a limpeza apaga POR ELE: o banco é o mesmo
 * de desenvolvimento (⚠️ R1 da auditoria do Ciclo 1a), e fixture que não limpa
 * envenena a execução seguinte — foi medido acontecendo.
 */
const MARCA = "ZZTesteConfig1c";

let empresaA: string;
let empresaB: string;

async function limpar() {
  const empresas = await prisma.company.findMany({
    where: { nome: { startsWith: MARCA } },
    select: { id: true },
  });
  const ids = empresas.map((e) => e.id);
  if (ids.length === 0) return;
  await prisma.companyConfig.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.company.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  await limpar();

  const a = await prisma.company.create({ data: { nome: `${MARCA}-A` } });
  const b = await prisma.company.create({ data: { nome: `${MARCA}-B` } });
  empresaA = a.id;
  empresaB = b.id;

  await prisma.companyConfig.create({
    data: { companyId: empresaA, corPrimaria: "#0F62FE", fonte: "Inter", modulos: ["whatsapp"] },
  });
  await prisma.companyConfig.create({
    data: { companyId: empresaB, corPrimaria: "#E11D48", fonte: "Manrope", modulos: [] },
  });
});

afterAll(async () => {
  await limpar();
});

describe("configDaEmpresa contra Postgres real", () => {
  it("a empresa A recebe a config DELA", async () => {
    const config = await configDaEmpresa(empresaA);
    expect(config.nome).toBe(`${MARCA}-A`);
    expect(config.marca.corPrimaria).toBe("#0F62FE");
    expect(config.marca.fonte).toBe("Inter");
    expect(config.modulos).toEqual(["whatsapp"]);
  });

  it("a empresa B recebe a config DELA — e nunca a da A", async () => {
    const config = await configDaEmpresa(empresaB);
    expect(config.nome).toBe(`${MARCA}-B`);
    expect(config.marca.corPrimaria).toBe("#E11D48");
    expect(config.marca.fonte).toBe("Manrope");
    expect(config.modulos).toEqual([]);
  });

  it("SONDA: a consulta sem escopo alcança as duas empresas — é isso que o escopo evita", async () => {
    // Sem esta sonda, os dois casos acima poderiam estar verdes por o banco não
    // ter dado suficiente para vazar. Ela prova que o dado da OUTRA empresa
    // está lá, alcançável, e que o caminho escopado não o alcança.
    const todas = await prisma.companyConfig.findMany({
      where: { companyId: { in: [empresaA, empresaB] } },
      select: { companyId: true, corPrimaria: true },
    });
    expect(todas).toHaveLength(2);
  });

  it("empresa SEM linha cai no padrão do arquivo, contra o banco real", async () => {
    const semConfig = await prisma.company.create({ data: { nome: `${MARCA}-C` } });
    const config = await configDaEmpresa(semConfig.id);

    expect(config.nome).toBe(`${MARCA}-C`);
    expect(config.marca).toEqual(padraoDoArquivo().marca);
    expect(config.modulos).toEqual(padraoDoArquivo().modulos);
  });
});
