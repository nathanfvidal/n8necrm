// `import "server-only"` é GUARDA, não coincidência da árvore de dependências
// — mesmo padrão e mesmo motivo de `src/lib/prisma.ts` e `src/lib/storage.ts`.
// Este módulo alcança a chave PRIVADA que assina todo token do CRM; sem a
// guarda, o único obstáculo entre ela e um bundle de cliente seria o bundler
// tropeçar em algum módulo de Node lá embaixo, que é proteção que some no dia
// em que a dependência mudar. Com a guarda, o build falha com erro nomeado.
//
// Ela mora AQUI e não em `chave.ts` (spec §4.6): `chave.ts` é compartilhado com
// `scripts/gerar-chave-jwt-supabase.ts`, que roda em Node puro, fora da
// condição de resolução `react-server` — onde o pacote `server-only` lança.
// Consequência para quem escrever teste: todo teste unitário que alcance este
// arquivo precisa de `vi.mock("server-only", () => ({}))` antes do import
// (`tests/unit/supabase-jwt-emitir.test.ts` faz isso).
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
 *   em `anon`, que está revogado de tudo nesta base (três migrations e
 *   `tests/e2e/banco-blindado.spec.ts` mantêm essa revogação), e o Realtime
 *   entregaria silêncio em vez de erro.
 * - `sub` — `User.id`. Livre neste caminho: não precisa ser UUID de
 *   `auth.users` (Firebase e Clerk usam ids próprios — medição §2 do spec).
 *   **Ver a armadilha do `auth.uid()` abaixo.**
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
 * "Seis claims e nenhum a mais" é afirmação universal, e por isso tem caso que
 * a exercita: `tests/unit/supabase-jwt-emitir.test.ts` afirma o conjunto EXATO
 * de chaves do payload e o conjunto exato do header — não "contém".
 *
 * ## ARMADILHA: `auth.uid()` é inutilizável neste projeto
 *
 * `auth.uid()` faz cast de `sub` para `uuid` e o `User.id` desta base é cuid.
 * Medido contra `uzumzfxjcxrbxaucvfsr` em 2026-08-20 (spec §4.3.1):
 *
 *     ERROR: 22P02: invalid input syntax for type uuid: "cmt18m0ut000w306j..."
 *
 * Uma política que chame `auth.uid()` não devolve falso: **levanta exceção** e
 * derruba a consulta. As políticas do Ciclo 3 usam `auth.jwt() ->> 'sub'`. O
 * caso que trava isso contra o Postgres real é `tests/e2e/claims-jwt.spec.ts`,
 * criado adiante neste mesmo ciclo (plano do Ciclo 1b, Task 7).
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

/**
 * Lida DENTRO da função, nunca no escopo do módulo: `next build` avalia cada
 * módulo alcançável para coletar a configuração das rotas, e validar env no
 * topo faz a validação rodar em tempo de build, onde a variável não existe —
 * foi assim que o deploy caiu por três dias em 2026-08-07
 * (`src/modules/whatsapp/gateway/index.ts` guarda o log). Mesmo motivo pelo
 * qual `src/lib/env.ts`, que valida no topo, não recebe estas variáveis.
 */
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

/**
 * A empresa vem do SERVIDOR, sempre.
 *
 * `companyId` é o parâmetro mais perigoso desta base: é exatamente o valor que
 * as políticas RLS do Ciclo 3 vão confiar. Quem chama esta função tira o valor
 * da sessão (`usuarioAtual()`), nunca do corpo ou da query da requisição — se o
 * cliente puder escolher a própria empresa, o RLS inteiro vira decoração. Esta
 * função não tem como conferir isso sozinha — ela recebe uma string e assina.
 * Quem trava é a rota `src/app/api/supabase/token/route.ts`, que tira o
 * `companyId` de `usuarioAtual()` e ignora qualquer coisa que venha na
 * requisição (plano do Ciclo 1b, Task 4 — ainda não existe em disco).
 */
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
