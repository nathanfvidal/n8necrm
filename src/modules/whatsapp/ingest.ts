import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import type { EventoWhatsapp } from "./gateway/tipos";
import { normalizarTelefoneWhatsapp } from "./telefone";

export interface ResultadoIngestao {
  conversationId: string;
  /** `bufferSeq` DEPOIS desta mensagem — o `seq` que o job de fila deve carregar. */
  bufferSeq: number;
  /** `true` quando `evento.idExterno` já tinha sido gravado antes (redelivery do webhook) — nada foi criado/incrementado. */
  duplicada: boolean;
}

/**
 * Ingere uma mensagem ENTRADA normalizada: upsert de `Conversation` por
 * `waId`, insere `WhatsappMessage` (idempotente por `idExterno`) e
 * incrementa `Conversation.bufferSeq` atomicamente — os três passos dentro
 * de UMA transação, para que uma falha a meio do caminho nunca deixe o
 * banco com uma mensagem gravada mas o buffer não incrementado (ou
 * vice-versa).
 *
 * ## Idempotência (redelivery do webhook)
 *
 * `WhatsappMessage.idExterno` é `@unique` — é a chave de idempotência que
 * garante que a MESMA mensagem, entregue duas vezes pela Evolution (retry
 * de rede dela, ou um reenvio manual do mesmo payload), nunca vira duas
 * linhas. Duas chamadas concorrentes com o mesmo `idExterno` podem ambas
 * passar da checagem inicial antes de qualquer uma commitar — o Postgres
 * permite só uma: a segunda colide na constraint UNIQUE e o Prisma traduz
 * isso em `P2002`. Tratamos exatamente como `encontrarOuCriarContact`
 * (core/leads/dedupe.ts) trata a mesma corrida em `Contact.telefone`:
 * "alguém já gravou isso" — buscamos a mensagem existente e devolvemos
 * `duplicada: true` com o `bufferSeq` ATUAL da conversa (sem incrementar de
 * novo), em vez de deixar o erro cru subir e a rota do webhook devolver
 * 500 pra Evolution (que reagiria fazendo... mais retry, agravando o
 * problema).
 */
export async function ingerirMensagem(evento: EventoWhatsapp): Promise<ResultadoIngestao> {
  try {
    return await prisma.$transaction(async (tx) => {
      const normalizado = normalizarTelefoneWhatsapp(evento.waId);

      const conversation = await tx.conversation.upsert({
        where: { waId: evento.waId },
        create: {
          waId: evento.waId,
          telefone: normalizado.ok ? normalizado.telefone : null,
          nomeExibicao: evento.nomeExibicao,
        },
        // `nomeExibicao` é o único campo que faz sentido atualizar numa
        // conversa já existente (o cliente pode ter trocado o nome de
        // exibição do WhatsApp) — só quando o evento traz um valor novo, pra
        // não apagar um nome já conhecido com `null` de um evento que não o
        // informou. `telefone`/`waId` nunca mudam depois de criados: são a
        // identidade da conversa.
        update: evento.nomeExibicao ? { nomeExibicao: evento.nomeExibicao } : {},
      });

      await tx.whatsappMessage.create({
        data: {
          conversationId: conversation.id,
          idExterno: evento.idExterno,
          direcao: "ENTRADA",
          autor: "CLIENTE",
          tipo: evento.tipo,
          texto: evento.texto,
        },
      });

      const linhas = await tx.$queryRaw<Array<{ bufferSeq: number }>>`
        UPDATE "Conversation"
        SET "bufferSeq" = "bufferSeq" + 1
        WHERE "id" = ${conversation.id}
        RETURNING "bufferSeq"
      `;

      const bufferSeq = linhas[0]?.bufferSeq;
      if (bufferSeq === undefined) {
        // Não deveria ser alcançável: acabamos de fazer upsert desta mesma
        // linha na mesma transação. Defesa contra um erro silencioso caso
        // isso um dia deixe de ser verdade (ex.: um bufferSeq negativo por
        // overflow, o que também não é alcançável com Int do Postgres antes
        // de 2 bilhões de mensagens na mesma conversa — mas "impossível hoje"
        // não é motivo pra devolver `undefined as unknown as number`).
        throw new Error(`Falha ao incrementar bufferSeq da Conversation ${conversation.id}`);
      }

      return { conversationId: conversation.id, bufferSeq, duplicada: false };
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      const mensagemExistente = await prisma.whatsappMessage.findUnique({
        where: { idExterno: evento.idExterno },
      });
      if (mensagemExistente) {
        const conversation = await prisma.conversation.findUniqueOrThrow({
          where: { id: mensagemExistente.conversationId },
        });
        return { conversationId: conversation.id, bufferSeq: conversation.bufferSeq, duplicada: true };
      }
    }
    throw erro;
  }
}
