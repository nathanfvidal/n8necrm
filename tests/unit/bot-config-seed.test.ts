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
  // Capturada ANTES do `deleteMany` abaixo, para o `afterAll` devolver
  // exatamente o que estava aqui — não uma suposição sobre o que "deveria"
  // estar. Rodada de correção 1, achado M1: a versão anterior deste
  // `afterAll` hardcodeava `ativo: true`; se alguém tivesse desligado o bot
  // no banco de desenvolvimento de propósito, rodar esta suíte religava o
  // bot sozinha, mesmo sem nenhum teste aqui mexer em `ativo` de propósito.
  let linhaOriginal: Awaited<ReturnType<typeof prisma.botConfig.findUnique>>;

  beforeAll(async () => {
    linhaOriginal = await prisma.botConfig.findUnique({ where: { id: BOT_CONFIG_ID } });
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
  // linha. Restaura para `linhaOriginal` (capturada no `beforeAll` acima, ou
  // recria a partir de `botConfig` só se a linha não existia antes — banco
  // novo, nunca semeado), não para valores fixos (rodada de correção 1, M1).
  afterAll(async () => {
    // Estado-alvo: a linha capturada no `beforeAll`, ou — só no caso
    // hipotético de banco nunca semeado (`linhaOriginal` nulo) — o padrão de
    // `config/bot.ts`, mesmo fallback que o código já usava antes desta
    // correção. Um único objeto usado nos dois ramos do `upsert` (`update` e
    // `create`) para não repetir a lógica de fallback duas vezes e arriscar
    // as duas cópias divergirem.
    const dadosParaRestaurar = {
      personaNome: linhaOriginal?.personaNome ?? botConfig.persona.nome,
      personaPapel: linhaOriginal?.personaPapel ?? botConfig.persona.papel,
      regras: linhaOriginal?.regras ?? botConfig.regras,
      faq: linhaOriginal?.faq ?? botConfig.faq,
      ativo: linhaOriginal?.ativo ?? true,
    };
    await prisma.botConfig.upsert({
      where: { id: BOT_CONFIG_ID },
      update: dadosParaRestaurar,
      create: { id: BOT_CONFIG_ID, ...dadosParaRestaurar },
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
