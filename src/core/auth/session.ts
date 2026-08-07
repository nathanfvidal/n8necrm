import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { User } from "@prisma/client";

/**
 * Deriva o usuário autenticado a partir da sessão Auth.js do request atual.
 *
 * Este é o ÚNICO ponto permitido para descobrir "quem está agindo" em uma
 * Server Action. Nunca aceite `usuarioId`/`autorId` vindo do cliente — uma
 * Server Action é um endpoint HTTP público, e um `usuarioId` de formulário
 * seria trivialmente forjável por qualquer requisição POST direta. Ver
 * decisão de segurança da Task 13.
 *
 * Checa `User.ativo` a cada chamada (fix round 1/5, achado do revisor:
 * CRITICAL). `Credentials.authorize()` em `src/lib/auth.ts` só valida
 * `ativo` no MOMENTO do login — a sessão é JWT, sem store no servidor, então
 * um cookie já emitido continua válido depois que alguém desativa o usuário
 * no painel. Sem esta checagem, "desativar" um usuário parece revogar o
 * acesso e não revoga: a pessoa continua criando/movendo leads (e gravando
 * `AuditLog` em nome dela) até o token expirar por conta própria — o
 * cenário clássico de fail-open onde deveria ser fail-closed.
 *
 * Um usuário desativado lança a MESMA mensagem ("Não autenticado") que a
 * ausência de sessão, de propósito — não um erro com forma diferente
 * (ex.: "Conta desativada"). Isso torna as duas situações indistinguíveis
 * para quem chama: qualquer código que hoje trata "sem sessão" (manda para
 * /login) trata "desativado" da mesma forma automaticamente, sem precisar
 * saber que esse caso existe. Inventar um shape de erro à parte arriscaria
 * um chamador futuro tratar só "sem sessão" e deixar "desativado" cair num
 * caminho não previsto — a task 13-21 inteira depende deste helper.
 */
export async function usuarioAtual(): Promise<User> {
  const session = await auth();
  if (!session?.user?.email) {
    throw new Error("Não autenticado");
  }
  const usuario = await prisma.user.findUniqueOrThrow({ where: { email: session.user.email } });
  if (!usuario.ativo) {
    throw new Error("Não autenticado");
  }
  return usuario;
}

/**
 * `usuarioAtual()` para PÁGINAS: em vez de lançar, manda para `/login`.
 *
 * ## Por que isto existe
 *
 * `(painel)/layout.tsx` já garante sessão válida antes de qualquer página do
 * grupo renderizar, então a leitura natural é que a página não precisa se
 * proteger. Está errada: **o Next renderiza layout e página em paralelo.**
 * Uma sessão que morre no meio — logout, ou a conta sendo desativada —
 * alcança a página mesmo com o layout já a caminho do redirecionamento. A
 * rejeição sobe sem tratamento e vira tela de erro genérica com digest, em
 * vez de mandar para o login.
 *
 * Não é hipótese. O Sentry registrou `Não autenticado` como erro NÃO TRATADO
 * em `GET /leads`, e `usuarios/page.tsx` já tinha ganhado este `try/catch`
 * quando o mesmo defeito apareceu num e2e intermitente.
 *
 * Com o Sentry ligado o custo mudou de categoria: cada logout vira evento de
 * erro. Ruído que enterra o erro de verdade, que é justamente o que a
 * observabilidade deveria evitar.
 *
 * ## Cuidado ao mexer
 *
 * `redirect()` funciona lançando um erro especial que o Next intercepta.
 * Chamá-lo DENTRO de um `try` faria o próprio `catch` engolir o
 * redirecionamento — por isso ele fica fora, depois do bloco, e o `try` só
 * envolve a chamada que pode rejeitar.
 */
export async function usuarioAtualOuLogin(): Promise<User> {
  let usuario: User;
  try {
    usuario = await usuarioAtual();
  } catch {
    redirect("/login");
  }
  return usuario;
}
