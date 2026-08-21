// "O ADMIN do seed", "o VENDEDOR do seed" — sem passar por `User.papel`.
//
// Sete arquivos de teste faziam
// `prisma.user.findFirstOrThrow({ where: { papel: "ADMIN", ativo: true } })`
// para achar o autor das fixtures. A coluna `User.papel` saiu no Ciclo 1f
// (`20260821130000_derruba_user_papel_de_vez`) e o
// papel mora em `Membership.papel` (`prisma/schema.prisma:163-176`), então a
// consulta parte do VÍNCULO — que é também de onde `usuarioAtual()`
// (`src/core/auth/session.ts:98-106`) tira o papel em produção. Os testes passam a
// perguntar da mesma forma que o sistema.
//
// ## Três decisões que o formato antigo tomava por acidente
//
// **`user: { ativo: true }` faz parte da chave.** O seed cria um "Atendente
// WhatsApp (sistema)" ADMIN e `ativo: false` (`prisma/seed.ts:353-357`), e ele
// é o primeiro ADMIN que um `findFirst` sem filtro devolve.
// `stage-transition.test.ts` registrava o estrago disso num comentário
// próprio: leads nascendo com dono que não consegue entrar no sistema, e
// passando, porque nada recusava. Aqui o filtro é obrigatório, não lembrado.
//
// **`orderBy: { criadoEm: "asc" }`, que o formato antigo não tinha.** O banco
// de desenvolvimento é compartilhado e outros arquivos da suíte criam ADMINs
// com vínculo (`audit-isolamento`, `alerta-atividade`, ...). Sem ordem, "o
// ADMIN" era literalmente qualquer um que o Postgres devolvesse primeiro. O
// vínculo do seed é o mais antigo, então a ordem por `criadoEm` o escolhe.
// Isto é estritamente melhor que antes, não uma mudança de contrato — mas é
// uma MUDANÇA, e por isso cada arquivo convertido roda inteiro na tarefa que o
// converte.
//
// **`companyId` sai de graça.** Vários desses arquivos faziam uma SEGUNDA
// consulta só para descobrir a empresa do usuário. É a mesma linha.
import type { Role } from "@prisma/client";

import { prisma } from "../../../src/lib/prisma";

export type UsuarioDoSeed = { id: string; companyId: string };

/**
 * O usuário ATIVO com este papel, pelo vínculo mais antigo que o tenha.
 *
 * Lança se não houver nenhum — de propósito, e não devolve `null`: uma fixture
 * que não acha o autor precisa parar ali, com a mensagem do Prisma dizendo o
 * que faltou, em vez de seguir com `undefined` e falhar três asserções adiante
 * por outro motivo.
 */
export async function usuarioDoSeed(papel: Role): Promise<UsuarioDoSeed> {
  const vinculo = await prisma.membership.findFirstOrThrow({
    where: { papel, user: { ativo: true } },
    select: { userId: true, companyId: true },
    orderBy: { criadoEm: "asc" },
  });

  return { id: vinculo.userId, companyId: vinculo.companyId };
}
