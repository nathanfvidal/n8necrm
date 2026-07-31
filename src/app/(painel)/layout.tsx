import { redirect } from "next/navigation";

import { PainelNav } from "@/components/painel-nav";
import { usuarioAtual } from "@/core/auth/session";

/**
 * Layout do painel autenticado. Toda página sob `(painel)` — hoje só
 * `page.tsx`, mas também qualquer página que as Tasks 14-21 adicionarem
 * (lista de leads, kanban, dashboard, dados de contato) — passa por aqui.
 * É o ponto mais estreito que cobre TODA página protegida de uma vez, sem
 * precisar repetir a checagem em cada `page.tsx` nova.
 *
 * `/login` NÃO fica sob este layout — mora em `src/app/login/page.tsx`,
 * fora do route group `(painel)` (fix round 2/5; antes ficava em
 * `(painel)/login/page.tsx`). De propósito: se `/login` estivesse aninhada
 * aqui, um visitante sem sessão que abrisse `/login` cairia num loop (este
 * layout manda pra `/login`, que está sob o mesmo layout que manda de novo
 * pra `/login`, indefinidamente). A URL não muda — route groups não entram
 * no path — só o layout que envolve a página.
 *
 * Chama `usuarioAtual()` (não `auth()` direto) de propósito: `usuarioAtual`
 * já rejeita tanto "sem sessão" quanto "usuário desativado" (fix round
 * 1/5) com o mesmo erro — então este layout trata as duas situações de
 * forma idêntica, sem precisar saber que a segunda existe. Antes deste fix,
 * só as Server Actions (`src/core/leads/actions.ts`) chamavam
 * `usuarioAtual()`; alguém desativado com um cookie de sessão ainda válido
 * conseguia navegar (só leitura) por qualquer página do painel — inclusive
 * as que as Tasks 14-21 vão preencher com dado real de cliente (lista de
 * leads, telefone de contato, dashboard). `src/proxy.ts` não fecha esse gap
 * sozinho: ele só sabe se existe um JWT válido (`!!req.auth`), não se o
 * usuário continua ativo — ver o comentário em `proxy.ts` sobre por que essa
 * checagem não foi movida para lá.
 */
export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  try {
    await usuarioAtual();
  } catch {
    redirect("/login");
  }

  return (
    <div className="min-h-screen">
      <PainelNav />
      <main>{children}</main>
    </div>
  );
}
