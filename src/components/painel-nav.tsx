import {
  LayoutDashboard, Target, Columns3, Users, ListChecks, MessageSquare, UserCog, Menu,
} from "lucide-react";

import { moduloAtivo } from "@/lib/module-gate";
import { hasPermission } from "@/core/auth/permissions";
import { sairAction } from "@/core/auth/actions";
import { Marca } from "@/components/marca";
import { NavLinks, type LinkDoPainel } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell, type NotificacaoApresentada } from "@/components/notifications/notification-bell";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import type { Role } from "@prisma/client";

const GRUPO_TRABALHO: LinkDoPainel[] = [
  { href: "/", label: "Dashboard", icone: LayoutDashboard },
  { href: "/leads", label: "Leads", icone: Target },
  { href: "/leads/kanban", label: "Funil", icone: Columns3 },
  { href: "/contatos", label: "Contatos", icone: Users },
  { href: "/tasks", label: "Tarefas", icone: ListChecks },
];

/**
 * `PainelNav` continua SÍNCRONA e sem Prisma — é o que a deixa testável com
 * `render(<PainelNav />)` sem nenhum mock de banco. Quem busca notificação é
 * `(painel)/layout.tsx`, e o valor chega por prop.
 */
export function PainelNav({
  notificacoesNaoLidas = [],
  nomeUsuario,
  papelUsuario,
}: {
  notificacoesNaoLidas?: NotificacaoApresentada[];
  nomeUsuario?: string;
  papelUsuario?: Role;
} = {}) {
  // Segundo grupo: módulo e administração. Pode ficar VAZIO — vendedor num
  // fork sem whatsapp. `NavLinks` é quem trata a régua nesse caso.
  const grupoExtra: LinkDoPainel[] = [
    ...(moduloAtivo("whatsapp")
      ? [{ href: "/conversas", label: "Conversas", icone: MessageSquare }]
      : []),
    ...(papelUsuario && hasPermission(papelUsuario, "gerenciar_usuarios")
      ? [{ href: "/usuarios", label: "Equipe", icone: UserCog }]
      : []),
  ];

  const grupos = [GRUPO_TRABALHO, grupoExtra];
  const temNaoLida = notificacoesNaoLidas.length > 0;

  const conteudo = (
    <div className="flex h-full flex-col gap-4 p-3">
      <div className="px-2 py-1">
        <Marca />
      </div>

      <div className="flex-1">
        <NavLinks grupos={grupos} />
      </div>

      <div className="border-t pt-3">
        <div className="flex items-center gap-2 px-2">
          <Avatar className="size-6">
            <AvatarFallback>{nomeUsuario?.slice(0, 1).toUpperCase() ?? "?"}</AvatarFallback>
          </Avatar>
          {/* Quem está logado, visível sempre: num computador compartilhado
              da revenda, é o que faz alguém perceber que ficou na conta do
              colega antes de mexer no funil no nome dele. */}
          {nomeUsuario && (
            <span className="truncate text-sm text-muted-foreground" data-testid="usuario-logado">
              {nomeUsuario}
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center gap-1 px-1">
          <ThemeToggle />
          <NotificationBell notificacoes={notificacoesNaoLidas} />
          {/* Form + Server Action em vez de link: um GET que desloga pode ser
              disparado por qualquer site com um <img src>. Ver sairAction. */}
          <form action={sairAction} className="ml-auto">
            <button
              type="submit"
              className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:text-foreground"
            >
              Sair
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden w-[248px] shrink-0 border-r bg-sidebar lg:block">{conteudo}</aside>

      <div className="flex items-center gap-2 border-b p-2 lg:hidden">
        <Sheet>
          <SheetTrigger
            aria-label="Abrir menu"
            className="relative rounded-md p-2 hover:bg-sidebar-accent"
          >
            <Menu size={18} />
            {/* O sino tem um único ponto de montagem, no rodapé — no celular
                ele fica dentro da gaveta. Este ponto evita que o aviso se
                perca atrás de um toque, sem criar um segundo <NotificationBell>
                para o e2e confundir com o primeiro. */}
            {temNaoLida && (
              <span className="absolute right-1 top-1 size-2 rounded-full bg-primary" />
            )}
          </SheetTrigger>
          <SheetContent side="left" className="w-[248px] bg-sidebar p-0">
            {conteudo}
          </SheetContent>
        </Sheet>
        <Marca />
      </div>
    </>
  );
}
