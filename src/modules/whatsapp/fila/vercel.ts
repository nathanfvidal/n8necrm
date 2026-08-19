import { send } from "@vercel/queue";
import { z } from "zod";

import type { FilaTurnos, OpcoesPublicacao, TurnoJob } from "./tipos";

/**
 * Tópico. Tem que bater com o nome do diretório da rota consumidora
 * (`src/app/api/queues/whatsapp-turn/route.ts`) e com o binding declarado em
 * `vercel.json` — os três precisam concordar.
 */
const TOPICO_TURNO = "whatsapp-turn";

const segredoEnvSchema = z.object({
  WHATSAPP_QUEUE_SECRET: z.string().min(1, {
    message: "WHATSAPP_QUEUE_SECRET ausente — defina no .env (openssl rand -hex 32)",
  }),
});

/**
 * Lido a cada publicação, não no escopo do módulo. Importar este arquivo não
 * pode exigir a variável: `next build` avalia módulos alcançáveis para coletar
 * configuração de rota, e validação no topo já derrubou o deploy deste projeto
 * uma vez pelo módulo do gateway (ver `gateway/index.ts`).
 */
function getSegredoFila(): string {
  const resultado = segredoEnvSchema.safeParse({
    WHATSAPP_QUEUE_SECRET: process.env.WHATSAPP_QUEUE_SECRET,
  });
  if (!resultado.success) {
    throw new Error(
      `Configuração da fila do WhatsApp inválida: ${resultado.error.issues.map((i) => i.message).join("; ")}`
    );
  }
  return resultado.data.WHATSAPP_QUEUE_SECRET;
}

/**
 * Adaptador de Vercel Queues.
 *
 * ## Por que o segredo vai no PAYLOAD, e não num header
 *
 * A documentação da Vercel garante que uma rota consumidora configurada por
 * `experimentalTriggers` fica air-gapped da internet, só invocável pela
 * infraestrutura interna de fila. O SDK, por sua vez, NÃO verifica assinatura
 * nenhuma na requisição recebida — confia inteiramente nessa garantia de rede.
 * O segredo no payload é a segunda camada barata: se o air-gapping falhar por
 * bug ou configuração errada, um POST forjado ainda não dispara `processarTurno`
 * com um `conversationId` arbitrário. Vai no payload e não em
 * `SendOptions.headers` porque a documentação não confirma que headers chegam
 * como header HTTP na entrega por push — o payload nós mesmos serializamos e
 * desserializamos, sem depender de comportamento não verificado de plataforma.
 *
 * ## Por que a chave de idempotência muda a cada reagendamento
 *
 * Achado CRÍTICO de revisão na base: o reagendamento reusava a MESMA chave da
 * publicação original. A janela de dedupe do Vercel Queues é `min(retenção, 24h)`,
 * muito maior que os 8s entre a publicação e o primeiro reagendamento — então
 * TODA tentativa de reagendar por lease ocupado colidia, `send()` lançava
 * `DuplicateMessageError`, o handler respondia 500, e quem reentregava era o
 * retry padrão de 30s da fila, nunca o reagendamento de 5s pretendido. Sob
 * contenção sustentada isso queimava tentativas de entrega mais rápido que o
 * necessário e podia derrubar o turno antes de qualquer resposta sair.
 */
export class FilaVercel implements FilaTurnos {
  async publicar(job: TurnoJob, opcoes?: OpcoesPublicacao): Promise<void> {
    const tentativa = job.tentativaReagendamento ?? 0;
    const idempotencyKey =
      tentativa > 0
        ? `${job.conversationId}:${job.seq}:r${tentativa}`
        : `${job.conversationId}:${job.seq}`;

    await send(
      TOPICO_TURNO,
      { ...job, segredo: getSegredoFila() },
      {
        delaySeconds: opcoes?.delaySeconds ?? 8,
        idempotencyKey,
      }
    );
  }
}
