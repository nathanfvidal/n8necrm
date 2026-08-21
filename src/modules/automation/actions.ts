"use server";

import { revalidatePath } from "next/cache";

import { registrarAuditoria } from "@/core/audit/log";
import { hasPermission } from "@/core/auth/permissions";
import { usuarioAtual } from "@/core/auth/session";
import { ehSessaoInvalida, MENSAGEM_SESSAO_INVALIDA, type ResultadoAcao } from "@/lib/acao";
import { clienteN8n, ErroN8n } from "@/modules/automation/n8n";

/**
 * Mora em `src/modules/automation/`, não em `src/core/`: automação é módulo
 * opcional, ligado por `config/client.ts`. A regra de ESLint
 * (`no-restricted-imports` em `src/core/**`) faz essa fronteira valer — o
 * import de `@/core/*` daqui é a direção permitida, nunca o contrário.
 *
 * `usuarioAtual()` é a única fonte de "quem está agindo". Server Action é
 * endpoint HTTP público: um id vindo do formulário seria forjável.
 */

const ENTIDADE = "N8nWorkflow";

/**
 * Traduz o erro para algo que dá para mostrar, sem vazar chave nem detalhe
 * interno pro CLIENTE — mas loga tudo no SERVIDOR, mesmo padrão dos irmãos
 * (`whatsapp/actions.ts:79,82`, `leads/actions.ts:309,312`,
 * `pipeline/actions.ts:39,42`, `contacts/actions.ts:70,73`,
 * `tasks/actions.ts:174,177`, `users/actions.ts:40,43`).
 *
 * Até a revisão da Task 3 do Ciclo 4 esta função era a única exceção: só o
 * ramo de erro inesperado logava. Consequência concreta — um ADMIN tentando
 * desativar um fluxo travado durante um incidente esbarrava em "instância
 * fora do ar" e não sobrava rastro nenhum no servidor pra quem investigasse
 * depois.
 *
 * `erro.message` de `ErroN8n` pode conter URL, status HTTP e até 300
 * caracteres do corpo cru da resposta (`n8n/cliente.ts`) — aceitável em log
 * de servidor, é o que torna o log útil. A chave de API nunca aparece: ela
 * só vai em header de requisição (`X-N8N-API-KEY`), nunca é ecoada pelo n8n
 * na resposta nem composta em nenhuma mensagem de erro deste módulo.
 */
function mensagemDeErro(erro: unknown): string {
  if (ehSessaoInvalida(erro)) {
    console.error("Ação de automação negada — sessão expirada ou usuário desativado.", erro);
    return MENSAGEM_SESSAO_INVALIDA;
  }
  if (erro instanceof ErroN8n) {
    console.error("Falha na integração com o n8n:", erro);
    switch (erro.tipo) {
      case "inalcancavel":
        return "Não foi possível falar com o n8n. A instância pode estar fora do ar.";
      case "nao_autorizado":
        // Cita o NOME da variável (`N8N_API_KEY`), nunca o valor — deliberado,
        // não achado de revisão a corrigir. É o que torna o erro acionável em
        // vez de decorativo: sem o nome, quem investiga precisa adivinhar qual
        // variável de ambiente checar.
        //
        // Quem alcança esta mensagem: ADMIN e GESTOR. Toda chamada ao n8n
        // passa por uma das duas permissões — `gerenciar_fluxos` (ADMIN, em
        // `operar`) ou `ver_fluxos` (ADMIN e GESTOR, no reexecutar) — e as
        // duas podem esbarrar num 401 da instância. Este comentário já disse
        // "só ADMIN"; deixou de ser verdade quando `ver_fluxos` foi criada,
        // e a revisão pegou. Nome de variável de ambiente é aceitável para os
        // dois papéis; o VALOR continua não saindo daqui para ninguém.
        return "O n8n recusou a chave de API do CRM. Verifique N8N_API_KEY.";
      case "nao_encontrado":
        return "Esse fluxo não existe mais no n8n. Recarregue a lista.";
      default:
        return "O n8n recusou a operação. Veja os logs da instância.";
    }
  }
  console.error("Erro inesperado numa action de automação:", erro);
  return "Não foi possível concluir a operação.";
}

/**
 * Guarda comum das operações destrutivas.
 *
 * A ordem importa e é deliberada: **permissão, ESTADO REAL, n8n, depois
 * auditoria.** Auditar antes de o n8n confirmar produziria linha de
 * auditoria para operação que não aconteceu — pior que não auditar, porque
 * parece verdade.
 *
 * `executar` não só dispara a chamada ao n8n: é ele quem lê o estado real do
 * workflow (`clienteN8n.buscarWorkflow`) e devolve o `antes`/`depois` já
 * prontos para o `AuditLog`. Até a revisão final do Ciclo 4, `antes`/`depois`
 * vinham do PARÂMETRO que quem chamou a Server Action passou — dois
 * problemas concretos, achado I1 da revisão: (1) ativar um fluxo que JÁ
 * estava ativo gravava `antes: { ativo: false }` mesmo sem a transição ter
 * acontecido; (2) Server Action é endpoint HTTP público — quem chama escolhe
 * o `nome`, e essa é a ÚNICA linha do sistema que registra que aquele
 * workflow existiu. Ler antes de agir resolve os dois, no mesmo padrão que
 * todo irmão deste módulo já segue: `editarEtapa` em `core/pipeline/service.ts` (`antes:
 * { nome: atual.nome, cor: atual.cor }`), `core/users/service.ts:306`
 * (`antes: { ativo: antes.ativo }`), `core/leads/notes.ts:150` (`antes: {
 * texto: nota.texto }`).
 *
 * Se a leitura falhar, a ação inteira é abortada — o erro sobe até o `catch`
 * abaixo e vira mensagem legível, e NENHUMA chamada destrutiva chega a
 * disparar. Decisão deliberada: para uma operação que liga, desliga ou
 * apaga o atendimento de um cliente, falhar sem agir é mais seguro do que
 * agir sobre um `nome`/estado que só o parâmetro (potencialmente forjado)
 * garante.
 */
async function operar(
  acao: string,
  entidadeId: string,
  executar: () => Promise<{ antes?: unknown; depois?: unknown }>
): Promise<ResultadoAcao> {
  try {
    const usuario = await usuarioAtual();
    if (!hasPermission(usuario.papel, "gerenciar_fluxos")) {
      return { ok: false, erro: "Você não tem permissão para gerenciar fluxos." };
    }

    const registro = await executar();

    await registrarAuditoria({
      // O workflow do n8n não é entidade deste schema e não tem `companyId`
      // próprio — a empresa aqui é a da SESSÃO que operou o fluxo, que é
      // exatamente o recorte que o audit log precisa responder ("quem, desta
      // empresa, mexeu na automação"). Ver `ParamsDeAuditoria.companyId`.
      companyId: usuario.companyId,
      userId: usuario.id,
      acao,
      entidade: ENTIDADE,
      entidadeId,
      antes: registro.antes,
      depois: registro.depois,
    });

    revalidatePath("/(painel)", "layout");
    return { ok: true };
  } catch (erro) {
    return { ok: false, erro: mensagemDeErro(erro) };
  }
}

export async function ativarFluxoAction(id: string): Promise<ResultadoAcao> {
  return operar("ativar_fluxo", id, async () => {
    const atual = await clienteN8n.buscarWorkflow(id);
    await clienteN8n.ativarWorkflow(id);
    return { antes: { nome: atual.nome, ativo: atual.ativo }, depois: { nome: atual.nome, ativo: true } };
  });
}

export async function desativarFluxoAction(id: string): Promise<ResultadoAcao> {
  return operar("desativar_fluxo", id, async () => {
    const atual = await clienteN8n.buscarWorkflow(id);
    await clienteN8n.desativarWorkflow(id);
    return { antes: { nome: atual.nome, ativo: atual.ativo }, depois: { nome: atual.nome, ativo: false } };
  });
}

/**
 * `antes: { nome }` sem `depois` — o workflow deixou de existir.
 *
 * A leitura acontece ANTES do DELETE, e não depois, porque depois não há de
 * onde reconstituir nada: o id sozinho não conta a história de "quem apagou
 * o fluxo de qual cliente" — `nome` lido aqui é a ÚNICA linha do sistema que
 * registra que aquele workflow existiu. Mesmo raciocínio de `excluirEtapa`
 * em `core/pipeline/service.ts`.
 *
 * Se a leitura falhar (instância fora do ar, chave recusada, workflow já
 * sumiu), a ação é abortada — mesma decisão de `ativarFluxoAction`/
 * `desativarFluxoAction` (ver comentário de `operar()` acima). Não segue com
 * um `nome` vindo de parâmetro só porque "é melhor que nada": para uma
 * operação IRREVERSÍVEL, gravar `antes: { nome }` sem confirmar que aquele
 * nome é real é pior do que simplesmente falhar e deixar quem chamou tentar
 * de novo — e se a leitura falhou por a instância estar fora do ar, o DELETE
 * seguinte falharia de qualquer forma pelo mesmo motivo.
 */
export async function apagarFluxoAction(id: string): Promise<ResultadoAcao> {
  return operar("apagar_fluxo", id, async () => {
    const atual = await clienteN8n.buscarWorkflow(id);
    await clienteN8n.apagarWorkflow(id);
    return { antes: { nome: atual.nome } };
  });
}

/**
 * Reexecutar exige `ver_fluxos`, não `gerenciar_fluxos`.
 *
 * Até a revisão da Task 3 do Ciclo 4, esta função só checava sessão válida,
 * apoiada num comentário que dizia "quem pode ver a execução já pode ver o
 * que ela fez" — mas essa permissão de visualização não existia em lugar
 * nenhum da matriz (`src/core/auth/permissions.ts` só tinha
 * `gerenciar_fluxos`, exclusiva de ADMIN). Como Server Action é endpoint
 * HTTP público, isso deixava qualquer VENDEDOR com sessão válida disparar
 * `POST /executions/{id}/retry` com ids arbitrários contra a instância de
 * produção de um cliente.
 *
 * `ver_fluxos` (ADMIN e GESTOR) fecha esse buraco sem prender a operação a
 * ADMIN: é diagnóstico, não destruição — reexecuta um caso que já
 * aconteceu, contra a versão atual do fluxo. Exigir `gerenciar_fluxos` aqui
 * tiraria de GESTOR a única ferramenta de "isso ainda quebra?" sem ganhar
 * segurança nenhuma em troca.
 *
 * Continua auditado, porque dispara trabalho real na instância do cliente.
 */
export async function reexecutarExecucaoAction(
  execucaoId: string,
  workflowId: string
): Promise<ResultadoAcao> {
  try {
    const usuario = await usuarioAtual();
    if (!hasPermission(usuario.papel, "ver_fluxos")) {
      return { ok: false, erro: "Você não tem permissão para ver fluxos." };
    }

    await clienteN8n.reexecutarExecucao(execucaoId);

    await registrarAuditoria({
      companyId: usuario.companyId,
      userId: usuario.id,
      acao: "reexecutar_execucao",
      entidade: "N8nExecucao",
      entidadeId: execucaoId,
      depois: { workflowId },
    });

    revalidatePath("/(painel)", "layout");
    return { ok: true };
  } catch (erro) {
    return { ok: false, erro: mensagemDeErro(erro) };
  }
}
