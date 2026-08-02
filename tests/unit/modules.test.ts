import { describe, it, expect, vi } from "vitest";

// config/client.ts agora envia modulos: [] (Catálogo e Analytics ainda não
// têm rota — Fases 2 e 3), então este teste não pode mais provar
// moduloAtivo() lendo o config real: não haveria módulo ativo para checar o
// caminho "true". Mockamos config/client com um módulo ligado e um desligado
// explícitos, igual ao padrão já usado em painel-nav.test.tsx, para o teste
// continuar válido independente do que o fork tiver ligado.
vi.mock("../../config/client", () => ({
  client: { modulos: ["catalog"] },
}));

const { moduloAtivo } = await import("../../src/lib/module-gate");

describe("moduloAtivo", () => {
  it("retorna true para módulo listado na config", () => {
    expect(moduloAtivo("catalog")).toBe(true);
  });

  it("retorna false para módulo não listado", () => {
    expect(moduloAtivo("analytics")).toBe(false);
  });
});
