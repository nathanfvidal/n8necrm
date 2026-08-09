/**
 * Credenciais das contas que a suíte E2E usa para entrar no sistema.
 *
 * ## Por que contas próprias, e não as do seed
 *
 * Até 2026-08-07 os specs entravam com `admin@exemplo.com` / `senha123` —
 * senha que é literal público em `prisma/seed.ts`. Isso funcionou enquanto o
 * banco era só de desenvolvimento. Não é: **dev e produção compartilham o
 * mesmo Postgres**, e existe deploy público. Uma auditoria encontrou aquela
 * conta ADMIN ativa e acessível pela internet com a senha que está no
 * repositório.
 *
 * As contas de demonstração foram desativadas e continuam assim. A suíte
 * passou a ter as suas, com três diferenças que importam:
 *
 * - **Nome que declara a função.** `e2e-` e `.invalid` (TLD reservado pela
 *   RFC 2606, mesmo padrão de `whatsapp-bot@sistema.invalid`) dizem a quem
 *   olhar a lista de usuários que aquilo não é gente.
 * - **Senha aleatória, fora do código.** Vem de `E2E_SENHA`, gerada uma vez e
 *   guardada no `.env` — que o `.gitignore` cobre com `.env*`.
 * - **Provisionadas por `global-setup.ts`**, não pelo seed do produto. Fixture
 *   de teste não é dado de produto.
 *
 * ## Isto trata o sintoma
 *
 * A causa real é dev e produção dividirem banco: enquanto for assim, toda
 * conta de teste é uma conta de produção, e o melhor alcançável é que ela
 * tenha nome honesto e senha forte. O conserto de verdade é um banco separado
 * para teste — registrado como dívida na spec do núcleo.
 */

export const EMAIL_ADMIN_E2E = "e2e-admin@teste.invalid";
export const EMAIL_VENDEDOR_E2E = "e2e-vendedor@teste.invalid";

/**
 * Onde a sessão de cada conta fica guardada entre os testes.
 *
 * ## Por que sessão reaproveitada, e não um login por teste
 *
 * O limite de tentativas de login é 10 por conta a cada 10 minutos
 * (`src/core/rate-limit/login.ts`). A suíte fazia ~9 logins de admin por
 * execução — dentro do teto, mas a um teste de distância de estourá-lo. E
 * quando estoura, o sintoma não se parece nada com a causa: o ÚLTIMO teste da
 * fila falha por timeout esperando uma navegação, como se a tela estivesse
 * quebrada. Aconteceu de verdade ao integrar a fatia de conversa aguardando:
 * dois testes passaram a logar como admin e derrubaram um terceiro, sem
 * relação nenhuma com eles.
 *
 * `auth.setup.ts` faz UM login por conta, antes de tudo, e grava o estado
 * aqui. Os specs que só precisam "estar logados" partem desse estado e não
 * gastam cota. Sobram os logins de quem testa o PRÓPRIO login (`auth.spec.ts`)
 * e a revogação de sessão (`equipe.spec.ts`) — nesses, logar é o objeto do
 * teste, não um pré-requisito.
 *
 * O diretório é ignorado pelo git: são cookies de sessão válidos, mesmo que de
 * conta de teste.
 */
export const SESSAO_ADMIN = "tests/e2e/.auth/admin.json";
export const SESSAO_VENDEDOR = "tests/e2e/.auth/vendedor.json";

/**
 * Falha alto e cedo quando `E2E_SENHA` não existe, em vez de deixar a suíte
 * quebrar depois com "E-mail ou senha inválidos" — erro que aponta para o
 * login e não para a configuração que realmente falta.
 *
 * A ausência não tem valor padrão de propósito: um fork novo deste CRM não
 * deve nascer com conta de teste ativa no banco do cliente. Quem quer rodar o
 * e2e declara isso explicitamente.
 */
export function senhaE2e(): string {
  const senha = process.env.E2E_SENHA;
  if (!senha) {
    throw new Error(
      "E2E_SENHA não está definida. A suíte E2E precisa dela para provisionar e usar " +
        "as contas de teste (ver tests/e2e/credenciais.ts). Defina no .env."
    );
  }
  return senha;
}
