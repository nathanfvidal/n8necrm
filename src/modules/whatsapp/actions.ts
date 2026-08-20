"use server";

import { revalidatePath } from "next/cache";

import { usuarioAtual } from "@/core/auth/session";
import { ehSessaoInvalida, MENSAGEM_SESSAO_INVALIDA, type ResultadoAcao } from "@/lib/acao";
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
 * `ResultadoAcao` e `MENSAGEM_SESSAO_INVALIDA` **nasceram neste arquivo** e
 * foram promovidos para `src/lib/acao.ts` quando `core/users` passou a
 * precisar do mesmo contrato: `src/core` não pode importar de `src/modules`
 * (regra de ESLint), então mantê-los aqui obrigaria o núcleo a duplicá-los.
 * O raciocínio completo de "por que devolver resultado em vez de lançar"
 * mora lá agora — e continua valendo em dobro para este arquivo, porque é a
 * distinção entre "não enviou" e "enviou e não gravou" que sustenta a ordem
 * pausa→envia→grava de `responderComoHumano`.
 *
 * Reexportado para não quebrar quem importa `ResultadoAcao` daqui
 * (`agente-actions.ts` e os componentes da inbox).
 */
export type { ResultadoAcao };

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
  if (ehSessaoInvalida(erro)) {
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
    await responderComoHumano(usuario.companyId, conversationId, texto, usuario.id);
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
    await pausarIa(usuario.companyId, conversationId, usuario.id);
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
    const usuario = await usuarioAtual();
    await religarIa(usuario.companyId, conversationId);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao religar a IA. Tente novamente.");
  }
  revalidatePath(`/conversas/${conversationId}`);
  revalidatePath("/conversas");
  return { ok: true };
}
