"use server";

import { signOut } from "@/lib/auth";
import { auditarLogout } from "./auditoria-login";
import { usuarioAtual } from "./session";

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
  // ## A auditoria vem ANTES do `signOut`, e vem num `try` proprio
  //
  // Depois do `signOut` nao ha mais sessao para dizer QUEM saiu -- e o
  // `signOut({ redirectTo })` termina lancando o erro especial de `redirect()`,
  // entao nem ha "depois" alcancavel neste arquivo.
  //
  // O `try` cobre `usuarioAtual()` porque ele LANCA quando a sessao ja morreu
  // (expirou, ou a conta foi desativada no meio): nesse caso nao ha o que
  // auditar, e o botao "Sair" precisa continuar limpando o cookie. Sair
  // deixando de revogar por causa do rastro seria exatamente o defeito que o
  // AGENTS.md conta -- so que causado pela correcao dele.
  //
  // `auditarLogout` ja engole a propria falha (ver `auditoria-login.ts`); este
  // `try` e sobre a resolucao da sessao, nao sobre a escrita.
  try {
    const usuario = await usuarioAtual();
    await auditarLogout({ userId: usuario.id, companyId: usuario.companyId });
  } catch {
    // Sessao ja invalida: nada a registrar, e o logout segue.
  }

  await signOut({ redirectTo: "/login" });
}
