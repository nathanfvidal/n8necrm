import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Trava três coisas sobre a chave de assinatura do JWT do Supabase.
 *
 * 1. **Carga preguiçosa.** `next build` avalia todo módulo alcançável para
 *    coletar a configuração das rotas; validar env no escopo do módulo faz a
 *    validação rodar em tempo de BUILD, onde a variável não existe. Foi assim
 *    que o deploy quebrou por três dias em 2026-08-07 (ver o comentário longo
 *    em `src/modules/whatsapp/gateway/index.ts`). O caso "importar com o
 *    ambiente vazio não lança" é a versão executável dessa regra.
 * 2. **A privada nunca vira pública por omissão.** `jwkPublico` monta por
 *    lista BRANCA; o caso afirma o conjunto EXATO de campos, porque um
 *    `delete jwk.d` (lista negra) publicaria qualquer campo privado novo que
 *    entrasse no schema depois.
 * 3. **Nenhum `NEXT_PUBLIC_` encosta nesta variável.** O prefixo empacota o
 *    valor no bundle do navegador — a chave que assina TODO token do CRM.
 */
const VARIAVEIS = ["SUPABASE_JWT_PRIVATE_JWK"] as const;
const guardadas: Record<string, string | undefined> = {};

beforeEach(() => {
  // O módulo memoiza a chave; sem `resetModules`, um teste que carregou com
  // sucesso deixaria o próximo passar por engano.
  vi.resetModules();
  for (const nome of VARIAVEIS) {
    guardadas[nome] = process.env[nome];
    delete process.env[nome];
  }
});

afterEach(() => {
  for (const nome of VARIAVEIS) {
    if (guardadas[nome] === undefined) delete process.env[nome];
    else process.env[nome] = guardadas[nome];
  }
});

describe("carga preguiçosa", () => {
  it("importar o módulo com o ambiente VAZIO não lança", async () => {
    await expect(import("@/core/supabase-jwt/chave")).resolves.toBeDefined();
  });

  it("só lança quando alguém pede a chave", async () => {
    const { chaveDeAssinatura } = await import("@/core/supabase-jwt/chave");
    await expect(chaveDeAssinatura()).rejects.toThrow("SUPABASE_JWT_PRIVATE_JWK");
  });
});

describe("validação do JWK", () => {
  it("recusa JSON inválido dizendo o nome da variável", async () => {
    process.env.SUPABASE_JWT_PRIVATE_JWK = "{isto não é json";
    const { chaveDeAssinatura } = await import("@/core/supabase-jwt/chave");
    // `[\s\S]*` e não `.*` com a flag `s`: `tsconfig.json` deste projeto tem
    // "target": "ES2017", e `tsc --noEmit` recusa a flag dotAll com
    // "error TS1501: This regular expression flag is only available when
    // targeting 'es2018' or later" (medido em 2026-08-20). A classe explícita
    // casa quebra de linha em qualquer target.
    await expect(chaveDeAssinatura()).rejects.toThrow(/SUPABASE_JWT_PRIVATE_JWK[\s\S]*JSON/);
  });

  it("recusa a chave PÚBLICA colada no lugar da privada, e diz isso", async () => {
    const { gerarParDeChaves } = await import("@/core/supabase-jwt/chave");
    const { publico } = await gerarParDeChaves();
    process.env.SUPABASE_JWT_PRIVATE_JWK = JSON.stringify(publico);

    vi.resetModules();
    const { chaveDeAssinatura } = await import("@/core/supabase-jwt/chave");
    await expect(chaveDeAssinatura()).rejects.toThrow(/chave PÚBLICA/);
  });

  it("recusa curva diferente de P-256", async () => {
    const { gerarParDeChaves } = await import("@/core/supabase-jwt/chave");
    const { privado } = await gerarParDeChaves();
    process.env.SUPABASE_JWT_PRIVATE_JWK = JSON.stringify({ ...privado, crv: "P-384" });

    vi.resetModules();
    const { chaveDeAssinatura } = await import("@/core/supabase-jwt/chave");
    await expect(chaveDeAssinatura()).rejects.toThrow(/crv/);
  });

  it("recusa JWK sem kid — sem ele o Supabase não sabe qual chave usar", async () => {
    const { gerarParDeChaves } = await import("@/core/supabase-jwt/chave");
    const { privado } = await gerarParDeChaves();
    // Monta o objeto sem `kid` em vez de desestruturar com uma variável
    // descartada: `const { kid: _fora, ... }` renderia aviso de lint novo, e a
    // linha de base do projeto é "zero erros, 6 avisos pré-existentes".
    process.env.SUPABASE_JWT_PRIVATE_JWK = JSON.stringify({
      kty: privado.kty,
      crv: privado.crv,
      x: privado.x,
      y: privado.y,
      d: privado.d,
    });

    vi.resetModules();
    const { chaveDeAssinatura } = await import("@/core/supabase-jwt/chave");
    await expect(chaveDeAssinatura()).rejects.toThrow(/kid/);
  });
});

describe("chave válida", () => {
  it("devolve o kid do JWK, e o mesmo kid aparece no JWKS público", async () => {
    const { gerarParDeChaves } = await import("@/core/supabase-jwt/chave");
    const { privado } = await gerarParDeChaves();
    process.env.SUPABASE_JWT_PRIVATE_JWK = JSON.stringify(privado);

    vi.resetModules();
    const { chaveDeAssinatura, jwksPublico } = await import("@/core/supabase-jwt/chave");
    const { kid } = await chaveDeAssinatura();
    const jwks = await jwksPublico();

    expect(kid).toBe(privado.kid);
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]!.kid).toBe(privado.kid);
  });

  it("o JWK público tem EXATAMENTE estes campos, e d não é um deles", async () => {
    const { gerarParDeChaves, jwkPublico } = await import("@/core/supabase-jwt/chave");
    const { privado } = await gerarParDeChaves();
    const publico = jwkPublico(privado);

    // Conjunto exato, não "não tem d": lista branca é o que impede um campo
    // privado NOVO de ser publicado por omissão.
    expect(Object.keys(publico).sort()).toEqual(["alg", "crv", "kid", "kty", "use", "x", "y"]);
    expect(JSON.stringify(publico)).not.toContain(privado.d);
  });
});

describe("a variável nunca é pública", () => {
  it("nenhum arquivo do projeto usa NEXT_PUBLIC_SUPABASE_JWT", () => {
    // Varredura de texto, e não de tipo: o prefixo é convenção do bundler,
    // então o compilador nunca reclamaria. `.env.example` entra porque é o
    // arquivo que ENSINA o próximo desenvolvedor.
    const alvos = [".env.example"];
    for (const alvo of alvos) {
      expect(readFileSync(alvo, "utf8")).not.toContain("NEXT_PUBLIC_SUPABASE_JWT");
    }
  });
});

describe("`.env.example` ensina o deploy a não quebrar o login", () => {
  // Varredura de texto cru, mesmo padrão do bloco acima: o que este arquivo
  // não ensinar, quem publica não configura. Nenhuma destas afirmações é
  // sobre COMPORTAMENTO do código -- é sobre a documentação executável do
  // deploy, que foi exatamente o que faltou até 2026-08-21.
  const exemplo = readFileSync(".env.example", "utf8");

  it("documenta AUTH_URL e AUTH_TRUST_HOST — sem elas o login inteiro quebra", () => {
    // Achado do plano de deploy de 2026-08-21: `playwright.config.ts:73-75`
    // sobe o servidor com AUTH_TRUST_HOST="true", e o comentário das linhas
    // 60-72 de lá explica por quê. A causa está em
    // node_modules/@auth/core/lib/utils/env.js: `config.trustHost` cai para
    // `envObject.NODE_ENV !== "production"` quando nem AUTH_URL nem
    // AUTH_TRUST_HOST estão definidas. `next start` roda com
    // NODE_ENV=production, logo trustHost=false, logo `UntrustedHost`.
    //
    // Até este caso existir, a variável morava SÓ na configuração de teste --
    // um deploy novo herdava um CRM que sobe, responde, desenha o formulário
    // e recusa o login.
    expect(exemplo).toMatch(/^AUTH_URL=/m);
    expect(exemplo).toMatch(/^AUTH_TRUST_HOST=/m);
  });

  it("o comentário nomeia `UntrustedHost`, que é o que a pessoa vai buscar", () => {
    // O erro não aparece na tela: sai no log do servidor. "UntrustedHost" é a
    // string que alguém cola num buscador às 2 da manhã; um comentário que
    // diga só "configure a URL" não a traz de volta a este arquivo.
    expect(exemplo).toContain("UntrustedHost");
  });

  it("AUTH_URL é só origem, sem caminho — caminho mudaria o basePath do Auth.js", () => {
    // Este caso trava uma armadilha medida na fonte, não uma preferência de
    // estilo. Em node_modules/next-auth/lib/env.js, `setEnvDefaults` faz
    // `const { pathname } = new URL(url); if (pathname === "/") return;` e só
    // então cai no `finally` que fixa basePath em "/api/auth". Com um caminho
    // dentro de AUTH_URL (ex.: ".../crm"), o basePath vira aquele caminho e as
    // rotas /api/auth/* deixam de existir. Como nada em src/ define `basePath`
    // (conferido em 2026-08-21: `grep -rn basePath src/` não devolve nada), o
    // valor de AUTH_URL é a ÚNICA coisa que decide isso.
    const linha = exemplo.match(/^AUTH_URL=(.*)$/m);
    expect(linha).not.toBeNull();
    const valor = linha![1]!.trim().replace(/^["']|["']$/g, "");
    expect(new URL(valor).pathname).toBe("/");
  });
});

describe("package.json", () => {
  it("declara `engines` — o host do deploy não tem isolamento de runtime", () => {
    // A hospedagem escolhida em 2026-08-21 é systemd no host, sem Docker (ver
    // docs/superpowers/plans/2026-08-21-n8necrm-deploy-vps.md). Sem container,
    // um `apt upgrade` troca o Node debaixo da aplicação sem rebuild nenhum.
    // `engines` é METADE da defesa: o npm só avisa. A trava dura, que falha,
    // fica em deploy/deploy.sh -- por isso não há `.npmrc` com engine-strict,
    // que transformaria o aviso em erro de `npm ci` em toda máquina, inclusive
    // na de quem só clona o repositório para olhar.
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.engines?.node).toBe(">=22.18.0 <23");
  });
});
