"use server";

import { revalidatePath } from "next/cache";

import { usuarioAtual } from "@/core/auth/session";
import { ehSessaoInvalida, MENSAGEM_SESSAO_INVALIDA, type ResultadoAcao } from "@/lib/acao";
import { criarTask, concluirTask, editarTask, excluirTask } from "./service";
import type { Task } from "@prisma/client";

/**
 * Cria uma tarefa do usuário logado. Server Action — endpoint HTTP público
 * (ver decisão de segurança da Task 13): `responsavelId` NUNCA vem do
 * cliente, é sempre derivado da sessão via `usuarioAtual()`. A Fase 1 não
 * tem "atribuir tarefa a outra pessoa" — isso é funcionalidade de fase
 * posterior, não um campo escondido do formulário que valeria a pena
 * clampar como `criarLeadManual` faz com `responsavelId` de lead (Task 13):
 * lá existe um papel (GESTOR/ADMIN) que legitimamente atribui lead a
 * outra pessoa; aqui não existe esse conceito ainda, então nem a
 * possibilidade é aberta.
 *
 * `leadId`, quando presente, é o mesmo dado público já exposto na URL
 * `/leads/[id]` (mesmo raciocínio de `adicionarNotaAction` para `leadId` de
 * nota, `leads/actions.ts`) — não é segredo, e `criarTask` (service.ts)
 * confere que ele corresponde a um lead real antes de gravar.
 */
export async function criarMinhaTask(input: {
  titulo: string;
  descricao?: string;
  vencimento: Date;
  leadId?: string;
}): Promise<Task> {
  const autor = await usuarioAtual();
  return criarTask({ ...input, responsavelId: autor.id });
}

/**
 * Conclui uma tarefa do usuário logado. Server Action — `autorId` sempre
 * derivado da sessão, nunca aceito do cliente. `concluirTask` (service.ts)
 * verifica dono; ver o comentário lá sobre por que essa checagem existe e
 * por que difere da decisão de leads (`moverEtapa`, que nunca checa dono).
 */
export async function concluirMinhaTask(taskId: string): Promise<Task> {
  const autor = await usuarioAtual();
  return concluirTask({ taskId, autorId: autor.id });
}

/**
 * Mensagens de domínio de tarefa, seguras de mostrar a quem preencheu o
 * formulário. "Tarefa não encontrada" é a mesma resposta para "não existe" e
 * "não é sua", de propósito — ver `concluirTask` (service.ts).
 */
const MENSAGENS_SEGURAS = [
  /^Tarefa não encontrada/,
  /^Título obrigatório/,
  /^Vencimento inválido/,
  /^Lead não encontrado:/,
];

function paraResultadoErro(erro: unknown, mensagemGenerica: string): { ok: false; erro: string } {
  if (erro instanceof Error && MENSAGENS_SEGURAS.some((padrao) => padrao.test(erro.message))) {
    return { ok: false, erro: erro.message };
  }
  if (ehSessaoInvalida(erro)) {
    console.error("Ação sobre tarefa negada — sessão expirada ou usuário desativado.", erro);
    return { ok: false, erro: MENSAGEM_SESSAO_INVALIDA };
  }
  console.error(mensagemGenerica, erro);
  return { ok: false, erro: mensagemGenerica };
}

/**
 * Corrige uma tarefa do usuário logado. `autorId` sempre da sessão — a regra
 * de dono mora em `editarTask` (service.ts), e sem isso o id do dono viria do
 * cliente, que é justamente o que a checagem existe para impedir.
 *
 * Devolve `ResultadoAcao` em vez de lançar, ao contrário das duas actions
 * acima: o Next redige erro não tratado em produção, e "Vencimento inválido"
 * e "banco fora do ar" chegariam à tela com a mesma mensagem opaca. Ver
 * `src/lib/acao.ts`.
 */
export async function editarTaskAction(dados: {
  taskId: string;
  titulo: string;
  descricao?: string;
  vencimento: Date;
  leadId?: string | null;
}): Promise<ResultadoAcao> {
  try {
    const autor = await usuarioAtual();
    await editarTask({ ...dados, autorId: autor.id });
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao salvar a tarefa. Tente novamente.");
  }
  revalidatePath("/tasks");
  revalidatePath("/");
  if (dados.leadId) {
    revalidatePath(`/leads/${dados.leadId}`);
  }
  return { ok: true };
}

export async function excluirTaskAction(dados: {
  taskId: string;
  leadId?: string | null;
}): Promise<ResultadoAcao> {
  try {
    const autor = await usuarioAtual();
    await excluirTask({ taskId: dados.taskId, autorId: autor.id });
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao excluir a tarefa. Tente novamente.");
  }
  revalidatePath("/tasks");
  revalidatePath("/");
  if (dados.leadId) {
    revalidatePath(`/leads/${dados.leadId}`);
  }
  return { ok: true };
}
