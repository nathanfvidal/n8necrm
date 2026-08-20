import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ThemeProvider } from "next-themes";

import { PainelNav } from "@/components/painel-nav";
import { usuarioAtual } from "@/core/auth/session";
import { listarNotificacoesNaoLidas } from "@/core/notifications/dispatch";
import { apresentarNotificacoes } from "./apresentar-notificacoes";

/**
 * Força renderização dinâmica em TODA página sob este layout — segment
 * config em layout se propaga para as rotas filhas. Sem isso, `next build`
 * tenta pré-renderizar páginas protegidas como estáticas: a Vercel expôs
 * isso (ambiente local mascarava o problema por acaso conseguir alcançar o
 * banco em build-time). Duas consequências reais, não só o build quebrar:
 * (1) o build faria uma chamada ao banco sem contexto de usuário algum,
 * e (2) se a chamada tivesse sucesso, a página ficaria "congelada" com o
 * dado daquele instante do deploy — todo visitante veria a mesma foto
 * antiga do funil/dashboard/leads, não o dado ao vivo por sessão.
 */
export const dynamic = "force-dynamic";

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
 *
 * Task 19: também busca as notificações não lidas de `usuario` para o sino
 * de `PainelNav`. Decisão deliberada de custo — uma consulta extra
 * (`Notification.findMany`) em TODA navegação sob este layout, ou seja, em
 * toda página do painel:
 * - Reaproveita o `usuario` que `usuarioAtual()` já resolveu para checar a
 *   sessão (uma consulta a `User` que já acontecia aqui de qualquer forma)
 *   em vez de o sino (ou `PainelNav`) buscar a sessão de novo — a consulta
 *   nova é só a de `Notification`, não duas.
 * - `Notification` ganhou `@@index([userId, lidaEm])` (prisma/schema.prisma)
 *   junto com esta task, exatamente para esta consulta: sem índice, `WHERE
 *   userId = ? AND lidaEm IS NULL` vira sequential scan à medida que a
 *   tabela cresce (toda criação de lead grava uma linha nova, e linhas lidas
 *   nunca são apagadas) — com o índice, é uma busca direta.
 * - Alternativa descartada: mover a busca para dentro de `NotificationBell`
 *   como um Server Component próprio (padrão "ilha", que só aquele pedaço
 *   busca dado, sem o resto do layout esperar por ele). Isso pediria
 *   `<Suspense>` ao redor do sino para não bloquear a navegação nesta fase,
 *   mais uma segunda chamada a `usuarioAtual()`/`User` (o sino não tem
 *   acesso ao `usuario` já resolvido aqui) — complexidade que não se paga
 *   para uma tabela pequena numa CRM de equipe pequena (Fase 0-1). Se o
 *   volume de notificações crescer a ponto de a consulta pesar na
 *   navegação, essa é a próxima mudança a fazer — não algo para antecipar
 *   agora sem dado que justifique.
 */
export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  let usuario;
  try {
    usuario = await usuarioAtual();
  } catch {
    redirect("/login");
  }

  // Traduzido AQUI, não dentro do sino: `apresentarNotificacoes` é o único
  // ponto do código que conhece os tipos de notificação de todos os módulos,
  // e ele mora na raiz de composição de propósito — ver o comentário em
  // `apresentar-notificacoes.ts` sobre o acoplamento que isso desfaz.
  const notificacoesNaoLidas = apresentarNotificacoes(
    await listarNotificacoesNaoLidas(usuario.companyId, usuario.id)
  );

  // `headers()` é assíncrona no Next 16. Ler o nonce aqui não custa nada:
  // este layout já é `force-dynamic`. Na raiz, tornaria TODA rota dinâmica
  // para servir um recurso que só o painel usa. `src/proxy.ts` grava o
  // mesmo valor no header `Content-Security-Policy` da RESPOSTA — os dois
  // precisam bater para o script anti-flash do `next-themes` rodar sob
  // `strict-dynamic`.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <ThemeProvider
      attribute="class"
      themes={["light", "dark"]}
      enableSystem={false}
      defaultTheme="dark"
      nonce={nonce}
    >
      <div className="flex min-h-screen flex-col lg:flex-row">
        {/* `papelUsuario` alimenta o link de "Equipe", que só ADMIN vê.
            `PainelNav` é síncrona e não tem acesso à sessão — o papel vem daqui,
            do `usuario` que `usuarioAtual()` já resolveu, sem consulta nova. */}
        <PainelNav
          notificacoesNaoLidas={notificacoesNaoLidas}
          nomeUsuario={usuario.nome}
          papelUsuario={usuario.papel}
        />
        <main className="flex-1">{children}</main>
      </div>
    </ThemeProvider>
  );
}
