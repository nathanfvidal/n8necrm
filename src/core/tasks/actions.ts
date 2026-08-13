"use server";

import { revalidatePath } from "next/cache";

import { usuarioAtual } from "@/core/auth/session";
import { ehSessaoInvalida, MENSAGEM_SESSAO_INVALIDA, type ResultadoAcao } from "@/lib/acao";
import { criarTask, concluirTask, editarTask, excluirTask, reabrirTask } from "./service";

/**
 * ⚠️ Este arquivo tem DUAS convenções de erro, e isso é dívida declarada.
 *
 * `criarMinhaTask` e `concluirMinhaTask` LANÇAM; `editarTaskAction`,
 * `excluirTaskAction` e `reabrirTaskAction` devolvem `ResultadoAcao`
 * (`src/lib/acao.ts:50-56`). As que lançam vieram antes de `acao.ts` existir,
 * e o rollback otimista de `useTaskList` (`task-list.tsx`) é dirigido pelo
 * `catch` delas — trocar a convenção mexe no único lugar do sistema onde uma
 * regressão silenciosa significa "a tarefa sumiu da lista sem ter sido
 * concluída".
 *
 * Unificar é trabalho de branch própria, onde seja O assunto e o rollback
 * possa ser reprovado com atenção inteira. Fica registrado aqui porque
 * inconsistência declarada é dívida; inconsistência silenciosa é armadilha
 * para quem escrever a próxima action e copiar a vizinha errada.
 *
 * Regra para quem chegar agora: **action nova nasce devolvendo
 * `ResultadoAcao`**, como `reabrirTaskAction` faz.
 */

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
  contactId?: string | null;
}): Promise<void> {
  const autor = await usuarioAtual();
  await criarTask({ ...input, responsavelId: autor.id });
  // `revalidatePath` não é estilo: sem ele, só a aba de quem agiu conserta
  // (via `router.refresh()` no formulário), e o cache de rota fica velho para
  // todo mundo — inclusive para a própria pessoa em outra aba, e para o
  // contador do painel. As actions de editar/excluir já faziam isto; criar e
  // concluir tinham ficado de fora.
  revalidatePath("/tasks");
  revalidatePath("/");
  if (input.leadId) {
    revalidatePath(`/leads/${input.leadId}`);
  }
}

/**
 * Conclui uma tarefa do usuário logado. Server Action — `autorId` sempre
 * derivado da sessão, nunca aceito do cliente. `concluirTask` (service.ts)
 * verifica dono; ver o comentário lá sobre por que essa checagem existe e
 * por que difere da decisão de leads (`moverEtapa`, que nunca checa dono).
 */
export async function concluirMinhaTask(taskId: string): Promise<void> {
  const autor = await usuarioAtual();
  // A linha volta do serviço porque `leadId` é preciso para invalidar a
  // página do lead — mas NÃO atravessa a fronteira: o valor de retorno de uma
  // Server Action é serializado para o navegador, e devolver `Task` mandava a
  // linha inteira (`responsavelId`, `contactId`, `criadoEm`) para um chamador
  // que descarta o retorno. É a tarefa do próprio usuário, então não vazava
  // entre pessoas — mas é o mesmo padrão que produziu o vazamento do funil, e
  // a regra da casa passou a ser: só atravessa o que a tela usa.
  const concluida = await concluirTask({ taskId, autorId: autor.id });
  revalidatePath("/tasks");
  revalidatePath("/");
  if (concluida.leadId) {
    revalidatePath(`/leads/${concluida.leadId}`);
  }
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
  // Vindas de `schema.ts` e de `exigirContatoExistente` (service.ts). Sem
  // entrar nesta lista, "Descrição longa demais" cairia no ramo genérico e a
  // pessoa leria "Falha ao salvar a tarefa" — a validação gravaria o dado
  // certo e ainda assim esconderia o motivo, que é metade do defeito.
  /^Descrição /,
  /^Contato /,
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
  contactId?: string | null;
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

/**
 * Desfaz a conclusão de uma tarefa do usuário logado. `autorId` sempre da
 * sessão — a regra de dono mora em `reabrirTask` (service.ts).
 *
 * Nasce devolvendo `ResultadoAcao`, e não lançando: ver o aviso das duas
 * convenções no topo deste arquivo.
 */
export async function reabrirTaskAction(dados: {
  taskId: string;
  leadId?: string | null;
}): Promise<ResultadoAcao> {
  try {
    const autor = await usuarioAtual();
    await reabrirTask({ taskId: dados.taskId, autorId: autor.id });
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao reabrir a tarefa. Tente novamente.");
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
