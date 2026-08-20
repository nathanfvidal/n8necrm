import { prisma } from "@/lib/prisma";
import { ehContaDeSistema, idsDeSistema } from "./sistema";
import type { Role } from "@prisma/client";

/**
 * Projeção segura de `User`, sem o papel — que a partir do Ciclo 1a mora em
 * `Membership`, não em `User` (a coluna `User.papel` foi derrubada depois que
 * a gestão de equipe passou a gravar o vínculo).
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
const CAMPOS_SEGUROS_USER = {
  id: true,
  nome: true,
  email: true,
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
 * Lista as pessoas da equipe DA EMPRESA de quem consulta: só quem tem
 * `Membership` com `companyId`, com o papel vindo desse vínculo (não mais de
 * `User.papel`, que não existe mais). Ativos primeiro, depois por nome.
 *
 * A consulta parte de `Membership`, não de `User` filtrado por relação — é o
 * vínculo que define "pertence a esta empresa", e é dele que vem o papel que
 * a linha mostra.
 *
 * Contas de sistema ficam de fora (ver `sistema.ts`) — não são gerenciáveis,
 * e mostrá-las convidaria alguém a "reativar aquele usuário desativado".
 */
export async function listarUsuarios(companyId: string): Promise<UsuarioListado[]> {
  const vinculos = await prisma.membership.findMany({
    where: { companyId, userId: { notIn: idsDeSistema() } },
    select: { papel: true, user: { select: CAMPOS_SEGUROS_USER } },
    orderBy: [{ user: { ativo: "desc" } }, { user: { nome: "asc" } }],
  });

  return vinculos.map(({ papel, user }) => ({ ...user, papel }));
}

/**
 * Busca uma pessoa pelo id DENTRO da empresa de quem consulta, com a mesma
 * projeção segura. Devolve `null` quando a pessoa não existe, quando é conta
 * de sistema, **ou quando não tem vínculo com `companyId`** — as três
 * situações são "não é gerenciável por você", e distinguir só ajudaria quem
 * está sondando ids ou tentando alcançar gente de outra empresa.
 *
 * A exclusão de conta de sistema é feita ANTES da consulta, em memória, e não
 * como predicado somado ao `id`: ver `sistema.ts` sobre por que o filtro por
 * `id` não compõe da forma óbvia.
 */
export async function buscarUsuario(id: string, companyId: string): Promise<UsuarioListado | null> {
  if (ehContaDeSistema(id)) return null;

  const vinculo = await prisma.membership.findUnique({
    where: { userId_companyId: { userId: id, companyId } },
    select: { papel: true, user: { select: CAMPOS_SEGUROS_USER } },
  });
  if (!vinculo) return null;

  return { ...vinculo.user, papel: vinculo.papel };
}
