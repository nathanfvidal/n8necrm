import { describe, it, expect } from "vitest";

import {
  LIMITE_DESCRICAO,
  validarCamposNovosDaTarefa,
} from "../../src/core/tasks/schema";

// Sem mock nenhum de propósito: este módulo é função pura. Se um dia precisar
// de mock, alguém puxou banco ou sessão para dentro da validação, e é isso
// que o teste deveria estar impedindo.
describe("validarCamposNovosDaTarefa", () => {
  it("aceita ausência dos dois campos — os dois são opcionais", () => {
    expect(validarCamposNovosDaTarefa({})).toEqual({});
  });

  it("aceita descrição dentro do limite", () => {
    const texto = "x".repeat(LIMITE_DESCRICAO);
    expect(validarCamposNovosDaTarefa({ descricao: texto }).descricao).toBe(texto);
  });

  it("recusa um caractere além do limite, com o motivo na mensagem", () => {
    const texto = "x".repeat(LIMITE_DESCRICAO + 1);
    expect(() => validarCamposNovosDaTarefa({ descricao: texto })).toThrow(
      /Descrição longa demais/
    );
  });

  // A mensagem precisa começar com "Descrição " porque `MENSAGENS_SEGURAS`
  // (`actions.ts`) casa por prefixo. Sem isso a falha cai no ramo genérico e
  // a pessoa lê "Falha ao salvar a tarefa" em vez do motivo — a validação
  // faria o trabalho e ainda assim esconderia o porquê.
  it("a mensagem carrega o prefixo que as actions reconhecem", () => {
    try {
      validarCamposNovosDaTarefa({ descricao: "x".repeat(LIMITE_DESCRICAO + 1) });
      expect.unreachable("deveria ter lançado");
    } catch (erro) {
      expect((erro as Error).message.startsWith("Descrição ")).toBe(true);
      expect((erro as Error).message).toContain(String(LIMITE_DESCRICAO));
    }
  });

  it("aceita contato ausente, e aceita null como desvincular", () => {
    expect(validarCamposNovosDaTarefa({ contactId: null }).contactId).toBeNull();
    expect(validarCamposNovosDaTarefa({}).contactId).toBeUndefined();
  });

  it("recusa id de contato vazio ou só espaço", () => {
    // O `<select>` manda "" quando ninguém escolheu. Gravar isso viraria
    // violação de FK crua (P2003) na hora do insert, sem mensagem útil.
    expect(() => validarCamposNovosDaTarefa({ contactId: "" })).toThrow(/Contato inválido/);
    expect(() => validarCamposNovosDaTarefa({ contactId: "   " })).toThrow(/Contato inválido/);
  });

  it("apara o id do contato", () => {
    expect(validarCamposNovosDaTarefa({ contactId: " contato-1 " }).contactId).toBe("contato-1");
  });

  // `parse` cru lançaria `ZodError`, cujo `message` é um JSON com o caminho do
  // campo e o valor recebido. Isso atravessaria até a tela pelo ramo genérico
  // de `paraResultadoErro`. O contrato é: sai `Error` de domínio, sempre.
  it("lança Error de domínio, nunca ZodError cru", () => {
    try {
      validarCamposNovosDaTarefa({ contactId: "" });
      expect.unreachable("deveria ter lançado");
    } catch (erro) {
      expect(erro).toBeInstanceOf(Error);
      expect((erro as Error).name).toBe("Error");
      expect((erro as Error).message).not.toContain("[");
    }
  });
});
