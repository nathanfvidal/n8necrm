// @vitest-environment jsdom
//
// Cobre só a lógica de ramificação do client component (mesma instrução das
// outras Tasks): remoção otimista ao clicar "Concluir", rollback + mensagem
// quando o servidor rejeita (o caso central da Task 18: `concluirMinhaTask`
// lança "Tarefa não encontrada" quando o id não pertence a quem clicou —
// ver a checagem de dono em `concluirTask`, core/tasks/service.ts), e que a
// data exibida usa `formatarDataCivilBR` (não desloca de dia).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const concluirMinhaTaskMock = vi.fn();
vi.mock("@/core/tasks/actions", () => ({
  concluirMinhaTask: (...args: unknown[]) => concluirMinhaTaskMock(...args),
}));

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const { TaskList } = await import("../../src/components/tasks/task-list");

const TAREFAS_TESTE = [
  { id: "task-1", titulo: "Ligar pro fornecedor", vencimento: new Date("2026-08-05T00:00:00.000Z") },
  {
    id: "task-2",
    titulo: "Enviar proposta",
    vencimento: new Date("2026-08-10T00:00:00.000Z"),
    leadContatoNome: "Carlos Silva",
  },
];

afterEach(() => {
  cleanup();
  concluirMinhaTaskMock.mockReset();
  refreshMock.mockReset();
});

describe("TaskList", () => {
  it("mostra EmptyState quando não há tarefas pendentes", () => {
    render(<TaskList tasks={[]} />);
    expect(screen.getByText("Nenhuma tarefa pendente")).toBeTruthy();
  });

  it("exibe o vencimento formatado sem deslocar de dia, e o contato do lead quando vinculado", () => {
    render(<TaskList tasks={TAREFAS_TESTE} />);
    expect(screen.getByText(/Vence em 05\/08\/2026/)).toBeTruthy();
    expect(screen.getByText(/Vence em 10\/08\/2026 · Carlos Silva/)).toBeTruthy();
  });

  it("conclusão com sucesso: remove a tarefa da lista (otimista), mantém as demais, sem erro", async () => {
    concluirMinhaTaskMock.mockResolvedValue({});
    render(<TaskList tasks={TAREFAS_TESTE} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Concluir" })[0]);

    await waitFor(() => expect(screen.queryByText("Ligar pro fornecedor")).toBeNull());
    expect(screen.getByText("Enviar proposta")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
  });

  it(
    "conclusão rejeitada pelo servidor ('Tarefa não encontrada' — id de outro dono ou já " +
      "inexistente): reinsere a tarefa (rollback) e mostra mensagem de erro amigável",
    async () => {
      concluirMinhaTaskMock.mockRejectedValue(new Error("Tarefa não encontrada"));
      render(<TaskList tasks={TAREFAS_TESTE} />);

      fireEvent.click(screen.getAllByRole("button", { name: "Concluir" })[0]);

      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toMatch(/não pertence a você/);
      });
      expect(screen.getByText("Ligar pro fornecedor")).toBeTruthy();
    }
  );

  it("botão 'Dispensar' limpa a mensagem de erro sem afetar a lista", async () => {
    concluirMinhaTaskMock.mockRejectedValue(new Error("Tarefa não encontrada"));
    render(<TaskList tasks={TAREFAS_TESTE} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Concluir" })[0]);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Dispensar" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
