import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Trava o que `GET /api/jwks` entrega à INTERNET INTEIRA.
 *
 * Esta rota é pública por definição: o Supabase precisa alcançá-la sem sessão e
 * sem `apikey` para verificar a assinatura dos tokens que o CRM minta (spec
 * §4.2). Logo, tudo que ela serve é conteúdo público — e o objeto de onde a
 * resposta é derivada é o JWK PRIVADO, que carrega `d`, o escalar que
 * transforma "chave que verifica" em "chave que assina".
 *
 * Por isso as asserções de vazamento aqui são sobre o TEXTO serializado e sobre
 * o objeto JÁ PARSEADO da resposta, nunca sobre o objeto que a rota devolveu:
 * uma asserção sobre o objeto original passaria por cima de um getter ou de um
 * campo herdado do protótipo, e nenhum dos dois sobrevive a `JSON.stringify` +
 * `JSON.parse` — que é exatamente o caminho que o leitor real percorre.
 *
 * Nenhum caso usa segredo real: o par de chaves é gerado em memória a cada
 * caso, pelo mesmo `gerarParDeChaves()` que `tests/unit/supabase-jwt-emitir.test.ts`
 * usa.
 */

/**
 * A lista BRANCA do corpo público — os sete campos de `jwkPublico()`
 * (`src/core/supabase-jwt/chave.ts`) e nada mais.
 *
 * Branca e não negra, e isso é a decisão inteira: com lista negra ("tudo menos
 * `d`"), qualquer campo novo que o `jose` passasse a incluir em `exportJWK` —
 * ou qualquer campo novo do schema privado — seria publicado POR OMISSÃO, sem
 * ninguém decidir. Com lista branca, campo novo é recusado por omissão e o caso
 * "publica EXATAMENTE os sete campos da lista branca" fica vermelho.
 */
const CAMPOS_PUBLICOS = ["alg", "crv", "kid", "kty", "use", "x", "y"] as const;

/** Linha que é comentário: `//`, ou o `/*` e o `*` de um bloco / JSDoc. */
const LINHA_DE_COMENTARIO = /^\s*(?:\/\/|\/\*|\*)/;

/**
 * O fonte de um arquivo com as linhas de comentário fora.
 *
 * Existe por uma armadilha que mordeu na primeira execução deste arquivo: o
 * JSDoc da própria rota EXPLICA que ela não importa `next/headers`, então uma
 * asserção sobre o texto inteiro reprovava a rota correta pela menção. É a
 * mesma armadilha que `vitest.config.ts` registra sobre `dotenv/config`
 * ("âncora no início da linha, não pega comentário que só MENCIONA a string").
 *
 * O filtro é por LINHA e erra para o lado seguro: comentário no fim de uma
 * linha de código continua contando como código, o que pode reprovar demais —
 * nunca de menos. Reprovar de menos é o que faria a trava mentir.
 */
function semComentarios(texto: string): string {
  return texto
    .split("\n")
    .filter((linha) => !LINHA_DE_COMENTARIO.test(linha))
    .join("\n");
}

function fonteSemComentarios(caminho: string): string {
  return semComentarios(readFileSync(caminho, "utf8"));
}

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
  // `chave.ts` memoiza a chave lida em escopo de módulo. Sem este reset, o
  // módulo que a rota importa a seguir seria a instância que já leu (ou já
  // falhou em ler) o ambiente vazio do `beforeEach`.
  vi.resetModules();
  return par;
}

describe("GET /api/jwks", () => {
  it("é dinâmica — senão o build avalia a rota sem a variável e cai", async () => {
    // Afirmação sobre a configuração da rota, e não sobre o corpo: um route
    // handler que não lê a requisição pode ser avaliado em tempo de BUILD, e
    // em tempo de build a chave não existe. Mesmo modo de falha que derrubou
    // o deploy em 2026-08-07.
    //
    // Repare que este caso roda com o ambiente VAZIO (o `beforeEach` apaga a
    // variável) e o import não lança: é a prova de que a leitura da chave é
    // preguiçosa também por este caminho.
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
    // O `kid` é o que liga o header do token à chave do JWKS ("The signed JWTs
    // must have a `kid` header parameter to identify which key must be used" —
    // guia de third-party auth). Divergir aqui é token recusado sem explicação.
    expect(corpo.keys[0].kid).toBe(par.privado.kid);
  });

  it("publica EXATAMENTE os sete campos da lista branca, e nenhum outro", async () => {
    await prepararChave();
    const { GET } = await import("@/app/api/jwks/route");
    const corpo = await (await GET()).json();

    // Conjunto EXATO, não "não contém d": este é o caso que faz a lista branca
    // ser lista branca. Um campo novo que o `jose` ou o schema privado passem a
    // carregar aparece aqui como vermelho em vez de aparecer na internet.
    //
    // `corpo` veio de `resposta.json()`, ou seja, de um `JSON.parse` do texto
    // que a rota escreveu — não tem getter nem campo de protótipo para se
    // esconder atrás. `Object.keys` aqui é literalmente o que o leitor lê.
    expect(Object.keys(corpo.keys[0]).sort()).toEqual([...CAMPOS_PUBLICOS]);
    expect(Object.keys(corpo).sort()).toEqual(["keys"]);
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

  it("o corpo do 500 não repete a mensagem do erro para quem pediu", async () => {
    const { GET } = await import("@/app/api/jwks/route");
    const texto = await (await GET()).text();

    // Corpo genérico, detalhe só no log do servidor (spec §4.2). A mensagem de
    // `chave.ts` nomeia a variável de ambiente e a forma esperada dela; é
    // informação de operação, não de leitor anônimo.
    expect(texto).not.toContain("SUPABASE_JWT_PRIVATE_JWK");
  });
});

describe("a rota não varia por quem pede", () => {
  it("GET não declara parâmetro — não há requisição de onde ecoar nada", async () => {
    await prepararChave();
    const { GET } = await import("@/app/api/jwks/route");

    // `Function.length` conta os parâmetros declarados. Zero é a prova de que
    // não existe `Request` no escopo do handler para alguém ler cabeçalho,
    // query string ou corpo e devolver junto. Acrescentar `req` para "só logar
    // o IP" deixa este caso vermelho, que é o momento certo de discutir.
    expect(GET.length).toBe(0);
  });

  it("o fonte não importa next/headers — a única via de cookie que sobra", async () => {
    // Asserção sobre o TEXTO do arquivo, e não sobre comportamento, pelo mesmo
    // motivo da guarda `server-only` em `tests/unit/supabase-jwt-emitir.test.ts`:
    // `cookies()` e `headers()` do `next/headers` são AMBIENTES — não chegam
    // por parâmetro, então `GET.length === 0` não os alcança e nenhum caso de
    // comportamento nesta suíte observaria a diferença (fora do runtime do
    // Next, ler cookie aqui nem sequer falharia de forma visível).
    //
    // O que este caso protege: a afirmação universal do JSDoc da rota de que
    // ela "nunca lê cookie e nunca varia por usuário" (spec §4.2). Uma resposta
    // pública e cacheável por 5 minutos que varie por usuário é cache
    // envenenado servido pela CDN para o próximo visitante.
    expect(fonteSemComentarios("src/app/api/jwks/route.ts")).not.toContain("next/headers");
  });

  it("e o filtro de comentários morde: derruba a menção, mantém o import", () => {
    // Um caso que o filtro precisa REPROVAR e um que precisa APROVAR, como a
    // Parte 3 de `tests/unit/catraca-prisma-cru.test.ts`. Sem este par, um erro
    // no regex esvaziaria o texto filtrado e a trava acima ficaria verde para
    // sempre, sem ter lido nada.
    const soMencao = ['/**', " * a rota não importa next/headers", " */", 'export const x = 1;'].join(
      "\n"
    );
    const importDeVerdade = `${soMencao}\nimport { cookies } from "next/headers";`;

    expect(semComentarios(soMencao)).not.toContain("next/headers");
    expect(semComentarios(importDeVerdade)).toContain("next/headers");
  });
});
