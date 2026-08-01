"use server";

import { revalidatePath } from "next/cache";

import { usuarioAtual } from "@/core/auth/session";
import { marcarComoLida } from "./dispatch";

/**
 * Marca uma notificação do usuário logado como lida. Server Action —
 * endpoint HTTP público (ver decisão de segurança da Task 13): `userId`
 * NUNCA vem do cliente, é sempre derivado da sessão via `usuarioAtual()`.
 * `notificationId` vem do sino (`notification-bell.tsx`), que só lista
 * notificações do próprio usuário — mas isso é só a UI não oferecer o botão
 * errado; a barreira real é a checagem de dono dentro de `marcarComoLida`
 * (`dispatch.ts`), que confere `notification.userId === userId` antes de
 * gravar, mesmo padrão de `concluirMinhaTask`/`concluirTask` (Task 18).
 *
 * `revalidatePath("/", "layout")` invalida o layout do painel inteiro (não
 * só a página atual) porque é `(painel)/layout.tsx` — não uma `page.tsx`
 * qualquer — quem busca a contagem de não lidas e passa para `PainelNav`; a
 * lista de notificações vive no cabeçalho, presente em toda rota sob o
 * layout. Sem isso, o cliente (`notification-bell.tsx`) já atualiza a UI
 * de forma otimista, mas uma navegação para outra página logo em seguida
 * buscaria o layout do servidor com a contagem antiga em cache.
 */
export async function marcarNotificacaoComoLidaAction(notificationId: string): Promise<void> {
  const autor = await usuarioAtual();
  await marcarComoLida({ notificationId, userId: autor.id });
  revalidatePath("/", "layout");
}
