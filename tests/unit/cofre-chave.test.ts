import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  chavesDoAmbiente,
  chaveAtiva,
  chavePorId,
  CofreSemChaveError,
  CofreChaveInvalidaError,
  CofreChaveDesconhecidaError,
} from "../../src/core/cofre/chave";

/**
 * Chaves de teste: 32 bytes cada, determinísticas, NUNCA usadas em ambiente
 * nenhum. São literais de propósito — uma chave aleatória por execução
 * tornaria impossível afirmar o `keyId` esperado, e é justamente o `keyId`
 * que prende o formato à rotação.
 */
const CHAVE_A = Buffer.alloc(32, 1).toString("base64");
const CHAVE_B = Buffer.alloc(32, 2).toString("base64");

const original = process.env.COFRE_CHAVE_MESTRA;

beforeEach(() => {
  process.env.COFRE_CHAVE_MESTRA = CHAVE_A;
});

afterEach(() => {
  if (original === undefined) delete process.env.COFRE_CHAVE_MESTRA;
  else process.env.COFRE_CHAVE_MESTRA = original;
});

describe("carregamento da chave mestra", () => {
  it("lê `process.env` a CADA chamada — rotação vale sem reiniciar o processo", () => {
    // Sem memoização de propósito. Um cache em escopo de módulo seria estado
    // de processo — o mesmo gênero que o programa proíbe — e o sintoma seria
    // uma chave rotacionada que só passa a valer no próximo deploy.
    expect(chavesDoAmbiente()).toHaveLength(1);
    process.env.COFRE_CHAVE_MESTRA = `${CHAVE_B},${CHAVE_A}`;
    expect(chavesDoAmbiente()).toHaveLength(2);
  });

  it("a PRIMEIRA da lista é a ativa — rotacionar é acrescentar na frente", () => {
    process.env.COFRE_CHAVE_MESTRA = `${CHAVE_B},${CHAVE_A}`;
    expect(chaveAtiva().id).toBe(chavesDoAmbiente()[1 - 1].id);
    expect(chaveAtiva().id).not.toBe(chavePorId(chavesDoAmbiente()[1].id).id);
  });

  it("o `keyId` é derivado da chave, não digitado — mesma chave, mesmo id", () => {
    const primeiro = chaveAtiva().id;
    process.env.COFRE_CHAVE_MESTRA = `${CHAVE_B},${CHAVE_A}`;
    // A chave A mudou de posição, e o id dela não mudou: é `sha256` dos bytes,
    // não a posição na lista. Um id digitado poderia ser repetido ou errado.
    expect(chavePorId(primeiro).bytes.equals(Buffer.from(CHAVE_A, "base64"))).toBe(true);
  });

  it("o `keyId` tem 8 caracteres hex", () => {
    expect(chaveAtiva().id).toMatch(/^[0-9a-f]{8}$/);
  });

  it("variável ausente lança `CofreSemChaveError`", () => {
    delete process.env.COFRE_CHAVE_MESTRA;
    expect(() => chaveAtiva()).toThrow(CofreSemChaveError);
  });

  it("variável presente e VAZIA não é o mesmo que ausente, e também lança", () => {
    // String vazia definida é armadilha conhecida deste repositório — o
    // comentário de SEED_PASSWORD em `.env.example` registra o mesmo modo de
    // falha. Aqui ela precisa falhar igual.
    process.env.COFRE_CHAVE_MESTRA = "";
    expect(() => chaveAtiva()).toThrow(CofreSemChaveError);
  });

  it("chave que não decodifica para 32 bytes lança `CofreChaveInvalidaError`", () => {
    process.env.COFRE_CHAVE_MESTRA = Buffer.alloc(16, 9).toString("base64");
    expect(() => chaveAtiva()).toThrow(CofreChaveInvalidaError);
  });

  it("duas chaves com o MESMO id lançam — id ambíguo escolheria a errada em silêncio", () => {
    process.env.COFRE_CHAVE_MESTRA = `${CHAVE_A},${CHAVE_A}`;
    expect(() => chavesDoAmbiente()).toThrow(CofreChaveInvalidaError);
  });

  it("`keyId` fora da lista lança `CofreChaveDesconhecidaError` CITANDO o id", () => {
    // Sem o id na mensagem, quem opera não sabe qual chave restaurar.
    expect(() => chavePorId("deadbeef")).toThrow(/deadbeef/);
    expect(() => chavePorId("deadbeef")).toThrow(CofreChaveDesconhecidaError);
  });

  it("NENHUMA mensagem de erro carrega material de chave", () => {
    process.env.COFRE_CHAVE_MESTRA = `${CHAVE_A},${CHAVE_A}`;
    const mensagens: string[] = [];
    try {
      chavesDoAmbiente();
    } catch (erro) {
      mensagens.push((erro as Error).message);
    }
    process.env.COFRE_CHAVE_MESTRA = Buffer.alloc(16, 9).toString("base64");
    try {
      chaveAtiva();
    } catch (erro) {
      mensagens.push((erro as Error).message);
    }
    expect(mensagens).toHaveLength(2);
    for (const m of mensagens) {
      expect(m).not.toContain(CHAVE_A);
      expect(m).not.toContain(Buffer.alloc(16, 9).toString("base64"));
    }
  });
});
