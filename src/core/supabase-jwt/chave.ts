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
