// Prova a regra de dono contra o POSTGRES DE VERDADE, não contra mock.
//
// Achado da auditoria de segurança desta branch: `editarNota`, `excluirNota`,
// `editarTask` e `excluirTask` recusam quem não é o dono, e a sabotagem
// confirmou que os testes exercitam a checagem — mas TODOS eles rodavam
// contra `vi.mock("@/lib/prisma")`. Um mock prova que o `if` existe; não
// prova que a consulta real encontra a linha real e compara o campo certo.
// Um `findUnique` com o `where` errado passaria nos dois testes mockados.
//
// Aqui as linhas são criadas de fato, a recusa é exercida contra o banco, e
// o `afterAll` limpa tudo por prefixo — o banco é compartilhado com produção.
import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { editarNota, excluirNota } from "../../src/core/leads/notes";
import { criarLead } from "../../src/core/leads/service";
import { editarTask, excluirTask } from "../../src/core/tasks/service";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const MARCA = "ZZAuditoriaDono";
const TELEFONE = "11966664001";

let idDono = "";
let idIntruso = "";
let idLead = "";
let idNota = "";
let idTask = "";
// Hoisted para os casos: `editarTask`/`excluirTask` passaram a receber
// `companyId` no Ciclo 1d, e ele e o mesmo da fixture — dono e intruso estao na
// MESMA empresa aqui de proposito, para que o que barre o intruso seja a regra
// de DONO e nada mais.
let companyId = "";

async function limpar() {
  const contatos = await prisma.contact.findMany({
    where: { OR: [{ nome: { contains: MARCA } }, { telefone: TELEFONE }] },
    select: { id: true },
  });
  const ids = contatos.map((c) => c.id);
  const leads = await prisma.lead.findMany({
    where: { contactId: { in: ids } },
    select: { id: true },
  });
  const idsLeads = leads.map((l) => l.id);

  await prisma.auditLog.deleteMany({ where: { entidadeId: { in: [...idsLeads, idNota, idTask] } } });
  await prisma.task.deleteMany({ where: { leadId: { in: idsLeads } } });
  await prisma.leadNote.deleteMany({ where: { leadId: { in: idsLeads } } });
  await prisma.lead.deleteMany({ where: { id: { in: idsLeads } } });
  await prisma.contact.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { nome: { contains: MARCA } } });
}

beforeAll(async () => {
  await limpar();

  // Senha inerte: estas contas nunca fazem login. O hash é literal e não
  // corresponde a senha nenhuma — nada aqui passa por autenticação.
  const hashInerte = "$2b$10$invalidoinvalidoinvalidoinvalidoinvalidoinvalidoinvalidoinva";

  const dono = await prisma.user.create({
    data: {
      nome: `Dono ${MARCA}`,
      email: `dono-${MARCA.toLowerCase()}@teste.invalid`,
      senhaHash: hashInerte,
      ativo: false,
    },
  });
  const intruso = await prisma.user.create({
    data: {
      nome: `Intruso ${MARCA}`,
      email: `intruso-${MARCA.toLowerCase()}@teste.invalid`,
      senhaHash: hashInerte,
      ativo: false,
    },
  });
  idDono = dono.id;
  idIntruso = intruso.id;

  // Empresa única do Ciclo 1a (mesma suposição de `prisma/seed.ts`) — dono e
  // intruso pertencem à mesma empresa aqui de propósito: este arquivo prova
  // a regra de DONO (autor x autor), não a de tenancy (empresa x empresa) —
  // duas empresas diferentes tornariam o cenário ambíguo sobre qual regra
  // barrou o intruso.
  const empresa = await prisma.company.findFirstOrThrow();
  companyId = empresa.id;

  // OS DOIS precisam de `Membership`, e a lista cresceu no Ciclo 1a (Task 4).
  //
  // Antes só o dono precisava: `registrarAuditoria` resolvia a empresa por
  // `companyIdDoUsuario(autorId)`, e o intruso era recusado pela regra de dono
  // ANTES de chegar lá. Isso deixou de valer quando `editarNota`/`excluirNota`
  // (`core/leads/notes.ts`) passaram a resolver o ESCOPO como primeira coisa
  // que fazem — a busca da nota agora sai do cliente escopado, então a empresa
  // de quem age precisa existir antes de qualquer checagem de dono.
  //
  // Os dois na MESMA empresa, de propósito, e agora isso importa mais do que
  // importava: com o escopo em vigor, um intruso de OUTRA empresa seria
  // recusado pelo escopo, e os dois primeiros casos deste arquivo passariam
  // sem exercitar a regra de dono nenhuma vez — verdes pelo motivo errado. É
  // exatamente a armadilha que este arquivo foi criado para não repetir.
  await prisma.membership.createMany({
    data: [
      { userId: idDono, companyId, papel: "VENDEDOR" },
      { userId: idIntruso, companyId, papel: "VENDEDOR" },
    ],
  });

  const contato = await prisma.contact.create({
    data: { companyId, nome: `Cliente ${MARCA}`, telefone: TELEFONE },
  });
  const etapa = await prisma.pipelineStage.findFirstOrThrow({ orderBy: { ordem: "asc" } });
  const lead = await prisma.lead.create({
    data: {
      companyId,
      contactId: contato.id,
      stageId: etapa.id,
      responsavelId: idDono,
      canal: "MANUAL",
    },
  });
  idLead = lead.id;

  const nota = await prisma.leadNote.create({
    data: { companyId, leadId: idLead, autorId: idDono, texto: "texto original do dono" },
  });
  idNota = nota.id;

  const task = await prisma.task.create({
    data: {
      companyId,
      titulo: `Tarefa ${MARCA}`,
      vencimento: new Date(Date.UTC(2026, 11, 31)),
      responsavelId: idDono,
      leadId: idLead,
    },
  });
  idTask = task.id;
});

afterAll(async () => {
  await limpar();
  await prisma.$disconnect();
});

describe("regra de dono contra o banco real", () => {
  it("intruso NAO edita a nota de outra pessoa, e o texto fica intacto", async () => {
    await expect(
      editarNota({ notaId: idNota, texto: "invadido", autorId: idIntruso })
    ).rejects.toThrow("Nota não encontrada");

    const depois = await prisma.leadNote.findUniqueOrThrow({ where: { id: idNota } });
    expect(depois.texto).toBe("texto original do dono");
    expect(depois.editadoEm).toBeNull();
  });

  it("intruso NAO exclui a nota de outra pessoa, e a linha continua la", async () => {
    await expect(excluirNota({ notaId: idNota, autorId: idIntruso })).rejects.toThrow(
      "Nota não encontrada"
    );
    expect(await prisma.leadNote.count({ where: { id: idNota } })).toBe(1);
  });

  it("intruso NAO edita a tarefa de outra pessoa", async () => {
    await expect(
      editarTask({
        companyId,
        taskId: idTask,
        titulo: "invadido",
        vencimento: new Date(Date.UTC(2026, 11, 31)),
        autorId: idIntruso,
      })
    ).rejects.toThrow("Tarefa não encontrada");

    const depois = await prisma.task.findUniqueOrThrow({ where: { id: idTask } });
    expect(depois.titulo).toBe(`Tarefa ${MARCA}`);
  });

  it("intruso NAO exclui a tarefa de outra pessoa, e nao gera auditoria", async () => {
    await expect(excluirTask({ companyId, taskId: idTask, autorId: idIntruso })).rejects.toThrow(
      "Tarefa não encontrada"
    );
    expect(await prisma.task.count({ where: { id: idTask } })).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { entidadeId: idTask, acao: "excluir_task" } })
    ).toBe(0);
  });

  // O outro lado da moeda: se o dono também fosse recusado, os testes acima
  // passariam por um motivo errado (uma consulta quebrada recusa todo mundo).
  it("o DONO edita a propria nota, e ela fica marcada como editada", async () => {
    await editarNota({ notaId: idNota, texto: "corrigido pelo dono", autorId: idDono });

    const depois = await prisma.leadNote.findUniqueOrThrow({ where: { id: idNota } });
    expect(depois.texto).toBe("corrigido pelo dono");
    expect(depois.editadoEm).toBeInstanceOf(Date);
  });

  // Criar e editar passaram a concordar na auditoria: os dois recusam entregar
  // um lead a quem não consegue mais entrar no sistema. `idDono` é criado com
  // `ativo: false` neste arquivo, então serve de cobaia.
  //
  // A recusa acontece ANTES de `encontrarOuCriarContact`, então nem contato
  // nem lead chegam a ser gravados — é o que o `count` abaixo confirma.
  it("criarLead recusa responsavel desativado sem gravar nada", async () => {
    const telefoneNovo = "11966664002";

    await expect(
      criarLead({
        nome: `Recusado ${MARCA}`,
        telefone: telefoneNovo,
        responsavelId: idDono,
        autorId: idIntruso,
      })
    ).rejects.toThrow(/Responsável desativado/);

    expect(await prisma.contact.count({ where: { telefone: telefoneNovo } })).toBe(0);
  });

  // Decisão do dono do projeto na auditoria: exclusão de tarefa deixa rastro,
  // porque a linha some para sempre.
  it("o DONO exclui a propria tarefa e a auditoria guarda o que foi destruido", async () => {
    await excluirTask({ companyId, taskId: idTask, autorId: idDono });

    expect(await prisma.task.count({ where: { id: idTask } })).toBe(0);

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { entidadeId: idTask, acao: "excluir_task" },
    });
    expect(log.userId).toBe(idDono);
    expect(JSON.stringify(log.antes)).toContain(MARCA);
  });
});
