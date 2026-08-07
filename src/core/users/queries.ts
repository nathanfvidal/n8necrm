import { prisma } from "@/lib/prisma";
import { ehContaDeSistema, idsDeSistema } from "./sistema";
import type { Role } from "@prisma/client";

/**
 * Projeção segura de `User`.
 *
 * **Enumerada campo a campo de propósito, e nunca com `include` ou com o
 * modelo inteiro.** `User.senhaHash` é uma coluna como qualquer outra: um
 * `findMany()` sem `select` devolve o hash bcrypt de todo mundo, e daí ele
 * atravessa a fronteira servidor→cliente dentro das props do componente e
 * termina no HTML da página. Este projeto já teve um achado exatamente assim
 * (linha inteira de `User` carregada só para mostrar um nome), e a forma de
 * evitar a reincidência é não existir caminho onde o hash seja incluído por
 * omissão.
 *
 * Se alguém acrescentar uma coluna sensível a `User` no futuro, ela também
 * fica de fora por padrão — o custo de esquecer é não mostrar um dado, não
 * vazá-lo.
 */
const CAMPOS_SEGUROS = {
  id: true,
  nome: true,
  email: true,
  papel: true,
  ativo: true,
  criadoEm: true,
} as const;

export type UsuarioListado = {
  id: string;
  nome: string;
  email: string;
  papel: Role;
  ativo: boolean;
  criadoEm: Date;
};

/**
 * Lista as pessoas da equipe para a tela de gestão: ativos primeiro, depois
 * por nome.
 *
 * Contas de sistema ficam de fora (ver `sistema.ts`) — não são gerenciáveis,
 * e mostrá-las convidaria alguém a "reativar aquele usuário desativado".
 */
export async function listarUsuarios(): Promise<UsuarioListado[]> {
  return prisma.user.findMany({
    where: { id: { notIn: idsDeSistema() } },
    select: CAMPOS_SEGUROS,
    orderBy: [{ ativo: "desc" }, { nome: "asc" }],
  });
}

/**
 * Busca uma pessoa pelo id, com a mesma projeção segura. Devolve `null`
 * quando não existe **ou quando é conta de sistema** — as duas situações são
 * "não é gerenciável", e distinguir só ajudaria quem está sondando ids.
 *
 * A exclusão de conta de sistema é feita ANTES da consulta, em memória, e não
 * como predicado somado ao `id`: ver `sistema.ts` sobre por que o filtro por
 * `id` não compõe da forma óbvia.
 */
export async function buscarUsuario(id: string): Promise<UsuarioListado | null> {
  if (ehContaDeSistema(id)) return null;
  return prisma.user.findUnique({ where: { id }, select: CAMPOS_SEGUROS });
}
