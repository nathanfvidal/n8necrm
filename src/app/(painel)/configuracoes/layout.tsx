import Link from "next/link";

import { usuarioAtualOuLogin } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";

/**
 * A régua de seções de Configurações.
 *
 * ## Uma seção só, e isso é andaime declarado
 *
 * Hoje existe "Conexões" e mais nada. A régua existe assim mesmo porque é onde
 * a marca por empresa (dívida D3 do Ciclo 1c — "`modulos` fica editável por
 * SQL e por mais nada") e a Meta Cloud API (Ciclo 2b) entram sem reescrever
 * rota. A alternativa — `/configuracoes` SER a tela de conexões — obrigaria a
 * mudar a URL no dia da segunda seção, e URL de tela de administração é coisa
 * que gente salva nos favoritos.
 *
 * ## Este layout NÃO é o portão
 *
 * Ele resolve a sessão (que `(painel)/layout.tsx` já garantiu) e monta os
 * links. Quem barra é cada `page.tsx` e, de verdade, cada Server Action — que
 * vale mesmo para um POST que nunca passou por tela nenhuma. Os casos de
 * `tests/unit/configuracoes-pages-gate.test.tsx` exercitam o portão das
 * páginas; os de `tests/unit/conexoes-actions.test.ts`, o das actions.
 *
 * `usuarioAtualOuLogin()` e não `usuarioAtual()`: o Next renderiza layout e
 * página em PARALELO, então uma sessão que morre no meio alcança este arquivo
 * mesmo com o layout de cima já a caminho do redirecionamento — o docstring
 * de `core/auth/session.ts` tem o caso registrado pelo Sentry.
 */
export default async function ConfiguracoesLayout({ children }: { children: React.ReactNode }) {
  const usuario = await usuarioAtualOuLogin();

  const secoes = [
    ...(hasPermission(usuario.papel, "gerenciar_conexoes")
      ? [{ href: "/configuracoes/conexoes", label: "Conexões" }]
      : []),
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Configurações</h1>
        <p className="text-sm text-muted-foreground">Ajustes de administração desta empresa.</p>
      </div>

      {secoes.length > 0 ? (
        <nav className="flex gap-1 border-b" aria-label="Seções de configuração">
          {secoes.map((secao) => (
            <Link
              key={secao.href}
              href={secao.href}
              // `prefetch={false}` NÃO é detalhe de performance aqui: é a
              // correção de segurança do logout (AGENTS.md). Esta régua vive na
              // MESMA tela que o botão "Sair", e o padrão do `<Link>` — `auto`,
              // node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md
              // §prefetch — pré-busca a rota dinâmica até o `loading.js` mais
              // próximo assim que o link entra na viewport. `(painel)/loading.tsx`
              // existe, então essa pré-busca ACONTECE, bate no servidor com o
              // cookie de sessão e o Auth.js o reemite; a resposta que chega
              // depois do "Sair" ressuscita a sessão que acabou de ser revogada.
              // Foi exatamente o defeito de `0a81737`, e esta régua tinha ficado
              // de fora dele. Quem cobra agora é
              // `tests/unit/prefetch-do-painel.test.ts`.
              prefetch={false}
              className="rounded-t-md px-3 py-2 text-sm hover:bg-muted"
            >
              {secao.label}
            </Link>
          ))}
        </nav>
      ) : null}

      {children}
    </div>
  );
}
