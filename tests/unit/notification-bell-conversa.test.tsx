// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// Mesmo padrão de `painel-nav.test.tsx`: a action importa a cadeia que passa
// por `server-only`, que sempre lança sob Vitest.
vi.mock("@/core/notifications/actions", () => ({
  marcarNotificacaoComoLidaAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { NotificationBell } = await import(
  "../../src/components/notifications/notification-bell"
);

describe("NotificationBell — conversa aguardando", () => {
  afterEach(cleanup);

  it("mostra o nome da conversa e link para ela", async () => {
    render(
      <NotificationBell
        notificacoes={[
          {
            id: "n1",
            tipo: "CONVERSA_AGUARDANDO",
            payload: { conversationId: "c1", nomeExibicao: "Maria Souza" },
            criadoEm: new Date(),
          },
        ]}
      />
    );

    // O sino abre num clique — o mesmo padrão que `notification-bell.test.tsx`
    // usa para abrir o popover antes de assertar.
    fireEvent.click(screen.getByRole("button", { name: "Notificações" }));

    expect(await screen.findByText(/Maria Souza/)).toBeTruthy();
    const link = await screen.findByRole("link", { name: /Ver conversa/i });
    expect(link.getAttribute("href")).toBe("/conversas/c1");
  });

  // Sem isto, um payload malformado (ou um tipo futuro) derrubaria o sino
  // inteiro em vez de degradar naquela linha. O `<li>` só existe dentro de
  // `{aberto && ...}` (`notification-bell.tsx`), então o teste precisa abrir
  // o sino — senão `extrairPayloadConversaAguardando` nunca roda e a
  // asserção não prova nada. Mesmo padrão de
  // `notification-bell.test.tsx`, "payload sem o formato esperado...".
  it("não quebra com payload malformado: degrada para 'Notificação'", () => {
    render(
      <NotificationBell
        notificacoes={[
          { id: "n2", tipo: "CONVERSA_AGUARDANDO", payload: { foo: "bar" }, criadoEm: new Date() },
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Notificações" }));

    expect(screen.getByText("Notificação")).toBeTruthy();
  });
});
