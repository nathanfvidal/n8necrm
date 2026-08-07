import { redirect } from "next/navigation";

import { usuarioAtual } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";
import { listarUsuarios } from "@/core/users/queries";
import { UserForm } from "@/components/users/user-form";
import { UserTable } from "@/components/users/user-table";

/**
 * Gestão da equipe — ADMIN apenas (`gerenciar_usuarios`).
 *
 * Existe porque, sem ela, instalar o CRM num cliente novo exigia um
 * desenvolvedor: usuários só nasciam pelo seed. Era o buraco mais duro do
 * núcleo, e é o critério da spec do modelo em vigor — "instalar e operar sem
 * que ninguém edite código"
 * (`docs/superpowers/specs/2026-08-07-nucleo-e-modulos-sob-demanda.md`, § 2.3).
 *
 * `(painel)/layout.tsx` já garante sessão válida antes de qualquer página
 * deste route group renderizar; `usuarioAtual()` aqui só lê o papel para o
 * gate e o id para a tabela saber quem é "você".
 *
 * `redirect` em vez de `notFound()` para quem não é ADMIN: um GESTOR que
 * clicou num link antigo entende melhor voltar ao painel do que uma tela de
 * "não existe". Não é a defesa — a defesa é a checagem de permissão dentro de
 * cada Server Action (`core/users/actions.ts`), que vale mesmo para um POST
 * que nunca passou por esta página.
 */
export default async function UsuariosPage() {
  // `try/catch` em volta de `usuarioAtual()`, espelhando `(painel)/layout.tsx`.
  // Não é redundância com o layout: o Next renderiza layout e página em
  // paralelo, então uma sessão que morre no meio (logout, ou a conta sendo
  // desativada) pode alcançar esta página mesmo com o layout já a caminho do
  // redirecionamento — e aí a rejeição sobe SEM tratamento e vira tela de
  // erro genérica com digest, em vez de mandar para o login.
  //
  // Isto foi um defeito real, pego no e2e: esta rota é a primeira do painel a
  // virar item de MENU protegido por papel, e `<Link>` pré-carrega. O
  // prefetch dispara em toda página do painel, então o caminho "requisição a
  // /usuarios com sessão recém-morta" deixou de ser hipótese e passou a
  // acontecer a cada logout de ADMIN. As telas de `/conversas/agente` têm a
  // mesma forma e nunca sofreram porque nunca viraram item de menu.
  let usuario;
  try {
    usuario = await usuarioAtual();
  } catch {
    redirect("/login");
  }

  if (!hasPermission(usuario.papel, "gerenciar_usuarios")) {
    redirect("/");
  }

  const usuarios = await listarUsuarios();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Equipe</h1>
        <p className="text-sm text-muted-foreground">
          Quem tem acesso ao CRM, com qual papel. Desativar revoga o acesso na navegação seguinte.
        </p>
      </div>

      <div className="rounded-md border p-4">
        <h2 className="mb-3 text-sm font-medium">Adicionar pessoa</h2>
        <UserForm />
      </div>

      <UserTable usuarios={usuarios} idDoUsuarioAtual={usuario.id} />
    </div>
  );
}
