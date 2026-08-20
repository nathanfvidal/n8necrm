// Este arquivo usa o Prisma REAL contra o Postgres do Supabase, então carrega
// DATABASE_URL do .env aqui — não em vitest.config.ts — para não injetar
// credenciais em testes que não tocam banco. Precisa ser o primeiro import:
// os módulos abaixo (via src/lib/prisma.ts → src/lib/env.ts) leem
// process.env.DATABASE_URL no top-level. Mesmo padrão de lead-notes.test.ts.
import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server" que o Next.js aplica no build — fora desse pipeline (aqui,
// sob Vitest) ele sempre lança. `src/core/leads/notes.ts` e `src/lib/prisma.ts`
// importam. Ver tests/unit/storage.test.ts, onde o mock foi documentado.
vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import {
  arquivarLead,
  atualizarLead,
  criarLead,
  criarLeadDeWhatsapp,
  desarquivarLead,
  moverEtapa,
} from "../../src/core/leads/service";
import { adicionarNota, editarNota, excluirNota, listarNotas } from "../../src/core/leads/notes";
import { contarLeadsPorEtapa, listarLeads, listarLeadsPorEtapa } from "../../src/core/leads/queries";
import { encontrarOuCriarContact } from "../../src/core/leads/dedupe";

/**
 * O teste que dá sentido ao Ciclo 1a: para cada função pública de `leads`,
 * prova de que o escopo da empresa A não alcança dado da empresa B.
 *
 * ## Por que contra o banco de verdade, e não contra o banco falso
 *
 * `tests/unit/escopo-empresa.test.ts` exercita o MECANISMO (`prismaDaEmpresa`)
 * com um banco falso montado por dentro do escopo, e não pode fazer mais que
 * isso: o banco falso precisa ser aplicado DEPOIS de `prismaDaEmpresa()` para
 * ficar por dentro dela, e os serviços chamam `prismaDaEmpresa()` lá dentro,
 * onde o teste não alcança para injetar nada. Trocar `@/lib/prisma` por um
 * objeto falso inverteria a ordem das extensões e o escopo nunca rodaria — o
 * teste passaria vazio, que é o pior resultado possível para um teste de
 * isolamento.
 *
 * Aqui o assunto é outro: não é "a extensão injeta `companyId`?" e sim "o
 * serviço de `leads` chega ao dado da outra empresa?". Essa pergunta só tem
 * resposta contra duas empresas de verdade, com FK, constraint e tudo.
 *
 * ## As DUAS metades, sempre
 *
 * Todo caso tem a segunda metade: além de provar que o escopo A não alcança B,
 * prova que o dado da empresa CERTA continua chegando. Sem ela, "não devolver
 * nada para ninguém" passaria como correção — e um serviço quebrado passa em
 * qualquer teste que só afirme ausência.
 *
 * ## Nada é medido com a MESMA consulta que o código faz
 *
 * Lição do reparo de 2026-08-20 (commit 63cecd2): três casos afirmavam o total
 * esperado contra `prisma.user.count({ where: { ativo: true } })` — a mesma
 * consulta sem empresa que o defeito tinha. O teste espelhava o bug e a suíte
 * passava por cima do vazamento. Aqui as expectativas são ids FIXOS criados
 * pela fixture, não contagens derivadas de consulta nenhuma.
 */

// ─── Ids fixos ────────────────────────────────────────────────────────────
//
// Prefixo próprio deste arquivo, para que a limpeza possa apagar por prefixo
// sem tocar em nada do seed nem de outro arquivo de teste.
const P = "iso-t4";
const EMPRESA_A = `${P}-company-a`;
const EMPRESA_B = `${P}-company-b`;
const USUARIO_A = `${P}-user-a`;
const USUARIO_B = `${P}-user-b`;
const ETAPA_A1 = `${P}-stage-a1`;
const ETAPA_A2 = `${P}-stage-a2`;
const ETAPA_B1 = `${P}-stage-b1`;
const ETAPA_B2 = `${P}-stage-b2`;
const CONTATO_A = `${P}-contact-a`;
const CONTATO_B = `${P}-contact-b`;
const LEAD_A = `${P}-lead-a`;
const LEAD_B = `${P}-lead-b`;
const NOTA_A = `${P}-note-a`;
const NOTA_B = `${P}-note-b`;
// Nota que VIVE na empresa A e foi escrita por quem é da empresa B. Fabricada
// direto pelo Prisma porque nenhum caminho de código a produz depois desta
// tarefa — é justamente o estado que `editarNota`/`excluirNota` precisam
// recusar, e sem ela a regra de dono (`autorId !== input.autorId`) esconderia
// a falta de escopo: os dois testes ficariam verdes pelo motivo errado.
const NOTA_CRUZADA = `${P}-note-cruzada`;

/**
 * `PipelineStage.@@unique([ordem])` ainda é GLOBAL (`prisma/schema.prisma`,
 * pendência registrada do ciclo e bloqueadora da segunda empresa de verdade).
 * Enquanto for, duas empresas não podem ter etapas com a mesma `ordem` — nem
 * neste teste. As faixas abaixo são altas de propósito, para não colidir com
 * as do seed (medidas em 2026-08-20: 0, 1, 2 e 3).
 *
 * Isto NÃO enfraquece o teste: o que ele mede é qual etapa cada empresa
 * enxerga, e as faixas escolhidas colocam a empresa A ANTES da B na ordenação
 * global — então um `findFirstOrThrow({ orderBy: { ordem: "asc" } })` sem
 * escopo devolveria etapa do SEED (ordem 0), que não pertence a nenhuma das
 * duas. É exatamente o defeito D.
 */
const ORDEM_A1 = 9001;
const ORDEM_A2 = 9002;
const ORDEM_B1 = 9101;
const ORDEM_B2 = 9102;

// `Contact.telefone` é `@unique` GLOBAL (`prisma/schema.prisma`) — a mesma
// pendência de `PipelineStage.ordem`, do outro lado. Telefones distintos por
// empresa, com família própria deste arquivo ("11933"), sem colisão com o seed
// (`1199999000{0..3}`), dedupe.test.ts ("119977"), lead-notes.test.ts
// ("119555") nem stage-transition.test.ts ("119888").
const TELEFONE_A = "11933330001";
const TELEFONE_B = "11933330002";
const TELEFONE_NOVO_A = "11933330003";
const TELEFONE_NOVO_B = "11933330004";

const SENHA_FALSA = "$2b$10$naoUsadaPorNenhumTesteDesteArquivo000000000000000000";

/**
 * Ordem ditada pelas FKs, e ela não é negociável.
 *
 * `Notification` PRIMEIRO: `Notification_userId_fkey` aponta para `User`, e
 * `criarLead` grava uma notificação a cada chamada (`notificarNovoLead`). Foi
 * exatamente essa linha que faltou nos quatro arquivos corrigidos no commit
 * 63cecd2 — sem ela o `deleteMany` de `User` é barrado, o arquivo deixa
 * usuários para trás, e a execução SEGUINTE falha no `beforeAll` por e-mail
 * duplicado (o e-mail é determinístico). Banco de desenvolvimento
 * compartilhado se envenena de vez, e o sintoma (`Unique constraint`) não
 * aponta para a causa.
 *
 * Depois: `AuditLog` (FK real para `User`), `LeadNote` (FK para `Lead` e
 * `User`), `Lead`, `Contact`, `PipelineStage`, `Membership`, `User`,
 * `Company`.
 */
async function limpar() {
  const usuarios = [USUARIO_A, USUARIO_B];
  const empresas = [EMPRESA_A, EMPRESA_B];

  await prisma.notification.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.leadNote.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.leadNote.deleteMany({ where: { autorId: { in: usuarios } } });
  await prisma.task.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.lead.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.contact.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.contact.deleteMany({
    where: { telefone: { in: [TELEFONE_A, TELEFONE_B, TELEFONE_NOVO_A, TELEFONE_NOVO_B] } },
  });
  await prisma.pipelineStage.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.membership.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.company.deleteMany({ where: { id: { in: empresas } } });
}

/** Recria leads, contatos e notas — o estado que cada caso assume. */
async function semearDadosMutaveis() {
  await prisma.notification.deleteMany({ where: { userId: { in: [USUARIO_A, USUARIO_B] } } });
  await prisma.leadNote.deleteMany({ where: { companyId: { in: [EMPRESA_A, EMPRESA_B] } } });
  await prisma.lead.deleteMany({ where: { companyId: { in: [EMPRESA_A, EMPRESA_B] } } });
  await prisma.contact.deleteMany({ where: { companyId: { in: [EMPRESA_A, EMPRESA_B] } } });

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
        stageId: ETAPA_A1,
        responsavelId: USUARIO_A,
        canal: "MANUAL",
      },
      {
        id: LEAD_B,
        companyId: EMPRESA_B,
        contactId: CONTATO_B,
        stageId: ETAPA_B1,
        responsavelId: USUARIO_B,
        canal: "MANUAL",
      },
    ],
  });

  await prisma.leadNote.createMany({
    data: [
      {
        id: NOTA_A,
        companyId: EMPRESA_A,
        leadId: LEAD_A,
        autorId: USUARIO_A,
        texto: "nota da empresa A",
      },
      {
        id: NOTA_B,
        companyId: EMPRESA_B,
        leadId: LEAD_B,
        autorId: USUARIO_B,
        texto: "nota da empresa B",
      },
      {
        id: NOTA_CRUZADA,
        companyId: EMPRESA_A,
        leadId: LEAD_A,
        autorId: USUARIO_B,
        texto: "nota da empresa A escrita por quem e da B",
      },
    ],
  });
}

beforeAll(async () => {
  await limpar();

  await prisma.company.createMany({
    data: [
      { id: EMPRESA_A, nome: "Empresa A do isolamento" },
      { id: EMPRESA_B, nome: "Empresa B do isolamento" },
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
  // dele que `companyIdDoUsuario` e `usuarioAtual()` tiram o escopo. Uma
  // fixture que cria `User` sem `Membership` produz um usuário sem empresa
  // nenhuma, e foi esse o bug latente corrigido em e67e1e6.
  await prisma.membership.createMany({
    data: [
      { userId: USUARIO_A, companyId: EMPRESA_A, papel: "ADMIN" },
      { userId: USUARIO_B, companyId: EMPRESA_B, papel: "ADMIN" },
    ],
  });

  await prisma.pipelineStage.createMany({
    data: [
      { id: ETAPA_A1, companyId: EMPRESA_A, nome: "A-1", ordem: ORDEM_A1, cor: "#111111" },
      { id: ETAPA_A2, companyId: EMPRESA_A, nome: "A-2", ordem: ORDEM_A2, cor: "#222222" },
      { id: ETAPA_B1, companyId: EMPRESA_B, nome: "B-1", ordem: ORDEM_B1, cor: "#333333" },
      { id: ETAPA_B2, companyId: EMPRESA_B, nome: "B-2", ordem: ORDEM_B2, cor: "#444444" },
    ],
  });
});

afterAll(async () => {
  await limpar();
});

describe("leitura escopada", () => {
  beforeAll(semearDadosMutaveis);

  it("listarLeads da empresa A não devolve lead da B — e devolve o da A", async () => {
    const { itens: naA } = await listarLeads(EMPRESA_A);
    expect(naA.map((l) => l.id)).toContain(LEAD_A);
    expect(naA.map((l) => l.id)).not.toContain(LEAD_B);

    // A segunda metade: o dado da empresa CERTA continua chegando.
    const { itens: naB } = await listarLeads(EMPRESA_B);
    expect(naB.map((l) => l.id)).toContain(LEAD_B);
    expect(naB.map((l) => l.id)).not.toContain(LEAD_A);
  });

  it("listarLeadsPorEtapa da A não expõe etapa nem lead da B", async () => {
    const { porEtapa } = await listarLeadsPorEtapa(EMPRESA_A);

    expect(Object.keys(porEtapa).sort()).toEqual([ETAPA_A1, ETAPA_A2].sort());
    expect(porEtapa[ETAPA_A1]?.map((l) => l.id)).toContain(LEAD_A);

    const { porEtapa: daB } = await listarLeadsPorEtapa(EMPRESA_B);
    expect(Object.keys(daB).sort()).toEqual([ETAPA_B1, ETAPA_B2].sort());
    expect(daB[ETAPA_B1]?.map((l) => l.id)).toContain(LEAD_B);
  });

  it("contarLeadsPorEtapa da A não conta lead da B", async () => {
    const daA = await contarLeadsPorEtapa(EMPRESA_A);
    expect(daA[ETAPA_A1]).toBe(1);
    expect(daA[ETAPA_B1]).toBeUndefined();

    const daB = await contarLeadsPorEtapa(EMPRESA_B);
    expect(daB[ETAPA_B1]).toBe(1);
    expect(daB[ETAPA_A1]).toBeUndefined();
  });

  it("listarNotas de um lead da B não devolve nada sob o escopo da A", async () => {
    expect(await listarNotas(LEAD_B, EMPRESA_A)).toEqual([]);

    const sobEscopoCerto = await listarNotas(LEAD_B, EMPRESA_B);
    expect(sobEscopoCerto.map((n) => n.id)).toEqual([NOTA_B]);
  });
});

describe("escrita escopada", () => {
  beforeAll(semearDadosMutaveis);

  it("moverEtapa não alcança lead de outra empresa — e move o da própria", async () => {
    await expect(
      moverEtapa({ leadId: LEAD_B, novaStageId: ETAPA_A2, autorId: USUARIO_A })
    ).rejects.toThrow();

    // O lead da B não mudou de etapa.
    const leadB = await prisma.lead.findUniqueOrThrow({ where: { id: LEAD_B } });
    expect(leadB.stageId).toBe(ETAPA_B1);

    const movido = await moverEtapa({
      leadId: LEAD_A,
      novaStageId: ETAPA_A2,
      autorId: USUARIO_A,
    });
    expect(movido.stageId).toBe(ETAPA_A2);
  });

  it("moverEtapa recusa etapa de OUTRA empresa para um lead próprio", async () => {
    await expect(
      moverEtapa({ leadId: LEAD_A, novaStageId: ETAPA_B2, autorId: USUARIO_A })
    ).rejects.toThrow(/Etapa não encontrada/);
  });

  it("atualizarLead não alcança lead de outra empresa — e atualiza o da própria", async () => {
    await expect(
      atualizarLead({
        leadId: LEAD_B,
        valorEstimado: "999,00",
        responsavelId: USUARIO_A,
        stageId: ETAPA_A1,
        autorId: USUARIO_A,
      })
    ).rejects.toThrow();

    const leadB = await prisma.lead.findUniqueOrThrow({ where: { id: LEAD_B } });
    expect(leadB.valorEstimado).toBeNull();

    const atualizado = await atualizarLead({
      leadId: LEAD_A,
      valorEstimado: "123,45",
      responsavelId: USUARIO_A,
      stageId: ETAPA_A1,
      autorId: USUARIO_A,
    });
    expect(atualizado.valorEstimado?.toString()).toBe("123.45");
  });

  it("atualizarLead recusa responsável de outra empresa (achado B)", async () => {
    await expect(
      atualizarLead({
        leadId: LEAD_A,
        valorEstimado: null,
        responsavelId: USUARIO_B,
        stageId: ETAPA_A1,
        autorId: USUARIO_A,
      })
    ).rejects.toThrow(/Responsável não encontrado/);

    const leadA = await prisma.lead.findUniqueOrThrow({ where: { id: LEAD_A } });
    expect(leadA.responsavelId).toBe(USUARIO_A);
  });

  it("arquivar/desarquivar não alcança lead de outra empresa — e alcança o da própria", async () => {
    await expect(arquivarLead({ leadId: LEAD_B, autorId: USUARIO_A })).rejects.toThrow();

    const leadB = await prisma.lead.findUniqueOrThrow({ where: { id: LEAD_B } });
    expect(leadB.arquivadoEm).toBeNull();

    const arquivado = await arquivarLead({ leadId: LEAD_A, autorId: USUARIO_A });
    expect(arquivado.arquivadoEm).toBeInstanceOf(Date);

    await expect(desarquivarLead({ leadId: LEAD_B, autorId: USUARIO_A })).rejects.toThrow();

    const desarquivado = await desarquivarLead({ leadId: LEAD_A, autorId: USUARIO_A });
    expect(desarquivado.arquivadoEm).toBeNull();
  });
});

describe("notas escopadas", () => {
  beforeAll(semearDadosMutaveis);

  it("adicionarNota não alcança lead de outra empresa — e grava no da própria", async () => {
    await expect(
      adicionarNota({ leadId: LEAD_B, autorId: USUARIO_A, texto: "invasao" })
    ).rejects.toThrow();

    const notasDaB = await prisma.leadNote.findMany({ where: { leadId: LEAD_B } });
    expect(notasDaB.map((n) => n.texto)).not.toContain("invasao");

    const nota = await adicionarNota({ leadId: LEAD_A, autorId: USUARIO_A, texto: "legitima" });
    expect(nota.companyId).toBe(EMPRESA_A);
  });

  it("editarNota não alcança nota de outra empresa MESMO com o autor certo", async () => {
    // `NOTA_CRUZADA` vive na empresa A e tem `autorId` de quem é da B: a regra
    // de dono passa, e só o escopo recusa. Sem este caso, a regra de dono
    // esconderia a falta de escopo.
    await expect(
      editarNota({ notaId: NOTA_CRUZADA, texto: "editada de fora", autorId: USUARIO_B })
    ).rejects.toThrow(/Nota não encontrada/);

    const intacta = await prisma.leadNote.findUniqueOrThrow({ where: { id: NOTA_CRUZADA } });
    expect(intacta.texto).toBe("nota da empresa A escrita por quem e da B");

    const editada = await editarNota({
      notaId: NOTA_B,
      texto: "editada por dentro",
      autorId: USUARIO_B,
    });
    expect(editada.texto).toBe("editada por dentro");
  });

  it("excluirNota não alcança nota de outra empresa MESMO com o autor certo", async () => {
    await expect(
      excluirNota({ notaId: NOTA_CRUZADA, autorId: USUARIO_B })
    ).rejects.toThrow(/Nota não encontrada/);

    expect(await prisma.leadNote.findUnique({ where: { id: NOTA_CRUZADA } })).not.toBeNull();

    await excluirNota({ notaId: NOTA_A, autorId: USUARIO_A });
    expect(await prisma.leadNote.findUnique({ where: { id: NOTA_A } })).toBeNull();
  });
});

describe("criação escopada", () => {
  beforeAll(semearDadosMutaveis);

  it("criarLead recusa responsável de outra empresa (achado B)", async () => {
    await expect(
      criarLead({
        nome: "Novo da A",
        telefone: TELEFONE_NOVO_A,
        responsavelId: USUARIO_B,
        autorId: USUARIO_A,
      })
    ).rejects.toThrow(/Responsável não encontrado/);

    expect(await prisma.contact.findUnique({ where: { telefone: TELEFONE_NOVO_A } })).toBeNull();
  });

  it("criarLead usa a primeira etapa DA EMPRESA do autor (achado D)", async () => {
    const lead = await criarLead({
      nome: "Novo da A",
      telefone: TELEFONE_NOVO_A,
      responsavelId: USUARIO_A,
      autorId: USUARIO_A,
    });

    expect(lead.companyId).toBe(EMPRESA_A);
    // A etapa de menor `ordem` DA EMPRESA A — não a de menor `ordem` do banco
    // inteiro, que hoje é a do seed (`ordem: 0`, `company-migracao-1a`).
    expect(lead.stageId).toBe(ETAPA_A1);

    const contato = await prisma.contact.findUniqueOrThrow({
      where: { telefone: TELEFONE_NOVO_A },
    });
    expect(contato.companyId).toBe(EMPRESA_A);
  });

  it("criarLeadDeWhatsapp recusa responsável de outra empresa e usa a etapa da própria", async () => {
    await expect(
      criarLeadDeWhatsapp({
        nome: "Whats da B",
        telefone: TELEFONE_NOVO_B,
        responsavelId: USUARIO_A,
        autorId: USUARIO_B,
      })
    ).rejects.toThrow(/Responsável não encontrado/);

    const lead = await criarLeadDeWhatsapp({
      nome: "Whats da B",
      telefone: TELEFONE_NOVO_B,
      responsavelId: USUARIO_B,
      autorId: USUARIO_B,
    });
    expect(lead.companyId).toBe(EMPRESA_B);
    expect(lead.stageId).toBe(ETAPA_B1);
  });

  it("encontrarOuCriarContact não reaproveita contato de outra empresa", async () => {
    // O contato com `TELEFONE_B` existe, mas na empresa B. Sob o escopo da A
    // ele não é encontrado — e, como `Contact.telefone` é `@unique` GLOBAL,
    // criar não é uma saída. A recusa é explícita, com o motivo na mensagem,
    // em vez de um `P2002` cru vindo do Postgres.
    await expect(
      encontrarOuCriarContact({ nome: "Roubo", telefone: TELEFONE_B, companyId: EMPRESA_A })
    ).rejects.toThrow(/outra empresa/i);

    const contato = await prisma.contact.findUniqueOrThrow({ where: { telefone: TELEFONE_B } });
    expect(contato.companyId).toBe(EMPRESA_B);
    expect(contato.nome).toBe("Contato da B");

    // A segunda metade: sob o escopo CERTO o contato é reaproveitado.
    const reaproveitado = await encontrarOuCriarContact({
      nome: "Nome novo ignorado",
      telefone: TELEFONE_B,
      companyId: EMPRESA_B,
    });
    expect(reaproveitado.id).toBe(CONTATO_B);
  });
});

describe("notificação do lead novo (achado E, a jusante do B)", () => {
  beforeAll(semearDadosMutaveis);

  /**
   * `notificarNovoLead` (`core/notifications/dispatch.ts`) grava
   * `Notification { companyId: lead.companyId, userId: lead.responsavel.id }`
   * sem conferir a empresa do responsável. Ele NÃO foi tocado nesta tarefa: o
   * que fecha o caso é o achado B — `Lead.responsavelId` só é escrito em
   * `core/leads/`, e os três pontos de escrita agora exigem `Membership` na
   * empresa do escopo, então o par (empresa do lead, empresa do responsável)
   * não tem mais como divergir por caminho de aplicação.
   *
   * Este caso prova a metade que dá para provar aqui: a notificação do lead
   * criado sai para alguém da MESMA empresa. A afirmação "nenhum caminho de
   * aplicação escreve `responsavelId` fora de `core/leads/`" é medição de
   * `grep`, registrada no relatório da tarefa — não algo que este teste
   * exercite.
   */
  it("a notificação do lead criado fica na empresa do lead", async () => {
    const lead = await criarLead({
      nome: "Novo da A",
      telefone: TELEFONE_NOVO_A,
      responsavelId: USUARIO_A,
      autorId: USUARIO_A,
    });

    const notificacoes = await prisma.notification.findMany({
      where: { userId: USUARIO_A, tipo: "NOVO_LEAD" },
    });
    const daqui = notificacoes.filter(
      (n) => (n.payload as { leadId?: string } | null)?.leadId === lead.id
    );

    expect(daqui).toHaveLength(1);
    expect(daqui[0]!.companyId).toBe(EMPRESA_A);

    const vinculo = await prisma.membership.findFirstOrThrow({
      where: { userId: daqui[0]!.userId },
    });
    expect(vinculo.companyId).toBe(daqui[0]!.companyId);
  });
});
