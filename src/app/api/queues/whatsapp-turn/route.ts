import { handleCallback } from "@vercel/queue";
import { z } from "zod";

import { processarTurno } from "@/modules/whatsapp/turno";

/**
 * Consumidor da fila "whatsapp-turn" (Vercel Queues). Sem URL pública real —
 * a Vercel só invoca esta rota internamente quando um job do tópico
 * declarado em `vercel.json` está pronto (ver comentário lá e em
 * `src/proxy.ts` sobre por que isso é seguro mesmo o proxy deixando
 * `/api/queues/*` passar).
 *
 * `handleCallback` (`@vercel/queue`) faz o parsing do CloudEvent e chama
 * este handler com `(mensagem, metadata)` já desserializados — se o handler
 * lançar, a mensagem NÃO é confirmada e é reentregue depois do
 * `retryAfterSeconds` configurado em `vercel.json` (retry automático da
 * própria fila, distinto do `publicarTurno(..., { delaySeconds: 5 })` que
 * `turno.ts` usa para o caso "lease ocupado" — aquele é um reagendamento
 * deliberado do NOSSO código; este é o retry padrão da infraestrutura de
 * fila para falha inesperada).
 */
export const POST = handleCallback(async (mensagemBruta) => {
  const job = turnoJobSchema.parse(mensagemBruta);
  await processarTurno(job);
});

const turnoJobSchema = z.object({
  conversationId: z.string().min(1),
  seq: z.number().int(),
});
