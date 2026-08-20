import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  task: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  lead: { findUnique: vi.fn() },
  // `findFirst`, e não `findUnique`: desde o reparo de tenancy de 2026-08-20
  // a checagem de contato soma `companyId` ao `where` (`exigirContatoDaEmpresa`),
  // e `findUnique` não aceita filtro fora da chave única.
  contact: { findFirst: vi.fn() },
  // `criarTask` resolve `Task.companyId` (NOT NULL desde a Task 1 do Ciclo
  // 1a) via `companyIdDoUsuario(responsavelId)`, que consulta `Membership`.
  membership: { findFirstOrThrow: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/core/audit/log", () => ({ registrarAuditoria: vi.fn() }));

import { criarTask, editarTask } from "../../src/core/tasks/service";

const VENCIMENTO = new Date(Date.UTC(2026, 7, 20));
const TASK = {
  id: "task-1",
  // `editarTask` tira daqui a empresa contra a qual `leadId` e `contactId` são
  // conferidos — é a empresa da PRÓPRIA tarefa, não a de quem edita.
  companyId: "empresa-1",
  responsavelId: "user-1",
  titulo: "original",
  leadId: null,
  contactId: null,
  vencimento: VENCIMENTO,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.task.findUnique.mockResolvedValue(TASK);
  prismaMock.task.create.mockImplementation(({ data }) => ({ ...TASK, ...data }));
  prismaMock.task.update.mockImplementation(({ data }) => ({ ...TASK, ...data }));
  prismaMock.lead.findUnique.mockResolvedValue({ id: "lead-1" });
  prismaMock.contact.findFirst.mockResolvedValue({ id: "contato-1" });
  prismaMock.membership.findFirstOrThrow.mockResolvedValue({ companyId: "empresa-1" });
});

describe("criarTask com contato", () => {
  it("grava o vínculo quando o contato existe", async () => {
    await criarTask({
      titulo: "Ligar",
      vencimento: VENCIMENTO,
      responsavelId: "user-1",
      contactId: "contato-1",
    });

    // O `companyId` no `where` É a asserção — sem ele, um `contactId` forjado
    // de outra empresa passava.
    expect(prismaMock.contact.findFirst).toHaveBeenCalledWith({
      where: { id: "contato-1", companyId: "empresa-1" },
      select: { id: true },
    });
    expect(prismaMock.task.create.mock.calls[0][0].data.contactId).toBe("contato-1");
  });

  // Sem esta checagem o Prisma estouraria P2003 (violação de FK) e a pessoa
  // leria "Falha ao salvar a tarefa" — mesmo raciocínio da checagem de
  // `leadId`, que já existia.
  it("recusa contato inexistente ANTES de escrever, com mensagem acionável", async () => {
    prismaMock.contact.findFirst.mockResolvedValue(null);

    await expect(
      criarTask({
        titulo: "Ligar",
        vencimento: VENCIMENTO,
        responsavelId: "user-1",
        contactId: "fantasma",
      })
    ).rejects.toThrow(/^Contato não encontrado: "fantasma"/);

    expect(prismaMock.task.create).not.toHaveBeenCalled();
  });

  it("sem contato, não consulta a tabela de contatos à toa", async () => {
    await criarTask({ titulo: "Ligar", vencimento: VENCIMENTO, responsavelId: "user-1" });
    expect(prismaMock.contact.findFirst).not.toHaveBeenCalled();
  });

  // Ao CRIAR, `null` e ausente significam a mesma coisa. Gravar `null`
  // explícito funcionaria, mas normalizar mantém o `data` do create limpo e
  // deixa a assimetria com `editarTask` (onde `null` É uma ordem) visível.
  it("null ao criar é o mesmo que sem contato", async () => {
    await criarTask({
      titulo: "Ligar",
      vencimento: VENCIMENTO,
      responsavelId: "user-1",
      contactId: null,
    });
    expect(prismaMock.task.create.mock.calls[0][0].data.contactId).toBeUndefined();
  });
});

describe("editarTask com contato", () => {
  it("vincula um contato à tarefa", async () => {
    await editarTask({
      taskId: "task-1",
      titulo: "Ligar",
      vencimento: VENCIMENTO,
      contactId: "contato-1",
      autorId: "user-1",
    });

    expect(prismaMock.task.update.mock.calls[0][0].data.contactId).toBe("contato-1");
  });

  // A distinção que erra em silêncio: campo AUSENTE é "não mexa no vínculo",
  // `null` é "tire o vínculo". Colapsar os dois faria toda edição de título
  // apagar o contato sem ninguém pedir.
  it("campo ausente NÃO mexe no vínculo existente", async () => {
    await editarTask({
      taskId: "task-1",
      titulo: "so o titulo",
      vencimento: VENCIMENTO,
      autorId: "user-1",
    });

    expect("contactId" in prismaMock.task.update.mock.calls[0][0].data).toBe(false);
  });

  it("null desvincula de verdade", async () => {
    await editarTask({
      taskId: "task-1",
      titulo: "Ligar",
      vencimento: VENCIMENTO,
      contactId: null,
      autorId: "user-1",
    });

    expect(prismaMock.task.update.mock.calls[0][0].data.contactId).toBeNull();
  });

  it("recusa contato inexistente ANTES de escrever", async () => {
    prismaMock.contact.findFirst.mockResolvedValue(null);

    await expect(
      editarTask({
        taskId: "task-1",
        titulo: "Ligar",
        vencimento: VENCIMENTO,
        contactId: "fantasma",
        autorId: "user-1",
      })
    ).rejects.toThrow(/^Contato não encontrado/);

    expect(prismaMock.task.update).not.toHaveBeenCalled();
  });

  it("descrição longa demais é recusada antes de tocar no banco", async () => {
    await expect(
      editarTask({
        taskId: "task-1",
        titulo: "Ligar",
        descricao: "x".repeat(2001),
        vencimento: VENCIMENTO,
        autorId: "user-1",
      })
    ).rejects.toThrow(/^Descrição longa demais/);

    expect(prismaMock.task.update).not.toHaveBeenCalled();
  });
});
