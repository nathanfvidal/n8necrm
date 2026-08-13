import { Menu } from "lucide-react";

import { moduloAtivo } from "@/lib/module-gate";
import { hasPermission } from "@/core/auth/permissions";
import { sairAction } from "@/core/auth/actions";
import { Marca } from "@/components/marca";
import { NavLinks, type LinkDoPainel } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell, type NotificacaoApresentada } from "@/components/notifications/notification-bell";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { Role } from "@prisma/client";

const GRUPO_TRABALHO: LinkDoPainel[] = [
  { href: "/", label: "Dashboard", icone: "dashboard" },
  { href: "/leads", label: "Leads", icone: "leads" },
  { href: "/leads/kanban", label: "Funil", icone: "funil" },
  { href: "/contatos", label: "Contatos", icone: "contatos" },
  { href: "/tasks", label: "Tarefas", icone: "tarefas" },
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
      ? [{ href: "/conversas", label: "Conversas", icone: "conversas" as const }]
      : []),
    ...(papelUsuario && hasPermission(papelUsuario, "gerenciar_usuarios")
      ? [{ href: "/usuarios", label: "Equipe", icone: "equipe" as const }]
      : []),
  ];

  const grupos = [GRUPO_TRABALHO, grupoExtra];

  /**
   * Chamada duas vezes abaixo — uma para o `<aside>` do desktop, outra para
   * o `<SheetContent>` da gaveta do celular —, e CADA chamada cria uma
   * árvore própria. As duas convivem no DOM ao mesmo tempo (CSS decide qual
   * aparece: `hidden lg:block` no aside; a gaveta é portalizada para
   * `document.body` e só monta quando aberta), mas em nenhuma largura as
   * DUAS ficam visíveis juntas.
   *
   * `comSino` existe por causa do portal: abrir a gaveta não troca de lugar
   * o `<aside>`, soma outra árvore ao documento. Se as duas chamadas
   * renderizassem `<NotificationBell>`, abrir a gaveta no celular colocaria
   * DOIS sinos no DOM ao mesmo tempo — por isso a gaveta NUNCA leva sino
   * (`comSino={false}`). No celular o sino mora na barra superior, fora da
   * gaveta, e por isso fica disponível a zero toques.
   */
  function conteudo({ comSino }: { comSino: boolean }) {
    return (
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
            {comSino && <NotificationBell notificacoes={notificacoesNaoLidas} />}
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
  }

  return (
    <>
      <aside className="hidden w-[248px] shrink-0 border-r bg-sidebar lg:block">
        {conteudo({ comSino: true })}
      </aside>

      <div className="flex items-center gap-2 border-b p-2 lg:hidden">
        <Sheet>
          <SheetTrigger aria-label="Abrir menu" className="rounded-md p-2 hover:bg-sidebar-accent">
            <Menu size={18} />
          </SheetTrigger>
          {/* `data-[side=left]:w-[248px]` e não `w-[248px]`: o `sheet.tsx` já
              traz `data-[side=left]:w-3/4`, que o `tailwind-merge` não
              considera conflitante com a classe simples — as duas sobrevivem
              e a de maior especificidade vence. Medido antes do conserto:
              293px de largura numa janela de 390, onde o código dizia 248. */}
          <SheetContent side="left" className="data-[side=left]:w-[248px] bg-sidebar p-0">
            {/* Sem isto o leitor de tela anuncia só "diálogo": `role="dialog"`
                sem nome acessível nenhum (WCAG 4.1.2). Fica invisível porque
                a gaveta já mostra a marca no topo — o nome é para quem não
                enxerga a arte, não para repetir na tela. */}
            <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
            {conteudo({ comSino: false })}
          </SheetContent>
        </Sheet>
        {/* Sino direto na barra do celular, fora da gaveta: fica a zero
            toques em vez de um, e mantém uma instância só de
            `<NotificationBell>` visível nesta largura — a gaveta não tem a
            dela (ver o comentário de `conteudo`). */}
        <NotificationBell notificacoes={notificacoesNaoLidas} />
        <Marca />
      </div>
    </>
  );
}
