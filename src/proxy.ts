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
 * Superfície pública hoje (Fase 0-1): apenas `/login` e `/api/auth/*`.
 * `(painel)` e `(site)` são route groups do App Router — não aparecem na URL.
 * Por isso NÃO existe rota `/site` para verificar aqui: as páginas públicas
 * do site institucional (grupo `(site)`) só chegam na Fase 2. Até lá, toda a
 * superfície do app (inclusive `/`) exige sessão, exceto a página de login e
 * os endpoints do Auth.js.
 *
 * Quando a Fase 2 trouxer páginas em `(site)`, elas NÃO vão cair sob um
 * prefixo comum tipo `/site` (route groups não aparecem na URL) — então a
 * exceção terá que listar os paths públicos reais (ex.: `pathname === "/"`
 * só se for a landing pública, `pathname === "/sobre"` etc.), nunca um
 * `startsWith("/site")`. Essa foi a causa do bug original desta função: um
 * check que nunca podia ser verdadeiro e que só passava a falsa impressão
 * de existir uma exceção pública ativa.
 */
export default auth(function proxy(req) {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === "/login";

  if (!isLoggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/", req.url));
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
    "/((?!api/auth(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|[^/]+\\.(?:ico|png|jpg|jpeg|gif|svg|webp|css|js|txt|xml|woff|woff2)$).*)",
  ],
};
