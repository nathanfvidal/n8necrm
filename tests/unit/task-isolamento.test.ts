// Este arquivo usa o Prisma REAL contra o Postgres do Supabase, então carrega
// DATABASE_URL do .env aqui — não em vitest.config.ts — para não injetar
// credenciais em testes que não tocam banco. Precisa ser o primeiro import:
// os módulos abaixo (via src/lib/prisma.ts → src/lib/env.ts) leem
// process.env.DATABASE_URL no top-level. Mesmo padrão de
// tests/unit/lead-isolamento.test.ts.
import "dotenv/config";

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server" que o Next.js aplica no build — fora desse pipeline (aqui,
// sob Vitest) ele sempre lança. `src/core/tasks/service.ts` e
// `src/lib/prisma.ts` importam. Ver tests/unit/storage.test.ts, onde o mock
// foi documentado.
vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import { criarTask, editarTask } from "../../src/core/tasks/service";

/**
 * O vazamento que este arquivo trava: **uma Task da empresa A podia nascer (ou
 * ser reapontada) para um Lead da empresa B.**
 *
 * `criarTask` e `editarTask` conferiam `input.leadId` com
 * `prisma.lead.findUnique({ where: { id } })` e um `if (!lead) throw` — só
 * EXISTÊNCIA, nunca empresa. `leadId` chega de `criarMinhaTaskAction` /
 * `editarTaskAction` (`core/tasks/actions.ts`), que são Server Actions, e
 * Server Action é endpoint HTTP público: o id é forjável, o `<select>` da tela
 * não é a fronteira.
 *
 * É a QUARTA vez que esta família aparece no Ciclo 1a, sempre com a mesma
 * forma — "valida que EXISTE, nunca que é da mesma empresa":
 *
 * 1. `core/audit/alerta.ts`, destinatários do alerta de rajada (3744e64)
 * 2. `src/modules/whatsapp/notificacoes.ts`, fan-out do aviso (63cecd2)
 * 3. `core/leads/service.ts`, responsável do lead, três pontos (6dfb325)
 * 4. `core/tasks/service.ts` — este
 *
 * ## Por que contra o banco de verdade
 *
 * Mesma razão de `lead-isolamento.test.ts`: a pergunta não é "a extensão
 * injeta `companyId`?" (isso é `escopo-empresa.test.ts`, com banco falso) e
 * sim "o serviço de `tasks` alcança o Lead da outra empresa?". Essa só tem
 * resposta com duas empresas de verdade, FK e constraint.
 *
 * ## As DUAS metades, sempre
 *
 * Todo caso prova que A não alcança o Lead da B **e** que o Lead da PRÓPRIA
 * empresa continua sendo aceito. Sem a segunda metade, "recusar todo `leadId`"
 * passaria como correção — e um serviço quebrado passa em qualquer teste que
 * só afirme recusa.
 *
 * ## Nada é medido com a MESMA consulta que o código faz
 *
 * Lição do 63cecd2. As expectativas abaixo são ids FIXOS da fixture e leituras
 * diretas de `prisma.task`, nunca contagens derivadas da consulta que o
 * serviço faz.
 */

// ─── Ids fixos ────────────────────────────────────────────────────────────
//
// Prefixo próprio deste arquivo, para a limpeza poder apagar sem tocar no seed
// nem em nada de outro arquivo de teste.
const P = "iso-task";
const EMPRESA_A = `${P}-company-a`;
const EMPRESA_B = `${P}-company-b`;
const USUARIO_A = `${P}-user-a`;
const USUARIO_B = `${P}-user-b`;
const ETAPA_A = `${P}-stage-a`;
const ETAPA_B = `${P}-stage-b`;
const CONTATO_A = `${P}-contact-a`;
const CONTATO_B = `${P}-contact-b`;
const LEAD_A = `${P}-lead-a`;
const LEAD_B = `${P}-lead-b`;
const TASK_A = `${P}-task-a`;

/**
 * `PipelineStage.@@unique([ordem])` ainda é GLOBAL (`prisma/schema.prisma`,
 * pendência registrada do ciclo). Enquanto for, duas empresas não podem ter
 * etapas com a mesma `ordem` — nem aqui. Faixa alta e própria deste arquivo,
 * sem colisão com o seed (0–3, medido em 2026-08-20) nem com
 * `lead-isolamento.test.ts` (9001/9002/9101/9102).
 */
const ORDEM_A = 9201;
const ORDEM_B = 9202;

// `Contact.telefone` é `@unique` GLOBAL — mesma pendência, do outro lado.
// Família própria deste arquivo ("119222"), sem colisão com o seed
// (`1199999000{0..3}`), dedupe.test.ts ("119977"), lead-notes.test.ts
// ("119555"), stage-transition.test.ts ("119888") nem lead-isolamento.test.ts
// ("11933").
const TELEFONE_A = "11922220001";
const TELEFONE_B = "11922220002";

const SENHA_FALSA = "$2b$10$naoUsadaPorNenhumTesteDesteArquivo000000000000000000";

const VENCIMENTO = new Date("2026-12-01T12:00:00.000Z");

/**
 * Ordem ditada pelas FKs.
 *
 * `Notification` PRIMEIRO por disciplina de casa (`Notification_userId_fkey`
 * aponta para `User`): nada aqui cria notificação — `criarTask` não notifica —
 * mas a linha custa nada e o arquivo que a esquece envenena o banco de
 * desenvolvimento COMPARTILHADO, fazendo a execução seguinte falhar no
 * `beforeAll` por e-mail duplicado, com um sintoma que não aponta para a causa
 * (foi o que aconteceu no 63cecd2).
 *
 * Depois: `AuditLog` (FK real para `User`), `Task` (FK para `Company`, `User`,
 * `Lead` e `Contact`), `Lead`, `Contact`, `PipelineStage`, `Membership`,
 * `User`, `Company`.
 */
async function limpar() {
  const usuarios = [USUARIO_A, USUARIO_B];
  const empresas = [EMPRESA_A, EMPRESA_B];

  await prisma.notification.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.task.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.task.deleteMany({ where: { responsavelId: { in: usuarios } } });
  await prisma.lead.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.contact.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.contact.deleteMany({ where: { telefone: { in: [TELEFONE_A, TELEFONE_B] } } });
  await prisma.pipelineStage.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.membership.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.company.deleteMany({ where: { id: { in: empresas } } });
}

/**
 * Recria o estado mutável a cada caso: as tarefas.
 *
 * `beforeEach` e não `beforeAll` porque metade dos casos GRAVA (`criarTask`
 * cria linhas novas, `editarTask` reaponta o `leadId` de `TASK_A`) — sem
 * recriar, um caso leria o efeito do anterior e o teste passaria a medir
 * ordem de execução em vez de isolamento.
 */
async function semearTarefas() {
  await prisma.task.deleteMany({ where: { companyId: { in: [EMPRESA_A, EMPRESA_B] } } });

  await prisma.task.create({
    data: {
      id: TASK_A,
      companyId: EMPRESA_A,
      titulo: "tarefa da empresa A",
      vencimento: VENCIMENTO,
      responsavelId: USUARIO_A,
      leadId: LEAD_A,
    },
  });
}

beforeAll(async () => {
  await limpar();

  await prisma.company.createMany({
    data: [
      { id: EMPRESA_A, nome: "Empresa A do isolamento de tarefas" },
      { id: EMPRESA_B, nome: "Empresa B do isolamento de tarefas" },
    ],
  });

  await prisma.user.createMany({
    data: [
      {
        id: USUARIO_A,
        nome: "Ana da A",
        email: `${USUARIO_A}@exemplo.invalido`,
        senhaHash: SENHA_FALSA,
        papel: "ADMIN",
      },
      {
        id: USUARIO_B,
        nome: "Bruno da B",
        email: `${USUARIO_B}@exemplo.invalido`,
        senhaHash: SENHA_FALSA,
        papel: "ADMIN",
      },
    ],
  });

  // O vínculo, e não `User.papel`, é o que define "pessoa desta empresa" — é
  // dele que `companyIdDoUsuario` tira o escopo, e é ele que `criarTask` usa
  // para descobrir a empresa da tarefa. Fixture que cria `User` sem
  // `Membership` produz usuário sem empresa nenhuma (bug latente do e67e1e6).
  await prisma.membership.createMany({
    data: [
      { userId: USUARIO_A, companyId: EMPRESA_A, papel: "ADMIN" },
      { userId: USUARIO_B, companyId: EMPRESA_B, papel: "ADMIN" },
    ],
  });

  await prisma.pipelineStage.createMany({
    data: [
      { id: ETAPA_A, companyId: EMPRESA_A, nome: "A-1", ordem: ORDEM_A, cor: "#111111" },
      { id: ETAPA_B, companyId: EMPRESA_B, nome: "B-1", ordem: ORDEM_B, cor: "#333333" },
    ],
  });

  await prisma.contact.createMany({
    data: [
      { id: CONTATO_A, companyId: EMPRESA_A, nome: "Contato da A", telefone: TELEFONE_A },
      { id: CONTATO_B, companyId: EMPRESA_B, nome: "Contato da B", telefone: TELEFONE_B },
    ],
  });

  await prisma.lead.createMany({
    data: [
      {
        id: LEAD_A,
        companyId: EMPRESA_A,
        contactId: CONTATO_A,
        stageId: ETAPA_A,
        responsavelId: USUARIO_A,
        canal: "MANUAL",
      },
      {
        id: LEAD_B,
        companyId: EMPRESA_B,
        contactId: CONTATO_B,
        stageId: ETAPA_B,
        responsavelId: USUARIO_B,
        canal: "MANUAL",
      },
    ],
  });
});

beforeEach(semearTarefas);

afterAll(async () => {
  await limpar();
});

describe("criarTask — o Lead precisa ser da empresa de quem age", () => {
  it("recusa leadId de outra empresa", async () => {
    await expect(
      criarTask({
        titulo: "tarefa forjada",
        vencimento: VENCIMENTO,
        responsavelId: USUARIO_A,
        leadId: LEAD_B,
      })
    ).rejects.toThrow(/^Lead não encontrado/);

    // Não basta recusar: nada pode ter sido gravado. Sem esta afirmação, uma
    // implementação que criasse a tarefa e SÓ DEPOIS lançasse passaria.
    const vazou = await prisma.task.findFirst({
      where: { responsavelId: USUARIO_A, titulo: "tarefa forjada" },
    });
    expect(vazou).toBeNull();
  });

  it("aceita leadId da PRÓPRIA empresa e grava o vínculo", async () => {
    const criada = await criarTask({
      titulo: "tarefa legitima",
      vencimento: VENCIMENTO,
      responsavelId: USUARIO_A,
      leadId: LEAD_A,
    });

    expect(criada.leadId).toBe(LEAD_A);
    expect(criada.companyId).toBe(EMPRESA_A);

    // Lido de volta do banco, e não do valor devolvido: o retorno de
    // `criarTask` é o eco do que ela mandou gravar, não prova de que gravou.
    const noBanco = await prisma.task.findUniqueOrThrow({ where: { id: criada.id } });
    expect(noBanco.leadId).toBe(LEAD_A);
    expect(noBanco.companyId).toBe(EMPRESA_A);
  });

  it("a empresa B enxerga o próprio Lead — a recusa é de EMPRESA, não do id", async () => {
    // A metade que impede "recusar tudo" de passar por correção: o MESMO
    // `LEAD_B` que a empresa A não alcança é aceito por quem é da B.
    const criada = await criarTask({
      titulo: "tarefa da B",
      vencimento: VENCIMENTO,
      responsavelId: USUARIO_B,
      leadId: LEAD_B,
    });

    expect(criada.leadId).toBe(LEAD_B);
    expect(criada.companyId).toBe(EMPRESA_B);
  });
});

describe("editarTask — reapontar o Lead não atravessa a empresa", () => {
  it("recusa leadId de outra empresa e não reaponta a tarefa", async () => {
    await expect(
      editarTask({
        taskId: TASK_A,
        titulo: "tarefa da empresa A",
        vencimento: VENCIMENTO,
        leadId: LEAD_B,
        autorId: USUARIO_A,
      })
    ).rejects.toThrow(/^Lead não encontrado/);

    const depois = await prisma.task.findUniqueOrThrow({ where: { id: TASK_A } });
    expect(depois.leadId).toBe(LEAD_A);
  });

  it("aceita leadId da PRÓPRIA empresa", async () => {
    // Desvincula e revincula ao lead da própria empresa: o caminho que a
    // recusa acima NÃO pode ter fechado junto.
    await editarTask({
      taskId: TASK_A,
      titulo: "tarefa da empresa A",
      vencimento: VENCIMENTO,
      leadId: null,
      autorId: USUARIO_A,
    });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: TASK_A } })).leadId).toBeNull();

    await editarTask({
      taskId: TASK_A,
      titulo: "tarefa da empresa A",
      vencimento: VENCIMENTO,
      leadId: LEAD_A,
      autorId: USUARIO_A,
    });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: TASK_A } })).leadId).toBe(LEAD_A);
  });
});

/**
 * O IRMÃO do vazamento acima, fechado depois (2026-08-20).
 *
 * `exigirContatoExistente` validava `contactId` com
 * `prisma.contact.findUnique({ where: { id } })` — a MESMA família, no MESMO
 * arquivo, nas MESMAS duas funções, e a três linhas de distância do irmão que
 * já tinha sido corrigido. Ficou aberto de propósito no commit anterior
 * (`da2a402`) porque o dono do projeto pediu a contagem completa dos defeitos
 * antes de decidir quantos fechar; a decisão veio, e a cura foi a mesma linha:
 * `companyId` no `where`, com a empresa vindo de onde `exigirLeadDaEmpresa` já
 * a pega (`companyIdDoUsuario(responsavelId)` ao criar, `task.companyId` ao
 * editar).
 *
 * O que vazava: `Task.contactId` da empresa A apontando para `Contact` da B.
 * Daí em diante a tarefa mostrava, na lista de `/tasks`, o NOME de um contato
 * de outro cliente — `listarTasksComLead` (`tasks/queries.ts`) traz o contato
 * junto —, e o vínculo servia de ponte para as consultas que partem de
 * `contactId`.
 */
describe("criarTask — o Contato precisa ser da empresa de quem age", () => {
  it("recusa contactId de outra empresa", async () => {
    await expect(
      criarTask({
        titulo: "tarefa com contato forjado",
        vencimento: VENCIMENTO,
        responsavelId: USUARIO_A,
        contactId: CONTATO_B,
      })
    ).rejects.toThrow(/^Contato não encontrado/);

    const vazou = await prisma.task.findFirst({
      where: { responsavelId: USUARIO_A, titulo: "tarefa com contato forjado" },
    });
    expect(vazou).toBeNull();
  });

  it("aceita contactId da PRÓPRIA empresa e grava o vínculo", async () => {
    const criada = await criarTask({
      titulo: "tarefa com contato legitimo",
      vencimento: VENCIMENTO,
      responsavelId: USUARIO_A,
      contactId: CONTATO_A,
    });

    const noBanco = await prisma.task.findUniqueOrThrow({ where: { id: criada.id } });
    expect(noBanco.contactId).toBe(CONTATO_A);
    expect(noBanco.companyId).toBe(EMPRESA_A);
  });

  it("a empresa B enxerga o próprio Contato — a recusa é de EMPRESA, não do id", async () => {
    // A metade que impede "recusar todo `contactId`" de passar por correção: o
    // MESMO `CONTATO_B` que a empresa A não alcança é aceito por quem é da B.
    const criada = await criarTask({
      titulo: "tarefa da B com contato",
      vencimento: VENCIMENTO,
      responsavelId: USUARIO_B,
      contactId: CONTATO_B,
    });

    expect(criada.contactId).toBe(CONTATO_B);
    expect(criada.companyId).toBe(EMPRESA_B);
  });
});

describe("editarTask — reapontar o Contato não atravessa a empresa", () => {
  it("recusa contactId de outra empresa e não reaponta a tarefa", async () => {
    await expect(
      editarTask({
        taskId: TASK_A,
        titulo: "tarefa da empresa A",
        vencimento: VENCIMENTO,
        contactId: CONTATO_B,
        autorId: USUARIO_A,
      })
    ).rejects.toThrow(/^Contato não encontrado/);

    const depois = await prisma.task.findUniqueOrThrow({ where: { id: TASK_A } });
    expect(depois.contactId).toBeNull();
  });

  it("aceita contactId da PRÓPRIA empresa", async () => {
    await editarTask({
      taskId: TASK_A,
      titulo: "tarefa da empresa A",
      vencimento: VENCIMENTO,
      contactId: CONTATO_A,
      autorId: USUARIO_A,
    });

    expect((await prisma.task.findUniqueOrThrow({ where: { id: TASK_A } })).contactId).toBe(CONTATO_A);
  });
});
