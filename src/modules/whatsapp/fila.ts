import "server-only";

import { send } from "@vercel/queue";

/**
 * Wrapper fino sobre `@vercel/queue` — todo o resto do módulo (ingest.ts,
 * turno.ts, a rota do webhook) só conhece `publicarTurno`, nunca importa
 * `@vercel/queue` diretamente. A disponibilidade de Vercel Queues neste
 * projeto ainda não foi confirmada em produção (ver plano da Fatia 1); se
 * precisar trocar de implementação (outro provedor de fila, um fallback
 * síncrono, etc.), a troca fica contida a este arquivo.
 *
 * Tópico "whatsapp-turn" tem que bater com o nome do diretório da rota
 * consumidora (`src/app/api/queues/whatsapp-turn/route.ts`) e com o binding
 * declarado em `vercel.json` — os três precisam concordar.
 */
const TOPICO_TURNO = "whatsapp-turn";

export interface TurnoJob {
  conversationId: string;
  seq: number;
}

/**
 * Enfileira o processamento de um turno de conversa.
 *
 * `idempotencyKey: "${conversationId}:${seq}"` evita publicar o MESMO job
 * duas vezes (ex.: uma redelivery do webhook da Evolution que já foi
 * ingerida com sucesso, mas cujo enfileiramento falhou e foi reexecutado por
 * fora) — a janela de dedupe do Vercel Queues é `min(retenção, 24h)`, mais
 * que suficiente para o delay de 8s desta fatia.
 *
 * `delaySeconds` tem dois usos distintos, ambos documentados no plano:
 * - 8s (padrão, chamado por `ingest.ts` a cada mensagem ENTRADA nova): a
 *   janela de buffer que junta fragmentos de mensagem antes de responder.
 * - 5s (chamado por `turno.ts` quando o lease da conversa está ocupado):
 *   reagendamento curto, não um novo ciclo de buffer.
 */
export async function publicarTurno(job: TurnoJob, opcoes?: { delaySeconds?: number }): Promise<void> {
  await send(TOPICO_TURNO, job, {
    delaySeconds: opcoes?.delaySeconds ?? 8,
    idempotencyKey: `${job.conversationId}:${job.seq}`,
  });
}
