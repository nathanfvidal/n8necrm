// Mesmo padrão de tests/unit/seed.test.ts (ver o comentário lá, e o
// comentário de vitest.config.ts sobre por que cada teste que toca banco
// carrega DATABASE_URL ele mesmo): este arquivo importa prisma/seed.ts, que
// importa src/lib/prisma.ts, que tem `import "server-only"` — sem o mock
// abaixo, a suíte quebra na importação, não na lógica testada. Precisa vir
// antes de qualquer import que puxe a cadeia.
import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { BOT_CONFIG_ID, botConfig } from "../../config/bot";
import { semearBotConfig } from "../../prisma/seed";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

describe("seed do BotConfig", () => {
  beforeAll(async () => {
    await prisma.botConfig.deleteMany({ where: { id: BOT_CONFIG_ID } });
  });

  // Achado da revisão (rodada 1): o teste abaixo ("NÃO sobrescreve o que foi
  // editado pelo CRM") grava "Editado pelo CRM" em personaNome de propósito
  // — é o próprio ponto do teste — mas `semearBotConfig()` nunca sobrescreve
  // por design, então sem este `afterAll` a mutação sobrevive à suíte e
  // corrompe o Postgres de dev compartilhado (confirmado ao vivo: a linha
  // ficou com personaNome "Editado pelo CRM" depois de rodar a suíte uma
  // vez). `update`, não `delete`+recriar via seed: apagar deixaria uma
  // janela em runtime, entre o fim deste arquivo e a próxima chamada de
  // `semearBotConfig()`, em que `prisma.botConfig.findUniqueOrThrow` (o
  // caminho de leitura de runtime, fora do seed) explodiria por falta de
  // linha.
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

  it("cria a linha única a partir de config/bot.ts", async () => {
    await semearBotConfig();
    const linha = await prisma.botConfig.findUniqueOrThrow({ where: { id: BOT_CONFIG_ID } });
    expect(linha.personaNome).toBe(botConfig.persona.nome);
    expect(linha.regras).toEqual(botConfig.regras);
    expect(linha.faq).toBe(botConfig.faq);
    expect(linha.ativo).toBe(true);
  });

  // O teste que importa: o seed roda em todo deploy. Se ele sobrescrevesse,
  // toda edição feita pelo CRM seria desfeita no deploy seguinte -- e de forma
  // silenciosa, que é o pior jeito de perder configuração.
  it("NÃO sobrescreve o que foi editado pelo CRM", async () => {
    await prisma.botConfig.update({
      where: { id: BOT_CONFIG_ID },
      data: { personaNome: "Editado pelo CRM" },
    });

    await semearBotConfig();

    const linha = await prisma.botConfig.findUniqueOrThrow({ where: { id: BOT_CONFIG_ID } });
    expect(linha.personaNome).toBe("Editado pelo CRM");
  });
});
