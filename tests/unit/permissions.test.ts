import { describe, it, expect } from "vitest";
import { hasPermission, type Acao } from "../../src/core/auth/permissions";

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

describe("ver_fluxos", () => {
  it("ver_fluxos e de ADMIN e GESTOR, mas nao de VENDEDOR — reexecutar dispara trabalho real no cliente", () => {
    expect(hasPermission("ADMIN", "ver_fluxos")).toBe(true);
    expect(hasPermission("GESTOR", "ver_fluxos")).toBe(true);
    expect(hasPermission("VENDEDOR", "ver_fluxos")).toBe(false);
  });
});

describe("gerenciar_conexoes (Ciclo 2a)", () => {
  it("ADMIN pode", () => {
    expect(hasPermission("ADMIN", "gerenciar_conexoes")).toBe(true);
  });

  it("GESTOR não pode", () => {
    // Mesmo argumento de `gerenciar_fluxos`: o erro aqui derruba o
    // atendimento da empresa inteira, e credencial substituída em silêncio é
    // tomada de canal.
    expect(hasPermission("GESTOR", "gerenciar_conexoes")).toBe(false);
  });

  it("VENDEDOR não pode", () => {
    expect(hasPermission("VENDEDOR", "gerenciar_conexoes")).toBe(false);
  });

  it("não existe `ver_conexoes` — a separação foi RECUSADA, não esquecida", () => {
    // A matriz registra, no comentário de `ver_fluxos`, que separar sem motivo
    // cria "uma permissão órfã de um lado e uma tela morta do outro". Aqui não
    // há NADA para ver: o segredo não renderiza, e nome/domínio/instância só
    // interessam a quem pode mudar.
    //
    // A trava de verdade é a de TIPO abaixo, e ela foi MEDIDA: o `as never`
    // sozinho NÃO serve para isso. Acrescentar `| "ver_conexoes"` a `Acao` e
    // rodar `npm run typecheck` deixa `"ver_conexoes" as never` verde —
    // asserção para `never` não reclama de membro que passou a existir. O
    // `as never` continua aqui só para atravessar o tipo do parâmetro.
    //
    // `[Extract<...>] extends [never]` com os colchetes é o que impede a
    // distribuição do condicional sobre `never` (que devolveria `never` nos
    // dois casos e não travaria nada). Ausente, o tipo é `true` e a linha
    // compila; presente, vira `false` e `tsc` reprova — obrigando a revisitar
    // a decisão em vez de deslizar para ela.
    const semVerConexoes: [Extract<Acao, "ver_conexoes">] extends [never] ? true : false = true;
    expect(semVerConexoes).toBe(true);

    for (const papel of ["ADMIN", "GESTOR", "VENDEDOR"] as const) {
      expect(hasPermission(papel, "ver_conexoes" as never)).toBe(false);
    }
  });
});
