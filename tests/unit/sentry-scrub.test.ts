import { describe, it, expect } from "vitest";

import { redigirPii, redigirPiiProfundo } from "../../src/lib/sentry-scrub";

/**
 * Testa a redação de dado pessoal com as mensagens REAIS deste sistema, não
 * com exemplos inventados. É a diferença entre provar que a expressão regular
 * funciona e provar que ela cobre o que de fato sai daqui para o Sentry.
 */
describe("redigirPii", () => {
  it("redige o telefone da mensagem que normalizarTelefone lança", () => {
    // Texto real de `core/leads/dedupe.ts`.
    const original =
      'Telefone inválido: "(11) 99999-8888" não contém um número de telefone brasileiro reconhecível';
    const seguro = redigirPii(original);

    expect(seguro).not.toContain("99999-8888");
    expect(seguro).toContain("[telefone]");
    // O resto da mensagem sobrevive — redigir não pode destruir o diagnóstico.
    expect(seguro).toContain("não contém um número de telefone brasileiro");
  });

  it("redige telefone já normalizado, que é só dígitos", () => {
    expect(redigirPii("Contato 11999998888 duplicado")).toBe("Contato [telefone] duplicado");
  });

  it("redige telefone com código do país", () => {
    expect(redigirPii("+55 11 99999-8888")).toContain("[telefone]");
    expect(redigirPii("+55 11 99999-8888")).not.toContain("99999");
  });

  it("redige e-mail", () => {
    expect(redigirPii("Falha ao enviar para maria.silva+crm@empresa.com.br")).toBe(
      "Falha ao enviar para [e-mail]"
    );
  });

  it("redige hash bcrypt, que nunca deveria estar numa mensagem mas já esteve numa resposta", () => {
    const hash = "$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123";
    const seguro = redigirPii(`usuario: { senhaHash: "${hash}" }`);

    expect(seguro).not.toContain("$2b$10$");
    expect(seguro).toContain("[hash]");
  });

  it("não estraga o que não é dado pessoal", () => {
    // Um cuid não tem 10 dígitos seguidos; uma data ISO tem os dígitos
    // separados por `-` e `:`. Se algum destes começar a ser redigido, o
    // diagnóstico perde justamente o que identifica o registro.
    const original = "Lead cmg7x2k9a0001abcd não encontrado em 2026-08-07T17:42:12.192Z (tentativa 3)";
    expect(redigirPii(original)).toBe(original);
  });

  it("redige TODAS as ocorrências, não só a primeira", () => {
    const seguro = redigirPii("de ana@x.com para bruno@y.com");
    expect(seguro).toBe("de [e-mail] para [e-mail]");
  });
});

describe("redigirPiiProfundo", () => {
  it("alcança texto dentro de objeto aninhado, como o evento do Sentry é", () => {
    const evento = {
      message: "erro",
      exception: {
        values: [{ value: 'Este telefone já está cadastrado para Maria (11) 98888-7001.' }],
      },
      breadcrumbs: [{ message: "login de admin@exemplo.com" }],
    };

    const seguro = JSON.stringify(redigirPiiProfundo(evento));

    expect(seguro).not.toContain("98888-7001");
    expect(seguro).not.toContain("admin@exemplo.com");
    expect(seguro).toContain("[telefone]");
    expect(seguro).toContain("[e-mail]");
    // O nome NÃO é redigido — não há como distinguir "Maria" de uma palavra
    // qualquer sem uma lista de nomes. É limitação conhecida, e a razão de o
    // `beforeSend` também apagar cookies e headers em vez de confiar só nisto.
    expect(seguro).toContain("Maria");
  });

  it("preserva números, booleanos e null", () => {
    const entrada = { contagem: 42, ativo: true, ausente: null };
    expect(redigirPiiProfundo(entrada)).toEqual(entrada);
  });

  it("não trava em estrutura muito aninhada", () => {
    let profundo: Record<string, unknown> = { valor: "ana@x.com" };
    for (let i = 0; i < 30; i++) profundo = { nivel: profundo };

    // O que importa é terminar. Abaixo do limite de profundidade a redação
    // acontece; além dele o valor passa intacto, e é uma troca consciente —
    // um evento de erro não tem 30 níveis de informação útil.
    expect(() => redigirPiiProfundo(profundo)).not.toThrow();
  });
});
