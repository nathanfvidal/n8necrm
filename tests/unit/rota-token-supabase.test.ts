import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { decodeJwt, importJWK, jwtVerify, type JWK } from "jose";

import { semComentarios } from "./helpers/codigo-fonte";

/**
 * Trava a única coisa que faz o Ciclo 1b valer alguma coisa: **quem escolhe a
 * empresa que vai dentro do token**.
 *
 * `emitirTokenSupabase` é primitiva — ela assina o `companyId` que receber, e o
 * JSDoc dela diz isso com todas as letras. As políticas RLS do Ciclo 3 leem
 * `auth.jwt() ->> 'company_id'` e confiam. Logo, se o cliente conseguir
 * influenciar esse valor por qualquer canal, o RLS inteiro vira decoração:
 * qualquer pessoa autenticada pede um token com o `company_id` alheio e lê
 * tudo. É a mesma forma de defeito que o Ciclo 1a fechou em `redefinirSenha`
 * (id do ALVO vindo do cliente, tomada de conta entre empresas), com aposta
 * maior.
 *
 * Um route handler tem exatamente DOIS canais por onde entrada do cliente
 * chega, e cada um tem caso próprio aqui:
 *
 * 1. **o parâmetro** (`Request`/`NextRequest`) — `GET.length === 0`, e mais um
 *    caso que CHAMA `GET` com uma requisição forjada carregando `companyId` em
 *    query, corpo e cabeçalho ao mesmo tempo, provando que nada dela é lido;
 * 2. **o ambiente** (`cookies()`, `headers()`, `draftMode()` de `next/headers`)
 *    — que não chega por parâmetro e que nenhum caso de comportamento desta
 *    suíte alcançaria. Esse é travado sobre o TEXTO do arquivo, mesmo padrão e
 *    mesmo motivo de `tests/unit/rota-jwks.test.ts`.
 *
 * Nenhum caso usa segredo real: o par de chaves nasce em memória a cada caso,
 * pelo mesmo `gerarParDeChaves()` que `supabase-jwt-emitir.test.ts` usa. E
 * nenhuma asserção sobre o `company_id` sai de `decodeJwt` sozinho — a leitura
 * é feita VERIFICANDO a assinatura com a chave pública, do jeito que o Supabase
 * faria, contra literais escritos aqui. O valor esperado nunca é calculado pelo
 * mesmo caminho que o código usa para produzi-lo.
 */

// `route.ts` alcança `core/supabase-jwt/emitir.ts`, que carrega `server-only` —
// guarda deliberada daquele arquivo, que lança fora do bundler do Next.
vi.mock("server-only", () => ({}));

const usuarioAtualMock = vi.fn();
vi.mock("@/core/auth/session", () => ({ usuarioAtual: () => usuarioAtualMock() }));

// O limiter real importa `@/lib/prisma`, que instancia o `PrismaClient` no topo
// do arquivo. Sem este mock, esta suíte de teste unitário passaria a exigir
// `DATABASE_URL` e a falar com o Postgres de desenvolvimento.
const checarRateLimitMock = vi.fn();
vi.mock("@/core/rate-limit/limiter", () => ({
  checarRateLimit: (chave: string, limite: number, janela: number) =>
    checarRateLimitMock(chave, limite, janela),
}));

const VARIAVEIS = ["SUPABASE_JWT_PRIVATE_JWK", "SUPABASE_JWT_ISSUER"] as const;
const guardadas: Record<string, string | undefined> = {};

const ISSUER = "https://crm.teste.invalid";
const ALGORITMO = "ES256";

const USUARIO = {
  id: "user-da-sessao",
  nome: "Quem Age",
  email: "quem@teste.invalid",
  ativo: true,
  companyId: "empresa-da-sessao",
  papel: "ADMIN" as const,
};

/** O valor que o cliente TENTA impor, por todos os canais que existem. */
const EMPRESA_ALHEIA = "empresa-alheia";

let publico: JWK;

beforeEach(async () => {
  vi.resetModules();
  usuarioAtualMock.mockReset();
  checarRateLimitMock.mockReset().mockResolvedValue(true);

  for (const nome of VARIAVEIS) guardadas[nome] = process.env[nome];

  const { gerarParDeChaves } = await import("@/core/supabase-jwt/chave");
  const par = await gerarParDeChaves();
  publico = par.publico;
  process.env.SUPABASE_JWT_PRIVATE_JWK = JSON.stringify(par.privado);
  process.env.SUPABASE_JWT_ISSUER = ISSUER;

  // `chave.ts` memoiza a chave lida em escopo de módulo. Sem este segundo
  // reset, a rota importada a seguir seria a instância que já leu o ambiente
  // ANTERIOR — e o par gerado acima nunca seria o que assina.
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const nome of VARIAVEIS) {
    if (guardadas[nome] === undefined) delete process.env[nome];
    else process.env[nome] = guardadas[nome];
  }
});

/**
 * Lê o payload VERIFICANDO a assinatura com a chave pública e conferindo o
 * issuer — não com `decodeJwt`, que aceitaria qualquer coisa com três pontos.
 * É o oráculo independente: quem verifica aqui não é o código que emitiu.
 */
async function payloadVerificado(token: string) {
  const { payload } = await jwtVerify(token, await importJWK(publico, ALGORITMO), {
    issuer: ISSUER,
  });
  return payload;
}

describe("a empresa vem da SESSÃO, e de mais lugar nenhum", () => {
  it("emite o company_id da sessão, com assinatura que a chave pública verifica", async () => {
    usuarioAtualMock.mockResolvedValue(USUARIO);
    const { GET } = await import("@/app/api/supabase/token/route");

    const resposta = await GET();
    expect(resposta.status).toBe(200);

    const { token, expiraEm } = await resposta.json();
    const payload = await payloadVerificado(token);

    expect(payload.company_id).toBe("empresa-da-sessao");
    expect(payload.sub).toBe("user-da-sessao");
    // `expiraEm` no corpo existe para o cliente não precisar decodificar o JWT
    // no navegador só para saber quando renovar. Ele tem que ser o MESMO `exp`
    // do token — se divergir, o cliente renova cedo demais (desperdício) ou
    // tarde demais (canal cai), e nada acusa.
    expect(expiraEm).toBe(payload.exp);
  });

  it("troca a sessão, troca a empresa — o valor SEGUE quem está logado", async () => {
    // Duas sessões diferentes no mesmo processo, com a mesma requisição (isto
    // é, nenhuma). Se algum dia o `company_id` passar a vir de configuração,
    // de constante ou de `prisma.company.findFirst()`, os dois tokens saem
    // iguais e este caso fica vermelho. Um caso só não distingue "leu a sessão"
    // de "leu um valor fixo que por acaso bate".
    usuarioAtualMock.mockResolvedValueOnce(USUARIO);
    const { GET } = await import("@/app/api/supabase/token/route");
    const primeiro = await (await GET()).json();

    usuarioAtualMock.mockResolvedValueOnce({
      ...USUARIO,
      id: "outro-usuario",
      companyId: "empresa-do-outro",
    });
    const segundo = await (await GET()).json();

    expect((await payloadVerificado(primeiro.token)).company_id).toBe("empresa-da-sessao");
    expect((await payloadVerificado(segundo.token)).company_id).toBe("empresa-do-outro");
    expect((await payloadVerificado(segundo.token)).sub).toBe("outro-usuario");
  });

  it("a assinatura de GET não aceita Request — não existe parâmetro a forjar", async () => {
    usuarioAtualMock.mockResolvedValue(USUARIO);
    const rota = await import("@/app/api/supabase/token/route");

    // `Function.length` conta os parâmetros declarados. Zero é a garantia
    // MECÂNICA de que não há requisição no escopo do handler de onde ler query,
    // corpo ou cabeçalho. Acrescentar `req` "só para logar o IP" deixa este
    // caso vermelho, que é o momento certo de discutir.
    expect(rota.GET.length).toBe(0);
  });

  it("chamada COM uma requisição forjada, o token continua sendo o da sessão", async () => {
    usuarioAtualMock.mockResolvedValue(USUARIO);
    const { GET } = await import("@/app/api/supabase/token/route");

    // Os três vetores de uma vez: query, corpo e cabeçalho. O caso acima prova
    // que o parâmetro não existe; este prova o que acontece quando alguém o
    // passa mesmo assim — que é nada. Os dois juntos cobrem tanto "o desenho
    // está certo" quanto "o desenho vale em execução".
    const forjada = new Request(
      `https://crm.teste.invalid/api/supabase/token?companyId=${EMPRESA_ALHEIA}&company_id=${EMPRESA_ALHEIA}`,
      {
        method: "GET",
        headers: { "x-company-id": EMPRESA_ALHEIA, cookie: `companyId=${EMPRESA_ALHEIA}` },
      }
    );

    const chamarComRequisicao = GET as unknown as (req: Request) => Promise<Response>;
    const resposta = await chamarComRequisicao(forjada);
    const texto = await resposta.text();

    expect(resposta.status).toBe(200);
    // Sobre o TEXTO da resposta: se `empresa-alheia` aparecer em qualquer lugar
    // do corpo, alguma coisa da requisição foi lida e ecoada.
    expect(texto).not.toContain(EMPRESA_ALHEIA);

    const payload = await payloadVerificado(JSON.parse(texto).token);
    expect(payload.company_id).toBe("empresa-da-sessao");
  });

  it("o fonte não importa next/headers — a via de entrada que o parâmetro não cobre", async () => {
    // Asserção sobre o TEXTO do arquivo, e não sobre comportamento: `cookies()`
    // e `headers()` são AMBIENTE, não chegam por parâmetro, e fora do runtime
    // do Next ler cookie aqui nem falharia de forma visível — nenhum caso desta
    // suíte observaria a diferença. Sem esta trava, `GET.length === 0` daria
    // uma sensação de garantia que não cobre metade da superfície.
    //
    // A sessão CHEGA por esse mesmo mecanismo, mas um salto acima: quem lê o
    // cookie é `auth()`, dentro de `usuarioAtual()`, que devolve a empresa já
    // resolvida no servidor. A rota nunca toca o cookie.
    const fonte = semComentarios(readFileSync("src/app/api/supabase/token/route.ts", "utf8"));
    expect(fonte).not.toContain("next/headers");
  });

  it("e o filtro de comentários morde: derruba a menção, mantém o import", () => {
    // Sem este par, um erro no removedor de comentários esvaziaria o texto
    // filtrado e a trava acima ficaria verde para sempre sem ter lido nada — e
    // o JSDoc da própria rota MENCIONA `next/headers` para explicar por que não
    // o usa. Mesma armadilha registrada em `rota-jwks.test.ts`.
    const soMencao = ['/**', " * a rota não importa next/headers", " */", "export const x = 1;"].join(
      "\n"
    );
    const importDeVerdade = `${soMencao}\nimport { cookies } from "next/headers";`;

    expect(semComentarios(soMencao)).not.toContain("next/headers");
    expect(semComentarios(importDeVerdade)).toContain("next/headers");
  });
});

describe("quando a sessão não resolve, ninguém sai com token", () => {
  it("sessão inválida responde 401 e o corpo não tem token", async () => {
    // A MESMA `Error("Não autenticado")` que `usuarioAtual()` lança para sessão
    // ausente, usuário desativado e conta sem vínculo — indistinguíveis por
    // decisão daquele helper, e reconhecidas por `ehSessaoInvalida`, a única
    // comparação com essa string do lado do servidor (`src/lib/acao.ts`).
    usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));
    const { GET } = await import("@/app/api/supabase/token/route");
    const resposta = await GET();

    expect(resposta.status).toBe(401);
    expect(await resposta.text()).not.toContain("token");
  });

  it("empresa ambígua NÃO vira 401 — e continua sem token", async () => {
    const avisos = vi.spyOn(console, "warn").mockImplementation(() => {});

    // `EmpresaAmbiguaError` precisa vir da MESMA instância de módulo que a rota
    // carregou: `vi.resetModules()` no `beforeEach` cria identidades novas, e um
    // `instanceof` contra a classe de outra instância é sempre falso. Por isso
    // este import é dinâmico e vem antes do da rota.
    const { EmpresaAmbiguaError } = await import("@/core/auth/usuario-ativo");
    usuarioAtualMock.mockRejectedValue(new EmpresaAmbiguaError(2));
    const { GET } = await import("@/app/api/supabase/token/route");
    const resposta = await GET();

    // 409 e não 401 porque a sessão é LEGÍTIMA: o que falta é a aplicação saber
    // qual empresa servir. `core/auth/usuario-ativo.ts` separa os dois casos de
    // propósito e explica por quê — tratá-los como o mesmo mandaria a pessoa
    // para o login num laço, sem nunca dizer o que está errado.
    //
    // O que importa para a segurança é o resto da linha: com duas empresas
    // possíveis, escolher uma seria inventar escopo. Nenhum token sai daqui.
    expect(resposta.status).toBe(409);
    expect(await resposta.text()).not.toContain("token");
    expect(avisos).toHaveBeenCalled();
  });

  it("falha inesperada responde 503, loga no servidor e não vaza o detalhe", async () => {
    const erros = vi.spyOn(console, "error").mockImplementation(() => {});

    // Banco fora do ar dentro de `usuarioAtual()` (ele faz `findUniqueOrThrow`).
    // Responder 401 aqui seria mentir: quem chama trataria indisponibilidade
    // como "faça login de novo", e o login também estaria fora do ar.
    const detalhe = "Can't reach database server at aws-0-sa-east-1.pooler.supabase.com:6543";
    usuarioAtualMock.mockRejectedValue(new Error(detalhe));
    const { GET } = await import("@/app/api/supabase/token/route");
    const resposta = await GET();

    expect(resposta.status).toBe(503);
    const texto = await resposta.text();
    expect(texto).not.toContain("token");
    // Padrão dos irmãos (`modules/automation/actions.ts`): detalhe no log do
    // servidor, mensagem genérica para quem pediu. O host do banco não é
    // informação de cliente.
    expect(texto).not.toContain("supabase.com");
    expect(erros).toHaveBeenCalled();
  });
});

describe("teto de taxa", () => {
  it("os valores publicados são os do desenho", async () => {
    const rota = await import("@/app/api/supabase/token/route");

    // 120 por 5 minutos. O uso legítimo consome ~1,25 por janela por aba (token
    // de 300 s, margem de renovação de 60 s), então 120 cabe dez abas com folga
    // de ordem de grandeza. Encolher isto sem refazer a conta derruba o Realtime
    // de quem só deixou abas abertas.
    expect(rota.LIMITE_POR_JANELA).toBe(120);
    expect(rota.JANELA_MS).toBe(300_000);
  });

  it("a chave é o id do usuário, não o IP", async () => {
    usuarioAtualMock.mockResolvedValue(USUARIO);
    const { GET, LIMITE_POR_JANELA, JANELA_MS } = await import(
      "@/app/api/supabase/token/route"
    );
    await GET();

    // Por usuário e não por IP de propósito: um escritório inteiro atrás de um
    // NAT dividiria o orçamento e derrubaria o canal de quem não fez nada. O id
    // do usuário só existe DEPOIS da sessão resolver — mais uma consequência de
    // a rota não ler a requisição.
    expect(checarRateLimitMock).toHaveBeenCalledWith(
      `jwt-supabase:${USUARIO.id}`,
      LIMITE_POR_JANELA,
      JANELA_MS
    );
  });

  it("estourado, responde 429 e o corpo não tem token", async () => {
    const avisos = vi.spyOn(console, "warn").mockImplementation(() => {});
    usuarioAtualMock.mockResolvedValue(USUARIO);
    checarRateLimitMock.mockResolvedValue(false);
    const { GET } = await import("@/app/api/supabase/token/route");
    const resposta = await GET();

    // Um 429 que ainda emite é teatro.
    expect(resposta.status).toBe(429);
    expect(await resposta.text()).not.toContain("token");
    expect(avisos).toHaveBeenCalled();
  });

  it("limiter que LANÇA não emite token — falha fechada", async () => {
    const erros = vi.spyOn(console, "error").mockImplementation(() => {});
    usuarioAtualMock.mockResolvedValue(USUARIO);
    checarRateLimitMock.mockRejectedValue(new Error("relation \"RateLimit\" does not exist"));
    const { GET } = await import("@/app/api/supabase/token/route");
    const resposta = await GET();

    // Se o contador cai, o teto some. Emitir mesmo assim transformaria uma
    // falha de infraestrutura em "endpoint que minta credencial sem limite" —
    // exatamente o cenário que o teto existe para fechar.
    expect(resposta.status).toBe(503);
    expect(await resposta.text()).not.toContain("token");
    expect(erros).toHaveBeenCalled();
  });
});

describe("a resposta é credencial portadora", () => {
  it("nunca é cacheada, em NENHUM dos caminhos", async () => {
    const avisos = vi.spyOn(console, "warn").mockImplementation(() => {});
    const erros = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/supabase/token/route");

    // O 200 é o que importa — corpo com token em cache compartilhado é
    // credencial de outra pessoa. Os outros caminhos entram junto porque um
    // `no-store` colocado só no caminho feliz é o tipo de coisa que se perde na
    // primeira refatoração, e porque 401 e 429 também variam por sessão.
    usuarioAtualMock.mockResolvedValue(USUARIO);
    expect((await GET()).headers.get("cache-control")).toBe("no-store");

    checarRateLimitMock.mockResolvedValue(false);
    expect((await GET()).headers.get("cache-control")).toBe("no-store");

    checarRateLimitMock.mockResolvedValue(true);
    usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));
    expect((await GET()).headers.get("cache-control")).toBe("no-store");

    usuarioAtualMock.mockRejectedValue(new Error("qualquer outra coisa"));
    expect((await GET()).headers.get("cache-control")).toBe("no-store");

    expect(avisos).toHaveBeenCalled();
    expect(erros).toHaveBeenCalled();
  });

  it("é servida como JSON", async () => {
    usuarioAtualMock.mockResolvedValue(USUARIO);
    const { GET } = await import("@/app/api/supabase/token/route");
    expect((await GET()).headers.get("content-type")).toBe("application/json");
  });

  it("é dinâmica — senão o build avalia a rota sem a chave e cai", async () => {
    // Mesmo modo de falha documentado em `modules/whatsapp/gateway/index.ts`,
    // que derrubou o deploy por três dias em 2026-08-07. Um handler que não lê
    // a requisição é justamente o que o Next se sente livre para avaliar em
    // tempo de build.
    const rota = await import("@/app/api/supabase/token/route");
    expect(rota.dynamic).toBe("force-dynamic");
  });

  it("o import da rota não lança com o ambiente VAZIO", async () => {
    // A prova de que a leitura da chave e do issuer é preguiçosa por ESTE
    // caminho também. Validação em escopo de módulo passaria em todo caso acima
    // (que roda com o ambiente preenchido) e só apareceria no `next build`.
    for (const nome of VARIAVEIS) delete process.env[nome];
    vi.resetModules();
    await expect(import("@/app/api/supabase/token/route")).resolves.toBeDefined();
  });

  it("sem chave configurada responde 503 sem nomear a variável de ambiente", async () => {
    const erros = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const nome of VARIAVEIS) delete process.env[nome];
    vi.resetModules();

    usuarioAtualMock.mockResolvedValue(USUARIO);
    const { GET } = await import("@/app/api/supabase/token/route");
    const resposta = await GET();
    const texto = await resposta.text();

    expect(resposta.status).toBe(503);
    // A mensagem de `chave.ts` nomeia a variável e o formato dela: informação
    // de operação, útil no log, inútil e indiscreta para quem chamou.
    expect(texto).not.toContain("SUPABASE_JWT_PRIVATE_JWK");
    expect(texto).not.toContain("token");
    expect(erros).toHaveBeenCalled();
  });
});

describe("o oráculo desta suíte não é o código sob teste", () => {
  it("um token assinado por OUTRA chave é recusado pela verificação", async () => {
    usuarioAtualMock.mockResolvedValue(USUARIO);
    const { GET } = await import("@/app/api/supabase/token/route");
    const { token } = await (await GET()).json();

    // Se `payloadVerificado` aceitasse qualquer coisa, todo caso de
    // `company_id` acima estaria afirmando o resultado de `decodeJwt`, que não
    // verifica nada. Este caso prova que a verificação morde.
    const { gerarParDeChaves } = await import("@/core/supabase-jwt/chave");
    const intruso = await gerarParDeChaves();
    const chaveErrada = await importJWK(intruso.publico, ALGORITMO);

    await expect(jwtVerify(token, chaveErrada, { issuer: ISSUER })).rejects.toThrow();
    // E o token é bem-formado — a rejeição acima é da assinatura, não de lixo.
    expect(decodeJwt(token).company_id).toBe("empresa-da-sessao");
  });
});
