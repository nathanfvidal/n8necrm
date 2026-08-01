"use server";

import { usuarioAtual } from "@/core/auth/session";
import { criarTask, concluirTask } from "./service";
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
