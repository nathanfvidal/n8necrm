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

// `revalidatePath` lança fora do pipeline do Next ("static generation store
// missing"). O mock é obrigatório — mas um no-op puro deixaria o teste verde
// sem provar nada, então as chamadas são CAPTURADAS e viram asserção abaixo.
const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

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
  revalidatePathMock.mockReset();
});

// Criar e concluir não invalidavam o cache de rota — só editar e excluir. O
// efeito prático não era teórico: `router.refresh()` no formulário conserta a
// aba de quem agiu, e todo o resto (a mesma pessoa em outra aba, o contador
// do painel) continuava servindo a página em cache, sem a tarefa nova.
// Correção do achado R2 da auditoria da branch. O valor de retorno de uma
// Server Action é SERIALIZADO para o navegador: devolver `Task` mandava a
// linha inteira (`responsavelId`, `contactId`, `criadoEm`) para chamadores
// que descartam o retorno. Era a tarefa do próprio usuário, então não vazava
// entre pessoas — mas é o mesmo padrão que produziu o vazamento do funil.
describe("nada da linha do banco atravessa a fronteira", () => {
  it("criar não devolve a tarefa ao navegador", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake());
    criarTaskMock.mockResolvedValue(taskFake({ responsavelId: "segredo" }));

    const devolvido = await criarMinhaTask({
      titulo: "Ligar",
      vencimento: new Date("2026-08-05T00:00:00.000Z"),
    });

    expect(devolvido).toBeUndefined();
  });

  it("concluir não devolve a tarefa, mas ainda lê o leadId dela por dentro", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake());
    concluirTaskMock.mockResolvedValue(taskFake({ leadId: "lead-7" }));

    const devolvido = await concluirMinhaTask("task-1");

    expect(devolvido).toBeUndefined();
    // A linha continua sendo lida no servidor — é de lá que sai a rota do
    // lead a invalidar. O que mudou é ela não sair de lá.
    expect(revalidatePathMock).toHaveBeenCalledWith("/leads/lead-7");
  });
});

describe("invalidação de cache", () => {
  it("criar invalida /tasks e o painel", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake());
    criarTaskMock.mockResolvedValue(taskFake());

    await criarMinhaTask({ titulo: "Ligar", vencimento: new Date("2026-08-05T00:00:00.000Z") });

    expect(revalidatePathMock).toHaveBeenCalledWith("/tasks");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
  });

  it("criar com lead invalida também a página daquele lead", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake());
    criarTaskMock.mockResolvedValue(taskFake({ leadId: "lead-9" }));

    await criarMinhaTask({
      titulo: "Ligar",
      vencimento: new Date("2026-08-05T00:00:00.000Z"),
      leadId: "lead-9",
    });

    expect(revalidatePathMock).toHaveBeenCalledWith("/leads/lead-9");
  });

  it("concluir invalida /tasks e o painel", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake());
    concluirTaskMock.mockResolvedValue(taskFake({ concluidaEm: new Date() }));

    await concluirMinhaTask("task-1");

    expect(revalidatePathMock).toHaveBeenCalledWith("/tasks");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
  });

  // O `leadId` vem da tarefa DEVOLVIDA pelo serviço, não de um argumento —
  // `concluirMinhaTask` só recebe o id. Sem isso, concluir uma tarefa a
  // partir de `/tasks` deixaria a página do lead vinculado com cache velho.
  it("concluir invalida a página do lead lendo o vínculo da tarefa devolvida", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake());
    concluirTaskMock.mockResolvedValue(taskFake({ leadId: "lead-7" }));

    await concluirMinhaTask("task-1");

    expect(revalidatePathMock).toHaveBeenCalledWith("/leads/lead-7");
  });
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
