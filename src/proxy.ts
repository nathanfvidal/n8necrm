import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";

/**
 * Proxy (nome do antigo "middleware" a partir do Next.js 16 — ver
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
 * O arquivo `middleware.ts` ainda funciona no Next 16, mas está marcado como
 * deprecated pelo próprio framework (aviso emitido em dev/build), então este
 * projeto novo já nasce usando a convenção atual: `src/proxy.ts` com export
 * default (nome interno da função como `proxy`, conforme recomendado nos docs).
 *
 * Superfície pública hoje: `/login`, `/api/auth/*`, `/api/whatsapp/*` e
 * `/api/queues/*` (as duas últimas chegaram na Fatia 1 do atendente de
 * WhatsApp — ver comentário mais abaixo, junto do `matcher`, sobre o que
 * cada uma significa e por que é segura sem sessão). `(painel)` e `(site)`
 * são route groups do App Router — não aparecem na URL. Por isso NÃO existe
 * rota `/site` para verificar aqui: as páginas públicas do site
 * institucional (grupo `(site)`) só chegam na Fase 2. Fora essas exceções
 * explícitas, toda a superfície do app (inclusive `/`) exige sessão.
 *
 * Quando a Fase 2 trouxer páginas em `(site)`, elas NÃO vão cair sob um
 * prefixo comum tipo `/site` (route groups não aparecem na URL) — então a
 * exceção terá que listar os paths públicos reais (ex.: `pathname === "/"`
 * só se for a landing pública, `pathname === "/sobre"` etc.), nunca um
 * `startsWith("/site")`. Essa foi a causa do bug original desta função: um
 * check que nunca podia ser verdadeiro e que só passava a falsa impressão
 * de existir uma exceção pública ativa.
 *
 * **Por que `isLoggedIn` não checa `User.ativo` (fix round 2/5):**
 * `isLoggedIn` só confirma que existe um JWT válido — não que o usuário
 * continua ativo, porque desativar alguém não invalida um cookie já
 * emitido (mesma causa raiz do fix round 1/5 em
 * `src/core/auth/session.ts#usuarioAtual`). Cogitamos consultar
 * `User.ativo` aqui também, e DESCARTAMOS, por dois motivos:
 *
 * 1. Ao contrário do que uma leitura rápida da documentação mais antiga do
 *    Next.js sugere, Proxy NÃO está preso ao runtime Edge nesta versão —
 *    "Proxy defaults to using the Node.js runtime" desde o v16
 *    (node_modules/next/dist/docs/.../file-conventions/proxy.md, seção
 *    "Runtime" e "Version history"). Então uma consulta ao Postgres via
 *    Prisma não quebraria por incompatibilidade de runtime só por rodar
 *    aqui — ao contrário do que se poderia supor por experiência com
 *    versões anteriores do Next.js (isto é exatamente o tipo de mudança
 *    que a AGENTS.md deste repo avisa para não presumir do treinamento).
 * 2. Mesmo assim, a própria doc do Proxy recomenda não depender de módulos
 *    ou globais compartilhados aqui ("Proxy is meant to be invoked
 *    separately of your render code and in optimized cases deployed to
 *    your CDN... you should not attempt relying on shared modules or
 *    globals") — o singleton do Prisma em `src/lib/prisma.ts`
 *    (`globalForPrisma`) é exatamente esse tipo de global, pensado para
 *    reuso de conexão dentro do runtime principal da aplicação, não para
 *    um ambiente que pode ser otimizado/distribuído separadamente. Somado
 *    a isso, o `matcher` abaixo roda em quase toda requisição — inclusive
 *    _next/data e qualquer navegação, não só páginas do painel — então uma
 *    query aqui custaria uma consulta ao banco por requisição roteada,
 *    não uma por página protegida renderizada.
 *
 * `(painel)/layout.tsx` fecha esse gap sozinho, de forma suficiente: TODA
 * página sob `(painel)` (presente e futura) passa por `usuarioAtual()`
 * antes de renderizar, e `/login` foi movida para fora desse layout
 * exatamente para não entrar nesse gate. `isLoggedIn` aqui continua
 * servindo de filtro barato e rápido — nenhuma requisição sem cookie
 * nenhum chega perto do layout/render — mas a palavra final sobre "esta
 * sessão ainda é válida" é do `usuarioAtual()` chamado no layout, não desta
 * função.
 *
 * **Por que esta função NÃO redireciona `isLoggedIn && isLoginPage` para
 * `/` (removido no fix round 2/5 — bug pego rodando HTTP de verdade, não
 * por leitura de código):** a primeira versão deste fix tinha essa regra
 * (poupa quem já está logado de ver o formulário de novo). Ela cria um
 * loop de redirecionamento infinito assim que existe uma sessão com JWT
 * válido mas usuário desativado: proxy vê `isLoggedIn: true` (JWT ainda
 * decodifica — desativação não invalida o cookie) e deixa passar; o layout
 * chama `usuarioAtual()`, que rejeita, e manda para `/login`; o proxy
 * intercepta essa NOVA requisição para `/login`, vê `isLoggedIn: true` de
 * novo (mesmo JWT) e manda de volta para `/`; o layout rejeita nesse `/`
 * de novo — infinito, sempre entre proxy e layout, nunca chega a renderizar
 * nada. Reproduzido ao vivo com `curl`/browser real contra
 * `vendedor@exemplo.com` desativado: `ERR_TOO_MANY_REDIRECTS`. A causa raiz
 * é a MESMA de não checar `ativo` aqui: este proxy não tem uma noção de
 * "logado" forte o bastante para decidir com segurança quando pular
 * `/login` — só quem chama `usuarioAtual()` tem. Por isso essa decisão foi
 * movida para dentro de `src/app/login/page.tsx` (Server Component): ele
 * chama `usuarioAtual()` e só redireciona para `/` quando ela resolve de
 * verdade — o mesmo critério do layout, sem duplicar uma versão mais fraca
 * aqui que pudesse discordar dele.
 */
/**
 * Monta o Content-Security-Policy da requisição, com um nonce novo a cada
 * chamada.
 *
 * ## Por que o nonce mora aqui e não em next.config.ts
 *
 * Um CSP fixo em `next.config.ts` só consegue liberar script inline com
 * `'unsafe-inline'`, que na prática desliga a proteção contra XSS — é
 * exatamente o que um script injetado precisa. O nonce é um valor
 * imprevisível gerado por requisição: o Next carimba ele nos próprios
 * scripts durante o SSR, e qualquer script que apareça na página sem esse
 * valor simplesmente não roda.
 *
 * ## As decisões que este CSP toma
 *
 * - **`style-src` com `'unsafe-inline'`.** Não é descuido. Sem
 *   `'unsafe-inline'`, o CSP bloqueia também atributo `style=""` inline
 *   (nonce não se aplica a atributo), e o quadro de funil escreve
 *   `style="transform: ..."` no card a cada frame do arraste — o kanban
 *   pararia de funcionar. CSS injetado é um vetor muito mais fraco que
 *   script injetado; a proteção que importa (`script-src`) segue estrita.
 * - **`'strict-dynamic'` só em produção.** Em desenvolvimento o React usa
 *   `eval` para reconstruir stack de erro do servidor no navegador, daí o
 *   `'unsafe-eval'` — que não vai para produção.
 * - **`connect-src 'self'`.** Chamadas à OpenAI e à Evolution saem do
 *   SERVIDOR, nunca do navegador. Se algum dia um script no cliente tentar
 *   mandar dado de lead para fora, o navegador barra.
 * - **`frame-src https://n8n.nateksoft.com`**: única origem que o CRM pode
 *   embutir num iframe — o editor do n8n em `/fluxos/[id]?aba=editar`. Não é
 *   o mesmo eixo de `frame-ancestors` logo abaixo: uma diretiva controla o
 *   que ESTE site pode embutir, a outra controla quem pode embutir ESTE
 *   site — as duas convivem porque respondem perguntas opostas.
 * - **`frame-ancestors 'none'`** e **`form-action 'self'`**: ninguém embute
 *   o CRM num iframe, e nenhum formulário daqui posta para fora — o que
 *   fecha o caminho de roubar credencial redirecionando o POST do login.
 * - **`object-src 'none'`** e **`base-uri 'self'`**: mata plugin legado e a
 *   injeção de `<base>`, que reescreveria o destino de todos os links
 *   relativos da página.
 */
function montarCsp(nonce: string): string {
  const ehDev = process.env.NODE_ENV === "development";

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${ehDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    // O editor do n8n é embutido num iframe na tela /fluxos. `frame-src` é a
    // diretiva que permite ISSO — não confundir com `frame-ancestors`, que diz
    // quem pode embutir O CRM e continua `'none'`.
    //
    // A origem é fixa e única de propósito: um `frame-src` amplo permitiria a
    // qualquer script já presente na página embutir conteúdo de terceiro.
    // `script-src` não é tocado.
    "frame-src https://n8n.nateksoft.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export default auth(function proxy(req) {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === "/login";

  const nonce = crypto.randomUUID();
  const csp = montarCsp(nonce);

  if (!isLoggedIn && !isLoginPage) {
    // O redirect também leva o CSP: a resposta 307 não renderiza HTML, mas
    // deixar um caminho sem header é o tipo de buraco que passa despercebido
    // se um dia ele passar a renderizar algo.
    const redirecionamento = NextResponse.redirect(new URL("/login", req.url));
    redirecionamento.headers.set("Content-Security-Policy", csp);
    return redirecionamento;
  }

  // `x-nonce` no header da REQUISIÇÃO é como o Next entrega o valor para o
  // render (Server Components leem via `headers()`); o CSP no header da
  // RESPOSTA é o que o navegador aplica. Os dois precisam carregar o mesmo
  // nonce — é dessa igualdade que a política inteira depende.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const resposta = NextResponse.next({ request: { headers: requestHeaders } });
  resposta.headers.set("Content-Security-Policy", csp);
  return resposta;
});

export const config = {
  /*
   * Roda em tudo, exceto:
   * - api/auth (e só api/auth): endpoints do Auth.js (signIn/callback/
   *   session/providers) — precisam ficar acessíveis sem sessão, senão o
   *   login nunca completa. O `(?:/|$)` depois de cada prefixo é
   *   obrigatório: sem ele, a alternativa do regex vira um prefix match
   *   literal, não um limite de segmento de path. "api/auth" sem essa
   *   âncora também "casa" com /api/authorize, /api/auth-debug,
   *   /api/authXYZ e /api/authentication/reset — nenhuma dessas é um
   *   endpoint do Auth.js, mas todas ficariam públicas por engano. Mesmo
   *   raciocínio aplicado a _next/static e _next/image por consistência.
   * - api/whatsapp (Fatia 1 do atendente de WhatsApp): o webhook público da
   *   Evolution (`/api/whatsapp/evolution/[companyId]/[token]/route.ts`) é
   *   chamado pela
   *   própria Evolution, sem sessão de usuário nenhuma — sem esta exceção,
   *   este proxy redirecionaria toda chamada da Evolution para `/login`
   *   (confirmado empiricamente: `/api/whatsapp/evolution/tok123` batia no
   *   matcher ANTES desta exceção existir) e o bot nunca receberia mensagem
   *   nenhuma. A rota já se autentica sozinha (token no path resolvido como
   *   `sha256` contra `WhatsappConnection.webhookTokenHash` desde o Ciclo 2a,
   *   ver o comentário lá) — não depende deste proxy pra
   *   segurança. **Invariante que este subdiretório carrega**: tudo sob
   *   `/api/whatsapp/*` é público por definição, então toda rota nova
   *   criada ali precisa se autenticar sozinha, e NENHUMA rota que leia
   *   dado do CRM (lead, contato, conversa, etc.) pode morar ali — só
   *   ingestão/saída de WhatsApp.
   * - api/queues: o TICK da fila (`/api/queues/whatsapp-turn/route.ts`), que
   *   drena os turnos pendentes. Não tem sessão de usuário. Confirmado
   *   empiricamente que o proxy também interceptava este path antes desta
   *   exceção (mesmo teste de regex acima). Até o Ciclo 2d ele era um
   *   consumidor de push do Vercel Queues e a garantia era de REDE — a
   *   plataforma mantinha a rota air-gapped da internet, e este comentário
   *   dizia que "só a própria Vercel invoca". Fora da Vercel essa garantia não
   *   existe mais, e a frase teria virado mentira no mesmo commit. Hoje a rota
   *   **se autentica sozinha**, com um segredo em cabeçalho comparado em tempo
   *   constante (`@/lib/segredo`), e responde 404 a quem não tem — mesma
   *   resposta que o webhook dá, pelo mesmo motivo.
   *
   *   **Invariante que este subdiretório passa a carregar**, igual ao de
   *   `/api/whatsapp/*`: tudo sob `/api/queues/*` é público por definição, e
   *   toda rota nova criada ali precisa se autenticar sozinha.
   * - _next/static, _next/image: assets internos do Next.
   * - arquivos estáticos de primeiro nível (favicon.ico, public/*.svg
   *   etc.): usa `[^/]+\.ext$`, não `.*\.ext$`. `.*` combina com qualquer
   *   profundidade de path, então `.*\.xml$` também exclui rotas de
   *   aplicação que só por acaso terminam nessa extensão — ex.:
   *   /painel/vendas/1/nota-fiscal.xml (download de NF-e) ou
   *   /leads/relatorio.txt (export da Task 21) ficariam sem proteção
   *   nenhuma. `[^/]+` proíbe barra no meio, então só casa com um nome de
   *   arquivo direto na raiz (como os assets hoje em `public/`), nunca com
   *   um path de rota aninhado. Se algum dia existir asset estático
   *   público dentro de uma subpasta, essa exceção precisa ser revista
   *   explicitamente — o padrão aqui erra propositalmente para o lado de
   *   proteger demais, não de menos.
   */
  matcher: [
    "/((?!api/auth(?:/|$)|api/whatsapp(?:/|$)|api/queues(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|[^/]+\\.(?:ico|png|jpg|jpeg|gif|svg|webp|css|js|txt|xml|woff|woff2)$).*)",
  ],
};
