// @vitest-environment jsdom
//
// Rodada de correção 1, achado M7: não havia teste de componente para
// `agente-form.tsx`, apesar do `data-testid="previa-prompt"` sugerir que se
// esperava um. Mesmo padrão de tests/unit/conversa-responder.test.tsx —
// mocka a action (`@/modules/whatsapp/agente-actions` tem `"use server"` e
// importaria `@/core/auth/session` → `next-auth` → `next/server`, que não
// resolve fora do build do Next) e `next/navigation`.
//
// Cobre as duas coisas que o revisor pediu:
// 1. a prévia reflete o que foi digitado (prova viva de que
//    `montarPromptSistema` roda de novo a cada tecla, não só no mount);
// 2. o erro devolvido pela action aparece na tela.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { BotConfig } from "@prisma/client";

const salvarConfigAgenteActionMock = vi.fn();
const restaurarConfigPadraoActionMock = vi.fn();
vi.mock("@/modules/whatsapp/agente-actions", () => ({
  salvarConfigAgenteAction: (...args: unknown[]) => salvarConfigAgenteActionMock(...args),
  restaurarConfigPadraoAction: (...args: unknown[]) => restaurarConfigPadraoActionMock(...args),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { AgenteForm } = await import("../../src/components/agente-form");

const CONFIG_BASE: BotConfig = {
  id: "bot-config",
  ativo: true,
  personaNome: "Ana",
  personaPapel: "atendente virtual da AutoCenter Exemplo",
  regras: ["Seja cordial.", "Nunca invente preço."],
  faq: "Horário: 8h às 18h.",
  atualizadoEm: new Date("2026-01-01T00:00:00.000Z"),
  atualizadoPorId: null,
};

afterEach(() => {
  cleanup();
  salvarConfigAgenteActionMock.mockReset();
  restaurarConfigPadraoActionMock.mockReset();
});

function previa() {
  return screen.getByTestId("previa-prompt").textContent ?? "";
}

describe("AgenteForm — prévia", () => {
  it("a prévia inicial usa a config recebida por prop", () => {
    render(<AgenteForm config={CONFIG_BASE} />);
    expect(previa()).toContain("Você é Ana, atendente virtual da AutoCenter Exemplo.");
    expect(previa()).toContain("1. Seja cordial.");
    expect(previa()).toContain("2. Nunca invente preço.");
  });

  // A promessa da tela é "é exatamente este texto que o modelo recebe" — se
  // a prévia não reagisse a cada tecla, essa promessa seria falsa a partir
  // do segundo caractere digitado.
  it("a prévia reflete o que foi digitado, em tempo real", () => {
    render(<AgenteForm config={CONFIG_BASE} />);

    fireEvent.change(screen.getByLabelText("Nome da persona"), { target: { value: "Beatriz" } });
    expect(previa()).toContain("Você é Beatriz,");
    expect(previa()).not.toContain("Você é Ana,");

    fireEvent.change(screen.getByLabelText("Perguntas frequentes"), {
      target: { value: "Aceita cartão? Sim." },
    });
    expect(previa()).toContain("Aceita cartão? Sim.");
  });

  // Achado M3 da mesma rodada: a action grava com `.trim()`, então a prévia
  // precisa mostrar o texto JÁ aparado, não o que ainda tem espaço sobrando
  // nas pontas — senão a tela promete um texto que não é o que será salvo.
  it("a prévia mostra o nome da persona já aparado (mesmo trim que a action aplica)", () => {
    render(<AgenteForm config={CONFIG_BASE} />);
    fireEvent.change(screen.getByLabelText("Nome da persona"), { target: { value: "  Beatriz  " } });
    expect(previa()).toContain("Você é Beatriz,");
    expect(previa()).not.toContain("Beatriz  ,");
    expect(previa()).not.toContain("  Beatriz");
  });
});

describe("AgenteForm — salvar", () => {
  it("erro devolvido pela action aparece na tela", async () => {
    salvarConfigAgenteActionMock.mockResolvedValue({
      ok: false,
      erro: "Nome e papel da persona são obrigatórios.",
    });
    render(<AgenteForm config={CONFIG_BASE} />);

    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(screen.getByText("Nome e papel da persona são obrigatórios.")).toBeTruthy();
    });
  });

  it("sucesso mostra a confirmação de salvo", async () => {
    salvarConfigAgenteActionMock.mockResolvedValue({ ok: true });
    render(<AgenteForm config={CONFIG_BASE} />);

    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(screen.getByText(/Salvo\. Vale na próxima resposta\./)).toBeTruthy();
    });
  });

  // Achado M2 da mesma rodada: "Salvo." não pode continuar na tela ao lado
  // de uma edição feita depois do salvamento — promete algo que não é mais
  // verdade.
  it("editar um campo depois de salvar limpa a confirmação de 'Salvo'", async () => {
    salvarConfigAgenteActionMock.mockResolvedValue({ ok: true });
    render(<AgenteForm config={CONFIG_BASE} />);

    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => {
      expect(screen.getByText(/Salvo\. Vale na próxima resposta\./)).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Nome da persona"), { target: { value: "Outro nome" } });

    expect(screen.queryByText(/Salvo\. Vale na próxima resposta\./)).toBeNull();
  });
});
