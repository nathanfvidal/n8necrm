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

// O que é mockado aqui é o ESCOPO, não o `prisma` cru, e a troca é do Ciclo
// 1d: `gravarLinhaDeAuditoria` deixou de resolver a empresa por
// `companyIdDoUsuario` (que exigia um mock de `membership.findFirstOrThrow`) e
// passou a escrever por `prismaDaEmpresa(params.companyId)`. Mockar `@/lib/prisma`
// não bastaria mais — o escopo chama `$extends` nele —, e mockar o escopo tem
// um ganho: `escoparMock` REGISTRA com que empresa a linha foi gravada, que é a
// coisa nova que este arquivo passa a poder afirmar.
const auditLogCreateMock = vi.fn();
const escoparMock = vi.fn(() => ({
  auditLog: { create: (...args: unknown[]) => auditLogCreateMock(...args) },
}));
vi.mock("@/core/tenancy/escopo", () => ({
  prismaDaEmpresa: (...args: unknown[]) => escoparMock(...(args as [])),
}));

const avaliarMock = vi.fn();
vi.mock("@/core/audit/alerta", () => ({
  avaliarAtividadeSuspeita: (...args: unknown[]) => avaliarMock(...args),
}));

const { registrarAuditoria } = await import("../../src/core/audit/log");

beforeEach(() => {
  auditLogCreateMock.mockReset().mockResolvedValue(undefined);
  escoparMock.mockClear();
  avaliarMock.mockReset().mockResolvedValue(undefined);
});

describe("registrarAuditoria — gancho da deteccao de rajada", () => {
  it("avalia toda acao auditada, passando autor e acao", async () => {
    await registrarAuditoria({
      companyId: "empresa-1",
      userId: "user-1",
      acao: "excluir_task",
      entidade: "Task",
      entidadeId: "task-1",
    });

    expect(avaliarMock).toHaveBeenCalledTimes(1);
    expect(avaliarMock).toHaveBeenCalledWith({
      companyId: "empresa-1",
      userId: "user-1",
      acao: "excluir_task",
    });
  });

  // A empresa da LINHA vem do parâmetro, e não de uma dedução a partir do
  // autor. Sem este caso, trocar `params.companyId` de volta por uma consulta a
  // `Membership` passaria despercebido aqui.
  it("escopa a gravacao na empresa que veio nos params", async () => {
    await registrarAuditoria({
      companyId: "empresa-2",
      userId: "user-1",
      acao: "excluir_task",
      entidade: "Task",
      entidadeId: "task-1",
    });

    expect(escoparMock).toHaveBeenCalledWith("empresa-2");
    expect(auditLogCreateMock.mock.calls[0]![0]).toMatchObject({
      data: { companyId: "empresa-2" },
    });
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
      companyId: "empresa-1",
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
        companyId: "empresa-1",
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
        companyId: "empresa-1",
        userId: "user-1",
        acao: "excluir_task",
        entidade: "Task",
        entidadeId: "task-1",
      })
    ).rejects.toThrow("falha de escrita");

    expect(avaliarMock).not.toHaveBeenCalled();
  });
});
