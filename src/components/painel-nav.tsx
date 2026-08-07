import Link from "next/link";

import { moduloAtivo } from "@/lib/module-gate";
import { hasPermission } from "@/core/auth/permissions";
import { NotificationBell, type NotificacaoNaoLida } from "@/components/notifications/notification-bell";
import { sairAction } from "@/core/auth/actions";
import type { Role } from "@prisma/client";

const linksFixos = [
  { href: "/", label: "Dashboard" },
  { href: "/leads", label: "Leads" },
  { href: "/leads/kanban", label: "Funil" },
  { href: "/contatos", label: "Contatos" },
  { href: "/tasks", label: "Tarefas" },
];

// Um link por módulo que tem rota de verdade. `moduloAtivo` decide se ele
// aparece; `exigirModulo()` no topo da page é que faz a rota devolver 404 num
// fork com o módulo desligado — o menu esconder não é a defesa.
//
// **Só entre aqui quando a rota existir.** Até 2026-08-07 esta lista também
// tinha `/catalogo` e `/analytics`, das Fases 2 e 3 do roteiro antigo: rotas
// que nunca foram construídas, então o link prometia funcionalidade e
// entregava 404. O roteiro de fases foi substituído por núcleo + módulos sob
// demanda (`docs/superpowers/specs/2026-08-07-nucleo-e-modulos-sob-demanda.md`),
// e os dois módulos continuam existindo como candidatos no enum de
// `config/client.schema.ts` — o que saiu foi a promessa no menu, não a
// intenção. Ver `docs/receita-modulo.md`, passo 6.
const linksDeModulo = [{ href: "/conversas", label: "Conversas", modulo: "whatsapp" as const }];

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
  papelUsuario,
}: {
  notificacoesNaoLidas?: NotificacaoNaoLida[];
  nomeUsuario?: string;
  papelUsuario?: Role;
} = {}) {
  const links = [
    ...linksFixos,
    ...linksDeModulo.filter((link) => moduloAtivo(link.modulo)),
    // "Equipe" é filtrado por PAPEL, não por módulo: gestão de usuários é
    // núcleo, existe em todo fork. `papelUsuario` é opcional para o
    // componente continuar renderizável sem sessão nos testes — sem ele o
    // link some, que é o padrão seguro.
    ...(papelUsuario && hasPermission(papelUsuario, "gerenciar_usuarios")
      ? [{ href: "/usuarios", label: "Equipe" }]
      : []),
  ];

  return (
    <nav className="flex items-center gap-4 border-b p-4">
      {/*
        `prefetch={false}` em TODOS os links do painel, e isto não é
        conservadorismo — é a correção de um defeito que o e2e pegou.

        O padrão do Next é pré-carregar todo `<Link>` visível. Como esta nav
        aparece em toda página do painel, isso significa requisições às rotas
        protegidas em voo o tempo todo. Quando alguém sai, uma dessas
        requisições chega DEPOIS do logout carregando o cookie que acabou de
        ser invalidado — e o Auth.js reemite o cookie de sessão na resposta.
        A sessão que o logout encerrou volta a valer, e "Sair" deixa de ser
        revogação para virar navegação.

        Foi medido, não suposto: o teste `auth.spec.ts` ("o botão Sair encerra
        a sessão de verdade") passou a falhar de forma intermitente a cada
        link novo acrescentado aqui. Uma primeira correção desligou o prefetch
        só do link novo daquela vez; acrescentar o link seguinte trouxe a
        falha de volta, o que mostrou que o problema é do MECANISMO, não de
        uma rota específica.

        O custo é baixo: toda página do painel é `force-dynamic`
        (`(painel)/layout.tsx`), e o Next não pré-carrega o conteúdo de rota
        dinâmica sem um `loading.tsx` — que este projeto não tem. Ou seja, o
        prefetch aqui gastava requisição sem entregar navegação mais rápida.
      */}
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          prefetch={false}
          className="text-sm font-medium hover:underline"
        >
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
