// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// A grade de módulos exibidos hoje (catalog, analytics) é definida dentro de
// painel-nav.tsx, não em config/client.ts — então não dá pra provar a
// filtragem lendo o config real: config/client.ts envia modulos: [] (nenhuma
// rota de módulo existe ainda — Fases 2 e 3), então não haveria módulo ativo
// para checar o caminho "aparece". Por isso mockamos config/client aqui,
// controlando explicitamente um módulo ligado e um desligado, sem depender
// do estado atual do arquivo real — se um fork mudar client.modulos, este
// teste continua válido.
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

// O botão "Sair" usa uma Server Action de `@/core/auth/actions`, que importa
// `@/lib/auth` → `next-auth` → `next/server`. Esse último só resolve dentro
// do pipeline de build do Next; sob Vitest a importação quebraria antes de
// qualquer teste rodar (mesmo motivo do mock de `@/core/notifications/actions`
// acima). O que interessa aqui é que o botão esteja NA TELA — que ele desloga
// de verdade é provado no e2e, com sessão real.
vi.mock("@/core/auth/actions", () => ({
  sairAction: vi.fn(),
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

  it("não mostra o link de Conversas (whatsapp) quando o módulo está desligado", () => {
    render(<PainelNav />);
    expect(screen.queryByRole("link", { name: "Conversas" })).toBeNull();
  });

  it("sempre mostra os links fixos, independente dos módulos", () => {
    render(<PainelNav />);
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Leads" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Funil" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Tarefas" })).toBeTruthy();
  });

  it("mostra o botão de sair — sem ele não havia como encerrar a sessão pela interface", () => {
    render(<PainelNav />);
    const botao = screen.getByRole("button", { name: "Sair" });
    expect(botao).toBeTruthy();
    // Precisa ser submit de um <form> (POST via Server Action), não link:
    // um GET que desloga é acionável de fora por um simples <img src>.
    expect(botao.getAttribute("type")).toBe("submit");
    expect(botao.closest("form")).toBeTruthy();
  });

  it("mostra quem está logado quando o nome é informado", () => {
    render(<PainelNav nomeUsuario="Maria Vendedora" />);
    expect(screen.getByTestId("usuario-logado").textContent).toBe("Maria Vendedora");
  });

  it("não quebra quando o nome não é informado", () => {
    render(<PainelNav />);
    expect(screen.queryByTestId("usuario-logado")).toBeNull();
  });
});
