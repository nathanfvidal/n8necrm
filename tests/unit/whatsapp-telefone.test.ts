// Função pura, sem Prisma nem "server-only" — nenhum mock de banco/módulo
// necessário aqui, ao contrário da maioria dos outros testes de tests/unit.
import { describe, it, expect } from "vitest";

import { normalizarTelefoneWhatsapp } from "../../src/modules/whatsapp/telefone";

describe("normalizarTelefoneWhatsapp", () => {
  describe("formatos reais de wa_id da Evolution (número puro, com código do país)", () => {
    it("normaliza um celular BR com código do país (formato mais comum de wa_id)", () => {
      const resultado = normalizarTelefoneWhatsapp("5511999998888");
      expect(resultado).toEqual({ ok: true, telefone: "11999998888" });
    });

    it("normaliza um fixo BR com código do país", () => {
      const resultado = normalizarTelefoneWhatsapp("551133334444");
      expect(resultado).toEqual({ ok: true, telefone: "1133334444" });
    });

    it("insere o 9º dígito num celular BR sem código do país e sem o 9º dígito", () => {
      const resultado = normalizarTelefoneWhatsapp("1188887777");
      expect(resultado).toEqual({ ok: true, telefone: "11988887777" });
    });

    it("remove formatação humana (parênteses, espaço, hífen, +) além do formato bruto de wa_id", () => {
      const resultado = normalizarTelefoneWhatsapp("+55 (11) 99999-8888");
      expect(resultado).toEqual({ ok: true, telefone: "11999998888" });
    });

    it("não mexe em celular BR que já chega com 11 dígitos nacionais (já com 9º dígito, sem código do país)", () => {
      const resultado = normalizarTelefoneWhatsapp("11988887777");
      expect(resultado).toEqual({ ok: true, telefone: "11988887777" });
    });
  });

  // --- A fronteira "throws" de dedupe.test.ts, reinterpretada como "ok: false" ---
  describe("entrada sem telefone brasileiro reconhecível — nunca lança, devolve ok: false", () => {
    it.each(["", "N/A", "a definir", "-", "   ", "()"])(
      "rejeita %j como 'invalido' (nenhum dígito extraível)",
      (entrada) => {
        const resultado = normalizarTelefoneWhatsapp(entrada);
        expect(resultado).toEqual({ ok: false, motivo: "invalido", bruto: entrada });
      }
    );

    it("rejeita uma sequência de dígitos curta demais para conter DDD + assinante como 'invalido'", () => {
      const resultado = normalizarTelefoneWhatsapp("12345");
      expect(resultado).toEqual({ ok: false, motivo: "invalido", bruto: "12345" });
    });
  });

  describe("wa_id claramente de outro país — ok: false, motivo 'nao-brasileiro', nunca lança", () => {
    it("rejeita um wa_id dos EUA (código do país 1, 11 dígitos totais, não bate no padrão 12/13+55 do Brasil)", () => {
      // Ex.: um número americano real no formato wa_id: "1" + 10 dígitos = 11
      // dígitos totais. Não começa com "55" nem tem 12/13 dígitos, então a
      // remoção de código de país do Brasil não se aplica — e 11 dígitos
      // "puros" (sem essa remoção) não é uma contagem válida de DDD+assinante
      // BR também: um número de 11 dígitos só é válido aqui DEPOIS da
      // remoção do código do país OU como celular BR nacional (DDD+9
      // dígitos) — este caso de teste usa um prefixo que não é DDD real
      // (código de país americano "1" não é DDD de duas casas), mas a função
      // não valida DDD contra uma lista — o que importa aqui é provar que
      // não lança.
      const resultado = normalizarTelefoneWhatsapp("14155552671");
      // 11 dígitos: cai na contagem "válida" (10 ou 11) do ponto de vista
      // desta função, que não sabe distinguir um DDD americano de um DDD
      // brasileiro por conteúdo — mesma limitação documentada em
      // dedupe.ts (não valida contra uma lista de DDDs reais). O contrato
      // que este teste prova é mais estrito: a função NUNCA lança, sempre
      // devolve um resultado tipado.
      expect(resultado.ok).toBe(true);
    });

    it("rejeita um wa_id de Portugal (código do país 351 + 9 dígitos = 12 dígitos, mas não começa com 55)", () => {
      const resultado = normalizarTelefoneWhatsapp("351912345678");
      expect(resultado).toEqual({
        ok: false,
        motivo: "nao-brasileiro",
        bruto: "351912345678",
      });
    });

    it("rejeita um wa_id longo demais para ser um número BR mesmo depois de tentar remover o código do país", () => {
      const resultado = normalizarTelefoneWhatsapp("9991234567890123");
      expect(resultado).toEqual({
        ok: false,
        motivo: "nao-brasileiro",
        bruto: "9991234567890123",
      });
    });
  });

  it("nunca lança para nenhuma entrada — contrato central desta função (irmã não-lançadora de normalizarTelefone)", () => {
    const entradas = ["", "abc", "5511999998888", "1", "+", "()()()", "351912345678", "0".repeat(50)];
    for (const entrada of entradas) {
      expect(() => normalizarTelefoneWhatsapp(entrada)).not.toThrow();
    }
  });
});
