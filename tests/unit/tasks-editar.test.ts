import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  task: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  lead: { findUnique: vi.fn() },
}));
const auditoriaMock = vi.hoisted(() => vi.fn());

// `tasks/service.ts` tem `import "server-only"`, que lança fora do pipeline
// de build do Next. Mesmo no-op dos outros testes deste diretório.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/core/audit/log", () => ({ registrarAuditoria: auditoriaMock }));

import { editarTask, excluirTask } from "../../src/core/tasks/service";

const TASK = {
  id: "task-1",
  responsavelId: "user-1",
  titulo: "original",
  leadId: null,
  vencimento: new Date(Date.UTC(2026, 7, 20)),
};
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

  // Decisão do dono do projeto, tomada na auditoria de segurança desta
  // branch: excluir é a única operação de tarefa que destrói a linha para
  // sempre. Sem rastro, alguém que queira sabotar a empresa apaga os
  // lembretes da equipe e não sobra nada que mostre o que existia.
  // `editarTask` continua SEM auditoria — só a exclusão mudou de regra.
  it("audita a exclusao guardando o que foi destruido", async () => {
    await excluirTask({ taskId: "task-1", autorId: "user-1" });

    expect(auditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        acao: "excluir_task",
        entidade: "Task",
        entidadeId: "task-1",
        antes: expect.objectContaining({ titulo: "original" }),
      })
    );
  });

  it("nao audita quando a exclusao e recusada", async () => {
    await expect(excluirTask({ taskId: "task-1", autorId: "user-2" })).rejects.toThrow();
    expect(auditoriaMock).not.toHaveBeenCalled();
  });

  it("NAO audita edicao — so exclusao mudou de regra", async () => {
    await editarTask({
      taskId: "task-1",
      titulo: "corrigido",
      vencimento: VENCIMENTO,
      autorId: "user-1",
    });
    expect(auditoriaMock).not.toHaveBeenCalled();
  });

  it("recusa a tarefa de outra pessoa", async () => {
    await expect(excluirTask({ taskId: "task-1", autorId: "user-2" })).rejects.toThrow(
      "Tarefa não encontrada"
    );
    expect(prismaMock.task.delete).not.toHaveBeenCalled();
  });
});
