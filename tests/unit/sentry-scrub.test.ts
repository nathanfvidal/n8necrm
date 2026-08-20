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

describe("segredos do cofre (Ciclo 2a)", () => {
  // Blob real de formato: v1, keyId de 8 hex, três campos base64url.
  const BLOB =
    "v1.9f3c1a2b.qMKmZ0lRb3RhbmE.c2VncmVkby1jaWZyYWRvLWFxdWk.ZmFrZS10YWctZGUtMTZi";

  it("blob do cofre é redigido", () => {
    expect(redigirPii(`Falha ao decifrar ${BLOB} da conexão cmp_1`)).toContain("[segredo cifrado]");
    expect(redigirPii(`Falha ao decifrar ${BLOB}`)).not.toContain("qMKmZ0lRb3RhbmE");
  });

  it("chave mestra em base64 (32 bytes) é redigida", () => {
    const chave = Buffer.alloc(32, 7).toString("base64");
    const saida = redigirPii(`COFRE_CHAVE_MESTRA=${chave} não decodifica`);
    expect(saida).toContain("[chave]");
    expect(saida).not.toContain(chave);
  });

  it("um sha256 de 64 hex NÃO é redigido — a fronteira não pegou geral", () => {
    // Sem esta prova, "redige base64 de 32 bytes" poderia estar apagando todo
    // identificador longo do sistema, e o diagnóstico de qualquer erro ficaria
    // cego. O critério do arquivo é redigir agressivamente, não redigir tudo.
    const sha = "a".repeat(64);
    expect(redigirPii(`hash do token: ${sha}`)).toContain(sha);
  });

  it("um cuid NÃO é redigido", () => {
    const cuid = "cmeq0a1b2c3d4e5f6g7h8i9j";
    expect(redigirPii(`conexão ${cuid} não encontrada`)).toContain(cuid);
  });

  it("redige em profundidade, dentro de um evento aninhado", () => {
    const evento = { exception: { values: [{ value: `erro com ${BLOB}` }] } };
    expect(JSON.stringify(redigirPiiProfundo(evento))).toContain("[segredo cifrado]");
  });

  it("blob cujo campo do meio tem 43 caracteres sai INTEIRO, não recortado em [chave]", () => {
    // Esta é a prova da primeira afirmação do comentário de `redigirPii`: a
    // ordem das substituições não é arbitrária. Um campo base64url de
    // exatamente 43 caracteres sem `-` nem `_` é, do ponto de vista de
    // `CHAVE_BASE64`, indistinguível de uma chave de 32 bytes — e ele está
    // cercado por `.` dos dois lados, que são justamente as fronteiras que
    // aquele padrão exige. Se alguém trocar a ordem, o blob sai como
    // `v1.9f3c1a2b.qMKm....[chave].ZmFr...` — dois terços dele visíveis.
    const campo43 = "c".repeat(43);
    const blob = `v1.9f3c1a2b.qMKmZ0lRb3RhbmE.${campo43}.ZmFrZS10YWctZGUtMTZi`;

    expect(redigirPii(`Falha ao decifrar ${blob}`)).toBe("Falha ao decifrar [segredo cifrado]");
  });

  it("hash bcrypt cujo miolo tem uma corrida de 43 sai como [hash], não como [chave]", () => {
    // A outra metade da mesma afirmação. O alfabeto do bcrypt inclui `.`, que
    // parte o miolo de 53 caracteres em corridas de caracteres base64 — e uma
    // corrida de exatamente 43 casa com `CHAVE_BASE64` (precedida por `$`,
    // seguida por `.`: as duas fronteiras que ele exige). Sem o bcrypt vir
    // antes, o hash sairia pela metade: `[chave].bbbbbbbbb`.
    const hash = `$2b$10$${"a".repeat(43)}.${"b".repeat(9)}`;

    expect(redigirPii(`usuario: { senhaHash: "${hash}" }`)).toBe(
      'usuario: { senhaHash: "[hash]" }'
    );
  });
});
