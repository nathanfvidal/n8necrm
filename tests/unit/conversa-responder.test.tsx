// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Mesmo padrão de painel-nav.test.tsx: a action importa `agente.ts`, que tem
// `import "server-only"` — fora do pipeline de build do Next isso lança.
vi.mock("@/modules/whatsapp/actions", () => ({
  responderConversaAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { ConversaResponder } = await import("../../src/components/conversa-responder");

describe("ConversaResponder", () => {
  afterEach(cleanup);

  it("mostra o campo de texto e o botão de enviar", () => {
    render(<ConversaResponder conversationId="c1" />);
    expect(screen.getByRole("textbox", { name: /resposta/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /enviar/i })).toBeTruthy();
  });

  it("avisa que enviar pausa a IA — o efeito colateral precisa estar na tela", () => {
    render(<ConversaResponder conversationId="c1" />);
    expect(screen.getByText(/pausa o atendimento automático/i)).toBeTruthy();
  });
});
