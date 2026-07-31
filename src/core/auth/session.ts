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
 */
export async function usuarioAtual(): Promise<User> {
  const session = await auth();
  if (!session?.user?.email) {
    throw new Error("Não autenticado");
  }
  return prisma.user.findUniqueOrThrow({ where: { email: session.user.email } });
}
