// @vitest-environment jsdom
//
// Cobre só a lógica de ramificação do client component (mesma instrução das
// outras Tasks): remoção otimista ao clicar "Concluir", rollback + mensagem
// quando o servidor rejeita (o caso central da Task 18: `concluirMinhaTaskAction`
// lança "Tarefa não encontrada" quando o id não pertence a quem clicou —
// ver a checagem de dono em `concluirTask`, core/tasks/service.ts), que a
// data exibida usa `formatarDataCivilBR` (não desloca de dia), e (fix round
// 1/5, achado do revisor) que uma tarefa de outra pessoa (`souResponsavel:
// false`, caso da seção "Tarefas" de `/leads/[id]` depois do fix) mostra o
// nome do dono em vez de um botão "Concluir" que só falharia ao ser
// clicado.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const concluirMinhaTaskMock = vi.fn();
// As outras três precisam estar aqui mesmo que os testes antigos não as usem:
// `task-list.tsx` as IMPORTA, e um mock que devolve objeto sem elas as deixa
// `undefined` — o render passa, e o teste só descobre no clique. Foi assim
// que os testes desta tela continuaram verdes enquanto o componente era
// reescrito por baixo.
const editarTaskActionMock = vi.fn();
const excluirTaskActionMock = vi.fn();
const reabrirTaskActionMock = vi.fn();
vi.mock("@/core/tasks/actions", () => ({
  concluirMinhaTaskAction: (...args: unknown[]) => concluirMinhaTaskMock(...args),
  editarTaskAction: (...args: unknown[]) => editarTaskActionMock(...args),
  excluirTaskAction: (...args: unknown[]) => excluirTaskActionMock(...args),
  reabrirTaskAction: (...args: unknown[]) => reabrirTaskActionMock(...args),
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
  editarTaskActionMock.mockReset();
  excluirTaskActionMock.mockReset();
  reabrirTaskActionMock.mockReset();
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
    concluirMinhaTaskMock.mockResolvedValue({ ok: true });
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
      concluirMinhaTaskMock.mockResolvedValue({
        ok: false,
        erro: "Essa tarefa não existe mais ou não pertence a você. Atualize a página.",
      });
      render(<TaskList tasks={TAREFAS_TESTE} />);

      fireEvent.click(screen.getAllByRole("button", { name: "Concluir" })[0]);

      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toMatch(/não pertence a você/);
      });
      expect(screen.getByText("Ligar pro fornecedor")).toBeTruthy();
    }
  );

  // ─── O teste que a unificação existe para não quebrar ─────────────────
  //
  // A recusa do servidor deixou de chegar como EXCEÇÃO e passou a chegar como
  // `{ ok: false }`. Um `handleConcluir` que só olhasse o `catch` desfaria o
  // teste acima; um que só olhasse o resultado desfaria este. Os dois precisam
  // reinserir a tarefa, porque o desfecho de não reinserir é o pior que existe
  // nesta tela: a tarefa some da lista e continua pendente no banco, e quem
  // clicou vai embora achando que resolveu.
  it(
    "falha de REDE (a action nem chega a responder) também reinsere a tarefa — " +
      "'não lança' é promessa do código do servidor, não do transporte",
    async () => {
      concluirMinhaTaskMock.mockRejectedValue(new TypeError("Failed to fetch"));
      render(<TaskList tasks={TAREFAS_TESTE} />);

      fireEvent.click(screen.getAllByRole("button", { name: "Concluir" })[0]);

      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toMatch(/falar com o servidor/i);
      });
      expect(screen.getByText("Ligar pro fornecedor")).toBeTruthy();
    }
  );

  it("botão 'Dispensar' limpa a mensagem de erro sem afetar a lista", async () => {
    concluirMinhaTaskMock.mockResolvedValue({ ok: false, erro: "Tarefa não encontrada" });
    render(<TaskList tasks={TAREFAS_TESTE} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Concluir" })[0]);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Dispensar" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("TaskList — tarefa de outra pessoa (seção 'Tarefas' de /leads/[id], fix round 1/5)", () => {
  const TAREFAS_MISTAS = [
    {
      id: "task-minha",
      titulo: "Minha tarefa",
      vencimento: new Date("2026-08-05T00:00:00.000Z"),
      responsavelNome: "Ana Vendedora",
      souResponsavel: true,
    },
    {
      id: "task-do-colega",
      titulo: "Ligar para Fernanda às 15h",
      vencimento: new Date("2026-08-06T00:00:00.000Z"),
      responsavelNome: "Bruno Vendedor",
      souResponsavel: false,
    },
  ];

  it("tarefa própria (souResponsavel: true) mostra 'Você' no subtítulo e o botão 'Concluir'", () => {
    render(<TaskList tasks={TAREFAS_MISTAS} />);

    const linhaPropria = screen.getByText("Minha tarefa").closest("li")!;
    expect(linhaPropria.textContent).toMatch(/Você/);
    expect(
      Array.from(linhaPropria.querySelectorAll("button")).some((b) => b.textContent === "Concluir")
    ).toBe(true);
  });

  it(
    "tarefa de outra pessoa (souResponsavel: false) mostra o nome do dono no subtítulo e NÃO " +
      "renderiza nenhum botão 'Concluir' — o bug que este fix corrige: um botão que aparece " +
      "igual para todo mundo e falha silenciosamente com 'Tarefa não encontrada' pra quem " +
      "clica sem ser dono",
    () => {
      render(<TaskList tasks={TAREFAS_MISTAS} />);

      const linhaDoColega = screen.getByText("Ligar para Fernanda às 15h").closest("li")!;
      expect(linhaDoColega.textContent).toMatch(/Bruno Vendedor/);
      expect(linhaDoColega.textContent).not.toMatch(/Você/);
      expect(linhaDoColega.querySelector("button")).toBeNull();
    }
  );

  it("tarefa de outra pessoa continua visível (não é filtrada) — o próprio ponto do fix", () => {
    render(<TaskList tasks={TAREFAS_MISTAS} />);
    expect(screen.getByText("Ligar para Fernanda às 15h")).toBeTruthy();
  });

  it("clicar no botão de UMA tarefa própria nunca afeta a tarefa do colega ao lado", async () => {
    concluirMinhaTaskMock.mockResolvedValue({ ok: true });
    render(<TaskList tasks={TAREFAS_MISTAS} />);

    fireEvent.click(screen.getByRole("button", { name: "Concluir" }));

    await waitFor(() => expect(screen.queryByText("Minha tarefa")).toBeNull());
    expect(screen.getByText("Ligar para Fernanda às 15h")).toBeTruthy();
    expect(concluirMinhaTaskMock).toHaveBeenCalledWith("task-minha");
  });

  it("`/tasks` (souResponsavel undefined, todas as tarefas já são do próprio usuário): sempre mostra o botão, sem 'Você' redundante em cada linha", () => {
    render(<TaskList tasks={TAREFAS_TESTE} />);

    const linha = screen.getByText("Ligar pro fornecedor").closest("li")!;
    expect(linha.querySelector("button")?.textContent).toBe("Concluir");
    expect(linha.textContent).not.toMatch(/Você/);
  });
});
