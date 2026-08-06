// Usa o Prisma real contra o Postgres do Supabase, mesmo padrão de
// tests/unit/whatsapp-agente.test.ts: a prova de que `restaurarConfigPadrao`
// restaura persona/regras/faq (e NÃO mexe em `ativo`) depende de um UPDATE de
// verdade contra a linha única de `BotConfig`, não de um mock. Carrega
// DATABASE_URL do .env aqui mesmo, mesmo padrão de rate-limit.test.ts.
import "dotenv/config";

import { describe, it, expect, beforeAll } from "vitest";

import { vi } from "vitest";
vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import { lerConfigBot, salvarConfigBot, restaurarConfigPadrao } from "../../src/modules/whatsapp/agente";
import { BOT_CONFIG_ID, botConfig } from "../../config/bot";
import { idsDeUsuariosSemeados } from "./helpers/whatsapp";

describe("restaurar ao padrão do fork", () => {
  let ID_DO_ADMIN: string;
  let linhaOriginal: Awaited<ReturnType<typeof lerConfigBot>>;

  beforeAll(async () => {
    ({ ID_DO_ADMIN } = await idsDeUsuariosSemeados());
    // Capturada ANTES de qualquer teste mexer na linha, para o `afterAll`
    // devolver exatamente o que estava aqui — não uma suposição sobre o que
    // "deveria" estar. Rodada de correção 1, achado M1: a versão anterior
    // deste `afterAll` hardcodeava `ativo: true`; se alguém tivesse desligado
    // o bot no banco de desenvolvimento de propósito (o cenário exato que
    // esta tarefa protege), rodar esta suíte religava o bot sozinha — o
    // mesmo problema que `restaurarConfigPadrao` existe para evitar em
    // produção, só que cometido pelo próprio teste.
    linhaOriginal = await lerConfigBot();
  });

  // `BotConfig` é linha única, compartilhada por todo o banco de
  // desenvolvimento — os dois testes abaixo gravam persona/regras/faq de
  // teste e deixam `ativo: false` (Task 7 diz que `restaurarConfigPadrao` não
  // religa o interruptor de propósito).
  //
  // Revisão final da fatia, achado I5: a restauração é feita num
  // `try`/`finally` DENTRO DE CADA teste, não só num `afterAll` ao fim do
  // arquivo — mesmo padrão de `tests/unit/whatsapp-turno.test.ts`
  // (describe "guarda da IA"). Com um `afterAll` só, este arquivo morrer no
  // meio (falha de asserção fatal, processo morto) DEPOIS do primeiro teste
  // gravar `ativo: false`/persona "X"/"Y" e ANTES do `afterAll` rodar deixa
  // o banco de desenvolvimento exatamente nesse estado: o bot de dev
  // emudece globalmente, e cerca de 15 testes de turno (que dependem de
  // `ativo: true`) passam a falhar por um motivo completamente alheio a
  // eles -- a mesma armadilha que já aconteceu nesta fatia com
  // `seed.test.ts` (ver `.superpowers/sdd/2026-08-06-whatsapp-fatia-2/progress.md`).
  // Com `try`/`finally` por teste, a exposição fica limitada à duração de UM
  // teste, não do arquivo inteiro. Restaura para `linhaOriginal` (capturada
  // no `beforeAll` acima), não para `botConfig`/valores fixos -- mesmo
  // cuidado de tests/unit/bot-config-seed.test.ts.
  async function restaurarLinhaOriginal(): Promise<void> {
    await prisma.botConfig.update({
      where: { id: BOT_CONFIG_ID },
      data: {
        personaNome: linhaOriginal.personaNome,
        personaPapel: linhaOriginal.personaPapel,
        regras: linhaOriginal.regras,
        faq: linhaOriginal.faq,
        ativo: linhaOriginal.ativo,
      },
    });
  }

  it("volta a persona, as regras e a FAQ para o conteúdo de config/bot.ts", async () => {
    try {
      await salvarConfigBot(
        { ativo: false, personaNome: "X", personaPapel: "Y", regras: ["z"], faq: "w" },
        ID_DO_ADMIN
      );

      await restaurarConfigPadrao(ID_DO_ADMIN);

      const linha = await lerConfigBot();
      expect(linha.personaNome).toBe(botConfig.persona.nome);
      expect(linha.regras).toEqual(botConfig.regras);
      expect(linha.faq).toBe(botConfig.faq);
    } finally {
      await restaurarLinhaOriginal();
    }
  });

  // O interruptor global NÃO é conteúdo do fork: se o bot foi desligado
  // porque estava fazendo besteira, restaurar o texto não pode religá-lo por
  // conta própria -- seria o botão "consertar o prompt" reabrindo o problema.
  it("não religa o interruptor global", async () => {
    try {
      await salvarConfigBot(
        { ativo: false, personaNome: "X", personaPapel: "Y", regras: ["z"], faq: "w" },
        ID_DO_ADMIN
      );
      await restaurarConfigPadrao(ID_DO_ADMIN);
      expect((await lerConfigBot()).ativo).toBe(false);
    } finally {
      await restaurarLinhaOriginal();
    }
  });
});
