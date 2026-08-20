// Este arquivo (junto com rate-limit.test.ts, audit-log.test.ts,
// seed.test.ts e pipeline-stages.test.ts) usa o Prisma real contra o
// Postgres do Supabase, então carrega DATABASE_URL do .env aqui — não em
// vitest.config.ts — para não injetar credenciais em testes que não tocam
// banco. Precisa ser o primeiro import: os módulos abaixo (via
// src/lib/prisma.ts → src/lib/env.ts) leem process.env.DATABASE_URL no
// top-level.
import "dotenv/config";

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server" que o Next.js aplica no build — fora desse pipeline (aqui,
// sob Vitest) ele sempre lança, independente de quem importa (ver
// tests/unit/storage.test.ts, onde este mock foi documentado pela primeira
// vez). `src/lib/prisma.ts` ganhou `import "server-only"` na Task 17 (fix
// round 2/5), e este arquivo importa `prisma` direto — sem mockar aqui, TODO
// teste deste arquivo quebraria na importação, não por causa da lógica
// testada.
vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import { encontrarOuCriarContact, normalizarTelefone } from "../../src/core/leads/dedupe";

// Lista exaustiva dos telefones JÁ NORMALIZADOS (o que `encontrarOuCriarContact`
// efetivamente grava em `Contact.telefone`) que os testes abaixo criam.
//
// A primeira versão deste arquivo limpava por `startsWith("119977")`
// aplicado ao valor bruto de entrada — mas a limpeza precisa bater com o que
// fica GRAVADO, não com o que foi digitado. Isso quebrou de duas formas
// diferentes durante o fix round 1/5:
//   1. O brief original usava `startsWith("119999")`, que colide com os
//      telefones do seed da Task 9 (`1199999000{0..3}`) — corrigido usando
//      um prefixo exclusivo.
//   2. Um teste de mutação encontrou uma entrada tipo "+55 11 99777-0004"
//      cujo valor NORMALIZADO ("11997770004") batia com o prefixo, mas cujo
//      valor bruto formatado ("5511997770004") não — dependendo de qual lado
//      da comparação um mutante corrompia, uma linha podia sobrar sem ser
//      limpa. Usar a lista exata do que a função grava (em vez de um prefixo
//      sobre a entrada bruta) elimina essa classe de descompasso: não importa
//      como o telefone foi digitado, o valor gravado é sempre um destes.
const TELEFONES_ARMAZENADOS_TESTE = [
  "11997770001",
  "11997770002",
  "11997770003",
  "11997770004",
  "11997770005",
  "11988887777", // celular unificado (fix round 1/5, ver describe abaixo)
  "1133334444", // fixo, nunca deve ganhar o 9º dígito
  "11933334444", // celular que compartilha os 8 últimos dígitos do fixo acima
];

async function limparContatosDeTeste() {
  await prisma.contact.deleteMany({ where: { telefone: { in: TELEFONES_ARMAZENADOS_TESTE } } });
}

describe("normalizarTelefone", () => {
  it("remove formatação (parênteses, espaço, hífen)", () => {
    expect(normalizarTelefone("(11) 99777-0001")).toBe("11997770001");
  });

  it("remove o código do país +55 de um celular (11 dígitos nacionais)", () => {
    expect(normalizarTelefone("+55 11 99777-0001")).toBe("11997770001");
  });

  it("remove o código do país 55 de um fixo (10 dígitos nacionais)", () => {
    // Assinante "37770001" começa em "3" — faixa de fixo (2-5) — então isto
    // testa só a remoção do código do país, sem acionar a unificação do 9º
    // dígito (que só se aplica a assinante começando em 6-9).
    expect(normalizarTelefone("55 11 3777-0001")).toBe("1137770001");
  });

  it("colapsa variações de espaçamento do mesmo número para o mesmo resultado", () => {
    expect(normalizarTelefone("11 9 9777-0001")).toBe("11997770001");
  });

  // --- Fix round 1/5: unificação do 9º dígito do celular -------------------
  //
  // Regra aplicada (plano de numeração da Anatel, Resolução 553/2010):
  // número de 10 dígitos = DDD (2) + assinante (8). Fixo sempre começa em
  // 2-5; celular no formato antigo (sem o 9º dígito) sempre começava em
  // 6-9 — as duas faixas nunca se sobrepõem. Só inserimos "9" quando o
  // primeiro dígito do assinante está em 6-9; em qualquer outro caso
  // devolvemos sem alterar (fixo, ou ambíguo em 0-1).
  describe("unificação do 9º dígito do celular", () => {
    it.each([
      ["1166667777", "11966667777"], // assinante começa em 6 (limite inferior da faixa)
      ["1177776666", "11977776666"], // 7
      ["1188887777", "11988887777"], // 8
      ["1199990000", "11999990000"], // 9 (limite superior da faixa)
    ])("insere o 9º dígito quando o assinante começa em 6-9: %s -> %s", (bruto, esperado) => {
      expect(normalizarTelefone(bruto)).toBe(esperado);
    });

    it.each([
      "1122223333", // assinante começa em 2 (limite inferior da faixa de fixo)
      "1133334444",
      "1144445555",
      "1155556666", // 5 (limite superior da faixa de fixo)
    ])("NÃO mexe em fixo, assinante começa em 2-5: %s permanece igual", (fixo) => {
      expect(normalizarTelefone(fixo)).toBe(fixo);
    });

    it.each([
      "1100001111", // assinante começa em 0
      "1110002222", // assinante começa em 1
    ])(
      "NÃO mexe em número ambíguo (assinante começa em 0 ou 1, fora de qualquer faixa documentada): %s permanece igual",
      (ambiguo) => {
        expect(normalizarTelefone(ambiguo)).toBe(ambiguo);
      }
    );

    it("não mexe em celular que já chega com 11 dígitos (já no formato atual)", () => {
      expect(normalizarTelefone("11988887777")).toBe("11988887777");
    });
  });

  // --- Fix round 1/5: entrada sem telefone utilizável -----------------------
  describe("entrada sem telefone utilizável", () => {
    it.each(["", "N/A", "a definir", "-", "   ", "()"])(
      "rejeita %j (nenhum dígito extraível)",
      (entrada) => {
        expect(() => normalizarTelefone(entrada)).toThrow(/Telefone inválido/);
      }
    );

    it("rejeita uma sequência de dígitos curta demais para conter DDD + assinante", () => {
      expect(() => normalizarTelefone("12345")).toThrow(/Telefone inválido/);
    });
  });
});

describe("encontrarOuCriarContact", () => {
  // Empresa única do Ciclo 1a (mesma suposição de `prisma/seed.ts`) —
  // `Contact.companyId` agora é obrigatório, e `encontrarOuCriarContact`
  // passou a exigi-lo como parâmetro (ver o comentário na assinatura em
  // core/leads/dedupe.ts): os chamadores reais já resolvem a empresa do
  // autor antes de chamar, e este teste não tem "autor" nenhum — só a
  // empresa semeada.
  let companyId: string;

  beforeAll(async () => {
    companyId = (await prisma.company.findFirstOrThrow()).id;
  });
  beforeEach(limparContatosDeTeste);
  afterAll(limparContatosDeTeste);

  it("cria um novo contato quando o telefone não existe", async () => {
    const contact = await encontrarOuCriarContact({
      nome: "Ana Souza",
      telefone: "11997770001",
      companyId,
    });
    expect(contact.nome).toBe("Ana Souza");
    expect(contact.telefone).toBe("11997770001");
  });

  it("retorna o contato existente quando o telefone já está cadastrado", async () => {
    const primeiro = await encontrarOuCriarContact({
      nome: "Ana Souza",
      telefone: "11997770002",
      companyId,
    });
    const segundo = await encontrarOuCriarContact({ nome: "Ana S.", telefone: "11997770002", companyId });
    expect(segundo.id).toBe(primeiro.id);
  });

  it("não sobrescreve o nome do contato existente", async () => {
    const primeiro = await encontrarOuCriarContact({
      nome: "Ana Souza",
      telefone: "11997770003",
      companyId,
    });
    await encontrarOuCriarContact({ nome: "Nome Diferente", telefone: "11997770003", companyId });
    const atual = await prisma.contact.findUniqueOrThrow({ where: { id: primeiro.id } });
    expect(atual.nome).toBe("Ana Souza");
  });

  it("reconhece o mesmo telefone em formatos diferentes como o mesmo contato", async () => {
    const primeiro = await encontrarOuCriarContact({
      nome: "Bruno Reis",
      telefone: "11997770004",
      companyId,
    });
    const segundo = await encontrarOuCriarContact({
      nome: "Bruno R.",
      telefone: "+55 (11) 99777-0004",
      companyId,
    });
    expect(segundo.id).toBe(primeiro.id);

    const total = await prisma.contact.count({ where: { telefone: "11997770004" } });
    expect(total).toBe(1);
  });

  it(
    "sob concorrência, chamadas simultâneas com o mesmo telefone nunca duplicam o contato " +
      "(uma cria, as outras colidem na constraint UNIQUE e devolvem o mesmo registro)",
    async () => {
      const telefone = "11997770005";
      const chamadas = Array.from({ length: 10 }, (_, i) =>
        encontrarOuCriarContact({ nome: `Concorrente ${i}`, telefone, companyId })
      );

      const resultados = await Promise.all(chamadas);

      const idsUnicos = new Set(resultados.map((c) => c.id));
      expect(idsUnicos.size).toBe(1);

      const total = await prisma.contact.count({ where: { telefone } });
      expect(total).toBe(1);
    }
  );

  // --- Fix round 1/5: prova ponta-a-ponta (via banco) da regra do 9º dígito -
  it(
    "unifica o mesmo celular digitado com e sem o 9º dígito no mesmo contato " +
      "(direção 1: dedupe DEVE acontecer entre as duas formas do mesmo celular)",
    async () => {
      const semNonoDigito = await encontrarOuCriarContact({
        nome: "Carla Dias",
        telefone: "1188887777", // formato antigo: DDD + 8 dígitos, assinante começa em 8
        companyId,
      });
      expect(semNonoDigito.telefone).toBe("11988887777");

      const comNonoDigito = await encontrarOuCriarContact({
        nome: "Carla D.",
        telefone: "(11) 98888-7777", // formato atual, já com o 9º dígito
        companyId,
      });

      expect(comNonoDigito.id).toBe(semNonoDigito.id);

      const total = await prisma.contact.count({ where: { telefone: "11988887777" } });
      expect(total).toBe(1);
    }
  );

  it(
    "NUNCA funde uma linha fixa com um celular que compartilha os mesmos 8 últimos dígitos " +
      "(direção 2: dedupe NÃO PODE acontecer entre fixo e celular)",
    async () => {
      const fixo = await encontrarOuCriarContact({
        nome: "Loja Centro (fixo)",
        telefone: "1133334444", // assinante começa em 3: faixa de fixo, nunca ganha o 9º dígito
        companyId,
      });
      expect(fixo.telefone).toBe("1133334444");

      const celular = await encontrarOuCriarContact({
        nome: "Dono da Loja (celular)",
        telefone: "11933334444", // mesmos 8 últimos dígitos do fixo acima, mas é outra pessoa
        companyId,
      });
      expect(celular.telefone).toBe("11933334444");

      expect(celular.id).not.toBe(fixo.id);

      const total = await prisma.contact.count({
        where: { telefone: { in: ["1133334444", "11933334444"] } },
      });
      expect(total).toBe(2);
    }
  );

  // --- Fix round 1/5: rejeição de telefone sem dígito utilizável -----------
  it("rejeita telefone sem dígito utilizável e não cria contato nenhum", async () => {
    await expect(
      encontrarOuCriarContact({ nome: "Sem Telefone Real", telefone: "a definir", companyId })
    ).rejects.toThrow(/Telefone inválido/);

    const total = await prisma.contact.count({ where: { nome: "Sem Telefone Real" } });
    expect(total).toBe(0);
  });
});
