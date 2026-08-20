import "server-only";

import { prismaDaEmpresa } from "@/core/tenancy/escopo";

/**
 * O que a lista "Atividade recente" do dashboard mostra, e só isso.
 *
 * Projetado campo a campo pelo mesmo motivo de `TarefaListada`
 * (`core/tasks/queries.ts`) e `UsuarioListado` (`core/users/queries.ts`):
 * `AuditLog.antes`/`depois` são colunas `Json` que guardam INSTANTÂNEO de
 * entidade — nome de cliente, telefone, valor de negócio. A home do painel
 * imprime quatro campos e nenhum deles é esse; carregar a linha inteira levaria
 * o instantâneo até as props do componente para nada.
 */
export type AtividadeRecente = {
  id: string;
  acao: string;
  entidade: string;
  entidadeId: string;
  criadoEm: Date;
  user: { id: string; nome: string };
};

/**
 * Quantas linhas a home mostra. Era literal na página; virou constante porque
 * o teste de isolamento precisa criar mais linhas que o teto para provar que o
 * corte é por EMPRESA e não por sorte de ordenação.
 */
export const LIMITE_ATIVIDADE_RECENTE = 10;

/**
 * As últimas ações auditadas DESTA empresa, mais recente primeiro.
 *
 * ## O defeito que esta função existe para fechar
 *
 * Até o Ciclo 1d a home do painel fazia, dentro da própria página:
 *
 *   prisma.auditLog.findMany({ take: 10, orderBy: { criadoEm: "desc" }, ... })
 *
 * `AuditLog` é modelo de tenant (`core/tenancy/escopo.ts`, os 11), e aquele
 * `findMany` não tinha `where` NENHUM — a primeira tela depois do login
 * mostrava as últimas dez ações de QUALQUER empresa do banco, com o nome de
 * quem agiu, a ação e a entidade. Era o item 1 da fila anotada em
 * `eslint.config.mjs` e a última leitura cross-tenant escrita DENTRO de uma
 * página.
 *
 * A prova de que ela vazava não é raciocínio: `tests/unit/audit-isolamento.ts`
 * mantém uma sonda com a consulta ANTIGA, palavra por palavra, e AFIRMA que ela
 * devolve a linha da outra empresa. Se um dia essa sonda ficar verde sem
 * ninguém mexer aqui, é o banco que mudou, não este comentário.
 *
 * ## `user` é relação através de `User`, e isso é seguro AQUI
 *
 * `core/tenancy/escopo.ts` avisa, na seção "Leitura ANINHADA", que relação que
 * passa por `User` sai do tenant — `User` não tem `companyId`, e as relações
 * INVERSAS dele (`leadsAtribuidos`, `auditLogs`, ...) trazem linha de toda
 * empresa em que a pessoa tenha vínculo. O que se atravessa aqui é o sentido
 * DIRETO (`AuditLog.user`, uma FK para uma linha só), e o `select` fechado em
 * `id`/`nome` não desce para relação nenhuma. Nenhuma linha a mais entra por
 * este `select` — é uma junção 1:1 a partir de linhas que o escopo já filtrou.
 */
export async function listarAtividadeRecente(
  companyId: string,
  limite: number = LIMITE_ATIVIDADE_RECENTE
): Promise<AtividadeRecente[]> {
  const db = prismaDaEmpresa(companyId);

  return db.auditLog.findMany({
    take: limite,
    orderBy: { criadoEm: "desc" },
    select: {
      id: true,
      acao: true,
      entidade: true,
      entidadeId: true,
      criadoEm: true,
      user: { select: { id: true, nome: true } },
    },
  });
}
