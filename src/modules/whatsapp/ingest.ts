import "server-only";

import { Prisma } from "@prisma/client";

import { prismaDaEmpresa } from "@/core/tenancy/escopo";

import type { EventoWhatsapp } from "./gateway/tipos";
import { normalizarTelefoneWhatsapp } from "./telefone";

export interface ResultadoIngestao {
  /**
   * A empresa dona da conversa. Desde o Ciclo 2a ela vem da CONEXÃO que
   * resolveu o webhook, não de uma variável de ambiente do deploy.
   *
   * Devolvido porque o job de turno precisa dele: `turno.ts` alcança o banco só
   * por `prismaDaEmpresa(companyId)`, e a primeira coisa que ele faz é um
   * `$queryRaw` (o lease), que o escopo NÃO alcança e que portanto precisa do
   * `companyId` escrito à mão no `WHERE`. Quem publica o job é a rota do
   * webhook, e ela só sabe o que este resultado disser.
   */
  companyId: string;
  /** A conexão por onde a mensagem entrou — é por ela que a resposta sai. */
  connectionId: string;
  conversationId: string;
  /** `bufferSeq` DEPOIS desta mensagem — o `seq` que o job de fila deve carregar. */
  bufferSeq: number;
  /** `true` quando `evento.idExterno` já tinha sido gravado antes (redelivery do webhook) — nada foi criado/incrementado. */
  duplicada: boolean;
}

/**
 * O CONTEXTO da ingestão: quem é a empresa e por qual conexão a mensagem
 * entrou. Os dois vêm da MESMA linha de `WhatsappConnection`, resolvida pela
 * rota do webhook a partir do token do path.
 *
 * ## O que morreu aqui, e por quê
 *
 * Até o Ciclo 2a a empresa saía de `EVOLUTION_COMPANY_ID` — uma constante do
 * DEPLOY. Ela existia porque o payload da Evolution não carrega sinal nenhum
 * de empresa, e o comentário dela dizia, textualmente, "no Ciclo 2 cada
 * conexão da Evolution vira linha de tabela com `companyId` próprio, e o
 * webhook passa a resolver a empresa pela CONEXÃO". É o que aconteceu.
 *
 * O ganho não é estético: com a variável, duas instâncias apontando para o
 * mesmo deploy escreviam as duas na mesma empresa, sem erro nenhum. Era ⚠️ R5
 * da auditoria do Ciclo 1a — "segunda fonte de verdade sobre a conversa".
 *
 * Os dois campos viajam como PARÂMETRO explícito, nunca por `AsyncLocalStorage`
 * ou estado de módulo: este arquivo é chamado do webhook, fora do ciclo de
 * request, que é exatamente onde estado implícito não é preenchido e falha
 * calado. Parâmetro falha no `typecheck`, que é onde a gente quer que falhe.
 */
export interface ContextoDeIngestao {
  companyId: string;
  connectionId: string;
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
export async function ingerirMensagem(
  evento: EventoWhatsapp,
  contexto: ContextoDeIngestao
): Promise<ResultadoIngestao> {
  const { companyId, connectionId } = contexto;
  const db = prismaDaEmpresa(companyId);

  try {
    return await db.$transaction(async (tx) => {
      const normalizado = normalizarTelefoneWhatsapp(evento.waId);

      // O `upsert` que morava aqui é RECUSADO pelo escopo — o `where` dele só
      // aceita campo único, e `companyId` não é único em `Conversation` (ver
      // "Recusa, lançando" em `core/tenancy/escopo.ts`). A substituição é a
      // que aquele arquivo indica: `findFirst` escopado decide entre `create` e
      // `updateMany`, tudo dentro da transação que já existia.
      //
      // ## O que se perde e o que NÃO se perde
      //
      // O `upsert` resolvia a corrida "dois webhooks do mesmo `waId` novo ao
      // mesmo tempo" no banco. `findFirst` + `create` reabre essa janela — e ela
      // cai no MESMO tratamento de `P2002` que já existe logo abaixo, porque
      // `Conversation` continua com unicidade de `waId` imposta pelo banco: o
      // segundo a chegar colide, o `catch` busca a mensagem já gravada e devolve
      // `duplicada: true`. O ramo do `catch` teve de aprender a lidar com a
      // colisão de `waId` (conversa) além da de `idExterno` (mensagem) — ver lá.
      //
      // ## `waId` é único POR EMPRESA desde o Ciclo 1e
      //
      // O `findFirst` escopado NÃO encontra a conversa de outra empresa com o
      // mesmo `waId` — e é isso que se quer: são conversas diferentes, de
      // empresas diferentes, com a mesma pessoa. A chave
      // `@@unique([companyId, waId])` é a mesma dupla de colunas que este
      // `findFirst` filtra (o escopo injeta `where.companyId`), então o `create`
      // abaixo só pode colidir com uma conversa DESTA empresa.
      //
      // O QUE ISSO FECHOU: até o Ciclo 1e, `waId` era `@unique` GLOBAL, o
      // `create` colidia com a conversa de OUTRA empresa, o `catch` não achava
      // mensagem por `idExterno` (ela não chegou a ser gravada), o erro subia, a
      // rota devolvia 500 e a Evolution reentregava — para sempre, porque a
      // segunda tentativa repetia tudo. Era a §6 da auditoria do Ciclo 2a
      // (`docs/auditorias/2026-08-20-ciclo-2a-cofre-credenciais.md`). Caso que
      // trava as duas metades disto: `tests/unit/whatsapp-isolamento.test.ts`,
      // `describe` "o mesmo número em duas empresas".
      const existente = await tx.conversation.findFirst({ where: { waId: evento.waId } });

      // `nomeExibicao` é o único campo que faz sentido atualizar numa
      // conversa já existente (o cliente pode ter trocado o nome de
      // exibição do WhatsApp) — só quando o evento traz um valor novo, pra
      // não apagar um nome já conhecido com `null` de um evento que não o
      // informou. `telefone`/`waId` nunca mudam depois de criados: são a
      // identidade da conversa.
      let conversation = existente;
      if (conversation) {
        if (evento.nomeExibicao) {
          await tx.conversation.updateMany({
            where: { id: conversation.id },
            data: { nomeExibicao: evento.nomeExibicao },
          });
        }
      } else {
        conversation = await tx.conversation.create({
          data: {
            companyId,
            connectionId,
            waId: evento.waId,
            telefone: normalizado.ok ? normalizado.telefone : null,
            nomeExibicao: evento.nomeExibicao,
          },
        });
      }

      await tx.whatsappMessage.create({
        data: {
          companyId,
          conversationId: conversation.id,
          idExterno: evento.idExterno,
          direcao: "ENTRADA",
          autor: "CLIENTE",
          tipo: evento.tipo,
          texto: evento.texto,
        },
      });

      // `WHERE "companyId"` escrito À MÃO, e isto não é redundância: o escopo
      // NÃO alcança `$queryRaw` (`core/tenancy/escopo.ts`, "Não alcança de
      // jeito nenhum"). O `tx` aqui é o cliente escopado, o que torna fácil
      // supor que o SQL cru herdou a proteção — não herdou. Quem cobra é a
      // Parte 2b de `tests/unit/catraca-prisma-cru.test.ts`, que passou a valer
      // para este arquivo no instante em que ele saiu da fila de conversão.
      const linhas = await tx.$queryRaw<Array<{ bufferSeq: number }>>`
        UPDATE "Conversation"
        SET "bufferSeq" = "bufferSeq" + 1
        WHERE "id" = ${conversation.id} AND "companyId" = ${companyId}
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

      return { companyId, connectionId, conversationId: conversation.id, bufferSeq, duplicada: false };
    });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      // Dois `@unique` podem colidir aqui, e a diferença importa:
      //
      // - `WhatsappMessage.idExterno` — redelivery do webhook. A mensagem já
      //   está gravada; devolvemos `duplicada: true` com o `bufferSeq` ATUAL.
      // - `Conversation.waId` — a corrida que o `upsert` resolvia no banco e
      //   que `findFirst` + `create` reabriu (ver o comentário lá em cima).
      //   Aqui a conversa acabou de nascer pela mão do concorrente, e ESTA
      //   chamada não gravou a mensagem: ela precisa ser reprocessada, não
      //   confirmada. Deixar o erro subir faz a rota do webhook devolver 500 e
      //   a Evolution reentregar — e desde o Ciclo 1e o retry ACERTA sem
      //   qualificação, porque a chave (`[companyId, waId]`) e o `findFirst`
      //   (escopado pela mesma empresa) enxergam o mesmo conjunto de linhas.
      //   Antes disso a frase valia só para a corrida intra-empresa: a colisão
      //   entre empresas reentregava para sempre.
      const mensagemExistente = await db.whatsappMessage.findFirst({
        where: { idExterno: evento.idExterno },
      });
      if (mensagemExistente) {
        const conversation = await db.conversation.findFirstOrThrow({
          where: { id: mensagemExistente.conversationId },
        });
        return {
          companyId,
          connectionId,
          conversationId: conversation.id,
          bufferSeq: conversation.bufferSeq,
          duplicada: true,
        };
      }
    }
    throw erro;
  }
}
