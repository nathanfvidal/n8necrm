import { redirect } from "next/navigation";

import { usuarioAtualOuLogin } from "@/core/auth/session";
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
  // `usuarioAtualOuLogin()` e não `usuarioAtual()`: o porquê está no docstring
  // dela, em `core/auth/session.ts`. Esta foi a primeira página onde o defeito
  // apareceu — pego num e2e intermitente — porque é a primeira rota do painel
  // a virar item de MENU, e `<Link>` pré-carrega.
  //
  // Supunha-se que as outras telas escapavam por não estarem no menu. O Sentry
  // desmentiu: `Não autenticado` aparece como erro não tratado em `GET /leads`.
  // Menu só tornou o caminho mais frequente, nunca foi a condição.
  const usuario = await usuarioAtualOuLogin();

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
