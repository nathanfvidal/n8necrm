import { checarRateLimit } from "./limiter";

/**
 * Limite de tentativas de login, em duas dimensões.
 *
 * Antes disto o `/api/auth/callback/credentials` aceitava tentativas
 * ilimitadas: 25 senhas erradas seguidas contra uma conta real responderam
 * todas igual, nenhuma bloqueada. A única barreira contra força bruta era a
 * força da senha do usuário. O limiter (`./limiter`) já existia e já era
 * usado pelo webhook do WhatsApp — só nunca tinha sido ligado aqui.
 *
 * ## Por que duas dimensões
 *
 * - **Por IP** pega um atacante varrendo MUITAS contas de uma origem só.
 *   Precisa ser mais folgado porque um escritório inteiro sai por um NAT: se
 *   cinco pessoas erram a senha na segunda-feira de manhã, elas dividem o
 *   mesmo balde.
 * - **Por conta** pega um atacante martelando UMA conta de muitas origens,
 *   que é o caso que o limite por IP não vê. É o teto que realmente importa
 *   contra força bruta dirigida: 10 tentativas a cada 10 minutos são ~1.440
 *   por dia, número que não quebra senha nenhuma que preste.
 *
 * ## Consumir antes, não contar falhas depois
 *
 * O desenho alternativo — "só conta quando a senha erra, e zera no acerto" —
 * tem UX melhor, mas exige LER o contador antes de decidir e INCREMENTAR
 * depois. Entre a leitura e a escrita cabe uma rajada concorrente: 100
 * requisições simultâneas leem "contador 0", todas passam, todas fazem
 * bcrypt. Esse é exatamente o bug que a revisão da Task 11 provou com
 * `Promise.all` (15 de 15 chamadas passaram por um limite de 5) e que o
 * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` do limiter corrigiu ao
 * fazer leitura e escrita numa instrução só.
 *
 * Então aqui **toda tentativa consome uma unidade**, certa ou errada, e a
 * serialização no lock de linha do Postgres vale também para o login. O
 * custo é um usuário legítimo gastar cota ao acertar a senha — irrelevante
 * na prática, porque a sessão dura semanas e ninguém faz login 10 vezes em
 * 10 minutos.
 *
 * ## O IP é checado primeiro, de propósito
 *
 * Se o IP já estourou, a função retorna sem tocar na cota da conta. Do
 * contrário um atacante bloqueado ainda conseguiria queimar o balde do
 * e-mail da vítima a cada requisição, transformando um limite que existe
 * para proteger a conta numa arma contra ela.
 *
 * ## A cota da conta é consumida mesmo se o e-mail não existir
 *
 * Quem chama isto (`src/lib/auth.ts`) o faz ANTES de procurar o usuário no
 * banco. Se só e-mail existente consumisse cota, o próprio bloqueio viraria
 * um oráculo de enumeração: "esta conta bloqueia, logo esta conta existe".
 *
 * ## Trade-off assumido: bloqueio de conta como negação de serviço
 *
 * Quem souber o e-mail de um usuário pode gastar as 10 tentativas dele e
 * deixá-lo sem entrar por até 10 minutos. É o preço conhecido de qualquer
 * limite por conta, e por isso a janela é curta. Duas propriedades da janela
 * fixa do limiter contêm o estrago: `contagem` satura em `limite + 1`
 * (`LEAST`) e `janelaInicio` não se move enquanto a janela está viva — então
 * continuar atacando **não estende** o bloqueio, ele acaba na hora marcada.
 */

/** Tentativas por IP na janela. Folgado: um NAT de escritório é um IP só. */
export const LIMITE_LOGIN_POR_IP = 20;

/** Tentativas por conta na janela. Quem esqueceu a senha tenta ~5 vezes. */
export const LIMITE_LOGIN_POR_CONTA = 10;

export const JANELA_LOGIN_MS = 10 * 60_000;

export type ResultadoLimiteLogin =
  | { permitido: true }
  | { permitido: false; dimensao: "ip" | "conta" };

/**
 * Normaliza o e-mail para a chave do rate limit.
 *
 * Minúsculas e sem espaços nas pontas para que variar a caixa não renda
 * baldes novos. O corte em 200 caracteres não é estética: `RateLimit.chave`
 * é a PRIMARY KEY da tabela (índice btree), e o Postgres recusa linha de
 * índice acima de ~2.700 bytes. O corpo do POST de login é público e não
 * autenticado — sem o corte, mandar um "e-mail" de 10 KB derruba a query
 * com erro de índice e vira 500 num endpoint aberto, que é a mesma classe
 * de bug do `typeof` em `authorize` (revisão final de branch).
 */
function chaveDaConta(email: string): string {
  return email.trim().toLowerCase().slice(0, 200);
}

export async function checarLimiteLogin(
  ip: string,
  email: string
): Promise<ResultadoLimiteLogin> {
  const ipPermitido = await checarRateLimit(
    `login:ip:${ip}`,
    LIMITE_LOGIN_POR_IP,
    JANELA_LOGIN_MS
  );
  if (!ipPermitido) return { permitido: false, dimensao: "ip" };

  const contaPermitida = await checarRateLimit(
    `login:conta:${chaveDaConta(email)}`,
    LIMITE_LOGIN_POR_CONTA,
    JANELA_LOGIN_MS
  );
  if (!contaPermitida) return { permitido: false, dimensao: "conta" };

  return { permitido: true };
}
