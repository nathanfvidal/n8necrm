"use server";

import { revalidatePath } from "next/cache";

import { usuarioAtual } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";
import { ehSessaoInvalida, MENSAGEM_SESSAO_INVALIDA, type ResultadoAcao } from "@/lib/acao";
import { atualizarUsuario, criarUsuario, definirAtivo, redefinirSenha, UsuarioInvalidoError } from "./service";
import type { Role } from "@prisma/client";

/**
 * Server Actions da gestão de equipe.
 *
 * Todas devolvem `ResultadoAcao` em vez de lançar: o Next redige erro não
 * tratado em produção, e aqui a distinção entre "e-mail já existe", "você é o
 * último administrador" e "banco fora do ar" é justamente o que faz a pessoa
 * agir diferente. Ver `src/lib/acao.ts`.
 *
 * Todas exigem `gerenciar_usuarios` (só ADMIN — `core/auth/permissions.ts`).
 * A checagem é aqui, no servidor: esconder o menu não protege nada, porque
 * Server Action é endpoint HTTP público e pode ser chamada direto.
 *
 * `autorId` sempre sai de `usuarioAtual()`, nunca de parâmetro — um id vindo
 * do formulário seria forjável, e este é o arquivo onde isso valeria mais a
 * pena forjar: quem "cria usuário" escolhe o próprio papel.
 */

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão para gerenciar usuários.";

/**
 * Converte erro em `ResultadoAcao`. Mesmo formato dos mapeadores do módulo de
 * WhatsApp — só varia a família de erro segura de mostrar, aqui
 * `UsuarioInvalidoError`.
 */
function paraResultadoErro(erro: unknown, mensagemGenerica: string): { ok: false; erro: string } {
  if (erro instanceof UsuarioInvalidoError) {
    return { ok: false, erro: erro.message };
  }
  if (ehSessaoInvalida(erro)) {
    console.error("Ação de gestão de usuários negada — sessão expirada ou usuário desativado.", erro);
    return { ok: false, erro: MENSAGEM_SESSAO_INVALIDA };
  }
  console.error(mensagemGenerica, erro);
  return { ok: false, erro: mensagemGenerica };
}

/**
 * Roda SEMPRE dentro do `try` de cada action. Fora dele, uma sessão expirada
 * rejeitaria a promise sem produzir `ResultadoAcao`, e a tela não mostraria
 * nada — nem sucesso nem erro. Foi um achado real de revisão nas actions do
 * WhatsApp, e a forma de não repetir é esta função nunca ser chamada solta.
 */
async function exigirGestorDeUsuarios() {
  const usuario = await usuarioAtual();
  if (!hasPermission(usuario.papel, "gerenciar_usuarios")) {
    throw new UsuarioInvalidoError(MENSAGEM_SEM_PERMISSAO);
  }
  return usuario;
}

export async function criarUsuarioAction(dados: {
  nome: string;
  email: string;
  papel: Role;
  senha: string;
}): Promise<ResultadoAcao> {
  try {
    const autor = await exigirGestorDeUsuarios();
    await criarUsuario(dados, autor.id, autor.companyId);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao criar o usuário. Tente novamente.");
  }
  revalidatePath("/usuarios");
  return { ok: true };
}

export async function atualizarUsuarioAction(dados: {
  id: string;
  nome: string;
  papel: Role;
}): Promise<ResultadoAcao> {
  try {
    const autor = await exigirGestorDeUsuarios();
    await atualizarUsuario(dados, autor.id, autor.companyId);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao salvar o usuário. Tente novamente.");
  }
  revalidatePath("/usuarios");
  return { ok: true };
}

export async function definirAtivoAction(dados: { id: string; ativo: boolean }): Promise<ResultadoAcao> {
  try {
    const autor = await exigirGestorDeUsuarios();
    await definirAtivo(dados, autor.id, autor.companyId);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao mudar a situação do usuário. Tente novamente.");
  }
  // Também invalida o layout do painel: `(painel)/layout.tsx` resolve o
  // usuário da sessão a cada navegação, e desativar alguém muda o que aquela
  // pessoa pode ver. Mesmo escopo estreito de `criarLeadManual` — o caminho
  // do ARQUIVO com o route group, não `revalidatePath("/", "layout")`, que a
  // doc do Next classifica como "revalidating all data".
  revalidatePath("/(painel)", "layout");
  revalidatePath("/usuarios");
  return { ok: true };
}

export async function redefinirSenhaAction(dados: { id: string; senha: string }): Promise<ResultadoAcao> {
  try {
    const autor = await exigirGestorDeUsuarios();
    await redefinirSenha(dados, autor.id);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao redefinir a senha. Tente novamente.");
  }
  // Sem `revalidatePath`: a senha não aparece em tela nenhuma, então não há
  // nada renderizado que tenha ficado desatualizado.
  return { ok: true };
}
