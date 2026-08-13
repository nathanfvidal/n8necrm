"use server";

import { revalidatePath } from "next/cache";

import type { User } from "@prisma/client";

import { usuarioAtual } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";
import { ehSessaoInvalida, MENSAGEM_SESSAO_INVALIDA, type ResultadoAcao } from "@/lib/acao";
import {
  atualizarContato,
  criarContato,
  ContatoInvalidoError,
  type DadosCadastrais,
} from "./service";

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

/**
 * Tira `documento` do que veio do cliente quando quem age não pode mexer nele.
 *
 * ## Isto NÃO é só uma trava de segurança — é o que impede perda de dado
 *
 * O campo não é renderizado para VENDEDOR, mas o `react-hook-form` mantém o
 * valor padrão dos campos não registrados, então o formulário dele envia
 * `documento: ""` mesmo sem desenhar nada. Sem esta função, salvar qualquer
 * correção de telefone feita por um vendedor APAGARIA o CPF do contato —
 * `""` vira `null` no schema, e `null` no `update` do Prisma apaga.
 *
 * Por isso a chave é REMOVIDA e não zerada: ausente vira `undefined`, que para
 * o Prisma significa "não mexa nesta coluna". Zerar seria o mesmo bug com
 * outra roupa.
 *
 * ## Por que ignorar em silêncio, e não recusar
 *
 * O formulário legítimo nunca manda o campo; um `documento` chegando de um
 * VENDEDOR é cliente desatualizado ou POST direto. Recusar com mensagem
 * confirmaria ao curioso que o campo existe e é protegido. Ignorar não
 * confirma nada e não quebra nada — e a tentativa fica no `AuditLog` de
 * qualquer forma, pelo `documentoAlterado: false`.
 */
function semDocumentoSeNaoPodeVer<T extends { documento?: string | null }>(
  dados: T,
  autor: User
): T {
  if (hasPermission(autor.papel, "ver_documento_contato")) return dados;
  const { documento: _ignorado, ...resto } = dados;
  return resto as T;
}

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

export async function criarContatoAction(
  dados: {
    nome: string;
    telefone: string;
    email?: string;
  } & DadosCadastrais
): Promise<ResultadoAcao> {
  try {
    const autor = await usuarioAtual();
    await criarContato(semDocumentoSeNaoPodeVer(dados, autor), autor.id);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao salvar o contato. Tente novamente.");
  }
  revalidatePath("/contatos");
  return { ok: true };
}

export async function atualizarContatoAction(
  dados: {
    id: string;
    nome: string;
    telefone: string;
    email?: string;
  } & DadosCadastrais
): Promise<ResultadoAcao> {
  try {
    const autor = await usuarioAtual();
    await atualizarContato(semDocumentoSeNaoPodeVer(dados, autor), autor.id);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao salvar o contato. Tente novamente.");
  }
  revalidatePath(`/contatos/${dados.id}`);
  revalidatePath("/contatos");
  return { ok: true };
}
