import { prisma } from "@/lib/prisma";
import { encontrarOuCriarContact } from "./dedupe";
import { registrarAuditoria } from "@/core/audit/log";
import { notificarNovoLead } from "@/core/notifications/dispatch";
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
 *
 * `responsavelId` chega, em produção, de `criarLeadManual` (`actions.ts`) —
 * ou o autor logado, ou (quando quem chama tem permissão) um id escolhido no
 * formulário público, ou seja, um cliente HTTP não confiável, igual
 * `novaStageId` em `moverEtapa` abaixo e `leadId` em `criarTask`
 * (`tasks/service.ts`). `Lead.responsavelId` é uma FK opcional para `User`,
 * então um id que não corresponde a nenhum usuário faria o
 * `prisma.lead.create` abaixo estourar uma violação de constraint (`P2003`)
 * crua do Postgres em vez de um erro de domínio legível — mesma razão da
 * checagem explícita em `moverEtapa`.
 */
export async function criarLead(input: {
  nome: string;
  telefone: string;
  email?: string;
  responsavelId: string;
  autorId: string;
}): Promise<Lead> {
  const responsavel = await prisma.user.findUnique({ where: { id: input.responsavelId } });
  if (!responsavel) {
    throw new Error(
      `Responsável não encontrado: "${input.responsavelId}" não corresponde a nenhum usuário.`
    );
  }

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

  // Notificação vem por último, de propósito: o lead e a auditoria já estão
  // persistidos quando ela roda. `try/catch` aqui (não dentro de
  // `notificarNovoLead`) é a barreira que garante a regra da spec seção 6
  // ("falha de módulo secundário nunca derruba o principal") para o módulo
  // de notificação INTEIRO, não só para o e-mail — `notificarNovoLead`
  // (`notifications/dispatch.ts`) já isola a falha de e-mail (Resend fora do
  // ar, ou sem `RESEND_API_KEY` configurada — o caso real deste projeto) com
  // seu próprio try/catch interno, mas deixa propagar um erro na gravação da
  // própria notificação in-app (ex.: banco fora do ar naquele instante) —
  // que é exatamente o tipo de falha que não pode, por si só, fazer
  // `criarLead` lançar depois que o lead já foi criado com sucesso. Um lead
  // criado sem notificação é uma degradação aceitável; um lead que "falhou
  // ao criar" só porque a notificação não gravou seria pior — e mais
  // confuso, porque o registro já estaria no banco apesar do erro.
  try {
    await notificarNovoLead(lead.id);
  } catch (erro) {
    console.error("Falha ao notificar novo lead (lead já criado, prosseguindo):", erro);
  }

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

/**
 * Cria um lead com `canal: "WHATSAPP"`, a partir de um telefone JÁ
 * NORMALIZADO (formato de `encontrarOuCriarContact`/`normalizarTelefone` —
 * quem chama é responsável por essa normalização; ver
 * `src/modules/whatsapp/telefone.ts` para a versão não-lançadora usada pelo
 * atendente de IA).
 *
 * PLUMBING sem chamador ainda nesta fatia (Fatia 1 do atendente de
 * WhatsApp): a inbox desta fatia é só leitura (`(painel)/conversas`), e
 * nenhuma tela ainda oferece "criar lead a partir desta conversa". Existe
 * agora porque a Fatia 2 do plano ("o humano assume") precisa dela — e
 * porque a regra de negócio real que vai acompanhá-la ("adotar" um lead de
 * WhatsApp já aberto para aquele telefone em vez de criar um segundo,
 * senão clique e mensagem contam o mesmo cliente duas vezes) é decisão de
 * produto que ainda não foi tomada; implementá-la especulativamente aqui,
 * sem um chamador real pra validar contra o fluxo de verdade da tela, seria
 * a receita para acertar a interface e errar a regra.
 *
 * Deliberadamente NÃO reusa `criarLead` (acima): aquela função é a camada
 * testável de `criarLeadManual` (`actions.ts`), com um contrato (`canal`
 * sempre "MANUAL") que várias telas e testes já assumem — bifurcar esse
 * contrato com um parâmetro `canal` opcional trocaria o comportamento de
 * uma função em produção por causa de uma função sem uso ainda. Duplicar a
 * poucas linhas de lógica (busca de responsável, contato, primeira etapa,
 * auditoria) é o preço aceito por manter as duas independentes.
 */
export async function criarLeadDeWhatsapp(input: {
  nome: string;
  telefone: string;
  responsavelId: string;
  autorId: string;
}): Promise<Lead> {
  const responsavel = await prisma.user.findUnique({ where: { id: input.responsavelId } });
  if (!responsavel) {
    throw new Error(
      `Responsável não encontrado: "${input.responsavelId}" não corresponde a nenhum usuário.`
    );
  }

  const contact = await encontrarOuCriarContact({ nome: input.nome, telefone: input.telefone });

  const primeiraEtapa = await prisma.pipelineStage.findFirstOrThrow({ orderBy: { ordem: "asc" } });

  const lead = await prisma.lead.create({
    data: {
      contactId: contact.id,
      stageId: primeiraEtapa.id,
      responsavelId: input.responsavelId,
      canal: "WHATSAPP",
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
