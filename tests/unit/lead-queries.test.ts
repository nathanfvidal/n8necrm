// Este arquivo (junto com pipeline-stages.test.ts, seed.test.ts,
// rate-limit.test.ts e audit-log.test.ts) usa o Prisma real contra o
// Postgres do Supabase, então carrega DATABASE_URL do .env aqui — não em
// vitest.config.ts — para não injetar credenciais em testes que não tocam
// banco. Precisa ser o primeiro import: os módulos abaixo (via
// src/lib/prisma.ts → src/lib/env.ts) leem process.env.DATABASE_URL no
// top-level.
import "dotenv/config";

import { describe, it, expect, beforeAll } from "vitest";
import { listarLeads } from "../../src/core/leads/queries";
import { prisma } from "../../src/lib/prisma";
import { seed } from "../../prisma/seed";

describe("listarLeads", () => {
  beforeAll(async () => {
    // Garante o seed (4 leads: 2 do admin, 2 do vendedor — ver
    // prisma/seed.ts) sem depender de execução manual prévia.
    await seed();
  });

  it("sem filtro: devolve leads de mais de um responsável — a visão irrestrita usada por quem tem `ver_dashboard_geral` (ADMIN/GESTOR, Task 16)", async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@exemplo.com" } });
    const vendedor = await prisma.user.findUniqueOrThrow({ where: { email: "vendedor@exemplo.com" } });

    const leads = await listarLeads();

    const responsaveisPresentes = new Set(leads.map((lead) => lead.responsavelId));
    expect(responsaveisPresentes.has(admin.id)).toBe(true);
    expect(responsaveisPresentes.has(vendedor.id)).toBe(true);
  });

  it("com filtro responsavelId: devolve só os leads daquele responsável — a restrição que a página aplica para VENDEDOR (Task 16)", async () => {
    const vendedor = await prisma.user.findUniqueOrThrow({ where: { email: "vendedor@exemplo.com" } });

    const leads = await listarLeads({ responsavelId: vendedor.id });

    expect(leads.length).toBeGreaterThan(0);
    expect(leads.every((lead) => lead.responsavelId === vendedor.id)).toBe(true);
  });

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
