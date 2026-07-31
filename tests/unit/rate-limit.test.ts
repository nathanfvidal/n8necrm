// Este arquivo (e apenas ele, junto com audit-log.test.ts) usa o Prisma real
// contra o Postgres do Supabase, então carrega DATABASE_URL do .env aqui —
// não em vitest.config.ts — para não injetar credenciais (AUTH_SECRET,
// SUPABASE_SERVICE_ROLE_KEY, ...) em arquivos de teste que não tocam banco.
// Precisa ser o primeiro import: os módulos abaixo (via src/lib/prisma.ts →
// src/lib/env.ts) leem process.env.DATABASE_URL no top-level.
import "dotenv/config";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../../src/lib/prisma";
import { checarRateLimit } from "../../src/core/rate-limit/limiter";

// Todas as chaves usadas aqui começam com "teste:" — nunca usamos
// deleteMany() sem esse filtro, porque esta suíte roda contra o Postgres
// real do Supabase (compartilhado com a Task 9 e com dados de produção).
async function limparChavesDeTeste() {
  await prisma.rateLimit.deleteMany({ where: { chave: { startsWith: "teste:" } } });
}

describe("checarRateLimit", () => {
  beforeEach(limparChavesDeTeste);
  afterEach(limparChavesDeTeste);

  it("permite as primeiras N chamadas dentro do limite", async () => {
    const chave = "teste:formulario:sessao-1";
    for (let i = 0; i < 3; i++) {
      const permitido = await checarRateLimit(chave, 3, 60_000);
      expect(permitido).toBe(true);
    }
  });

  it("bloqueia a chamada que excede o limite na mesma janela", async () => {
    const chave = "teste:formulario:sessao-2";
    await checarRateLimit(chave, 2, 60_000);
    await checarRateLimit(chave, 2, 60_000);
    const terceira = await checarRateLimit(chave, 2, 60_000);
    expect(terceira).toBe(false);
  });

  it("a primeira chamada de uma chave nova sempre é permitida e inicia a janela agora", async () => {
    const chave = "teste:formulario:sessao-primeira-chamada";
    const antes = new Date();
    const permitido = await checarRateLimit(chave, 1, 60_000);
    expect(permitido).toBe(true);

    const registro = await prisma.rateLimit.findUniqueOrThrow({ where: { chave } });
    expect(registro.contagem).toBe(1);
    expect(registro.janelaInicio.getTime()).toBeGreaterThanOrEqual(antes.getTime());
  });

  it("depois que a janela expira, a contagem reseta e a janela avança (janela fixa, não deslizante)", async () => {
    const chave = "teste:formulario:sessao-janela";
    const janelaMs = 100;

    const primeira = await checarRateLimit(chave, 1, janelaMs);
    expect(primeira).toBe(true);

    // Ainda dentro da janela: já usou a única chamada permitida.
    const segunda = await checarRateLimit(chave, 1, janelaMs);
    expect(segunda).toBe(false);

    // Espera a janela expirar.
    await new Promise((resolve) => setTimeout(resolve, janelaMs + 50));

    const terceira = await checarRateLimit(chave, 1, janelaMs);
    expect(terceira).toBe(true);

    const registro = await prisma.rateLimit.findUniqueOrThrow({ where: { chave } });
    expect(registro.contagem).toBe(1);
  });

  it("sob concorrência, no máximo `limite` chamadas simultâneas são permitidas na mesma janela", async () => {
    const chave = "teste:formulario:concorrencia";
    const limite = 5;
    const totalDeChamadas = 15;

    const resultados = await Promise.all(
      Array.from({ length: totalDeChamadas }, () => checarRateLimit(chave, limite, 60_000))
    );

    const permitidas = resultados.filter((permitido) => permitido).length;
    // Sem atomicidade (read-then-write sem transação), duas chamadas
    // concorrentes podem ler a mesma contagem e ambas passarem — o limite
    // vazaria e permitidas > limite. Este teste prova que isso não acontece.
    expect(permitidas).toBe(limite);

    const registro = await prisma.rateLimit.findUniqueOrThrow({ where: { chave } });
    expect(registro.contagem).toBeGreaterThanOrEqual(limite);
  });
});
