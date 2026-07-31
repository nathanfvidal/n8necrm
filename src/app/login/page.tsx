import { redirect } from "next/navigation";

import { usuarioAtual } from "@/core/auth/session";
import { LoginForm } from "./login-form";

/**
 * Server Component (fix round 2/5). Antes, esta rota era 100% cliente
 * (`"use client"`) — o form em si continua sendo (`login-form.tsx`), mas a
 * decisão de "pular direto para `/` porque já estou logado" agora é
 * checada aqui, no servidor, com `usuarioAtual()` — não em `src/proxy.ts`.
 *
 * Isso não é só reorganização: `src/proxy.ts` já teve essa mesma regra
 * (`isLoggedIn && isLoginPage → redireciona para /`) baseada só em "existe
 * um JWT válido", sem checar `User.ativo`, e isso criava um loop infinito
 * de redirecionamento para um usuário desativado (proxy manda pra `/`, o
 * layout do painel rejeita e manda de volta pra `/login`, proxy vê o mesmo
 * JWT "válido" e manda de novo para `/` — sem fim). Ver o comentário em
 * `src/proxy.ts` para a reprodução completa. `usuarioAtual()` é o único
 * critério confiável de "logado de verdade" neste projeto (rejeita sessão
 * ausente E usuário desativado da mesma forma — fix round 1/5), então é o
 * único lugar com informação suficiente para decidir isto com segurança.
 *
 * `redirect()` precisa ficar FORA do try/catch: ela lança um erro de
 * controle de fluxo (`NEXT_REDIRECT`) que um catch em volta dela
 * engoliria por engano — por isso a checagem de "está autenticado" fica
 * isolada em `estaAutenticado()`, que nunca deixa esse erro escapar do seu
 * próprio catch (não tem motivo: ela não chama `redirect`).
 */
export default async function LoginPage() {
  if (await estaAutenticado()) {
    redirect("/");
  }

  return <LoginForm />;
}

async function estaAutenticado(): Promise<boolean> {
  try {
    await usuarioAtual();
    return true;
  } catch {
    return false;
  }
}
