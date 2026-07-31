// Este arquivo (junto com pipeline-stages.test.ts, rate-limit.test.ts e
// audit-log.test.ts) usa o Prisma real contra o Postgres do Supabase, então
// carrega DATABASE_URL do .env aqui — não em vitest.config.ts — para não
// injetar credenciais em testes que não tocam banco. Precisa ser o primeiro
// import: os módulos abaixo (via src/lib/prisma.ts → src/lib/env.ts) leem
// process.env.DATABASE_URL no top-level.
import "dotenv/config";

import { describe, it, expect, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../../src/lib/prisma";
import { seed } from "../../prisma/seed";
import { client } from "../../config/client";

const EMAILS_SEED = ["admin@exemplo.com", "vendedor@exemplo.com"];
const TELEFONE_PREFIXO_SEED = "1199999000";

async function contarLinhasDoSeed() {
  return {
    stages: await prisma.pipelineStage.count(),
    users: await prisma.user.count({ where: { email: { in: EMAILS_SEED } } }),
    contacts: await prisma.contact.count({ where: { telefone: { startsWith: TELEFONE_PREFIXO_SEED } } }),
    leads: await prisma.lead.count({ where: { contact: { telefone: { startsWith: TELEFONE_PREFIXO_SEED } } } }),
  };
}

describe("prisma/seed.ts", () => {
  it(
    "é idempotente: rodar duas vezes seguidas não duplica PipelineStage, User, Contact nem Lead, e não lança " +
      "(Lead.stageId é ON DELETE RESTRICT — um deleteMany() ingênuo em PipelineStage quebraria na 2ª execução)",
    async () => {
      await seed();
      const contagemAposPrimeiraExecucao = await contarLinhasDoSeed();

      await expect(seed()).resolves.toBeUndefined();
      const contagemAposSegundaExecucao = await contarLinhasDoSeed();

      expect(contagemAposSegundaExecucao).toEqual(contagemAposPrimeiraExecucao);
      expect(contagemAposSegundaExecucao).toEqual({
        stages: client.funil.length,
        users: 2,
        contacts: 4,
        leads: 4,
      });
    },
    // seed() faz ~20 round-trips sequenciais contra o Postgres real do
    // Supabase, e este teste chama seed() duas vezes — o timeout padrão do
    // Vitest (5000ms) não sobra folga pra latência de rede.
    20_000
  );

  describe("contrato ehGanho (Task 20 calcula a taxa de conversão a partir exatamente dessa flag)", () => {
    beforeAll(seed);

    it("marca exatamente a última etapa do funil como ehGanho — e nenhuma outra", async () => {
      const etapas = await prisma.pipelineStage.findMany({ orderBy: { ordem: "asc" } });
      const marcadasComoGanho = etapas.filter((etapa) => etapa.ehGanho);

      expect(marcadasComoGanho).toHaveLength(1);
      expect(marcadasComoGanho[0]?.ordem).toBe(client.funil.length - 1);
      expect(marcadasComoGanho[0]?.nome).toBe(client.funil[client.funil.length - 1]);
    });

    it("nenhuma etapa é marcada como ehPerdido pelo seed", async () => {
      const etapas = await prisma.pipelineStage.findMany();
      expect(etapas.every((etapa) => etapa.ehPerdido === false)).toBe(true);
    });
  });

  describe("senha semeada (Task 22 faz login end-to-end com essas credenciais)", () => {
    beforeAll(seed);

    it.each(EMAILS_SEED)("o hash gravado para %s verifica com a senha em texto plano 'senha123'", async (email) => {
      const usuario = await prisma.user.findUniqueOrThrow({ where: { email } });
      const senhaValida = await bcrypt.compare("senha123", usuario.senhaHash);
      expect(senhaValida).toBe(true);
    });

    it("o hash gravado não é a senha em texto plano nem um valor vazio", async () => {
      const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@exemplo.com" } });
      expect(admin.senhaHash).not.toBe("senha123");
      expect(admin.senhaHash.length).toBeGreaterThan(0);
    });
  });
});
