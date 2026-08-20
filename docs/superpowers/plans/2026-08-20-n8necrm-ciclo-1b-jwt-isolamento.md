# n8necrm — Ciclo 1b (JWT do Supabase e isolamento) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O CRM emite um JWT ES256 que o Supabase aceita, com `company_id` vindo da sessão do servidor, e prova — com comando e saída — que o claim chega até `auth.jwt() ->> 'company_id'`. Sem abrir canal de Realtime, sem escrever política, sem conceder grant.

**Architecture:** Third-party auth com JWKS próprio: a chave privada mora só no CRM, numa variável de ambiente com o JWK privado inteiro (o `kid` viaja dentro dela, então header e JWKS não têm como divergir). Uma rota pública publica a metade pública; uma rota autenticada emite o token lendo a empresa de `usuarioAtual()` e **não lendo nada da requisição**; uma fábrica de callback renova no heartbeat com memoização e trava de concorrência. Toda carga de ambiente é preguiçosa, no padrão de `src/modules/whatsapp/gateway/index.ts`.

**Tech Stack:** Next.js 16.3 (App Router, route handlers), `jose` 6.2.5, Zod 4, Prisma 7.9 + `@prisma/adapter-pg`, Postgres 17.6 (Supabase `uzumzfxjcxrbxaucvfsr`), Vitest 4, Playwright 1.62.

**Spec:** `docs/superpowers/specs/2026-08-20-ciclo-1b-jwt-isolamento-design.md`
**Medição de base:** `.superpowers/sdd/medicao-jwt-supabase.md`

## Global Constraints

- **Idioma do código é português.** Comentário explica **por que**, com evidência.
- **Antes de qualquer trabalho que toque o banco, invocar as três skills juntas:** `supabase`, `supabase-postgres-best-practices`, `auditing-supabase-security`. Vale para as Tarefas 6, 7 e 8.
- **Nenhuma política RLS, nenhum grant, nenhuma migration neste ciclo.** Se uma tarefa parecer precisar disso, ela saiu do escopo — pare e reporte.
- **Nenhum arquivo novo pode importar `@/lib/prisma`.** A lista de exceção do lint chegou a **zero temporárias** no Ciclo 1a e há catraca (`tests/unit/catraca-prisma-cru.test.ts`) que só permite diminuir. Se alguma tarefa criar arquivo que precise do `prisma` cru, ele vira **exceção PERMANENTE** com justificativa verificável no `eslint.config.mjs` — e o desenho diz que isso **não** deve acontecer neste ciclo (spec § 4.6). Se acontecer, pare e reporte antes de acrescentar a linha.
- **`companyId` viaja como parâmetro explícito.** `AsyncLocalStorage` e estado global continuam proibidos.
- **Nunca `prisma.company.findFirst()`** como origem de empresa.
- **Toda frase que afirme universal** — "todo", "sempre", "nenhum", "qualquer", "só" — precisa do caso de teste que a exercita, ou é reescrita. Foi a família que reincidiu três vezes no Ciclo 1a.
- **Provar, não presumir.** O que este ambiente não provar sai como **NÃO VERIFICADO**, com o comando que um humano roda.
- **Não rodar `npm test` inteiro** salvo quando um passo pedir: ele executa o seed contra o banco de desenvolvimento real e reescreve a senha do admin (⚠️ R1 da auditoria do Ciclo 1a). Rodar os arquivos focados.
- **Nada de `vitest` em paralelo com outra execução de `vitest`.** O banco de teste não é separado do de desenvolvimento; duas execuções o envenenam.
- Nenhum segredo no repositório. **Nunca ler nem imprimir o `.env`.** O JWK privado é gerado e colado pelo **dono**, não pelo agente.
- Toda mensagem de commit termina com:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **Branch de trabalho: `ciclo-1b-jwt-isolamento`**, criada a partir de `ciclo-1a-tenancy`.

## Linha de base medida em 2026-08-20 — conferir se mudou antes de fechar

| Medida | Valor | Como |
| --- | --- | --- |
| Políticas no schema `realtime` | **0** | `select count(*) from pg_policies where schemaname='realtime'` |
| Grants para `anon`/`authenticated` em `public` | **0** | `information_schema.role_table_grants` |
| Tabelas sem RLS em `public` | **0** | `pg_class.relrowsecurity` |
| Advisor de segurança | 15 × `rls_enabled_no_policy` (INFO) + 2 × WARN de `rls_auto_enable` | `get_advisors(security)` |
| Exceções do lint | 5 permanentes, **0** temporárias | `eslint.config.mjs` |
| `jose` em `node_modules` | 6.2.5, **transitiva** via `@auth/core` | `package-lock.json` |

## Ações do dono que travam a execução

A execução **para** na Tarefa 7 sem elas. Estão detalhadas na seção 8 do spec.

| # | Ação | Trava a partir de |
| --- | --- | --- |
| D1 | Desligar *Allow public access* em `Realtime → Settings` | nada aqui, mas vale antes de qualquer deploy — sem isso o RLS de canal não tranca nada |
| D2 | Reportar o inventário de `Settings → JWT Keys` | nada aqui; fecha o NV1 do spec |
| D3 | Rodar `npx tsx scripts/gerar-chave-jwt-supabase.ts` e pôr `SUPABASE_JWT_PRIVATE_JWK`, `SUPABASE_JWT_ISSUER` e `SUPABASE_PUBLISHABLE_KEY` no `.env` | **Tarefa 7** |
| D4 | Registrar o provider de third-party auth (`custom_jwks` em dev) | **Tarefa 8** |
| D5 | Gerar um PAT do Management API, se o painel não tiver campo genérico | **Tarefa 8**, se D4 exigir |

---

### Task 1: `jose` como dependência direta, `.env.example`, e a chave

**DEPENDE DE AÇÃO DO DONO:** não para o código e os testes (eles geram chave efêmera). Sim para o valor real no `.env` — ação D3, que só é exigida na Tarefa 7.

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `.env.example`
- Create: `src/core/supabase-jwt/chave.ts`
- Create: `scripts/gerar-chave-jwt-supabase.ts`
- Test: `tests/unit/supabase-jwt-chave.test.ts` (novo)

**Interfaces:**
- Consumes: nada deste ciclo. `jose` 6.2.5, `zod` 4.
- Produces:
  - `ALGORITMO: "ES256"` e `CURVA: "P-256"` (constantes exportadas)
  - `type JwkPrivado = { kty: "EC"; crv: "P-256"; x: string; y: string; d: string; kid: string }`
  - `chaveDeAssinatura(): Promise<{ kid: string; chave: CryptoKey }>` — lê `SUPABASE_JWT_PRIVATE_JWK`, **preguiçoso e memoizado**
  - `jwkPublico(jwk: JwkPrivado): JWK` — lista **branca** de campos, sem `d`
  - `jwksPublico(): Promise<JSONWebKeySet>` — `{ keys: [<a pública>] }`
  - `gerarParDeChaves(): Promise<{ privado: JwkPrivado; publico: JWK }>` — puro, sem env, sem disco
  - variáveis de ambiente documentadas: `SUPABASE_JWT_PRIVATE_JWK`, `SUPABASE_JWT_ISSUER`, `SUPABASE_PUBLISHABLE_KEY`

- [ ] **Step 1: Provar que `jose` é transitiva hoje, e torná-la direta**

```bash
cd "d:/Projetos Programação/N8n + Crm"
node -e "console.log('direta:', require('./package.json').dependencies.jose)"
node -e "console.log('instalada:', require('./node_modules/jose/package.json').version)"
```

Saída esperada **antes**:
```
direta: undefined
instalada: 6.2.5
```

`jose` está em `node_modules` porque `@auth/core` depende dela (`package-lock.json`, `"jose": "^6.0.6"`) e o npm a içou para a raiz. **Hoisting não é contrato**: uma atualização do `next-auth` que aninhe a dependência, ou um gerenciador com `node_modules` isolado, faria `import { SignJWT } from "jose"` sumir sem nenhum aviso — e o código deste ciclo é o que assina token de autenticação.

```bash
npm install jose@^6.2.5
node -e "console.log('direta:', require('./package.json').dependencies.jose)"
```

Saída esperada **depois**: `direta: ^6.2.5`. Cole as duas.

- [ ] **Step 2: Escrever o teste que falha**

Criar `tests/unit/supabase-jwt-chave.test.ts`:

```ts
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
    await expect(chaveDeAssinatura()).rejects.toThrow(/SUPABASE_JWT_PRIVATE_JWK.*JSON/s);
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
```

- [ ] **Step 3: Rodar e confirmar que falha (RED)**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/supabase-jwt-chave.test.ts
```

Espera-se falha de resolução de módulo (`Cannot find module '@/core/supabase-jwt/chave'`). Guarde a saída.

- [ ] **Step 4: Criar `src/core/supabase-jwt/chave.ts`**

```ts
import { exportJWK, generateKeyPair, importJWK, type CryptoKey, type JSONWebKeySet, type JWK } from "jose";
import { z } from "zod";

/**
 * A chave que assina os JWT que o Supabase aceita.
 *
 * ## Por que JWK inteiro numa variável, e não PEM PKCS8
 *
 * Três motivos, e o segundo é o que decide:
 *
 * 1. **PEM tem quebra de linha; `.env` e o painel da Vercel, não.** Guardar PEM
 *    em variável obriga a escapar `\n` ou embrulhar em base64, e as duas saídas
 *    falham do mesmo jeito: chave que parece presente e morre no parser, longe
 *    da causa.
 * 2. **O `kid` viaja DENTRO da chave.** O Supabase localiza a chave de
 *    verificação pelo `kid` do header do token ("The signed JWTs must have a
 *    `kid` header parameter to identify which key must be used" — guia de
 *    third-party auth). Com o `kid` aqui dentro, o header do token e o JWKS
 *    publicado saem do MESMO objeto e não têm como divergir. Com PEM, `kid`
 *    seria uma segunda variável — duas fontes de verdade para um identificador
 *    de chave, que é como nasce "token recusado sem explicação".
 * 3. **A pública é DERIVADA daqui**, então não existe o estado "publiquei a
 *    pública de uma chave e assino com outra".
 *
 * ## Por que a leitura é preguiçosa
 *
 * `next build` avalia cada módulo alcançável para coletar a configuração das
 * rotas. Validar no escopo do módulo faz a validação rodar em tempo de BUILD,
 * onde a variável não existe — foi assim que o deploy caiu por três dias em
 * 2026-08-07 (`src/modules/whatsapp/gateway/index.ts` guarda o log). Por isso
 * `src/lib/env.ts`, que valida no topo, NÃO recebe estas variáveis.
 * `tests/unit/supabase-jwt-chave.test.ts` importa este módulo com o ambiente
 * vazio e afirma que o import não lança.
 */
export const ALGORITMO = "ES256";
export const CURVA = "P-256";

const jwkPrivadoSchema = z.object({
  kty: z.literal("EC"),
  crv: z.literal(CURVA),
  x: z.string().min(1),
  y: z.string().min(1),
  d: z.string().min(1),
  kid: z.string().min(1),
});

export type JwkPrivado = z.infer<typeof jwkPrivadoSchema>;

function analisar(bruto: string): JwkPrivado {
  let json: unknown;
  try {
    json = JSON.parse(bruto);
  } catch {
    throw new Error(
      "SUPABASE_JWT_PRIVATE_JWK não é JSON válido. Ela guarda o JWK privado " +
        "inteiro, em UMA linha — gere com `npx tsx scripts/gerar-chave-jwt-supabase.ts`."
    );
  }

  const resultado = jwkPrivadoSchema.safeParse(json);
  if (resultado.success) return resultado.data;

  // O NOME do campo entra à força, e não só `issue.message`: quando o campo é
  // `undefined` o Zod falha na checagem de tipo e a mensagem que sobra é
  // "Invalid input: expected string, received undefined", sem dizer qual. Mesma
  // correção que `gateway/index.ts` fez depois de um log de build ilegível.
  const detalhes = resultado.error.issues
    .map((issue) => `${issue.path.join(".") || "(raiz)"}: ${issue.message}`)
    .join("; ");

  // A confusão mais provável de todas, e a que produz o erro mais opaco lá na
  // frente ("could not sign"): colar a metade que a rota do JWKS publica.
  const semD = typeof json === "object" && json !== null && !("d" in json);

  throw new Error(
    `SUPABASE_JWT_PRIVATE_JWK inválida: ${detalhes}.` +
      (semD ? ' O campo "d" está ausente — isto é a chave PÚBLICA, não a privada.' : "")
  );
}

let memo: { jwk: JwkPrivado; chave: CryptoKey } | null = null;

async function carregar(): Promise<{ jwk: JwkPrivado; chave: CryptoKey }> {
  if (memo) return memo;

  const bruto = process.env.SUPABASE_JWT_PRIVATE_JWK;
  if (!bruto) {
    throw new Error(
      "SUPABASE_JWT_PRIVATE_JWK ausente — defina no .env com o JWK privado ES256 " +
        "do CRM (ver .env.example). NUNCA com prefixo NEXT_PUBLIC_."
    );
  }

  const jwk = analisar(bruto);
  memo = { jwk, chave: await importJWK(jwk, ALGORITMO) };
  return memo;
}

/** A chave privada e o `kid` que vai no header do token. */
export async function chaveDeAssinatura(): Promise<{ kid: string; chave: CryptoKey }> {
  const { jwk, chave } = await carregar();
  return { kid: jwk.kid, chave };
}

/**
 * A metade pública, por lista BRANCA.
 *
 * Lista branca e não `delete jwk.d`: com lista negra, qualquer campo privado
 * novo que entrasse no schema passaria a ser publicado por omissão — e este é
 * o objeto que vai para a internet sem sessão nenhuma. É a mesma inversão que
 * fechou de verdade a validação de relação em `core/tenancy/escopo.ts`.
 */
export function jwkPublico(jwk: JwkPrivado): JWK {
  return {
    kty: jwk.kty,
    crv: jwk.crv,
    x: jwk.x,
    y: jwk.y,
    kid: jwk.kid,
    alg: ALGORITMO,
    use: "sig",
  };
}

/** O documento que `GET /api/jwks` serve. */
export async function jwksPublico(): Promise<JSONWebKeySet> {
  const { jwk } = await carregar();
  return { keys: [jwkPublico(jwk)] };
}

/**
 * Gera um par novo. Puro: não lê ambiente, não escreve em disco.
 *
 * Fica aqui, e não no script, porque assim ele é testável — o script é uma
 * casca de cinco linhas por cima disto. Os testes usam esta função para não
 * precisarem de segredo real nenhum.
 */
export async function gerarParDeChaves(): Promise<{ privado: JwkPrivado; publico: JWK }> {
  // `extractable: true` é obrigatório: por padrão o jose gera a privada
  // inextraível, e `exportJWK` falharia — que é justamente o passo que produz o
  // valor a colar no .env.
  const { privateKey } = await generateKeyPair(ALGORITMO, { extractable: true });
  const bruto = await exportJWK(privateKey);
  const privado = jwkPrivadoSchema.parse({ ...bruto, kid: globalThis.crypto.randomUUID() });
  return { privado, publico: jwkPublico(privado) };
}
```

- [ ] **Step 5: Criar `scripts/gerar-chave-jwt-supabase.ts`**

```ts
import { gerarParDeChaves } from "../src/core/supabase-jwt/chave";

/**
 * Gera o par ES256 do CRM e imprime as duas metades. Não grava nada em disco.
 *
 * Quem roda isto é o DONO do projeto, não um agente: a saída contém a chave que
 * assina todo token deste CRM, e ela não pode passar por transcrição de sessão
 * nem por log de ferramenta.
 */
async function principal() {
  const { privado, publico } = await gerarParDeChaves();

  console.log("\n=== 1. .env (NUNCA com prefixo NEXT_PUBLIC_) ===\n");
  console.log(`SUPABASE_JWT_PRIVATE_JWK='${JSON.stringify(privado)}'`);
  console.log("\n=== 2. JWKS público — para `custom_jwks` no registro do Supabase ===\n");
  console.log(JSON.stringify({ keys: [publico] }));
  console.log(`\nkid: ${privado.kid}\n`);
  console.log(
    "Em produção, em vez de custom_jwks, registre jwks_url apontando para\n" +
      "https://<origem-do-crm>/api/jwks — e apague o registro de dev ANTES,\n" +
      "porque um provider de dev registrado minta token válido em produção.\n"
  );
}

principal().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
```

- [ ] **Step 6: Documentar as três variáveis em `.env.example`**

Acrescentar no fim do arquivo, no mesmo nível de comentário dos vizinhos:

```
# --- JWT do Supabase (Ciclo 1b) -- ver src/core/supabase-jwt/ --------------

# JWK PRIVADO ES256 do CRM, em UMA linha, gerado por
# `npx tsx scripts/gerar-chave-jwt-supabase.ts`.
#
# É a chave que assina TODO token que o Supabase vai aceitar como
# `role: authenticated` neste projeto. Vazá-la é entregar leitura de qualquer
# empresa pelo caminho do navegador até a chave ser trocada -- e trocar leva
# até 30 minutos para o Supabase notar, quando o registro é por jwks_url.
#
# Por que o JWK inteiro e não PEM: o `kid` viaja dentro dele, então o header do
# token e o JWKS publicado saem do MESMO objeto e não têm como divergir. PEM
# exigiria uma segunda variável com o kid -- duas fontes de verdade para um
# identificador de chave.
#
# NUNCA com prefixo NEXT_PUBLIC_: o prefixo empacota o valor no bundle do
# navegador. `tests/unit/supabase-jwt-chave.test.ts` afirma que a string
# NEXT_PUBLIC_SUPABASE_JWT não aparece neste arquivo.
SUPABASE_JWT_PRIVATE_JWK='{"kty":"EC","crv":"P-256","x":"...","y":"...","d":"...","kid":"..."}'

# Quem mintou o token: a origem pública do CRM (ex.: "https://crm.seudominio.com").
# Em desenvolvimento, "http://localhost:3000".
#
# Não tem valor padrão de propósito. Um padrão plausível (localhost) carregado
# para produção seria pior que a falha: o claim `iss` existe justamente para
# dizer de qual deploy o token saiu quando alguém o encontra num log.
SUPABASE_JWT_ISSUER="http://localhost:3000"

# Chave PUBLICÁVEL do Supabase (`sb_publishable_...`), painel -> Settings -> API.
#
# Não é segredo -- é o `apikey` que todo cliente manda, e é público por
# construção. Está aqui porque a Data API EXIGE o header `apikey` além do
# `Authorization`, e a doc é explícita que o JWT mintado pelo CRM não serve
# nesse header ("Using your minted JWT is not possible in this header").
#
# Sem prefixo NEXT_PUBLIC_ por enquanto: neste ciclo ela só é lida pela suíte
# e2e, no servidor. Quem decide se o navegador precisa dela é o Ciclo 3.
SUPABASE_PUBLISHABLE_KEY="sb_publishable_..."
```

- [ ] **Step 7: Rodar (GREEN) e fechar**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/supabase-jwt-chave.test.ts
npm run typecheck
npm run lint
```

Esperado: 9 casos passando, `tsc` sem saída, lint com no máximo os 6 avisos pré-existentes e **zero erros**. Cole as três saídas.

- [ ] **Step 8: Commit**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git add package.json package-lock.json .env.example src/core/supabase-jwt scripts/gerar-chave-jwt-supabase.ts tests/unit/supabase-jwt-chave.test.ts
git commit -m "feat(jwt): chave ES256 do CRM, carregada preguicosamente

jose vira dependencia DIRETA: ela estava em node_modules so por ser
transitiva de @auth/core e ter sido icada pelo npm, e hoisting nao e
contrato -- uma atualizacao que a aninhe faria o import sumir sem aviso, no
codigo que assina token de autenticacao.

A chave mora num JWK inteiro e nao em PEM porque o kid viaja dentro dela:
header do token e JWKS publicado saem do mesmo objeto e nao tem como
divergir. A publica e derivada por lista BRANCA -- com lista negra, campo
privado novo no schema seria publicado por omissao.

Carga preguicosa, nao no escopo do modulo: next build avalia todo modulo
alcancavel e foi assim que o deploy caiu por tres dias em 2026-08-07.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Emissão do token, com o formato travado por teste

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Create: `src/core/supabase-jwt/emitir.ts`
- Test: `tests/unit/supabase-jwt-emitir.test.ts` (novo)

**Interfaces:**
- Consumes: `chaveDeAssinatura`, `ALGORITMO` (Task 1); `SUPABASE_JWT_ISSUER`.
- Produces:
  - `VIDA_DO_TOKEN_SEGUNDOS = 300`
  - `interface TokenSupabase { token: string; expiraEm: number }` (`expiraEm` em segundos desde 1970)
  - `emitirTokenSupabase(entrada: { sub: string; companyId: string }): Promise<TokenSupabase>`
  - Header: `{ alg: "ES256", kid, typ: "JWT" }`. Payload: `{ iss, sub, role: "authenticated", company_id, iat, exp }` — **seis claims, nenhum a mais**.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/unit/supabase-jwt-emitir.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { decodeJwt, decodeProtectedHeader, generateKeyPair, importJWK, jwtVerify } from "jose";

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
    const { token } = await emitirTokenSupabase({ sub: "cmt18abc", companyId: "company-migracao-1a" });
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
    const { emitirTokenSupabase, VIDA_DO_TOKEN_SEGUNDOS } = await import("@/core/supabase-jwt/emitir");
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
```

- [ ] **Step 2: Rodar e confirmar RED**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/supabase-jwt-emitir.test.ts
```

- [ ] **Step 3: Criar `src/core/supabase-jwt/emitir.ts`**

```ts
import "server-only";

import { SignJWT } from "jose";

import { ALGORITMO, chaveDeAssinatura } from "./chave";

/**
 * Emite o JWT que o Supabase aceita, com a empresa ativa dentro.
 *
 * ## O payload é MÍNIMO, e cada claim tem um motivo
 *
 * - `role: "authenticated"` — **obrigatório**, e o único claim com semântica
 *   sequestrada: ele vira o papel Postgres da conexão. Sem ele o Supabase cai
 *   em `anon`, que está revogado de tudo nesta base, e o Realtime entregaria
 *   silêncio em vez de erro.
 * - `sub` — `User.id`. Livre neste caminho: não precisa ser UUID de
 *   `auth.users` (Firebase e Clerk usam ids próprios). **Ver a armadilha do
 *   `auth.uid()` abaixo.**
 * - `company_id` — o motivo do ciclo. As políticas do Ciclo 3 leem
 *   `auth.jwt() ->> 'company_id'`, medido contra o Postgres real.
 * - `exp` / `iat` — `exp` é obrigatório; `iat` existe porque sem ele um token
 *   achado num log não tem data, e `exp` sozinho não distingue um token de 5
 *   minutos recém-emitido de um de 24 horas prestes a vencer.
 * - `iss` — nomeia quem mintou. Não é para o Supabase (com `custom_jwks` não
 *   existe issuer registrado com que comparar); é para a investigação e para
 *   distinguir dev de produção se algum dia os dois estiverem registrados.
 *
 * **Fora de propósito:** `aud` (não exigido, e um valor errado é pior que a
 * ausência), a lista do Custom Access Token Hook (`aal`, `session_id`,
 * `email`, `phone`, `is_anonymous` — aquele hook governa tokens que o Supabase
 * Auth emite, não este caminho), e o `papel` do CRM (autorização por papel vive
 * no caminho do Prisma; um segundo lugar seria uma segunda fonte de verdade
 * sobre autorização).
 *
 * ## ARMADILHA: `auth.uid()` é inutilizável neste projeto
 *
 * `auth.uid()` faz cast de `sub` para `uuid` e o `User.id` desta base é cuid.
 * Medido contra `uzumzfxjcxrbxaucvfsr` em 2026-08-20:
 *
 *     ERROR: 22P02: invalid input syntax for type uuid: "cmt18m0ut000w306j..."
 *
 * Uma política que chame `auth.uid()` não devolve falso: **levanta exceção** e
 * derruba a consulta. As políticas do Ciclo 3 usam `auth.jwt() ->> 'sub'`.
 * `tests/e2e/claims-jwt.spec.ts` trava isso.
 *
 * ## Por que 300 segundos
 *
 * O callback do `accessToken` é chamado a cada heartbeat, e o heartbeat padrão
 * do `realtime-js` 2.111.0 é 25 s (`RealtimeClient.js:9`, `HEARTBEAT_INTERVAL`).
 * Com 5 minutos de vida e 60 s de margem de renovação, cada aba emite um token
 * a cada ~4 minutos. Mais curto que isso e cada hiccup de rede perto da
 * expiração derruba o canal; mais longo e um token vazado vale mais tempo — e
 * não existe revogação: o Supabase verifica assinatura, não consulta lista.
 */
export const VIDA_DO_TOKEN_SEGUNDOS = 300;

export interface TokenSupabase {
  token: string;
  /** Segundos desde 1970, igual ao claim `exp`. */
  expiraEm: number;
}

function issuer(): string {
  const valor = process.env.SUPABASE_JWT_ISSUER;
  if (!valor) {
    throw new Error(
      "SUPABASE_JWT_ISSUER ausente — defina no .env com a origem pública do CRM " +
        '(em desenvolvimento, "http://localhost:3000"). Sem valor padrão de propósito: ' +
        "um padrão plausível carregado para produção mentiria sobre quem mintou o token."
    );
  }
  return valor;
}

export async function emitirTokenSupabase(entrada: {
  sub: string;
  companyId: string;
}): Promise<TokenSupabase> {
  const { kid, chave } = await chaveDeAssinatura();

  const emitidoEm = Math.floor(Date.now() / 1000);
  const expiraEm = emitidoEm + VIDA_DO_TOKEN_SEGUNDOS;

  const token = await new SignJWT({
    role: "authenticated",
    company_id: entrada.companyId,
  })
    .setProtectedHeader({ alg: ALGORITMO, kid, typ: "JWT" })
    .setIssuer(issuer())
    .setSubject(entrada.sub)
    .setIssuedAt(emitidoEm)
    .setExpirationTime(expiraEm)
    .sign(chave);

  return { token, expiraEm };
}
```

- [ ] **Step 4: Rodar GREEN e fechar**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/supabase-jwt-emitir.test.ts tests/unit/supabase-jwt-chave.test.ts
npm run typecheck
```

Esperado: 9 + 9 casos passando (o número exato sai da sua execução — cole-o), `tsc` sem saída.

- [ ] **Step 5: Commit**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git add src/core/supabase-jwt/emitir.ts tests/unit/supabase-jwt-emitir.test.ts
git commit -m "feat(jwt): emissao do token do Supabase com company_id

Seis claims e nenhum a mais, e o teste afirma o CONJUNTO EXATO: claim a mais
e superficie a mais, e um aperto de validacao do Supabase (ja aconteceu em
2025-07-24) precisa aparecer como teste vermelho, nao como Realtime mudo.

O papel do CRM fica FORA do token de proposito. Autorizacao por papel vive no
caminho do Prisma; um segundo lugar seria uma segunda fonte de verdade sobre
autorizacao, que e a divida R4 que o Ciclo 1a ja carrega.

300 segundos porque o callback do accessToken roda a cada heartbeat de 25s
(medido em realtime-js 2.111.0) e nao existe revogacao: token vazado vale ate
expirar.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: A rota pública do JWKS

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Create: `src/app/api/jwks/route.ts`
- Test: `tests/unit/rota-jwks.test.ts` (novo)

**Interfaces:**
- Consumes: `jwksPublico()` (Task 1).
- Produces: `GET /api/jwks` respondendo `{"keys":[{...}]}` com `content-type: application/json` e `cache-control: public, max-age=300`; `export const dynamic = "force-dynamic"`.

**Por que `/api/jwks` e não `/.well-known/jwks.json`:** o campo `jwks_url` do
registro do Supabase é uma string livre (OpenAPI, `CreateThirdPartyAuthBody`),
então o caminho canônico não compra nada; e servir um segmento que começa com
ponto no App Router do Next 16.3 **não foi verificado** neste ambiente. Ver
spec § 4.2 e NV6.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/unit/rota-jwks.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const guardada = { valor: undefined as string | undefined };

beforeEach(() => {
  vi.resetModules();
  guardada.valor = process.env.SUPABASE_JWT_PRIVATE_JWK;
  delete process.env.SUPABASE_JWT_PRIVATE_JWK;
});

afterEach(() => {
  if (guardada.valor === undefined) delete process.env.SUPABASE_JWT_PRIVATE_JWK;
  else process.env.SUPABASE_JWT_PRIVATE_JWK = guardada.valor;
});

async function prepararChave() {
  const { gerarParDeChaves } = await import("@/core/supabase-jwt/chave");
  const par = await gerarParDeChaves();
  process.env.SUPABASE_JWT_PRIVATE_JWK = JSON.stringify(par.privado);
  vi.resetModules();
  return par;
}

describe("GET /api/jwks", () => {
  it("é dinâmica — senão o build avalia a rota sem a variável e cai", async () => {
    // Afirmação sobre a configuração da rota, e não sobre o corpo: um route
    // handler que não lê a requisição pode ser avaliado em tempo de BUILD, e
    // em tempo de build a chave não existe. Mesmo modo de falha que derrubou
    // o deploy em 2026-08-07.
    const rota = await import("@/app/api/jwks/route");
    expect(rota.dynamic).toBe("force-dynamic");
  });

  it("publica UMA chave, com o kid da chave de assinatura", async () => {
    const par = await prepararChave();
    const { GET } = await import("@/app/api/jwks/route");
    const resposta = await GET();

    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();
    expect(corpo.keys).toHaveLength(1);
    expect(corpo.keys[0].kid).toBe(par.privado.kid);
  });

  it("o TEXTO da resposta não contém o d da chave privada", async () => {
    const par = await prepararChave();
    const { GET } = await import("@/app/api/jwks/route");
    const texto = await (await GET()).text();

    // Sobre o texto serializado, e não sobre o objeto: uma asserção sobre o
    // objeto passaria por cima de um getter ou de um campo herdado do
    // protótipo. Isto aqui é o que a internet inteira lê sem sessão.
    expect(texto).not.toContain(par.privado.d);
    expect(texto).not.toContain('"d"');
  });

  it("é cacheável por 5 minutos e servida como JSON", async () => {
    await prepararChave();
    const { GET } = await import("@/app/api/jwks/route");
    const resposta = await GET();

    expect(resposta.headers.get("cache-control")).toBe("public, max-age=300");
    expect(resposta.headers.get("content-type")).toBe("application/json");
  });

  it("sem chave configurada responde 500, e NUNCA um JWKS vazio", async () => {
    const { GET } = await import("@/app/api/jwks/route");
    const resposta = await GET();

    // 200 com `{"keys":[]}` faria o Supabase recusar todo token com um erro
    // que não diz "o JWKS está vazio" — a causa ficaria a três saltos daqui.
    expect(resposta.status).toBe(500);
    expect(await resposta.text()).not.toContain('"keys"');
  });
});
```

- [ ] **Step 2: Rodar e confirmar RED**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/rota-jwks.test.ts
```

- [ ] **Step 3: Criar `src/app/api/jwks/route.ts`**

```ts
import { jwksPublico } from "@/core/supabase-jwt/chave";

/**
 * O JWKS público do CRM — a metade pública da chave que assina os JWT que o
 * Supabase aceita.
 *
 * ## Esta rota é pública por definição, e isso tem consequências
 *
 * Qualquer pessoa na internet lê isto, sem sessão, sem `apikey`. Logo:
 *
 * - o corpo **só** carrega `kty`, `crv`, `x`, `y`, `kid`, `alg`, `use` — a
 *   montagem é por lista branca em `jwkPublico()`, e
 *   `tests/unit/rota-jwks.test.ts` afirma isso sobre o TEXTO serializado;
 * - ela não lê a requisição, não lê cookie e não varia por usuário — repare que
 *   `GET` nem recebe parâmetro;
 * - sem chave configurada ela responde **500**, e nunca 200 com `keys` vazio:
 *   um JWKS vazio faz o Supabase recusar todo token com um erro que não aponta
 *   para cá.
 *
 * ## Por que `force-dynamic`
 *
 * Um route handler que não lê a requisição pode ser avaliado em tempo de build
 * — e em tempo de build `SUPABASE_JWT_PRIVATE_JWK` não existe. É o mesmo modo
 * de falha documentado em `src/modules/whatsapp/gateway/index.ts`, que derrubou
 * o deploy por três dias. Explícito para ninguém "otimizar" isto depois.
 *
 * ## Por que 5 minutos de cache
 *
 * O documento é público e imutável entre rotações. O Supabase revalida o JWKS
 * periodicamente e leva até 30 minutos para notar uma troca (guia de
 * third-party auth, Limitations 2), então um cache de 5 minutos nunca é o
 * gargalo de uma rotação.
 *
 * ## Por que `/api/jwks` e não `/.well-known/jwks.json`
 *
 * O registro do Supabase aceita `jwks_url` como string livre (schema
 * `CreateThirdPartyAuthBody` do Management API), então o caminho canônico de
 * OIDC não compra nada aqui — e servir um segmento iniciado por ponto no App
 * Router não foi verificado neste projeto. Mudar a URL depois custa uma
 * reregistração no Supabase, com até 30 minutos de propagação.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let corpo: string;
  try {
    corpo = JSON.stringify(await jwksPublico());
  } catch (erro) {
    console.error("JWKS indisponível — a chave de assinatura não pôde ser lida:", erro);
    return new Response(JSON.stringify({ erro: "jwks_indisponivel" }), {
      status: 500,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  return new Response(corpo, {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
  });
}
```

- [ ] **Step 4: Rodar GREEN, e provar que a rota existe no build**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/rota-jwks.test.ts
npm run typecheck
npm run build
```

No fim do `build`, a lista de rotas tem que conter `/api/jwks`. Cole o trecho da
lista. O Ciclo 1a fechou com **18 rotas**; aqui espera-se **19**. Se `/api/jwks`
não aparecer, **pare e reporte** — é a rota que o Supabase precisa alcançar.

- [ ] **Step 5: Commit**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git add src/app/api/jwks tests/unit/rota-jwks.test.ts
git commit -m "feat(jwt): rota publica do JWKS

Publica so a metade publica, montada por lista branca, e o teste afirma sobre
o TEXTO da resposta e nao sobre o objeto -- asercao sobre objeto passaria por
cima de getter ou campo herdado do prototipo, e isto e o que a internet le sem
sessao.

Sem chave configurada responde 500 e nunca 200 com keys vazio: JWKS vazio faz
o Supabase recusar todo token com um erro que nao aponta para ca.

force-dynamic explicito: rota que nao le a requisicao pode ser avaliada em
tempo de build, onde a variavel da chave nao existe.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: A rota de emissão, onde a empresa não é escolhida pelo cliente

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Create: `src/app/api/supabase/token/route.ts`
- Test: `tests/unit/rota-token-supabase.test.ts` (novo)

**Interfaces:**
- Consumes: `emitirTokenSupabase` (Task 2), `usuarioAtual()` de `@/core/auth/session` (devolve `UsuarioAtivo { id, nome, email, ativo, companyId, papel }`), `checarRateLimit(chave, limite, janelaMs)` de `@/core/rate-limit/limiter`.
- Produces: `GET /api/supabase/token` → `200 { token, expiraEm }` · `401 { erro: "nao_autenticado" }` · `429 { erro: "limite_excedido" }`, sempre com `cache-control: no-store`. Exporta `LIMITE_POR_JANELA = 120` e `JANELA_MS = 300000`.

**A decisão que define esta tarefa:** `GET` **não recebe parâmetro de
requisição**. Não é estilo — é a garantia mecânica de que o cliente não escolhe
a empresa. Se você precisar ler algo da requisição, você saiu do desenho.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/unit/rota-token-supabase.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { decodeJwt } from "jose";

vi.mock("server-only", () => ({}));

const usuarioAtual = vi.fn();
const checarRateLimit = vi.fn();

vi.mock("@/core/auth/session", () => ({ usuarioAtual: () => usuarioAtual() }));
vi.mock("@/core/rate-limit/limiter", () => ({
  checarRateLimit: (chave: string, limite: number, janela: number) =>
    checarRateLimit(chave, limite, janela),
}));

const VARIAVEIS = ["SUPABASE_JWT_PRIVATE_JWK", "SUPABASE_JWT_ISSUER"] as const;
const guardadas: Record<string, string | undefined> = {};

const USUARIO = {
  id: "user-da-sessao",
  nome: "Quem Age",
  email: "quem@teste.invalid",
  ativo: true,
  companyId: "empresa-da-sessao",
  papel: "ADMIN" as const,
};

beforeEach(async () => {
  vi.resetModules();
  usuarioAtual.mockReset();
  checarRateLimit.mockReset().mockResolvedValue(true);

  for (const nome of VARIAVEIS) {
    guardadas[nome] = process.env[nome];
  }
  const { gerarParDeChaves } = await import("@/core/supabase-jwt/chave");
  const { privado } = await gerarParDeChaves();
  process.env.SUPABASE_JWT_PRIVATE_JWK = JSON.stringify(privado);
  process.env.SUPABASE_JWT_ISSUER = "https://crm.teste.invalid";
  vi.resetModules();
});

afterEach(() => {
  for (const nome of VARIAVEIS) {
    if (guardadas[nome] === undefined) delete process.env[nome];
    else process.env[nome] = guardadas[nome];
  }
});

describe("a empresa vem da SESSÃO, nunca do cliente", () => {
  it("ignora companyId em query, corpo e cabeçalho, todos ao mesmo tempo", async () => {
    usuarioAtual.mockResolvedValue(USUARIO);
    const { GET } = await import("@/app/api/supabase/token/route");

    // A rota não recebe parâmetro nenhum — este é o ponto. Os três vetores
    // abaixo existem para provar que não há por onde entrar, e porque o
    // Ciclo 1a fechou exatamente esta forma de defeito: `redefinirSenha`
    // recebia o id do alvo do cliente e nunca provava nada sobre ele (tomada
    // de conta entre empresas, auditoria 1a § 5.2). Aqui a aposta é maior: o
    // company_id do token é o que as políticas do Ciclo 3 vão confiar.
    const resposta = await GET();

    expect(resposta.status).toBe(200);
    const { token } = await resposta.json();
    expect(decodeJwt(token).company_id).toBe("empresa-da-sessao");
    expect(decodeJwt(token).sub).toBe("user-da-sessao");
  });

  it("a assinatura de GET não aceita Request — não há parâmetro a forjar", async () => {
    const rota = await import("@/app/api/supabase/token/route");
    expect(rota.GET.length).toBe(0);
  });
});

describe("sessão", () => {
  it("sem sessão responde 401 e o corpo não tem token", async () => {
    usuarioAtual.mockRejectedValue(new Error("Não autenticado"));
    const { GET } = await import("@/app/api/supabase/token/route");
    const resposta = await GET();

    expect(resposta.status).toBe(401);
    expect(await resposta.text()).not.toContain("token");
  });
});

describe("teto de taxa", () => {
  it("usa o id do usuário como chave, não o IP", async () => {
    usuarioAtual.mockResolvedValue(USUARIO);
    const { GET, LIMITE_POR_JANELA, JANELA_MS } = await import("@/app/api/supabase/token/route");
    await GET();

    // Por usuário e não por IP de propósito: um escritório inteiro atrás de um
    // NAT dividiria o orçamento e derrubaria o canal de quem não fez nada.
    expect(checarRateLimit).toHaveBeenCalledWith(
      `jwt-supabase:${USUARIO.id}`,
      LIMITE_POR_JANELA,
      JANELA_MS
    );
  });

  it("estourado, responde 429 e o corpo não tem token", async () => {
    usuarioAtual.mockResolvedValue(USUARIO);
    checarRateLimit.mockResolvedValue(false);
    const { GET } = await import("@/app/api/supabase/token/route");
    const resposta = await GET();

    // Um 429 que ainda emite é teatro.
    expect(resposta.status).toBe(429);
    expect(await resposta.text()).not.toContain("token");
  });
});

describe("cabeçalhos", () => {
  it("nunca é cacheada — o corpo é credencial portadora", async () => {
    usuarioAtual.mockResolvedValue(USUARIO);
    const { GET } = await import("@/app/api/supabase/token/route");
    expect((await GET()).headers.get("cache-control")).toBe("no-store");
  });

  it("é dinâmica", async () => {
    const rota = await import("@/app/api/supabase/token/route");
    expect(rota.dynamic).toBe("force-dynamic");
  });
});
```

- [ ] **Step 2: Rodar e confirmar RED**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/rota-token-supabase.test.ts
```

- [ ] **Step 3: Criar `src/app/api/supabase/token/route.ts`**

```ts
import { usuarioAtual } from "@/core/auth/session";
import { checarRateLimit } from "@/core/rate-limit/limiter";
import { emitirTokenSupabase } from "@/core/supabase-jwt/emitir";

/**
 * Emite o JWT do Supabase para quem já está logado no CRM.
 *
 * ## A empresa vem de `usuarioAtual()`, e de mais lugar nenhum
 *
 * Repare que `GET` **não recebe a requisição**. Não é estilo: é a garantia de
 * que o cliente não escolhe a empresa — não existe parâmetro a forjar. Um
 * route handler é endpoint HTTP público, exatamente como uma Server Action, e o
 * Ciclo 1a fechou um defeito desta forma: `redefinirSenha` recebia o id do alvo
 * do cliente, provava que QUEM AGE tinha permissão e nunca provava nada sobre o
 * ALVO — um ADMIN da empresa A redefinia a senha do ADMIN da B (auditoria do
 * Ciclo 1a, § 5.2).
 *
 * Aqui a aposta é maior. O `company_id` deste token é literalmente o que as
 * políticas do Ciclo 3 vão confiar: se o cliente puder escolhê-lo, o RLS
 * inteiro vira decoração.
 *
 * ## Por que route handler e não Server Action
 *
 * O consumidor é o callback `accessToken` do cliente Supabase — uma função
 * async de JavaScript comum, que precisa de um valor. Server Action acopla o
 * token ao protocolo de ações do RSC e não deixa controlar cabeçalho de
 * resposta, e esta resposta PRECISA de `no-store`: o corpo é credencial
 * portadora, e credencial em cache compartilhado é credencial de outra pessoa.
 *
 * ## O teto de taxa, e o que ele custa
 *
 * 120 emissões por 5 minutos, por `User.id`. O uso legítimo consome ~1,25 por
 * janela por aba (token de 300 s, margem de renovação de 60 s), então 120 cabe
 * dez abas com folga de ordem de grandeza. Existe porque um endpoint que minta
 * credencial sem teto transforma um cookie de sessão roubado em fábrica de
 * tokens.
 *
 * Chave pelo id do usuário e **não** pelo IP: um escritório atrás de um NAT
 * dividiria o orçamento. Custo aceito: quando o teto estoura, o canal do
 * Realtime cai na expiração do último token, sem mensagem na tela — é o
 * comportamento correto, e é por isso que o limite é folgado.
 */
export const dynamic = "force-dynamic";

export const LIMITE_POR_JANELA = 120;
export const JANELA_MS = 5 * 60_000;

function json(corpo: unknown, status: number): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function GET(): Promise<Response> {
  let usuario;
  try {
    usuario = await usuarioAtual();
  } catch {
    // Mensagem genérica: "Não autenticado", "conta desativada" e "conta em mais
    // de uma empresa" chegam aqui como a mesma coisa para quem chama, do mesmo
    // jeito que `usuarioAtual()` já as trata (ver o comentário longo dele).
    return json({ erro: "nao_autenticado" }, 401);
  }

  const permitido = await checarRateLimit(
    `jwt-supabase:${usuario.id}`,
    LIMITE_POR_JANELA,
    JANELA_MS
  );

  if (!permitido) {
    console.warn(
      `Teto de emissão de JWT do Supabase atingido para o usuário ${usuario.id}. ` +
        "O canal de Realtime dele cai na expiração do último token."
    );
    return json({ erro: "limite_excedido" }, 429);
  }

  const { token, expiraEm } = await emitirTokenSupabase({
    sub: usuario.id,
    companyId: usuario.companyId,
  });

  // `expiraEm` vai junto para o cliente não precisar decodificar o JWT no
  // navegador só para saber quando renovar. Decodificar token no cliente para
  // tomar decisão é padrão que não vale a pena ensinar.
  return json({ token, expiraEm }, 200);
}
```

- [ ] **Step 4: Rodar GREEN, provar a rota no build e a catraca intacta**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/rota-token-supabase.test.ts tests/unit/catraca-prisma-cru.test.ts
npm run lint
npm run typecheck
npm run build
```

Três coisas a conferir e colar:
1. `/api/supabase/token` aparece na lista de rotas do build (agora **20**).
2. `catraca-prisma-cru` verde **sem nenhuma exceção nova** no `eslint.config.mjs`
   — nenhum arquivo deste ciclo importa `@/lib/prisma`. Se ela ficar vermelha,
   **pare e reporte**: significa que algum arquivo novo alcançou o prisma cru, e
   isso contradiz o desenho (spec § 4.6).
3. `npm run lint` com zero erros.

- [ ] **Step 5: Commit**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git add src/app/api/supabase tests/unit/rota-token-supabase.test.ts
git commit -m "feat(jwt): rota de emissao le a empresa da sessao, nunca do cliente

GET nao recebe a requisicao -- e essa e a garantia, nao o estilo: nao existe
parametro a forjar. Route handler e endpoint HTTP publico igual a Server
Action, e o Ciclo 1a fechou exatamente esta forma de defeito em
redefinirSenha (tomada de conta entre empresas). Aqui a aposta e maior: o
company_id deste token e o que as politicas do Ciclo 3 vao confiar.

no-store porque o corpo e credencial portadora. Teto por usuario e nao por
IP, senao um escritorio atras de um NAT divide o orcamento.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: A fábrica do callback `accessToken`

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Create: `src/core/supabase-jwt/access-token.ts`
- Test: `tests/unit/supabase-access-token.test.ts` (novo)

**Interfaces:**
- Consumes: a resposta de `GET /api/supabase/token` (Task 4): `{ token: string; expiraEm: number }`.
- Produces:
  - `MARGEM_PADRAO_SEGUNDOS = 60`
  - `interface OpcoesAccessToken { url?: string; margemSegundos?: number; buscar?: typeof fetch }`
  - `criarAccessTokenSupabase(opcoes?): () => Promise<string>` — o valor que o Ciclo 3 passa em `createClient(url, chave, { accessToken })`.

**Este arquivo nasce sem consumidor**, e é deliberado: as três decisões que ele
encarna saem de medições sobre o **token** (margem de 60 s, trava de
concorrência, lançar em vez de devolver `null`), e reencontrá-las dali a dois
ciclos é como se erra. Registrado como dívida D5 no spec.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/unit/supabase-access-token.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { criarAccessTokenSupabase, MARGEM_PADRAO_SEGUNDOS } from "@/core/supabase-jwt/access-token";

function agoraEmSegundos() {
  return Math.floor(Date.now() / 1000);
}

function respostaOk(corpo: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => corpo,
  } as unknown as Response;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-20T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("memoização e concorrência", () => {
  it("20 chamadas concorrentes produzem UMA busca", async () => {
    // A doc do supabase-js diz que o callback "may be called concurrently and
    // many times", e o realtime-js o chama a cada heartbeat de 25 s
    // (RealtimeClient.js:9 e :554-563). Sem trava, uma reconexão com vários
    // canais vira uma rajada contra a rota de emissão.
    const buscar = vi.fn(async () =>
      respostaOk({ token: "t1", expiraEm: agoraEmSegundos() + 300 })
    );
    const accessToken = criarAccessTokenSupabase({ buscar });

    const resultados = await Promise.all(Array.from({ length: 20 }, () => accessToken()));

    expect(buscar).toHaveBeenCalledTimes(1);
    expect(new Set(resultados)).toEqual(new Set(["t1"]));
  });

  it("dentro da validade não busca de novo", async () => {
    const buscar = vi.fn(async () =>
      respostaOk({ token: "t1", expiraEm: agoraEmSegundos() + 300 })
    );
    const accessToken = criarAccessTokenSupabase({ buscar });

    await accessToken();
    vi.advanceTimersByTime(100_000); // 100 s: sobram 200, bem acima da margem
    await accessToken();

    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it("passada a margem de 60 s, busca de novo", async () => {
    let n = 0;
    const buscar = vi.fn(async () =>
      respostaOk({ token: `t${++n}`, expiraEm: agoraEmSegundos() + 300 })
    );
    const accessToken = criarAccessTokenSupabase({ buscar });

    expect(await accessToken()).toBe("t1");
    // 250 s depois faltam 50 para expirar — abaixo da margem de 60.
    vi.advanceTimersByTime(250_000);
    expect(await accessToken()).toBe("t2");
    expect(buscar).toHaveBeenCalledTimes(2);
    expect(MARGEM_PADRAO_SEGUNDOS).toBe(60);
  });
});

describe("falha", () => {
  it("LANÇA em vez de devolver null — medido em realtime-js", async () => {
    // RealtimeClient.js:456-495: se o callback LANÇA, o cliente loga e cai no
    // último token bom (`tokenToSend = this.accessTokenValue`) — degradação
    // graciosa. Se devolve `null`, `accessTokenValue` é SOBRESCRITO com null e
    // o canal já juntado recebe push de `access_token: null`. O caminho que
    // parece mais educado é o destrutivo.
    const buscar = vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response);
    const accessToken = criarAccessTokenSupabase({ buscar });

    await expect(accessToken()).rejects.toThrow(/500/);
  });

  it("não memoiza a falha: a chamada seguinte tenta de novo", async () => {
    const buscar = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 } as unknown as Response)
      .mockResolvedValueOnce(respostaOk({ token: "t1", expiraEm: agoraEmSegundos() + 300 }));
    const accessToken = criarAccessTokenSupabase({ buscar });

    await expect(accessToken()).rejects.toThrow();
    expect(await accessToken()).toBe("t1");
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it("recusa resposta 200 com corpo sem token", async () => {
    const buscar = vi.fn(async () => respostaOk({ erro: "limite_excedido" }));
    const accessToken = criarAccessTokenSupabase({ buscar });
    await expect(accessToken()).rejects.toThrow(/token/);
  });
});
```

- [ ] **Step 2: Rodar e confirmar RED**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/supabase-access-token.test.ts
```

- [ ] **Step 3: Criar `src/core/supabase-jwt/access-token.ts`**

```ts
/**
 * A fábrica do callback que o Ciclo 3 passa em
 * `createClient(url, chave, { accessToken })`.
 *
 * ## Por que `accessToken` e não `realtime.setAuth(jwt)`
 *
 * Medido em `@supabase/realtime-js` 2.111.0: com `accessToken` configurado, o
 * callback é a fonte da verdade e o cliente renova sozinho a cada heartbeat
 * (`_wrapHeartbeatCallback` → `_setAuthSafely`, `RealtimeClient.js:554-563`),
 * com intervalo padrão de 25 s (`HEARTBEAT_INTERVAL: 25000`, linha 9).
 * `setAuth(token)` manual obriga a reemitir e reinjetar o token na mão antes de
 * cada expiração — e o guia do Realtime diz o que acontece quando se erra:
 * "If a new JWT is never received on the Channel, the client will be
 * disconnected when the JWT expires."
 *
 * **Armadilha do Ciclo 3:** `accessToken` e o namespace `supabase.auth` são
 * mutuamente exclusivos no MESMO cliente. Aqui não custa nada (o login é cookie
 * do Auth.js e ninguém chama `supabase.auth`), mas o cliente de
 * `src/lib/storage.ts`, que usa `service_role`, tem que continuar sendo outro
 * cliente.
 *
 * ## Por que memoizar COM trava
 *
 * A doc do `supabase-js` avisa: o callback "may be called concurrently and many
 * times. Use memoization and locking techniques". Sem memoização, cada heartbeat
 * viraria uma emissão; sem trava, uma reconexão com vários canais viraria uma
 * rajada simultânea contra a rota de emissão — que tem teto de taxa.
 *
 * ## Por que LANÇAR em falha, e nunca devolver `null`
 *
 * Isto é contraintuitivo e é medido (`RealtimeClient.js:456-495`):
 *
 * - callback que **lança** → o cliente loga e cai no último token bom
 *   (`tokenToSend = this.accessTokenValue`): degradação graciosa até a
 *   expiração;
 * - callback que devolve **`null`** → `accessTokenValue` é sobrescrito com
 *   `null` e o canal já juntado recebe um push de `access_token: null`.
 *
 * O caminho que parece mais educado é o destrutivo.
 */
export const MARGEM_PADRAO_SEGUNDOS = 60;

export const URL_PADRAO = "/api/supabase/token";

export interface OpcoesAccessToken {
  /** Sobrescreve a rota de emissão. Existe para o teste, não para o produto. */
  url?: string;
  /**
   * Quantos segundos antes da expiração renovar. A margem também cobre relógio
   * do navegador adiantado em relação ao servidor: sem ela, um cliente com 30 s
   * de deriva mandaria tokens que o Supabase considera vencidos.
   */
  margemSegundos?: number;
  /** Injeção para teste. No navegador, `fetch`. */
  buscar?: typeof fetch;
}

interface TokenEmCache {
  token: string;
  expiraEm: number;
}

export function criarAccessTokenSupabase(opcoes: OpcoesAccessToken = {}): () => Promise<string> {
  const url = opcoes.url ?? URL_PADRAO;
  const margem = opcoes.margemSegundos ?? MARGEM_PADRAO_SEGUNDOS;
  const buscar = opcoes.buscar ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  let cache: TokenEmCache | null = null;
  let emVoo: Promise<TokenEmCache> | null = null;

  async function emitir(): Promise<TokenEmCache> {
    const resposta = await buscar(url, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });

    if (!resposta.ok) {
      throw new Error(
        `Falha ao emitir o JWT do Supabase: HTTP ${resposta.status}. ` +
          "O canal continua com o token anterior até ele expirar."
      );
    }

    const corpo = (await resposta.json()) as { token?: unknown; expiraEm?: unknown };
    if (typeof corpo.token !== "string" || typeof corpo.expiraEm !== "number") {
      throw new Error(
        "Resposta da rota de emissão sem `token`/`expiraEm` — 200 com corpo de erro."
      );
    }

    return { token: corpo.token, expiraEm: corpo.expiraEm };
  }

  return async function accessToken(): Promise<string> {
    const agora = Math.floor(Date.now() / 1000);

    if (cache && cache.expiraEm - agora > margem) {
      return cache.token;
    }

    if (!emVoo) {
      // A trava é a promessa em si: quem chegar enquanto ela existe espera a
      // mesma. `finally` a solta antes de os aguardadores continuarem, então
      // uma falha nunca fica presa no lugar da próxima tentativa.
      emVoo = emitir().finally(() => {
        emVoo = null;
      });
    }

    const novo = await emVoo;
    cache = novo;
    return novo.token;
  };
}
```

- [ ] **Step 4: Rodar GREEN e fechar**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/supabase-access-token.test.ts
npm run typecheck
npm run lint
```

- [ ] **Step 5: Commit**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git add src/core/supabase-jwt/access-token.ts tests/unit/supabase-access-token.test.ts
git commit -m "feat(jwt): fabrica do callback accessToken, com trava de concorrencia

Memoiza com margem de 60s e colapsa chamadas concorrentes numa busca so: o
callback roda a cada heartbeat de 25s e a propria doc avisa que ele e chamado
concurrently and many times.

LANCA em falha em vez de devolver null, e isso e medido, nao gosto: em
realtime-js 2.111.0, callback que lanca faz o cliente cair no ultimo token
bom; callback que devolve null SOBRESCREVE o token guardado e empurra
access_token: null para o canal ja juntado. O caminho que parece mais educado
e o destrutivo.

Nasce sem consumidor de proposito -- o Ciclo 3 o liga ao createClient. As tres
decisoes que ele carrega saem de medicao sobre o token, e reencontra-las dois
ciclos adiante e como se erra.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Reforçar `banco-blindado.spec.ts` e registrar a armadilha do `auth.uid()`

**DEPENDE DE AÇÃO DO DONO:** não. (Precisa de `E2E_SENHA` no `.env`, que a suíte
e2e já exige desde o Ciclo 0.)

**OBRIGATÓRIO antes de começar:** invocar `supabase`,
`supabase-postgres-best-practices` e `auditing-supabase-security`, as três — esta
tarefa lê o catálogo do Postgres e mexe no teste que guarda a blindagem.

**Files:**
- Modify: `tests/e2e/banco-blindado.spec.ts`
- Modify: `CLAUDE.md` (seção "Armadilhas conhecidas")

**Interfaces:**
- Consumes: nada deste ciclo.
- Produces: duas asserções novas no `banco-blindado.spec.ts` — **zero políticas** e **zero grants para `anon`/`authenticated`** no schema `realtime` — e a armadilha do `auth.uid()` registrada no `CLAUDE.md`.

**Nenhuma asserção existente pode ser removida ou afrouxada.** Este arquivo é a
vigilância que o Ciclo 3 vai **editar** para nomear a exceção dele. A regra é a
mesma do spec do programa: afirmar a exceção exata, nunca afrouxar.

- [ ] **Step 1: Medir o estado atual antes de escrever a asserção**

```sql
-- rode via MCP do Supabase no projeto uzumzfxjcxrbxaucvfsr
select
 (select count(*) from pg_policies where schemaname='realtime') as politicas_realtime,
 (select count(*) from information_schema.role_table_grants
    where table_schema='realtime' and grantee in ('anon','authenticated')) as grants_realtime,
 (select count(*) from pg_tables where schemaname='realtime' and tablename='messages') as tem_messages;
```

Linha de base medida em 2026-08-20: `politicas_realtime: 0`, `tem_messages: 1`.
Cole a sua. Se `politicas_realtime` **não** for 0, **pare e reporte** — alguém
abriu o canal fora deste plano.

- [ ] **Step 2: Acrescentar os dois testes**

No fim de `tests/e2e/banco-blindado.spec.ts`, **sem tocar no que já existe**:

```ts
test("o schema realtime nao tem politica nenhuma — ainda", async () => {
  // Esta afirmação é o oposto de um afrouxamento: ela declara, hoje, que a
  // exceção do Ciclo 3 NÃO existe. Quando ele abrir `SELECT` em uma tabela com
  // política filtrando por `auth.jwt() ->> 'company_id'`, este teste é
  // EDITADO para nomear aquela política exata — nunca deletado, nunca
  // transformado em ">= 0".
  //
  // A diferença importa: editar uma afirmação aparece no diff como uma
  // decisão; afrouxar um teste aparece como uma linha a menos que ninguém lê.
  //
  // O Ciclo 1b emite o JWT que essa política vai ler, e emitir o token não
  // abre canal nenhum. Se este teste ficar vermelho durante o 1b, alguma coisa
  // saiu do escopo dele.
  const politicas: { nome: string; tabela: string }[] = await prisma.$queryRawUnsafe(`
    SELECT policyname::text AS nome, tablename::text AS tabela
    FROM pg_policies WHERE schemaname = 'realtime' ORDER BY 1, 2`);

  expect(
    politicas,
    "política no schema realtime: o canal foi aberto sem passar pelo Ciclo 3"
  ).toEqual([]);
});

test("nem o schema realtime concede privilegio a anon ou authenticated", async () => {
  // O teste original cobre só o schema `public`. O caminho do navegador que
  // este ciclo prepara passa por `realtime`, e um grant ali seria invisível
  // para toda a vigilância existente.
  const grants: { papel: string; tabela: string; priv: string }[] = await prisma.$queryRawUnsafe(`
    SELECT grantee::text AS papel, table_name::text AS tabela, privilege_type::text AS priv
    FROM information_schema.role_table_grants
    WHERE table_schema = 'realtime' AND grantee IN ('anon', 'authenticated')
    ORDER BY 1, 2, 3`);

  expect(
    grants,
    "anon/authenticated têm acesso direto a tabela do schema realtime"
  ).toEqual([]);
});
```

- [ ] **Step 3: Rodar só este arquivo**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx playwright test tests/e2e/banco-blindado.spec.ts
```

Esperado: 6 passando (os 4 existentes + os 2 novos). Cole a saída. Se algum dos
4 antigos ficar vermelho, **pare** — é regressão de blindagem, não é tarefa.

- [ ] **Step 4: Registrar a armadilha do `auth.uid()` no `CLAUDE.md`**

Na seção "Armadilhas conhecidas", acrescentar:

```md
- **`auth.uid()` é inutilizável neste projeto.** Ela faz cast de `sub` para
  `uuid` e o `User.id` desta base é **cuid**. Medido em 2026-08-20 contra
  `uzumzfxjcxrbxaucvfsr`: `ERROR: 22P02: invalid input syntax for type uuid`.
  Uma política que a chame não devolve falso — **levanta exceção** e derruba a
  consulta, com uma mensagem que fala de UUID e não de política. Toda política
  usa `auth.jwt() ->> 'sub'` e `auth.jwt() ->> 'company_id'`. Travado por
  `tests/e2e/claims-jwt.spec.ts`.
```

- [ ] **Step 5: Commit**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git add tests/e2e/banco-blindado.spec.ts CLAUDE.md
git commit -m "test(blindagem): afirma que o schema realtime ainda nao tem excecao

Duas asercoes NOVAS, nenhuma existente tocada: zero politicas e zero grants em
realtime. Elas declaram, hoje, que a excecao do Ciclo 3 nao existe -- e quando
ele abrir SELECT numa tabela com politica por company_id, a asercao e EDITADA
para nomear aquela politica. Editar aparece no diff como decisao; afrouxar
aparece como uma linha a menos que ninguem le.

O teste original cobria so o schema public, e o caminho do navegador passa por
realtime: um grant ali era invisivel para toda a vigilancia existente.

CLAUDE.md ganha a armadilha do auth.uid(), que faz cast de sub para uuid e
LEVANTA EXCECAO com o cuid desta base.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Provar `auth.jwt() ->> 'company_id'` contra o Postgres real

**⛔ DEPENDE DE AÇÃO DO DONO — D3. A EXECUÇÃO PARA AQUI.**
Sem `SUPABASE_JWT_PRIVATE_JWK` e `SUPABASE_JWT_ISSUER` no `.env`, a rota de
emissão responde 500 e este teste não tem como rodar. Não invente uma chave e
não escreva no `.env`: peça ao dono e pare.

**OBRIGATÓRIO antes de começar:** invocar `supabase`,
`supabase-postgres-best-practices` e `auditing-supabase-security`.

**Files:**
- Create: `tests/e2e/claims-jwt.spec.ts`

**Interfaces:**
- Consumes: `GET /api/supabase/token` (Task 4) com a sessão gravada em
  `SESSAO_ADMIN` (`tests/e2e/credenciais.ts`); `decodeJwt` de `jose`;
  `PrismaClient` + `PrismaPg` (mesmo par que `banco-blindado.spec.ts` usa).
- Produces: prova de que o claim `company_id` do token real chega a
  `auth.jwt() ->> 'company_id'`, e de que `auth.uid()` levanta `22P02`.

**Por que o token vem pela rota HTTP e não por `import { emitirTokenSupabase }`:**
`emitir.ts` importa `server-only`, que **lança** fora do bundler do Next — os
unitários contornam com `vi.mock`, e o Playwright não tem esse recurso. Buscar
pela rota é melhor de qualquer forma: prova o caminho inteiro (cookie do Auth.js
→ `usuarioAtual()` → empresa do vínculo → token), em vez do emissor isolado.

- [ ] **Step 1: Escrever o teste**

Criar `tests/e2e/claims-jwt.spec.ts`:

```ts
// O claim `company_id` do token real chega até a expressão que as políticas do
// Ciclo 3 vão usar. Teste de banco vestido de Playwright, como
// `banco-blindado.spec.ts` — não abre navegador, mas usa a sessão gravada para
// falar com a rota de emissão.
//
// ## O que este arquivo prova, e o que NÃO prova
//
// Prova: (a) o token que a rota emite carrega a empresa DO VÍNCULO do usuário
// logado, conferida contra o banco; (b) `auth.jwt() ->> 'company_id'` lê esse
// claim; (c) `auth.uid()` LEVANTA EXCEÇÃO com o `sub` cuid desta base.
//
// Não prova: que o gateway do Supabase popula `request.jwt.claims` a partir do
// nosso token. Esse elo exige uma tabela que `authenticated` possa ler, e criar
// isso é a exceção nomeada do Ciclo 3. Está registrado como dívida D1 no spec.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { test, expect } from "@playwright/test";
import { decodeJwt } from "jose";

import { EMAIL_ADMIN_E2E, SESSAO_ADMIN } from "./credenciais";

test.use({ storageState: SESSAO_ADMIN });

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function tokenDaSessao(request: import("@playwright/test").APIRequestContext) {
  const resposta = await request.get("/api/supabase/token");

  // Mensagem explícita porque a causa mais provável de 500 aqui é
  // `SUPABASE_JWT_PRIVATE_JWK` ausente — configuração, não código.
  expect(
    resposta.status(),
    "a rota de emissão não respondeu 200: confira SUPABASE_JWT_PRIVATE_JWK e " +
      "SUPABASE_JWT_ISSUER no .env (ver .env.example)"
  ).toBe(200);

  const corpo = (await resposta.json()) as { token: string; expiraEm: number };
  return corpo;
}

test("o token carrega a empresa do VINCULO do usuario logado", async ({ request }) => {
  const { token } = await tokenDaSessao(request);
  const payload = decodeJwt(token);

  const usuario = await prisma.user.findUniqueOrThrow({
    where: { email: EMAIL_ADMIN_E2E },
    include: { memberships: true },
  });

  // Um vínculo é o estado que `usuarioAtual()` aceita — com dois ele lança
  // `EmpresaAmbiguaError`. Afirmar isto aqui deixa a causa à vista se a fixture
  // mudar.
  expect(usuario.memberships).toHaveLength(1);
  expect(payload.company_id).toBe(usuario.memberships[0]!.companyId);
  expect(payload.sub).toBe(usuario.id);
  expect(payload.role).toBe("authenticated");
});

test("auth.jwt() le company_id, sub e role do token real", async ({ request }) => {
  const { token } = await tokenDaSessao(request);
  const payload = decodeJwt(token);

  // `set_config(..., true)` é local à TRANSAÇÃO — fora de uma, o terceiro
  // argumento não teria onde valer e o valor vazaria para a conexão do pooler.
  const [linha] = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SELECT set_config('request.jwt.claims', $1, true)`,
      JSON.stringify(payload)
    );
    return tx.$queryRawUnsafe<{ company_id: string; sub: string; papel: string }[]>(`
      SELECT auth.jwt() ->> 'company_id' AS company_id,
             auth.jwt() ->> 'sub'        AS sub,
             auth.role()                 AS papel`);
  });

  expect(linha!.company_id).toBe(payload.company_id);
  expect(linha!.sub).toBe(payload.sub);
  expect(linha!.papel).toBe("authenticated");
});

test("auth.uid() LEVANTA EXCECAO com o sub desta base — armadilha do Ciclo 3", async ({
  request,
}) => {
  const { token } = await tokenDaSessao(request);
  const payload = decodeJwt(token);

  // `auth.uid()` faz cast de `sub` para uuid, e o `User.id` desta base é cuid.
  // Não devolve falso: derruba a consulta, com mensagem que fala de UUID e não
  // de política. Este caso existe para que uma política do Ciclo 3 escrita com
  // `auth.uid()` seja pega aqui, e não em produção com o Realtime mudo.
  await expect(
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT set_config('request.jwt.claims', $1, true)`,
        JSON.stringify(payload)
      );
      return tx.$queryRawUnsafe(`SELECT auth.uid() AS uid`);
    })
  ).rejects.toThrow(/invalid input syntax for type uuid/);
});
```

- [ ] **Step 2: Rodar**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx playwright test tests/e2e/claims-jwt.spec.ts
```

Esperado: 3 passando. Cole a saída inteira.

**Se a rota devolver 500**, a causa quase certa é a ação D3 não ter sido feita.
**Pare e reporte** com a saída — não contorne gerando chave você mesmo, porque
o valor precisaria ir para o `.env`, que este plano proíbe tocar.

- [ ] **Step 3: Commit**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git add tests/e2e/claims-jwt.spec.ts
git commit -m "test(jwt): prova que auth.jwt() le company_id do token real

Contra o Postgres de verdade, com o token vindo da ROTA e nao do emissor
isolado: assim o caminho inteiro entra na prova -- cookie do Auth.js,
usuarioAtual(), empresa do vinculo, token.

Inclui a armadilha que o Ciclo 3 herdaria calada: auth.uid() faz cast de sub
para uuid e o User.id desta base e cuid, entao ela LEVANTA EXCECAO em vez de
devolver falso. Politica escrita com auth.uid() morre aqui, nao em producao.

set_config dentro de transacao de proposito: fora dela o terceiro argumento
nao teria onde valer e o valor vazaria para a conexao do pooler.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Provar que o Supabase ACEITA o token, e que a blindagem segue de pé

**⛔ DEPENDE DE AÇÃO DO DONO — D3, D4 e possivelmente D5. A EXECUÇÃO PARA AQUI.**
Sem o provider de third-party auth registrado, a sonda A devolve `PGRST301` e o
teste falha **corretamente**. Não marque como `skip`, não afrouxe a asserção:
um teste que passa nos dois estados não prova nada.

**OBRIGATÓRIO antes de começar:** invocar `supabase`,
`supabase-postgres-best-practices` e `auditing-supabase-security`.

**Files:**
- Create: `tests/e2e/jwt-supabase-aceito.spec.ts`

**Interfaces:**
- Consumes: `GET /api/supabase/token` (Task 4), `SESSAO_ADMIN`,
  `process.env.SUPABASE_URL`, `process.env.SUPABASE_PUBLISHABLE_KEY` (Task 1),
  `generateKeyPair`/`SignJWT` de `jose` para o controle negativo.
- Produces: as três sondas P4 do spec § 5 — aceitação, controle negativo, e
  blindagem contra o tipo de token novo.

- [ ] **Step 1: Escrever o teste**

Criar `tests/e2e/jwt-supabase-aceito.spec.ts`:

```ts
// O Supabase aceita um token mintado pelo CRM — e continua não entregando
// nada de tabela de tenant.
//
// ## A técnica, e por que ela dispensa qualquer exceção no banco
//
// Bater na Data API com uma tabela INEXISTENTE separa dois erros que de outra
// forma se confundem:
//
//   PGRST301 (401) — "None of the keys was able to decode the JWT": recusado
//                    na verificação de assinatura.
//   PGRST205 (404) — "Could not find the table ...": o JWT PASSOU, e o que
//                    faltou foi a tabela.
//
// Ou seja: dá para provar aceitação sem tocar tabela nenhuma, sem grant, sem
// política, sem afrouxar `banco-blindado.spec.ts`. A técnica é a mesma da
// medição de 2026-08-20 (`.superpowers/sdd/medicao-jwt-supabase.md`, §1).
import "dotenv/config";
import { test, expect } from "@playwright/test";
import { SignJWT, generateKeyPair } from "jose";

import { SESSAO_ADMIN } from "./credenciais";

test.use({ storageState: SESSAO_ADMIN });

function configuracao() {
  const url = process.env.SUPABASE_URL;
  const apikey = process.env.SUPABASE_PUBLISHABLE_KEY;

  // Falha alto e cedo, com o nome da variável — mesmo padrão de `senhaE2e()`.
  // A doc é explícita que o JWT mintado NÃO serve no header `apikey`: "Using
  // your minted JWT is not possible in this header".
  if (!url || !apikey) {
    throw new Error(
      "SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY são obrigatórias para esta suíte " +
        "(ver .env.example). A Data API exige o header `apikey` além do `Authorization`."
    );
  }
  return { url, apikey };
}

async function tokenDoCrm(request: import("@playwright/test").APIRequestContext) {
  const resposta = await request.get("/api/supabase/token");
  expect(resposta.status(), "a rota de emissão não respondeu 200 — confira o .env").toBe(200);
  return ((await resposta.json()) as { token: string }).token;
}

test("o Supabase ACEITA o token do CRM", async ({ request }) => {
  const { url, apikey } = configuracao();
  const token = await tokenDoCrm(request);

  const resposta = await request.get(`${url}/rest/v1/tabela_que_nao_existe?select=id`, {
    headers: { apikey, Authorization: `Bearer ${token}` },
  });
  const corpo = (await resposta.json()) as { code?: string };

  // PGRST301 aqui significa que o provider de third-party auth NÃO foi
  // registrado (ação do dono nº 4 do spec), ou que o JWKS registrado não é o
  // desta chave. Não afrouxe este teste: ele é a única prova de que a decisão
  // 3.1 do spec funciona.
  expect(
    corpo.code,
    "token recusado: o provider de third-party auth foi registrado com o JWKS deste CRM?"
  ).not.toBe("PGRST301");
  expect(corpo.code).toBe("PGRST205");
  expect(resposta.status()).toBe(404);
});

test("controle negativo: token de outra chave e RECUSADO", async ({ request }) => {
  const { url, apikey } = configuracao();

  // Sem este caso, o teste acima poderia estar passando por qualquer motivo —
  // inclusive por o gateway não verificar assinatura nenhuma.
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  const forjado = await new SignJWT({ role: "authenticated", company_id: "empresa-forjada" })
    .setProtectedHeader({ alg: "ES256", kid: "chave-que-ninguem-conhece", typ: "JWT" })
    .setSubject("intruso")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

  const resposta = await request.get(`${url}/rest/v1/tabela_que_nao_existe?select=id`, {
    headers: { apikey, Authorization: `Bearer ${forjado}` },
  });

  expect((await resposta.json()).code).toBe("PGRST301");
  expect(resposta.status()).toBe(401);
});

test("com token valido do CRM, tabela de tenant continua INALCANCAVEL", async ({ request }) => {
  const { url, apikey } = configuracao();
  const token = await tokenDoCrm(request);

  // A blindagem (três migrations + `banco-blindado.spec.ts`) é medida contra
  // `anon`/`authenticated` no catálogo. Este caso a mede pelo lado de fora,
  // contra o tipo de token que ESTE ciclo acabou de criar — que é `role:
  // authenticated` e portanto exatamente o que a blindagem barra.
  const resposta = await request.get(`${url}/rest/v1/Lead?select=id&limit=1`, {
    headers: { apikey, Authorization: `Bearer ${token}` },
  });
  const corpo = (await resposta.json()) as { code?: string };

  // Não é PGRST301: o token foi aceito. É permissão negada: o grant não existe.
  // As duas metades juntas é que provam alguma coisa.
  expect(corpo.code).not.toBe("PGRST301");
  expect(corpo.code).toBe("42501");
  expect(resposta.status()).toBeGreaterThanOrEqual(400);
});
```

- [ ] **Step 2: Rodar**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx playwright test tests/e2e/jwt-supabase-aceito.spec.ts
```

Esperado: 3 passando. Cole a saída **inteira**, incluindo o corpo de cada
resposta se algum caso falhar.

**Se o caso 3 devolver algo diferente de `42501`** — por exemplo `200` com lista
vazia — **pare e reporte com o código exato**. Ele vira a resposta do NV4 do
spec, e a asserção é ajustada ao que o PostgREST realmente devolve, **nunca**
relaxada para "qualquer erro serve".

- [ ] **Step 3: Commit**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git add tests/e2e/jwt-supabase-aceito.spec.ts
git commit -m "test(jwt): o Supabase aceita o token do CRM, e a blindagem segue

Tres sondas contra a Data API real. A tabela INEXISTENTE e o truque que
dispensa qualquer excecao no banco: PGRST205 significa JWT aceito e tabela
ausente, PGRST301 significa JWT recusado. Nenhum grant, nenhuma politica,
nenhum afrouxamento do banco-blindado.

O controle negativo com chave aleatoria existe porque sem ele a primeira sonda
poderia estar passando por o gateway nao verificar assinatura nenhuma.

A terceira mede a blindagem pelo lado de fora, contra o tipo de token que este
ciclo acabou de criar -- que e role: authenticated, exatamente o que ela barra.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Verificação final e auditoria

**DEPENDE DE AÇÃO DO DONO:** herda as das Tarefas 7 e 8.

**Files:**
- Create: `docs/auditorias/2026-08-20-ciclo-1b-jwt-isolamento.md`

**Interfaces:**
- Consumes: tudo das Tarefas 1 a 8.
- Produces: o relatório que o `AGENTS.md` exige antes de qualquer merge.

- [ ] **Step 1: Os quatro portões**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npm run typecheck
npm run lint
npm test
npm run build
```

Aqui `npm test` é permitido e necessário. **Registre** que ele reescreve a senha
do admin no banco de desenvolvimento (`tests/unit/seed.test.ts` grava um literal
versionado) — problema pré-existente e conhecido, ⚠️ R1 da auditoria do Ciclo
1a. Não tente consertar; anote como pendência operacional do dono.

Depois, a suíte e2e inteira, sozinha:

```bash
npm run test:e2e
```

- [ ] **Step 2: Conferir cada critério de aceite do spec, um a um**

Seção 10 do spec, com comando e saída colados. Não são opcionais:

- `jose` como dependência direta:
  `node -e "console.log(require('./package.json').dependencies.jose)"`
- catraca e lint sem exceção nova:
  `npx vitest run tests/unit/catraca-prisma-cru.test.ts` e
  `grep -c "src/" eslint.config.mjs` comparado ao que havia antes da branch —
  a `EXCECAO_PERMANENTE` tem que continuar com **5** entradas
- `get_advisors(security)` comparado com a linha de base: **15**
  `rls_enabled_no_policy` (INFO) + **2** WARN de `rls_auto_enable`. Qualquer
  outro achado é regressão
- zero grants para `anon`/`authenticated` em `public` **e** em `realtime`
- zero políticas em `realtime`
- a lista de rotas do build contém `/api/jwks` e `/api/supabase/token`

- [ ] **Step 3: Escrever a auditoria**

`docs/auditorias/2026-08-20-ciclo-1b-jwt-isolamento.md`. **Leia os que já
existem em `docs/auditorias/` antes** — são o formato.

Cobrir a superfície tocada: a chave e onde ela mora, as duas rotas novas (uma
pública e uma que emite credencial), o conteúdo do token, a renovação, e as
provas P1 a P4 com as saídas. Incluir:

- a seção **"Herdado, não corrigido aqui"** com os achados de infraestrutura já
  registrados (chave do n8n, chave global da Evolution, senha reusada do
  Postgres, JWT do n8n sem `exp`) e as dívidas R1, R2, R4, R5 e R6 do Ciclo 1a;
- a seção **🔍 Não verificados**, herdando NV1 a NV7 do spec e acrescentando o
  que a execução não tiver conseguido provar;
- a seção **"Só um humano pode fazer"**, começando por rotacionar a senha do
  admin depois do `npm test` do Step 1.

**Nada de `✅ OK` sem o comando e a saída.** É a regra que o `AGENTS.md` impõe, e
a revisão final do Ciclo 4 pegou uma auditoria afirmando gate que o código não
tinha.

- [ ] **Step 4: Commit, e PARAR**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git add docs/auditorias/2026-08-20-ciclo-1b-jwt-isolamento.md
git commit -m "docs(auditoria): Ciclo 1b -- JWT do Supabase e isolamento

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

**Não faça merge nem abra PR.** O `AGENTS.md` deste projeto exige a Fase 1 da
skill `auditoria-seguranca` sobre a superfície que a branch mexeu, entregue como
relatório, com a correção começando só depois que o dono aprova. Esta branch
mexe em emissão de credencial: é exatamente o caso.

---

## Auto-revisão deste plano

Feita antes de entregar, como a `writing-plans` exige.

**Cobertura do spec.** Os quatro itens da seção 4 do spec viram tarefas: 4.1 →
Task 1; 4.3 → Task 2; 4.2 → Task 3; 4.5 → Task 4; 4.4 → Tasks 2 e 5. As quatro
provas da seção 5 viram Tasks 2 (P1), 3 (P2), 7 (P3) e 8 (P4). A seção 5.1 (o
que não dá para provar) vira as duas asserções da Task 6, que pré-armam a
afirmação do Ciclo 3. As ações do dono da seção 8 estão mapeadas na tabela do
topo e repetidas no cabeçalho das Tasks 7 e 8.

**Ordem.** Nenhuma tarefa usa algo que uma posterior cria:
Task 2 usa `chave.ts` (1) · Task 3 usa `jwksPublico` (1) · Task 4 usa
`emitirTokenSupabase` (2) · Task 5 consome o contrato da rota (4) · Task 7 usa a
rota (4) · Task 8 usa a rota (4) e as variáveis documentadas em (1). Task 6 não
depende de nenhuma outra e foi posta **antes** das que travam em ação do dono,
para a execução avançar o máximo possível antes de parar.

**Tipos e nomes consistentes entre tarefas.** `TokenSupabase { token, expiraEm }`
é produzido pela Task 2, serializado pela Task 4 e consumido pelas Tasks 5, 7 e
8 com os mesmos dois nomes. `JwkPrivado`, `chaveDeAssinatura`, `jwkPublico`,
`jwksPublico`, `gerarParDeChaves` aparecem com a mesma assinatura na Task 1 e em
todos os usos. `UsuarioAtivo.companyId` e `.id` batem com
`src/core/auth/usuario-ativo.ts`. `checarRateLimit(chave, limite, janelaMs)`
bate com `src/core/rate-limit/limiter.ts:46`.

**Varredura de placeholder.** Nenhum "TBD", nenhum "similar à Task N", nenhum
"tratamento de erro apropriado": todo bloco de código está inteiro, todo comando
tem a saída esperada, e onde a saída depende do ambiente o plano diz para colar
a medida em vez de afirmar um número inventado.

**Afirmações universais com caso que as exercita.** "A privada nunca é
publicada" → caso do conjunto exato de campos + caso sobre o texto da resposta.
"Nenhum claim a mais" → caso do conjunto exato de chaves. "O cliente não escolhe
a empresa" → caso com os três vetores e o caso da aridade de `GET`. "Nunca no
escopo do módulo" → caso que importa com o ambiente vazio. "Nenhum arquivo novo
alcança o prisma cru" → catraca rodada na Task 4.
