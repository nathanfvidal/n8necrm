import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { decodeJwt, decodeProtectedHeader, generateKeyPair, importJWK, jwtVerify } from "jose";

/**
 * Trava o FORMATO do token que o Supabase vai aceitar.
 *
 * O token é a fronteira do Ciclo 1b: as políticas RLS do Ciclo 3 leem
 * `auth.jwt() ->> 'company_id'`, então o que está escrito aqui dentro é
 * exatamente o que o Postgres vai confiar. Um claim que some, um que sobre, ou
 * uma assinatura que deixe de bater não aparecem como erro no CRM — aparecem
 * como Realtime mudo, três saltos longe da causa (spec §4.3).
 *
 * Nenhum caso monta o token à mão e depois se pergunta o que montou: a
 * verificação é feita decodificando o token de verdade (`decodeJwt`,
 * `decodeProtectedHeader`) e, no bloco "assinatura", verificando com a chave
 * PÚBLICA que a rota do JWKS publica — do jeito que o Supabase faria.
 */

// `emitir.ts` importa `server-only`, que lança fora do bundler do Next. Mock
// local a este arquivo, mesmo padrão de `automation-config-preguicosa.test.ts`.
vi.mock("server-only", () => ({}));

const VARIAVEIS = ["SUPABASE_JWT_PRIVATE_JWK", "SUPABASE_JWT_ISSUER"] as const;
const guardadas: Record<string, string | undefined> = {};

async function prepararChave() {
  const { gerarParDeChaves } = await import("@/core/supabase-jwt/chave");
  const par = await gerarParDeChaves();
  process.env.SUPABASE_JWT_PRIVATE_JWK = JSON.stringify(par.privado);
  process.env.SUPABASE_JWT_ISSUER = "https://crm.teste.invalid";
  vi.resetModules();
  return par;
}

beforeEach(() => {
  vi.resetModules();
  for (const nome of VARIAVEIS) {
    guardadas[nome] = process.env[nome];
    delete process.env[nome];
  }
});

afterEach(() => {
  vi.useRealTimers();
  for (const nome of VARIAVEIS) {
    if (guardadas[nome] === undefined) delete process.env[nome];
    else process.env[nome] = guardadas[nome];
  }
});

describe("formato do token", () => {
  it("o payload tem EXATAMENTE os seis claims do desenho", async () => {
    await prepararChave();
    const { emitirTokenSupabase } = await import("@/core/supabase-jwt/emitir");
    const { token } = await emitirTokenSupabase({ sub: "user-1", companyId: "empresa-a" });

    // Conjunto EXATO, não "contém": claim a mais é superfície a mais, e um
    // aperto de validação do Supabase (aconteceu em 2025-07-24, changelog
    // "Data API v13 tightened JWT validation") tem que aparecer aqui como
    // vermelho, não como Realtime mudo em produção.
    expect(Object.keys(decodeJwt(token)).sort()).toEqual([
      "company_id",
      "exp",
      "iat",
      "iss",
      "role",
      "sub",
    ]);
  });

  it("o header tem EXATAMENTE alg, kid e typ, com o kid da chave", async () => {
    const par = await prepararChave();
    const { emitirTokenSupabase } = await import("@/core/supabase-jwt/emitir");
    const { token } = await emitirTokenSupabase({ sub: "user-1", companyId: "empresa-a" });

    const header = decodeProtectedHeader(token);
    expect(Object.keys(header).sort()).toEqual(["alg", "kid", "typ"]);
    expect(header.alg).toBe("ES256");
    expect(header.kid).toBe(par.privado.kid);
  });

  it("role é authenticated — sem ele o Postgres cai em anon, que está revogado de tudo", async () => {
    await prepararChave();
    const { emitirTokenSupabase } = await import("@/core/supabase-jwt/emitir");
    const { token } = await emitirTokenSupabase({ sub: "user-1", companyId: "empresa-a" });
    expect(decodeJwt(token).role).toBe("authenticated");
  });

  it("company_id e sub vêm da entrada, sem transformação", async () => {
    await prepararChave();
    const { emitirTokenSupabase } = await import("@/core/supabase-jwt/emitir");
    const { token } = await emitirTokenSupabase({
      sub: "cmt18abc",
      companyId: "company-migracao-1a",
    });
    const payload = decodeJwt(token);
    expect(payload.sub).toBe("cmt18abc");
    expect(payload.company_id).toBe("company-migracao-1a");
  });

  it("NÃO carrega aud, email nem o papel do CRM", async () => {
    await prepararChave();
    const { emitirTokenSupabase } = await import("@/core/supabase-jwt/emitir");
    const { token } = await emitirTokenSupabase({ sub: "user-1", companyId: "empresa-a" });
    const payload = decodeJwt(token) as Record<string, unknown>;

    // `papel` é a exclusão que mais importa: autorização por papel vive no
    // caminho do Prisma (`hasPermission`). Pôr o papel no token criaria uma
    // SEGUNDA fonte de verdade sobre autorização — a mesma dívida que o
    // Ciclo 1a já carrega com User.papel (R4).
    expect(payload.aud).toBeUndefined();
    expect(payload.email).toBeUndefined();
    expect(payload.papel).toBeUndefined();
    expect(payload.role).toBe("authenticated");
  });
});

describe("vida do token", () => {
  it("vale 300 segundos, e expiraEm bate com o claim exp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T12:00:00.000Z"));
    await prepararChave();
    const { emitirTokenSupabase, VIDA_DO_TOKEN_SEGUNDOS } = await import(
      "@/core/supabase-jwt/emitir"
    );
    const { token, expiraEm } = await emitirTokenSupabase({ sub: "u", companyId: "c" });

    const payload = decodeJwt(token);
    expect(VIDA_DO_TOKEN_SEGUNDOS).toBe(300);
    expect(payload.exp! - payload.iat!).toBe(300);
    expect(expiraEm).toBe(payload.exp);
  });
});

describe("assinatura", () => {
  it("verifica com a chave pública que o JWKS publica", async () => {
    await prepararChave();
    const { jwksPublico } = await import("@/core/supabase-jwt/chave");
    const { emitirTokenSupabase } = await import("@/core/supabase-jwt/emitir");

    const { token } = await emitirTokenSupabase({ sub: "u", companyId: "c" });
    const jwks = await jwksPublico();
    const publica = await importJWK(jwks.keys[0]!, "ES256");

    const { payload } = await jwtVerify(token, publica);
    expect(payload.company_id).toBe("c");
  });

  it("NÃO verifica com outra chave — controle negativo", async () => {
    await prepararChave();
    const { emitirTokenSupabase } = await import("@/core/supabase-jwt/emitir");
    const { token } = await emitirTokenSupabase({ sub: "u", companyId: "c" });

    const { publicKey } = await generateKeyPair("ES256", { extractable: true });
    await expect(jwtVerify(token, publicKey)).rejects.toThrow();
  });
});

describe("a guarda server-only", () => {
  it("está no topo de emitir.ts — sem ela, nada mais na suíte notaria a remoção", async () => {
    // Asserção sobre o TEXTO do arquivo, e não sobre comportamento, porque
    // dentro deste processo o `vi.mock` do topo (hoisted, escopo de arquivo)
    // torna `server-only` inofensivo — o que é justamente o que impede um
    // teste de comportamento de observar a guarda aqui. Mesma técnica que
    // `supabase-jwt-chave.test.ts` usa para afirmar a ausência de
    // `NEXT_PUBLIC_SUPABASE_JWT` no fonte.
    //
    // O que este caso protege: `emitir.ts` alcança a chave PRIVADA. Removida a
    // linha, o único obstáculo até um bundle de cliente volta a ser o bundler
    // tropeçar em módulos de Node — proteção que some quando a dependência
    // muda (é o registro que `src/lib/prisma.ts` guarda, fix round 2/5).
    const fonte = readFileSync("src/core/supabase-jwt/emitir.ts", "utf8");
    expect(fonte).toContain('import "server-only";');
  });
});

describe("issuer", () => {
  it("lança nomeando SUPABASE_JWT_ISSUER quando ela falta", async () => {
    const { gerarParDeChaves } = await import("@/core/supabase-jwt/chave");
    const { privado } = await gerarParDeChaves();
    process.env.SUPABASE_JWT_PRIVATE_JWK = JSON.stringify(privado);
    delete process.env.SUPABASE_JWT_ISSUER;

    vi.resetModules();
    const { emitirTokenSupabase } = await import("@/core/supabase-jwt/emitir");
    await expect(emitirTokenSupabase({ sub: "u", companyId: "c" })).rejects.toThrow(
      "SUPABASE_JWT_ISSUER"
    );
  });
});
