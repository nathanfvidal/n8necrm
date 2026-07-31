import Link from "next/link";

import { moduloAtivo } from "@/lib/module-gate";

const linksFixos = [
  { href: "/", label: "Dashboard" },
  { href: "/leads", label: "Leads" },
  { href: "/leads/kanban", label: "Funil" },
  { href: "/tasks", label: "Tarefas" },
];

// Rotas /catalogo e /analytics ainda não existem (Fases 2 e 3) — até lá o
// link aparece (se o módulo estiver ativo) e a navegação dá 404, o que é o
// comportamento esperado nesta fase.
const linksDeModulo = [
  { href: "/catalogo", label: "Catálogo", modulo: "catalog" as const },
  { href: "/analytics", label: "Analytics", modulo: "analytics" as const },
];

export function PainelNav() {
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
    </nav>
  );
}
