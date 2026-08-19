/**
 * Contrato da fila de turnos de conversa.
 *
 * Vive num arquivo próprio, sem `server-only` e sem importar `@vercel/queue`,
 * pelo MESMO motivo de `gateway/tipos.ts`: quem só precisa nomear o tipo (o
 * consumidor, um teste, um adaptador futuro) não deveria arrastar junto o SDK
 * de um provedor específico nem a marcação de servidor.
 */

/**
 * Um turno de conversa a ser processado.
 *
 * `tentativaReagendamento` é o contador do NOSSO reagendamento deliberado
 * (quando `turno.ts` encontra o lease da conversa ocupado) — não confundir
 * com o retry nativo da fila. `undefined`/`0` = publicação original, feita
 * por `ingest.ts`.
 */
export interface TurnoJob {
  conversationId: string;
  seq: number;
  tentativaReagendamento?: number;
}

export interface OpcoesPublicacao {
  /** Atraso antes da entrega. Padrão 8s (janela de buffer); 5s no reagendamento. */
  delaySeconds?: number;
}

/**
 * Abstração sobre o provedor de fila — mesmo padrão de `WhatsappGateway`.
 *
 * Hoje só existe `FilaVercel`. A decisão 6 do spec (2026-08-19) mantém a
 * Vercel como runtime e exige esta costura para que mover o CRM para a VPS
 * seja escrever um segundo adaptador (pg-boss, BullMQ), não reescrever o
 * módulo de WhatsApp.
 */
export interface FilaTurnos {
  publicar(job: TurnoJob, opcoes?: OpcoesPublicacao): Promise<void>;
}
