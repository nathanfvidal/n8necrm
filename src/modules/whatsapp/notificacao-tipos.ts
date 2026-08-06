// Sem `import "server-only"` de propósito — mesmo motivo de
// `core/notifications/types.ts`: este arquivo não toca Prisma, e o sino
// (`notification-bell.tsx`, Client Component) o importa diretamente para
// renderizar o conteúdo sem confiar cegamente no JSON vindo do servidor.

/** Tipo gravado em `Notification.tipo` para este aviso. */
export const TIPO_CONVERSA_AGUARDANDO = "CONVERSA_AGUARDANDO";

/**
 * Formato do `payload` gravado por `marcarAguardandoHumano` (notificacoes.ts).
 *
 * `nomeExibicao` é uma cópia congelada no momento da criação, nunca uma
 * referência viva — mesmo raciocínio de `NovoLeadPayload`: não há FK entre
 * `Notification` e `Conversation`, e a notificação precisa continuar legível
 * mesmo que a conversa seja apagada depois.
 */
export type ConversaAguardandoPayload = {
  conversationId: string;
  nomeExibicao: string;
};

/**
 * Extrai o payload de forma defensiva, devolvendo `null` quando o formato não
 * bate — nunca lançando. Quem chama decide o fallback (ver
 * `notification-bell.tsx`), em vez de o app quebrar ao ler um campo ausente.
 */
export function extrairPayloadConversaAguardando(
  payload: unknown
): ConversaAguardandoPayload | null {
  if (
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    typeof (payload as Record<string, unknown>).conversationId === "string" &&
    typeof (payload as Record<string, unknown>).nomeExibicao === "string"
  ) {
    return payload as ConversaAguardandoPayload;
  }
  return null;
}
