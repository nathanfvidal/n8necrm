/**
 * Tipo de conteúdo normalizado de uma mensagem recebida — espelha o enum
 * `WhatsappTipo` do schema (prisma/schema.prisma), mas vive aqui como um
 * tipo TypeScript solto para o pacote `gateway/` não depender de
 * `@prisma/client` (o adapter concreto, `evolution.ts`, é só parsing de HTTP
 * + fetch; não deveria precisar importar o client do banco só para nomear um
 * tipo). `ingest.ts` é quem converte este tipo para o enum do Prisma.
 */
export type TipoMensagemWhatsapp = "TEXTO" | "AUDIO" | "IMAGEM" | "DOCUMENTO" | "STICKER" | "OUTRO";

/**
 * Forma normalizada de UMA mensagem recebida, depois que o adapter (hoje:
 * `evolution.ts`) já traduziu o payload específico do gateway para este
 * formato comum. `ingest.ts` e `turno.ts` só conhecem este tipo — nunca o
 * shape bruto de nenhuma API de WhatsApp específica.
 */
export interface EventoWhatsapp {
  /** Id da mensagem no gateway de origem — chave de idempotência (WhatsappMessage.idExterno). */
  idExterno: string;
  /** Identificador do remetente no gateway de origem (ex.: "5511999998888" para Evolution, sem sufixo "@s.whatsapp.net"). */
  waId: string;
  /** Nome de exibição do contato no WhatsApp, quando o gateway o informa. */
  nomeExibicao: string | null;
  tipo: TipoMensagemWhatsapp;
  /** Conteúdo textual (ou legenda de mídia) já extraído; null quando o tipo não carrega texto utilizável. */
  texto: string | null;
  /** Instante em que a mensagem foi enviada, conforme reportado pelo gateway. */
  timestamp: Date;
}

/**
 * Abstração sobre o provedor de WhatsApp — espelha o padrão de
 * `src/lib/storage.ts` (interface + implementação trocável + singleton).
 * Hoje só existe `evolution.ts` (Evolution API self-hosted); a Fatia 5 do
 * plano adiciona `cloud-api.ts` (Meta Cloud API) implementando a MESMA
 * interface, sem tocar em ingest.ts, turno.ts nem nas rotas.
 */
export interface WhatsappGateway {
  /**
   * Verifica se o payload bruto recebido no webhook é autêntico e deve ser
   * processado. Cada gateway tem sua própria estratégia de verificação —
   * por isso este método mora no adapter, não na rota que o chama:
   *
   * - Evolution self-hosted não assina webhooks (sem HMAC). A defesa aqui é
   *   conferir que o campo `instance` do corpo bate com a instância da
   *   CONEXÃO que atende aquele webhook (`WhatsappConnection.instancia`;
   *   até o Ciclo 2a era uma variável do deploy) — não impede um
   *   payload forjado por quem já conhece o token do path (a defesa contra
   *   ISSO é o token imprevisível comparado com `timingSafeEqual` na
   *   própria rota, fora deste método), mas impede que uma instância
   *   Evolution diferente (compartilhando o mesmo domínio, por exemplo)
   *   injete eventos nesta.
   * - Meta Cloud API (Fatia 5) verifica diferente: handshake `hub.challenge`
   *   na assinatura do webhook + `X-Hub-Signature-256` (HMAC) sobre o corpo
   *   CRU da requisição — motivo pelo qual este método recebe o corpo já
   *   parseado (`unknown`, tipicamente o resultado de `request.json()`) e
   *   não o `Request` inteiro: a rota é quem decide como ler o corpo, e cada
   *   adapter decide como validá-lo.
   */
  verificarOrigem(corpoBruto: unknown): boolean;

  /**
   * Converte o payload bruto do webhook em zero ou mais eventos
   * normalizados. Devolve `[]` (nunca lança) para qualquer webhook que não
   * seja uma mensagem recebida de cliente — atualização de status de
   * conexão, confirmação de leitura, eco de uma mensagem que a própria
   * instância enviou (`fromMe: true`), mensagem de grupo — para que quem
   * chama simplesmente confirme (200) sem processar nada.
   */
  normalizarEventos(corpoBruto: unknown): EventoWhatsapp[];

  /**
   * Envia uma mensagem de texto para `waId`. Devolve o id externo atribuído
   * pelo gateway à mensagem enviada, para persistir em
   * `WhatsappMessage.idExterno` (mesma chave de idempotência usada do lado
   * de entrada, aplicada agora ao lado de saída — uso futuro, não há
   * reenvio automático nesta fatia).
   */
  enviarTexto(waId: string, texto: string): Promise<{ idExterno: string }>;
}
