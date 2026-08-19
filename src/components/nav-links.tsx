"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Target, Columns3, Users, ListChecks, MessageSquare, UserCog,
  SlidersHorizontal, Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { IndicadorDeLink } from "@/components/indicador-de-link";

export type IconeDoPainel =
  | "dashboard" | "leads" | "funil" | "contatos" | "tarefas" | "conversas" | "equipe" | "etapas"
  | "fluxos";

export type LinkDoPainel = { href: string; label: string; icone: IconeDoPainel };

// O mapa vive DO LADO DO CLIENTE de propósito. A referência de componente do
// lucide é uma função, e função não atravessa a fronteira Server→Client: o
// React precisa serializar as props, e uma função solta não é serializável.
// A versão anterior passava `icone: LayoutDashboard` do servidor e derrubava
// o painel inteiro em build de produção com "Functions cannot be passed
// directly to Client Components". String serializa; a união fechada mantém a
// segurança de tipo, então um nome errado não compila.
const ICONES: Record<IconeDoPainel, LucideIcon> = {
  dashboard: LayoutDashboard,
  leads: Target,
  funil: Columns3,
  contatos: Users,
  tarefas: ListChecks,
  conversas: MessageSquare,
  equipe: UserCog,
  etapas: SlidersHorizontal,
  fluxos: Workflow,
};

/**
 * Só o que precisa de `usePathname` mora aqui.
 *
 * A nav inteira NÃO virou componente de cliente de propósito: isso arrastaria
 * `config/client` para o navegador, incluindo número e mensagem de WhatsApp.
 * Não é segredo, mas é dado que não precisa sair do servidor — e manteria
 * `PainelNav` impossível de testar sem mock de banco. Este componente recebe
 * os links prontos e não importa config nenhum.
 */
export function NavLinks({ grupos }: { grupos: LinkDoPainel[][] }) {
  const caminho = usePathname();

  const todos = grupos.flat();
  const casam = todos.filter(
    (l) => caminho === l.href || (l.href !== "/" && caminho.startsWith(`${l.href}/`)),
  );
  // O MAIS LONGO vence: com prefixo simples, /leads e /leads/kanban acenderiam
  // juntos na página do funil.
  const ativo = casam.sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const comConteudo = grupos.filter((g) => g.length > 0);

  return (
    <nav className="flex flex-col gap-1">
      {comConteudo.map((grupo, i) => (
        <div key={i} className="flex flex-col gap-1">
          {/* A régua só existe ENTRE grupos com conteúdo. Renderizá-la sempre
              deixaria um separador pendurado sobre o nada quando o módulo
              está desligado E o usuário não é admin — combinação que ninguém
              testa à mão. */}
          {i > 0 && <hr className="my-2 border-sidebar-border" />}
          {grupo.map(({ href, label, icone }) => {
            const Icone = ICONES[icone];
            return (
              <Link
                key={href}
                href={href}
                prefetch={false}
                aria-current={href === ativo ? "page" : undefined}
                className={
                  href === ativo
                    ? "flex items-center gap-2 rounded-md bg-sidebar-accent px-2 py-1.5 text-sm font-medium text-sidebar-accent-foreground"
                    : "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                }
              >
                <Icone size={16} aria-hidden />
                {label}
                {/* Descendente do `<Link>` de propósito: é assim que
                    `useLinkStatus` sabe de qual navegação está falando. O
                    `aria-hidden` que ele carrega é o que mantém o nome
                    acessível do link igual a `label` — ver o comentário longo
                    em `indicador-de-link.tsx`. */}
                <IndicadorDeLink />
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
