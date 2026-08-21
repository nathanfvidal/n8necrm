import crypto from "node:crypto";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  cifrar,
  decifrar,
  PROPOSITO_APIKEY_CONEXAO,
  CofreFormatoInvalidoError,
  CofreDecifragemError,
} from "../../src/core/cofre/segredo";
import { chaveAtiva, CofreChaveDesconhecidaError } from "../../src/core/cofre/chave";

const CHAVE_A = Buffer.alloc(32, 1).toString("base64");
const CHAVE_B = Buffer.alloc(32, 2).toString("base64");

const EMPRESA_A = "cmp_a";
const EMPRESA_B = "cmp_b";
const CTX_A = { companyId: EMPRESA_A, proposito: PROPOSITO_APIKEY_CONEXAO };

const SEGREDO = "apikey-da-evolution-com-acento-ção-e-emoji-🔐";

const original = process.env.COFRE_CHAVE_MESTRA;

beforeEach(() => {
  process.env.COFRE_CHAVE_MESTRA = CHAVE_A;
});

afterEach(() => {
  if (original === undefined) delete process.env.COFRE_CHAVE_MESTRA;
  else process.env.COFRE_CHAVE_MESTRA = original;
});

/** Vira um bit do campo indicado do blob, mantendo o formato intacto. */
function adulterar(blob: string, campo: 2 | 3 | 4): string {
  const partes = blob.split(".");
  const bytes = Buffer.from(partes[campo]!, "base64url");
  bytes[0] = bytes[0]! ^ 0x01;
  partes[campo] = bytes.toString("base64url");
  return partes.join(".");
}

describe("cofre — ida e volta", () => {
  it("decifrar desfaz cifrar, inclusive com acento e emoji", () => {
    expect(decifrar(cifrar(SEGREDO, CTX_A), CTX_A)).toBe(SEGREDO);
  });

  it("o blob NÃO contém o texto claro", () => {
    const blob = cifrar(SEGREDO, CTX_A);
    expect(blob).not.toContain(SEGREDO);
    expect(blob).not.toContain("apikey");
    expect(Buffer.from(blob, "utf8").includes(Buffer.from(SEGREDO, "utf8"))).toBe(false);
  });

  it("o formato é `v1.<keyId>.<iv>.<ct>.<tag>`, com o keyId da chave ativa", () => {
    const partes = cifrar(SEGREDO, CTX_A).split(".");
    expect(partes).toHaveLength(5);
    expect(partes[0]).toBe("v1");
    expect(partes[1]).toBe(chaveAtiva().id);
    // base64url, sem padding — é o que garante que `.` nunca apareça dentro
    // de um campo e o `split` continue confiável.
    for (const campo of partes.slice(2)) expect(campo).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("cifrar o MESMO texto duas vezes dá blobs DIFERENTES", () => {
    // Prova que o nonce é por operação. Nonce fixo com AES-GCM é catastrófico:
    // dois textos cifrados com o mesmo par (chave, nonce) vazam o XOR deles e
    // permitem forjar tag.
    expect(cifrar(SEGREDO, CTX_A)).not.toBe(cifrar(SEGREDO, CTX_A));
  });
});

describe("cofre — a AEAD recusa em vez de decifrar pela metade", () => {
  it("bit virado no ciphertext lança `CofreDecifragemError`", () => {
    expect(() => decifrar(adulterar(cifrar(SEGREDO, CTX_A), 3), CTX_A)).toThrow(CofreDecifragemError);
  });

  it("bit virado na tag lança", () => {
    expect(() => decifrar(adulterar(cifrar(SEGREDO, CTX_A), 4), CTX_A)).toThrow(CofreDecifragemError);
  });

  it("bit virado no iv lança", () => {
    expect(() => decifrar(adulterar(cifrar(SEGREDO, CTX_A), 2), CTX_A)).toThrow(CofreDecifragemError);
  });

  it("blob da empresa A NÃO abre com o companyId da B", () => {
    // Este é o caso que a AAD existe para fechar: quem tem `service_role` pode
    // COPIAR o blob de uma linha para outra. Sem AAD isso passaria, e a
    // empresa B responderia clientes pela instância da A.
    const blob = cifrar(SEGREDO, CTX_A);
    expect(() => decifrar(blob, { companyId: EMPRESA_B, proposito: PROPOSITO_APIKEY_CONEXAO })).toThrow(
      CofreDecifragemError
    );
  });

  it("blob de um propósito NÃO abre com outro", () => {
    const blob = cifrar(SEGREDO, CTX_A);
    expect(() => decifrar(blob, { companyId: EMPRESA_A, proposito: "outro:proposito" })).toThrow(
      CofreDecifragemError
    );
  });

  it("cabeçalho adulterado (keyId trocado) NÃO abre, mesmo com a chave certa na lista", () => {
    process.env.COFRE_CHAVE_MESTRA = `${CHAVE_A},${CHAVE_B}`;
    const blob = cifrar(SEGREDO, CTX_A);
    const partes = blob.split(".");
    // `crypto` importado no topo, e NÃO por `require()`: o lint deste
    // repositório reprova `require` (`@typescript-eslint/no-require-imports`,
    // erro medido em 2026-08-20). O id é recalculado aqui de propósito, em vez
    // de vir de `chavePorId`, para que o teste não use a mesma função que ele
    // está exercitando.
    const outroId = crypto
      .createHash("sha256")
      .update(Buffer.from(CHAVE_B, "base64"))
      .digest("hex")
      .slice(0, 8);
    partes[1] = outroId;
    // O keyId entra na AAD, então trocá-lo quebra a tag antes mesmo de a chave
    // errada ter chance de produzir lixo.
    expect(() => decifrar(partes.join("."), CTX_A)).toThrow(CofreDecifragemError);
  });
});

describe("cofre — formato e rotação", () => {
  it("string fora do formato lança `CofreFormatoInvalidoError`", () => {
    for (const ruim of ["", "texto-puro", "v1.só.tres.partes", "v9.aaaaaaaa.a.b.c"]) {
      expect(() => decifrar(ruim, CTX_A)).toThrow(CofreFormatoInvalidoError);
    }
  });

  it("chave nova NA FRENTE: o blob antigo continua abrindo e o novo usa a chave nova", () => {
    const blobAntigo = cifrar(SEGREDO, CTX_A);
    const idAntigo = blobAntigo.split(".")[1];

    process.env.COFRE_CHAVE_MESTRA = `${CHAVE_B},${CHAVE_A}`;

    expect(decifrar(blobAntigo, CTX_A)).toBe(SEGREDO);

    const blobNovo = cifrar(SEGREDO, CTX_A);
    expect(blobNovo.split(".")[1]).not.toBe(idAntigo);
    expect(decifrar(blobNovo, CTX_A)).toBe(SEGREDO);
  });

  it("chave RETIRADA da lista lança `CofreChaveDesconhecidaError`, não `CofreDecifragemError`", () => {
    // A distinção é o que diz a quem opera o que fazer: chave sumida tem
    // conserto (repor a chave), tag quebrada não.
    const blob = cifrar(SEGREDO, CTX_A);
    process.env.COFRE_CHAVE_MESTRA = CHAVE_B;
    expect(() => decifrar(blob, CTX_A)).toThrow(CofreChaveDesconhecidaError);
  });

  it("NENHUMA mensagem de erro da cifra carrega o texto claro", () => {
    const blob = cifrar(SEGREDO, CTX_A);
    const mensagens: string[] = [];
    for (const chamada of [
      () => decifrar(adulterar(blob, 3), CTX_A),
      () => decifrar("texto-puro", CTX_A),
      () => decifrar(blob, { companyId: EMPRESA_B, proposito: PROPOSITO_APIKEY_CONEXAO }),
    ]) {
      try {
        chamada();
      } catch (erro) {
        mensagens.push((erro as Error).message);
      }
    }
    expect(mensagens).toHaveLength(3);
    for (const m of mensagens) {
      expect(m).not.toContain(SEGREDO);
      expect(m).not.toContain(CHAVE_A);
    }
  });
});
