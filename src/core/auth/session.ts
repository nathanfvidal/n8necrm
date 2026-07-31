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
