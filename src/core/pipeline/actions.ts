"use server";

import { revalidatePath } from "next/cache";

import { usuarioAtual } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";
import { ehSessaoInvalida, MENSAGEM_SESSAO_INVALIDA, type ResultadoAcao } from "@/lib/acao";
import {
  criarEtapa,
  editarEtapa,
  moverNaOrdem,
  definirEtapaDeFechamento,
  excluirEtapa,
  EtapaInvalidaError,
} from "./service";

/**
 * Server Actions da gestão do funil.
 *
 * Todas devolvem `ResultadoAcao` em vez de lançar — o Next redige erro não
 * tratado em produção, e aqui a distinção entre "já existe uma etapa com esse
 * nome", "esta é a etapa de fechamento" e "banco fora do ar" é justamente o que
 * faz a pessoa agir diferente. Ver `src/lib/acao.ts`.
 *
 * Todas exigem `gerenciar_funil` (só ADMIN). A checagem é aqui, no servidor:
 * esconder o item do menu não protege nada, porque Server Action é endpoint HTTP
 * público e pode ser chamada direto.
 *
 * `autorId` sempre sai de `usuarioAtual()`, nunca de parâmetro.
 */

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão para gerenciar o funil.";

function paraResultadoErro(erro: unknown, mensagemGenerica: string): { ok: false; erro: string } {
  if (erro instanceof EtapaInvalidaError) {
    return { ok: false, erro: erro.message };
  }
  if (ehSessaoInvalida(erro)) {
    console.error("Ação sobre o funil negada — sessão expirada ou usuário desativado.", erro);
    return { ok: false, erro: MENSAGEM_SESSAO_INVALIDA };
  }
  console.error(mensagemGenerica, erro);
  return { ok: false, erro: mensagemGenerica };
}

/**
 * Roda SEMPRE dentro do `try`. Fora dele, uma sessão expirada rejeitaria a
 * promise sem produzir `ResultadoAcao`, e a tela não mostraria nem sucesso nem
 * erro — achado real de revisão nas actions do WhatsApp.
 */
async function exigirGestorDoFunil() {
  const usuario = await usuarioAtual();
  if (!hasPermission(usuario.papel, "gerenciar_funil")) {
    throw new EtapaInvalidaError(MENSAGEM_SEM_PERMISSAO);
  }
  return usuario;
}

/**
 * Invalidação explícita, caminho por caminho, no molde de
 * `invalidarCaminhosDeLead` (`core/leads/actions.ts`).
 *
 * Os dois últimos usam PADRÃO de rota com `type: "page"`, e não caminho literal,
 * porque aqui não existe UM lead ou UM contato afetado: renomear "Proposta" muda
 * o `<select>` de todo lead e a coluna "Etapa" de toda pessoa que tenha um lead
 * ali. O prefixo `/(painel)` entra porque `revalidatePath` opera na estrutura de
 * ARQUIVOS da rota, não na URL visível — ver
 * `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md`
 * e o comentário longo em `core/leads/actions.ts:82-98`.
 *
 * Não confiar no comportamento temporário: a mesma doc diz que hoje
 * `revalidatePath` também atualiza páginas já visitadas, e que isso "is temporary".
 * É o que mascararia um caminho esquecido nesta lista.
 */
function invalidarCaminhosDeFunil() {
  revalidatePath("/");
  revalidatePath("/leads");
  revalidatePath("/leads/kanban");
  revalidatePath("/(painel)/leads/[id]", "page");
  revalidatePath("/(painel)/contatos/[id]", "page");
}

export async function criarEtapaAction(dados: { nome: string; cor: string }): Promise<ResultadoAcao> {
  try {
    const autor = await exigirGestorDoFunil();
    await criarEtapa({ nome: dados.nome, cor: dados.cor, autorId: autor.id });
  } catch (erro) {
    return paraResultadoErro(erro, "Não foi possível criar a etapa. Tente novamente.");
  }
  // Fora do `try`: invalidar cache não faz parte de "a etapa foi criada". Uma
  // falha de revalidação viraria "não foi possível criar" para uma etapa que JÁ
  // existe no banco, e a pessoa tentaria de novo — colidindo no nome.
  invalidarCaminhosDeFunil();
  return { ok: true };
}

export async function editarEtapaAction(dados: {
  etapaId: string;
  nome: string;
  cor: string;
}): Promise<ResultadoAcao> {
  try {
    const autor = await exigirGestorDoFunil();
    await editarEtapa({ ...dados, autorId: autor.id });
  } catch (erro) {
    return paraResultadoErro(erro, "Não foi possível salvar a etapa. Tente novamente.");
  }
  invalidarCaminhosDeFunil();
  return { ok: true };
}

export async function moverEtapaNaOrdemAction(dados: {
  etapaId: string;
  direcao: "cima" | "baixo";
}): Promise<ResultadoAcao> {
  try {
    const autor = await exigirGestorDoFunil();
    await moverNaOrdem({ ...dados, autorId: autor.id });
  } catch (erro) {
    return paraResultadoErro(erro, "Não foi possível reordenar o funil. Tente novamente.");
  }
  invalidarCaminhosDeFunil();
  return { ok: true };
}

export async function definirEtapaDeFechamentoAction(etapaId: string): Promise<ResultadoAcao> {
  try {
    const autor = await exigirGestorDoFunil();
    await definirEtapaDeFechamento({ etapaId, autorId: autor.id });
  } catch (erro) {
    return paraResultadoErro(erro, "Não foi possível marcar a etapa de fechamento. Tente novamente.");
  }
  invalidarCaminhosDeFunil();
  return { ok: true };
}

export async function excluirEtapaAction(dados: {
  etapaId: string;
  destinoId: string | null;
}): Promise<ResultadoAcao> {
  try {
    const autor = await exigirGestorDoFunil();
    await excluirEtapa({ ...dados, autorId: autor.id });
  } catch (erro) {
    return paraResultadoErro(erro, "Não foi possível remover a etapa. Tente novamente.");
  }
  invalidarCaminhosDeFunil();
  return { ok: true };
}
