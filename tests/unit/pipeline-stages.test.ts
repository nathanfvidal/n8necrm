// Este arquivo (junto com seed.test.ts, rate-limit.test.ts e
// audit-log.test.ts) usa o Prisma real contra o Postgres do Supabase, então
// carrega DATABASE_URL do .env aqui — não em vitest.config.ts — para não
// injetar credenciais em testes que não tocam banco. Precisa ser o primeiro
// import: os módulos abaixo (via src/lib/prisma.ts → src/lib/env.ts) leem
// process.env.DATABASE_URL no top-level.
import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server" que o Next.js aplica no build — fora desse pipeline (aqui,
// sob Vitest) ele sempre lança, independente de quem importa (ver
// tests/unit/storage.test.ts, onde este mock foi documentado pela primeira
// vez). `src/lib/prisma.ts` ganhou `import "server-only"` na Task 17 (fix
// round 2/5).
vi.mock("server-only", () => ({}));

import { listarEtapas, contarLeadsQueSeguramEtapa } from "../../src/core/pipeline/stages";
import { prisma } from "../../src/lib/prisma";

/**
 * ## Por que a fixture é própria, e não mais `seed()`
 *
 * Até a conversão de `pipeline` (Ciclo 1a) este arquivo chamava `seed()` e
 * media `listarEtapas()` contra `prisma.pipelineStage.findMany({ orderBy })` —
 * A MESMA CONSULTA que a função sob teste fazia, só que escrita duas vezes.
 * Isso é a armadilha registrada no commit 63cecd2: expectativa calculada com a
 * consulta do próprio código não prova nada, porque ela espelha o defeito. Com
 * `listarEtapas` sem escopo, as duas devolviam o banco inteiro e casavam
 * perfeitamente.
 *
 * Agora as etapas são criadas aqui, com ids FIXOS, numa empresa própria, e as
 * asserções são sobre esses ids. Chamar `seed()` também deixou de ser
 * necessário — e isso é ganho à parte: ele escreve em `User`, `Contact` e
 * `Lead` da empresa de desenvolvimento a cada execução da suíte.
 *
 * A faixa de `ordem` é alta (9500+) por dois motivos: `PipelineStage` ainda tem
 * `@@unique([ordem])` GLOBAL (pendência registrada do ciclo, não desta tarefa),
 * então a fixture não pode colidir com as etapas do seed (`ordem` 0-3 em
 * `company-migracao-1a`); e, se ela usasse a mesma faixa, um caso poderia
 * passar por acidente.
 */
const P = "stages-t5";
const EMPRESA = `${P}-company`;
const OUTRA_EMPRESA = `${P}-company-vizinha`;
const ETAPA_MEIO = `${P}-stage-meio`;
const ETAPA_PRIMEIRA = `${P}-stage-primeira`;
const ETAPA_ULTIMA = `${P}-stage-ultima`;
const ETAPA_DA_VIZINHA = `${P}-stage-vizinha`;
const CONTATO = `${P}-contact`;
const LEAD_ARQUIVADO = `${P}-lead-arquivado`;
const TELEFONE = "11955550001";

const ORDEM_PRIMEIRA = 9501;
const ORDEM_MEIO = 9502;
const ORDEM_ULTIMA = 9503;
const ORDEM_DA_VIZINHA = 9601;

/** Ordem ditada pelas FKs. Sem `Lead` antes de `Contact`/`PipelineStage`, o delete é barrado. */
async function limpar() {
  const empresas = [EMPRESA, OUTRA_EMPRESA];
  await prisma.lead.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.contact.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.contact.deleteMany({ where: { telefone: TELEFONE } });
  await prisma.pipelineStage.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.company.deleteMany({ where: { id: { in: empresas } } });
}

beforeAll(async () => {
  await limpar();

  await prisma.company.createMany({
    data: [
      { id: EMPRESA, nome: "Empresa das etapas" },
      { id: OUTRA_EMPRESA, nome: "Empresa vizinha das etapas" },
    ],
  });

  // Criadas FORA de ordem de propósito: se `listarEtapas` perdesse o
  // `orderBy: { ordem: "asc" }`, a ordem de inserção passaria — e ela é
  // diferente da esperada.
  await prisma.pipelineStage.createMany({
    data: [
      { id: ETAPA_MEIO, companyId: EMPRESA, nome: "Meio", ordem: ORDEM_MEIO, cor: "#222222" },
      { id: ETAPA_ULTIMA, companyId: EMPRESA, nome: "Última", ordem: ORDEM_ULTIMA, cor: "#333333" },
      {
        id: ETAPA_PRIMEIRA,
        companyId: EMPRESA,
        nome: "Primeira",
        ordem: ORDEM_PRIMEIRA,
        cor: "#111111",
      },
      {
        id: ETAPA_DA_VIZINHA,
        companyId: OUTRA_EMPRESA,
        nome: "Da vizinha",
        ordem: ORDEM_DA_VIZINHA,
        cor: "#444444",
      },
    ],
  });

  await prisma.contact.create({
    data: { id: CONTATO, companyId: EMPRESA, nome: "Contato das etapas", telefone: TELEFONE },
  });

  // Arquivado de propósito: é o que separa `contarLeadsQueSeguramEtapa` de
  // `contarLeadsPorEtapa`.
  await prisma.lead.create({
    data: {
      id: LEAD_ARQUIVADO,
      companyId: EMPRESA,
      contactId: CONTATO,
      stageId: ETAPA_MEIO,
      canal: "MANUAL",
      arquivadoEm: new Date(),
    },
  });
}, 60_000);

afterAll(async () => {
  await limpar();
}, 60_000);

describe("listarEtapas", () => {
  it("devolve as etapas DA EMPRESA, na ordem de `ordem`", async () => {
    const etapas = await listarEtapas(EMPRESA);

    // Ids fixos, não uma segunda consulta: a ordem esperada é a que a fixture
    // declarou, e ela é diferente da ordem de inserção.
    expect(etapas.map((e) => e.id)).toEqual([ETAPA_PRIMEIRA, ETAPA_MEIO, ETAPA_ULTIMA]);
    expect(etapas.map((e) => e.ordem)).toEqual([ORDEM_PRIMEIRA, ORDEM_MEIO, ORDEM_ULTIMA]);
  });

  it("não devolve etapa de outra empresa, e a vizinha continua vendo a dela", async () => {
    const daEmpresa = await listarEtapas(EMPRESA);
    expect(daEmpresa.map((e) => e.id)).not.toContain(ETAPA_DA_VIZINHA);

    // A segunda metade: o funil da empresa CERTA continua chegando. Sem ela,
    // um `listarEtapas` que devolvesse lista vazia para todo mundo passaria.
    const daVizinha = await listarEtapas(OUTRA_EMPRESA);
    expect(daVizinha.map((e) => e.id)).toEqual([ETAPA_DA_VIZINHA]);
  });

  it("a ordem é por `ordem`, não incidental: chamadas repetidas devolvem a mesma sequência", async () => {
    const primeiraChamada = await listarEtapas(EMPRESA);
    const segundaChamada = await listarEtapas(EMPRESA);

    expect(segundaChamada.map((e) => e.id)).toEqual(primeiraChamada.map((e) => e.id));

    for (let i = 1; i < primeiraChamada.length; i++) {
      expect(primeiraChamada[i].ordem).toBeGreaterThan(primeiraChamada[i - 1].ordem);
    }
  });

  it("a primeira etapa devolvida é a de menor `ordem` (Task 13 cria todo Lead novo nela)", async () => {
    const etapas = await listarEtapas(EMPRESA);
    expect(etapas[0].id).toBe(ETAPA_PRIMEIRA);
    expect(etapas[0].ordem).toBe(Math.min(...etapas.map((e) => e.ordem)));
  });
});

describe("contarLeadsQueSeguramEtapa", () => {
  it("conta arquivados junto — é o número que a chave estrangeira enxerga", async () => {
    const { contarLeadsPorEtapa } = await import("../../src/core/leads/queries");
    const ativos = await contarLeadsPorEtapa(EMPRESA);
    const seguram = await contarLeadsQueSeguramEtapa(EMPRESA);

    // A distinção inteira em duas linhas: o funil não vê o arquivado, a FK vê.
    expect(ativos[ETAPA_MEIO] ?? 0).toBe(0);
    expect(seguram[ETAPA_MEIO]).toBe(1);
  });

  it("não conta lead de outra empresa, nem devolve chave de etapa de fora", async () => {
    const seguram = await contarLeadsQueSeguramEtapa(EMPRESA);
    expect(Object.keys(seguram)).not.toContain(ETAPA_DA_VIZINHA);

    // A segunda metade: a vizinha, que não tem lead nenhum, recebe mapa vazio —
    // e não o mapa da EMPRESA.
    const daVizinha = await contarLeadsQueSeguramEtapa(OUTRA_EMPRESA);
    expect(Object.keys(daVizinha)).not.toContain(ETAPA_MEIO);
  });
});
