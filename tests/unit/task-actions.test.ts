// Teste de unidade puro (sem Prisma real, sem `dotenv/config`): cobre só a
// derivação de autor de `actions.ts` — mesmo raciocínio de
// lead-actions.test.ts (Task 13/17). `usuarioAtual()` e `service.ts` são
// mockados diretamente, então este arquivo prova o contrato de segurança
// (Task 13/18: `responsavelId`/`autorId` SEMPRE vêm de `usuarioAtual()`,
// NUNCA de um argumento de input) sem depender de sessão HTTP nem de banco.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { User, Task } from "@prisma/client";

const usuarioAtualMock = vi.fn();
vi.mock("@/core/auth/session", () => ({ usuarioAtual: () => usuarioAtualMock() }));

const criarTaskMock = vi.fn();
const concluirTaskMock = vi.fn();
vi.mock("@/core/tasks/service", () => ({
  criarTask: (...args: unknown[]) => criarTaskMock(...args),
  concluirTask: (...args: unknown[]) => concluirTaskMock(...args),
}));

const { criarMinhaTask, concluirMinhaTask } = await import("../../src/core/tasks/actions");

function usuarioFake(overrides: Partial<User> = {}): User {
  return {
    id: "usuario-fake-id",
    nome: "Usuário Fake",
    email: "fake@teste.local",
    senhaHash: "hash",
    papel: "VENDEDOR",
    ativo: true,
    criadoEm: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function taskFake(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-fake-id",
    titulo: "Tarefa fake",
    descricao: null,
    vencimento: new Date("2026-08-05T00:00:00.000Z"),
    concluidaEm: null,
    responsavelId: "usuario-fake-id",
    leadId: null,
    contactId: null,
    criadoEm: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  usuarioAtualMock.mockReset();
  criarTaskMock.mockReset();
  concluirTaskMock.mockReset();
});

describe("criarMinhaTask", () => {
  it("deriva responsavelId da sessão — o input nunca tem esse campo para começo de conversa", async () => {
    const vendedor = usuarioFake({ id: "vendedor-1" });
    usuarioAtualMock.mockResolvedValue(vendedor);
    criarTaskMock.mockResolvedValue(taskFake({ responsavelId: "vendedor-1" }));

    await criarMinhaTask({ titulo: "Ligar", vencimento: new Date("2026-08-05T00:00:00.000Z") });

    expect(criarTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ responsavelId: "vendedor-1", titulo: "Ligar" })
    );
  });

  it("propaga leadId ao service quando informado (vínculo com a página de detalhe do lead)", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake());
    criarTaskMock.mockResolvedValue(taskFake({ leadId: "lead-1" }));

    await criarMinhaTask({
      titulo: "Follow-up",
      vencimento: new Date("2026-08-05T00:00:00.000Z"),
      leadId: "lead-1",
    });

    expect(criarTaskMock).toHaveBeenCalledWith(expect.objectContaining({ leadId: "lead-1" }));
  });

  it("propaga 'Não autenticado' sem chamar o service quando usuarioAtual rejeita", async () => {
    usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));

    await expect(
      criarMinhaTask({ titulo: "X", vencimento: new Date("2026-08-05T00:00:00.000Z") })
    ).rejects.toThrow("Não autenticado");

    expect(criarTaskMock).not.toHaveBeenCalled();
  });
});

describe("concluirMinhaTask", () => {
  it("deriva autorId da sessão — a assinatura só aceita taskId, nada de autor vindo do cliente", async () => {
    const vendedor = usuarioFake({ id: "vendedor-2" });
    usuarioAtualMock.mockResolvedValue(vendedor);
    concluirTaskMock.mockResolvedValue(taskFake({ responsavelId: "vendedor-2" }));

    await concluirMinhaTask("task-1");

    expect(concluirTaskMock).toHaveBeenCalledWith({ taskId: "task-1", autorId: "vendedor-2" });
  });

  it(
    "propaga 'Tarefa não encontrada' quando o service rejeita — o caso de alguém tentando " +
      "concluir a tarefa de outra pessoa (checagem real fica em concluirTask, service.ts)",
    async () => {
      usuarioAtualMock.mockResolvedValue(usuarioFake());
      concluirTaskMock.mockRejectedValue(new Error("Tarefa não encontrada"));

      await expect(concluirMinhaTask("task-de-outro-usuario")).rejects.toThrow("Tarefa não encontrada");
    }
  );

  it("propaga 'Não autenticado' sem chamar o service quando usuarioAtual rejeita", async () => {
    usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));

    await expect(concluirMinhaTask("task-1")).rejects.toThrow("Não autenticado");

    expect(concluirTaskMock).not.toHaveBeenCalled();
  });
});
