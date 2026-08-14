"use server";

import { revalidatePath } from "next/cache";

import { usuarioAtual } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";
import { ehSessaoInvalida, MENSAGEM_SESSAO_INVALIDA, type ResultadoAcao } from "@/lib/acao";
import {
  arquivarLead,
  atualizarLead,
  criarLead,
  desarquivarLead,
  moverEtapa,
  LeadInvalidoError,
} from "./service";
import { adicionarNota, editarNota, excluirNota } from "./notes";
import type { Lead } from "@prisma/client";

/**
 * Cria um lead manualmente. Server Action — endpoint HTTP público (ver
 * decisão de segurança da Task 13): `autorId` NUNCA vem do cliente, é
 * sempre derivado da sessão via `usuarioAtual()`.
 *
 * `responsavelId` vem do formulário e é honrado para QUALQUER papel com
 * `criar_lead`.
 *
 * **Antes não era.** Esta action clampava `responsavelId` para o próprio
 * autor quando quem chamava não tinha `ver_dashboard_geral` — ou seja, um
 * VENDEDOR não conseguia cadastrar lead no nome de um colega. A auditoria de
 * segurança desta branch mostrou que a trava não travava nada: `atualizarLead`
 * aceita qualquer responsável para quem tem `mover_lead`, que os três papéis
 * têm, então bastava criar o lead para si e reatribuir no clique seguinte.
 * Dava trabalho sem impedir o resultado — e, pior, o clamp era SILENCIOSO: a
 * pessoa escolhia um colega e o sistema gravava outro sem avisar.
 *
 * Decisão do dono do projeto: lead é colaborativo, "os leads têm que ser
 * vistos por todos daquela empresa". Criar e editar passam a concordar.
 * Quem atribuiu fica registrado na auditoria dos dois lados.
 */
export async function criarLeadManualAction(input: {
  nome: string;
  telefone: string;
  email?: string;
  responsavelId: string;
}): Promise<ResultadoAcao> {
  try {
    const autor = await usuarioAtual();

    // DENTRO do `try`, junto com `usuarioAtual()`. Fora dele, uma sessão
    // expirada rejeitaria a promise sem produzir `ResultadoAcao` e a tela não
    // mostraria nem sucesso nem erro — o mesmo achado que `exigirEdicaoDeLead`
    // (abaixo) já documenta. Nesta action os dois estavam fora.
    if (!hasPermission(autor.papel, "criar_lead")) {
      throw new LeadInvalidoError(MENSAGEM_SEM_PERMISSAO_CRIAR);
    }

    await criarLead({
      nome: input.nome,
      telefone: input.telefone,
      email: input.email,
      responsavelId: input.responsavelId,
      autorId: autor.id,
    });
  } catch (erro) {
    return paraResultadoErro(erro, "Não foi possível criar o lead. Tente novamente em instantes.");
  }

    // `criarLead` (service.ts, Task 19) já grava uma notificação in-app para
    // `responsavelId` — mas o sino que a exibe (`NotificationBell`, dentro de
    // `PainelNav`) vive em `(painel)/layout.tsx`, um segmento COMPARTILHADO
    // entre rotas, não na página `/leads` em si. `LeadForm` (client) já
    // chama `router.refresh()` no sucesso, e isso é o bastante para a
    // TABELA de leads (a própria página) mostrar o novo registro — mas o
    // Router Cache do lado do cliente trata layouts compartilhados como
    // reutilizáveis entre navegações (ver
    // node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/staleTimes.md:
    // "shared layouts won't automatically be refetched on every
    // navigation"), então sem isto o sino só mostraria a contagem nova numa
    // navegação de página inteira, não no refresh do formulário — verificado
    // ao vivo contra o dev server antes deste fix.
    //
    // `revalidatePath("/(painel)", "layout")` — NÃO `revalidatePath("/",
    // "layout")` (fix round 1/5, achado do revisor: o comentário anterior
    // dizia "invalida o layout do painel inteiro", mas o código chamava
    // literalmente `revalidatePath("/", "layout")`, que a própria doc do
    // Next classifica à parte como "Revalidating all data" — ver
    // node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md,
    // seção "Revalidating all data": "purge[s] the Client Cache, and
    // invalidate[s] all cached data", app inteiro, não só este layout).
    // `revalidatePath` "opera na estrutura de arquivos da rota, não na URL
    // visível" (mesmo doc, "Using revalidatePath with rewrites") — passar o
    // caminho do ARQUIVO incluindo o route group (`/(painel)`, o mesmo
    // prefixo do diretório `src/app/(painel)/`) mira especificamente
    // `(painel)/layout.tsx`, não o `layout.tsx` raiz (`src/app/layout.tsx`,
    // ancestral de `/login` também) nem qualquer cache futuro fora do
    // painel. Verificado ao vivo: o sino ainda atualiza a contagem sem
    // reload de página inteira com este escopo mais estreito.
  revalidatePath("/(painel)", "layout");

  // `{ ok: true }`, e NUNCA o `Lead`. A versão anterior devolvia a linha
  // inteira — e o retorno de uma Server Action é serializado para o
  // navegador, então `utm` (JSON de rastreio), `sessionId` e `itemId` iam
  // junto, para um chamador (`LeadForm`) que descarta o retorno. Era o lead
  // que a própria pessoa acabou de criar, não o de um colega, então nunca foi
  // vazamento entre usuários; era o mesmo padrão que produziu o vazamento do
  // funil, e a regra da casa é: só atravessa o que a tela usa.
  return { ok: true };
}

/**
 * Move um lead para outra etapa do funil. Server Action — `autorId` sempre
 * derivado da sessão, nunca aceito do cliente.
 *
 * NÃO invalida caminho nenhum, e isso é uma lacuna conhecida, não uma
 * decisão: quem arrasta vê o quadro certo (atualização otimista em
 * `useKanbanBoard`), mas `/leads` e o painel continuam servindo cache antigo
 * até a próxima navegação completa. Fica registrado aqui em vez de corrigido
 * junto porque muda comportamento de cache, e esta entrega é sobre a
 * convenção de erro. A correção é uma linha:
 * `invalidarCaminhosDeLead(input.leadId)`.
 */
export async function moverLeadDeEtapaAction(input: {
  leadId: string;
  novaStageId: string;
}): Promise<ResultadoAcao> {
  try {
    const autor = await usuarioAtual();
    if (!hasPermission(autor.papel, "mover_lead")) {
      throw new LeadInvalidoError(MENSAGEM_SEM_PERMISSAO_MOVER);
    }
    await moverEtapa({
      leadId: input.leadId,
      novaStageId: input.novaStageId,
      autorId: autor.id,
    });
  } catch (erro) {
    return paraResultadoErro(erro, "Não foi possível mover o lead. Tente novamente em instantes.");
  }
  return { ok: true };
}

export type SalvarNotaState = { erro: string | null };

/**
 * Registra uma nota em um lead. Server Action — `autorId` sempre derivado
 * da sessão via `usuarioAtual()`, nunca aceito do cliente (mesma regra das
 * duas actions acima).
 *
 * Assinatura em três partes — `(leadId, prevState, formData)` — em vez do
 * `(input: {...})` usado pelas outras duas actions deste arquivo, porque
 * `LeadNoteForm` (Client Component, `src/components/leads/lead-note-form.tsx`)
 * precisa de `useActionState` para mostrar a mensagem de erro sem perder o
 * texto que a pessoa já digitou (fix round 1/5, achado do revisor: antes
 * disso, uma nota acima do limite de tamanho lançava sem tratamento dentro
 * de uma Server Action sem `useActionState` — e não existe `error.tsx` em
 * `src/app`, então a pessoa via a tela de erro genérica do Next em vez de
 * um aviso legível). `useActionState` exige essa forma; `leadId` chega
 * via `.bind(null, leadId)` no cliente (ver `LeadNoteForm`) — não é dado
 * sensível: já é público na URL `/leads/[id]`, e Task 17 não restringe
 * nota por dono do lead (mesma decisão de `moverEtapa`: qualquer vendedor
 * pode agir sobre qualquer lead).
 *
 * Texto vazio/só-espaço: silenciosamente ignorado (devolve `{ erro: null
 * }` sem chamar `adicionarNota`) — não é um erro que mereça mensagem, é só
 * "a pessoa clicou salvar sem digitar nada". `adicionarNota` rejeitaria de
 * qualquer forma (defesa em profundidade), mas o guard aqui evita chegar
 * lá no caminho comum.
 *
 * Texto longo demais: `adicionarNota` lança `Error("Nota muito longa: ...")`
 * quando o texto (já aparado) passa de `TEXTO_MAX_LENGTH`. O `<Textarea>`
 * tem `maxLength` como conveniência client-side, mas isso não é a barreira
 * real — um POST direto (fora do navegador, ou via devtools alterando o
 * DOM) chega aqui do mesmo jeito. Capturamos especificamente esse erro e
 * devolvemos como estado (`{ erro: mensagem }`) em vez de deixá-lo
 * atravessar sem tratamento; qualquer OUTRO erro (banco fora do ar etc.)
 * segue sem modificação, mesmo padrão de `criarLeadManual` acima.
 */
export async function adicionarNotaAction(
  leadId: string,
  _prevState: SalvarNotaState,
  formData: FormData
): Promise<SalvarNotaState> {
  const autor = await usuarioAtual();

  const texto = formData.get("texto");
  if (typeof texto !== "string" || !texto.trim()) {
    return { erro: null };
  }

  try {
    await adicionarNota({ leadId, autorId: autor.id, texto });
  } catch (erro) {
    if (erro instanceof Error && /^Nota muito longa/.test(erro.message)) {
      return { erro: erro.message };
    }
    throw erro;
  }

  // Sem isto, o App Router não re-renderiza a página atual depois de uma
  // Server Action que não chama `revalidatePath`/`redirect`/`cookies()`
  // (ver node_modules/next/dist/docs/01-app/02-guides/server-actions.md,
  // seção "A single response carries data and UI") — a nota ficaria
  // gravada no banco, mas a lista abaixo do formulário só mostraria ela
  // depois de um reload manual da página.
  revalidatePath(`/leads/${leadId}`);

  return { erro: null };
}

/* ------------------------------------------------------------------ *
 * Daqui para baixo mora o maquinário de erro que TODAS as actions deste
 * arquivo usam.
 *
 * `criarLeadManualAction` e `moverLeadDeEtapaAction` (acima) lançavam e
 * devolviam `Lead`; hoje devolvem `ResultadoAcao` como as outras. A única
 * assinatura diferente que sobrou é `adicionarNotaAction`, e ela é diferente
 * por um motivo de verdade: `useActionState` exige a forma
 * `(prevState, formData)`. Isso não é inconsistência, é outro contrato.
 * ------------------------------------------------------------------ */

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão para editar leads.";
const MENSAGEM_SEM_PERMISSAO_CRIAR = "Você não tem permissão para criar leads.";
const MENSAGEM_SEM_PERMISSAO_MOVER = "Você não tem permissão para mover leads.";

/**
 * Mensagens de domínio escritas para quem preencheu o formulário ler. São
 * seguras de exibir: nenhuma cita tabela, coluna, driver ou id interno além
 * do que a própria pessoa mandou.
 *
 * Reconhecer por prefixo é frágil — a mesma fragilidade que `ehSessaoInvalida`
 * documenta em `src/lib/acao.ts`. Fica concentrada aqui, num lugar só, em vez
 * de espalhada por sete actions.
 */
const MENSAGENS_SEGURAS = [
  /^Valor inválido:/,
  /^Responsável (não encontrado|desativado):/,
  /^Etapa não encontrada:/,
  /^Este lead (já está|não está) arquivado/,
  /^Nota (não encontrada|vazia|muito longa)/,
  // `criarLead` → `encontrarOuCriarContact` (`dedupe.ts`) rejeita telefone que
  // não é número brasileiro reconhecível. É falha ESPERADA de formulário, e a
  // mensagem já vem escrita para quem digitou. Antes desta entrega ela chegava
  // à tela por outro caminho: `criarLeadManual` a relançava e `lead-form.tsx`
  // a reconhecia por prefixo do lado do cliente. Sem esta linha, o mesmo texto
  // cairia no ramo genérico e a pessoa leria "não foi possível criar o lead"
  // sem saber que o problema é o telefone que ela consegue corrigir.
  /^Telefone inválido/,
];

/**
 * Mensagens de domínio que ganham uma frase melhor antes de ir para a tela —
 * mesmo mecanismo de `core/tasks/actions.ts`, e consultado ANTES de
 * `MENSAGENS_SEGURAS`, senão o repasse cru venceria.
 *
 * O critério é o que o texto INTERPOLA, não o texto em si. Quatro mensagens de
 * `service.ts`/`dedupe.ts` embutem um valor, e elas não são iguais:
 *
 * - `Etapa não encontrada: "<stageId>"` e `Responsável não encontrado:
 *   "<responsavelId>"` embutem **id interno**. A pessoa não pode fazer nada
 *   com um cuid, e ele não tem por que atravessar a fronteira. Vão para a
 *   lista abaixo.
 * - `Responsável desativado: "<nome>"` embute o **nome que a pessoa acabou de
 *   escolher no `<select>`**. Trocá-lo por uma frase genérica tiraria
 *   informação útil sem esconder nada — continua passando verbatim.
 * - `Telefone inválido: "<telefone>"` devolve **o que a própria pessoa
 *   digitou**. Mesmo caso: passa verbatim (React escapa o texto na
 *   renderização).
 */
const MENSAGENS_MELHORADAS: [RegExp, string][] = [
  [/^Etapa não encontrada/, "Essa etapa não existe mais. Atualize a página."],
  [/^Responsável não encontrado/, "Esse responsável não existe mais. Atualize a página."],
];

function paraResultadoErro(erro: unknown, mensagemGenerica: string): { ok: false; erro: string } {
  if (erro instanceof LeadInvalidoError) {
    return { ok: false, erro: erro.message };
  }
  if (erro instanceof Error) {
    const melhorada = MENSAGENS_MELHORADAS.find(([padrao]) => padrao.test(erro.message));
    if (melhorada) return { ok: false, erro: melhorada[1] };
  }
  if (erro instanceof Error && MENSAGENS_SEGURAS.some((padrao) => padrao.test(erro.message))) {
    return { ok: false, erro: erro.message };
  }
  if (ehSessaoInvalida(erro)) {
    console.error("Ação sobre lead negada — sessão expirada ou usuário desativado.", erro);
    return { ok: false, erro: MENSAGEM_SESSAO_INVALIDA };
  }
  console.error(mensagemGenerica, erro);
  return { ok: false, erro: mensagemGenerica };
}

/**
 * Reusa `mover_lead` em vez de criar permissão nova. Lead é colaborativo
 * neste CRM — qualquer vendedor move o lead de qualquer colega, decisão
 * documentada em `leads/queries.ts` — e editar valor, responsável ou etapa
 * segue a mesma natureza. Quem mexeu fica na auditoria.
 *
 * Hoje os três papéis têm `mover_lead`, então este portão não recusa ninguém
 * na prática. Existe mesmo assim porque a matriz pode ganhar um papel
 * só-leitura, e porque Server Action é endpoint HTTP público.
 *
 * Roda SEMPRE dentro do `try`: fora dele, uma sessão expirada rejeita a
 * promise sem produzir `ResultadoAcao`, e a tela não mostra nem sucesso nem
 * erro — achado real de revisão nas actions do WhatsApp.
 */
async function exigirEdicaoDeLead() {
  const usuario = await usuarioAtual();
  if (!hasPermission(usuario.papel, "mover_lead")) {
    throw new LeadInvalidoError(MENSAGEM_SEM_PERMISSAO);
  }
  return usuario;
}

/**
 * Invalidação explícita, caminho por caminho, em vez de
 * `revalidatePath("/", "layout")` — que a doc do Next classifica como
 * "revalidating all data" e esconderia o que de fato depende do quê.
 * `/` é o painel, que soma valores por etapa.
 */
function invalidarCaminhosDeLead(leadId: string, contactId?: string | null) {
  revalidatePath("/leads");
  revalidatePath("/leads/kanban");
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
  if (contactId) {
    revalidatePath(`/contatos/${contactId}`);
  }
}

export async function atualizarLeadAction(dados: {
  leadId: string;
  valorEstimado: string | null;
  responsavelId: string;
  stageId: string;
}): Promise<ResultadoAcao> {
  let lead: Lead;
  try {
    const autor = await exigirEdicaoDeLead();
    lead = await atualizarLead({ ...dados, autorId: autor.id });
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao salvar o lead. Tente novamente.");
  }
  invalidarCaminhosDeLead(dados.leadId, lead.contactId);
  return { ok: true };
}

export async function arquivarLeadAction(dados: { leadId: string }): Promise<ResultadoAcao> {
  let lead: Lead;
  try {
    const autor = await exigirEdicaoDeLead();
    lead = await arquivarLead({ leadId: dados.leadId, autorId: autor.id });
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao arquivar o lead. Tente novamente.");
  }
  invalidarCaminhosDeLead(dados.leadId, lead.contactId);
  return { ok: true };
}

export async function desarquivarLeadAction(dados: { leadId: string }): Promise<ResultadoAcao> {
  let lead: Lead;
  try {
    const autor = await exigirEdicaoDeLead();
    lead = await desarquivarLead({ leadId: dados.leadId, autorId: autor.id });
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao desarquivar o lead. Tente novamente.");
  }
  invalidarCaminhosDeLead(dados.leadId, lead.contactId);
  return { ok: true };
}

/**
 * Nota não passa pelo portão de permissão: a regra é de DONO e mora no
 * serviço (`editarNota`/`excluirNota`, `notes.ts`), que recusa quem não é o
 * autor com a mesma mensagem de "não existe". Um portão de papel aqui não
 * acrescentaria nada — todo papel pode escrever nota — e daria a impressão
 * falsa de que a autorização vive nesta camada.
 *
 * `leadId` vem do cliente só para invalidar o caminho certo; a autorização
 * não depende dele.
 */
export async function editarNotaAction(dados: {
  notaId: string;
  leadId: string;
  texto: string;
}): Promise<ResultadoAcao> {
  try {
    const autor = await usuarioAtual();
    await editarNota({ notaId: dados.notaId, texto: dados.texto, autorId: autor.id });
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao salvar a nota. Tente novamente.");
  }
  revalidatePath(`/leads/${dados.leadId}`);
  return { ok: true };
}

export async function excluirNotaAction(dados: {
  notaId: string;
  leadId: string;
}): Promise<ResultadoAcao> {
  try {
    const autor = await usuarioAtual();
    await excluirNota({ notaId: dados.notaId, autorId: autor.id });
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao excluir a nota. Tente novamente.");
  }
  revalidatePath(`/leads/${dados.leadId}`);
  return { ok: true };
}
