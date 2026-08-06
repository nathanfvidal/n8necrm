import Link from "next/link";

import { moduloAtivo } from "@/lib/module-gate";
import { NotificationBell, type NotificacaoNaoLida } from "@/components/notifications/notification-bell";
import { sairAction } from "@/core/auth/actions";

const linksFixos = [
  { href: "/", label: "Dashboard" },
  { href: "/leads", label: "Leads" },
  { href: "/leads/kanban", label: "Funil" },
  { href: "/tasks", label: "Tarefas" },
];

// Rotas /catalogo e /analytics ainda não existem (Fases 2 e 3) — até lá o
// link aparece (se o módulo estiver ativo) e a navegação dá 404, o que é o
// comportamento esperado nesta fase. /conversas (Fatia 1 do WhatsApp) já
// existe de verdade — `exigirModulo("whatsapp")` no topo daquela página
// devolve 404 se o módulo for desligado num fork, mesmo padrão dos outros
// dois.
const linksDeModulo = [
  { href: "/catalogo", label: "Catálogo", modulo: "catalog" as const },
  { href: "/analytics", label: "Analytics", modulo: "analytics" as const },
  { href: "/conversas", label: "Conversas", modulo: "whatsapp" as const },
];

/**
 * `notificacoesNaoLidas` chega por PROP, opcional (default `[]`) — de
 * propósito, para `PainelNav` continuar uma função SÍNCRONA e sem Prisma,
 * testável com `render(<PainelNav />)` sem nenhum mock de banco
 * (`tests/unit/painel-nav.test.tsx`, Task 3, continua passando sem mudança).
 *
 * Quem busca o dado é `(painel)/layout.tsx` — o único lugar por onde toda
 * página do painel passa (mesmo raciocínio da guarda de sessão que já mora
 * lá) — reaproveitando o `usuario` que `usuarioAtual()` já resolveu ali para
 * checar a sessão, em vez de este componente (ou o sino) chamar
 * `usuarioAtual()`/buscar o `User` de novo. Ver o comentário em
 * `notification-bell.tsx` sobre o custo desta consulta extra por navegação.
 */
export function PainelNav({
  notificacoesNaoLidas = [],
  nomeUsuario,
}: {
  notificacoesNaoLidas?: NotificacaoNaoLida[];
  nomeUsuario?: string;
} = {}) {
  const links = [
    ...linksFixos,
    ...linksDeModulo.filter((link) => moduloAtivo(link.modulo)),
  ];

  return (
    <nav className="flex items-center gap-4 border-b p-4">
      {links.map((link) => (
        <Link key={link.href} href={link.href} className="text-sm font-medium hover:underline">
          {link.label}
        </Link>
      ))}
      <div className="ml-auto flex items-center gap-4">
        <NotificationBell notificacoes={notificacoesNaoLidas} />
        {/* Quem está logado, visível em toda tela: num computador
            compartilhado da revenda, é o que faz alguém perceber que ficou
            na conta do colega antes de mexer no funil no nome dele. */}
        {nomeUsuario && (
          <span className="text-sm text-muted-foreground" data-testid="usuario-logado">
            {nomeUsuario}
          </span>
        )}
        {/* Form + Server Action em vez de link: um GET que desloga pode ser
            disparado por qualquer site com um <img src>. Ver sairAction. */}
        <form action={sairAction}>
          <button
            type="submit"
            className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
          >
            Sair
          </button>
        </form>
      </div>
    </nav>
  );
}
