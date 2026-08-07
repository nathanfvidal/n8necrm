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
 * Lista conversas para a tela de inbox, mais recentemente atualizada
 * primeiro, com a última mensagem (qualquer direção) para a prévia.
 *
 * `take: 100` — mesmo raciocínio de teto simples que outras listagens deste
 * projeto (ex.: export/leads/route.ts): sem sinal real de volume que
 * justifique paginação ainda nesta fatia; quando isso mudar, a correção é
 * paginação de verdade, não um teto maior.
 */
export async function listarConversas() {
  return prisma.conversation.findMany({
    orderBy: { atualizadoEm: "desc" },
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

/**
 * Conversas de um contato, para a tela de detalhe da agenda
 * (`/contatos/[id]`).
 *
 * Mora AQUI, no módulo, e não em `core/contacts/queries.ts`, mesmo sendo a
 * agenda quem consome: `Conversation` é conceito do módulo `whatsapp`, e
 * `src/core` não pode conhecê-lo (regra de ESLint, § 3.3 da spec base). A
 * página de detalhe vive em `src/app/`, que pode importar dos dois lados — e
 * só chama esta função quando `moduloAtivo("whatsapp")`, então num fork com o
 * módulo desligado a tabela nem é consultada.
 *
 * `nomeExibicao` pode ser nulo (a Evolution nem sempre manda o nome do
 * perfil); quem renderiza cai para o telefone ou o `waId`, mesma cadeia da
 * inbox.
 */
export async function listarConversasDoContato(contactId: string) {
  return prisma.conversation.findMany({
    where: { contactId },
    orderBy: { atualizadoEm: "desc" },
    select: {
      id: true,
      waId: true,
      telefone: true,
      nomeExibicao: true,
      iaAtiva: true,
      atualizadoEm: true,
    },
  });
}

export type ConversaDoContato = Awaited<ReturnType<typeof listarConversasDoContato>>[number];
