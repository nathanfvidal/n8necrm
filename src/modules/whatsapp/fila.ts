import "server-only";

import { send } from "@vercel/queue";

import { z } from "zod";

// Fix round 1/5, achado IMPORTANTE do revisor (I1): a documentação oficial
// da Vercel confirma que uma rota consumidora configurada via
// `experimentalTriggers` (queue/v2beta) fica "completamente air-gapped da
// internet... só pode ser invocada pela infraestrutura interna de fila da
// Vercel" (vercel.com/docs/queues/concepts, seção "Consumer function
// security", verificado ao vivo nesta rodada de fix) — e a inspeção do
// código-fonte de `@vercel/queue` (dist/index.js, `parseCallback`/
// `parseBinaryHeaders`) confirma que o SDK em si NÃO faz nenhuma verificação
// de assinatura/OIDC na requisição recebida: ele confia inteiramente na
// garantia de rede da plataforma. Isso é uma garantia forte e documentada,
// não checável ao vivo neste ambiente (sem deploy real) — por isso, mesmo
// com essa confirmação, adicionamos uma segunda camada barata: um segredo
// compartilhado dentro do PRÓPRIO payload do job (não um header HTTP — a
// documentação não confirma se `SendOptions.headers` chega como header HTTP
// na entrega por push, então embutir no payload que nós mesmos serializamos
// e desserializamos não depende de nenhum comportamento de plataforma não
// verificado). Se o air-gapping documentado falhar por qualquer motivo
// (bug da plataforma, configuração errada), este segredo ainda impede que
// um POST forjado (ex.: `curl` direto contra a rota, se ela um dia se
// tornar alcançável) dispare `processarTurno` com um `conversationId`
// arbitrário.
const segredoEnvSchema = z.object({
  WHATSAPP_QUEUE_SECRET: z.string().min(1, {
    message: "WHATSAPP_QUEUE_SECRET ausente — defina no .env (openssl rand -hex 32)",
  }),
});

function getSegredoFila(): string {
  const resultado = segredoEnvSchema.safeParse({ WHATSAPP_QUEUE_SECRET: process.env.WHATSAPP_QUEUE_SECRET });
  if (!resultado.success) {
    throw new Error(
      `Configuração da fila do WhatsApp inválida: ${resultado.error.issues.map((i) => i.message).join("; ")}`
    );
  }
  return resultado.data.WHATSAPP_QUEUE_SECRET;
}

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
  /**
   * Fix round 1/5, achado CRÍTICO do revisor (C2): número de vezes que este
   * job foi REAGENDADO por `turno.ts` por causa de lease ocupado (não
   * confundir com `deliveryCount`, que é a contagem de retry NATIVA da
   * fila para falha de handler — este contador é só do NOSSO reagendamento
   * deliberado). `undefined`/`0` = publicação original (feita por
   * `ingest.ts`, nunca reagendada ainda). Existe porque `publicarTurno`
   * PRECISA de uma `idempotencyKey` diferente a cada reagendamento — ver o
   * comentário lá.
   */
  tentativaReagendamento?: number;
}

/**
 * Enfileira o processamento de um turno de conversa.
 *
 * ## `idempotencyKey`
 *
 * A publicação ORIGINAL (`tentativaReagendamento` ausente/0, sempre vinda de
 * `ingest.ts`) usa `"${conversationId}:${seq}"` — evita publicar o MESMO
 * job de buffer duas vezes (ex.: uma redelivery do webhook da Evolution que
 * já foi ingerida com sucesso, mas cujo enfileiramento falhou e foi
 * reexecutado por fora).
 *
 * Um REAGENDAMENTO (`turno.ts`, quando o lease da conversa está ocupado)
 * usa `"${conversationId}:${seq}:r${tentativaReagendamento}"` — uma chave
 * DIFERENTE a cada tentativa. Achado CRÍTICO do revisor (C2): antes desta
 * mudança, o reagendamento reusava a MESMA `idempotencyKey` da publicação
 * original. A janela de dedupe do Vercel Queues é `min(retenção, 24h)` — bem
 * maior que os 8s entre a publicação original e o primeiro reagendamento —
 * então TODA tentativa de reagendar por lease ocupado colidia com a
 * publicação original já registrada, `send()` lançava `DuplicateMessageError`,
 * esse erro propagava para fora de `handleCallback`
 * (`api/queues/whatsapp-turn/route.ts`), o handler respondia 500, e quem de
 * fato reentregava a mensagem era o retry PADRÃO da fila
 * (`retryAfterSeconds: 30` em `vercel.json`) — nunca o reagendamento de 5s
 * pretendido. Sob contención sustentada isso consumia tentativas de entrega
 * da fila mais rápido que o necessário e podia derrubar o turno inteiro
 * antes de qualquer resposta sair.
 *
 * ## `delaySeconds`
 *
 * - 8s (padrão, chamado por `ingest.ts` a cada mensagem ENTRADA nova): a
 *   janela de buffer que junta fragmentos de mensagem antes de responder.
 * - 5s (chamado por `turno.ts` quando o lease da conversa está ocupado):
 *   reagendamento curto, não um novo ciclo de buffer.
 */
export async function publicarTurno(job: TurnoJob, opcoes?: { delaySeconds?: number }): Promise<void> {
  const tentativa = job.tentativaReagendamento ?? 0;
  const idempotencyKey =
    tentativa > 0 ? `${job.conversationId}:${job.seq}:r${tentativa}` : `${job.conversationId}:${job.seq}`;

  // `segredo` entra no payload aqui (não faz parte do tipo `TurnoJob`
  // público — quem chama `publicarTurno`, em `ingest.ts`/`turno.ts`, nunca
  // precisa conhecê-lo) e é conferido por
  // `api/queues/whatsapp-turn/route.ts` antes de confiar em qualquer outro
  // campo do job — ver o comentário grande acima sobre por que.
  await send(TOPICO_TURNO, { ...job, segredo: getSegredoFila() }, {
    delaySeconds: opcoes?.delaySeconds ?? 8,
    idempotencyKey,
  });
}
