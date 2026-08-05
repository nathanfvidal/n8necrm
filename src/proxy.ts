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
export default auth(function proxy(req) {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === "/login";

  if (!isLoggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
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
   *   Evolution (`/api/whatsapp/evolution/[token]/route.ts`) é chamado pela
   *   própria Evolution, sem sessão de usuário nenhuma — sem esta exceção,
   *   este proxy redirecionaria toda chamada da Evolution para `/login`
   *   (confirmado empiricamente: `/api/whatsapp/evolution/tok123` batia no
   *   matcher ANTES desta exceção existir) e o bot nunca receberia mensagem
   *   nenhuma. A rota já se autentica sozinha (token no path comparado com
   *   `timingSafeEqual`, ver o comentário lá) — não depende deste proxy pra
   *   segurança. **Invariante que este subdiretório carrega**: tudo sob
   *   `/api/whatsapp/*` é público por definição, então toda rota nova
   *   criada ali precisa se autenticar sozinha, e NENHUMA rota que leia
   *   dado do CRM (lead, contato, conversa, etc.) pode morar ali — só
   *   ingestão/saída de WhatsApp.
   * - api/queues (mesma fatia): consumidor da fila
   *   (`/api/queues/whatsapp-turn/route.ts`), invocado pela infraestrutura
   *   de fila da Vercel, também sem sessão de usuário. Confirmado
   *   empiricamente que o proxy também interceptava este path antes desta
   *   exceção (mesmo teste de regex acima). Seguro mesmo sem token
   *   próprio — ao contrário de `/api/whatsapp/*`, este path não tem
   *   nenhum ponto de entrada alcançável de fora (não está atrás de nenhum
   *   link, formulário ou documentação pública; só a própria Vercel invoca
   *   -- ver plano da Fatia 1, seção "Verificação").
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
