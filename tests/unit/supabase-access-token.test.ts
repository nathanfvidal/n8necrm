import { readFileSync } from "node:fs";

import type { SupabaseClientOptions } from "@supabase/supabase-js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  criarAccessTokenSupabase,
  MARGEM_PADRAO_SEGUNDOS,
  URL_PADRAO,
} from "@/core/supabase-jwt/access-token";

import { semComentarios } from "./helpers/codigo-fonte";

/**
 * A fábrica do callback `accessToken` — o único arquivo do Ciclo 1b que roda no
 * NAVEGADOR.
 *
 * Isso divide esta suíte em duas metades que provam coisas diferentes:
 *
 * 1. **Comportamento** — memoização com trava, margem de 60 s, e a regra
 *    contraintuitiva de LANÇAR em falha em vez de devolver `null`
 *    (`RealtimeClient.js:456-495`: quem lança cai no último token bom; quem
 *    devolve `null` SOBRESCREVE o token guardado e empurra
 *    `access_token: null` para o canal já juntado).
 * 2. **Superfície** — que a fábrica não tem por onde receber uma empresa, e que
 *    o arquivo não alcança, nem transitivamente, o módulo que assina com a
 *    chave privada. Nenhuma das duas é observável de dentro: um `companyId` no
 *    parâmetro passaria em todo caso de comportamento, e um import a mais só
 *    apareceria no bundle de produção. Por isso a segunda metade afirma sobre o
 *    TEXTO do fonte e sobre o grafo de imports, no mesmo padrão que a Task 2
 *    (`supabase-jwt-chave.test.ts`), a Task 3 (`rota-jwks.test.ts`) e a Task 4
 *    (`rota-token-supabase.test.ts`) usaram para as guardas invisíveis delas.
 */

const ARQUIVO = "src/core/supabase-jwt/access-token.ts";

function agoraEmSegundos(): number {
  return Math.floor(Date.now() / 1000);
}

function respostaOk(corpo: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => corpo,
  } as unknown as Response;
}

function respostaDeErro(status: number, corpo: unknown): Response {
  return {
    ok: false,
    status,
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
    // canais vira uma rajada contra a rota de emissão — que tem teto de taxa
    // (120 por 5 minutos, `src/app/api/supabase/token/route.ts`).
    const buscar = vi.fn<typeof fetch>(async () =>
      respostaOk({ token: "t1", expiraEm: agoraEmSegundos() + 300 })
    );
    const accessToken = criarAccessTokenSupabase({ buscar });

    const resultados = await Promise.all(Array.from({ length: 20 }, () => accessToken()));

    expect(buscar).toHaveBeenCalledTimes(1);
    expect(new Set(resultados)).toEqual(new Set(["t1"]));
  });

  it("dentro da validade não busca de novo", async () => {
    const buscar = vi.fn<typeof fetch>(async () =>
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
    const buscar = vi.fn<typeof fetch>(async () =>
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

  it("na margem EXATA já renova — o empate cai para o lado seguro", async () => {
    // Fronteira escrita à mão, e não derivada da mesma conta que o código faz:
    // com `expiraEm` a exatamente 60 s de distância, sobrar ou não sobrar
    // margem é a diferença entre renovar e mandar um token que pode chegar
    // vencido num cliente com relógio adiantado. O empate renova.
    let n = 0;
    const buscar = vi.fn<typeof fetch>(async () =>
      respostaOk({ token: `t${++n}`, expiraEm: agoraEmSegundos() + 300 })
    );
    const accessToken = criarAccessTokenSupabase({ buscar });

    expect(await accessToken()).toBe("t1");
    vi.advanceTimersByTime(240_000); // faltam exatamente 60 s
    expect(await accessToken()).toBe("t2");
  });

  it("a margem é configurável, e é ela que decide a hora de renovar", async () => {
    // Sem este caso, `margemSegundos` seria opção morta: os outros casos todos
    // passariam com a constante embutida no lugar do parâmetro.
    let n = 0;
    const buscar = vi.fn<typeof fetch>(async () =>
      respostaOk({ token: `t${++n}`, expiraEm: agoraEmSegundos() + 300 })
    );
    const accessToken = criarAccessTokenSupabase({ buscar, margemSegundos: 200 });

    expect(await accessToken()).toBe("t1");
    vi.advanceTimersByTime(150_000); // faltam 150: abaixo de 200, mas acima de 60
    expect(await accessToken()).toBe("t2");
    expect(buscar).toHaveBeenCalledTimes(2);
  });
});

describe("falha", () => {
  it("LANÇA em vez de devolver null — medido em realtime-js", async () => {
    // RealtimeClient.js:456-495: se o callback LANÇA, o cliente loga e cai no
    // último token bom (`tokenToSend = this.accessTokenValue`) — degradação
    // graciosa. Se devolve `null`, `accessTokenValue` é SOBRESCRITO com null e
    // o canal já juntado recebe push de `access_token: null`. O caminho que
    // parece mais educado é o destrutivo.
    const buscar = vi.fn<typeof fetch>(async () => respostaDeErro(500, { erro: "indisponivel" }));
    const accessToken = criarAccessTokenSupabase({ buscar });

    await expect(accessToken()).rejects.toThrow(/500/);
  });

  it("não memoiza a falha: a chamada seguinte tenta de novo", async () => {
    const buscar = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respostaDeErro(500, { erro: "indisponivel" }))
      .mockResolvedValueOnce(respostaOk({ token: "t1", expiraEm: agoraEmSegundos() + 300 }));
    const accessToken = criarAccessTokenSupabase({ buscar });

    await expect(accessToken()).rejects.toThrow();
    expect(await accessToken()).toBe("t1");
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it("uma falha em voo não fica presa no lugar da próxima tentativa", async () => {
    // A trava é a promessa em voo. Se o `finally` que a solta sumir, a primeira
    // falha vira permanente: toda chamada seguinte esperaria a MESMA promessa
    // já rejeitada e a rota nunca mais seria chamada. As 20 chamadas
    // concorrentes aqui rejeitam juntas, e a 21ª tem que conseguir buscar.
    const buscar = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respostaDeErro(503, { erro: "indisponivel" }))
      .mockResolvedValue(respostaOk({ token: "depois", expiraEm: agoraEmSegundos() + 300 }));
    const accessToken = criarAccessTokenSupabase({ buscar });

    const rajada = await Promise.allSettled(Array.from({ length: 20 }, () => accessToken()));
    expect(rajada.every((r) => r.status === "rejected")).toBe(true);
    expect(buscar).toHaveBeenCalledTimes(1);

    expect(await accessToken()).toBe("depois");
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it("recusa resposta 200 com corpo sem token", async () => {
    const buscar = vi.fn<typeof fetch>(async () => respostaOk({ erro: "limite_excedido" }));
    const accessToken = criarAccessTokenSupabase({ buscar });
    await expect(accessToken()).rejects.toThrow(/token/);
  });

  it("recusa 200 com `token: null` — o valor que não pode virar retorno", async () => {
    // Sem esta trava, um corpo com `token: null` viraria `return null` — a
    // saída destrutiva que o caso acima explica. O corpo malformado é o único
    // caminho por onde `null` chegaria ao chamador.
    const buscar = vi.fn<typeof fetch>(async () =>
      respostaOk({ token: null, expiraEm: agoraEmSegundos() + 300 })
    );
    const accessToken = criarAccessTokenSupabase({ buscar });
    await expect(accessToken()).rejects.toThrow(/token/);
  });

  it("recusa 200 sem `expiraEm` — sem validade, o cache seria eterno", async () => {
    const buscar = vi.fn<typeof fetch>(async () => respostaOk({ token: "t1" }));
    const accessToken = criarAccessTokenSupabase({ buscar });
    await expect(accessToken()).rejects.toThrow(/expiraEm/);
  });

  it("a rede caída sobe como rejeição, não vira token", async () => {
    // `fetch` rejeita em falha de rede em vez de devolver resposta. Se algum
    // `try/catch` engolisse isso para "ser educado", o retorno viraria
    // `undefined` — e `undefined` faz no realtime-js o mesmo estrago que
    // `null`.
    const buscar = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    const accessToken = criarAccessTokenSupabase({ buscar });

    await expect(accessToken()).rejects.toThrow(/Failed to fetch/);
  });
});

describe("os quatro modos de recusa da rota são todos 'sem token'", () => {
  // A Task 4 entregou a rota com QUATRO recusas, e nenhuma delas emite token:
  // 401 sessão inválida, 409 empresa ambígua, 429 teto de taxa, 503 falha
  // interna. Este bloco existe porque a diferença entre elas é uma armadilha:
  // 401 CONVIDA a mandar a pessoa para o login e 429 CONVIDA a tentar de novo,
  // e o 409 só se resolve com intervenção humana (uma conta vinculada a duas
  // empresas, sem seletor até o Ciclo 3) — reagir a ele com nova tentativa é
  // laço infinito por construção. A fábrica trata os quatro do mesmo jeito:
  // lança, uma busca por chamada, e quem decide tentar de novo é o heartbeat
  // de 25 s do realtime-js.
  const RECUSAS = [
    { status: 401, corpo: { erro: "nao_autenticado" }, nome: "sessão inválida" },
    { status: 409, corpo: { erro: "empresa_ambigua" }, nome: "empresa ambígua" },
    { status: 429, corpo: { erro: "limite_excedido" }, nome: "teto de taxa" },
    { status: 503, corpo: { erro: "indisponivel" }, nome: "falha interna" },
  ];

  it.each(RECUSAS)("$status ($nome): lança, e faz UMA busca só", async ({ status, corpo }) => {
    const buscar = vi.fn<typeof fetch>(async () => respostaDeErro(status, corpo));
    const accessToken = criarAccessTokenSupabase({ buscar });

    const desfecho = await accessToken().then(
      (valor) => ({ resolveu: true, valor }),
      (erro: unknown) => ({ resolveu: false, erro })
    );

    // Afirmado como desfecho, e não com `rejects.toThrow`: o que precisa ficar
    // provado é que NÃO existe caminho de resolução — nem com `null`, nem com
    // `undefined`, nem com o corpo de erro virando string.
    expect(desfecho.resolveu).toBe(false);
    expect(desfecho).not.toHaveProperty("valor");
    expect(String((desfecho as { erro: unknown }).erro)).toContain(String(status));
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it("o 409 repetido não acelera: uma busca por chamada, nunca um laço interno", async () => {
    // O caso que a Task 4 pediu por escrito. Se a fábrica tentasse de novo por
    // conta própria em cima de um 409, seria laço infinito: o defeito é uma
    // conta com dois vínculos, e nenhuma quantidade de tentativas muda isso.
    const buscar = vi.fn<typeof fetch>(async () =>
      respostaDeErro(409, { erro: "empresa_ambigua" })
    );
    const accessToken = criarAccessTokenSupabase({ buscar });

    for (let tentativa = 0; tentativa < 3; tentativa += 1) {
      await expect(accessToken()).rejects.toThrow(/409/);
    }

    expect(buscar).toHaveBeenCalledTimes(3);
  });

  it("o fonte não conhece código de status nenhum — não há como reagir a um", () => {
    // A trava da regra acima, e não uma repetição dela: os casos provam o
    // comportamento dos quatro códigos de HOJE; esta varredura impede que
    // alguém trate um deles à parte amanhã ("se for 401, redireciona"), o que
    // os casos existentes não pegariam. O fonte não cita 401, 409, 429 nem 503
    // fora de comentário.
    const fonte = semComentarios(readFileSync(ARQUIVO, "utf8"));

    for (const status of ["401", "409", "429", "503", "500", "200"]) {
      expect(fonte).not.toContain(status);
    }
  });

  it("o fonte não navega, não empurra a pessoa para o login e não toca o document", () => {
    const fonte = semComentarios(readFileSync(ARQUIVO, "utf8"));

    for (const proibido of ["window", "location", "document", "signIn", "signOut", "redirect"]) {
      expect(fonte).not.toContain(proibido);
    }
  });

  it("e o filtro de comentários morde: derruba a menção, mantém o código", () => {
    // Sem este par, um erro no removedor de comentários esvaziaria o texto
    // filtrado e as duas varreduras acima ficariam verdes para sempre sem ter
    // lido nada — e o JSDoc do próprio arquivo CITA "401", "409" e "window"
    // para explicar por que não reage a eles. Mesma armadilha registrada em
    // `rota-jwks.test.ts` e em `rota-token-supabase.test.ts`.
    const soMencao = [
      "/**",
      " * não reage a 401 nem toca window",
      " */",
      "export const x = 1;",
    ].join("\n");
    const codigoDeVerdade = `${soMencao}\nif (r.status === 401) window.alert("/login");`;

    expect(semComentarios(soMencao)).not.toContain("401");
    expect(semComentarios(soMencao)).not.toContain("window");
    expect(semComentarios(codigoDeVerdade)).toContain("401");
    expect(semComentarios(codigoDeVerdade)).toContain("window");
  });
});

describe("a empresa não passa por aqui", () => {
  it("a fábrica não tem por onde receber uma empresa", () => {
    // A trava que sustenta o Ciclo 3 inteiro mora em `route.ts`, que lê a
    // empresa de `usuarioAtual()` e não recebe a requisição. Esta fábrica roda
    // no NAVEGADOR: se ela aceitasse `companyId` como opção, o valor viajaria
    // do cliente para a rota e a trava de lá viraria decoração. Nenhuma
    // ocorrência do identificador, em nenhuma forma, fora de comentário.
    const fonte = semComentarios(readFileSync(ARQUIVO, "utf8"));

    expect(fonte).not.toMatch(/compan/i);
    expect(fonte).not.toMatch(/empresa/i);
  });

  it("a requisição não carrega nada além da URL fixa e do que o cookie precisa", async () => {
    const buscar = vi.fn<typeof fetch>(async () =>
      respostaOk({ token: "t1", expiraEm: agoraEmSegundos() + 300 })
    );
    const accessToken = criarAccessTokenSupabase({ buscar });
    await accessToken();

    const [url, init] = buscar.mock.calls[0];
    expect(url).toBe("/api/supabase/token");
    expect(URL_PADRAO).toBe("/api/supabase/token");
    // Sem query, sem corpo, sem cabeçalho de escopo: as únicas chaves são as
    // duas que fazem o cookie de sessão viajar e o JSON voltar. Uma chave nova
    // aqui é uma via nova de entrada do cliente, e reprova.
    expect(Object.keys(init ?? {}).sort()).toEqual(["credentials", "headers"]);
    expect((init as RequestInit).credentials).toBe("same-origin");
    expect(JSON.stringify(init)).not.toMatch(/compan/i);
  });

  it("a URL é substituível, e é a única coisa que o chamador escolhe", async () => {
    const buscar = vi.fn<typeof fetch>(async () =>
      respostaOk({ token: "t1", expiraEm: agoraEmSegundos() + 300 })
    );
    const accessToken = criarAccessTokenSupabase({ buscar, url: "/outra/rota" });
    await accessToken();

    expect(buscar.mock.calls[0][0]).toBe("/outra/rota");
  });
});

// ─── O grafo de imports: a chave privada não pode alcançar o navegador ───────
//
// `emitir.ts` tem `import "server-only"`, que faz o build FALHAR se ele entrar
// num bundle de cliente. Essa guarda protege quem o importa direto; ela não diz
// nada sobre uma cadeia de dois saltos, e o erro dela aparece no `next build`,
// não aqui. A varredura abaixo fecha o buraco no lugar barato.

type LerFonte = (arquivo: string) => string | null;

const PADROES_DE_IMPORT = [
  /\bimport\s[^;'"]*?\sfrom\s*["']([^"']+)["']/g,
  /\bexport\s[^;'"]*?\sfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];

function importesDe(fonte: string): string[] {
  const limpo = semComentarios(fonte);
  const achados = new Set<string>();

  for (const padrao of PADROES_DE_IMPORT) {
    for (const casamento of limpo.matchAll(padrao)) {
      achados.add(casamento[1]);
    }
  }

  return [...achados];
}

function resolver(especificador: string, deQuem: string): string | null {
  if (especificador.startsWith("@/")) {
    return `src/${especificador.slice(2)}`;
  }
  if (!especificador.startsWith(".")) {
    return null; // pacote: registrado pelo nome, não seguido
  }

  const pastas = deQuem.split("/").slice(0, -1);
  for (const parte of especificador.split("/")) {
    if (parte === "" || parte === ".") continue;
    if (parte === "..") pastas.pop();
    else pastas.push(parte);
  }
  return pastas.join("/");
}

/** Tudo o que `entrada` alcança, em qualquer profundidade. */
function alcancados(entrada: string, ler: LerFonte): Set<string> {
  const vistos = new Set<string>();
  const alcance = new Set<string>();
  const fila = [entrada];

  while (fila.length > 0) {
    const atual = fila.pop() as string;
    if (vistos.has(atual)) continue;
    vistos.add(atual);

    const fonte = ler(atual);
    if (fonte === null) continue;

    for (const especificador of importesDe(fonte)) {
      alcance.add(especificador);
      const destino = resolver(especificador, atual);
      if (destino !== null) {
        alcance.add(destino);
        fila.push(destino);
      }
    }
  }

  return alcance;
}

const lerDoDisco: LerFonte = (arquivo) => {
  for (const sufixo of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    try {
      return readFileSync(`${arquivo}${sufixo}`, "utf8");
    } catch {
      // próximo sufixo
    }
  }
  return null;
};

describe("o que este arquivo alcança", () => {
  const PROIBIDOS = [
    "supabase-jwt/emitir",
    "supabase-jwt/chave",
    "server-only",
    "jose",
    "next/headers",
    "lib/prisma",
    "@prisma/client",
  ];

  it("não alcança a chave privada, nem por caminho nenhum", () => {
    const alcance = [...alcancados(ARQUIVO, lerDoDisco)].join("\n");

    for (const proibido of PROIBIDOS) {
      expect(alcance).not.toContain(proibido);
    }
  });

  it("a varredura enxerga dois saltos — provado contra a rota de emissão", () => {
    // A prova de que a varredura acima morde, e feita contra arquivo REAL: a
    // rota importa `@/core/supabase-jwt/emitir` (um salto), que importa
    // `server-only` e `./chave` (dois saltos). Se o extrator de imports
    // quebrasse, o conjunto viria vazio e a trava ficaria verde para sempre sem
    // ter lido nada — a mesma armadilha que a Parte 3 de
    // `catraca-prisma-cru.test.ts` registra.
    const alcance = [...alcancados("src/app/api/supabase/token/route.ts", lerDoDisco)].join("\n");

    expect(alcance).toContain("src/core/supabase-jwt/emitir");
    expect(alcance).toContain("server-only");
    expect(alcance).toContain("src/core/supabase-jwt/chave");
  });

  it("a varredura não confunde menção em comentário com import", () => {
    const fontes: Record<string, string> = {
      "src/core/supabase-jwt/access-token.ts": [
        "// este arquivo não importa ./emitir nem server-only",
        'export const x = "nada";',
      ].join("\n"),
    };
    const ler: LerFonte = (arquivo) => fontes[arquivo] ?? fontes[`${arquivo}.ts`] ?? null;

    expect([...alcancados(ARQUIVO, ler)]).toEqual([]);
  });

  it("um `import type` também conta — ele é uma aresta que o bundler resolve", () => {
    const fontes: Record<string, string> = {
      "src/core/supabase-jwt/access-token.ts": 'import type { X } from "./emitir";',
    };
    const ler: LerFonte = (arquivo) => fontes[arquivo] ?? fontes[`${arquivo}.ts`] ?? null;

    expect([...alcancados(ARQUIVO, ler)].join("\n")).toContain("supabase-jwt/emitir");
  });
});

describe("o contrato com o supabase-js", () => {
  it("o valor da fábrica serve como opção `accessToken` do createClient", () => {
    // Afirmação de TIPO, verificada por `npm run typecheck` e não em tempo de
    // execução: se o supabase-js mudar a assinatura da opção, isto para de
    // compilar aqui, e não dois ciclos adiante dentro do `createClient`.
    const opcao: SupabaseClientOptions<"public">["accessToken"] = criarAccessTokenSupabase();

    expect(typeof opcao).toBe("function");
  });
});
