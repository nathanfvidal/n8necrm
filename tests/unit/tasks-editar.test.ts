import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  task: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  // `findFirst`, e nao `findUnique`: a checagem de `leadId` passou a exigir
  // que o lead seja da empresa da tarefa (`exigirLeadDaEmpresa`,
  // `tasks/service.ts`), e `companyId` nao e chave unica em `Lead` — nao ha
  // `findUnique` que o aceite no `where`.
  lead: { findFirst: vi.fn() },
}));
const auditoriaMock = vi.hoisted(() => vi.fn());

// `tasks/service.ts` tem `import "server-only"`, que lança fora do pipeline
// de build do Next. Mesmo no-op dos outros testes deste diretório.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/core/audit/log", () => ({ registrarAuditoria: auditoriaMock }));

import { editarTask, excluirTask } from "../../src/core/tasks/service";

// `companyId` NAO e enfeite: `editarTask` o usa como escopo da checagem de
// `leadId`. Um mock sem ele mandaria `companyId: undefined` para o `where`, o
// Prisma omitiria o filtro, e o caso abaixo ("confere a EMPRESA") ficaria
// verde sobre um servico que nao confere empresa nenhuma — o mesmo defeito de
// mock que `export-leads.test.ts` tinha (relatorio da Task 4, § 12).
const TASK = {
  id: "task-1",
  companyId: "empresa-1",
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
  prismaMock.lead.findFirst.mockResolvedValue({ id: "lead-1" });
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
    prismaMock.lead.findFirst.mockResolvedValue(null);
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

  // O que um banco falso PODE provar: que o filtro de empresa chega ao
  // `where`, e que ele vem da PRÓPRIA tarefa. Que o isolamento funciona de
  // verdade é outra pergunta, e a resposta mora em
  // `tests/unit/task-isolamento.test.ts` — banco real, duas empresas.
  it("consulta o lead com o companyId da PRÓPRIA tarefa, nunca só pelo id", async () => {
    await editarTask({
      taskId: "task-1",
      titulo: "x",
      vencimento: VENCIMENTO,
      leadId: "lead-1",
      autorId: "user-1",
    });

    expect(prismaMock.lead.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "lead-1", companyId: "empresa-1" } })
    );
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
