// @vitest-environment jsdom
//
// Cobre só a lógica de ramificação do client component (não layout/estilo,
// mesma instrução das Tasks 14/15/16 para os outros testes de componente):
// fix round 1/5 (Task 17), achado do revisor — uma nota acima do limite de
// tamanho lançava sem tratamento dentro da Server Action original. Agora
// `adicionarNotaAction` devolve `{ erro }` em vez de lançar, e este arquivo
// prova que o formulário (a) mostra essa mensagem, (b) PRESERVA o texto que
// a pessoa digitou nesse caso (o motivo de o campo ser controlado, não
// depender do reset automático do `<form action>`), e (c) limpa o campo só
// quando a submissão termina sem erro.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const adicionarNotaActionMock = vi.fn();
vi.mock("@/core/leads/actions", () => ({
  adicionarNotaAction: (...args: unknown[]) => adicionarNotaActionMock(...args),
}));

const { LeadNoteForm } = await import("../../src/components/leads/lead-note-form");

// `textoMaxLength` chega por prop, calculada pela página (Server Component)
// a partir de `TEXTO_MAX_LENGTH` (notes.ts) — não é responsabilidade deste
// componente buscar esse número, então o teste só passa um valor fixo. Ver
// comentário em lead-note-form.tsx sobre por que o componente NUNCA importa
// `@/core/leads/notes` diretamente (arrastaria Prisma/`pg` pro bundle do
// navegador).
const TEXTO_MAX_LENGTH_TESTE = 4000;

afterEach(() => {
  cleanup();
  adicionarNotaActionMock.mockReset();
});

describe("LeadNoteForm", () => {
  it(
    "nota muito longa: mostra a mensagem de erro devolvida pela action e MANTÉM o texto " +
      "digitado (não deixa a pessoa perder o que escreveu)",
    async () => {
      adicionarNotaActionMock.mockResolvedValue({
        erro: "Nota muito longa: o texto tem 4001 caracteres, o máximo permitido é 4000.",
      });

      render(<LeadNoteForm leadId="lead-1" textoMaxLength={TEXTO_MAX_LENGTH_TESTE} />);

      const textarea = screen.getByPlaceholderText("Adicionar nota...") as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "texto que não pode sumir" } });
      fireEvent.click(screen.getByRole("button", { name: "Salvar nota" }));

      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toMatch(/Nota muito longa/);
      });

      expect(textarea.value).toBe("texto que não pode sumir");
    }
  );

  it("submissão sem erro (nota salva): limpa o campo depois de terminar", async () => {
    adicionarNotaActionMock.mockResolvedValue({ erro: null });

    render(<LeadNoteForm leadId="lead-1" textoMaxLength={TEXTO_MAX_LENGTH_TESTE} />);

    const textarea = screen.getByPlaceholderText("Adicionar nota...") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Nota normal" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nota" }));

    await waitFor(() => expect(textarea.value).toBe(""));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("leadId chega à action via bind (primeiro argumento), não como campo do formulário", async () => {
    adicionarNotaActionMock.mockResolvedValue({ erro: null });

    render(<LeadNoteForm leadId="lead-42" textoMaxLength={TEXTO_MAX_LENGTH_TESTE} />);

    fireEvent.change(screen.getByPlaceholderText("Adicionar nota..."), {
      target: { value: "Olá" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nota" }));

    await waitFor(() => expect(adicionarNotaActionMock).toHaveBeenCalledTimes(1));
    const [leadIdRecebido] = adicionarNotaActionMock.mock.calls[0];
    expect(leadIdRecebido).toBe("lead-42");
  });
});
