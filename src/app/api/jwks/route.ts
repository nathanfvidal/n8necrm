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
 *   montagem é por lista BRANCA em `jwkPublico()` (`core/supabase-jwt/chave.ts`),
 *   e `tests/unit/rota-jwks.test.ts` cobra isso de dois jeitos: o conjunto
 *   EXATO de chaves do corpo já parseado (campo novo é reprovado por omissão) e
 *   a ausência de `d` no TEXTO serializado — asserção sobre o objeto devolvido
 *   passaria por cima de getter ou de campo herdado do protótipo;
 * - ela não lê a requisição, não lê cookie e não varia por usuário — repare que
 *   `GET` nem recebe parâmetro. As duas metades disso têm caso próprio:
 *   `GET.length === 0` para o que chegaria por parâmetro, e uma asserção sobre
 *   o texto deste arquivo de que ele não importa `next/headers` para o que
 *   chegaria por ambiente (`cookies()`, `headers()`), que nenhum teste de
 *   comportamento desta suíte alcançaria. Isso importa aqui porque a resposta é
 *   cacheável: resposta pública que varie por usuário é cache envenenado;
 * - sem chave configurada ela responde **500** com corpo genérico, e nunca 200
 *   com `keys` vazio: um JWKS vazio faz o Supabase recusar todo token com um
 *   erro que não aponta para cá. O detalhe do erro vai para o log do servidor,
 *   não para o corpo — a mensagem de `chave.ts` nomeia a variável de ambiente e
 *   o formato dela, que é informação de operação e não de leitor anônimo.
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
 * Router não foi verificado neste projeto (spec §4.2, NV6). Mudar a URL depois
 * custa uma reregistração no Supabase, com até 30 minutos de propagação.
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
