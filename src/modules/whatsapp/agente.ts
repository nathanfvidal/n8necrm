import "server-only";

import { prisma } from "@/lib/prisma";

import { BOT_CONFIG_ID } from "../../../config/bot";

/**
 * Pausa a IA numa conversa. Idempotente e NÃO reescreve a autoria: se a
 * conversa já está pausada, quem pausou primeiro continua registrado.
 *
 * O `updateMany` com `iaAtiva: true` no filtro é o que garante isso em uma
 * única instrução — dois humanos abrindo a mesma conversa ao mesmo tempo não
 * disputam a autoria, e o segundo simplesmente afeta 0 linhas. Mesmo idioma
 * de UPDATE condicional usado no lease (`turno.ts`) e no rate limit.
 */
export async function pausarIa(conversationId: string, usuarioId: string): Promise<void> {
  await prisma.conversation.updateMany({
    where: { id: conversationId, iaAtiva: true },
    data: { iaAtiva: false, iaPausadaEm: new Date(), iaPausadaPorId: usuarioId },
  });
}

/** Religa a IA e limpa o estado da pausa. Idempotente. */
export async function religarIa(conversationId: string): Promise<void> {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { iaAtiva: true, iaPausadaEm: null, iaPausadaPorId: null },
  });
}

export async function lerConfigBot() {
  return prisma.botConfig.findUniqueOrThrow({ where: { id: BOT_CONFIG_ID } });
}

export async function salvarConfigBot(
  dados: { ativo: boolean; personaNome: string; personaPapel: string; regras: string[]; faq: string },
  usuarioId: string
) {
  return prisma.botConfig.update({
    where: { id: BOT_CONFIG_ID },
    data: { ...dados, atualizadoPorId: usuarioId },
  });
}
