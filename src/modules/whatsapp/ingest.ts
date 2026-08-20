import "server-only";

import { Prisma } from "@prisma/client";

import { prismaDaEmpresa } from "@/core/tenancy/escopo";

import type { EventoWhatsapp } from "./gateway/tipos";
import { normalizarTelefoneWhatsapp } from "./telefone";

export interface ResultadoIngestao {
  /**
   * A empresa dona da conversa — hoje sempre `EVOLUTION_COMPANY_ID`.
   *
   * Devolvido porque o job de turno precisa dele: `turno.ts` alcança o banco só
   * por `prismaDaEmpresa(companyId)`, e a primeira coisa que ele faz é um
   * `$queryRaw` (o lease), que o escopo NÃO alcança e que portanto precisa do
   * `companyId` escrito à mão no `WHERE`. Quem publica o job é a rota do
   * webhook, e ela só sabe o que este resultado disser.
   */
  companyId: string;
  conversationId: string;
  /** `bufferSeq` DEPOIS desta mensagem — o `seq` que o job de fila deve carregar. */
  bufferSeq: number;
  /** `true` quando `evento.idExterno` já tinha sido gravado antes (redelivery do webhook) — nada foi criado/incrementado. */
  duplicada: boolean;
}

/**
 * `Company` dona da conversa criada a partir de um evento de webhook.
 *
 * ## Por que uma variável de ambiente, e não `Company.findFirst()`
 *
 * Aqui não existe sessão, não existe registro anterior, e o payload da
 * Evolution não carrega sinal nenhum de empresa — só `instance`, que
 * identifica a INSTÂNCIA Evolution, não o tenant do CRM. `findFirst()`
 * "funcionaria" hoje (só existe uma Company) e viraria vazamento silencioso
 * no dia em que uma segunda empresa for cadastrada: toda conversa nova de
 * QUALQUER instância passaria a ser atribuída à empresa mais antiga do
 * banco, sem erro nenhum avisando.
 *
 * A suposição de tenant único já existe neste deploy, só estava implícita:
 * `EVOLUTION_INSTANCE` (.env) é uma única instância Evolution, e o gateway
 * recusa todo webhook cujo campo `instance` não bata com ela
 * (`gateway/evolution.ts`, `verificarOrigem`). `EVOLUTION_COMPANY_ID` só
 * nomeia essa mesma suposição em vez de deixá-la agachada atrás de um
 * `findFirst`.
 *
 * ## Ponte, não destino
 *
 * No Ciclo 2 cada conexão da Evolution vira linha de tabela com `companyId`
 * próprio, e o webhook passa a resolver a empresa pela CONEXÃO (ex.: pelo
 * `instance` do payload, casado contra essa tabela) em vez de uma variável
 * de ambiente única para o deploy inteiro. Esta função — e a variável que
 * ela lê — somem nessa migração; ver Ciclo 2 / tenancy de conexões
 * Evolution.
 */
function obterEvolutionCompanyId(): string {
  const valor = process.env.EVOLUTION_COMPANY_ID;
  if (!valor) {
    throw new Error(
      "EVOLUTION_COMPANY_ID ausente — defina no .env (id da Company dona da única instância Evolution deste deploy; ver comentário em src/modules/whatsapp/ingest.ts)"
    );
  }
  return valor;
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
  // Lida dentro da função, não em escopo de módulo — o mesmo raciocínio de
  // `gateway/index.ts` (`obterGateway`): validar no `import` deste arquivo
  // faria `next build` avaliar a variável ao coletar a configuração de TODA
  // rota alcançável, derrubando o build inteiro sem `EVOLUTION_COMPANY_ID`
  // mesmo em telas que nada têm a ver com WhatsApp.
  const companyId = obterEvolutionCompanyId();
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
      // `Conversation.waId` continua `@unique`: o segundo a chegar colide, o
      // `catch` busca a mensagem já gravada e devolve `duplicada: true`. O
      // ramo do `catch` teve de aprender a lidar com a colisão de `waId`
      // (conversa) além da de `idExterno` (mensagem) — ver lá.
      //
      // ## `waId` é `@unique` GLOBAL, e isso é pendência de SCHEMA
      //
      // O `findFirst` escopado NÃO encontra a conversa de outra empresa com o
      // mesmo `waId` — e é justamente por isso que ele tentaria criar uma
      // segunda, batendo no `@unique` global. Com duas instâncias Evolution,
      // o mesmo número atendido por duas empresas é um estado que este schema
      // ainda não expressa. É a mesma família de `Contact.telefone` e
      // `PipelineStage.ordem`, registrada à parte, e a ponte de
      // `EVOLUTION_COMPANY_ID` (uma instância por deploy) é o que impede o caso
      // de acontecer hoje. Não é este ciclo que a resolve.
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

      return { companyId, conversationId: conversation.id, bufferSeq, duplicada: false };
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
      //   a Evolution reentregar — o retry acerta, porque na segunda vez o
      //   `findFirst` encontra a conversa.
      const mensagemExistente = await db.whatsappMessage.findFirst({
        where: { idExterno: evento.idExterno },
      });
      if (mensagemExistente) {
        const conversation = await db.conversation.findFirstOrThrow({
          where: { id: mensagemExistente.conversationId },
        });
        return {
          companyId,
          conversationId: conversation.id,
          bufferSeq: conversation.bufferSeq,
          duplicada: true,
        };
      }
    }
    throw erro;
  }
}
