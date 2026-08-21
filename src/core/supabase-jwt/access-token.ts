/**
 * A fábrica do callback que o Ciclo 3 passa em
 * `createClient(url, chave, { accessToken })`.
 *
 * ## Este arquivo roda no NAVEGADOR, e é o único do Ciclo 1b que roda
 *
 * `chave.ts` e `emitir.ts` são do servidor — `emitir.ts` carrega
 * `import "server-only"` justamente para o build falhar com erro nomeado se
 * alguém o arrastar para um bundle de cliente. Este aqui é o outro lado da
 * costura: ele não assina nada, ele **pede** o token à rota
 * `GET /api/supabase/token` e guarda o que voltou. Por isso ele não importa
 * nada — nem `emitir.ts`, nem `chave.ts`, nem transitivamente.
 * `tests/unit/supabase-access-token.test.ts` percorre o grafo de imports a
 * partir daqui e reprova qualquer aresta que alcance a chave privada; a mesma
 * varredura, apontada para a rota de emissão, encontra `server-only` a dois
 * saltos, que é a prova de que ela enxerga o que precisa enxergar.
 *
 * ## Por que `accessToken` e não `realtime.setAuth(jwt)`
 *
 * Medido em `@supabase/supabase-js` 2.111.0: com `accessToken` configurado, o
 * callback é a fonte da verdade e o cliente renova sozinho a cada heartbeat
 * (`_wrapHeartbeatCallback` → `_setAuthSafely`, `RealtimeClient.js:554-563`),
 * com intervalo padrão de 25 s (`HEARTBEAT_INTERVAL: 25000`, linha 9).
 * `setAuth(token)` manual obriga a reemitir e reinjetar o token na mão antes de
 * cada expiração — e o guia do Realtime diz o que acontece quando se erra:
 * "If a new JWT is never received on the Channel, the client will be
 * disconnected when the JWT expires."
 *
 * **Armadilha para o Ciclo 3, dita em voz alta porque custa tempo de quem não
 * sabe:** a opção `accessToken` e o namespace `supabase.auth` são mutuamente
 * exclusivos no MESMO cliente — a própria doc da opção diz "when set, the
 * `auth` namespace of the Supabase client cannot be used". Aqui isso não custa
 * nada, porque o login é cookie do Auth.js e ninguém chama `supabase.auth`. Mas
 * o cliente de `src/lib/storage.ts`, que usa `service_role`, tem que continuar
 * sendo outro cliente.
 *
 * ## Por que memoizar COM trava
 *
 * A doc do `supabase-js` avisa: o callback "may be called concurrently and many
 * times. Use memoization and locking techniques". Sem memoização, cada
 * heartbeat viraria uma emissão; sem trava, uma reconexão com vários canais
 * viraria uma rajada simultânea contra a rota de emissão — que tem teto de taxa
 * (120 por 5 minutos por usuário, `src/app/api/supabase/token/route.ts`), ou
 * seja, a rajada se puniria sozinha.
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
 *
 * ## Os quatro modos de recusa da rota são todos o mesmo modo aqui
 *
 * A rota recusa em quatro situações e nenhuma delas emite token: sessão
 * inválida, conta vinculada a mais de uma empresa, teto de taxa estourado e
 * falha interna. Este arquivo **não distingue** os códigos — nem em `if`, nem
 * no texto do erro, que só repete o número que veio. É deliberado, e por dois
 * motivos que puxam para lados diferentes:
 *
 * - o código que convida a redirecionar para o login é o de sessão inválida, e
 *   redirecionar daqui seria mandar a pessoa embora de dentro de um heartbeat
 *   de fundo, sem ela ter clicado em nada;
 * - o código de empresa ambígua só se resolve com **intervenção humana** (não
 *   existe seletor de empresa até o Ciclo 3), então qualquer nova tentativa
 *   automática em cima dele é laço infinito por construção.
 *
 * Quem decide tentar de novo é o heartbeat de 25 s, que já tem o ritmo certo.
 * Esta fábrica faz uma requisição por chamada, e nenhuma a mais.
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

/**
 * Repare no que esta assinatura **não** tem: um jeito de dizer de qual empresa
 * é o token. Não é esquecimento. O `company_id` do token é literalmente o valor
 * em que as políticas RLS do Ciclo 3 vão confiar, e ele é decidido no servidor,
 * por `usuarioAtual()`, dentro de um handler que nem recebe a requisição
 * (`src/app/api/supabase/token/route.ts`). Um parâmetro de empresa aqui —
 * mesmo "só para teste" — abriria um canal do navegador até aquele valor e
 * transformaria o RLS inteiro em decoração.
 */
export function criarAccessTokenSupabase(opcoes: OpcoesAccessToken = {}): () => Promise<string> {
  const url = opcoes.url ?? URL_PADRAO;
  const margem = opcoes.margemSegundos ?? MARGEM_PADRAO_SEGUNDOS;
  // A indireção não é enfeite: `fetch` desamarrado do objeto global lança
  // "Illegal invocation" em navegador baseado em Chromium, e resolver o global
  // só na hora da chamada evita capturar um `fetch` de antes de qualquer
  // instrumentação.
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
        "Resposta da rota de emissão sem `token`/`expiraEm` — status de sucesso com corpo de erro."
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
