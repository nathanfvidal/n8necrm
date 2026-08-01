// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// A grade de módulos exibidos hoje (catalog, analytics) é definida dentro de
// painel-nav.tsx, não em config/client.ts — então não dá pra provar a
// filtragem lendo o config real: as duas entradas de módulo existentes hoje
// (catalog, analytics) estão ATIVAS em config/client.ts (Task 3). Por isso
// mockamos config/client aqui, controlando explicitamente um módulo ligado e
// um desligado, sem depender do estado atual do arquivo real — se um fork
// mudar client.modulos, este teste continua válido.
vi.mock("../../config/client", () => ({
  client: { modulos: ["catalog"] },
}));

// PainelNav (Task 19) agora renderiza <NotificationBell> como último item —
// um Client Component que importa `marcarNotificacaoComoLidaAction` de
// `@/core/notifications/actions` e chama `useRouter()` de "next/navigation".
// `actions.ts` importa `dispatch.ts` (que tem `import "server-only"`, mesmo
// padrão de `@/core/leads/actions` em `lead-note-form.test.tsx`) — sem
// mockar aqui, a importação quebraria fora do pipeline de build do Next
// (Vitest não aplica a condição de resolução "react-server" que faz
// "server-only" virar no-op). `useRouter()` sem mock lançaria por falta de
// contexto de App Router em jsdom puro (mesmo padrão de `task-list.test.tsx`).
vi.mock("@/core/notifications/actions", () => ({
  marcarNotificacaoComoLidaAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { PainelNav } = await import("../../src/components/painel-nav");

describe("PainelNav", () => {
  afterEach(() => {
    cleanup();
  });

  it("mostra o link de um módulo ativo", () => {
    render(<PainelNav />);
    expect(screen.getByRole("link", { name: "Catálogo" })).toBeTruthy();
  });

  it("não mostra o link de um módulo desativado", () => {
    render(<PainelNav />);
    expect(screen.queryByRole("link", { name: "Analytics" })).toBeNull();
  });

  it("sempre mostra os links fixos, independente dos módulos", () => {
    render(<PainelNav />);
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Leads" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Funil" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Tarefas" })).toBeTruthy();
  });
});
