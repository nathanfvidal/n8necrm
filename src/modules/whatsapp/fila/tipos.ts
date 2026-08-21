/**
 * Contrato da fila de turnos de conversa.
 *
 * Vive num arquivo próprio, sem `server-only` e sem importar o SDK de nenhum
 * provedor, pelo MESMO motivo de `gateway/tipos.ts`: quem só precisa nomear o
 * tipo (o consumidor, um teste, um adaptador futuro) não deveria arrastar junto
 * uma dependência de infraestrutura nem a marcação de servidor.
 */

/**
 * Um turno de conversa a ser processado.
 *
 * `tentativaReagendamento` é o contador do NOSSO reagendamento deliberado
 * (quando `turno.ts` encontra o lease da conversa ocupado) — não confundir
 * com `deliveryCount`, a contagem de retry NATIVA da fila para falha de
 * handler. `undefined`/`0` = publicação original, feita por `ingest.ts`.
 */
export interface TurnoJob {
  /**
   * A empresa dona da conversa.
   *
   * Viaja no job porque `turno.ts` roda fora de qualquer requisição — não há
   * sessão de onde tirá-la — e porque a PRIMEIRA operação dele (`claimLease`) é
   * `$queryRaw`, que o escopo por empresa não alcança e cujo `WHERE
   * "companyId"` precisa ser escrito à mão. O porquê completo está no bloco de
   * cabeçalho de `modules/whatsapp/turno.ts`.
   *
   * Não é entrada de usuário: quem publica é a rota do webhook, com o valor de
   * `ingerirMensagem` — que desde o Ciclo 2a vem da CONEXÃO resolvida pelo
   * token do path, não mais de `EVOLUTION_COMPANY_ID` —, e a rota consumidora
   * valida um segredo compartilhado antes de chamar `processarTurno`.
   */
  companyId: string;
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
 * A decisão 6 do spec fundador (2026-08-19) exigiu esta costura para que mover
 * o CRM para fora da Vercel fosse escrever um SEGUNDO adaptador, não reescrever
 * o módulo de WhatsApp. Ela foi reaberta em 2026-08-21 — o dono decidiu não
 * usar a Vercel — e a costura pagou: `FilaPostgres` (`./postgres.ts`) entrou no
 * lugar de `FilaVercel` trocando uma linha de `./index.ts`, e os três
 * importadores de `publicarTurno` não mudaram.
 */
export interface FilaTurnos {
  publicar(job: TurnoJob, opcoes?: OpcoesPublicacao): Promise<void>;
}
