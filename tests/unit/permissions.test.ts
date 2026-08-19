import { describe, it, expect } from "vitest";
import { hasPermission } from "../../src/core/auth/permissions";

describe("hygiene de configuração de teste", () => {
  it("este arquivo não toca banco, então não deve ter credenciais reais em process.env (guarda contra vazamento via vitest.config.ts)", () => {
    // rate-limit.test.ts e audit-log.test.ts carregam DATABASE_URL via
    // `import "dotenv/config"` dentro deles mesmos, não em vitest.config.ts
    // — exatamente para que arquivos como este não vejam credenciais que
    // não pedem. SUPABASE_SERVICE_ROLE_KEY é a mais sensível: se ela
    // aparecer aqui, algo voltou a injetar o .env inteiro globalmente.
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });
});

describe("hasPermission", () => {
  it("ADMIN pode gerenciar usuários", () => {
    expect(hasPermission("ADMIN", "gerenciar_usuarios")).toBe(true);
  });

  it("VENDEDOR não pode gerenciar usuários", () => {
    expect(hasPermission("VENDEDOR", "gerenciar_usuarios")).toBe(false);
  });

  it("VENDEDOR pode criar lead", () => {
    expect(hasPermission("VENDEDOR", "criar_lead")).toBe(true);
  });

  it("GESTOR pode ver dashboard de todos os vendedores", () => {
    expect(hasPermission("GESTOR", "ver_dashboard_geral")).toBe(true);
  });

  it("VENDEDOR não pode ver dashboard de todos os vendedores", () => {
    expect(hasPermission("VENDEDOR", "ver_dashboard_geral")).toBe(false);
  });

  it("só ADMIN configura o agente — a persona é da agência, não do cliente", () => {
    expect(hasPermission("ADMIN", "configurar_agente")).toBe(true);
    expect(hasPermission("GESTOR", "configurar_agente")).toBe(false);
    expect(hasPermission("VENDEDOR", "configurar_agente")).toBe(false);
  });
});

describe("gerenciar_funil", () => {
  it("só ADMIN gerencia o funil — GESTOR e VENDEDOR não", () => {
    expect(hasPermission("ADMIN", "gerenciar_funil")).toBe(true);
    expect(hasPermission("GESTOR", "gerenciar_funil")).toBe(false);
    expect(hasPermission("VENDEDOR", "gerenciar_funil")).toBe(false);
  });
});

describe("gerenciar_fluxos", () => {
  it("gerenciar_fluxos e exclusiva de ADMIN — derruba atendimento de cliente", () => {
    expect(hasPermission("ADMIN", "gerenciar_fluxos")).toBe(true);
    expect(hasPermission("GESTOR", "gerenciar_fluxos")).toBe(false);
    expect(hasPermission("VENDEDOR", "gerenciar_fluxos")).toBe(false);
  });
});
