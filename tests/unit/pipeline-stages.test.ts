// Este arquivo (junto com seed.test.ts, rate-limit.test.ts e
// audit-log.test.ts) usa o Prisma real contra o Postgres do Supabase, então
// carrega DATABASE_URL do .env aqui — não em vitest.config.ts — para não
// injetar credenciais em testes que não tocam banco. Precisa ser o primeiro
// import: os módulos abaixo (via src/lib/prisma.ts → src/lib/env.ts) leem
// process.env.DATABASE_URL no top-level.
import "dotenv/config";

import { describe, it, expect, beforeAll, vi } from "vitest";

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server" que o Next.js aplica no build — fora desse pipeline (aqui,
// sob Vitest) ele sempre lança, independente de quem importa (ver
// tests/unit/storage.test.ts, onde este mock foi documentado pela primeira
// vez). `src/lib/prisma.ts` ganhou `import "server-only"` na Task 17 (fix
// round 2/5), e `seed()`/`listarEtapas` importam `prisma` — sem mockar
// aqui, TODO teste deste arquivo quebraria na importação, não por causa da
// lógica testada.
vi.mock("server-only", () => ({}));

import { listarEtapas, contarLeadsQueSeguramEtapa } from "../../src/core/pipeline/stages";
import { seed } from "../../prisma/seed";
import { prisma } from "../../src/lib/prisma";

describe("listarEtapas", () => {
  beforeAll(async () => {
    // Garante que as etapas do funil existem, sem depender de o seed já ter
    // rodado manualmente antes da suíte — `seed()` é idempotente.
    await seed();
  });

  it("devolve TODAS as linhas de PipelineStage, na ordem de `ordem`", async () => {
    const etapas = await listarEtapas();
    const direto = await prisma.pipelineStage.findMany({ orderBy: { ordem: "asc" } });

    // Comparação com o banco, e não com `client.funil`: desde o CRUD de etapas
    // o funil pode ter qualquer tamanho, qualquer nome e `ordem` com buracos
    // (apagar a etapa de ordem 2 deixa 0,1,3,4 — e isso é correto, ver § 5 da
    // spec). A asserção antiga exigia `ordem` DENSA, o contrário direto disso.
    expect(etapas.map((e) => e.id)).toEqual(direto.map((e) => e.id));
    expect(etapas.length).toBeGreaterThanOrEqual(1);
  });

  it("a ordem é por `ordem`, não incidental: chamadas repetidas devolvem exatamente a mesma sequência de ids", async () => {
    const primeiraChamada = await listarEtapas();
    const segundaChamada = await listarEtapas();

    expect(segundaChamada.map((e) => e.id)).toEqual(primeiraChamada.map((e) => e.id));

    for (let i = 1; i < primeiraChamada.length; i++) {
      expect(primeiraChamada[i].ordem).toBeGreaterThan(primeiraChamada[i - 1].ordem);
    }
  });

  it("a primeira etapa devolvida é a de menor `ordem` (Task 13 cria todo Lead novo nela)", async () => {
    const etapas = await listarEtapas();
    const menorOrdem = Math.min(...etapas.map((e) => e.ordem));

    expect(etapas[0].ordem).toBe(menorOrdem);
  });
});

describe("contarLeadsQueSeguramEtapa", () => {
  it("conta arquivados junto — é o número que a chave estrangeira enxerga", async () => {
    // Empresa única do Ciclo 1a (mesma suposição de `prisma/seed.ts`, já
    // rodado no `beforeAll` de `describe("listarEtapas")` acima).
    const empresa = await prisma.company.findFirstOrThrow();
    const etapa = await prisma.pipelineStage.create({
      data: { companyId: empresa.id, nome: `Etapa Teste Contagem ${Date.now()}`, ordem: 9001, cor: "#123456" },
    });
    const contato = await prisma.contact.create({
      data: { companyId: empresa.id, nome: "Contato Teste Contagem", telefone: `5511${Date.now()}`.slice(0, 13) },
    });
    const lead = await prisma.lead.create({
      data: {
        companyId: empresa.id,
        contactId: contato.id,
        stageId: etapa.id,
        canal: "MANUAL",
        arquivadoEm: new Date(),
      },
    });

    try {
      const { contarLeadsPorEtapa } = await import("../../src/core/leads/queries");
      const ativos = await contarLeadsPorEtapa();
      const seguram = await contarLeadsQueSeguramEtapa();

      // A distinção inteira em duas linhas: o funil não vê o arquivado, a FK vê.
      expect(ativos[etapa.id] ?? 0).toBe(0);
      expect(seguram[etapa.id]).toBe(1);
    } finally {
      await prisma.lead.delete({ where: { id: lead.id } });
      await prisma.contact.delete({ where: { id: contato.id } });
      await prisma.pipelineStage.delete({ where: { id: etapa.id } });
    }
  });
});
