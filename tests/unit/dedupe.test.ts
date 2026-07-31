// Este arquivo (junto com rate-limit.test.ts, audit-log.test.ts,
// seed.test.ts e pipeline-stages.test.ts) usa o Prisma real contra o
// Postgres do Supabase, então carrega DATABASE_URL do .env aqui — não em
// vitest.config.ts — para não injetar credenciais em testes que não tocam
// banco. Precisa ser o primeiro import: os módulos abaixo (via
// src/lib/prisma.ts → src/lib/env.ts) leem process.env.DATABASE_URL no
// top-level.
import "dotenv/config";

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../../src/lib/prisma";
import { encontrarOuCriarContact, normalizarTelefone } from "../../src/core/leads/dedupe";

// Prefixo exclusivo deste arquivo: "119977". O seed da Task 9 usa
// "1199999000{0..3}" (prefixo "1199999000") e seed.test.ts cria um contato
// órfão avulso com "119999912345" (prefixo "1199999") — o brief original
// deste teste usava `startsWith: "119999"` para limpeza, que colide com os
// dois. Usamos um prefixo que não é prefixo nem é prefixado por nenhum dos
// dois, para nunca apagar dado de outro teste/seed com um deleteMany()
// aparentemente inofensivo.
const PREFIXO_TESTE = "119977";

async function limparContatosDeTeste() {
  await prisma.contact.deleteMany({ where: { telefone: { startsWith: PREFIXO_TESTE } } });
}

describe("normalizarTelefone", () => {
  it("remove formatação (parênteses, espaço, hífen)", () => {
    expect(normalizarTelefone("(11) 99777-0001")).toBe("11997770001");
  });

  it("remove o código do país +55 de um celular (11 dígitos nacionais)", () => {
    expect(normalizarTelefone("+55 11 99777-0001")).toBe("11997770001");
  });

  it("remove o código do país 55 de um fixo (10 dígitos nacionais)", () => {
    expect(normalizarTelefone("55 11 9777-0001")).toBe("1197770001");
  });

  it("colapsa variações de espaçamento do mesmo número para o mesmo resultado", () => {
    expect(normalizarTelefone("11 9 9777-0001")).toBe("11997770001");
  });
});

describe("encontrarOuCriarContact", () => {
  beforeEach(limparContatosDeTeste);
  afterAll(limparContatosDeTeste);

  it("cria um novo contato quando o telefone não existe", async () => {
    const contact = await encontrarOuCriarContact({ nome: "Ana Souza", telefone: "11997770001" });
    expect(contact.nome).toBe("Ana Souza");
    expect(contact.telefone).toBe("11997770001");
  });

  it("retorna o contato existente quando o telefone já está cadastrado", async () => {
    const primeiro = await encontrarOuCriarContact({ nome: "Ana Souza", telefone: "11997770002" });
    const segundo = await encontrarOuCriarContact({ nome: "Ana S.", telefone: "11997770002" });
    expect(segundo.id).toBe(primeiro.id);
  });

  it("não sobrescreve o nome do contato existente", async () => {
    const primeiro = await encontrarOuCriarContact({ nome: "Ana Souza", telefone: "11997770003" });
    await encontrarOuCriarContact({ nome: "Nome Diferente", telefone: "11997770003" });
    const atual = await prisma.contact.findUniqueOrThrow({ where: { id: primeiro.id } });
    expect(atual.nome).toBe("Ana Souza");
  });

  it("reconhece o mesmo telefone em formatos diferentes como o mesmo contato", async () => {
    const primeiro = await encontrarOuCriarContact({ nome: "Bruno Reis", telefone: "11997770004" });
    const segundo = await encontrarOuCriarContact({
      nome: "Bruno R.",
      telefone: "+55 (11) 99777-0004",
    });
    expect(segundo.id).toBe(primeiro.id);

    const total = await prisma.contact.count({ where: { telefone: { startsWith: "11997770004" } } });
    expect(total).toBe(1);
  });

  it(
    "sob concorrência, chamadas simultâneas com o mesmo telefone nunca duplicam o contato " +
      "(uma cria, as outras colidem na constraint UNIQUE e devolvem o mesmo registro)",
    async () => {
      const telefone = "11997770005";
      const chamadas = Array.from({ length: 10 }, (_, i) =>
        encontrarOuCriarContact({ nome: `Concorrente ${i}`, telefone })
      );

      const resultados = await Promise.all(chamadas);

      const idsUnicos = new Set(resultados.map((c) => c.id));
      expect(idsUnicos.size).toBe(1);

      const total = await prisma.contact.count({ where: { telefone } });
      expect(total).toBe(1);
    }
  );
});
