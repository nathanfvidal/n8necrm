import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Consultas de leitura para a inbox de conversas (`(painel)/conversas`,
 * Fatia 1 — só leitura, nenhuma mutação ainda). Vivem em `src/modules/whatsapp`
 * (não em `core/`, mesma fronteira arquitetural do resto do módulo) e usam
 * o Prisma direto — não há regra de negócio aqui, só shape de leitura para
 * a UI.
 */

/**
 * Lista conversas para a tela de inbox, com quem aguarda humano no topo
 * (mais antiga espera primeiro — a que mais precisa de atenção) e o resto
 * por atividade recente, com a última mensagem (qualquer direção) para a
 * prévia.
 *
 * `nulls: "last"` explícito: o padrão do Postgres em `ASC` já manda nulos
 * para o fim, então omitir funcionaria — por acaso. Escrito explícito para
 * não depender desse acaso: no dia em que alguém trocar para `desc` (nulos
 * viram primeiro por padrão), a falha seria silenciosa — conversas sem
 * espera subiriam ao topo e esconderiam exatamente as que esperam.
 *
 * `take: 100` — mesmo raciocínio de teto simples que outras listagens deste
 * projeto (ex.: export/leads/route.ts): sem sinal real de volume que
 * justifique paginação ainda nesta fatia; quando isso mudar, a correção é
 * paginação de verdade, não um teto maior.
 */
export async function listarConversas() {
  return prisma.conversation.findMany({
    orderBy: [
      { aguardandoHumanoDesde: { sort: "asc", nulls: "last" } },
      { atualizadoEm: "desc" },
    ],
    take: 100,
    include: {
      contact: { select: { id: true, nome: true } },
      mensagens: {
        orderBy: { criadoEm: "desc" },
        take: 1,
      },
    },
  });
}

export type ConversaComUltimaMensagem = Awaited<ReturnType<typeof listarConversas>>[number];

/**
 * Busca uma conversa e todas as suas mensagens (mais antiga primeiro, ordem
 * de leitura natural de um thread) para a tela de detalhe. `null` quando o
 * id não existe — a página decide chamar `notFound()`.
 *
 * Inclui `iaPausadaPor` (Fatia 2, Task 6) para a tela mostrar QUEM pausou a
 * IA, não só que ela está pausada — ver `ConversaEstadoIa`.
 */
export async function buscarConversaComMensagens(id: string) {
  return prisma.conversation.findUnique({
    where: { id },
    include: {
      contact: { select: { id: true, nome: true } },
      iaPausadaPor: { select: { id: true, nome: true } },
      mensagens: { orderBy: { criadoEm: "asc" } },
    },
  });
}

export type ConversaComMensagens = NonNullable<Awaited<ReturnType<typeof buscarConversaComMensagens>>>;
