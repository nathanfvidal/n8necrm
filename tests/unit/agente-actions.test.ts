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

  beforeAll(async () => {
    ({ ID_DO_ADMIN } = await idsDeUsuariosSemeados());
  });

  // `BotConfig` é linha única, compartilhada por todo o banco de
  // desenvolvimento — os dois testes abaixo gravam persona/regras/faq de
  // teste e deixam `ativo: false` (Task 7 diz que `restaurarConfigPadrao` não
  // religa o interruptor de propósito). Sem este `afterAll`, a suíte inteira
  // fica com o bot de desenvolvimento desligado e com persona de teste depois
  // de rodar uma vez — mesmo cuidado de tests/unit/bot-config-seed.test.ts.
  afterAll(async () => {
    await prisma.botConfig.update({
      where: { id: BOT_CONFIG_ID },
      data: {
        personaNome: botConfig.persona.nome,
        personaPapel: botConfig.persona.papel,
        regras: botConfig.regras,
        faq: botConfig.faq,
        ativo: true,
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
