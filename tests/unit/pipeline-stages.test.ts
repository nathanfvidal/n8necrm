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

import { listarEtapas } from "../../src/core/pipeline/stages";
import { seed } from "../../prisma/seed";
import { client } from "../../config/client";

describe("listarEtapas", () => {
  beforeAll(async () => {
    // Garante que as etapas do funil existem, sem depender de o seed já ter
    // rodado manualmente antes da suíte — `seed()` é idempotente.
    await seed();
  });

  it("retorna as etapas na ordem de `ordem` (crescente), refletindo client.funil (Task 15 renderiza as colunas do kanban nessa ordem)", async () => {
    const etapas = await listarEtapas();

    expect(etapas).toHaveLength(client.funil.length);
    expect(etapas.map((e) => e.nome)).toEqual(client.funil);
    expect(etapas.map((e) => e.ordem)).toEqual(client.funil.map((_, indice) => indice));
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
