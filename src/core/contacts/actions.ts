"use server";

import { revalidatePath } from "next/cache";

import { usuarioAtual } from "@/core/auth/session";
import { ehSessaoInvalida, MENSAGEM_SESSAO_INVALIDA, type ResultadoAcao } from "@/lib/acao";
import { atualizarContato, criarContato, ContatoInvalidoError } from "./service";

/**
 * Server Actions da agenda de contatos.
 *
 * Exigem sessão válida e nada além disso — **não** uma permissão própria. É a
 * mesma decisão que as ações de atendimento do WhatsApp já tomaram, e vem de
 * uma decisão anterior do projeto: todos os papéis veem e trabalham todos os
 * leads. Um vendedor que não pudesse corrigir o telefone de quem ele mesmo
 * atende teria de pedir para um gestor, e o cadastro errado sobreviveria por
 * atrito. Não crie permissão por simetria com `gerenciar_usuarios`: aquela
 * existe porque criar conta é criar acesso ao sistema, o que é outra coisa.
 *
 * `autorId` sai sempre de `usuarioAtual()`, dentro do `try` — fora dele, uma
 * sessão expirada rejeita sem produzir `ResultadoAcao` e a tela não mostra
 * nada.
 */

function paraResultadoErro(erro: unknown, mensagemGenerica: string): { ok: false; erro: string } {
  if (erro instanceof ContatoInvalidoError) {
    return { ok: false, erro: erro.message };
  }
  if (ehSessaoInvalida(erro)) {
    console.error("Ação de contato negada — sessão expirada ou usuário desativado.", erro);
    return { ok: false, erro: MENSAGEM_SESSAO_INVALIDA };
  }
  console.error(mensagemGenerica, erro);
  return { ok: false, erro: mensagemGenerica };
}

export async function criarContatoAction(dados: {
  nome: string;
  telefone: string;
  email?: string;
}): Promise<ResultadoAcao> {
  try {
    const autor = await usuarioAtual();
    await criarContato(dados, autor.id);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao salvar o contato. Tente novamente.");
  }
  revalidatePath("/contatos");
  return { ok: true };
}

export async function atualizarContatoAction(dados: {
  id: string;
  nome: string;
  telefone: string;
  email?: string;
}): Promise<ResultadoAcao> {
  try {
    const autor = await usuarioAtual();
    await atualizarContato(dados, autor.id);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao salvar o contato. Tente novamente.");
  }
  revalidatePath(`/contatos/${dados.id}`);
  revalidatePath("/contatos");
  return { ok: true };
}
