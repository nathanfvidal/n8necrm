"use server";

import { signOut } from "@/lib/auth";

/**
 * Encerra a sessão.
 *
 * ## Por que Server Action e não `signOut()` num Client Component
 *
 * `signOut` do `next-auth/react` exigiria transformar a barra de navegação
 * inteira em Client Component (ela é síncrona e testável hoje justamente por
 * não ser) e só funcionaria com JavaScript carregado. Como Server Action
 * chamada por um `<form>`, o botão funciona mesmo se o JS falhar — e o
 * Next.js já protege Server Actions contra CSRF conferindo a origem da
 * requisição, o que um GET em `/logout` não teria: qualquer site poderia
 * deslogar o usuário com um `<img src="...">`.
 *
 * `redirectTo` manda para `/login` em vez de `/`: sem sessão, `/` seria
 * barrada pelo proxy e redirecionada para `/login` de qualquer jeito — ir
 * direto evita um salto extra.
 */
export async function sairAction() {
  await signOut({ redirectTo: "/login" });
}
