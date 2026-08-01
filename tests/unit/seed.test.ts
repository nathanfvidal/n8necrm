// Este arquivo (junto com pipeline-stages.test.ts, rate-limit.test.ts e
// audit-log.test.ts) usa o Prisma real contra o Postgres do Supabase, então
// carrega DATABASE_URL do .env aqui — não em vitest.config.ts — para não
// injetar credenciais em testes que não tocam banco. Precisa ser o primeiro
// import: os módulos abaixo (via src/lib/prisma.ts → src/lib/env.ts) leem
// process.env.DATABASE_URL no top-level.
import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server" que o Next.js aplica no build — fora desse pipeline (aqui,
// sob Vitest) ele sempre lança, independente de quem importa (ver
// tests/unit/storage.test.ts, onde este mock foi documentado pela primeira
// vez). `src/lib/prisma.ts` ganhou `import "server-only"` na Task 17 (fix
// round 2/5), e `seed()`/este arquivo importam `prisma` — sem mockar aqui,
// TODO teste deste arquivo quebraria na importação, não por causa da lógica
// testada.
vi.mock("server-only", () => ({}));

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

  describe(
    "encolhimento do funil deixa uma etapa órfã (fix round 1/5 — reprodução do achado do revisor: " +
      "seedar o funil atual, remover uma etapa de client.funil e re-seedar deixava a etapa removida " +
      "com ehGanho: true para sempre, então findMany({ where: { ehGanho: true } }) passava a devolver " +
      "2 linhas e listarEtapas() continuava incluindo a órfã, sem nenhum erro em lugar nenhum)",
    () => {
      // ordem além do funil atual — simula a etapa que "sobrou" de uma
      // execução anterior com um client.funil maior (ex.: config tinha 6
      // etapas, alguém removeu uma, e o seed nunca mais toca em ordem: 5).
      const ORDEM_ORFA = 5;

      it(
        "remove uma etapa órfã sem leads e o banco fica com exatamente 1 PipelineStage ehGanho, igual a " +
          "client.funil[length - 1]",
        async () => {
          await seed();

          const orfa = await prisma.pipelineStage.create({
            data: {
              nome: "Etapa Órfã Teste (sem lead)",
              ordem: ORDEM_ORFA,
              cor: "#000000",
              ehGanho: true,
              ehPerdido: false,
            },
          });

          await seed();

          const orfaAposSeed = await prisma.pipelineStage.findUnique({ where: { id: orfa.id } });
          expect(orfaAposSeed).toBeNull();

          const etapasGanhas = await prisma.pipelineStage.findMany({ where: { ehGanho: true } });
          expect(etapasGanhas).toHaveLength(1);
          expect(etapasGanhas[0]?.ordem).toBe(client.funil.length - 1);
          expect(etapasGanhas[0]?.nome).toBe(client.funil[client.funil.length - 1]);
        },
        20_000
      );

      it(
        "recusa apagar uma etapa órfã que ainda tem lead — falha com uma mensagem acionável, em vez de " +
          "estourar a violação de FK crua do Postgres ou apagar/mover o lead em silêncio",
        async () => {
          await seed();

          const orfa = await prisma.pipelineStage.create({
            data: {
              nome: "Etapa Órfã Teste (com lead)",
              ordem: ORDEM_ORFA,
              cor: "#000000",
              ehGanho: true,
              ehPerdido: false,
            },
          });
          const contato = await prisma.contact.create({
            data: { nome: "Contato Teste Órfã", telefone: "119999912345" },
          });
          const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@exemplo.com" } });
          const lead = await prisma.lead.create({
            data: { contactId: contato.id, stageId: orfa.id, responsavelId: admin.id, canal: "MANUAL" },
          });

          await expect(seed()).rejects.toThrow(/Etapa Órfã Teste \(com lead\)/);

          // a etapa órfã e o lead continuam intactos — o seed abortou antes
          // de tocar neles.
          const orfaAindaExiste = await prisma.pipelineStage.findUnique({ where: { id: orfa.id } });
          expect(orfaAindaExiste).not.toBeNull();

          // limpeza (ordem importa: Lead → Contact → PipelineStage, por
          // causa das FKs) e restauração do estado normal de 5 etapas.
          await prisma.lead.delete({ where: { id: lead.id } });
          await prisma.contact.delete({ where: { id: contato.id } });
          await prisma.pipelineStage.delete({ where: { id: orfa.id } });

          await expect(seed()).resolves.toBeUndefined();
          const etapasGanhas = await prisma.pipelineStage.count({ where: { ehGanho: true } });
          expect(etapasGanhas).toBe(1);
        },
        20_000
      );
    }
  );

  describe(
    "SEED_PASSWORD rotaciona a senha existente (fix round 1/5 — reprodução do achado do revisor: " +
      "definir SEED_PASSWORD depois do primeiro seed não tinha efeito nenhum, porque update: {} nunca " +
      "regravava senhaHash — admin@exemplo.com/senha123 continuava válido pra sempre, dando falsa " +
      "confiança de que a senha tinha sido trocada)",
    () => {
      const SENHA_ORIGINAL = "senha123";
      const SENHA_NOVA = "outraSenhaDeTeste789";

      afterAll(async () => {
        // Restaura a senha original explicitamente — sem isso, o resto da
        // suíte (e a Task 22, que faz login e2e com admin@exemplo.com /
        // senha123) ficaria com a senha rotacionada por este teste.
        process.env.SEED_PASSWORD = SENHA_ORIGINAL;
        await seed();
        delete process.env.SEED_PASSWORD;
      });

      it(
        "sem SEED_PASSWORD definida, reexecutar o seed não altera um senhaHash já existente",
        async () => {
          await seed();
          const antes = await prisma.user.findUniqueOrThrow({ where: { email: "admin@exemplo.com" } });

          await seed();
          const depois = await prisma.user.findUniqueOrThrow({ where: { email: "admin@exemplo.com" } });

          expect(depois.senhaHash).toBe(antes.senhaHash);
        },
        // duas chamadas a seed() (cada uma faz bcrypt.hash + ~20 round-trips
        // contra o Postgres real) não cabem no timeout padrão de 5000ms.
        20_000
      );

      it(
        "com SEED_PASSWORD definida, reexecutar o seed troca o hash e invalida a senha antiga para admin e vendedor",
        async () => {
          await seed();
          const adminAntes = await prisma.user.findUniqueOrThrow({ where: { email: "admin@exemplo.com" } });
          expect(await bcrypt.compare(SENHA_ORIGINAL, adminAntes.senhaHash)).toBe(true);

          process.env.SEED_PASSWORD = SENHA_NOVA;
          await seed();
          delete process.env.SEED_PASSWORD;

          const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@exemplo.com" } });
          const vendedor = await prisma.user.findUniqueOrThrow({ where: { email: "vendedor@exemplo.com" } });

          expect(await bcrypt.compare(SENHA_ORIGINAL, admin.senhaHash)).toBe(false);
          expect(await bcrypt.compare(SENHA_NOVA, admin.senhaHash)).toBe(true);
          expect(await bcrypt.compare(SENHA_ORIGINAL, vendedor.senhaHash)).toBe(false);
          expect(await bcrypt.compare(SENHA_NOVA, vendedor.senhaHash)).toBe(true);
        },
        // três chamadas a seed() nesta única prova (baseline + rotação) —
        // mesmo motivo do timeout acima.
        20_000
      );
    }
  );
});
