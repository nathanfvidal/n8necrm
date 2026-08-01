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
 * `revalidatePath("/(painel)", "layout")` invalida especificamente
 * `(painel)/layout.tsx` — não uma `page.tsx` qualquer — quem busca a
 * contagem de não lidas e passa para `PainelNav`; a lista de notificações
 * vive no cabeçalho, presente em toda rota sob esse layout. Sem isso, o
 * cliente (`notification-bell.tsx`) já atualiza a UI de forma otimista, mas
 * uma navegação para outra página logo em seguida buscaria o layout do
 * servidor com a contagem antiga em cache.
 *
 * Fix round 1/5 (achado do revisor): a versão anterior chamava
 * `revalidatePath("/", "layout")` — a doc do Next classifica esse par
 * específico à parte como "Revalidating all data" (ver
 * node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md):
 * "purge[s] the Client Cache, and invalidate[s] all cached data" no app
 * INTEIRO, não só o layout do painel (o comentário antigo dizia uma coisa,
 * o código fazia outra, maior). `revalidatePath` "opera na estrutura de
 * arquivos da rota, não na URL visível" (mesma doc) — `"/(painel)"` (o
 * caminho do diretório `src/app/(painel)/`, não uma URL real, já que route
 * groups não aparecem na URL) mira só esse layout, deixando de fora
 * `src/app/layout.tsx` (raiz, ancestral de `/login` também) e qualquer
 * cache futuro fora do painel. Verificado ao vivo: a contagem do sino
 * continua atualizando sem reload de página inteira com este escopo mais
 * estreito.
 */
export async function marcarNotificacaoComoLidaAction(notificationId: string): Promise<void> {
  const autor = await usuarioAtual();
  await marcarComoLida({ notificationId, userId: autor.id });
  revalidatePath("/(painel)", "layout");
}
