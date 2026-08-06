"use server";

import { revalidatePath } from "next/cache";

import { usuarioAtual } from "@/core/auth/session";
import { pausarIa, religarIa, responderComoHumano } from "@/modules/whatsapp/agente";

/**
 * Responder, pausar e religar exigem apenas sessão válida — não uma ação
 * própria na matriz de permissões. São operações de atendimento, e o projeto
 * já decidiu que todos os papéis veem e atendem todos os leads. Quem edita a
 * PERSONA (`configurar_agente`) é que é restrito — ver actions da tela do
 * agente.
 *
 * `usuarioAtual()` é a única fonte de "quem está agindo": Server Action é
 * endpoint HTTP público, um `usuarioId` de formulário seria forjável.
 */
export async function responderConversaAction(conversationId: string, texto: string): Promise<void> {
  const usuario = await usuarioAtual();
  await responderComoHumano(conversationId, texto, usuario.id);
  revalidatePath(`/conversas/${conversationId}`);
  revalidatePath("/conversas");
}

export async function pausarIaAction(conversationId: string): Promise<void> {
  const usuario = await usuarioAtual();
  await pausarIa(conversationId, usuario.id);
  revalidatePath(`/conversas/${conversationId}`);
  revalidatePath("/conversas");
}

export async function religarIaAction(conversationId: string): Promise<void> {
  await usuarioAtual();
  await religarIa(conversationId);
  revalidatePath(`/conversas/${conversationId}`);
  revalidatePath("/conversas");
}
