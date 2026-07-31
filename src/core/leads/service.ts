import { prisma } from "@/lib/prisma";
import { encontrarOuCriarContact } from "./dedupe";
import { registrarAuditoria } from "@/core/audit/log";
import type { Lead } from "@prisma/client";

/**
 * Cria um lead a partir de entrada manual (formulário interno).
 *
 * `autorId` é explícito aqui de propósito: esta função é a camada testável
 * por Vitest sem precisar de sessão HTTP (ver decisão de segurança da
 * Task 13). Quem chama com um `autorId` forjado é responsabilidade de quem
 * chama — a barreira contra isso fica em `actions.ts`, que deriva `autorId`
 * de `usuarioAtual()` e nunca aceita esse campo do cliente.
 *
 * `encontrarOuCriarContact` (Task 12) normaliza `telefone` e LANÇA quando o
 * valor não é reconhecível como telefone brasileiro (DDD + 8/9 dígitos).
 * Deixamos essa exceção propagar como está: a mensagem já é redigida para
 * ser lida por quem preencheu o formulário ("Telefone inválido: ... "), não
 * vaza detalhe de infraestrutura, e nenhum Contact/Lead chega a ser
 * gravado — o `await` abaixo nunca chega ao `prisma.lead.create` nesse caso.
 * `actions.ts` decide o que fazer com ela na borda pública.
 */
export async function criarLead(input: {
  nome: string;
  telefone: string;
  email?: string;
  responsavelId: string;
  autorId: string;
}): Promise<Lead> {
  const contact = await encontrarOuCriarContact({
    nome: input.nome,
    telefone: input.telefone,
    email: input.email,
  });

  const primeiraEtapa = await prisma.pipelineStage.findFirstOrThrow({ orderBy: { ordem: "asc" } });

  const lead = await prisma.lead.create({
    data: {
      contactId: contact.id,
      stageId: primeiraEtapa.id,
      responsavelId: input.responsavelId,
      canal: "MANUAL",
    },
  });

  await registrarAuditoria({
    userId: input.autorId,
    acao: "criar_lead",
    entidade: "Lead",
    entidadeId: lead.id,
    depois: lead,
  });

  return lead;
}

/**
 * Move um lead para outra etapa do funil.
 *
 * `novaStageId` chega, em produção, de uma Server Action pública — ou seja,
 * de um cliente HTTP não confiável (drag-and-drop do kanban da Task 15, mas
 * tecnicamente qualquer POST). `Lead.stageId` é uma relação obrigatória com
 * FK, então um id que não corresponde a nenhuma `PipelineStage` FARIA o
 * `prisma.lead.update` abaixo estourar uma violação de constraint — mas só
 * na hora de escrever, como um erro cru do Postgres (`P2003`), sem mensagem
 * acionável para quem chamou. A checagem explícita abaixo existe para
 * recusar cedo, com um erro de domínio claro, antes de tocar o banco.
 */
export async function moverEtapa(input: {
  leadId: string;
  novaStageId: string;
  autorId: string;
}): Promise<Lead> {
  const antes = await prisma.lead.findUniqueOrThrow({ where: { id: input.leadId } });

  const novaEtapa = await prisma.pipelineStage.findUnique({ where: { id: input.novaStageId } });
  if (!novaEtapa) {
    throw new Error(
      `Etapa não encontrada: "${input.novaStageId}" não corresponde a nenhuma etapa do funil.`
    );
  }

  const depois = await prisma.lead.update({
    where: { id: input.leadId },
    data: { stageId: novaEtapa.id, ultimaInteracaoEm: new Date() },
  });

  await registrarAuditoria({
    userId: input.autorId,
    acao: "mover_etapa",
    entidade: "Lead",
    entidadeId: depois.id,
    antes: { stageId: antes.stageId },
    depois: { stageId: depois.stageId },
  });

  return depois;
}
