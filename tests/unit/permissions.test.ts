import { describe, it, expect } from "vitest";
import { hasPermission } from "../../src/core/auth/permissions";

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
