/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Um cliente Prisma falso que aceita o escopo de empresa DE VERDADE.
 *
 * ## Por que isto existe
 *
 * Os testes de unidade que mockam `@/lib/prisma` com um objeto de `vi.fn()`
 * pararam de funcionar quando os serviços passaram a alcançar o banco por
 * `prismaDaEmpresa(companyId)` (Ciclo 1d): a primeira coisa que aquela função
 * faz é `cliente.$extends(...)`, e um objeto sem `$extends` quebra com
 * `TypeError`.
 *
 * A saída óbvia — `$extends: () => cru` — é PIOR que quebrar. Ela faz o escopo
 * virar no-op silencioso, e toda asserção sobre `companyId` na forma da
 * consulta passa a afirmar o que o código escreve à mão em vez do que o escopo
 * injeta. Um serviço que perdesse o escopo inteiro continuaria verde. É a
 * armadilha 1 deste ciclo — "expectativa calculada com a mesma consulta que o
 * código faz não prova nada" — na sua forma de mock.
 *
 * Então este helper aplica a extensão de verdade: recebe o objeto de mocks,
 * devolve um cliente cujo `$extends` monta um mini-Prisma que chama
 * `query.$allModels.$allOperations` com o modelo em **PascalCase** (como o
 * Prisma real faz — observado na sondagem registrada em
 * `core/tenancy/escopo.ts`) e só então delega para o `vi.fn()`. Os mocks
 * recebem os argumentos JÁ ESCOPADOS, e as asserções de forma de consulta
 * continuam sendo sobre o que o Postgres receberia.
 *
 * O `$transaction` do cliente escopado passa o PRÓPRIO escopado como `tx` —
 * comportamento medido do Prisma real, onde `_createItxClient` reaplica as
 * extensões (ver o docstring de `prismaDaEmpresa`). Sem isso, uma escrita
 * dentro de `$transaction` escaparia do escopo e o teste ficaria verde por um
 * caminho que a produção não tem.
 *
 * ## O que ele NÃO é
 *
 * Não é um banco: nada é armazenado, nada é filtrado, e o `where` que chega ao
 * `vi.fn()` não seleciona nada — o mock devolve o que mandaram devolver. Quem
 * exercita o escopo contra dado é `tests/unit/escopo-empresa.test.ts` (banco
 * falso com tabelas em memória) e os `*-isolamento.test.ts` (Postgres de
 * verdade, duas empresas). Aqui o que se prova é a FORMA da consulta e a
 * DECISÃO do serviço.
 */
export function prismaFalsoEscopavel<T extends Record<string, any>>(cru: T): T {
  const alvo = cru as any;

  alvo.$extends = (extensao: any) => {
    const escopado: any = {
      $transaction: (cb: (tx: any) => unknown) => cb(escopado),
    };

    for (const modelo of Object.keys(alvo)) {
      if (typeof alvo[modelo] !== "object" || alvo[modelo] === null) continue;
      escopado[modelo] = {};
      for (const operacao of Object.keys(alvo[modelo])) {
        escopado[modelo][operacao] = (args: unknown) =>
          extensao.query.$allModels.$allOperations({
            model: modelo.charAt(0).toUpperCase() + modelo.slice(1),
            operation: operacao,
            args,
            query: (a: unknown) => alvo[modelo][operacao](a),
          });
      }
    }

    return escopado;
  };

  return alvo as T;
}
