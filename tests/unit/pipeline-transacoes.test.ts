// Prisma MOCKADO de propósito, e este arquivo é o único lugar onde dá para
// provar o que precisa ser provado: a SEQUÊNCIA de escritas dentro da
// transação. Contra o Postgres real só se vê o resultado — e o resultado é
// idêntico com e sem o estacionamento negativo, quando funciona.
//
// O que é dublado mudou na conversão de `pipeline` (Ciclo 1a): antes era
// `@/lib/prisma`, agora é `prismaDaEmpresa` (`@/core/tenancy/escopo`), porque o
// serviço não alcança mais o cliente cru. A escolha NÃO é cosmética — dublar
// `@/lib/prisma` e deixar o escopo real por cima inverteria a ordem das
// extensões (o dublê ficaria por FORA e o escopo nunca rodaria), que é
// exatamente a armadilha registrada no topo de `tests/unit/lead-isolamento.test.ts`.
//
// O preço de dublar o escopo é que ESTE arquivo não prova nada sobre o
// `companyId` injetado: ele prova a FORMA da transação. Quem prova o isolamento
// é `tests/unit/pipeline-isolamento.test.ts`, contra duas empresas de verdade
// no Postgres. As duas coisas não cabem no mesmo teste.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

/** A empresa que o serviço passa a `prismaDaEmpresa`. Um valor só, conferido abaixo. */
const EMPRESA = "empresa-do-teste";

// `findFirst` faz TRÊS trabalhos diferentes no serviço convertido — achar a
// etapa por id (era `findUnique`), achar a vizinha por `ordem`, e achar a etapa
// de ganho. Um mock só para os três tornaria impossível dizer qual respondeu o
// quê, então o dublê despacha pelo formato do `where`.
const acharEtapaPorIdMock = vi.fn();
const acharVizinhaPorOrdemMock = vi.fn();
const acharEtapaDeGanhoMock = vi.fn();
const transactionMock = vi.fn();
const empresasPedidas: string[] = [];
// `lead.count` é a única contagem que sobrou FORA da transação em
// `excluirEtapa`: ela decide se o pedido precisa de destino, e é validação do
// pedido, não invariante. As invariantes passaram a ser decididas pela leitura
// travada de dentro (`SELECT ... FOR UPDATE`) — achado R1 da auditoria.
const leadCountMock = vi.fn();

function despacharFindFirst(args: { where?: Record<string, unknown> }) {
  const where = args?.where ?? {};
  if ("id" in where) return acharEtapaPorIdMock(args);
  if ("ehGanho" in where) return acharEtapaDeGanhoMock(args);
  if ("ordem" in where) return acharVizinhaPorOrdemMock(args);
  throw new Error(`findFirst sem forma conhecida de where: ${JSON.stringify(args)}`);
}

vi.mock("@/core/tenancy/escopo", () => ({
  prismaDaEmpresa: (companyId: string) => {
    empresasPedidas.push(companyId);
    return {
      pipelineStage: {
        findFirst: (a: { where?: Record<string, unknown> }) => despacharFindFirst(a),
      },
      lead: {
        count: (...a: unknown[]) => leadCountMock(...a),
      },
      $transaction: (...a: unknown[]) => transactionMock(...a),
    };
  },
}));

// `@/core/audit/log` alcança `@/lib/prisma` no topo do módulo, que exige
// DATABASE_URL — e este arquivo não toca banco nenhum, então não carrega .env.
// `dadosDeLinhaDeAuditoria` é função pura no original; aqui basta devolver algo
// reconhecível para a asserção de "a linha nasce DENTRO da transação".
vi.mock("@/core/audit/log", () => ({
  registrarAuditoria: vi.fn(),
  dadosDeLinhaDeAuditoria: (params: { acao: string }, companyId: string) => ({
    acao: params.acao,
    companyId,
  }),
}));

vi.mock("@/core/audit/alerta", () => ({ avaliarAtividadeSuspeita: vi.fn() }));

const { moverNaOrdem, ORDEM_ESTACIONAMENTO, definirEtapaDeFechamento, excluirEtapa } = await import(
  "../../src/core/pipeline/service"
);

/**
 * Executa o callback do `$transaction` com um `tx` espião.
 *
 * `funil` é o que a leitura travada devolve — a estrutura do funil no instante
 * em que o lock foi obtido. É parâmetro porque é a ÚNICA forma de simular a
 * corrida: quem chama diz "o mundo lá fora já mudou assim", e o teste confere
 * se `excluirEtapa` enxerga a mudança em vez do valor que leu antes.
 *
 * A consulta travante entra em `escritas` como as outras operações, para que a
 * ORDEM possa ser afirmada — travar tem que vir antes de qualquer escrita. Os
 * VALORES interpolados entram junto: sob escopo o `companyId` do `WHERE` do SQL
 * cru é escrito à mão, e é a única linha do módulo em que ele depende disso.
 */
function transacaoQueRegistra(
  escritas: unknown[],
  funil: Array<{ id: string; ehGanho: boolean }> = []
) {
  return async (callback: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      $queryRaw: (partes: TemplateStringsArray, ...valores: unknown[]) => {
        escritas.push({
          travou: partes.join("?").replace(/\s+/g, " ").trim(),
          valores,
        });
        return Promise.resolve(funil);
      },
      pipelineStage: {
        updateMany: (args: unknown) => {
          escritas.push(args);
          return Promise.resolve({ count: 0 });
        },
        deleteMany: (args: unknown) => {
          escritas.push({ apagou: args });
          return Promise.resolve({ count: 1 });
        },
      },
      lead: {
        updateMany: (args: unknown) => {
          escritas.push({ moveuLeads: args });
          return Promise.resolve({ count: 3 });
        },
      },
      auditLog: {
        create: (args: unknown) => {
          escritas.push({ auditou: args });
          return Promise.resolve({});
        },
      },
    };
    return callback(tx);
  };
}

beforeEach(() => {
  acharEtapaPorIdMock.mockReset();
  acharVizinhaPorOrdemMock.mockReset();
  acharEtapaDeGanhoMock.mockReset().mockResolvedValue(null);
  transactionMock.mockReset();
  leadCountMock.mockReset();
  empresasPedidas.length = 0;
  // Padrão: etapa sem lead nenhum, então `excluirEtapa` não exige destino.
  // Testes que precisarem de outro cenário sobrescrevem no próprio `it`.
  leadCountMock.mockResolvedValue(0);
});

describe("moverNaOrdem — a forma da transação", () => {
  it("emite TRÊS updates, com o estacionamento negativo no meio", async () => {
    acharEtapaPorIdMock.mockResolvedValue({ id: "etapa-b", ordem: 1, nome: "B" });
    acharVizinhaPorOrdemMock.mockResolvedValue({ id: "etapa-a", ordem: 0, nome: "A" });

    const escritas: unknown[] = [];
    transactionMock.mockImplementation(transacaoQueRegistra(escritas));

    await moverNaOrdem({ etapaId: "etapa-b", direcao: "cima", autorId: "admin-1", companyId: EMPRESA });

    expect(escritas).toHaveLength(3);
    // 1º: a etapa que se move sai do caminho.
    expect(escritas[0]).toEqual({ where: { id: "etapa-b" }, data: { ordem: ORDEM_ESTACIONAMENTO } });
    // 2º: a vizinha ocupa a posição que vagou.
    expect(escritas[1]).toEqual({ where: { id: "etapa-a" }, data: { ordem: 1 } });
    // 3º: a que se move ocupa a posição da vizinha.
    expect(escritas[2]).toEqual({ where: { id: "etapa-b" }, data: { ordem: 0 } });
  });

  it("o estacionamento é NEGATIVO — nenhuma etapa real pode ocupar essa posição", () => {
    expect(ORDEM_ESTACIONAMENTO).toBeLessThan(0);
  });

  it("o cliente é pedido para a empresa recebida, e para nenhuma outra", async () => {
    acharEtapaPorIdMock.mockResolvedValue({ id: "etapa-b", ordem: 1, nome: "B" });
    acharVizinhaPorOrdemMock.mockResolvedValue({ id: "etapa-a", ordem: 0, nome: "A" });
    transactionMock.mockImplementation(transacaoQueRegistra([]));

    await moverNaOrdem({ etapaId: "etapa-b", direcao: "cima", autorId: "admin-1", companyId: EMPRESA });

    // Um valor só, e é o que entrou pela assinatura. Se o serviço voltasse a
    // deduzir a empresa de qualquer outra origem, apareceria outra coisa aqui.
    expect([...new Set(empresasPedidas)]).toEqual([EMPRESA]);
  });

  it("recusa subir a primeira etapa: não há vizinha acima", async () => {
    acharEtapaPorIdMock.mockResolvedValue({ id: "etapa-a", ordem: 0, nome: "A" });
    acharVizinhaPorOrdemMock.mockResolvedValue(null);

    await expect(
      moverNaOrdem({ etapaId: "etapa-a", direcao: "cima", autorId: "admin-1", companyId: EMPRESA })
    ).rejects.toThrow(/já é a primeira/i);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("recusa descer a última etapa: não há vizinha abaixo", async () => {
    acharEtapaPorIdMock.mockResolvedValue({ id: "etapa-z", ordem: 9, nome: "Z" });
    acharVizinhaPorOrdemMock.mockResolvedValue(null);

    await expect(
      moverNaOrdem({ etapaId: "etapa-z", direcao: "baixo", autorId: "admin-1", companyId: EMPRESA })
    ).rejects.toThrow(/já é a última/i);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  // Buracos em `ordem` são legais (apagar a de ordem 2 deixa 0,1,3,4). A
  // vizinha é a de ordem imediatamente menor/maior, não `ordem - 1`.
  it("acha a vizinha por comparação, não por aritmética — funciona com buracos", async () => {
    acharEtapaPorIdMock.mockResolvedValue({ id: "etapa-d", ordem: 4, nome: "D" });
    acharVizinhaPorOrdemMock.mockResolvedValue({ id: "etapa-b", ordem: 1, nome: "B" });

    const escritas: unknown[] = [];
    transactionMock.mockImplementation(transacaoQueRegistra(escritas));

    await moverNaOrdem({ etapaId: "etapa-d", direcao: "cima", autorId: "admin-1", companyId: EMPRESA });

    expect(escritas[1]).toEqual({ where: { id: "etapa-b" }, data: { ordem: 4 } });
    expect(escritas[2]).toEqual({ where: { id: "etapa-d" }, data: { ordem: 1 } });
    expect(acharVizinhaPorOrdemMock.mock.calls[0][0]).toMatchObject({
      where: { ordem: { lt: 4 } },
      orderBy: { ordem: "desc" },
    });
  });
});

describe("definirEtapaDeFechamento — a forma da transação", () => {
  it("desliga TODAS antes de ligar a escolhida, na mesma transação", async () => {
    acharEtapaPorIdMock.mockResolvedValue({ id: "etapa-nova", ordem: 3, nome: "Negociação", ehGanho: false });

    const escritas: unknown[] = [];
    transactionMock.mockImplementation(transacaoQueRegistra(escritas));

    await definirEtapaDeFechamento({ etapaId: "etapa-nova", autorId: "admin-1", companyId: EMPRESA });

    expect(escritas).toHaveLength(2);
    // A ordem importa: ligar antes de desligar deixaria duas flags ativas no
    // meio da transação, e um erro no segundo passo persistiria as duas — que é
    // exatamente o bug que `confirmarInvarianteEhGanho` existe para alarmar.
    expect(escritas[0]).toEqual({ where: { ehGanho: true }, data: { ehGanho: false } });
    expect(escritas[1]).toEqual({ where: { id: "etapa-nova" }, data: { ehGanho: true } });
  });

  it("recusa etapa que não existe mais", async () => {
    acharEtapaPorIdMock.mockResolvedValue(null);
    await expect(
      definirEtapaDeFechamento({ etapaId: "some", autorId: "admin-1", companyId: EMPRESA })
    ).rejects.toThrow(/não existe mais/i);
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

// Substitui a sabotagem do brief que rodaria contra a etapa "Fechado" REAL de
// produção: com a guarda removida e a etapa sem leads, o teste real a apagaria
// do banco de produção. Aqui, com Prisma mockado, a mesma invariante é provada
// sem tocar em nenhuma linha de verdade.
//
// Este bloco é também o único lugar onde a corrida do achado R1 é reproduzível:
// contra o Postgres real, provar que duas exclusões simultâneas esvaziam o funil
// exigiria esvaziar o funil de produção. Com o `tx` espião, "o mundo mudou entre
// a leitura de fora e o lock" é só um argumento.
describe("excluirEtapa — as invariantes vivem sob a leitura travada", () => {
  /** Como `findUnique` (FORA da transação) enxerga a etapa: sem a flag, apagável. */
  const COMO_FOI_LIDA = { id: "etapa-b", ordem: 1, nome: "B", cor: "#0f62fe", ehGanho: false };

  it("a PRIMEIRA operação dentro da transação é travar o funil, com FOR UPDATE", async () => {
    acharEtapaPorIdMock.mockResolvedValue(COMO_FOI_LIDA);
    const escritas: unknown[] = [];
    transactionMock.mockImplementation(
      transacaoQueRegistra(escritas, [
        { id: "etapa-a", ehGanho: true },
        { id: "etapa-b", ehGanho: false },
      ])
    );

    await excluirEtapa({ etapaId: "etapa-b", destinoId: null, autorId: "admin-1", companyId: EMPRESA });

    // Sem `FOR UPDATE` a consulta não tranca nada e as três guardas abaixo
    // voltam a decidir sobre dado que outra transação pode ter mudado.
    expect(escritas[0]).toMatchObject({ travou: expect.stringContaining("FOR UPDATE") });
    expect(escritas[0]).toMatchObject({ travou: expect.stringContaining('FROM "PipelineStage"') });
    // O SQL cru é o único ponto do módulo que o escopo NÃO alcança
    // (`$queryRaw` não passa por `$allOperations`), então o `companyId` é
    // escrito à mão — e ele entra como BIND do template marcado, não
    // concatenado. Sem este filtro a trava pegava a tabela inteira e as três
    // guardas abaixo passavam a valer sobre o funil global.
    expect(escritas[0]).toMatchObject({
      travou: expect.stringContaining('WHERE "companyId" = ?'),
      valores: [EMPRESA],
    });
    // Travar vem antes de escrever, senão a trava não protege a decisão.
    expect(escritas[1]).toEqual({ apagou: { where: { id: "etapa-b" } } });
    // E a linha de auditoria nasce DENTRO da transação, depois da exclusão:
    // a etapa deixa de existir, então ou o rastro sai junto com ela ou não sai.
    expect(escritas[2]).toEqual({
      auditou: { data: { acao: "excluir_etapa", companyId: EMPRESA } },
    });
  });

  it("virou a etapa de fechamento DEPOIS da leitura de fora: a trava pega, nada é apagado", async () => {
    acharEtapaPorIdMock.mockResolvedValue(COMO_FOI_LIDA);
    const escritas: unknown[] = [];
    // A leitura travada já enxerga o commit da outra transação.
    transactionMock.mockImplementation(
      transacaoQueRegistra(escritas, [
        { id: "etapa-a", ehGanho: false },
        { id: "etapa-b", ehGanho: true },
      ])
    );

    await expect(
      excluirEtapa({ etapaId: "etapa-b", destinoId: null, autorId: "admin-1", companyId: EMPRESA })
    ).rejects.toThrow(/fechamento/i);

    // Travou, leu, recusou: nenhuma escrita depois da consulta travante.
    expect(escritas).toHaveLength(1);
  });

  it("sobrou uma etapa só: recusa esvaziar o funil", async () => {
    acharEtapaPorIdMock.mockResolvedValue(COMO_FOI_LIDA);
    const escritas: unknown[] = [];
    // A outra transação já apagou a irmã enquanto esta esperava o lock.
    transactionMock.mockImplementation(
      transacaoQueRegistra(escritas, [{ id: "etapa-b", ehGanho: false }])
    );

    await expect(
      excluirEtapa({ etapaId: "etapa-b", destinoId: null, autorId: "admin-1", companyId: EMPRESA })
    ).rejects.toThrow(/pelo menos uma etapa/i);
    expect(escritas).toHaveLength(1);
  });

  it("a etapa sumiu entre a leitura de fora e o lock", async () => {
    acharEtapaPorIdMock.mockResolvedValue(COMO_FOI_LIDA);
    const escritas: unknown[] = [];
    transactionMock.mockImplementation(
      transacaoQueRegistra(escritas, [
        { id: "etapa-a", ehGanho: true },
        { id: "etapa-c", ehGanho: false },
      ])
    );

    await expect(
      excluirEtapa({ etapaId: "etapa-b", destinoId: null, autorId: "admin-1", companyId: EMPRESA })
    ).rejects.toThrow(/não existe mais/i);
    expect(escritas).toHaveLength(1);
  });

  it("destino apagado no intervalo vira erro de domínio, não chave estrangeira morta", async () => {
    acharEtapaPorIdMock.mockResolvedValue(COMO_FOI_LIDA);
    leadCountMock.mockResolvedValue(3); // com leads, o destino passa a ser exigido
    const escritas: unknown[] = [];
    // `etapa-destino` não está mais no funil travado.
    transactionMock.mockImplementation(
      transacaoQueRegistra(escritas, [
        { id: "etapa-a", ehGanho: true },
        { id: "etapa-b", ehGanho: false },
      ])
    );

    await expect(
      excluirEtapa({ etapaId: "etapa-b", destinoId: "etapa-destino", autorId: "admin-1", companyId: EMPRESA })
    ).rejects.toThrow(/destino/i);
    expect(escritas).toHaveLength(1);
  });

  it("caminho feliz com destino: move os leads, depois apaga a etapa", async () => {
    acharEtapaPorIdMock.mockResolvedValue(COMO_FOI_LIDA);
    leadCountMock.mockResolvedValue(3);
    const escritas: unknown[] = [];
    transactionMock.mockImplementation(
      transacaoQueRegistra(escritas, [
        { id: "etapa-a", ehGanho: true },
        { id: "etapa-b", ehGanho: false },
      ])
    );

    const movidos = await excluirEtapa({
      etapaId: "etapa-b",
      destinoId: "etapa-a",
      autorId: "admin-1",
      companyId: EMPRESA,
    });

    expect(movidos).toBe(3);
    expect(escritas[1]).toEqual({
      moveuLeads: { where: { stageId: "etapa-b" }, data: { stageId: "etapa-a" } },
    });
    expect(escritas[2]).toEqual({ apagou: { where: { id: "etapa-b" } } });
  });
});
