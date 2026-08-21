import "server-only";

import { processarTurno } from "../turno";
import {
  concluirJob,
  falharJob,
  podarJobsMortos,
  reivindicarJob,
} from "./postgres";

/**
 * O drenador da fila: reivindica, processa, conclui ou falha, e repete.
 *
 * ## Por que ele é uma FUNÇÃO, e não uma rota nem um laço
 *
 * A hospedagem deste projeto está em aberto (decisão do dono, 2026-08-21), e o
 * desenho não pode presumir nenhuma. Toda a lógica mora aqui, e os DOIS
 * gatilhos possíveis são cascas finas em volta desta função:
 *
 * - `src/app/api/queues/whatsapp-turn/route.ts` — HTTP, autenticado por
 *   cabeçalho. Serve a `pg_cron`+`pg_net`, a `cron`+`curl`, a um agendador de
 *   plataforma, ou a um workflow do n8n.
 * - `scripts/fila-worker.ts` — laço em processo, sem abrir porta nenhuma.
 *   Quem usar essa forma pode deixar a rota inacessível de fora.
 *
 * Nenhum dos dois é ligado por padrão. **Sem um deles rodando, a fila enche e
 * ninguém responde** — é a única regressão funcional da saída da Vercel, que
 * empurrava sozinha, e está escrita em `.env.example` e em `docs/ESTADO.md`.
 */

/**
 * Teto de duração de UM turno.
 *
 * Isto não é zelo: é a reposição de uma garantia que a plataforma dava.
 * `export const maxDuration = 60` na rota consumidora era o teto do plano Hobby
 * da Vercel, e o comentário de `LEASE_DURACAO_MS` (`../turno.ts`) diz
 * textualmente que os 75s do lease da CONVERSA foram escolhidos para ficar
 * ACIMA dele. Fora da Vercel nada mata a função. Sem este teto, um
 * `processarTurno` pendurado passaria dos 75s, o lease da conversa expiraria
 * embaixo dele, e o fencing token — que existe para o caso RARO — viraria o
 * caso comum.
 *
 * A ordem `TEMPO_MAX_TURNO_MS < LEASE_DURACAO_MS < JOB_LEASE_MS` (60 < 75 < 90)
 * é invariante, e `tests/unit/fila-consumidor.test.ts` a lê das três constantes
 * em vez de afirmá-la em prosa.
 */
export const TEMPO_MAX_TURNO_MS = 60_000;

/**
 * Quantos jobs uma drenagem trata antes de devolver o controle.
 *
 * Existe porque o gatilho HTTP é SÍNCRONO: quem chama espera. Sem teto, uma
 * fila com mil jobs seguraria a requisição por horas e estouraria qualquer
 * timeout de cliente. Com teto, a resposta diz `esgotou: false` e quem
 * agenda sabe que vale chamar de novo já.
 */
export const LOTE_MAX_PADRAO = 10;

/**
 * Mesma poda probabilística de `core/rate-limit/limiter.ts` e
 * `core/notifications/dispatch.ts`, e pelo mesmo motivo de fundo: limpeza que
 * depende de alguém configurar algo pode nunca entrar em vigor.
 *
 * Depois deste ciclo existe um laço nosso, então a justificativa original
 * ("cron exigiria configuração no painel da Vercel") enfraqueceu — mas a
 * decisão fica: esta poda vale sozinha, sem configuração nenhuma, e é isso que
 * a distingue de um agendamento que alguém precisa lembrar de ligar.
 */
export const CHANCE_DE_PODA = 0.01;

export interface ResultadoDrenagem {
  processados: number;
  falhados: number;
  mortos: number;
  /** `true` quando a fila acabou antes do lote — nada mais pronto agora. */
  esgotou: boolean;
}

export async function drenarFila(opcoes?: { loteMax?: number }): Promise<ResultadoDrenagem> {
  const loteMax = opcoes?.loteMax ?? LOTE_MAX_PADRAO;
  const resultado: ResultadoDrenagem = {
    processados: 0,
    falhados: 0,
    mortos: 0,
    esgotou: false,
  };

  for (let i = 0; i < loteMax; i++) {
    const job = await reivindicarJob();
    if (!job) {
      resultado.esgotou = true;
      return resultado;
    }

    try {
      await comTeto(
        processarTurno({
          companyId: job.companyId,
          conversationId: job.conversationId,
          seq: job.seq,
          tentativaReagendamento: job.tentativaReagendamento,
        }),
        TEMPO_MAX_TURNO_MS
      );

      const concluido = await concluirJob(job.companyId, job.id, job.leaseAte);
      if (!concluido) {
        // Lease perdido entre o início e o fim do turno. Não é falha do turno —
        // é o sistema se recuperando de um atraso. Vale log, não alarme: quem
        // reivindicou depois vai reprocessar, e `processarMensagensPendentes`
        // não tem o que fazer se o primeiro já respondeu.
        console.warn(
          `Turno da conversa ${job.conversationId} terminou com o lease do job já expirado ` +
            `(job ${job.id}) — outro consumidor pode ter reivindicado no meio.`
        );
      }
      resultado.processados++;
    } catch (erro) {
      const desfecho = await falharJob(
        job.companyId,
        job.id,
        job.leaseAte,
        erro instanceof Error ? erro.message : String(erro)
      );

      if (desfecho === "morto") {
        resultado.mortos++;
        // Barulhento de propósito: um job morto é uma conversa que NÃO foi
        // respondida. A linha fica em `TurnoJob` com `ultimoErro` por 7 dias,
        // mas quem lê log não vai ao banco por conta própria.
        console.error(
          `Job da conversa ${job.conversationId} (empresa ${job.companyId}, job ${job.id}) ` +
            `MORREU depois de esgotar as tentativas de entrega. A conversa ficou sem resposta.`
        );
      } else {
        resultado.falhados++;
      }
    }

    await podarDeVezEmQuando(job.companyId);
  }

  return resultado;
}

/**
 * `Promise.race` com um temporizador, e o `clearTimeout` no `finally`.
 *
 * A ressalva honesta: isto **não cancela** `processarTurno` — não há como, e
 * fingir que há seria pior. A promessa abandonada continua rodando até
 * terminar sozinha. O que o teto garante é que o LAÇO segue em frente e que o
 * job é liberado para retentativa. A segurança do que ficou para trás vem de
 * outro lugar, e ele já existe: o fencing token de `confirmarTitularidadeLease`
 * (`../turno.ts`), que faz o turno atrasado abortar ANTES de enviar qualquer
 * mensagem quando o lease da conversa já não é dele.
 */
async function comTeto<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promessa,
      new Promise<never>((_, rejeitar) => {
        temporizador = setTimeout(
          () => rejeitar(new Error(`Turno passou do teto de ${ms}ms sem terminar.`)),
          ms
        );
      }),
    ]);
  } finally {
    if (temporizador) clearTimeout(temporizador);
  }
}

async function podarDeVezEmQuando(companyId: string): Promise<void> {
  if (Math.random() >= CHANCE_DE_PODA) return;
  try {
    await podarJobsMortos(companyId);
  } catch (erro) {
    // Higiene, não decisão: falhar aqui nunca pode impedir a fila de andar.
    // E REGISTRA em vez de engolir — um `catch` vazio faria a poda sumir sem
    // ninguém notar, e a tabela voltaria a crescer em silêncio.
    console.error("Falha ao podar jobs mortos da fila:", erro);
  }
}
