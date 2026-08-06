import crypto from "node:crypto";

import { z } from "zod";

import type { EventoWhatsapp, TipoMensagemWhatsapp, WhatsappGateway } from "./tipos";

/**
 * Forma do payload que a Evolution API efetivamente envia ao webhook.
 *
 * Como isto foi inferido: `Bots/01_-_ENTRADA_E_SAIDA_-_Multi_API_Evolution_UAZAPI_ZAPI_V3_1_.json`,
 * nó "Normalizador" (`jsCode`), ramo Evolution, lê
 * `webhookData.body.data.key.remoteJid` / `webhookData.body.instance` /
 * `webhookData.body.data.message` / `webhookData.body.data.messageType` /
 * `webhookData.body.data.pushName` / `webhookData.body.data.messageTimestamp` /
 * `webhookData.body.event`. O n8n Webhook node embrulha o corpo bruto do
 * POST em `item.json.body` (convenção do PRÓPRIO n8n, não da Evolution) —
 * então o payload que a Evolution manda de verdade, e que esta rota recebe
 * DIRETO via `request.json()` (sem esse envelope `.body` do n8n), tem
 * `instance`, `event`, `data` etc. no NÍVEL RAIZ. Isso também bate com a
 * forma documentada publicamente do webhook da Evolution API (evento
 * `messages.upsert`, campos `event`/`instance`/`data`/`server_url`/`apikey`
 * no topo). Não há uma instância Evolution real acessível neste ambiente
 * para confirmar isso ao vivo — ver o relatório da Fatia 1
 * (.superpowers/sdd/whatsapp-fatia-1/report.md) para o que falta verificar
 * com um webhook real.
 *
 * `.passthrough()` em vez de `.strict()`: a Evolution manda dezenas de
 * outros campos (`sender`, `destination`, `date_time`, ...) que não usamos —
 * rejeitar o payload por causa de um campo desconhecido faria a rota
 * "quebrar" a cada atualização da API que adicionasse um campo novo.
 */
const evolutionMessageKeySchema = z
  .object({
    remoteJid: z.string(),
    fromMe: z.boolean().optional(),
    id: z.string(),
  })
  .passthrough();

const evolutionMessageContentSchema = z.record(z.string(), z.unknown()).optional();

const evolutionDataSchema = z
  .object({
    key: evolutionMessageKeySchema,
    message: evolutionMessageContentSchema,
    messageType: z.string().optional(),
    pushName: z.string().optional(),
    messageTimestamp: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

const evolutionWebhookSchema = z
  .object({
    event: z.string().optional(),
    instance: z.string(),
    data: evolutionDataSchema.optional(),
  })
  .passthrough();

// Mapeamento de `messageType` (Evolution) para o tipo normalizado que o
// resto do módulo conhece. Qualquer `messageType` não listado aqui (a
// Evolution tem dezenas — enquete, localização, contato, reação, ...) cai em
// "OUTRO", que `turno.ts` trata com a mesma resposta de fallback dos tipos
// de mídia fora de escopo desta fatia.
const MAPA_TIPO: Record<string, TipoMensagemWhatsapp> = {
  conversation: "TEXTO",
  extendedTextMessage: "TEXTO",
  imageMessage: "IMAGEM",
  audioMessage: "AUDIO",
  documentMessage: "DOCUMENTO",
  documentWithCaptionMessage: "DOCUMENTO",
  stickerMessage: "STICKER",
};

function extrairTexto(message: Record<string, unknown> | undefined): string | null {
  if (!message) return null;

  if (typeof message.conversation === "string" && message.conversation.length > 0) {
    return message.conversation;
  }

  const extendedText = message.extendedTextMessage;
  if (extendedText && typeof extendedText === "object" && "text" in extendedText) {
    const texto = (extendedText as { text?: unknown }).text;
    if (typeof texto === "string" && texto.length > 0) return texto;
  }

  for (const chave of ["imageMessage", "documentMessage"] as const) {
    const bloco = message[chave];
    if (bloco && typeof bloco === "object" && "caption" in bloco) {
      const caption = (bloco as { caption?: unknown }).caption;
      if (typeof caption === "string" && caption.length > 0) return caption;
    }
  }

  return null;
}

function extrairTimestamp(bruto: number | string | undefined): Date {
  if (bruto === undefined) return new Date();
  const segundos = typeof bruto === "string" ? Number(bruto) : bruto;
  if (!Number.isFinite(segundos) || segundos <= 0) return new Date();
  return new Date(segundos * 1000);
}

/** Remove o sufixo de domínio JID ("@s.whatsapp.net", "@g.us", "@lid", ...) do remoteJid. */
function waIdDoRemoteJid(remoteJid: string): string {
  return remoteJid.split("@")[0] ?? remoteJid;
}

export interface EvolutionGatewayConfig {
  domain: string;
  instance: string;
  apiKey: string;
}

/**
 * Adapter da Evolution API (self-hosted). Não lê `process.env` diretamente —
 * recebe a configuração já validada pelo construtor, lida e validada em
 * `gateway/index.ts` (mesmo raciocínio de isolar a validação de env num só
 * lugar, mas aqui separado em dois arquivos: este contém só a lógica do
 * protocolo Evolution, testável sem nenhuma variável de ambiente definida).
 */
export class EvolutionGateway implements WhatsappGateway {
  constructor(private readonly config: EvolutionGatewayConfig) {}

  verificarOrigem(corpoBruto: unknown): boolean {
    const parsed = evolutionWebhookSchema.safeParse(corpoBruto);
    if (!parsed.success) return false;
    return parsed.data.instance === this.config.instance;
  }

  normalizarEventos(corpoBruto: unknown): EventoWhatsapp[] {
    const parsed = evolutionWebhookSchema.safeParse(corpoBruto);
    if (!parsed.success) return [];

    const { data } = parsed;
    // Só "messages.upsert" representa uma mensagem recebida/enviada de
    // verdade — a Evolution manda outros eventos no mesmo webhook
    // (connection.update, qrcode.updated, etc.) que não têm `data.key` no
    // formato de mensagem e devem ser simplesmente confirmados sem processar.
    if (data.event !== undefined && data.event !== "messages.upsert") return [];
    if (!data.data) return [];

    const { key, message, messageType, pushName, messageTimestamp } = data.data;

    // Eco de mensagem que a PRÓPRIA instância enviou (inclusive respostas
    // que este bot mandou) — processar isso como mensagem de cliente criaria
    // um loop (o bot "responderia" à sua própria resposta) e duplicaria o
    // que `turno.ts` já grava como WhatsappMessage SAIDA no envio.
    if (key.fromMe) return [];

    // Mensagem de grupo: remoteJid termina em "@g.us" em vez de
    // "@s.whatsapp.net"/"@lid". Fora de escopo desta fatia (atendimento é
    // 1:1 com o cliente da revenda) — sem este filtro, tráfego de um grupo
    // qualquer em que o número da revenda estivesse cria uma "Conversation"
    // por grupo e responde publicamente dentro dele.
    if (key.remoteJid.endsWith("@g.us")) return [];

    const tipo = MAPA_TIPO[messageType ?? "conversation"] ?? "OUTRO";

    return [
      {
        idExterno: key.id,
        waId: waIdDoRemoteJid(key.remoteJid),
        nomeExibicao: pushName ?? null,
        tipo,
        texto: extrairTexto(message),
        timestamp: extrairTimestamp(messageTimestamp),
      },
    ];
  }

  async enviarTexto(waId: string, texto: string): Promise<{ idExterno: string }> {
    const url = `${this.config.domain.replace(/\/$/, "")}/message/sendText/${this.config.instance}`;

    const resposta = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: this.config.apiKey,
      },
      // Corpo no formato documentado da Evolution API v2 para envio de texto
      // (`{ number, text }`). Não verificado ao vivo neste ambiente (sem
      // instância Evolution acessível) — ver report.md da Fatia 1.
      body: JSON.stringify({ number: waId, text: texto }),
    });

    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => "");
      throw new Error(
        `Falha ao enviar mensagem via Evolution (HTTP ${resposta.status}): ${corpo.slice(0, 500)}`
      );
    }

    const json = (await resposta.json().catch(() => null)) as { key?: { id?: string } } | null;
    const idExterno = json?.key?.id;

    // A resposta da Evolution deveria trazer o id da mensagem enviada
    // (`key.id`, mesmo shape do lado de entrada) — mas se um dia isso não
    // vier (mudança de versão da API, resposta inesperada), geramos um id
    // local em vez de falhar o envio inteiro: a mensagem JÁ FOI enviada
    // (HTTP 2xx acima), só não temos como referenciá-la externamente depois.
    return { idExterno: idExterno ?? `evolution-sem-id-${crypto.randomUUID()}` };
  }
}
