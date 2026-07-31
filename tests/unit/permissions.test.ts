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
});
