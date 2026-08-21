// Este arquivo usa o Prisma REAL contra o Postgres do Supabase, então carrega
// DATABASE_URL do .env aqui — não em vitest.config.ts — para não injetar
// credenciais em testes que não tocam banco. Precisa ser o primeiro import:
// os módulos abaixo (via src/lib/prisma.ts → src/lib/env.ts) leem
// process.env.DATABASE_URL no top-level. Mesmo padrão de
// `tests/unit/whatsapp-isolamento.test.ts`.
import "dotenv/config";

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server" que o Next.js aplica no build — fora desse pipeline (aqui,
// sob Vitest) ele sempre lança. `src/lib/prisma.ts` importa.
vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import { buscarContatoComHistorico, listarContatos } from "../../src/core/contacts/queries";
import {
  atualizarContato,
  criarContato,
  ContatoInvalidoError,
} from "../../src/core/contacts/service";
import { listarConversasDoContato } from "../../src/modules/whatsapp/queries";

/**
 * O par de `tests/unit/whatsapp-isolamento.test.ts`,
 * `tests/unit/pipeline-isolamento.test.ts` e
 * `tests/unit/lead-isolamento.test.ts`, agora para `core/contacts/`: para cada
 * uma das quatro funções públicas de `queries.ts` e `service.ts`, prova de que
 * o escopo da empresa A não alcança dado da empresa B.
 *
 * ## Contra o banco de verdade, e não contra o banco falso
 *
 * `tests/unit/escopo-empresa.test.ts` exercita o MECANISMO (`prismaDaEmpresa`)
 * com um banco falso. Este arquivo responde outra pergunta: "a agenda chega ao
 * dado da outra empresa?". Essa só tem resposta contra duas empresas de
 * verdade, com FK e índice único de verdade — desde o Ciclo 1e a chave de
 * `Contact` é `@@unique([companyId, telefone])` (`prisma/schema.prisma`), e o
 * que faz um filtro por id parecer suficiente é justamente o telefone ser
 * chave natural do domínio: quem digita um número no cadastro está perguntando
 * ao banco quem é o dono dele.
 *
 * ## As DUAS metades, sempre
 *
 * Todo caso tem a segunda metade: além de provar que o escopo A não alcança B,
 * prova que o dado da empresa CERTA continua chegando. Sem ela, "não devolver
 * nada para ninguém" passaria como correção — e um módulo quebrado passa em
 * qualquer teste que só afirme ausência.
 *
 * ## Nada é medido com a MESMA consulta que o código faz
 *
 * Lição do reparo de 2026-08-20 (commit 63cecd2): três casos afirmavam o total
 * contra a mesma consulta sem empresa que o defeito tinha, e o teste espelhava
 * o bug. Aqui as expectativas são ids FIXOS criados pela fixture, conferidos
 * com o `prisma` CRU, fora do escopo — nunca com uma segunda chamada à função
 * sob teste.
 *
 * ## A LEITURA ANINHADA tem caso próprio
 *
 * `core/tenancy/escopo.ts` diz, na seção "Leitura ANINHADA", que `include` e
 * `select` através de relação NÃO são filtrados pelo escopo: a extensão vê uma
 * operação só e o aninhado desce intacto ao motor. As duas consultas deste
 * módulo trazem `leads` do contato, e o que as segura hoje é a FK — não o
 * escopo. `LEAD_DA_B_NO_CONTATO_A` é a fixture que testa essa costura: um
 * `Lead` da empresa B apontando para o `Contact` da empresa A. O estado é
 * expressável no schema (`Lead.contactId` não carrega empresa), então a
 * pergunta "a FK basta?" é respondida com dado, não com raciocínio.
 */

// ─── Ids fixos ────────────────────────────────────────────────────────────
//
// Prefixo próprio deste arquivo, para que a limpeza apague por prefixo sem
// tocar em nada do seed nem de outro arquivo de teste.
const P = "iso-ct";
const EMPRESA_A = `${P}-company-a`;
const EMPRESA_B = `${P}-company-b`;
const USUARIO_A = `${P}-user-a`;
const USUARIO_B = `${P}-user-b`;
const CONTATO_A = `${P}-contact-a`;
const CONTATO_B = `${P}-contact-b`;
const ETAPA_A = `${P}-stage-a`;
const ETAPA_B = `${P}-stage-b`;
const LEAD_DA_A = `${P}-lead-a`;
const LEAD_DA_B_NO_CONTATO_A = `${P}-lead-b-em-a`;
const CONVERSA_B = `${P}-conv-b`;

/**
 * `PipelineStage.@@unique([ordem])` ainda é GLOBAL (`prisma/schema.prisma`,
 * pendência registrada do ciclo). Enquanto for, duas empresas não podem ter
 * etapas com a mesma `ordem` — nem neste teste. Faixa própria deste arquivo,
 * sem colisão com o seed (0..3), `lead-isolamento` (90xx/91xx),
 * `pipeline-isolamento` (92xx..94xx) nem `pipeline-stages` (95xx/96xx).
 */
const ORDEM_A = 9701;
const ORDEM_B = 9801;

/**
 * Família própria deste arquivo ("11922"). Desde o Ciclo 1e a unicidade de
 * telefone é `[companyId, telefone]`, então famílias distintas deixaram de ser
 * exigência do banco — continuam porque o banco de teste é o de
 * desenvolvimento (⚠️ R1 do Ciclo 1a) e um resíduo de execução interrompida de
 * outro arquivo, na MESMA empresa do seed, ainda derruba um caso por um motivo
 * que não é o testado. Sem colisão com o seed (`1199999000{0..3}`), dedupe.test.ts
 * ("119977"), lead-notes.test.ts ("119555"), stage-transition.test.ts
 * ("119888"), lead-isolamento.test.ts ("119333"), pipeline-isolamento.test.ts
 * ("11944"), whatsapp-isolamento.test.ts ("11966") nem contacts-service.test.ts
 * ("119888870xx").
 */
const TELEFONE_A = "11922220001";
const TELEFONE_B = "11922220002";
const TELEFONE_NOVO_A = "11922220003";
const TELEFONE_NOVO_B = "11922220004";

const WA_B = `${P}-wa-b`;

const SENHA_FALSA = "$2b$10$naoUsadaPorNenhumTesteDesteArquivo000000000000000000";

/** O que só a empresa B pode ler. É o dado que a tela de detalhe entrega. */
const DOCUMENTO_DA_B = "99988877766";
const OBSERVACOES_DA_B = "Segredo comercial da empresa B";

/**
 * Ordem ditada pelas FKs, e ela não é negociável.
 *
 * `Notification` PRIMEIRO: `Notification_userId_fkey` aponta para `User`, e
 * `registrarAuditoria` (que `criarContato`/`atualizarContato` chamam) pode
 * despachar aviso de rajada. Foi exatamente essa linha que faltou nos quatro
 * arquivos corrigidos no commit 63cecd2 — sem ela o `deleteMany` de `User` é
 * barrado, o arquivo deixa usuários para trás, e a execução SEGUINTE falha no
 * `beforeAll` por e-mail duplicado.
 *
 * `Conversation` antes de `Contact` por `Conversation.contactId`; `Lead` antes
 * de `PipelineStage` e de `Contact` pelas duas FKs dele; `Membership` antes de
 * `User`.
 */
async function limparTudo() {
  const usuarios = [USUARIO_A, USUARIO_B];
  const empresas = [EMPRESA_A, EMPRESA_B];
  const telefones = [TELEFONE_A, TELEFONE_B, TELEFONE_NOVO_A, TELEFONE_NOVO_B];

  await prisma.notification.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.notification.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.auditLog.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.whatsappMessage.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.conversation.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.conversation.deleteMany({ where: { waId: WA_B } });
  await prisma.task.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.leadNote.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.lead.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.pipelineStage.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.pipelineStage.deleteMany({ where: { ordem: { in: [ORDEM_A, ORDEM_B] } } });
  await prisma.contact.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.contact.deleteMany({ where: { telefone: { in: telefones } } });
  await prisma.membership.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.company.deleteMany({ where: { id: { in: empresas } } });
}

/**
 * Recria TODO o estado mutável antes de cada caso.
 *
 * É por caso, e não por arquivo, porque metade das funções sob teste GRAVA:
 * `criarContato` insere linha nova (e o telefone é único DENTRO da empresa
 * desde o Ciclo 1e — os casos deste arquivo criam na MESMA empresa A, então um
 * resíduo entre casos derruba o próximo por um motivo que não é o testado) e
 * `atualizarContato` reescreve o cadastro que o caso seguinte afirma.
 */
async function semear() {
  const empresas = [EMPRESA_A, EMPRESA_B];
  await prisma.conversation.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.lead.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.contact.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.contact.deleteMany({
    where: { telefone: { in: [TELEFONE_NOVO_A, TELEFONE_NOVO_B] } },
  });

  await prisma.contact.createMany({
    data: [
      {
        id: CONTATO_A,
        companyId: EMPRESA_A,
        nome: "Alvo da A",
        telefone: TELEFONE_A,
        email: "alvo-a@exemplo.invalido",
        empresa: "Acme A",
        documento: "11122233344",
        observacoes: "Anotação da empresa A",
      },
      {
        id: CONTATO_B,
        companyId: EMPRESA_B,
        nome: "Alvo da B",
        telefone: TELEFONE_B,
        email: "alvo-b@exemplo.invalido",
        empresa: "Acme B",
        documento: DOCUMENTO_DA_B,
        endereco: "Rua da B, 100",
        observacoes: OBSERVACOES_DA_B,
      },
    ],
  });

  await prisma.lead.createMany({
    data: [
      {
        id: LEAD_DA_A,
        companyId: EMPRESA_A,
        contactId: CONTATO_A,
        stageId: ETAPA_A,
        responsavelId: USUARIO_A,
        canal: "MANUAL",
      },
      // O lead da empresa B pendurado no contato da empresa A. Ver o bloco
      // "A LEITURA ANINHADA tem caso próprio" no topo do arquivo.
      {
        id: LEAD_DA_B_NO_CONTATO_A,
        companyId: EMPRESA_B,
        contactId: CONTATO_A,
        stageId: ETAPA_B,
        responsavelId: USUARIO_B,
        canal: "MANUAL",
      },
    ],
  });

  await prisma.conversation.create({
    data: {
      id: CONVERSA_B,
      companyId: EMPRESA_B,
      waId: WA_B,
      telefone: TELEFONE_B,
      contactId: CONTATO_B,
      nomeExibicao: "Cliente da B",
      iaAtiva: true,
    },
  });
}

/** Lê um contato com o prisma CRU, fora do escopo — o oráculo independente. */
function lerContatoCru(id: string) {
  return prisma.contact.findUniqueOrThrow({ where: { id } });
}

beforeAll(async () => {
  await limparTudo();

  await prisma.company.createMany({
    data: [
      { id: EMPRESA_A, nome: "Empresa A do isolamento de contatos" },
      { id: EMPRESA_B, nome: "Empresa B do isolamento de contatos" },
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

  await prisma.membership.createMany({
    data: [
      { userId: USUARIO_A, companyId: EMPRESA_A, papel: "ADMIN" },
      { userId: USUARIO_B, companyId: EMPRESA_B, papel: "ADMIN" },
    ],
  });

  await prisma.pipelineStage.createMany({
    data: [
      { id: ETAPA_A, companyId: EMPRESA_A, nome: "A-1", ordem: ORDEM_A, cor: "#111111" },
      { id: ETAPA_B, companyId: EMPRESA_B, nome: "B-1", ordem: ORDEM_B, cor: "#222222" },
    ],
  });
});

beforeEach(semear);

afterAll(limparTudo);

describe("listarContatos", () => {
  it("a agenda da A não traz o contato da B, e traz o dela", async () => {
    const { itens } = await listarContatos(EMPRESA_A);
    const ids = itens.map((c) => c.id);

    expect(ids).not.toContain(CONTATO_B);
    expect(ids).toContain(CONTATO_A);
  });

  it("a busca da A não encontra o contato da B pelo nome dele", async () => {
    // Sem escopo, "Alvo da" casa com os dois — é o termo que DISCRIMINA.
    const { itens } = await listarContatos(EMPRESA_A, "Alvo da");

    expect(itens.map((c) => c.id)).toEqual([CONTATO_A]);
  });

  it("a busca da A não encontra o contato da B pelo telefone dele", async () => {
    const { itens } = await listarContatos(EMPRESA_A, TELEFONE_B);

    expect(itens).toEqual([]);
  });

  it("a busca da B encontra o contato da B — a segunda metade", async () => {
    const { itens } = await listarContatos(EMPRESA_B, "Alvo da");

    expect(itens.map((c) => c.id)).toEqual([CONTATO_B]);
  });

  it("totalLeads não conta o lead da B pendurado no contato da A", async () => {
    const { itens } = await listarContatos(EMPRESA_A, "Alvo da");
    const contato = itens.find((c) => c.id === CONTATO_A);

    // O oráculo é a fixture: o contato da A tem UM lead da A
    // (`LEAD_DA_A`) e um lead da B (`LEAD_DA_B_NO_CONTATO_A`). O `_count`
    // aninhado não é filtrado pelo escopo — quem filtra é o `where` escrito à
    // mão na consulta.
    expect(contato?.totalLeads).toBe(1);
  });
});

describe("buscarContatoComHistorico", () => {
  it("a A não alcança o contato da B pelo id da rota", async () => {
    const contato = await buscarContatoComHistorico(EMPRESA_A, CONTATO_B);

    expect(contato).toBeNull();
  });

  it("nem com permissão de ver documento — o CPF da B não sai", async () => {
    const contato = await buscarContatoComHistorico(EMPRESA_A, CONTATO_B, {
      incluirDocumento: true,
    });

    expect(contato).toBeNull();
  });

  it("a B alcança o contato da B — a segunda metade", async () => {
    const contato = await buscarContatoComHistorico(EMPRESA_B, CONTATO_B, {
      incluirDocumento: true,
    });

    expect(contato?.id).toBe(CONTATO_B);
    expect(contato?.documento).toBe(DOCUMENTO_DA_B);
    expect(contato?.observacoes).toBe(OBSERVACOES_DA_B);
  });

  it("o histórico da A não lista o lead da B pendurado no mesmo contato", async () => {
    const contato = await buscarContatoComHistorico(EMPRESA_A, CONTATO_A);

    expect(contato?.leads.map((l) => l.id)).toEqual([LEAD_DA_A]);
  });

  it("o histórico da B lista o lead da B — a segunda metade da leitura aninhada", async () => {
    // Mesmo `Contact` (o da A) é inalcançável pela B, então a segunda metade
    // é medida pelo caminho que existe: a B enxerga o PRÓPRIO lead dela
    // quando ele está pendurado num contato dela.
    await prisma.lead.update({
      where: { id: LEAD_DA_B_NO_CONTATO_A },
      data: { contactId: CONTATO_B },
    });

    const contato = await buscarContatoComHistorico(EMPRESA_B, CONTATO_B);

    expect(contato?.leads.map((l) => l.id)).toEqual([LEAD_DA_B_NO_CONTATO_A]);
  });
});

describe("a cadeia com listarConversasDoContato", () => {
  it("fecha de ponta a ponta: nem o cabeçalho nem as conversas da B", async () => {
    // O elo do meio já fechou no Ciclo 1d (`whatsapp/queries.ts`). O que este
    // caso afirma é a cadeia INTEIRA que `/contatos/[id]` percorre: a página
    // chama `buscarContatoComHistorico` e só chega em
    // `listarConversasDoContato` se ela devolver algo.
    const contato = await buscarContatoComHistorico(EMPRESA_A, CONTATO_B);
    expect(contato).toBeNull();

    const conversas = await listarConversasDoContato(EMPRESA_A, CONTATO_B);
    expect(conversas).toEqual([]);

    // A segunda metade: a empresa dona vê as duas pontas.
    expect((await buscarContatoComHistorico(EMPRESA_B, CONTATO_B))?.id).toBe(CONTATO_B);
    expect((await listarConversasDoContato(EMPRESA_B, CONTATO_B)).map((c) => c.id)).toEqual([
      CONVERSA_B,
    ]);
  });
});

describe("criarContato", () => {
  it("grava na empresa do escopo, não na do autor", async () => {
    const criado = await criarContato(
      EMPRESA_A,
      { nome: "Novo da A", telefone: TELEFONE_NOVO_A },
      USUARIO_A
    );

    expect((await lerContatoCru(criado.id)).companyId).toBe(EMPRESA_A);
  });

  it("o telefone da OUTRA empresa deixa de ser recusado — e o nome do dono de fora continua invisível", async () => {
    // Antes do Ciclo 1e isto lançava `ContatoInvalidoError`: `Contact.telefone`
    // era `@unique` GLOBAL, e o mesmo número não podia existir em duas
    // empresas. Agora a chave é `[companyId, telefone]` e o caso normal de um
    // CRM multi-empresa — duas empresas atendendo o mesmo cliente — passa a ser
    // expressável.
    const criado = await criarContato(
      EMPRESA_A,
      { nome: "Novo da A", telefone: TELEFONE_B },
      USUARIO_A
    );

    expect(criado.telefone).toBe(TELEFONE_B);
    expect((await lerContatoCru(criado.id)).companyId).toBe(EMPRESA_A);

    // A metade que SOBREVIVE do caso antigo, e que é a que importa: o cadastro
    // da B fica intacto e o nome dele não aparece em nada que a A tenha visto.
    // O oráculo de "quem é o cliente do concorrente neste número" continua
    // fechado — o que o fechou foi a busca ESCOPADA (Ciclo 1a), não a
    // constraint.
    const daB = await lerContatoCru(CONTATO_B);
    expect(daB.nome).toBe("Alvo da B");
    expect(daB.companyId).toBe(EMPRESA_B);
    expect(criado.nome).toBe("Novo da A");
  });

  it("telefone ocupado DENTRO da empresa continua nomeando o dono — a segunda metade", async () => {
    const erro = await criarContato(
      EMPRESA_A,
      { nome: "Novo da A", telefone: TELEFONE_A },
      USUARIO_A
    ).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ContatoInvalidoError);
    expect((erro as Error).message).toContain("Alvo da A");
  });
});

describe("atualizarContato", () => {
  it("a A não edita o contato da B, e a linha da B fica intacta", async () => {
    const erro = await atualizarContato(
      EMPRESA_A,
      { id: CONTATO_B, nome: "Sequestrado", telefone: TELEFONE_NOVO_B },
      USUARIO_A
    ).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ContatoInvalidoError);

    // "A função lançou" não prova que ela não gravou — uma função que lança
    // DEPOIS da escrita passaria igual. O oráculo é a linha crua.
    const depois = await lerContatoCru(CONTATO_B);
    expect(depois.nome).toBe("Alvo da B");
    expect(depois.telefone).toBe(TELEFONE_B);
  });

  it("a B edita o contato da B — a segunda metade", async () => {
    await atualizarContato(
      EMPRESA_B,
      { id: CONTATO_B, nome: "Alvo da B editado", telefone: TELEFONE_NOVO_B },
      USUARIO_B
    );

    const depois = await lerContatoCru(CONTATO_B);
    expect(depois.nome).toBe("Alvo da B editado");
    expect(depois.telefone).toBe(TELEFONE_NOVO_B);
    expect(depois.companyId).toBe(EMPRESA_B);
  });

  it("trocar o telefone para um de OUTRA empresa passa a ser permitido — e não revela o dono de lá", async () => {
    await atualizarContato(
      EMPRESA_A,
      { id: CONTATO_A, nome: "Alvo da A", telefone: TELEFONE_B },
      USUARIO_A
    );

    const daA = await lerContatoCru(CONTATO_A);
    expect(daA.telefone).toBe(TELEFONE_B);
    expect(daA.companyId).toBe(EMPRESA_A);

    // Segunda metade: a linha da B não foi tocada nem lida para dentro da A.
    const daB = await lerContatoCru(CONTATO_B);
    expect(daB.nome).toBe("Alvo da B");
    expect(daB.telefone).toBe(TELEFONE_B);
    expect(daB.companyId).toBe(EMPRESA_B);
  });
});
