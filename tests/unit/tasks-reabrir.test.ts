import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  task: { findUnique: vi.fn(), update: vi.fn() },
}));
const auditoriaMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/core/audit/log", () => ({ registrarAuditoria: auditoriaMock }));

import { reabrirTask } from "../../src/core/tasks/service";

const CONCLUIDA = {
  id: "task-1",
  responsavelId: "user-1",
  titulo: "Ligar para a Fernanda",
  leadId: null,
  contactId: null,
  concluidaEm: new Date(Date.UTC(2026, 7, 10)),
  vencimento: new Date(Date.UTC(2026, 7, 20)),
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.task.findUnique.mockResolvedValue(CONCLUIDA);
  prismaMock.task.update.mockImplementation(({ data }) => ({ ...CONCLUIDA, ...data }));
});

describe("reabrirTask", () => {
  it("apaga a data de conclusão, devolvendo a tarefa para as pendentes", async () => {
    const devolvida = await reabrirTask({ taskId: "task-1", autorId: "user-1" });

    expect(prismaMock.task.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { concluidaEm: null },
    });
    expect(devolvida.concluidaEm).toBeNull();
  });

  // Mesma regra de dono de `concluirTask`/`editarTask`/`excluirTask`. Sem
  // ela, qualquer usuário autenticado reabriria a tarefa de um colega com um
  // id adivinhado — `cuid()` não impede ninguém de tentar ids vizinhos aos
  // que já viu na própria lista.
  it("recusa reabrir tarefa de outra pessoa", async () => {
    await expect(reabrirTask({ taskId: "task-1", autorId: "intruso" })).rejects.toThrow(
      "Tarefa não encontrada"
    );
    expect(prismaMock.task.update).not.toHaveBeenCalled();
  });

  it("recusa id inexistente com a MESMA mensagem de tarefa alheia", async () => {
    prismaMock.task.findUnique.mockResolvedValue(null);

    // Mensagens diferentes confirmariam, a quem está adivinhando ids, que
    // aquele id existe e pertence a alguém — mesmo sem revelar a quem.
    await expect(reabrirTask({ taskId: "nao-existe", autorId: "user-1" })).rejects.toThrow(
      "Tarefa não encontrada"
    );
  });

  // Trava de escopo, no mesmo espírito de `tasks-editar.test.ts`: excluir é a
  // ÚNICA operação de tarefa que audita, porque é a única irreversível.
  // Reabrir se desfaz com um clique em "Concluir"; auditar aqui encheria
  // `AuditLog` de ruído e afogaria o registro que existe para investigar
  // sabotagem.
  it("NÃO audita — reabrir é reversível", async () => {
    await reabrirTask({ taskId: "task-1", autorId: "user-1" });
    expect(auditoriaMock).not.toHaveBeenCalled();
  });

  // Duas abas abertas, dois cliques. O segundo não pode virar mensagem de
  // falha para uma ação cujo efeito desejado já está no lugar.
  it("é idempotente: reabrir tarefa já pendente não é erro", async () => {
    prismaMock.task.findUnique.mockResolvedValue({ ...CONCLUIDA, concluidaEm: null });

    await expect(reabrirTask({ taskId: "task-1", autorId: "user-1" })).resolves.toBeTruthy();
    expect(prismaMock.task.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { concluidaEm: null },
    });
  });

  it("não mexe em nada além da conclusão", async () => {
    await reabrirTask({ taskId: "task-1", autorId: "user-1" });

    const { data } = prismaMock.task.update.mock.calls[0][0];
    // Reabrir não é editar: título, vencimento e vínculos ficam como estavam.
    expect(Object.keys(data)).toEqual(["concluidaEm"]);
  });
});
