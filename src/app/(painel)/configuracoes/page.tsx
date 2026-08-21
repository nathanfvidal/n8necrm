import { redirect } from "next/navigation";

import { usuarioAtualOuLogin } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";

/**
 * `/configuracoes` não é tela: manda para a primeira seção que a pessoa pode
 * ver. É o que permite o item de menu apontar para uma URL estável enquanto as
 * seções vão e vêm.
 *
 * Quem não pode ver nenhuma seção vai para o painel — `redirect` e não
 * `notFound()`, pelo mesmo motivo de `/usuarios`: quem clicou num link antigo
 * entende melhor voltar ao painel do que uma tela de "não existe".
 */
export default async function ConfiguracoesPage() {
  const usuario = await usuarioAtualOuLogin();

  if (hasPermission(usuario.papel, "gerenciar_conexoes")) {
    redirect("/configuracoes/conexoes");
  }

  redirect("/");
}
