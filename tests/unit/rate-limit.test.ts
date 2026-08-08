// Este arquivo (e apenas ele, junto com audit-log.test.ts) usa o Prisma real
// contra o Postgres do Supabase, então carrega DATABASE_URL do .env aqui —
// não em vitest.config.ts — para não injetar credenciais (AUTH_SECRET,
// SUPABASE_SERVICE_ROLE_KEY, ...) em arquivos de teste que não tocam banco.
// Precisa ser o primeiro import: os módulos abaixo (via src/lib/prisma.ts →
// src/lib/env.ts) leem process.env.DATABASE_URL no top-level.
import "dotenv/config";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
import {
  checarRateLimit,
  podarRateLimitExpirado,
  RETENCAO_RATE_LIMIT_MS,
} from "../../src/core/rate-limit/limiter";

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
    // janelaMs=100 com uma espera de +50ms flakou repetidamente (achado da
    // revisão final de branch): cada checarRateLimit() é uma ida e volta ao
    // Postgres REMOTO do Supabase, então os 150ms totais de folga podiam
    // não sobrar depois do round-trip das duas primeiras chamadas, fazendo
    // a terceira chamada ainda cair dentro da janela "antiga" por sorte de
    // latência de rede — não por a janela fixa estar errada. Alargar a
    // janela e a folga pós-expiração não muda o que o teste prova (ainda
    // reseta a contagem e avança a janela); só dá margem real para jitter.
    const janelaMs = 1000;

    const primeira = await checarRateLimit(chave, 1, janelaMs);
    expect(primeira).toBe(true);

    // Ainda dentro da janela: já usou a única chamada permitida.
    const segunda = await checarRateLimit(chave, 1, janelaMs);
    expect(segunda).toBe(false);

    // Espera a janela expirar, com folga generosa para jitter de rede.
    await new Promise((resolve) => setTimeout(resolve, janelaMs + 1000));

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

// --- Fase 2 da auditoria de segurança -------------------------------------
//
// Achado: a tabela `RateLimit` nunca era podada (nenhum DELETE no código,
// nenhum cron em `vercel.json`), e uma das chaves é ESCOLHIDA PELO ATACANTE a
// partir de um endpoint SEM autenticação — `login:conta:<email>`
// (`rate-limit/login.ts`) usa o e-mail digitado no POST de login. Cada e-mail
// inédito criava uma linha permanente. O limite por IP segura o ritmo (20 por
// 10 min por origem), então é crescimento lento, não explosivo — mas é
// ilimitado, e escala com o número de origens. O controle antiabuso virara,
// ele mesmo, uma pequena superfície de escrita não autenticada.
describe("podarRateLimitExpirado", () => {
  beforeEach(limparChavesDeTeste);
  afterEach(limparChavesDeTeste);

  it("apaga a linha cuja janela expirou há mais que a retenção", async () => {
    const chave = "teste:poda:antiga";
    await prisma.rateLimit.create({
      data: {
        chave,
        janelaInicio: new Date(Date.now() - RETENCAO_RATE_LIMIT_MS - 60_000),
        contagem: 7,
      },
    });

    await podarRateLimitExpirado();

    expect(await prisma.rateLimit.findUnique({ where: { chave } })).toBeNull();
  });

  it("PRESERVA linha dentro da retenção — podar um bloqueio vivo seria liberar quem está barrado", async () => {
    const chave = "teste:poda:viva";
    await prisma.rateLimit.create({
      data: { chave, janelaInicio: new Date(), contagem: 99 },
    });

    await podarRateLimitExpirado();

    const registro = await prisma.rateLimit.findUnique({ where: { chave } });
    expect(registro).not.toBeNull();
    expect(registro!.contagem).toBe(99);
  });

  // A propriedade que torna a poda segura: apagar linha expirada é INÓCUO.
  // A janela é fixa (ver limiter.ts) — passada `janelaMs`, a próxima chamada
  // já reescreveria `janelaInicio` e zeraria a contagem. Apagar a linha antes
  // disso leva ao mesmo estado observável, por outro caminho. É por isso que
  // a retenção (24h) precisa ser maior que a MAIOR janela em uso (1h, do
  // export): dentro dessa folga não existe linha viva para a poda alcançar.
  it("apagar linha expirada leva ao mesmo estado que a janela fixa já produziria", async () => {
    const chave = "teste:poda:inocua";
    await prisma.rateLimit.create({
      data: {
        chave,
        janelaInicio: new Date(Date.now() - RETENCAO_RATE_LIMIT_MS - 60_000),
        contagem: 500,
      },
    });

    await podarRateLimitExpirado();

    // Limite 1: se a contagem 500 tivesse sobrevivido à poda de forma
    // significativa, esta chamada seria recusada.
    expect(await checarRateLimit(chave, 1, 60_000)).toBe(true);
    const registro = await prisma.rateLimit.findUniqueOrThrow({ where: { chave } });
    expect(registro.contagem).toBe(1);
  });

  it("a retenção é maior que a maior janela em uso no sistema", () => {
    const MAIOR_JANELA_EM_USO_MS = 60 * 60_000; // export de leads
    expect(RETENCAO_RATE_LIMIT_MS).toBeGreaterThan(MAIOR_JANELA_EM_USO_MS);
  });
});
