// Sem `import "server-only"` aqui, de propósito — a marcação fica em
// `./index.ts`, mesmo padrão de `gateway/evolution.ts` e do adaptador da Vercel
// (`./vercel.ts`, que este substitui e que continua vivo até a tarefa de
// contração). `tests/unit/fila-postgres.test.ts` importa deste arquivo direto,
// e o `server-only` aqui quebraria esse import sob Vitest — a mesma divisão que
// `./tipos.ts` documenta para o contrato.
import { prismaDaEmpresa } from "@/core/tenancy/escopo";
import { prisma } from "@/lib/prisma";

import type { FilaTurnos, OpcoesPublicacao, TurnoJob } from "./tipos";

/**
 * A fila de turnos, em Postgres — o segundo adaptador de `FilaTurnos`, e o que
 * o comentário de `./index.ts` previu quando nomeou pg-boss e BullMQ.
 *
 * ## Por que este arquivo importa o prisma CRU, e por que a exceção é PERMANENTE
 *
 * Três dos quatro caminhos daqui usam `prismaDaEmpresa(companyId)`: publicar
 * (a empresa vem do job, resolvida pela CONEXÃO no webhook desde o Ciclo 2a),
 * concluir/falhar e podar (a empresa vem do `RETURNING` da reivindicação). O
 * quarto — `reivindicarJob` — é cross-tenant POR CONSTRUÇÃO: o consumidor roda
 * fora de qualquer requisição, sem sessão, e a pergunta que ele faz ao banco é
 * "qual o próximo job de QUALQUER empresa está pronto".
 * `prismaDaEmpresa(companyId)` exigiria como parâmetro exatamente o valor que o
 * `UPDATE ... RETURNING "companyId"` devolve.
 *
 * É a mesma circularidade que já isenta `core/auth/session.ts`,
 * `core/auth/credenciais.ts` e `core/users/empresa.ts` na `EXCECAO_PERMANENTE`
 * do `eslint.config.mjs` — e é verificável em uma linha, do mesmo jeito que a
 * delas. É também a PRIMEIRA exceção permanente fora de `src/core/**`.
 *
 * **O que se perde, dito em voz alta:** a Parte 2b de
 * `tests/unit/catraca-prisma-cru.test.ts` — que lê o texto do SQL cru e reprova
 * quem citar tabela de tenant sem `companyId` — não cobre arquivo listado no
 * eslint. A compensação é o bloco "a forma do SQL cru deste módulo" em
 * `tests/unit/fila-postgres.test.ts`: um único SQL cru, nenhuma escrita crua,
 * `companyId` no `RETURNING`, e a exigência de que ele saia do cliente CRU —
 * porque um SQL cru pendurado num cliente escopado compilaria e daria a
 * APARÊNCIA de escopo onde não há nenhum.
 */

/**
 * Atraso padrão da publicação: a janela de buffer de fragmentos.
 *
 * Mesmo 8s do adaptador da Vercel. A interface `OpcoesPublicacao` não muda, e o
 * reagendamento por lease ocupado continua passando 5s explicitamente.
 */
export const DELAY_PADRAO_SEGUNDOS = 8;

/**
 * Quanto tempo um job fica reservado para quem o reivindicou.
 *
 * Fica ACIMA do lease da CONVERSA (`LEASE_DURACAO_MS`, 75s em `../turno.ts`),
 * que por sua vez fica acima do teto de processamento por turno. A ordem
 * 60 < 75 < 90 é invariante: se o job fosse reentregue ANTES de o turno
 * anterior ter desistido, dois turnos disputariam a mesma conversa e o segundo
 * só descobriria isso no `claimLease` — o caso RARO viraria o caso comum.
 *
 * A desigualdade é afirmação universal, então ela tem exercício próprio: o
 * caso do teto de turno mora na tarefa do consumidor
 * (`tests/unit/fila-consumidor.test.ts`), que lê as três constantes.
 */
export const JOB_LEASE_MS = 90_000;

/**
 * Espera antes de reentregar um job cujo handler lançou.
 *
 * 30s é o mesmo número que `retryAfterSeconds` usava em `vercel.json`. Manter o
 * valor é deliberado: a troca de fila não é hora de recalibrar tempo de
 * retentativa, porque uma mudança de comportamento escondida dentro de uma
 * migração de infraestrutura é a que ninguém consegue atribuir depois.
 */
export const RETRY_APOS_MS = 30_000;

/**
 * Quantas ENTREGAS um job aguenta antes de ser dado por morto.
 *
 * A contagem sobe na REIVINDICAÇÃO, não na conclusão. É essa escolha que faz um
 * job envenenado — o que derruba o processo antes de qualquer `catch` rodar —
 * morrer também, em vez de girar para sempre. Sem teto, o modo de falha é uma
 * conversa que consome o consumidor inteiro indefinidamente.
 *
 * A condição de morte é AVALIADA aqui e GRAVADA em `mortoEm` (ver o bloco do
 * modelo em `prisma/schema.prisma`): subir esta constante não ressuscita job
 * morto antigo.
 */
export const MAX_TENTATIVAS_ENTREGA = 5;

/**
 * Por quanto tempo um job MORTO é mantido.
 *
 * Ele fica, e o job concluído não, porque as duas linhas contam coisas
 * diferentes: a concluída é trabalho feito, cujo registro já existe em
 * `WhatsappMessage.processadoEm` e em `AuditLog`; a morta é a única evidência
 * de que uma conversa NÃO foi respondida. Apagá-la em silêncio apagaria o
 * sintoma junto com o dado.
 */
export const RETENCAO_JOB_MORTO_MS = 7 * 24 * 60 * 60_000;

/**
 * Teto do texto do erro guardado.
 *
 * A coluna é `String?` sem limite e a mensagem vem de fora (um erro do gateway,
 * do provedor de IA, ou um stack inteiro). Guardar tudo é convite a uma linha
 * de megabytes numa tabela que a reivindicação varre.
 */
const MAX_CARACTERES_ULTIMO_ERRO = 1_000;

export interface JobReivindicado {
  id: string;
  companyId: string;
  conversationId: string;
  seq: number;
  tentativaReagendamento: number;
  tentativasEntrega: number;
  /** O fencing token: o `leaseAte` que ESTA reivindicação escreveu. */
  leaseAte: Date;
}

/**
 * A chave de deduplicação.
 *
 * Mesma forma que a `idempotencyKey` do adaptador da Vercel usava, e pelo mesmo
 * motivo (fix round 1/5, achado C2): sem o sufixo por tentativa, o job
 * reagendado colidia com a própria publicação original, a publicação virava
 * no-op, e o reagendamento de 5s nunca acontecia.
 */
function chaveIdempotencia(job: TurnoJob): string {
  const tentativa = job.tentativaReagendamento ?? 0;
  return tentativa > 0
    ? `${job.conversationId}:${job.seq}:r${tentativa}`
    : `${job.conversationId}:${job.seq}`;
}

export class FilaPostgres implements FilaTurnos {
  /**
   * `createMany` com `skipDuplicates`, e não `create`, porque duplicata aqui
   * NÃO é erro: os dois chamadores de `publicarTurno` (`../turno.ts` e a rota
   * do webhook) já traduziam o `DuplicateMessageError` da Vercel para "tudo
   * bem" e seguiam. A tradução passa a acontecer aqui, e com ela o último tipo
   * de provedor some de fora do adaptador — `publicar` continua
   * `Promise<void>`.
   *
   * A janela de dedupe MUDA, e a mudança está declarada: na Vercel a chave
   * ficava reservada por `min(retenção, 24h)`; aqui ela vale enquanto a LINHA
   * existir, e a linha some quando o job conclui. Republicar a mesma chave
   * depois da conclusão cria um job novo — que é inofensivo porque o segundo
   * turno encontra `pendentes.length === 0` (o primeiro já gravou
   * `processadoEm`) e retorna sem enviar nada.
   *
   * `prismaDaEmpresa` e não o cliente cru: aqui a empresa EXISTE antes de tocar
   * o banco, então o escopo confere que o `companyId` do dado bate com o do
   * cliente — e recusa, lançando, quando não bate.
   */
  async publicar(job: TurnoJob, opcoes?: OpcoesPublicacao): Promise<void> {
    const atrasoS = opcoes?.delaySeconds ?? DELAY_PADRAO_SEGUNDOS;

    await prismaDaEmpresa(job.companyId).turnoJob.createMany({
      data: [
        {
          companyId: job.companyId,
          conversationId: job.conversationId,
          seq: job.seq,
          tentativaReagendamento: job.tentativaReagendamento ?? 0,
          chaveIdempotencia: chaveIdempotencia(job),
          disponivelEm: new Date(Date.now() + atrasoS * 1_000),
        },
      ],
      skipDuplicates: true,
    });
  }
}

/**
 * Reivindica o próximo job pronto, de qualquer empresa, e devolve o `leaseAte`
 * que esta chamada escreveu — o fencing token.
 *
 * ## Por que as condições aparecem DUAS vezes
 *
 * O subselect ESCOLHE a linha; a cláusula de fora é o que torna a escolha
 * atômica. Sob `READ COMMITTED`, dois consumidores podem avaliar o subselect no
 * mesmo instante e chegar ao mesmo `id`; o segundo bloqueia no lock de linha e,
 * ao destravar, reavalia a cláusula do PRÓPRIO `UPDATE` contra a versão nova da
 * linha. Se a condição de lease só existisse no subselect (já avaliado), o
 * `"id" = X` de fora continuaria casando e o segundo reivindicaria o job que o
 * primeiro acabou de pegar.
 *
 * É o mesmo raciocínio do `AND ("processandoAte" IS NULL OR ...)` de
 * `claimLease` (`../turno.ts`), e é ele que faz a garantia — não o
 * `SKIP LOCKED`.
 *
 * `FOR UPDATE SKIP LOCKED` é a OUTRA metade, e ela é de VAZÃO, não de correção:
 * sem ele, N consumidores enfileiram no lock da MESMA linha e todos menos um
 * saem de mãos vazias depois de esperar; com ele, cada um pula para a próxima
 * linha livre.
 *
 * As duas metades são provadas juntas pelo caso "N reivindicações CONCORRENTES
 * sobre M jobs devolvem ids DISTINTOS" (`tests/unit/fila-postgres.test.ts`),
 * com `Promise.all` contra o Postgres real — mesmo método que
 * `tests/unit/rate-limit.test.ts` usa para a atomicidade do limiter.
 *
 * ## Por que aqui não há `WHERE "companyId"`
 *
 * `claimLease` escreve o `WHERE "companyId"` à mão porque ele SABE a empresa.
 * Aqui ela é o RESULTADO: o `RETURNING` a devolve, e é dela que saem os
 * clientes escopados de `concluirJob`, `falharJob` e `podarJobsMortos`. Um
 * `WHERE "companyId"` aqui exigiria um valor que ainda não existe.
 */
export async function reivindicarJob(): Promise<JobReivindicado | null> {
  const agora = new Date();
  const ateLease = new Date(agora.getTime() + JOB_LEASE_MS);

  const linhas = await prisma.$queryRaw<JobReivindicado[]>`
    UPDATE "TurnoJob"
    SET "leaseAte" = ${ateLease}::timestamp(3),
        "tentativasEntrega" = "tentativasEntrega" + 1
    WHERE "id" = (
      SELECT "id" FROM "TurnoJob"
      WHERE "mortoEm" IS NULL
        AND "disponivelEm" <= ${agora}::timestamp(3)
        AND ("leaseAte" IS NULL OR "leaseAte" < ${agora}::timestamp(3))
      ORDER BY "disponivelEm" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
      AND "mortoEm" IS NULL
      AND "disponivelEm" <= ${agora}::timestamp(3)
      AND ("leaseAte" IS NULL OR "leaseAte" < ${agora}::timestamp(3))
    RETURNING "id", "companyId", "conversationId", "seq",
              "tentativaReagendamento", "tentativasEntrega", "leaseAte"
  `;

  return linhas[0] ?? null;
}

/**
 * Apaga o job concluído — mas SÓ se `leaseAte` ainda for o token desta
 * reivindicação.
 *
 * Sem o fencing (achado C1, que `../turno.ts` já corrigiu no lease da
 * CONVERSA), um consumidor lento que termina DEPOIS de o lease dele ter
 * expirado e de outro ter reivindicado o mesmo job apagaria o trabalho de quem
 * está ativo.
 *
 * Devolve `false` quando não apagou nada — o chamador registra, não relança:
 * perder o lease não é falha do turno, é o sistema se recuperando.
 */
export async function concluirJob(
  companyId: string,
  jobId: string,
  token: Date
): Promise<boolean> {
  const { count } = await prismaDaEmpresa(companyId).turnoJob.deleteMany({
    where: { id: jobId, leaseAte: token },
  });
  return count === 1;
}

export type DesfechoFalha = "reagendado" | "morto" | "lease-perdido";

/**
 * Trata um job cujo processamento falhou: reagenda, ou mata se já esgotou as
 * tentativas.
 *
 * Duas instruções, nesta ordem, e as duas carregam o fencing (`leaseAte:
 * token`). A primeira só casa quando ainda há tentativa sobrando; quando ela
 * não casa, a segunda decide entre "morreu agora" e "perdi o lease" — e essa
 * distinção importa, porque os dois desfechos merecem log diferente: morte é
 * conversa sem resposta, lease perdido é o sistema se recuperando sozinho.
 *
 * A condição de morte olha `tentativasEntrega`, que a REIVINDICAÇÃO já
 * incrementou. Na chamada em que o contador chega a `MAX_TENTATIVAS_ENTREGA`,
 * o `lt` falha e o job morre — foram, portanto, exatamente
 * `MAX_TENTATIVAS_ENTREGA` entregas.
 */
export async function falharJob(
  companyId: string,
  jobId: string,
  token: Date,
  erro: string
): Promise<DesfechoFalha> {
  const db = prismaDaEmpresa(companyId);
  const agora = new Date();
  const ultimoErro = erro.slice(0, MAX_CARACTERES_ULTIMO_ERRO);

  const reagendado = await db.turnoJob.updateMany({
    where: { id: jobId, leaseAte: token, tentativasEntrega: { lt: MAX_TENTATIVAS_ENTREGA } },
    data: {
      leaseAte: null,
      disponivelEm: new Date(agora.getTime() + RETRY_APOS_MS),
      ultimoErro,
    },
  });
  if (reagendado.count === 1) return "reagendado";

  const morto = await db.turnoJob.updateMany({
    where: { id: jobId, leaseAte: token },
    data: { leaseAte: null, mortoEm: agora, ultimoErro },
  });
  return morto.count === 1 ? "morto" : "lease-perdido";
}

/**
 * Apaga jobs MORTOS além da retenção. Devolve quantos saíram.
 *
 * Por empresa, igual a `podarNotificacoes` (`core/notifications/dispatch.ts`) e
 * a `podarRateLimitExpirado` (`core/rate-limit/limiter.ts`), e herda a mesma
 * limitação conhecida: empresa sem tráfego não tem quem pode a tabela dela.
 * Aqui isso é benigno — o que faz a tabela crescer é uso, e sem uso não há job
 * morto para acumular.
 *
 * Job VIVO nunca é alcançado, por mais velho que seja: o filtro é `mortoEm`, e
 * não `criadoEm`. O caso de teste com um job de um ano exercita exatamente
 * isso, porque uma poda que apagasse job vivo apagaria mensagem não respondida.
 */
export async function podarJobsMortos(
  companyId: string,
  retencaoMs: number = RETENCAO_JOB_MORTO_MS
): Promise<number> {
  const corte = new Date(Date.now() - retencaoMs);
  const { count } = await prismaDaEmpresa(companyId).turnoJob.deleteMany({
    where: { mortoEm: { lt: corte } },
  });
  return count;
}
