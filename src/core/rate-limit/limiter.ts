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
  const permitido = contagem <= limite;

  // Higiene DEPOIS da decisão, nunca antes: a poda não pode influenciar (nem
  // atrasar) o resultado que esta função existe para dar.
  await podarDeVezEmQuando();

  return permitido;
}

/**
 * Por quanto tempo uma linha de `RateLimit` é mantida depois do último toque.
 *
 * **Invariante que sustenta a segurança da poda:** este valor precisa ser
 * MAIOR que a maior `janelaMs` usada por qualquer política do sistema (hoje
 * 1h, do export de leads — ver `./export-leads.ts`; o login usa 10min e o
 * webhook 1min). Dentro dessa folga não existe janela viva que a poda possa
 * alcançar, e apagar linha já expirada é inócuo: a janela é FIXA, então a
 * próxima chamada daquela chave reescreveria `janelaInicio` e zeraria a
 * contagem de qualquer jeito. A poda só chega ao mesmo estado mais cedo.
 *
 * Quem criar uma política com janela acima de 24h precisa subir este número
 * junto — senão a poda passa a apagar bloqueio vivo, ou seja, a liberar quem
 * deveria estar barrado. `tests/unit/rate-limit.test.ts` guarda o invariante.
 */
export const RETENCAO_RATE_LIMIT_MS = 24 * 60 * 60_000;

/**
 * Apaga as linhas cuja janela expirou há mais que a retenção. Devolve quantas
 * saíram.
 *
 * Existe porque a tabela nunca era limpa, e uma das chaves é escolhida por
 * quem faz a requisição a partir de um endpoint SEM autenticação:
 * `login:conta:<email>` (`./login.ts`) deriva do e-mail digitado no POST de
 * login, então cada e-mail inédito criava uma linha permanente. O limite por
 * IP segura o ritmo, mas não o total — o crescimento era ilimitado e escalava
 * com o número de origens. Um controle antiabuso não pode ser, ele mesmo, uma
 * superfície de escrita não autenticada.
 */
export async function podarRateLimitExpirado(
  retencaoMs: number = RETENCAO_RATE_LIMIT_MS
): Promise<number> {
  const corte = new Date(Date.now() - retencaoMs);
  const { count } = await prisma.rateLimit.deleteMany({
    where: { janelaInicio: { lt: corte } },
  });
  return count;
}

/**
 * Chance de uma chamada qualquer de `checarRateLimit` também podar.
 *
 * Poda probabilística (o padrão que sessões de PHP e a limpeza do Django
 * usam) em vez de cron agendado, por uma razão concreta deste projeto: um
 * cron exigiria rota nova (superfície nova, que precisaria do próprio
 * segredo) e configuração no painel da Vercel. Correção que só funciona
 * depois de alguém configurar algo é correção que pode nunca entrar em
 * vigor — e o deploy deste projeto já deu trabalho. Assim a limpeza passa a
 * valer sozinha, sem configuração nenhuma.
 *
 * 1% mantém a tabela pequena com folga (o login sozinho já produz muito mais
 * que 100 chamadas por dia) e deixa 99 de cada 100 requisições sem custo
 * extra.
 *
 * A chance NÃO depende da chave nem do e-mail, o que importa para o login:
 * `credenciais.ts` compara um hash inerte de custo idêntico para que "conta
 * inexistente" e "senha errada" levem o mesmo tempo. Uma poda que fosse mais
 * provável para um dos dois casos reabriria por tempo a enumeração que aquele
 * código fechou; sorteio independente da entrada não reabre.
 */
const CHANCE_DE_PODA = 0.01;

async function podarDeVezEmQuando(): Promise<void> {
  if (Math.random() >= CHANCE_DE_PODA) return;
  try {
    await podarRateLimitExpirado();
  } catch {
    // Poda é higiene, não decisão de segurança. Se ela falhar, a checagem de
    // limite acima já foi decidida e continua valendo — engolir aqui é o que
    // impede um problema de limpeza de virar uma falha de autenticação.
  }
}
