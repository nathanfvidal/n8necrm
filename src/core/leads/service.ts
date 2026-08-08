import { prisma } from "@/lib/prisma";
import { encontrarOuCriarContact } from "./dedupe";
import { registrarAuditoria } from "@/core/audit/log";
import { notificarNovoLead } from "@/core/notifications/dispatch";
import { parseValorBR } from "@/lib/dinheiro";
import type { Lead } from "@prisma/client";

/**
 * Erro de lead que é SEGURO mostrar a quem preencheu o formulário — mesmo
 * papel de `UsuarioInvalidoError` (`core/users/service.ts`).
 *
 * `paraResultadoErro` (`actions.ts`) usa esta classe para separar "recusa
 * esperada, com mensagem escrita para uma pessoa ler" de "erro inesperado,
 * que vira mensagem genérica e vai para o log". Sem essa separação, ou toda
 * falha vira texto genérico (e quem usa perde a informação que o faria agir
 * diferente), ou detalhe de infraestrutura vaza para a tela.
 */
export class LeadInvalidoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "LeadInvalidoError";
  }
}

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

  // Mesma regra de `atualizarLead`, e pelo mesmo motivo: a tela só oferece
  // usuários ativos, mas Server Action é endpoint HTTP público e aceita
  // qualquer id. Um lead nascer com dono que não consegue entrar no sistema é
  // um lead que ninguém atende.
  //
  // Aqui a recusa é incondicional, ao contrário de `atualizarLead` (que só
  // recusa quando o responsável MUDA): não existe lead preexistente a
  // preservar — este está nascendo agora.
  if (!responsavel.ativo) {
    throw new Error(
      `Responsável desativado: "${responsavel.nome}" não está mais ativo e não pode receber leads.`
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
 * Corrige valor, responsável e etapa de um lead.
 *
 * **Não reusa `moverEtapa`** (acima) de propósito. Esta função grava uma
 * auditoria `atualizar_lead`; o arraste do kanban continua gravando
 * `mover_etapa`. Saber se o negócio andou por arraste no funil ou por correção
 * no formulário é informação, não redundância.
 *
 * `valorEstimado` chega como TEXTO (o que o formulário mandou) e é convertido
 * aqui, não no chamador: assim todo caminho que grave valor passa pela mesma
 * validação estrita de `parseValorBR`. `null` limpa o campo.
 *
 * `responsavelId` e `stageId` vêm, em produção, de uma Server Action pública.
 * São conferidos antes de escrever pelo mesmo motivo de `moverEtapa`: sem
 * isso, um id inexistente vira violação de FK crua do Postgres (`P2003`) em
 * vez de erro legível para quem preencheu.
 *
 * A auditoria registra SÓ os campos que mudaram de fato, e não roda quando
 * nada mudou — uma linha "atualizou" sem diferença nenhuma é ruído que
 * dificulta ler o histórico.
 */
export async function atualizarLead(input: {
  leadId: string;
  valorEstimado: string | null;
  responsavelId: string;
  stageId: string;
  autorId: string;
}): Promise<Lead> {
  const valor = input.valorEstimado === null ? null : parseValorBR(input.valorEstimado);

  const antes = await prisma.lead.findUniqueOrThrow({ where: { id: input.leadId } });

  const responsavel = await prisma.user.findUnique({ where: { id: input.responsavelId } });
  if (!responsavel) {
    throw new Error(
      `Responsável não encontrado: "${input.responsavelId}" não corresponde a nenhum usuário.`
    );
  }

  // Achado da auditoria de segurança desta branch: a checagem acima confere
  // EXISTÊNCIA, não situação — dava para entregar um lead a quem foi
  // desativado e não consegue mais entrar no sistema. A tela só oferece
  // usuários ativos, mas Server Action é endpoint HTTP público e aceita
  // qualquer id.
  //
  // A recusa vale só quando o responsável MUDA, de propósito: um lead que já
  // pertence a alguém desativado (porque a pessoa saiu depois) precisa
  // continuar editável — inclusive para ser reatribuído a alguém ativo.
  // Recusar sempre trancaria justamente o lead que mais precisa de conserto.
  const responsavelMudou = antes.responsavelId !== input.responsavelId;
  if (responsavelMudou && !responsavel.ativo) {
    throw new Error(
      `Responsável desativado: "${responsavel.nome}" não está mais ativo e não pode receber leads.`
    );
  }

  const etapa = await prisma.pipelineStage.findUnique({ where: { id: input.stageId } });
  if (!etapa) {
    throw new Error(
      `Etapa não encontrada: "${input.stageId}" não corresponde a nenhuma etapa do funil.`
    );
  }

  const etapaMudou = antes.stageId !== input.stageId;

  const depois = await prisma.lead.update({
    where: { id: input.leadId },
    data: {
      valorEstimado: valor,
      responsavelId: input.responsavelId,
      stageId: input.stageId,
      ...(etapaMudou ? { ultimaInteracaoEm: new Date() } : {}),
    },
  });

  const mudancasAntes: Record<string, unknown> = {};
  const mudancasDepois: Record<string, unknown> = {};

  // `Decimal` não compara com `!==` (são objetos distintos com o mesmo
  // valor); `toString()` de ambos os lados é a comparação que funciona.
  const valorAntes = antes.valorEstimado?.toString() ?? null;
  const valorDepois = depois.valorEstimado?.toString() ?? null;
  if (valorAntes !== valorDepois) {
    mudancasAntes.valorEstimado = valorAntes;
    mudancasDepois.valorEstimado = valorDepois;
  }
  if (antes.responsavelId !== depois.responsavelId) {
    mudancasAntes.responsavelId = antes.responsavelId;
    mudancasDepois.responsavelId = depois.responsavelId;
  }
  if (etapaMudou) {
    mudancasAntes.stageId = antes.stageId;
    mudancasDepois.stageId = depois.stageId;
  }

  if (Object.keys(mudancasDepois).length > 0) {
    await registrarAuditoria({
      userId: input.autorId,
      acao: "atualizar_lead",
      entidade: "Lead",
      entidadeId: depois.id,
      antes: mudancasAntes,
      depois: mudancasDepois,
    });
  }

  return depois;
}

/**
 * Tira o lead do funil sem apagar nada. Duplicado, engano ou negócio que
 * nunca existiu deixa de poluir kanban, lista, painel e exportação — e
 * continua no histórico do contato, marcado.
 *
 * Recusa arquivar o que já está arquivado (e vice-versa) em vez de aceitar em
 * silêncio: sobrescrever `arquivadoEm` perderia a data original, que é o
 * único registro de QUANDO saiu do funil.
 */
export async function arquivarLead(input: { leadId: string; autorId: string }): Promise<Lead> {
  const antes = await prisma.lead.findUniqueOrThrow({ where: { id: input.leadId } });
  if (antes.arquivadoEm) {
    throw new Error("Este lead já está arquivado.");
  }

  const depois = await prisma.lead.update({
    where: { id: input.leadId },
    data: { arquivadoEm: new Date() },
  });

  await registrarAuditoria({
    userId: input.autorId,
    acao: "arquivar_lead",
    entidade: "Lead",
    entidadeId: depois.id,
    antes: { arquivadoEm: null },
    depois: { arquivadoEm: depois.arquivadoEm },
  });

  return depois;
}

/** Devolve o lead ao funil. Ver `arquivarLead`. */
export async function desarquivarLead(input: {
  leadId: string;
  autorId: string;
}): Promise<Lead> {
  const antes = await prisma.lead.findUniqueOrThrow({ where: { id: input.leadId } });
  if (!antes.arquivadoEm) {
    throw new Error("Este lead não está arquivado.");
  }

  const depois = await prisma.lead.update({
    where: { id: input.leadId },
    data: { arquivadoEm: null },
  });

  await registrarAuditoria({
    userId: input.autorId,
    acao: "desarquivar_lead",
    entidade: "Lead",
    entidadeId: depois.id,
    antes: { arquivadoEm: antes.arquivadoEm },
    depois: { arquivadoEm: null },
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
