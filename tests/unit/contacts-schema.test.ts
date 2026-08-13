// Validação dos campos cadastrais de contato.
//
// Teste de unidade puro: `schema.ts` não toca banco, sessão nem `process.env`,
// então aqui não há mock nenhum — é a função e o valor.
import { describe, it, expect } from "vitest";
import {
  camposCadastraisSchema,
  LIMITE_EMPRESA,
  LIMITE_OBSERVACOES,
  UFS,
} from "../../src/core/contacts/schema";

function analisar(entrada: Record<string, unknown>) {
  return camposCadastraisSchema.safeParse(entrada);
}

function primeiroErro(entrada: Record<string, unknown>): string {
  const resultado = analisar(entrada);
  if (resultado.success) throw new Error("esperava falha de validação, veio sucesso");
  return resultado.error.issues[0].message;
}

function dado(entrada: Record<string, unknown>) {
  const resultado = analisar(entrada);
  if (!resultado.success) {
    throw new Error(`esperava sucesso, veio: ${resultado.error.issues[0].message}`);
  }
  return resultado.data;
}

describe("campo em branco vira null, nunca string vazia", () => {
  // Sem isto a coluna passa a ter dois jeitos de dizer "não tem" — `null` e
  // `""` — e toda consulta futura precisa lembrar dos dois.
  it("string vazia vira null", () => {
    expect(dado({ empresa: "" }).empresa).toBeNull();
  });

  it("só espaços vira null", () => {
    expect(dado({ empresa: "   " }).empresa).toBeNull();
  });

  it("campo ausente continua ausente, e não vira null", () => {
    // A diferença importa no `update` do Prisma: `undefined` significa "não
    // mexa nesta coluna", `null` significa "apague o que está lá".
    expect(dado({}).empresa).toBeUndefined();
  });

  it("apara espaços das pontas", () => {
    expect(dado({ empresa: "  Acme Ltda  " }).empresa).toBe("Acme Ltda");
  });
});

describe("tetos de comprimento", () => {
  it("aceita exatamente no limite", () => {
    const noLimite = "a".repeat(LIMITE_EMPRESA);
    expect(dado({ empresa: noLimite }).empresa).toBe(noLimite);
  });

  it("recusa um caractere além, com o motivo na mensagem", () => {
    expect(primeiroErro({ empresa: "a".repeat(LIMITE_EMPRESA + 1) })).toBe(
      `Empresa: o limite é ${LIMITE_EMPRESA} caracteres.`
    );
  });

  it("observações tem teto próprio, bem maior que os outros", () => {
    expect(primeiroErro({ observacoes: "a".repeat(LIMITE_OBSERVACOES + 1) })).toBe(
      `Observações: o limite é ${LIMITE_OBSERVACOES} caracteres.`
    );
  });
});

describe("documento", () => {
  // Guarda só dígitos: quem digita com máscara e quem digita sem produzem a
  // MESMA linha no banco. Sem isso, "123.456.789-01" e "12345678901" seriam
  // dois cadastros diferentes para os olhos de qualquer consulta.
  it("descarta a máscara e guarda só os dígitos", () => {
    expect(dado({ documento: "123.456.789-01" }).documento).toBe("12345678901");
  });

  it("aceita CNPJ, que tem 14 dígitos", () => {
    expect(dado({ documento: "12.345.678/0001-95" }).documento).toBe("12345678000195");
  });

  it("vazio vira null, não erro — o campo é opcional", () => {
    expect(dado({ documento: "" }).documento).toBeNull();
  });

  it("máscara sem nenhum dígito também vira null", () => {
    expect(dado({ documento: ".-/" }).documento).toBeNull();
  });

  it("recusa comprimento que não é nem CPF nem CNPJ", () => {
    expect(primeiroErro({ documento: "1234567890" })).toBe(
      "Documento inválido: informe 11 dígitos (CPF) ou 14 (CNPJ)."
    );
  });

  // Decisão registrada: NÃO conferimos dígito verificador. Um CRM que recusa
  // documento válido-mas-incomum é pior que um que guarda um typo. Este teste
  // trava a decisão — se alguém acrescentar validação de DV, ele fica vermelho
  // e a pessoa tem de justificar a mudança em vez de fazê-la de passagem.
  it("não confere dígito verificador: 11 dígitos repetidos passam", () => {
    expect(dado({ documento: "11111111111" }).documento).toBe("11111111111");
  });
});

describe("uf", () => {
  it("normaliza para maiúsculas", () => {
    expect(dado({ uf: "sp" }).uf).toBe("SP");
  });

  it("apara espaços antes de conferir", () => {
    expect(dado({ uf: " rj " }).uf).toBe("RJ");
  });

  it("recusa sigla que não existe", () => {
    expect(primeiroErro({ uf: "XX" })).toBe("UF inválida: use a sigla de duas letras, como SP.");
  });

  it("recusa nome do estado por extenso", () => {
    expect(primeiroErro({ uf: "São Paulo" })).toBe(
      "UF inválida: use a sigla de duas letras, como SP."
    );
  });

  it("vazio vira null", () => {
    expect(dado({ uf: "" }).uf).toBeNull();
  });

  it("aceita todas as 27 siglas", () => {
    expect(UFS).toHaveLength(27);
    for (const sigla of UFS) {
      expect(dado({ uf: sigla }).uf).toBe(sigla);
    }
  });
});
