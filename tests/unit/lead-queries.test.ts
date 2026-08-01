// Este arquivo (junto com pipeline-stages.test.ts, seed.test.ts,
// rate-limit.test.ts e audit-log.test.ts) usa o Prisma real contra o
// Postgres do Supabase, então carrega DATABASE_URL do .env aqui — não em
// vitest.config.ts — para não injetar credenciais em testes que não tocam
// banco. Precisa ser o primeiro import: os módulos abaixo (via
// src/lib/prisma.ts → src/lib/env.ts) leem process.env.DATABASE_URL no
// top-level.
import "dotenv/config";

import { describe, it, expect, beforeAll, vi } from "vitest";

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server" que o Next.js aplica no build — fora desse pipeline (aqui,
// sob Vitest) ele sempre lança, independente de quem importa (ver
// tests/unit/storage.test.ts, onde este mock foi documentado pela primeira
// vez). `src/lib/prisma.ts` ganhou `import "server-only"` na Task 17 (fix
// round 2/5), e `queries.ts`/este arquivo importam `prisma` — sem mockar
// aqui, TODO teste deste arquivo quebraria na importação, não por causa da
// lógica testada.
vi.mock("server-only", () => ({}));

import { listarLeads } from "../../src/core/leads/queries";
import { prisma } from "../../src/lib/prisma";
import { seed } from "../../prisma/seed";

describe("listarLeads", () => {
  beforeAll(async () => {
    // Garante o seed (4 leads: 2 do admin, 2 do vendedor — ver
    // prisma/seed.ts) sem depender de execução manual prévia.
    await seed();
  });

  it(
    "devolve leads de mais de um responsável, para qualquer papel — sem escopo por " +
      "responsavelId (fix round 1/5: a restrição por responsável foi revertida por decisão " +
      "de negócio, ver comentário em page.tsx; /leads/kanban já listava tudo sem filtro, e " +
      "uma barreira só nesta tabela era contornável em um clique)",
    async () => {
      const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@exemplo.com" } });
      const vendedor = await prisma.user.findUniqueOrThrow({ where: { email: "vendedor@exemplo.com" } });

      const leads = await listarLeads();

      const responsaveisPresentes = new Set(leads.map((lead) => lead.responsavelId));
      expect(responsaveisPresentes.has(admin.id)).toBe(true);
      expect(responsaveisPresentes.has(vendedor.id)).toBe(true);
    }
  );

  it("cada lead vem com a etapa (`stage`) incluída — a tabela da Task 16 usa `stage.nome` como coluna", async () => {
    const leads = await listarLeads();

    expect(leads.length).toBeGreaterThan(0);
    for (const lead of leads) {
      expect(lead.stage).toBeTruthy();
      expect(typeof lead.stage.nome).toBe("string");
    }
  });

  it("ordena por criadoEm decrescente (mesmo contrato de listarLeadsPorEtapa, Task 13)", async () => {
    const leads = await listarLeads();

    for (let i = 1; i < leads.length; i++) {
      expect(leads[i - 1].criadoEm.getTime()).toBeGreaterThanOrEqual(leads[i].criadoEm.getTime());
    }
  });
});
