"use server";

import { revalidatePath } from "next/cache";

import { usuarioAtual } from "@/core/auth/session";
import { pausarIa, religarIa, responderComoHumano, RespostaHumanaInvalidaError } from "./agente";

/**
 * Mora em `src/modules/whatsapp/`, não em `src/core/whatsapp/` (onde a Task 5
 * original tinha colocado este arquivo — corrigido na rodada de correção 2).
 * WhatsApp é um MÓDULO opcional, não `core`: este é um projeto clonado por
 * cliente, `core` é compartilhado por todos os forks e `modules` contém
 * funcionalidades que um fork pode desligar. `eslint.config.mjs` faz a
 * fronteira valer via `no-restricted-imports`: qualquer arquivo em
 * `src/core/**` que importe de `@/modules` é erro de lint — um Server Action
 * que orquestra `agente.ts` PRECISA morar aqui dentro do módulo. O import
 * abaixo de `@/core/auth/session` é a direção permitida (`modules` → `core`,
 * nunca o contrário); não mova este arquivo de volta para `src/core/whatsapp/`
 * por simetria com `src/core/leads/actions.ts` — leads é feature core deste
 * projeto, WhatsApp não é.
 *
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
 * Mensagem devolvida quando `usuarioAtual()` rejeita — sessão expirada OU
 * usuário desativado no meio do expediente (ver `src/core/auth/session.ts`,
 * que lança a MESMA `Error("Não autenticado")` para os dois casos, de
 * propósito). Por isso esta mensagem nunca tenta distinguir "sua sessão
 * expirou" de "sua conta foi desativada": o helper de origem já decidiu que
 * os dois merecem a mesma orientação, e inventar uma distinção aqui
 * reintroduziria exatamente o que `usuarioAtual()` evita.
 */
const MENSAGEM_SESSAO_INVALIDA = "Sua sessão expirou. Recarregue a página e entre de novo.";

/**
 * Converte um erro capturado em `ResultadoAcao`. Três casos, nesta ordem:
 *
 * 1. `RespostaHumanaInvalidaError` — validação de entrada do próprio
 *    usuário (mensagem vazia, acima do limite). Repassa a própria mensagem:
 *    é segura de mostrar.
 * 2. `Error("Não autenticado")` — o que `usuarioAtual()` lança quando a
 *    sessão expirou ou o usuário foi desativado (fix round 1, achado
 *    Importante: antes desta correção, `usuarioAtual()` rodava FORA do
 *    `try` nas três actions, então essa rejeição nunca passava por aqui —
 *    a promise rejeitava sem produzir `ResultadoAcao` nenhum, o erro cru
 *    atravessava a Server Action, e a tela não mostrava nada: nem sucesso
 *    nem erro. Um atendente com aba aberta há horas, ou desativado no meio
 *    do expediente, clicava em "Enviar" e não acontecia nada visível).
 *    Devolve `MENSAGEM_SESSAO_INVALIDA` ao cliente e ainda assim loga no
 *    servidor — não é um bug de código, mas "sessão vencendo" com o dobro
 *    de frequência pode ser sintoma de token curto demais, e "usuário
 *    desativado tentando agir" é o tipo de evento que vale rastro, mesmo
 *    sendo o sistema se comportando como projetado.
 * 3. Qualquer outro erro (gateway, banco, rede) vira `mensagemGenerica`: o
 *    original é só logado no servidor, nunca devolvido ao cliente, porque
 *    pode carregar detalhe interno (URL do gateway, mensagem de erro do
 *    driver do banco etc.).
 */
function paraResultadoErro(erro: unknown, mensagemGenerica: string): { ok: false; erro: string } {
  if (erro instanceof RespostaHumanaInvalidaError) {
    return { ok: false, erro: erro.message };
  }
  if (erro instanceof Error && erro.message === "Não autenticado") {
    console.error("Ação de WhatsApp negada — sessão expirada ou usuário desativado.", erro);
    return { ok: false, erro: MENSAGEM_SESSAO_INVALIDA };
  }
  console.error(mensagemGenerica, erro);
  return { ok: false, erro: mensagemGenerica };
}

export async function responderConversaAction(
  conversationId: string,
  texto: string
): Promise<ResultadoAcao> {
  // `usuarioAtual()` DENTRO do try — não fora (fix round 1): fora dele, a
  // rejeição de sessão inválida atravessa a Server Action sem produzir
  // `ResultadoAcao`, e a tela não mostra nada. Ver o item 2 de
  // `paraResultadoErro` acima para o raciocínio completo.
  try {
    const usuario = await usuarioAtual();
    await responderComoHumano(conversationId, texto, usuario.id);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao enviar a resposta. Tente novamente.");
  }
  revalidatePath(`/conversas/${conversationId}`);
  revalidatePath("/conversas");
  return { ok: true };
}

export async function pausarIaAction(conversationId: string): Promise<ResultadoAcao> {
  try {
    const usuario = await usuarioAtual();
    await pausarIa(conversationId, usuario.id);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao pausar a IA. Tente novamente.");
  }
  revalidatePath(`/conversas/${conversationId}`);
  revalidatePath("/conversas");
  return { ok: true };
}

export async function religarIaAction(conversationId: string): Promise<ResultadoAcao> {
  try {
    // Gate de sessão — não decorativo. Diferente das outras duas actions
    // (que usam `usuario.id` logo depois e por isso quebrariam um teste
    // sozinhas se a chamada sumisse), esta linha descarta o retorno: é a
    // ÚNICA defesa desta action contra uma chamada não autenticada. Um
    // refactor automatizado que remova chamadas "sem efeito aparente" pode
    // apagá-la sem quebrar nada visível — não remova. Continua DENTRO do
    // try (fix round 1) pelo mesmo motivo das outras duas: fora dele, uma
    // sessão inválida rejeitava sem produzir `ResultadoAcao`.
    await usuarioAtual();
    await religarIa(conversationId);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao religar a IA. Tente novamente.");
  }
  revalidatePath(`/conversas/${conversationId}`);
  revalidatePath("/conversas");
  return { ok: true };
}
