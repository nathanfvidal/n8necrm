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

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pipelineStage: {
      update: (...a: unknown[]) => updateMock(...a),
      updateMany: (...a: unknown[]) => updateManyMock(...a),
      findUnique: (...a: unknown[]) => findUniqueMock(...a),
      findFirst: (...a: unknown[]) => findFirstMock(...a),
    },
    $transaction: (...a: unknown[]) => transactionMock(...a),
  },
}));

vi.mock("@/core/audit/log", () => ({
  registrarAuditoria: vi.fn(),
  gravarLinhaDeAuditoria: vi.fn(),
}));

const { moverNaOrdem, ORDEM_ESTACIONAMENTO } = await import("../../src/core/pipeline/service");

/** Executa o callback do `$transaction` com um `tx` espião. */
function transacaoQueRegistra(escritas: unknown[]) {
  return async (callback: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      pipelineStage: {
        update: (args: unknown) => {
          escritas.push(args);
          return Promise.resolve({});
        },
        updateMany: (args: unknown) => {
          escritas.push(args);
          return Promise.resolve({ count: 0 });
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
