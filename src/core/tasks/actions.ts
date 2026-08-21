"use server";

import { revalidatePath } from "next/cache";

import { usuarioAtual } from "@/core/auth/session";
import { ehSessaoInvalida, MENSAGEM_SESSAO_INVALIDA, type ResultadoAcao } from "@/lib/acao";
import { criarTask, concluirTask, editarTask, excluirTask, reabrirTask } from "./service";

/**
 * Todas as cinco actions deste arquivo devolvem `ResultadoAcao`
 * (`src/lib/acao.ts`). Não lançam.
 *
 * ## A dívida que isto pagou
 *
 * Até aqui `criarMinhaTask` e `concluirMinhaTask` LANÇAVAM — eram anteriores a
 * `acao.ts` — enquanto editar, excluir e reabrir devolviam resultado. Duas
 * convenções no mesmo arquivo, com três consequências que só aparecem juntas:
 *
 * 1. **Mensagem redigida.** O Next redige erro não tratado de Server Action em
 *    produção. Nas duas que lançavam, "Vencimento inválido" e "banco fora do
 *    ar" chegavam à tela com a mesma mensagem opaca.
 * 2. **Texto diferente para o mesmo erro.** Uma tarefa que não é sua dizia
 *    "Essa tarefa não existe mais ou não pertence a você" ao concluir e
 *    "Tarefa não encontrada" ao excluir — o mesmo estado, duas frases,
 *    conforme o botão. As frases boas moravam no cliente, onde só serviam a um
 *    caminho; agora moram aqui e valem para os cinco.
 * 3. **Casamento de string no cliente.** `task-list.tsx` e `task-form.tsx`
 *    comparavam `erro.message` com texto do servidor para decidir o que
 *    mostrar. Renomear uma mensagem em `service.ts` quebraria isso em
 *    silêncio, sem erro de tipo e sem teste vermelho no ponto da mudança.
 *
 * ## O que exigia cuidado, e como foi tratado
 *
 * O rollback otimista de `useTaskList` (`task-list.tsx`) era dirigido pelo
 * `catch`: a tarefa some da lista antes da confirmação e volta se o servidor
 * recusar. Com a action devolvendo resultado, o `catch` deixaria de disparar e
 * a tarefa sumiria da tela sem ter sido concluída — regressão silenciosa, e a
 * pior possível para quem usa. Por isso o chamador trata os DOIS caminhos:
 * `!resultado.ok` e a exceção que sobra (falha de rede, `revalidatePath`
 * quebrando). Ver o comentário em `handleConcluir`.
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
export async function criarMinhaTaskAction(input: {
  titulo: string;
  descricao?: string;
  vencimento: Date;
  leadId?: string;
  contactId?: string | null;
}): Promise<ResultadoAcao> {
  try {
    const autor = await usuarioAtual();
    // `companyId` da SESSÃO, nunca de `input`: o objeto vem do formulário e
    // Server Action é endpoint HTTP público. Antes o serviço deduzia a empresa
    // de `companyIdDoUsuario(responsavelId)`, que pega um vínculo arbitrário de
    // quem tem dois; `usuarioAtual()` já sabe qual é a empresa desta sessão.
    await criarTask({ ...input, companyId: autor.companyId, responsavelId: autor.id });
  } catch (erro) {
    return paraResultadoErro(erro, "Não foi possível salvar a tarefa. Tente novamente em instantes.");
  }
  // `revalidatePath` não é estilo: sem ele, só a aba de quem agiu conserta
  // (via `router.refresh()` no formulário), e o cache de rota fica velho para
  // todo mundo — inclusive para a própria pessoa em outra aba, e para o
  // contador do painel. As actions de editar/excluir já faziam isto; criar e
  // concluir tinham ficado de fora.
  //
  // Fora do `try` de propósito: revalidar cache não é parte de "a tarefa foi
  // criada". Dentro, uma falha de revalidação viraria "não foi possível
  // salvar" para uma tarefa que ESTÁ no banco — a pessoa tentaria de novo e
  // criaria a segunda.
  revalidatePath("/tasks");
  revalidatePath("/");
  if (input.leadId) {
    revalidatePath(`/leads/${input.leadId}`);
  }
  return { ok: true };
}

/**
 * Conclui uma tarefa do usuário logado. Server Action — `autorId` sempre
 * derivado da sessão, nunca aceito do cliente. `concluirTask` (service.ts)
 * verifica dono; ver o comentário lá sobre por que essa checagem existe e
 * por que difere da decisão de leads (`moverEtapa`, que nunca checa dono).
 */
export async function concluirMinhaTaskAction(taskId: string): Promise<ResultadoAcao> {
  let leadIdParaRevalidar: string | null = null;
  try {
    const autor = await usuarioAtual();
    // A linha volta do serviço porque `leadId` é preciso para invalidar a
    // página do lead — mas NÃO atravessa a fronteira: o valor de retorno de
    // uma Server Action é serializado para o navegador, e devolver `Task`
    // mandava a linha inteira (`responsavelId`, `contactId`, `criadoEm`) para
    // um chamador que descarta o retorno. É a tarefa do próprio usuário, então
    // não vazava entre pessoas — mas é o mesmo padrão que produziu o
    // vazamento do funil, e a regra da casa passou a ser: só atravessa o que
    // a tela usa. `ResultadoAcao` continua honrando isso: `{ ok: true }` e
    // nada mais.
    const concluida = await concluirTask({ companyId: autor.companyId, taskId, autorId: autor.id });
    leadIdParaRevalidar = concluida.leadId;
  } catch (erro) {
    return paraResultadoErro(erro, "Não foi possível concluir a tarefa. Tente novamente em instantes.");
  }
  revalidatePath("/tasks");
  revalidatePath("/");
  if (leadIdParaRevalidar) {
    revalidatePath(`/leads/${leadIdParaRevalidar}`);
  }
  return { ok: true };
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

/**
 * Mensagens de domínio que ganham uma frase melhor antes de ir para a tela.
 *
 * Estas três frases existiam, palavra por palavra, dentro de `task-list.tsx` e
 * `task-form.tsx` — os dois componentes comparavam `erro.message` com o texto
 * do servidor para escolher o que mostrar. Ficavam presas ao caminho que
 * lançava: quem clicasse "Excluir" na mesma tarefa inexistente lia o "Tarefa
 * não encontrada" cru. Aqui elas valem para as cinco actions.
 *
 * "Tarefa não encontrada" é a mesma resposta para "não existe" e "não é sua",
 * de propósito (ver `concluirTask`, service.ts) — e a frase melhorada preserva
 * essa ambiguidade em vez de dedurar qual dos dois casos ocorreu.
 *
 * A ordem importa: esta lista é consultada ANTES de `MENSAGENS_SEGURAS`, senão
 * o repasse cru venceria.
 */
const MENSAGENS_MELHORADAS: [RegExp, string][] = [
  [
    /^Tarefa não encontrada/,
    "Essa tarefa não existe mais ou não pertence a você. Atualize a página.",
  ],
  [/^Lead não encontrado/, "Esse lead não existe mais. Atualize a página."],
  [/^Contato não encontrado/, "Esse contato não existe mais. Atualize a página."],
];

function paraResultadoErro(erro: unknown, mensagemGenerica: string): { ok: false; erro: string } {
  if (erro instanceof Error) {
    const melhorada = MENSAGENS_MELHORADAS.find(([padrao]) => padrao.test(erro.message));
    if (melhorada) return { ok: false, erro: melhorada[1] };
  }
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
    await editarTask({ ...dados, companyId: autor.companyId, autorId: autor.id });
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
    await reabrirTask({ companyId: autor.companyId, taskId: dados.taskId, autorId: autor.id });
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
    await excluirTask({ companyId: autor.companyId, taskId: dados.taskId, autorId: autor.id });
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
