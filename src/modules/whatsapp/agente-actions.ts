"use server";

import { revalidatePath } from "next/cache";

import { usuarioAtual } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";
import { restaurarConfigPadrao, salvarConfigBot } from "./agente";
import { MAX_PERSONA_NOME, MAX_PERSONA_PAPEL, MAX_REGRA, MAX_REGRAS, MAX_FAQ } from "./agente-limites";
import type { ResultadoAcao } from "./actions";

/**
 * Mora em `src/modules/whatsapp/`, não em `src/core/whatsapp/` (onde o brief
 * original da Task 7 tinha colocado este arquivo). Mesmo motivo de
 * `actions.ts` neste diretório: WhatsApp é um MÓDULO opcional, não `core` —
 * este é um projeto clonado por cliente, `core` é compartilhado por todos os
 * forks e `modules` contém funcionalidades que um fork pode desligar.
 * `eslint.config.mjs` faz a fronteira valer via `no-restricted-imports`:
 * qualquer arquivo em `src/core/**` que importe de `@/modules` é erro de
 * lint. O import abaixo de `@/core/auth/session` e `@/core/auth/permissions`
 * é a direção permitida (`modules` → `core`, nunca o contrário).
 *
 * Arquivo separado de `actions.ts` (não as mesmas três actions de
 * pausar/religar/responder) porque guarda uma permissão diferente: aquelas
 * exigem só sessão válida (qualquer papel atende qualquer lead), estas
 * exigem `configurar_agente` — só ADMIN edita a persona do bot, ver
 * `src/core/auth/permissions.ts`.
 *
 * `usuarioAtual()` é a única fonte de "quem está agindo": Server Action é
 * endpoint HTTP público, um `usuarioId` de formulário seria forjável.
 */

/**
 * Erro esperado e seguro de mostrar ao cliente: permissão negada, ou entrada
 * inválida do próprio ADMIN (persona vazia, nenhuma regra). Distinto de
 * qualquer outra falha (banco fora do ar, etc.), cujo texto nunca deve
 * chegar à tela — mesmo raciocínio de `RespostaHumanaInvalidaError` em
 * `actions.ts`.
 */
class ErroConfigAgente extends Error {}

/**
 * Mesma mensagem e mesmo raciocínio de `MENSAGEM_SESSAO_INVALIDA` em
 * `actions.ts` (não exportada de lá, duplicada aqui de propósito): cobre
 * tanto sessão expirada quanto usuário desativado no meio do expediente,
 * porque `usuarioAtual()` lança a MESMA `Error("Não autenticado")` para os
 * dois casos.
 */
const MENSAGEM_SESSAO_INVALIDA = "Sua sessão expirou. Recarregue a página e entre de novo.";

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão para configurar o agente.";

/**
 * Converte um erro capturado em `ResultadoAcao`. Mesmo formato de
 * `paraResultadoErro` em `actions.ts` (não exportada de lá, duplicada aqui
 * de propósito — as duas famílias de erro "seguro de mostrar" são
 * diferentes: `RespostaHumanaInvalidaError` lá, `ErroConfigAgente` aqui).
 */
function paraResultadoErro(erro: unknown, mensagemGenerica: string): { ok: false; erro: string } {
  if (erro instanceof ErroConfigAgente) {
    return { ok: false, erro: erro.message };
  }
  if (erro instanceof Error && erro.message === "Não autenticado") {
    console.error("Ação de configuração do agente negada — sessão expirada ou usuário desativado.", erro);
    return { ok: false, erro: MENSAGEM_SESSAO_INVALIDA };
  }
  console.error(mensagemGenerica, erro);
  return { ok: false, erro: mensagemGenerica };
}

// `usuarioAtual()` roda DENTRO desta função, e esta função é sempre chamada
// dentro do `try` das duas actions abaixo — não fora dele. É o ponto que
// derrubou uma rodada de revisão anterior nesta fatia (Task 5): fora do
// `try`, uma sessão inválida rejeita a promise sem nunca produzir um
// `ResultadoAcao`, e a tela não mostra nada, nem sucesso nem erro.
async function exigirAdmin() {
  const usuario = await usuarioAtual();
  if (!hasPermission(usuario.papel, "configurar_agente")) {
    throw new ErroConfigAgente(MENSAGEM_SEM_PERMISSAO);
  }
  return usuario;
}

export async function salvarConfigAgenteAction(dados: {
  ativo: boolean;
  personaNome: string;
  personaPapel: string;
  regras: string[];
  faq: string;
}): Promise<ResultadoAcao> {
  try {
    const usuario = await exigirAdmin();

    const personaNome = dados.personaNome.trim();
    const personaPapel = dados.personaPapel.trim();
    if (personaNome.length === 0 || personaPapel.length === 0) {
      throw new ErroConfigAgente("Nome e papel da persona são obrigatórios.");
    }
    // Tetos de tamanho (rodada de correção 1, achado I1): sem isto, um ADMIN
    // colando um documento inteiro num destes campos multiplica o custo de
    // token de TODA resposta a TODO cliente, em silêncio — ver o raciocínio
    // completo em `agente-limites.ts`. Checado aqui, na action, porque é o
    // único ponto que nenhuma entrada consegue contornar; o `maxLength` do
    // formulário é só conveniência de UI, não a defesa de verdade.
    if (personaNome.length > MAX_PERSONA_NOME) {
      throw new ErroConfigAgente(`Nome da persona acima do limite de ${MAX_PERSONA_NOME} caracteres.`);
    }
    if (personaPapel.length > MAX_PERSONA_PAPEL) {
      throw new ErroConfigAgente(`Papel da persona acima do limite de ${MAX_PERSONA_PAPEL} caracteres.`);
    }

    // Regras vazias são descartadas em vez de rejeitadas: uma linha em
    // branco no textarea é acidente de digitação, não intenção.
    const regras = dados.regras.map((r) => r.trim()).filter((r) => r.length > 0);
    if (regras.length === 0) {
      throw new ErroConfigAgente("O agente precisa de pelo menos uma regra.");
    }
    // Revisão final, achado I3: teto na QUANTIDADE de regras, além do teto
    // de tamanho de cada uma logo abaixo — ver o raciocínio completo em
    // `agente-limites.ts`.
    if (regras.length > MAX_REGRAS) {
      throw new ErroConfigAgente(`No máximo ${MAX_REGRAS} regras — hoje há ${regras.length}.`);
    }
    if (regras.some((regra) => regra.length > MAX_REGRA)) {
      throw new ErroConfigAgente(`Cada regra pode ter no máximo ${MAX_REGRA} caracteres.`);
    }

    const faq = dados.faq.trim();
    if (faq.length > MAX_FAQ) {
      throw new ErroConfigAgente(`FAQ acima do limite de ${MAX_FAQ} caracteres.`);
    }

    await salvarConfigBot({ ativo: dados.ativo, personaNome, personaPapel, regras, faq }, usuario.id);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao salvar a configuração do agente. Tente novamente.");
  }
  revalidatePath("/conversas/agente");
  return { ok: true };
}

export async function restaurarConfigPadraoAction(): Promise<ResultadoAcao> {
  try {
    const usuario = await exigirAdmin();
    await restaurarConfigPadrao(usuario.id);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao restaurar a configuração padrão. Tente novamente.");
  }
  revalidatePath("/conversas/agente");
  return { ok: true };
}
