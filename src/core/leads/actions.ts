"use server";

import { usuarioAtual } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";
import { criarLead, moverEtapa } from "./service";
import type { Lead } from "@prisma/client";

/**
 * Cria um lead manualmente. Server Action — endpoint HTTP público (ver
 * decisão de segurança da Task 13): `autorId` NUNCA vem do cliente, é
 * sempre derivado da sessão via `usuarioAtual()`. `responsavelId` continua
 * vindo do formulário (é escolha legítima do gestor), mas só é honrado
 * quando quem chama tem permissão para atribuir lead a outra pessoa —
 * senão o lead fica com o próprio autor, silenciosamente corrigido, em vez
 * de a action confiar cegamente no que o cliente mandou.
 */
export async function criarLeadManual(input: {
  nome: string;
  telefone: string;
  email?: string;
  responsavelId: string;
}): Promise<Lead> {
  const autor = await usuarioAtual();

  if (!hasPermission(autor.papel, "criar_lead")) {
    throw new Error("Sem permissão para criar lead");
  }

  // Só ADMIN e GESTOR atribuem lead a outra pessoa; VENDEDOR fica com o próprio.
  const responsavelId =
    input.responsavelId !== autor.id && !hasPermission(autor.papel, "ver_dashboard_geral")
      ? autor.id
      : input.responsavelId;

  try {
    return await criarLead({
      nome: input.nome,
      telefone: input.telefone,
      email: input.email,
      responsavelId,
      autorId: autor.id,
    });
  } catch (erro) {
    // `criarLead` (via encontrarOuCriarContact, Task 12) lança quando
    // `telefone` não é um número brasileiro reconhecível — uma falha
    // ESPERADA de validação de formulário, não um bug. A mensagem já é
    // segura para exibir a quem preencheu o formulário (não vaza detalhe
    // de infraestrutura), então deixamos o texto passar, mas relançamos
    // como um Error isolado — não a exceção original, seja lá o que for —
    // para garantir que o que atravessa esta borda pública é sempre um
    // erro classificado e limpo, nunca algo cru de uma camada interna.
    // Qualquer OUTRO erro (banco fora do ar, etc.) segue sem modificação:
    // não é papel desta action disfarçar um bug de "erro esperado".
    if (erro instanceof Error && /^Telefone inválido/.test(erro.message)) {
      throw new Error(erro.message);
    }
    throw erro;
  }
}

/**
 * Move um lead para outra etapa do funil. Server Action — `autorId` sempre
 * derivado da sessão, nunca aceito do cliente.
 */
export async function moverLeadDeEtapa(input: {
  leadId: string;
  novaStageId: string;
}): Promise<Lead> {
  const autor = await usuarioAtual();

  if (!hasPermission(autor.papel, "mover_lead")) {
    throw new Error("Sem permissão para mover lead");
  }

  return moverEtapa({
    leadId: input.leadId,
    novaStageId: input.novaStageId,
    autorId: autor.id,
  });
}
