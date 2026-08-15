// Prisma MOCKADO de propósito, e este arquivo é o único lugar onde dá para
// provar o que precisa ser provado: a SEQUÊNCIA de escritas dentro da
// transação. Contra o Postgres real só se vê o resultado — e o resultado é
// idêntico com e sem o estacionamento negativo, quando funciona.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const updateMock = vi.fn();
const updateManyMock = vi.fn();
const findUniqueMock = vi.fn();
const findFirstMock = vi.fn();
const transactionMock = vi.fn();
// `lead.count` é a única contagem que sobrou FORA da transação em
// `excluirEtapa`: ela decide se o pedido precisa de destino, e é validação do
// pedido, não invariante. As invariantes passaram a ser decididas pela leitura
// travada de dentro (`SELECT ... FOR UPDATE`) — achado R1 da auditoria.
const leadCountMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pipelineStage: {
      update: (...a: unknown[]) => updateMock(...a),
      updateMany: (...a: unknown[]) => updateManyMock(...a),
      findUnique: (...a: unknown[]) => findUniqueMock(...a),
      findFirst: (...a: unknown[]) => findFirstMock(...a),
    },
    lead: {
      count: (...a: unknown[]) => leadCountMock(...a),
    },
    $transaction: (...a: unknown[]) => transactionMock(...a),
  },
}));

vi.mock("@/core/audit/log", () => ({
  registrarAuditoria: vi.fn(),
  gravarLinhaDeAuditoria: vi.fn(),
}));

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
 * ORDEM possa ser afirmada — travar tem que vir antes de qualquer escrita.
 */
function transacaoQueRegistra(
  escritas: unknown[],
  funil: Array<{ id: string; ehGanho: boolean }> = []
) {
  return async (callback: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      $queryRaw: (partes: TemplateStringsArray) => {
        escritas.push({ travou: partes.join("?").replace(/\s+/g, " ").trim() });
        return Promise.resolve(funil);
      },
      pipelineStage: {
        update: (args: unknown) => {
          escritas.push(args);
          return Promise.resolve({});
        },
        updateMany: (args: unknown) => {
          escritas.push(args);
          return Promise.resolve({ count: 0 });
        },
        delete: (args: unknown) => {
          escritas.push({ apagou: args });
          return Promise.resolve({});
        },
      },
      lead: {
        updateMany: (args: unknown) => {
          escritas.push({ moveuLeads: args });
          return Promise.resolve({ count: 3 });
        },
      },
    };
    return callback(tx);
  };
}

beforeEach(() => {
  updateMock.mockReset();
  updateManyMock.mockReset();
  findUniqueMock.mockReset();
  findFirstMock.mockReset();
  transactionMock.mockReset();
  leadCountMock.mockReset();
  // Padrão: etapa sem lead nenhum, então `excluirEtapa` não exige destino.
  // Testes que precisarem de outro cenário sobrescrevem no próprio `it`.
  leadCountMock.mockResolvedValue(0);
});

describe("moverNaOrdem — a forma da transação", () => {
  it("emite TRÊS updates, com o estacionamento negativo no meio", async () => {
    findUniqueMock.mockResolvedValue({ id: "etapa-b", ordem: 1, nome: "B" });
    findFirstMock.mockResolvedValue({ id: "etapa-a", ordem: 0, nome: "A" });

    const escritas: unknown[] = [];
    transactionMock.mockImplementation(transacaoQueRegistra(escritas));

    await moverNaOrdem({ etapaId: "etapa-b", direcao: "cima", autorId: "admin-1" });

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

  it("recusa subir a primeira etapa: não há vizinha acima", async () => {
    findUniqueMock.mockResolvedValue({ id: "etapa-a", ordem: 0, nome: "A" });
    findFirstMock.mockResolvedValue(null);

    await expect(
      moverNaOrdem({ etapaId: "etapa-a", direcao: "cima", autorId: "admin-1" })
    ).rejects.toThrow(/já é a primeira/i);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("recusa descer a última etapa: não há vizinha abaixo", async () => {
    findUniqueMock.mockResolvedValue({ id: "etapa-z", ordem: 9, nome: "Z" });
    findFirstMock.mockResolvedValue(null);

    await expect(
      moverNaOrdem({ etapaId: "etapa-z", direcao: "baixo", autorId: "admin-1" })
    ).rejects.toThrow(/já é a última/i);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  // Buracos em `ordem` são legais (apagar a de ordem 2 deixa 0,1,3,4). A
  // vizinha é a de ordem imediatamente menor/maior, não `ordem - 1`.
  it("acha a vizinha por comparação, não por aritmética — funciona com buracos", async () => {
    findUniqueMock.mockResolvedValue({ id: "etapa-d", ordem: 4, nome: "D" });
    findFirstMock.mockResolvedValue({ id: "etapa-b", ordem: 1, nome: "B" });

    const escritas: unknown[] = [];
    transactionMock.mockImplementation(transacaoQueRegistra(escritas));

    await moverNaOrdem({ etapaId: "etapa-d", direcao: "cima", autorId: "admin-1" });

    expect(escritas[1]).toEqual({ where: { id: "etapa-b" }, data: { ordem: 4 } });
    expect(escritas[2]).toEqual({ where: { id: "etapa-d" }, data: { ordem: 1 } });
    expect(findFirstMock.mock.calls[0][0]).toMatchObject({
      where: { ordem: { lt: 4 } },
      orderBy: { ordem: "desc" },
    });
  });
});

describe("definirEtapaDeFechamento — a forma da transação", () => {
  it("desliga TODAS antes de ligar a escolhida, na mesma transação", async () => {
    findUniqueMock.mockResolvedValue({ id: "etapa-nova", ordem: 3, nome: "Negociação", ehGanho: false });

    const escritas: unknown[] = [];
    transactionMock.mockImplementation(transacaoQueRegistra(escritas));

    await definirEtapaDeFechamento({ etapaId: "etapa-nova", autorId: "admin-1" });

    expect(escritas).toHaveLength(2);
    // A ordem importa: ligar antes de desligar deixaria duas flags ativas no
    // meio da transação, e um erro no segundo passo persistiria as duas — que é
    // exatamente o bug que `confirmarInvarianteEhGanho` existe para alarmar.
    expect(escritas[0]).toEqual({ where: { ehGanho: true }, data: { ehGanho: false } });
    expect(escritas[1]).toEqual({ where: { id: "etapa-nova" }, data: { ehGanho: true } });
  });

  it("recusa etapa que não existe mais", async () => {
    findUniqueMock.mockResolvedValue(null);
    await expect(
      definirEtapaDeFechamento({ etapaId: "some", autorId: "admin-1" })
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
    findUniqueMock.mockResolvedValue(COMO_FOI_LIDA);
    const escritas: unknown[] = [];
    transactionMock.mockImplementation(
      transacaoQueRegistra(escritas, [
        { id: "etapa-a", ehGanho: true },
        { id: "etapa-b", ehGanho: false },
      ])
    );

    await excluirEtapa({ etapaId: "etapa-b", destinoId: null, autorId: "admin-1" });

    // Sem `FOR UPDATE` a consulta não tranca nada e as três guardas abaixo
    // voltam a decidir sobre dado que outra transação pode ter mudado.
    expect(escritas[0]).toMatchObject({ travou: expect.stringContaining("FOR UPDATE") });
    expect(escritas[0]).toMatchObject({ travou: expect.stringContaining('FROM "PipelineStage"') });
    // Travar vem antes de escrever, senão a trava não protege a decisão.
    expect(escritas[1]).toEqual({ apagou: { where: { id: "etapa-b" } } });
  });

  it("virou a etapa de fechamento DEPOIS da leitura de fora: a trava pega, nada é apagado", async () => {
    findUniqueMock.mockResolvedValue(COMO_FOI_LIDA);
    const escritas: unknown[] = [];
    // A leitura travada já enxerga o commit da outra transação.
    transactionMock.mockImplementation(
      transacaoQueRegistra(escritas, [
        { id: "etapa-a", ehGanho: false },
        { id: "etapa-b", ehGanho: true },
      ])
    );

    await expect(
      excluirEtapa({ etapaId: "etapa-b", destinoId: null, autorId: "admin-1" })
    ).rejects.toThrow(/fechamento/i);

    // Travou, leu, recusou: nenhuma escrita depois da consulta travante.
    expect(escritas).toHaveLength(1);
  });

  it("sobrou uma etapa só: recusa esvaziar o funil", async () => {
    findUniqueMock.mockResolvedValue(COMO_FOI_LIDA);
    const escritas: unknown[] = [];
    // A outra transação já apagou a irmã enquanto esta esperava o lock.
    transactionMock.mockImplementation(
      transacaoQueRegistra(escritas, [{ id: "etapa-b", ehGanho: false }])
    );

    await expect(
      excluirEtapa({ etapaId: "etapa-b", destinoId: null, autorId: "admin-1" })
    ).rejects.toThrow(/pelo menos uma etapa/i);
    expect(escritas).toHaveLength(1);
  });

  it("a etapa sumiu entre a leitura de fora e o lock", async () => {
    findUniqueMock.mockResolvedValue(COMO_FOI_LIDA);
    const escritas: unknown[] = [];
    transactionMock.mockImplementation(
      transacaoQueRegistra(escritas, [
        { id: "etapa-a", ehGanho: true },
        { id: "etapa-c", ehGanho: false },
      ])
    );

    await expect(
      excluirEtapa({ etapaId: "etapa-b", destinoId: null, autorId: "admin-1" })
    ).rejects.toThrow(/não existe mais/i);
    expect(escritas).toHaveLength(1);
  });

  it("destino apagado no intervalo vira erro de domínio, não chave estrangeira morta", async () => {
    findUniqueMock.mockResolvedValue(COMO_FOI_LIDA);
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
      excluirEtapa({ etapaId: "etapa-b", destinoId: "etapa-destino", autorId: "admin-1" })
    ).rejects.toThrow(/destino/i);
    expect(escritas).toHaveLength(1);
  });

  it("caminho feliz com destino: move os leads, depois apaga a etapa", async () => {
    findUniqueMock.mockResolvedValue(COMO_FOI_LIDA);
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
    });

    expect(movidos).toBe(3);
    expect(escritas[1]).toEqual({
      moveuLeads: { where: { stageId: "etapa-b" }, data: { stageId: "etapa-a" } },
    });
    expect(escritas[2]).toEqual({ apagou: { where: { id: "etapa-b" } } });
  });
});
