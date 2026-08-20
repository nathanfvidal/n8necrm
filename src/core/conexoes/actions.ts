"use server";

import { revalidatePath } from "next/cache";

import { usuarioAtual } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";
import { ehSessaoInvalida, MENSAGEM_SESSAO_INVALIDA, type ResultadoAcao } from "@/lib/acao";

import {
  criarConexao,
  substituirSegredo,
  atualizarConexao,
  definirAtiva,
  regenerarWebhookToken,
  apagarConexao,
  ConexaoInvalidaError,
} from "./service";

/**
 * As Server Actions da aba de Conexões.
 *
 * ## A empresa vem de `usuarioAtual()`, nunca do payload
 *
 * Server Action é endpoint HTTP público. Um `companyId` de formulário seria
 * forjável, e quem tivesse sessão em qualquer empresa cadastraria conexão na
 * de outra — que aqui significaria receber as mensagens dela. Há caso de teste
 * mandando `companyId` no payload e afirmando que ele é IGNORADO
 * ("nenhuma action aceita `companyId` no payload", em
 * `tests/unit/conexoes-actions.test.ts`).
 *
 * ## As actions DEVOLVEM resultado, não lançam
 *
 * O Next redige erros não tratados de Server Action antes que cheguem ao
 * cliente — o raciocínio inteiro está em `src/lib/acao.ts`. Sem isto, "domínio
 * inválido" e "banco fora do ar" chegariam com a mesma mensagem opaca.
 *
 * ## O que volta, e o que nunca volta
 *
 * Volta: `ok`, uma mensagem de erro SEGURA, e — só em `criar` e em
 * `regenerarWebhook` — o **path** do webhook, uma vez.
 *
 * Nunca volta: a apikey, o blob cifrado, o token de um webhook já criado. Nem
 * como confirmação do que a pessoa acabou de digitar: confirmar exigiria o
 * servidor devolver o que recebeu, e é exatamente esse retorno que um XSS
 * leria. O caso "o retorno serializado das SEIS actions só tem chaves de uma
 * LISTA FECHADA" é o que amarra a palavra "nunca" — ele reprova qualquer chave
 * que apareça no retorno sem estar na lista, inclusive uma que ninguém previu.
 *
 * O PATH e não a URL inteira: quem sabe a origem com certeza é o navegador
 * (`window.location.origin`). Montá-la no servidor exigiria uma variável de
 * ambiente nova ou confiar no header `Host`, que é do cliente.
 */

export type ResultadoComWebhook = { ok: true; webhookPath: string } | { ok: false; erro: string };

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão para gerenciar as conexões de WhatsApp.";

/**
 * `usuarioAtual()` roda DENTRO desta função, e esta função é sempre chamada
 * dentro do `try` de cada action — nunca fora. Fora do `try`, uma sessão
 * inválida rejeita a promise sem nunca produzir um `ResultadoAcao`, e a tela
 * não mostra nada, nem sucesso nem erro. É o ponto que derrubou uma rodada de
 * revisão na Fatia 2 do WhatsApp, e o caso "sessão expirada no meio da ação
 * vira resultado, não promessa rejeitada" percorre as seis actions afirmando
 * isso.
 */
async function exigirAdmin() {
  const usuario = await usuarioAtual();
  if (!hasPermission(usuario.papel, "gerenciar_conexoes")) {
    throw new ConexaoInvalidaError(MENSAGEM_SEM_PERMISSAO);
  }
  return usuario;
}

function paraResultadoErro(erro: unknown, mensagemGenerica: string): { ok: false; erro: string } {
  if (erro instanceof ConexaoInvalidaError) {
    return { ok: false, erro: erro.message };
  }
  if (ehSessaoInvalida(erro)) {
    console.error("Ação de conexão negada — sessão expirada ou usuário desativado.", erro);
    return { ok: false, erro: MENSAGEM_SESSAO_INVALIDA };
  }
  // Tudo o mais é genérico, e o detalhe fica no log do servidor: um erro do
  // cofre carrega o `keyId`, um do Prisma carrega nome de coluna. Nenhum dos
  // dois é para a tela. Tem caso de teste afirmando que o `keyId` não vaza.
  console.error(mensagemGenerica, erro);
  return { ok: false, erro: mensagemGenerica };
}

function caminhoDoWebhook(companyId: string, token: string): string {
  return `/api/whatsapp/evolution/${companyId}/${token}`;
}

export async function criarConexaoAction(dados: {
  canal: "EVOLUTION" | "META_CLOUD";
  nome: string;
  dominio: string;
  instancia: string;
  segredo: string;
}): Promise<ResultadoComWebhook> {
  let webhookPath: string;
  try {
    const usuario = await exigirAdmin();
    const { webhookToken } = await criarConexao(
      usuario.companyId,
      // Os campos são copiados UM A UM, e não com um spread de `dados`: o
      // payload chega do navegador e pode carregar o que quiser dentro dele —
      // um `companyId` a mais entraria no `create` do Prisma por um spread e
      // reabriria exatamente o buraco que o parágrafo do topo fecha.
      {
        canal: dados.canal,
        nome: dados.nome,
        dominio: dados.dominio,
        instancia: dados.instancia,
        segredo: dados.segredo,
      },
      usuario.id
    );
    webhookPath = caminhoDoWebhook(usuario.companyId, webhookToken);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao cadastrar a conexão. Tente novamente.");
  }
  revalidatePath("/configuracoes/conexoes");
  return { ok: true, webhookPath };
}

export async function substituirSegredoAction(entrada: {
  id: string;
  segredo: string;
}): Promise<ResultadoAcao> {
  try {
    const usuario = await exigirAdmin();
    await substituirSegredo(usuario.companyId, entrada.id, entrada.segredo, usuario.id);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao substituir a chave. Tente novamente.");
  }
  revalidatePath("/configuracoes/conexoes");
  return { ok: true };
}

export async function atualizarConexaoAction(entrada: {
  id: string;
  nome: string;
  dominio: string;
  instancia: string;
}): Promise<ResultadoAcao> {
  try {
    const usuario = await exigirAdmin();
    await atualizarConexao(
      usuario.companyId,
      entrada.id,
      { nome: entrada.nome, dominio: entrada.dominio, instancia: entrada.instancia },
      usuario.id
    );
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao salvar a conexão. Tente novamente.");
  }
  revalidatePath("/configuracoes/conexoes");
  return { ok: true };
}

export async function definirAtivaAction(entrada: {
  id: string;
  ativa: boolean;
}): Promise<ResultadoAcao> {
  try {
    const usuario = await exigirAdmin();
    await definirAtiva(usuario.companyId, entrada.id, entrada.ativa, usuario.id);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao mudar o estado da conexão. Tente novamente.");
  }
  revalidatePath("/configuracoes/conexoes");
  return { ok: true };
}

export async function regenerarWebhookAction(entrada: {
  id: string;
}): Promise<ResultadoComWebhook> {
  let webhookPath: string;
  try {
    const usuario = await exigirAdmin();
    const { webhookToken } = await regenerarWebhookToken(usuario.companyId, entrada.id, usuario.id);
    webhookPath = caminhoDoWebhook(usuario.companyId, webhookToken);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao gerar a URL nova. Tente novamente.");
  }
  revalidatePath("/configuracoes/conexoes");
  return { ok: true, webhookPath };
}

export async function apagarConexaoAction(entrada: { id: string }): Promise<ResultadoAcao> {
  try {
    const usuario = await exigirAdmin();
    await apagarConexao(usuario.companyId, entrada.id, usuario.id);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao apagar a conexão. Tente novamente.");
  }
  revalidatePath("/configuracoes/conexoes");
  return { ok: true };
}
