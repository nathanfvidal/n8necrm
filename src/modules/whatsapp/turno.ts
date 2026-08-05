import "server-only";

import { prisma } from "@/lib/prisma";

import { publicarTurno, type TurnoJob } from "./fila";
import { whatsappGateway } from "./gateway";
import { llmProvider } from "./llm";
import type { AutorMensagemContexto } from "./llm/tipos";
import { montarPromptSistema } from "./prompt";

export type { TurnoJob } from "./fila";

// Tempo que o lease (Conversation.processandoAte) fica reservado por este
// processo enquanto processa um turno. Precisa cobrir com folga uma chamada
// de LLM (que pode levar de 5 a 30s, ver plano da Fatia 1) + o envio da(s)
// resposta(s) via gateway — 25s dá essa folga sem prender a conversa por
// tempo desproporcional caso o processo morra no meio (o pior caso é a
// conversa ficar "travada" até 25s, não mais que isso).
const LEASE_DURACAO_MS = 25_000;

// Quantas mensagens de TEXTO anteriores (nos dois sentidos) entram no
// histórico passado ao modelo. Não é "todo o histórico da conversa desde o
// início" de propósito: cresceria sem limite o custo de cada chamada numa
// conversa longa, sem ganho proporcional de qualidade de resposta — 20 dá
// contexto suficiente para o tipo de troca curta que esta fatia atende
// (dúvida sobre veículo, agendamento), sem tentar ser memória de longo
// prazo (isso é problema de outra fatia, se algum dia importar).
const HISTORICO_MAX_MENSAGENS = 20;

const FALLBACK_MIDIA_NAO_SUPORTADA =
  "Por enquanto eu ainda não consigo processar áudio, imagem, figurinha ou documento — pode escrever em texto o que você precisa? Assim que possível, a equipe também vai poder ver essa mensagem.";

/**
 * Processa um turno de conversa: reivindica o lease, confere se a mensagem
 * que disparou este job ainda é a mais recente (`seq` vs. `bufferSeq`),
 * junta as mensagens ENTRADA ainda não respondidas, gera e envia a
 * resposta, marca tudo como processado e libera o lease.
 *
 * ## Lease (exclusão mútua por conversa)
 *
 * `claimLease` faz UM UPDATE condicional atômico — mesmo idioma de
 * `checarRateLimit` (core/rate-limit/limiter.ts): o Postgres serializa
 * automaticamente duas chamadas concorrentes na mesma linha (a segunda
 * UPDATE só roda depois que a primeira comita, e nesse ponto sua própria
 * condição WHERE já não bate mais, porque `processandoAte` foi setado pela
 * primeira) — sem precisar de lock consultivo do Postgres (descartado no
 * plano: prenderia a conexão durante os 5-30s da chamada ao modelo, e
 * quebra sob pgBouncer). Quando a segunda chamada não consegue o lease
 * (0 linhas afetadas), ela reagenda o MESMO job com `delaySeconds: 5` em vez
 * de descartar a mensagem — outro processo pode estar processando um turno
 * anterior da mesma conversa, e este job ainda precisa rodar depois.
 *
 * ## Buffer (fragmentos viram uma resposta só)
 *
 * `claimLease` também devolve o `bufferSeq` ATUAL da conversa (lido na
 * mesma instrução que reivindica o lease). Se ele for diferente do `seq`
 * que este job carrega, uma mensagem mais nova já chegou desde que este job
 * foi publicado — o job da mensagem mais nova (publicado com seu próprio
 * delay de 8s a partir de QUANDO ELA chegou) vai, quando disparar, ver
 * `bufferSeq` igual ao seu próprio `seq` e processar TODAS as mensagens
 * ainda não respondidas (`processadoEm: null`) de uma vez — inclusive as
 * que os jobs anteriores, descartados por esta checagem, não processaram.
 * É esse mecanismo, não um "espera X segundos e junta", que faz três
 * mensagens fragmentadas virarem uma resposta só.
 */
export async function processarTurno(job: TurnoJob): Promise<void> {
  const lease = await claimLease(job.conversationId);
  if (!lease) {
    await publicarTurno(job, { delaySeconds: 5 });
    return;
  }

  try {
    if (lease.bufferSeq !== job.seq) {
      // Mensagem mais nova já chegou — o turno dela (ou um turno seguinte
      // que também vier a bater) cuida de responder tudo que está pendente.
      return;
    }

    await processarMensagensPendentes(job.conversationId);
  } finally {
    await liberarLease(job.conversationId);
  }
}

async function processarMensagensPendentes(conversationId: string): Promise<void> {
  const pendentes = await prisma.whatsappMessage.findMany({
    where: { conversationId, direcao: "ENTRADA", processadoEm: null },
    orderBy: { criadoEm: "asc" },
  });

  if (pendentes.length === 0) return;

  const comTexto = pendentes.filter(
    (mensagem) => mensagem.tipo === "TEXTO" && mensagem.texto && mensagem.texto.trim().length > 0
  );
  const semTexto = pendentes.filter((mensagem) => mensagem.tipo !== "TEXTO");

  let respostas: string[];
  if (comTexto.length === 0) {
    // Nenhuma mensagem pendente tem texto utilizável (só áudio/imagem/
    // figurinha/documento) — fora de escopo desta fatia, resposta de
    // fallback única, sem chamar o modelo.
    respostas = [FALLBACK_MIDIA_NAO_SUPORTADA];
  } else {
    const historicoAnterior = await buscarHistorico(conversationId, pendentes[0]!.criadoEm);
    // Fragmentos de texto pendentes são unidos numa única mensagem "CLIENTE"
    // no contexto — é literalmente o comportamento que o plano da Fatia 1
    // pede: "as mensagens fragmentadas juntadas numa resposta só".
    const textoUnido = comTexto.map((mensagem) => mensagem.texto).join("\n");

    const resultado = await llmProvider.gerarResposta({
      systemPrompt: montarPromptSistema(),
      historico: [...historicoAnterior, { autor: "CLIENTE", texto: textoUnido }],
    });

    respostas =
      semTexto.length > 0 ? [...resultado.mensagens, FALLBACK_MIDIA_NAO_SUPORTADA] : resultado.mensagens;
  }

  const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });

  for (const texto of respostas) {
    const envio = await whatsappGateway.enviarTexto(conversation.waId, texto);
    await prisma.whatsappMessage.create({
      data: {
        conversationId,
        idExterno: envio.idExterno,
        direcao: "SAIDA",
        autor: "IA",
        tipo: "TEXTO",
        texto,
        processadoEm: new Date(),
      },
    });
  }

  await prisma.whatsappMessage.updateMany({
    where: { id: { in: pendentes.map((mensagem) => mensagem.id) } },
    data: { processadoEm: new Date() },
  });
}

async function claimLease(conversationId: string): Promise<{ bufferSeq: number } | null> {
  const agora = new Date();
  const ateLease = new Date(agora.getTime() + LEASE_DURACAO_MS);

  const linhas = await prisma.$queryRaw<Array<{ bufferSeq: number }>>`
    UPDATE "Conversation"
    SET "processandoAte" = ${ateLease}::timestamp(3)
    WHERE "id" = ${conversationId}
      AND ("processandoAte" IS NULL OR "processandoAte" < ${agora}::timestamp(3))
    RETURNING "bufferSeq"
  `;

  return linhas[0] ?? null;
}

async function liberarLease(conversationId: string): Promise<void> {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { processandoAte: null },
  });
}

async function buscarHistorico(
  conversationId: string,
  antesDe: Date
): Promise<Array<{ autor: AutorMensagemContexto; texto: string }>> {
  const mensagens = await prisma.whatsappMessage.findMany({
    where: {
      conversationId,
      tipo: "TEXTO",
      texto: { not: null },
      // Estritamente ANTERIOR ao primeiro fragmento pendente deste turno —
      // não só diferente de um id (fix: com 2+ fragmentos pendentes,
      // excluir só o primeiro por id deixava os fragmentos SEGUINTES
      // aparecerem aqui E de novo no texto unido de `comTexto`, duplicando
      // conteúdo no contexto passado ao modelo). Todo fragmento deste turno
      // tem `criadoEm >= antesDe` (o próprio `pendentes[0]`, que é o mais
      // antigo do lote, define o corte) — este filtro exclui todos eles de
      // uma vez, sem precisar saber os ids individuais.
      criadoEm: { lt: antesDe },
    },
    orderBy: { criadoEm: "desc" },
    take: HISTORICO_MAX_MENSAGENS,
  });

  return mensagens
    .reverse()
    .map((mensagem) => ({ autor: mensagem.autor, texto: mensagem.texto ?? "" }));
}
