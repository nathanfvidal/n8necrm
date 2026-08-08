import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  task: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  lead: { findUnique: vi.fn() },
}));

// `tasks/service.ts` tem `import "server-only"`, que lança fora do pipeline
// de build do Next. Mesmo no-op dos outros testes deste diretório.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { editarTask, excluirTask } from "../../src/core/tasks/service";

const TASK = { id: "task-1", responsavelId: "user-1", titulo: "original", leadId: null };
const VENCIMENTO = new Date(Date.UTC(2026, 7, 20));

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.task.findUnique.mockResolvedValue(TASK);
  prismaMock.task.update.mockImplementation(({ data }) => ({ ...TASK, ...data }));
  prismaMock.lead.findUnique.mockResolvedValue({ id: "lead-1" });
});

describe("editarTask", () => {
  it("grava titulo, descricao e vencimento", async () => {
    await editarTask({
      taskId: "task-1",
      titulo: "  corrigido  ",
      descricao: "  detalhe  ",
      vencimento: VENCIMENTO,
      autorId: "user-1",
    });

    const dados = prismaMock.task.update.mock.calls[0][0].data;
    expect(dados.titulo).toBe("corrigido");
    expect(dados.descricao).toBe("detalhe");
    expect(dados.vencimento).toBe(VENCIMENTO);
  });

  it("recusa quem nao e o dono, com a mesma mensagem de inexistente", async () => {
    await expect(
      editarTask({ taskId: "task-1", titulo: "x", vencimento: VENCIMENTO, autorId: "user-2" })
    ).rejects.toThrow("Tarefa não encontrada");
    expect(prismaMock.task.update).not.toHaveBeenCalled();
  });

  it("recusa titulo vazio", async () => {
    await expect(
      editarTask({ taskId: "task-1", titulo: "   ", vencimento: VENCIMENTO, autorId: "user-1" })
    ).rejects.toThrow(/Título obrigatório/);
  });

  it("recusa vencimento invalido", async () => {
    await expect(
      editarTask({
        taskId: "task-1",
        titulo: "x",
        vencimento: new Date("nao-e-data"),
        autorId: "user-1",
      })
    ).rejects.toThrow(/Vencimento inválido/);
  });

  it("recusa lead inexistente com erro de dominio", async () => {
    prismaMock.lead.findUnique.mockResolvedValue(null);
    await expect(
      editarTask({
        taskId: "task-1",
        titulo: "x",
        vencimento: VENCIMENTO,
        leadId: "fantasma",
        autorId: "user-1",
      })
    ).rejects.toThrow(/Lead não encontrado/);
  });

  it("aceita null em leadId para desvincular", async () => {
    await editarTask({
      taskId: "task-1",
      titulo: "x",
      vencimento: VENCIMENTO,
      leadId: null,
      autorId: "user-1",
    });
    expect(prismaMock.task.update.mock.calls[0][0].data.leadId).toBeNull();
  });
});

describe("excluirTask", () => {
  it("apaga a propria tarefa", async () => {
    await excluirTask({ taskId: "task-1", autorId: "user-1" });
    expect(prismaMock.task.delete).toHaveBeenCalledWith({ where: { id: "task-1" } });
  });

  it("recusa a tarefa de outra pessoa", async () => {
    await expect(excluirTask({ taskId: "task-1", autorId: "user-2" })).rejects.toThrow(
      "Tarefa não encontrada"
    );
    expect(prismaMock.task.delete).not.toHaveBeenCalled();
  });
});
