"use server";

import { revalidatePath } from "next/cache";

import { usuarioAtual } from "@/core/auth/session";
import {
  pausarIa,
  religarIa,
  responderComoHumano,
  RespostaHumanaInvalidaError,
} from "@/modules/whatsapp/agente";

/**
 * Responder, pausar e religar exigem apenas sessão válida — não uma ação
 * própria na matriz de permissões. São operações de atendimento, e o projeto
 * já decidiu que todos os papéis veem e atendem todos os leads. A Task 7
 * (tela de configuração do agente) é quem vai restringir quem EDITA a
 * persona do bot — essa permissão (`configurar_agente`) e as actions dela
 * ainda não existem neste branch; a frase acima só marca a expectativa para
 * quando chegarem, não uma referência a algo já implementado.
 *
 * `usuarioAtual()` é a única fonte de "quem está agindo": Server Action é
 * endpoint HTTP público, um `usuarioId` de formulário seria forjável.
 */

/**
 * Resultado uniforme das três actions abaixo.
 *
 * ## Por que devolver resultado em vez de lançar
 *
 * O Next **redige erros não tratados** que atravessam uma Server Action em
 * produção — a tela recebe uma mensagem genérica com um identificador, não o
 * `Error.message` original lançado no servidor. Se estas actions deixassem o
 * erro subir, "Mensagem vazia", "Mensagem acima do limite" e "gateway fora
 * do ar" chegariam à tela como a MESMA mensagem opaca — e é exatamente a
 * distinção que o docstring de `responderComoHumano` promete ("o humano vê o
 * erro e repete"): se ele não consegue diferenciar "não enviou" de "enviou e
 * não gravou", a premissa que torna a ordem pausa→envia→grava seguro cai.
 *
 * Por isso cada action captura o erro e devolve `ResultadoAcao` em vez de
 * lançar. Não "simplifique" isto de volta para `throw` — seria reintroduzir
 * exatamente a redação genérica que este tipo existe para evitar.
 */
export type ResultadoAcao = { ok: true } | { ok: false; erro: string };

/**
 * Converte um erro capturado em `ResultadoAcao`. Erros de validação
 * (`RespostaHumanaInvalidaError`) repassam a própria mensagem — ela descreve
 * uma entrada inválida do usuário, é segura de mostrar. Qualquer outro erro
 * (gateway, banco, rede) vira `mensagemGenerica`: o original é só logado no
 * servidor, nunca devolvido ao cliente, porque pode carregar detalhe interno
 * (URL do gateway, mensagem de erro do driver do banco etc.).
 */
function paraResultadoErro(erro: unknown, mensagemGenerica: string): { ok: false; erro: string } {
  if (erro instanceof RespostaHumanaInvalidaError) {
    return { ok: false, erro: erro.message };
  }
  console.error(mensagemGenerica, erro);
  return { ok: false, erro: mensagemGenerica };
}

export async function responderConversaAction(
  conversationId: string,
  texto: string
): Promise<ResultadoAcao> {
  const usuario = await usuarioAtual();
  try {
    await responderComoHumano(conversationId, texto, usuario.id);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao enviar a resposta. Tente novamente.");
  }
  revalidatePath(`/conversas/${conversationId}`);
  revalidatePath("/conversas");
  return { ok: true };
}

export async function pausarIaAction(conversationId: string): Promise<ResultadoAcao> {
  const usuario = await usuarioAtual();
  try {
    await pausarIa(conversationId, usuario.id);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao pausar a IA. Tente novamente.");
  }
  revalidatePath(`/conversas/${conversationId}`);
  revalidatePath("/conversas");
  return { ok: true };
}

export async function religarIaAction(conversationId: string): Promise<ResultadoAcao> {
  // Gate de sessão — não decorativo. Diferente das outras duas actions
  // (que usam `usuario.id` logo depois e por isso quebrariam um teste
  // sozinhas se a chamada sumisse), esta linha descarta o retorno: é a
  // ÚNICA defesa desta action contra uma chamada não autenticada. Um
  // refactor automatizado que remova chamadas "sem efeito aparente" pode
  // apagá-la sem quebrar nada visível — não remova.
  await usuarioAtual();
  try {
    await religarIa(conversationId);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao religar a IA. Tente novamente.");
  }
  revalidatePath(`/conversas/${conversationId}`);
  revalidatePath("/conversas");
  return { ok: true };
}
