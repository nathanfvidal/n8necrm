import crypto from "node:crypto";

import { handleCallback } from "@vercel/queue";
import { z } from "zod";

import { processarTurno } from "@/modules/whatsapp/turno";

/**
 * Consumidor da fila "whatsapp-turn" (Vercel Queues).
 *
 * ## Superfície de rede
 *
 * A documentação oficial da Vercel confirma que uma rota com
 * `experimentalTriggers` (queue/v2beta) fica "completamente air-gapped da
 * internet... só pode ser invocada pela infraestrutura interna de fila da
 * Vercel" (vercel.com/docs/queues/concepts, seção "Consumer function
 * security" — verificado ao vivo nesta rodada de fix, não checável de outra
 * forma neste ambiente sem deploy real). A inspeção do código-fonte de
 * `@vercel/queue` (achado do revisor, I1) confirma que o SDK em si não faz
 * NENHUMA verificação de assinatura/OIDC na requisição recebida — ele
 * confia inteiramente nessa garantia de rede da plataforma. Por isso este
 * handler valida um segredo compartilhado (`segredoValido` abaixo) embutido
 * no PRÓPRIO payload do job por `fila.ts#publicarTurno` — segunda camada
 * barata que não depende de nenhum comportamento de plataforma não
 * verificável a partir daqui. **Teste real que falta**: um humano, já com
 * deploy real, rodar `curl -i -X POST
 * https://<deployment>/api/queues/whatsapp-turn` com um CloudEvent forjado
 * e confirmar que a resposta é bloqueada na borda (não chega a este
 * código) — se ao invés disso a requisição chegar aqui e for respondida,
 * este segredo é a única coisa impedindo alguém de disparar
 * `processarTurno` com um `conversationId` arbitrário.
 *
 * ## Retry
 *
 * `handleCallback` faz o parsing do CloudEvent e chama este handler com a
 * mensagem já desserializada — se o handler lançar, a mensagem NÃO é
 * confirmada e é reentregue depois do `retryAfterSeconds` configurado em
 * `vercel.json` (retry automático da própria fila, distinto do
 * `publicarTurno(..., { delaySeconds: 5 })` que `turno.ts` usa para o caso
 * "lease ocupado" — aquele é um reagendamento deliberado do NOSSO código;
 * este é o retry padrão da infraestrutura de fila para falha inesperada).
 * Um segredo inválido NÃO lança (evita reentrega infinita de uma mensagem
 * forjada que nunca vai ficar válida) — só loga e retorna, confirmando a
 * entrega sem processar nada.
 */
export const POST = handleCallback(async (mensagemBruta) => {
  const job = turnoJobSchema.parse(mensagemBruta);

  if (!segredoValido(job.segredo)) {
    console.error(
      "Mensagem da fila whatsapp-turn rejeitada: segredo compartilhado não confere " +
        "(payload forjado, ou WHATSAPP_QUEUE_SECRET rotacionado sem esvaziar a fila)."
    );
    return;
  }

  await processarTurno(job);
});

const turnoJobSchema = z.object({
  // Obrigatório, e NÃO opcional com padrão: job publicado antes do Ciclo 1d não
  // carrega `companyId`, e um padrão o faria rodar na empresa errada em
  // silêncio. Assim ele é recusado aqui, o handler lança, a fila reentrega e
  // desiste — barulhento e limitado à janela de deploy. Ver o bloco de
  // cabeçalho de `modules/whatsapp/turno.ts`.
  companyId: z.string().min(1),
  conversationId: z.string().min(1),
  seq: z.number().int(),
  tentativaReagendamento: z.number().int().nonnegative().optional(),
  segredo: z.string().min(1),
});

function segredoValido(recebido: string): boolean {
  const esperado = process.env.WHATSAPP_QUEUE_SECRET;
  if (!esperado) return false;

  const bufferRecebido = Buffer.from(recebido);
  const bufferEsperado = Buffer.from(esperado);
  if (bufferRecebido.length !== bufferEsperado.length) return false;
  return crypto.timingSafeEqual(bufferRecebido, bufferEsperado);
}

// Fix round 1/5, achado CRÍTICO do revisor (C1): sem um teto explícito de
// duração, nada limitava quanto tempo esta função serverless podia rodar
// além do pior caso que `LEASE_DURACAO_MS` (turno.ts) assume estar coberto.
// 60s é o teto do plano Hobby da Vercel (o mais restritivo — plano real do
// deploy não verificável neste ambiente; se for Pro/Enterprise, pode subir
// junto com `LEASE_DURACAO_MS`). Cobre com folga o pior caso combinado de
// processamento: `OpenAiProvider` limitado a ~40s (timeout de 20s * até 2
// tentativas do SDK) + envio via gateway. `LEASE_DURACAO_MS` = 75s fica
// ACIMA deste teto de propósito: se a função for encerrada pela plataforma
// no meio do processamento (matando o processo sem rodar o `finally` que
// libera o lease), o lease ainda assim expira sozinho pouco depois — o
// fencing token de `turno.ts` garante que essa expiração tardia nunca
// resulta em dois processadores ativos ao mesmo tempo, só num intervalo a
// mais em que a conversa fica "presa" antes de se auto-recuperar.
export const maxDuration = 60;
