// O gancho entre `registrarAuditoria` e a detecção de rajada destrutiva.
//
// Unidade pura (Prisma e detector mockados): o que está sendo provado aqui
// não é a detecção — isso é `alerta-atividade.test.ts`, contra o banco real —
// e sim a LIGAÇÃO e, sobretudo, a DIREÇÃO DA FALHA. `registrarAuditoria` é
// chamada de dentro de operações que o usuário disparou (excluir tarefa,
// arquivar lead); se um erro do alerta subisse por aqui, um problema de
// notificação viraria perda de trabalho de quem estava usando o sistema.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const auditLogCreateMock = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { auditLog: { create: (...args: unknown[]) => auditLogCreateMock(...args) } },
}));

const avaliarMock = vi.fn();
vi.mock("@/core/audit/alerta", () => ({
  avaliarAtividadeSuspeita: (...args: unknown[]) => avaliarMock(...args),
}));

const { registrarAuditoria } = await import("../../src/core/audit/log");

beforeEach(() => {
  auditLogCreateMock.mockReset().mockResolvedValue(undefined);
  avaliarMock.mockReset().mockResolvedValue(undefined);
});

describe("registrarAuditoria — gancho da deteccao de rajada", () => {
  it("avalia toda acao auditada, passando autor e acao", async () => {
    await registrarAuditoria({
      userId: "user-1",
      acao: "excluir_task",
      entidade: "Task",
      entidadeId: "task-1",
    });

    expect(avaliarMock).toHaveBeenCalledTimes(1);
    expect(avaliarMock).toHaveBeenCalledWith({ userId: "user-1", acao: "excluir_task" });
  });

  it("a avaliacao acontece DEPOIS da gravacao do log — o registro nunca depende do alerta", async () => {
    const ordem: string[] = [];
    auditLogCreateMock.mockImplementation(async () => {
      ordem.push("log");
    });
    avaliarMock.mockImplementation(async () => {
      ordem.push("alerta");
    });

    await registrarAuditoria({
      userId: "user-1",
      acao: "excluir_nota",
      entidade: "LeadNote",
      entidadeId: "nota-1",
    });

    expect(ordem).toEqual(["log", "alerta"]);
  });

  // Falha ENGOLIDA aqui, ao contrário do fail-closed da exportação de leads:
  // lá o log ERA o registro da operação, então sem ele a operação não podia
  // acontecer. Aqui o registro já foi gravado na linha de cima — o alerta é
  // um extra em cima dele.
  it("erro na avaliacao NAO derruba a operacao do usuario", async () => {
    avaliarMock.mockRejectedValue(new Error("banco indisponivel"));

    await expect(
      registrarAuditoria({
        userId: "user-1",
        acao: "arquivar_lead",
        entidade: "Lead",
        entidadeId: "lead-1",
      })
    ).resolves.toBeUndefined();

    expect(auditLogCreateMock).toHaveBeenCalledTimes(1);
  });

  // O outro lado: falha ao GRAVAR o log continua subindo. O log é o registro,
  // e uma exclusão que não deixou rastro é exatamente o que a decisão do dono
  // do projeto ("tem que ter a log de apagar") existe para impedir.
  it("erro ao GRAVAR o log continua subindo, e o alerta nem e avaliado", async () => {
    auditLogCreateMock.mockRejectedValue(new Error("falha de escrita"));

    await expect(
      registrarAuditoria({
        userId: "user-1",
        acao: "excluir_task",
        entidade: "Task",
        entidadeId: "task-1",
      })
    ).rejects.toThrow("falha de escrita");

    expect(avaliarMock).not.toHaveBeenCalled();
  });
});
