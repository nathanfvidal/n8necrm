import { Menu } from "lucide-react";

import type { ModuloNome } from "@/core/config/modulos";
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
 * `render(<PainelNav ... />)` sem nenhum mock de banco. Quem busca notificação
 * é `(painel)/layout.tsx`, e o valor chega por prop.
 *
 * `modulosAtivos` e `nomeMarca` chegam pela mesma porta desde o Ciclo 1c, e
 * pelo mesmo motivo: os dois passaram a vir do BANCO, por empresa, e uma
 * leitura assíncrona aqui dentro tornaria este componente impossível de
 * renderizar sem mock de Postgres. São OBRIGATÓRIAS — um padrão silencioso
 * (`= []`, `= "CRM"`) esconderia o dia em que o layout esquecesse de passá-las,
 * e o sintoma seria a barra sem nome ou o menu sem módulo, sem erro nenhum.
 * O `= {}` que a assinatura tinha saiu junto: com prop obrigatória, um render
 * sem argumento nenhum precisa ser erro de tipo, não objeto vazio.
 *
 * O import de `ModuloNome` é `import type` de propósito: `@/core/config/modulos`
 * puxa `next/navigation` e, por baixo, a leitura do banco. Um import de VALOR
 * daqui arrastaria isso para o grafo de um componente que existe justamente
 * para não ter banco — o mesmo cuidado que `components/automation/fluxos-table.tsx`
 * documenta para `server-only`. `import type` é apagado na compilação.
 */
export function PainelNav({
  notificacoesNaoLidas = [],
  nomeUsuario,
  papelUsuario,
  modulosAtivos,
  nomeMarca,
  logo,
}: {
  notificacoesNaoLidas?: NotificacaoApresentada[];
  nomeUsuario?: string;
  papelUsuario?: Role;
  modulosAtivos: ModuloNome[];
  nomeMarca: string;
  logo?: { claro: string; escuro: string };
}) {
  // Segundo grupo: módulo e administração. Pode ficar VAZIO — vendedor numa
  // empresa sem whatsapp. `NavLinks` é quem trata a régua nesse caso.
  const grupoExtra: LinkDoPainel[] = [
    ...(modulosAtivos.includes("whatsapp")
      ? [{ href: "/conversas", label: "Conversas", icone: "conversas" as const }]
      : []),
    ...(papelUsuario && hasPermission(papelUsuario, "gerenciar_usuarios")
      ? [{ href: "/usuarios", label: "Equipe", icone: "equipe" as const }]
      : []),
    ...(papelUsuario && hasPermission(papelUsuario, "gerenciar_funil")
      ? [{ href: "/etapas", label: "Etapas", icone: "etapas" as const }]
      : []),
    // Módulo E permissão — as duas, não uma ou outra. `modulosAtivos` sozinho
    // mostraria o link para VENDEDOR (a página faz `notFound()`, mas exibir
    // um link que sempre dá 404 é ruído); `hasPermission` sozinho mostraria
    // o link numa empresa sem o módulo `automation` ligado. `ver_fluxos`
    // (ADMIN e GESTOR), não `gerenciar_fluxos` — esconder o link nunca é o
    // gate de verdade (a página e as actions são), só evita ruído no menu.
    ...(modulosAtivos.includes("automation") && papelUsuario && hasPermission(papelUsuario, "ver_fluxos")
      ? [{ href: "/fluxos", label: "Fluxos", icone: "fluxos" as const }]
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
          <Marca nome={nomeMarca} logo={logo} />
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
        <Marca nome={nomeMarca} logo={logo} />
      </div>
    </>
  );
}
