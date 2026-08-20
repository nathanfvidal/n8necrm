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

/**
 * Chaves de invólucro do Baileys — o conteúdo de verdade fica em
 * `mensagem[chave].message`.
 *
 * Esta lista é cópia literal do `getFutureProofMessage` de
 * `normalizeMessageContent`, em baileys 7.0.0-rc.9,
 * `lib/Utils/messages.js:611-618` (o pacote foi baixado do npm e lido; é a
 * versão exata que a Evolution 2.3.7 declara em `package.json:80`).
 * A própria Evolution tem uma lista equivalente e MENOR em
 * `src/api/types/wa.types.ts:146-151` (`MessageSubtype`: sem
 * `viewOnceMessageV2Extension` e sem `editedMessage`) — seguimos a do Baileys,
 * que é quem monta o objeto, não a da Evolution, que só o repassa.
 *
 * `documentWithCaptionMessage` aparece aqui E em `MAPA_TIPO`: a Evolution
 * achata esse invólucro no NÍVEL RAIZ dentro de `prepareMessage`
 * (`whatsapp.baileys.service.ts:4685-4689`), mas não dentro de outro invólucro
 * — a entrada em `MAPA_TIPO` cobre o caso achatado e o desembrulho cobre o
 * aninhado, inclusive extraindo a legenda, que hoje se perdia.
 */
const CHAVES_INVOLUCRO = [
  "ephemeralMessage",
  "viewOnceMessage",
  "documentWithCaptionMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "editedMessage",
] as const;

/**
 * Teto de desembrulho. Mesmo número do `normalizeMessageContent`
 * (baileys 7.0.0-rc.9, `lib/Utils/messages.js:603`, cujo próprio comentário
 * diz "set max iterations to prevent an infinite loop").
 *
 * Aqui o teto não é zelo estético: o corpo do webhook é dado de fora, e
 * `evolutionMessageContentSchema` é um `z.record` — nada impede um POST
 * forjado com mil invólucros aninhados. Laço com teto, nunca recursão sem
 * limite. Caso 6 níveis: o payload sai como "OUTRO"/texto nulo, que é
 * exatamente o comportamento de conteúdo que não sabemos ler.
 */
const TETO_INVOLUCRO = 5;

/**
 * Réplica do `getContentType` do Baileys (7.0.0-rc.9,
 * `lib/Utils/messages.js:585-591`): primeira chave que seja `conversation` ou
 * contenha `Message`, excluída `senderKeyDistributionMessage`.
 *
 * Só é chamada quando houve desembrulho, porque nesse caso o `messageType` que
 * a Evolution mandou descreve o INVÓLUCRO, não o miolo — `prepareMessage`
 * (`whatsapp.baileys.service.ts:4653`) calcula `contentType` sobre
 * `message.message` cru, sem normalizar.
 */
function tipoDeConteudo(mensagem: Record<string, unknown>): string | undefined {
  return Object.keys(mensagem).find(
    (chave) =>
      (chave === "conversation" || chave.includes("Message")) &&
      chave !== "senderKeyDistributionMessage"
  );
}

/**
 * Devolve o miolo de uma mensagem embrulhada em `ephemeralMessage`,
 * `viewOnceMessage*`, `documentWithCaptionMessage` ou `editedMessage`.
 *
 * ## Por que precisamos disto — o que foi MEDIDO e o que foi DEDUZIDO
 *
 * MEDIDO, lendo o fonte da tag `2.3.7` do repositório da Evolution API:
 * `prepareMessage` (`src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts:4652`)
 * monta o payload do webhook chamando `getContentType(message.message)` e
 * copiando `{ ...message.message }` inteiro. `normalizeMessageContent` — a
 * função do Baileys que existe exatamente para desfazer esses invólucros —
 * tem ZERO ocorrências em todo o `src/` dessa tag (`grep -rn` sobre o
 * tarball do tag, 0 linhas). Corroborando por outro caminho: a integração
 * Chatwoot da própria Evolution desembrulha `ephemeralMessage` À MÃO antes de
 * consumir a mensagem
 * (`src/api/integrations/chatbot/chatwoot/services/chatwoot.service.ts:2002-2005`)
 * — o que só faz sentido se o invólucro chega intacto no payload.
 *
 * DEDUZIDO daí, não reproduzido ao vivo (não há instância Evolution acessível
 * neste ambiente — mesma limitação registrada no cabeçalho deste arquivo):
 * num chat com mensagens temporárias ligadas, o `messageType` que chega a nós
 * deve ser `"ephemeralMessage"` e o texto deve estar em
 * `message.ephemeralMessage.message.conversation` (ou `.extendedTextMessage.text`).
 * Sem desembrulhar, `MAPA_TIPO` cai em "OUTRO" e `extrairTexto` devolve null:
 * o atendente veria mensagem vazia e `turno.ts` responderia com o fallback de
 * mídia fora de escopo. A validação definitiva é um webhook real de um chat
 * com mensagens temporárias — segue pendente.
 *
 * Invólucro sem `.message`, com `.message` não-objeto ou nulo: paramos e
 * devolvemos o que temos, para o tipo cair em "OUTRO" em vez de lançar. O
 * webhook não pode derrubar a rota por causa de um corpo estranho.
 */
function desembrulharMensagem(
  message: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  let atual = message;

  for (let i = 0; i < TETO_INVOLUCRO; i += 1) {
    if (!atual) return atual;

    const chave = CHAVES_INVOLUCRO.find((candidata) => {
      const valor = atual?.[candidata];
      return typeof valor === "object" && valor !== null && !Array.isArray(valor);
    });
    if (!chave) return atual;

    const interno = (atual[chave] as { message?: unknown }).message;
    if (typeof interno !== "object" || interno === null || Array.isArray(interno)) return atual;

    atual = interno as Record<string, unknown>;
  }

  return atual;
}

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
 * Substitui a apikey por `[apikey]` num texto vindo da Evolution.
 *
 * `split`/`join` em vez de `replace` com expressão regular: a apikey é dado de
 * configuração e pode conter `.`, `+`, `$` ou barra invertida — caracteres que
 * uma regex montada a partir dela interpretaria, produzindo uma redação que
 * falha justamente nas chaves mais incomuns. Substituição literal não tem esse
 * problema.
 *
 * `apiKey` vazia devolve o texto intacto: sem isso, `split("")` estilhaçaria
 * a string caractere a caractere e o corpo do erro sairia como uma fileira de
 * `[apikey]`. Há caso de teste para as três metades — a apikey ecoada, a chave
 * com caractere de regex dentro, e a apikey vazia — em
 * `tests/unit/whatsapp-evolution-gateway.test.ts`.
 */
function redigirApiKey(texto: string, apiKey: string): string {
  if (apiKey.length === 0) return texto;
  return texto.split(apiKey).join("[apikey]");
}

/**
 * Adapter da Evolution API (self-hosted). Não lê `process.env` — nunca leu, e
 * desde o Ciclo 2a não há o que ler: recebe `{ domain, instance, apiKey }`
 * pelo construtor, e quem os resolve é `gateway/fabrica.ts`, a partir da linha
 * de `WhatsappConnection` daquela empresa. Este arquivo contém só a lógica do
 * protocolo Evolution, testável sem nenhuma variável de ambiente definida
 * (`tests/unit/whatsapp-evolution-gateway.test.ts` constrói a classe direto).
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

    // Desembrulha ANTES de mapear o tipo e antes de extrair o texto: depois
    // deste passo o miolo tem a mesma forma de uma mensagem sem invólucro, e
    // o mapeamento e a extração que já existiam servem sem duplicação. Ver
    // `desembrulharMensagem` para a evidência no fonte da Evolution 2.3.7.
    const mensagem = desembrulharMensagem(message);

    // Sem desembrulho (referência inalterada), o `messageType` da Evolution
    // continua valendo e este caminho é o mesmo de antes desta correção — o
    // describe "mensagens SEM invólucro seguem idênticas", em
    // `tests/unit/whatsapp-evolution-gateway.test.ts`, é o que prende isso.
    // Com desembrulho, aquele campo descreve o invólucro e precisa ser
    // recalculado sobre o miolo; a chave vazia cai em "OUTRO" pelo `??`
    // abaixo, que é o que queremos para miolo sem conteúdo reconhecível.
    const chaveTipo =
      mensagem === message
        ? (messageType ?? "conversation")
        : (tipoDeConteudo(mensagem ?? {}) ?? "");

    // `?? "OUTRO"` é política deliberada e inalterada: tipo que não está no
    // MAPA_TIPO vira "OUTRO", dentro ou fora de invólucro. O desembrulho é um
    // passo A MAIS antes daqui, não uma mudança nessa regra.
    const tipo = MAPA_TIPO[chaveTipo] ?? "OUTRO";

    return [
      {
        idExterno: key.id,
        waId: waIdDoRemoteJid(key.remoteJid),
        nomeExibicao: pushName ?? null,
        tipo,
        texto: extrairTexto(mensagem),
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
      // A apikey sai do corpo ANTES de virar mensagem. Uma API que recusa
      // autenticação costuma devolver a credencial recebida, e esta mensagem
      // vai para `console.error` e para o Sentry — onde fica fora do controle
      // de quem opera o CRM, para sempre.
      //
      // A redação é aqui e não em `src/lib/sentry-scrub.ts` porque só ESTE
      // objeto sabe qual é a apikey: o formato dela não é fixo, então nenhuma
      // expressão regular a reconheceria sem redigir meio mundo junto. Isto é
      // substituição exata; aquele arquivo cuida do que dá para reconhecer por
      // forma (blob do cofre, chave base64, bcrypt, e-mail, telefone).
      throw new Error(
        `Falha ao enviar mensagem via Evolution (HTTP ${resposta.status}): ${redigirApiKey(
          corpo.slice(0, 500),
          this.config.apiKey
        )}`
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
