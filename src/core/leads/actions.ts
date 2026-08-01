"use server";

import { revalidatePath } from "next/cache";

import { usuarioAtual } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";
import { criarLead, moverEtapa } from "./service";
import { adicionarNota } from "./notes";
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
