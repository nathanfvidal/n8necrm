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
import {
  concluirTask,
  criarTask,
  editarTask,
  excluirTask,
  listarTasksPendentes,
  reabrirTask,
} from "../../src/core/tasks/service";
import { listarMinhasTasks, listarTasksPendentesDoLead } from "../../src/core/tasks/queries";

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
const TASK_B = `${P}-task-b`;
/**
 * Tarefa da empresa A pendurada no `Lead` da empresa B.
 *
 * `Task.leadId` é FK para `Lead` e não carrega empresa nenhuma, então este
 * estado é EXPRESSÁVEL no schema — e é exatamente o que
 * `listarTasksPendentesDoLead` mostraria a quem abre `/leads/<id da B>` se ela
 * filtrasse só por `leadId`, que é o que ela fazia. A fixture o fabrica de
 * propósito, do mesmo jeito que `contact-isolamento.test.ts` fabrica o lead da
 * B no contato da A.
 */
const TASK_CRUZADA = `${P}-task-cruzada`;
/**
 * A pessoa com vínculo nas DUAS empresas, e as duas tarefas dela — uma em cada.
 *
 * É o que separa "escopo por dono" de "escopo por empresa". Enquanto ninguém
 * tem dois vínculos, `where: { responsavelId }` sozinho parece suficiente:
 * toda tarefa de quem eu sou dono é da minha empresa. Com dois vínculos deixa
 * de ser — e `criarUsuario` já sabe criar `Membership`, então o estado é
 * expressável hoje.
 */
const USUARIO_DUPLO = `${P}-user-duplo`;
const TASK_DUPLO_NA_A = `${P}-task-duplo-a`;
const TASK_DUPLO_NA_B = `${P}-task-duplo-b`;

/**
 * Faixa alta e própria deste arquivo. Desde o Ciclo 1e a `ordem` é única POR
 * EMPRESA (`@@unique([companyId, ordem])`, `prisma/schema.prisma`), então o
 * banco não exige mais faixas disjuntas — o que sobra é não colidir com o seed
 * (0–3, medido em 2026-08-20) nem com `lead-isolamento.test.ts`
 * (9001/9002/9101/9102), porque o Postgres de teste é o de desenvolvimento
 * (⚠️ R1 do Ciclo 1a).
 */
const ORDEM_A = 9201;
const ORDEM_B = 9202;

// Família própria deste arquivo ("119222"). Desde o Ciclo 1e o telefone é único
// POR EMPRESA (`@@unique([companyId, telefone])`), então o banco não exige
// mais famílias distintas — elas continuam porque o Postgres de teste é o de
// desenvolvimento (⚠️ R1 do Ciclo 1a) e um resíduo de execução interrompida
// de outro arquivo derrubaria um caso por um motivo que não é o testado.
// Sem colisão com o seed
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
  const usuarios = [USUARIO_A, USUARIO_B, USUARIO_DUPLO];
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

  await prisma.task.createMany({
    data: [
      {
        id: TASK_A,
        companyId: EMPRESA_A,
        titulo: "tarefa da empresa A",
        vencimento: VENCIMENTO,
        responsavelId: USUARIO_A,
        leadId: LEAD_A,
      },
      {
        id: TASK_B,
        companyId: EMPRESA_B,
        titulo: "tarefa da empresa B",
        vencimento: VENCIMENTO,
        // Dono é a pessoa de vínculo DUPLO, de propósito: assim a regra de dono
        // NÃO recusa quando a empresa A tenta alcançar esta linha, e o que
        // sobra a recusar é o escopo. Com um dono só da B, todo caso passaria
        // pela regra de dono e nenhum provaria escopo nenhum.
        responsavelId: USUARIO_DUPLO,
      },
      {
        id: TASK_CRUZADA,
        companyId: EMPRESA_A,
        titulo: "tarefa da A no lead da B",
        vencimento: VENCIMENTO,
        responsavelId: USUARIO_A,
        leadId: LEAD_B,
      },
      {
        id: TASK_DUPLO_NA_A,
        companyId: EMPRESA_A,
        titulo: "lembrete do duplo na A",
        vencimento: VENCIMENTO,
        responsavelId: USUARIO_DUPLO,
      },
      {
        id: TASK_DUPLO_NA_B,
        companyId: EMPRESA_B,
        titulo: "lembrete do duplo na B",
        vencimento: VENCIMENTO,
        responsavelId: USUARIO_DUPLO,
      },
    ],
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
      },
      {
        id: USUARIO_B,
        nome: "Bruno da B",
        email: `${USUARIO_B}@exemplo.invalido`,
        senhaHash: SENHA_FALSA,
      },
      {
        id: USUARIO_DUPLO,
        nome: "Duda das Duas",
        email: `${USUARIO_DUPLO}@exemplo.invalido`,
        senhaHash: SENHA_FALSA,
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
      { userId: USUARIO_DUPLO, companyId: EMPRESA_A, papel: "ADMIN" },
      { userId: USUARIO_DUPLO, companyId: EMPRESA_B, papel: "ADMIN" },
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
        companyId: EMPRESA_A,
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
      companyId: EMPRESA_A,
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
      companyId: EMPRESA_B,
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
        companyId: EMPRESA_A,
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
      companyId: EMPRESA_A,
      taskId: TASK_A,
      titulo: "tarefa da empresa A",
      vencimento: VENCIMENTO,
      leadId: null,
      autorId: USUARIO_A,
    });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: TASK_A } })).leadId).toBeNull();

    await editarTask({
      companyId: EMPRESA_A,
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
        companyId: EMPRESA_A,
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
      companyId: EMPRESA_A,
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
      companyId: EMPRESA_B,
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
        companyId: EMPRESA_A,
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
      companyId: EMPRESA_A,
      taskId: TASK_A,
      titulo: "tarefa da empresa A",
      vencimento: VENCIMENTO,
      contactId: CONTATO_A,
      autorId: USUARIO_A,
    });

    expect((await prisma.task.findUniqueOrThrow({ where: { id: TASK_A } })).contactId).toBe(CONTATO_A);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Ciclo 1d — a conversão para `prismaDaEmpresa`
// ─────────────────────────────────────────────────────────────────────────
//
// Os casos acima travam a família "valida que EXISTE, nunca que é da mesma
// empresa" nos dois pontos onde ela morava em `tasks/`. Os de baixo travam o
// que a CONVERSÃO acrescenta: as sete funções públicas do módulo passaram a
// receber `companyId` e a alcançar o banco só pelo cliente escopado.
//
// Cada bloco tem uma SONDA da consulta ANTIGA quando ela é a única forma de
// provar que havia o que vazar. A sonda não testa produção: testa a FIXTURE —
// se ela ficar verde, não há dado cruzado e o caso ao lado passaria por
// vacuidade. É a armadilha 3 deste ciclo, e ela já custou dois blocos.

describe("listarMinhasTasks — escopo por dono NÃO é escopo por empresa", () => {
  it("SONDA (consulta ANTIGA): só `responsavelId` juntava as duas empresas numa lista", async () => {
    const antigo = await prisma.task.findMany({
      where: { responsavelId: USUARIO_DUPLO, concluidaEm: null },
    });

    const empresas = new Set(antigo.map((t) => t.companyId));
    expect(empresas.has(EMPRESA_A)).toBe(true);
    expect(empresas.has(EMPRESA_B)).toBe(true);
  });

  it("a lista da A traz só as tarefas da A, e traz as dela", async () => {
    const { itens } = await listarMinhasTasks(EMPRESA_A, USUARIO_DUPLO);
    const ids = itens.map((t) => t.id);

    expect(ids).toContain(TASK_DUPLO_NA_A);
    expect(ids).not.toContain(TASK_DUPLO_NA_B);
  });

  it("a lista da B traz só as tarefas da B — a recusa é de EMPRESA, não do dono", async () => {
    const { itens } = await listarMinhasTasks(EMPRESA_B, USUARIO_DUPLO);
    const ids = itens.map((t) => t.id);

    expect(ids).toContain(TASK_DUPLO_NA_B);
    expect(ids).not.toContain(TASK_DUPLO_NA_A);
  });
});

describe("listarTasksPendentesDoLead — a FK do Lead não carrega empresa", () => {
  it("SONDA (consulta ANTIGA): só `leadId` trazia a tarefa da A pendurada no Lead da B", async () => {
    const antigo = await prisma.task.findMany({ where: { leadId: LEAD_B, concluidaEm: null } });

    expect(antigo.map((t) => t.id)).toContain(TASK_CRUZADA);
  });

  it("o detalhe do Lead da B não mostra a tarefa da A pendurada nele", async () => {
    const tarefas = await listarTasksPendentesDoLead(EMPRESA_B, LEAD_B);

    expect(tarefas.map((t) => t.id)).not.toContain(TASK_CRUZADA);
  });

  it("o detalhe do Lead da A continua mostrando a tarefa da A", async () => {
    const tarefas = await listarTasksPendentesDoLead(EMPRESA_A, LEAD_A);

    expect(tarefas.map((t) => t.id)).toContain(TASK_A);
  });
});

describe("escrita por id — a regra de dono passa, o escopo é quem recusa", () => {
  // `USUARIO_DUPLO` É dono de `TASK_B`, então a checagem de dono ACEITA em
  // todos os casos abaixo. O que recusa é o `companyId` do cliente — e é por
  // isso que o dono precisou ser o de vínculo duplo: com um dono só da B, a
  // recusa viria da regra antiga e nada aqui provaria escopo.
  it("concluirTask não alcança a tarefa da outra empresa", async () => {
    await expect(
      concluirTask({ companyId: EMPRESA_A, taskId: TASK_B, autorId: USUARIO_DUPLO })
    ).rejects.toThrow("Tarefa não encontrada");

    const noBanco = await prisma.task.findUniqueOrThrow({ where: { id: TASK_B } });
    expect(noBanco.concluidaEm).toBeNull();
  });

  it("concluirTask alcança a tarefa da PRÓPRIA empresa", async () => {
    const depois = await concluirTask({
      companyId: EMPRESA_B,
      taskId: TASK_B,
      autorId: USUARIO_DUPLO,
    });

    expect(depois.concluidaEm).not.toBeNull();
  });

  it("editarTask não alcança a tarefa da outra empresa", async () => {
    await expect(
      editarTask({
        companyId: EMPRESA_A,
        taskId: TASK_B,
        titulo: "sequestrada",
        vencimento: VENCIMENTO,
        autorId: USUARIO_DUPLO,
      })
    ).rejects.toThrow("Tarefa não encontrada");

    const noBanco = await prisma.task.findUniqueOrThrow({ where: { id: TASK_B } });
    expect(noBanco.titulo).toBe("tarefa da empresa B");
  });

  it("editarTask alcança a tarefa da PRÓPRIA empresa", async () => {
    const depois = await editarTask({
      companyId: EMPRESA_B,
      taskId: TASK_B,
      titulo: "renomeada pela própria empresa",
      vencimento: VENCIMENTO,
      autorId: USUARIO_DUPLO,
    });

    expect(depois.titulo).toBe("renomeada pela própria empresa");
  });

  it("reabrirTask não alcança a tarefa da outra empresa", async () => {
    await expect(
      reabrirTask({ companyId: EMPRESA_A, taskId: TASK_B, autorId: USUARIO_DUPLO })
    ).rejects.toThrow("Tarefa não encontrada");
  });

  it("excluirTask não alcança a tarefa da outra empresa, e a linha continua lá", async () => {
    await expect(
      excluirTask({ companyId: EMPRESA_A, taskId: TASK_B, autorId: USUARIO_DUPLO })
    ).rejects.toThrow("Tarefa não encontrada");

    expect(await prisma.task.findUnique({ where: { id: TASK_B } })).not.toBeNull();
  });

  it("excluirTask alcança a tarefa da PRÓPRIA empresa", async () => {
    await excluirTask({ companyId: EMPRESA_B, taskId: TASK_B, autorId: USUARIO_DUPLO });

    expect(await prisma.task.findUnique({ where: { id: TASK_B } })).toBeNull();
  });
});

describe("listarTasksPendentes — o utilitário sem responsável também é escopado", () => {
  it("sem `responsavelId`, lista TODA tarefa pendente DESTA empresa e nenhuma da outra", async () => {
    const pendentes = await listarTasksPendentes(EMPRESA_A);
    const ids = pendentes.map((t) => t.id);

    expect(ids).toContain(TASK_A);
    expect(ids).toContain(TASK_DUPLO_NA_A);
    expect(ids).not.toContain(TASK_B);
    expect(ids).not.toContain(TASK_DUPLO_NA_B);
  });
});
