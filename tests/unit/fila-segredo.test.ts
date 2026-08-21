import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { semComentarios } from "./helpers/codigo-fonte";
import { segredoConfere } from "../../src/lib/segredo";

describe("segredoConfere", () => {
  it("aceita o segredo idêntico", () => {
    expect(segredoConfere("abc123", "abc123")).toBe(true);
  });

  it("recusa segredo diferente do mesmo tamanho", () => {
    expect(segredoConfere("abc124", "abc123")).toBe(false);
  });

  it("recusa segredo MAIS CURTO sem lançar", () => {
    // `crypto.timingSafeEqual` LANÇA com buffers de tamanhos diferentes, e é
    // essa restrição que empurrava o consumidor antigo para um
    // `if (a.length !== b.length) return false` — um ramo cujo tempo depende do
    // comprimento. Com o digest, os dois lados têm sempre 32 bytes.
    expect(segredoConfere("abc", "abc123")).toBe(false);
  });

  it("recusa segredo MAIS LONGO sem lançar", () => {
    expect(segredoConfere("abc123456", "abc123")).toBe(false);
  });

  it("recusa quando o esperado é vazio — ausência de segredo não autoriza nada", () => {
    // Fecha FECHADO: sem a variável definida, ninguém entra. O modo de falha
    // oposto (vazio combina com vazio) transformaria "esqueci de configurar" em
    // "endpoint aberto".
    expect(segredoConfere("", "")).toBe(false);
    expect(segredoConfere("qualquer", "")).toBe(false);
  });

  it("não lança para nenhuma combinação de tamanhos", () => {
    for (const recebido of ["", "a", "ab".repeat(500)]) {
      for (const esperado of ["a", "abc", "x".repeat(64)]) {
        expect(() => segredoConfere(recebido, esperado)).not.toThrow();
      }
    }
  });
});

describe("o oráculo de comprimento não existe mais", () => {
  // Este bloco existe porque NENHUM dos casos acima o pegaria.
  //
  // A comparação ingênua — `if (recebido.length !== esperado.length) return
  // false; return timingSafeEqual(...)` — devolve exatamente os mesmos booleanos
  // para todas as entradas de cima. O que muda entre as duas versões não é o
  // resultado, é o TEMPO até ele: a ingênua responde antes de comparar quando os
  // comprimentos diferem, e isso conta ao chamador quantos bytes tem o segredo.
  //
  // Medir tempo em teste é o caminho óbvio e o errado: a diferença é da ordem de
  // nanossegundos, o ruído de agendamento do Node é maior que ela, e o caso
  // ficaria intermitente — a família de teste instável que o `AGENTS.md` deste
  // projeto registra como quase tendo custado o achado do logout desfeito por
  // prefetch. Então a trava é sobre a FORMA do código, que é o que de fato
  // determina o tempo, e é determinística.
  //
  // Reverter `src/lib/segredo.ts` para a comparação ingênua deixa este bloco
  // vermelho. Foi executado em 2026-08-21, e é o que autoriza a frase acima.
  const codigo = semComentarios(
    readFileSync(fileURLToPath(new URL("../../src/lib/segredo.ts", import.meta.url)), "utf8")
  );

  it("não compara o comprimento de um lado com o do outro", () => {
    // O `esperado.length === 0` continua permitido, e é a razão de o padrão
    // exigir `.length` dos DOIS lados da comparação: aquele é um teste de
    // AUSÊNCIA de configuração, não uma medida do segredo recebido.
    expect(codigo).not.toMatch(/\.length\s*[!=]==?[^;\n]*\.length/);
  });

  it("os DOIS lados passam por SHA-256 antes de chegar ao `timingSafeEqual`", () => {
    // Dois digests de 32 bytes é o que torna a chamada sempre legal — e é a
    // única razão pela qual não sobra ramo de comprimento para escrever.
    expect(codigo.match(/createHash\(\s*"sha256"\s*\)/g) ?? []).toHaveLength(2);
    expect(codigo).toMatch(/timingSafeEqual/);
    expect(codigo).not.toMatch(/timingSafeEqual\(\s*Buffer\.from/);
  });

  it("a varredura morde: o padrão pega a comparação ingênua", () => {
    // Sem isto, um regex quebrado deixaria os dois casos acima passando sobre
    // qualquer coisa — inclusive sobre o código ingênuo que eles proíbem.
    const ingenuo = semComentarios(
      "if (bufferRecebido.length !== bufferEsperado.length) return false;\n"
    );
    expect(ingenuo).toMatch(/\.length\s*[!=]==?[^;\n]*\.length/);

    const guardaDeAusencia = semComentarios("if (esperado.length === 0) return false;\n");
    expect(guardaDeAusencia).not.toMatch(/\.length\s*[!=]==?[^;\n]*\.length/);
  });
});
