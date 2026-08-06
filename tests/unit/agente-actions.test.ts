// Usa o Prisma real contra o Postgres do Supabase, mesmo padrão de
// tests/unit/whatsapp-agente.test.ts: a prova de que `restaurarConfigPadrao`
// restaura persona/regras/faq (e NÃO mexe em `ativo`) depende de um UPDATE de
// verdade contra a linha única de `BotConfig`, não de um mock. Carrega
// DATABASE_URL do .env aqui mesmo, mesmo padrão de rate-limit.test.ts.
import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll } from "vitest";

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
  // religa o interruptor de propósito). Sem este `afterAll`, a suíte inteira
  // ficaria com o bot de desenvolvimento no estado deixado pelo último
  // teste. Restaura para `linhaOriginal` (capturada no `beforeAll` acima),
  // não para `botConfig`/valores fixos — mesmo cuidado de
  // tests/unit/bot-config-seed.test.ts.
  afterAll(async () => {
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
  });

  it("volta a persona, as regras e a FAQ para o conteúdo de config/bot.ts", async () => {
    await salvarConfigBot(
      { ativo: false, personaNome: "X", personaPapel: "Y", regras: ["z"], faq: "w" },
      ID_DO_ADMIN
    );

    await restaurarConfigPadrao(ID_DO_ADMIN);

    const linha = await lerConfigBot();
    expect(linha.personaNome).toBe(botConfig.persona.nome);
    expect(linha.regras).toEqual(botConfig.regras);
    expect(linha.faq).toBe(botConfig.faq);
  });

  // O interruptor global NÃO é conteúdo do fork: se o bot foi desligado
  // porque estava fazendo besteira, restaurar o texto não pode religá-lo por
  // conta própria -- seria o botão "consertar o prompt" reabrindo o problema.
  it("não religa o interruptor global", async () => {
    await salvarConfigBot(
      { ativo: false, personaNome: "X", personaPapel: "Y", regras: ["z"], faq: "w" },
      ID_DO_ADMIN
    );
    await restaurarConfigPadrao(ID_DO_ADMIN);
    expect((await lerConfigBot()).ativo).toBe(false);
  });
});
