// Toca o Postgres real, então carrega DATABASE_URL do .env aqui — não em
// vitest.config.ts — para não injetar credenciais em testes que não tocam
// banco. Precisa ser o primeiro import.
import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import { cifrar, PROPOSITO_APIKEY_CONEXAO } from "../../src/core/cofre";
import { hashWebhookToken } from "../../src/core/conexoes/webhook-token";
import { resolverConexaoPorWebhook } from "../../src/core/conexoes/leitura";

/**
 * As duas metades, no formato dos `*-isolamento.test.ts` do Ciclo 1d: a
 * consulta ESCOPADA não atravessa a fronteira, e uma SONDA afirma que a
 * consulta sem escopo atravessaria. Sem a sonda, "não vazou" poderia ser
 * coincidência do dado.
 *
 * E a SEGUNDA metade do isolamento, que é a que costuma faltar: a empresa A
 * ALCANÇA a própria conexão. Sem esse caso, uma implementação que não
 * devolvesse nada a ninguém passaria por isolamento perfeito.
 *
 * Prefixo exclusivo deste arquivo, e a limpeza apaga POR ELE: o banco é o
 * mesmo de desenvolvimento (⚠️ R1 da auditoria do Ciclo 1a), e fixture que não
 * limpa envenena a execução seguinte — já foi medido acontecendo. A limpeza
 * roda em `afterAll`, e não num `finally`: `finally` não roda quando o caso
 * estoura por timeout, e foi assim que 11 usuários e 8 empresas órfãs ficaram
 * neste banco.
 */
const MARCA = "ZZTesteConexao2a";
const TOKEN_A = "a".repeat(64);
const APIKEY_A = "apikey-da-empresa-a-1a2b";

let empresaA: string;
let empresaB: string;

const chaveOriginal = process.env.COFRE_CHAVE_MESTRA;

/**
 * Ordem das FKs: `WhatsappConnection` aponta para `Company`, então some
 * primeiro. Não há `Notification` nem `User` criados aqui — a fixture cria
 * duas empresas e uma conexão, e nada mais.
 */
async function limpar() {
  const empresas = await prisma.company.findMany({
    where: { nome: { startsWith: MARCA } },
    select: { id: true },
  });
  const ids = empresas.map((e) => e.id);
  if (ids.length === 0) return;
  await prisma.whatsappConnection.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.company.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  process.env.COFRE_CHAVE_MESTRA = Buffer.alloc(32, 3).toString("base64");
  await limpar();

  const a = await prisma.company.create({ data: { nome: `${MARCA}-A` } });
  const b = await prisma.company.create({ data: { nome: `${MARCA}-B` } });
  empresaA = a.id;
  empresaB = b.id;

  await prisma.whatsappConnection.create({
    data: {
      companyId: a.id,
      canal: "EVOLUTION",
      nome: "A",
      dominio: "https://evo-a.exemplo.com",
      instancia: `${MARCA}-inst-a`,
      segredoCifrado: cifrar(APIKEY_A, { companyId: a.id, proposito: PROPOSITO_APIKEY_CONEXAO }),
      segredoUltimos4: APIKEY_A.slice(-4),
      segredoAtualizadoEm: new Date(),
      webhookTokenHash: hashWebhookToken(TOKEN_A),
    },
  });
});

afterAll(async () => {
  await limpar();
  if (chaveOriginal === undefined) delete process.env.COFRE_CHAVE_MESTRA;
  else process.env.COFRE_CHAVE_MESTRA = chaveOriginal;
});

describe("resolução do webhook contra Postgres real", () => {
  it("a empresa A resolve o próprio token e recebe a apikey decifrada", async () => {
    const cred = await resolverConexaoPorWebhook(empresaA, TOKEN_A);
    expect(cred?.companyId).toBe(empresaA);
    expect(cred?.apiKey).toBe(APIKEY_A);
  });

  it("o MESMO token na empresa B devolve null — saber o token de A não dá nada em B", async () => {
    expect(await resolverConexaoPorWebhook(empresaB, TOKEN_A)).toBeNull();
  });

  it("SONDA: a mesma busca SEM escopo acharia a linha de A a partir de B", async () => {
    // Sem esta sonda, o caso acima poderia estar verde por não haver linha
    // nenhuma. Ela prova que o dado ESTÁ lá e que é o escopo que o esconde.
    const semEscopo = await prisma.whatsappConnection.findFirst({
      where: { webhookTokenHash: hashWebhookToken(TOKEN_A) },
      select: { companyId: true },
    });
    expect(semEscopo?.companyId).toBe(empresaA);
    expect(semEscopo?.companyId).not.toBe(empresaB);
  });

  it("a coluna gravada no Postgres NÃO contém a apikey em texto", async () => {
    const linha = await prisma.whatsappConnection.findFirst({
      where: { companyId: empresaA },
      select: { segredoCifrado: true },
    });
    expect(linha?.segredoCifrado).not.toContain(APIKEY_A);
    expect(linha?.segredoCifrado).toMatch(/^v1\./);
  });
});
