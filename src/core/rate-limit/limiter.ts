import { prisma } from "@/lib/prisma";

/**
 * Rate limiter de janela fixa ("fixed window counter"), persistido em
 * Postgres (tabela RateLimit). Uma chamada consome uma unidade da janela
 * atual; retorna `false` quando `chave` já esgotou `limite` chamadas dentro
 * dos últimos `janelaMs` milissegundos.
 *
 * ## Atomicidade
 *
 * A versão do brief fazia `findUnique` seguido de `update`/`upsert` em duas
 * roundtrips separadas. Duas chamadas concorrentes podiam ler a mesma
 * `contagem` (ex.: 4 de um limite de 5) antes que qualquer uma escrevesse,
 * e as duas prosseguiam — o limite vazava sob concorrência.
 *
 * Aqui a leitura e a escrita acontecem em uma única instrução SQL
 * (`INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING`). O Postgres toma um
 * lock de linha sobre a chave em conflito durante essa instrução, então
 * chamadas concorrentes para a mesma `chave` serializam nesse lock — não há
 * janela entre "ler contagem" e "escrever contagem" em que outra chamada
 * possa se intrometer. Isso é comprovado por um teste com `Promise.all`
 * disparando chamadas simultâneas (tests/unit/rate-limit.test.ts).
 *
 * `contagem` é limitada a `limite + 1` via `LEAST(...)` para não crescer
 * sem limite sob um flood sustentado (o cenário que este limiter existe
 * para conter) — o valor exato acima do limite não importa, só que ele
 * ultrapassou.
 *
 * ## Semântica de janela
 *
 * Janela FIXA, não deslizante: `janelaInicio` só é reescrito quando a janela
 * expira (`agora - janelaInicio > janelaMs`). Enquanto a janela está ativa,
 * `janelaInicio` permanece parado e `contagem` incrementa. Consequências:
 *
 * - Primeira chamada de uma chave nova: sempre permitida, `janelaInicio` é
 *   `agora`, `contagem = 1`.
 * - Uma chave nunca fica bloqueada por mais que ~`janelaMs`: assim que
 *   `agora - janelaInicio > janelaMs`, a próxima chamada reseta a janela e é
 *   permitida — não há acúmulo de bloqueio além disso.
 * - Trade-off conhecido de janela fixa (vs. janela deslizante): é possível
 *   um burst de até `2 * limite` chamadas ao redor da borda entre duas
 *   janelas (`limite` no fim de uma janela + `limite` no início da
 *   seguinte). Aceitável aqui: o objetivo é conter flood de bot no
 *   formulário público, não impor uma taxa exata.
 */
export async function checarRateLimit(
  chave: string,
  limite: number,
  janelaMs: number
): Promise<boolean> {
  const agora = new Date();

  const linhas = await prisma.$queryRaw<Array<{ contagem: number }>>`
    INSERT INTO "RateLimit" ("chave", "janelaInicio", "contagem")
    VALUES (${chave}, ${agora}::timestamp(3), 1)
    ON CONFLICT ("chave") DO UPDATE SET
      "janelaInicio" = CASE
        WHEN ${agora}::timestamp(3) - "RateLimit"."janelaInicio"
             > (${janelaMs}::double precision * interval '1 millisecond')
        THEN ${agora}::timestamp(3)
        ELSE "RateLimit"."janelaInicio"
      END,
      "contagem" = CASE
        WHEN ${agora}::timestamp(3) - "RateLimit"."janelaInicio"
             > (${janelaMs}::double precision * interval '1 millisecond')
        THEN 1
        ELSE LEAST("RateLimit"."contagem" + 1, ${limite}::integer + 1)
      END
    RETURNING "contagem";
  `;

  const contagem = linhas[0]?.contagem ?? 0;
  return contagem <= limite;
}
