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
   * - api/auth: endpoints do Auth.js (signIn/callback/session/providers) —
   *   precisam ficar acessíveis sem sessão, senão o login nunca completa.
   * - _next/static, _next/image: assets internos do Next.
   * - arquivos estáticos comuns (favicon.ico, public/*.svg etc.) — sem essa
   *   exclusão por extensão, um pedido não autenticado a /next.svg ou
   *   /favicon.ico seria redirecionado para /login em vez de servir o
   *   arquivo, já que route groups não filtram esses caminhos.
   */
  matcher: [
    "/((?!api/auth|_next/static|_next/image|.*\\.(?:ico|png|jpg|jpeg|gif|svg|webp|css|js|txt|xml|woff|woff2)$).*)",
  ],
};
