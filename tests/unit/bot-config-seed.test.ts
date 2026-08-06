// Mesmo padrão de tests/unit/seed.test.ts (ver o comentário lá, e o
// comentário de vitest.config.ts sobre por que cada teste que toca banco
// carrega DATABASE_URL ele mesmo): este arquivo importa prisma/seed.ts, que
// importa src/lib/prisma.ts, que tem `import "server-only"` — sem o mock
// abaixo, a suíte quebra na importação, não na lógica testada. Precisa vir
// antes de qualquer import que puxe a cadeia.
import "dotenv/config";

import { describe, it, expect, beforeAll, vi } from "vitest";

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
