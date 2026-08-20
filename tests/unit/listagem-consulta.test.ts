// Prova que o teto chega à CONSULTA, não só ao retorno.
//
// Arquivo separado de `listagem.test.ts` (que usa o Postgres real) porque aqui
// o Prisma é mockado de propósito — e é o único jeito de provar o que precisa
// ser provado.
//
// A sabotagem que motivou este arquivo: removendo `take` do `findMany`, os
// seis testes de `listagem.test.ts` continuaram verdes. E com razão —
// `aplicarTeto` fatia em memória, então o valor DEVOLVIDO fica idêntico com ou
// sem `take`. Só que o `take` existe justamente para o banco não carregar a
// tabela inteira: sem ele o teto vira enfeite, e o problema que ele deveria
// resolver (uma listagem que cresce sem freio junto com o banco) continua
// inteiro, invisível para qualquer teste que olhe só o retorno.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { semComentarios } from "./helpers/codigo-fonte";

vi.mock("server-only", () => ({}));

const EMPRESA = "empresa-do-teste";

const findManyMock = vi.fn();
const groupByMock = vi.fn();

// O mock é do CLIENTE ESCOPADO, não do `prisma` cru — `queries.ts` deixou de
// importar `@/lib/prisma` no Ciclo 1a (Task 4). `prismaDaEmpresa` devolve o
// banco falso direto, sem a extensão do Prisma no caminho: nada aqui prova que
// `companyId` chega à consulta, e provar isso é
// `tests/unit/lead-isolamento.test.ts`, contra duas empresas de verdade. O que
// este arquivo prova continua sendo a FORMA da consulta — que o `take` existe
// e que a contagem do painel não passa por `findMany`.
vi.mock("@/core/tenancy/escopo", () => ({
  prismaDaEmpresa: () => ({
    lead: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      groupBy: (...args: unknown[]) => groupByMock(...args),
    },
  }),
}));

const { listarLeads, contarLeadsPorEtapa } = await import("../../src/core/leads/queries");
const { LIMITE_LISTAGEM } = await import("../../src/core/listagem");

beforeEach(() => {
  findManyMock.mockReset().mockResolvedValue([]);
  groupByMock.mockReset().mockResolvedValue([]);
});

/** Argumento único que `listarLeads` passou ao `findMany`. */
function argumentos(): Record<string, unknown> {
  return findManyMock.mock.calls[0][0] as Record<string, unknown>;
}

describe("listarLeads — forma da consulta", () => {
  it("pede ao banco LIMITE + 1 linhas por padrao", async () => {
    await listarLeads(EMPRESA);

    expect(argumentos().take).toBe(LIMITE_LISTAGEM + 1);
  });

  // O "+1" não é detalhe de implementação: é o que distingue "exatamente
  // `limite` linhas" de "`limite` e tem mais". Pedir exatamente `limite`
  // tornaria impossível saber se truncou, e o aviso na tela viraria chute.
  it("com limite explicito, pede limite + 1 — nunca o limite cru", async () => {
    await listarLeads(EMPRESA, { limite: 25 });

    expect(argumentos().take).toBe(26);
  });

  it("semTeto NAO manda take nenhum — a exportacao precisa de tudo", async () => {
    await listarLeads(EMPRESA, { semTeto: true });

    expect(argumentos().take).toBeUndefined();
  });

  it("o teto nao atropela o filtro de arquivados", async () => {
    await listarLeads(EMPRESA);
    expect(argumentos().where).toEqual({ arquivadoEm: null });

    findManyMock.mockClear();
    await listarLeads(EMPRESA, { incluirArquivados: true });
    expect(argumentos().where).toEqual({});
  });
});

/**
 * O painel conta no BANCO — e este arquivo é o único lugar onde isso dá para
 * provar.
 *
 * Um teste contra o Postgres real comparando a soma das contagens com
 * `lead.count()` passaria com a versão QUEBRADA também: o banco de
 * desenvolvimento tem dezenas de leads, o teto é 1000, e o corte nunca
 * acontece. É o "teste que não exercita" da tabela de armadilhas da auditoria,
 * na forma mais convincente — verde, contra dado real, e provando nada.
 *
 * O defeito só aparece acima de 1000 leads. Semear 1001 linhas num banco
 * compartilhado com produção para provar isso seria pior que o defeito. Então
 * a prova é sobre a FORMA da consulta: `groupBy` conta no Postgres e não tem
 * `take`; `findMany` é a função que carrega linha e carrega teto junto. Se
 * alguém devolver esta contagem para `findMany`, é aqui que fica vermelho.
 */
describe("contarLeadsPorEtapa — o painel conta sem teto", () => {
  it("usa groupBy, e nao findMany", async () => {
    await contarLeadsPorEtapa(EMPRESA);

    expect(groupByMock).toHaveBeenCalledTimes(1);
    // A asserção que dá o alarme de verdade: `findMany` é o que traz o teto
    // junto, sempre. Contagem que passa por ele volta a mentir acima de 1000.
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("agrupa por etapa e nao limita quantas etapas volta", async () => {
    await contarLeadsPorEtapa(EMPRESA);

    const args = groupByMock.mock.calls[0][0] as Record<string, unknown>;
    expect(args.by).toEqual(["stageId"]);
    expect(args.take).toBeUndefined();
    expect(args.skip).toBeUndefined();
  });

  it("traduz a contagem do Prisma para um mapa de stageId para numero", async () => {
    groupByMock.mockResolvedValue([
      { stageId: "etapa-a", _count: { _all: 7 } },
      { stageId: "etapa-b", _count: { _all: 0 } },
    ]);

    expect(await contarLeadsPorEtapa(EMPRESA)).toEqual({ "etapa-a": 7, "etapa-b": 0 });
  });

  it("a pagina do painel usa a contagem, nunca a listagem com teto", () => {
    // Verificação TEXTUAL do arquivo, e não render do Server Component.
    //
    // Sem ela, os três testes acima continuam verdes com o painel voltando a
    // `listarLeadsPorEtapa().length` — eles provam que a função certa está
    // correta, não que a página a chama. O defeito original era exatamente
    // esse: a consulta devolvia `truncado` e a página descartava.
    //
    // Renderizar o painel provaria mais, e custaria mockar sessão, Prisma,
    // etapas e tarefas para checar uma linha de import. A varredura é grosseira
    // e pega o caso que aconteceu de verdade.
    //
    // `semComentarios` não é zelo: o próprio painel explica, em comentário, que
    // usa `contarLeadsPorEtapa` "e não `listarLeadsPorEtapa`", e o docblock do
    // arquivo cita a função antiga ao justificar por que leads não são
    // escopados por usuário. Sem o filtro, este teste reprova a documentação da
    // regra que ele existe para defender — foi assim que ele falhou na
    // primeira execução.
    const painel = semComentarios(
      readFileSync(join(process.cwd(), "src", "app", "(painel)", "page.tsx"), "utf8")
    );

    expect(painel).toContain("contarLeadsPorEtapa");
    expect(painel).not.toContain("listarLeadsPorEtapa");
  });
});
