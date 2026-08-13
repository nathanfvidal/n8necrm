// @vitest-environment jsdom
//
// A reforma da tela de tarefas. Arquivo separado de `task-list.test.tsx` de
// propósito: aquele cobre conclusão e regras de dono, e passou INTACTO
// enquanto o componente era reescrito por baixo — o que é correto (não
// mexi no que ele afirma) e também a prova de que ele não cobria nada disto.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const concluirMinhaTaskMock = vi.fn();
const editarTaskActionMock = vi.fn();
const excluirTaskActionMock = vi.fn();
const reabrirTaskActionMock = vi.fn();

// As quatro precisam estar no mock mesmo que um teste use só uma:
// `task-list.tsx` as IMPORTA, e um mock que devolva objeto sem elas as deixa
// `undefined`. O render passa, e a falha só aparece no clique.
vi.mock("@/core/tasks/actions", () => ({
  concluirMinhaTask: (...args: unknown[]) => concluirMinhaTaskMock(...args),
  editarTaskAction: (...args: unknown[]) => editarTaskActionMock(...args),
  excluirTaskAction: (...args: unknown[]) => excluirTaskActionMock(...args),
  reabrirTaskAction: (...args: unknown[]) => reabrirTaskActionMock(...args),
}));

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const { TaskList } = await import("../../src/components/tasks/task-list");

const CONTATOS = [
  { id: "contato-1", nome: "Fernanda Lima" },
  { id: "contato-2", nome: "Carlos Silva" },
];

const VENCIMENTO = new Date("2026-08-05T00:00:00.000Z");

function tarefa(extra: Record<string, unknown> = {}) {
  return { id: "task-1", titulo: "Ligar pro fornecedor", vencimento: VENCIMENTO, ...extra };
}

afterEach(() => {
  cleanup();
  concluirMinhaTaskMock.mockReset();
  editarTaskActionMock.mockReset();
  excluirTaskActionMock.mockReset();
  reabrirTaskActionMock.mockReset();
  refreshMock.mockReset();
});

describe("descrição no modo leitura", () => {
  // O defeito que abriu esta branch: `Task.descricao` existia no banco, o
  // serviço gravava, a action aceitava — e NADA nesta tela mostrava. Dava
  // para digitar uma descrição ao editar, salvar, e vê-la sumir.
  it("mostra a descrição, que antes era gravada e nunca exibida", () => {
    render(<TaskList tasks={[tarefa({ descricao: "Levar a proposta impressa." })]} />);
    expect(screen.getByText(/Levar a proposta impressa/)).toBeTruthy();
  });

  it("preserva as quebras de linha e limita a altura", () => {
    render(<TaskList tasks={[tarefa({ descricao: "linha um\nlinha dois" })]} />);

    const paragrafo = screen.getByText(/linha um/);
    // Sem `whitespace-pre-wrap` o HTML colapsa a quebra e o texto vira um
    // parágrafo só — o `<Textarea>` deixa digitar em linhas, e a leitura
    // precisa devolver o que foi digitado.
    expect(paragrafo.className).toContain("whitespace-pre-wrap");
    // Sem teto, uma descrição de 2000 caracteres empurra a lista inteira
    // para fora da tela.
    expect(paragrafo.className).toContain("line-clamp-3");
  });

  it("sem descrição, não renderiza parágrafo vazio", () => {
    const { container } = render(<TaskList tasks={[tarefa()]} />);
    expect(container.querySelectorAll("p.whitespace-pre-wrap")).toHaveLength(0);
  });

  it("mostra o contato da tarefa e o do lead como coisas distintas", () => {
    render(
      <TaskList tasks={[tarefa({ contatoNome: "Fernanda Lima", leadContatoNome: "Carlos Silva" })]} />
    );
    expect(screen.getByText(/Fernanda Lima/)).toBeTruthy();
    expect(screen.getByText(/Carlos Silva/)).toBeTruthy();
  });
});

describe("concluída ganha Reabrir no lugar de Concluir", () => {
  it("tarefa concluída não oferece Concluir de novo", () => {
    render(<TaskList tasks={[tarefa({ concluida: true })]} />);
    expect(screen.queryByRole("button", { name: "Concluir" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reabrir" })).toBeTruthy();
  });

  it("tarefa pendente não oferece Reabrir", () => {
    render(<TaskList tasks={[tarefa()]} />);
    expect(screen.queryByRole("button", { name: "Reabrir" })).toBeNull();
    expect(screen.getByRole("button", { name: "Concluir" })).toBeTruthy();
  });

  it("Reabrir chama a action e atualiza a rota", async () => {
    reabrirTaskActionMock.mockResolvedValue({ ok: true });
    render(<TaskList tasks={[tarefa({ concluida: true })]} />);

    fireEvent.click(screen.getByRole("button", { name: "Reabrir" }));

    await waitFor(() =>
      expect(reabrirTaskActionMock).toHaveBeenCalledWith({ taskId: "task-1", leadId: undefined })
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("falha ao reabrir mostra o motivo e NÃO atualiza a rota", async () => {
    reabrirTaskActionMock.mockResolvedValue({ ok: false, erro: "Tarefa não encontrada" });
    render(<TaskList tasks={[tarefa({ concluida: true })]} />);

    fireEvent.click(screen.getByRole("button", { name: "Reabrir" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("não encontrada"));
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

describe("excluir passa por diálogo, não por window.confirm", () => {
  it("clicar no gatilho NÃO exclui — abre a confirmação", async () => {
    render(<TaskList tasks={[tarefa()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Excluir tarefa" }));

    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(excluirTaskActionMock).not.toHaveBeenCalled();
  });

  it("Cancelar fecha sem excluir", async () => {
    render(<TaskList tasks={[tarefa()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Excluir tarefa" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(excluirTaskActionMock).not.toHaveBeenCalled();
  });

  it("confirmar exclui de verdade", async () => {
    excluirTaskActionMock.mockResolvedValue({ ok: true });
    render(<TaskList tasks={[tarefa()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Excluir tarefa" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    await waitFor(() =>
      expect(excluirTaskActionMock).toHaveBeenCalledWith({ taskId: "task-1", leadId: undefined })
    );
  });

  // O gatilho é "Excluir tarefa" e a confirmação é "Excluir". Se fossem
  // iguais, `getByRole("button", { name: "Excluir" })` ficaria ambíguo e o
  // localizador do e2e quebraria. Não dependo de o Base UI tirar o fundo da
  // árvore de acessibilidade — ele faz isso hoje, e é conveniente demais
  // para eu apostar.
  it("gatilho e confirmação têm nomes acessíveis distintos", async () => {
    render(<TaskList tasks={[tarefa()]} />);

    expect(screen.queryByRole("button", { name: "Excluir" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Excluir tarefa" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(screen.getAllByRole("button", { name: "Excluir" })).toHaveLength(1);
  });

  it("o diálogo tem nome acessível — nunca um 'diálogo' anônimo", async () => {
    render(<TaskList tasks={[tarefa()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Excluir tarefa" }));
    const dialogo = await waitFor(() => screen.getByRole("dialog"));

    const idDoRotulo = dialogo.getAttribute("aria-labelledby");
    const texto = idDoRotulo ? document.getElementById(idDoRotulo)?.textContent : null;
    expect(dialogo.getAttribute("aria-label") || texto).toBeTruthy();
  });
});

describe("editar alcança descrição e contato", () => {
  it("o campo de descrição é textarea, não input de uma linha", () => {
    render(<TaskList tasks={[tarefa()]} contatos={CONTATOS} />);

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));

    expect(screen.getByLabelText("Descrição da tarefa").tagName).toBe("TEXTAREA");
  });

  // Antes desta branch `salvarEdicao` mandava `leadId: undefined` fixo e nem
  // existia campo de contato: desvincular era inalcançável pela interface.
  it("escolher 'Nenhum' manda null, que é a ordem de desvincular", async () => {
    editarTaskActionMock.mockResolvedValue({ ok: true });
    render(<TaskList tasks={[tarefa({ contactId: "contato-1" })]} contatos={CONTATOS} />);

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.change(screen.getByLabelText("Contato da tarefa"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(editarTaskActionMock).toHaveBeenCalled());
    expect(editarTaskActionMock.mock.calls[0][0].contactId).toBeNull();
  });

  it("o contato atual vem pré-selecionado ao abrir a edição", () => {
    render(<TaskList tasks={[tarefa({ contactId: "contato-2" })]} contatos={CONTATOS} />);

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));

    const seletor = screen.getByLabelText("Contato da tarefa") as HTMLSelectElement;
    expect(seletor.value).toBe("contato-2");
  });

  it("sem contatos cadastrados o seletor não aparece — uma opção só não é escolha", () => {
    render(<TaskList tasks={[tarefa()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(screen.queryByLabelText("Contato da tarefa")).toBeNull();
  });

  // `Editar` e `Excluir tarefa` eram `<button className="text-xs underline">`
  // ao lado de um `<Button>` de verdade — uma ação disponível disfarçada de
  // nota de rodapé. A queixa do dono foi literal: "tem que ter botões de
  // edição e deletar".
  it("Editar e Excluir são botões de verdade, não texto sublinhado", () => {
    const { container } = render(<TaskList tasks={[tarefa()]} />);

    for (const nome of ["Editar", "Excluir tarefa"]) {
      const botao = screen.getByRole("button", { name: nome });
      expect(botao.className).not.toContain("underline");
      expect(botao.getAttribute("data-slot")).toBe("button");
    }
    expect(container.querySelectorAll("button.text-xs.underline")).toHaveLength(0);
  });
});
