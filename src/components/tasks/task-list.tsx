"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { concluirMinhaTask, editarTaskAction, excluirTaskAction } from "@/core/tasks/actions";
import { EmptyState } from "@/components/empty-state";
import { formatarDataCivilBR, parseDataCivil } from "@/lib/date";

export type TaskLinha = {
  id: string;
  titulo: string;
  vencimento: Date;
  descricao?: string | null;
  leadId?: string | null;
  leadContatoNome?: string;
  // Presentes só quando a lista pode conter tarefa de outra pessoa (seção
  // "Tarefas" de `/leads/[id]`, fix round 1/5 — ver `listarTasksPendentesDoLead`,
  // queries.ts) — `/tasks` nunca preenche estes dois campos, porque toda
  // tarefa ali já é do próprio usuário (mostrar "sua" em toda linha seria
  // ruído). Quando `souResponsavel` é `false`, a lista mostra
  // `responsavelNome` no lugar do botão "Concluir" — nunca os dois ao
  // mesmo tempo, e nunca um botão que a pessoa não pode usar.
  responsavelNome?: string;
  souResponsavel?: boolean;
};

/**
 * Traduz o que `concluirMinhaTask` pode lançar numa mensagem segura — mesmo
 * padrão de `mensagemDeErroMover` em `kanban-board.tsx` (Task 15). O caso
 * central aqui é "Tarefa não encontrada" (`concluirTask`, service.ts: id
 * inexistente OU tarefa de outro usuário) — ver o comentário lá sobre por
 * que as duas situações têm a MESMA mensagem, de propósito.
 */
function mensagemDeErroConcluir(erro: unknown): string {
  if (erro instanceof Error) {
    if (erro.message === "Tarefa não encontrada") {
      return "Essa tarefa não existe mais ou não pertence a você. Atualize a página.";
    }
    if (erro.message === "Não autenticado") {
      return "Sua sessão expirou ou sua conta foi desativada. Atualize a página e faça login novamente.";
    }
  }
  return "Não foi possível concluir a tarefa. Tente novamente em instantes.";
}

function porVencimentoAsc(a: TaskLinha, b: TaskLinha): number {
  return a.vencimento.getTime() - b.vencimento.getTime();
}

/**
 * Estado e lógica de conclusão isolados da árvore de componentes, de
 * propósito — mesmo raciocínio de `useKanbanBoard` (`kanban-board.tsx`,
 * Task 15): dá para testar a ramificação (remoção otimista, rollback,
 * mensagem por tipo de falha) sem precisar simular clique real em cada
 * teste.
 */
export function useTaskList(tasksIniciais: TaskLinha[]) {
  const [tasks, setTasks] = useState(tasksIniciais);
  const [erro, setErro] = useState<string | null>(null);

  async function handleConcluir(id: string) {
    setErro(null);
    const tarefa = tasks.find((t) => t.id === id);
    if (!tarefa) return;

    // Atualização otimista: some da lista de pendentes antes da
    // confirmação do servidor — "Concluir" precisa parecer instantâneo.
    setTasks((atual) => atual.filter((t) => t.id !== id));

    try {
      await concluirMinhaTask(id);
    } catch (erroCapturado) {
      // Reinsere a tarefa (rollback) se o servidor rejeitou — ex.: o id não
      // pertence a quem clicou (checagem de dono, `concluirTask`), ou a
      // sessão expirou entre o clique e a resposta.
      setTasks((atual) => [...atual, tarefa].sort(porVencimentoAsc));
      setErro(mensagemDeErroConcluir(erroCapturado));
    }
  }

  return { tasks, erro, handleConcluir, limparErro: () => setErro(null) };
}

/**
 * Lista de tarefas pendentes com ação de concluir. Reusada em duas telas:
 * `/tasks` (sempre tarefas do próprio usuário, com `leadContatoNome` quando
 * vinculadas a um lead — `responsavelNome`/`souResponsavel` nunca vêm
 * preenchidos ali, seria ruído mostrar "Você" em toda linha) e a seção
 * "Tarefas" de `/leads/[id]` (tarefas de QUALQUER responsável ligadas
 * àquele lead — fix round 1/5, ver `listarTasksPendentesDoLead`, queries.ts
 * — com `responsavelNome`/`souResponsavel` preenchidos e `leadContatoNome`
 * de fora, seria redundante mostrar o nome do próprio lead na página dele).
 *
 * `souResponsavel === false` esconde o botão "Concluir" e mostra o nome do
 * responsável no lugar — de propósito, não um botão desabilitado nem um
 * botão que renderiza igual e falha com "Tarefa não encontrada" ao clicar
 * (a checagem de dono em `concluirTask`, service.ts, é a barreira real;
 * aqui é só a UI não prometer uma ação que vai falhar). `souResponsavel`
 * `undefined` (caso de `/tasks`) é tratado como "pode concluir" — toda
 * tarefa ali já é do próprio usuário, por construção de `TasksPage`.
 */
export function TaskList({ tasks: tasksIniciais }: { tasks: TaskLinha[] }) {
  const router = useRouter();
  const { tasks, erro, handleConcluir, limparErro } = useTaskList(tasksIniciais);

  // Edição em linha no padrão de `user-table.tsx`: um estado com o id da
  // linha em edição, e só ela troca de forma.
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState({ titulo: "", descricao: "", vencimento: "" });
  const [erroEdicao, setErroEdicao] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function concluirEAtualizar(id: string) {
    await handleConcluir(id);
    router.refresh();
  }

  function comecarEdicao(task: TaskLinha) {
    setErroEdicao(null);
    setEditando(task.id);
    setRascunho({
      titulo: task.titulo,
      descricao: task.descricao ?? "",
      // `vencimento` está ancorado em meia-noite UTC (ver `parseDataCivil`,
      // `src/lib/date.ts`), então os componentes UTC são o dia que a pessoa
      // digitou. Usar o fuso local aqui devolveria o dia anterior.
      vencimento: task.vencimento.toISOString().slice(0, 10),
    });
  }

  async function salvarEdicao(task: TaskLinha) {
    setErroEdicao(null);

    let vencimento: Date;
    try {
      vencimento = parseDataCivil(rascunho.vencimento);
    } catch (erroData) {
      setErroEdicao(erroData instanceof Error ? erroData.message : "Data inválida.");
      return;
    }

    setSalvando(true);
    const resultado = await editarTaskAction({
      taskId: task.id,
      titulo: rascunho.titulo,
      descricao: rascunho.descricao,
      vencimento,
      // `undefined` mantém o vínculo como está — esta tela não oferece
      // trocar o lead de uma tarefa, então nunca manda `null`.
      leadId: undefined,
    });
    setSalvando(false);

    if (!resultado.ok) {
      setErroEdicao(resultado.erro);
      return;
    }
    setEditando(null);
    router.refresh();
  }

  async function excluir(task: TaskLinha) {
    if (!window.confirm("Excluir esta tarefa? Isso não pode ser desfeito.")) return;

    setErroEdicao(null);
    const resultado = await excluirTaskAction({ taskId: task.id, leadId: task.leadId });
    if (!resultado.ok) {
      setErroEdicao(resultado.erro);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {erro && (
        <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-600">
          {erro}{" "}
          <button type="button" onClick={limparErro} className="underline">
            Dispensar
          </button>
        </p>
      )}

      {erroEdicao && (
        <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-600">
          {erroEdicao}
        </p>
      )}

      {tasks.length === 0 ? (
        <EmptyState title="Nenhuma tarefa pendente" description="Você está em dia." />
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => {
            const podeConcluir = task.souResponsavel !== false;

            // Editar e excluir seguem a MESMA regra de dono de "Concluir":
            // quem recusa é `editarTask`/`excluirTask` no servidor; aqui a
            // interface só não oferece uma ação que iria falhar.
            if (editando === task.id) {
              return (
                <li key={task.id} className="space-y-2 rounded border p-3">
                  <Input
                    aria-label="Título da tarefa"
                    value={rascunho.titulo}
                    onChange={(evento) =>
                      setRascunho((atual) => ({ ...atual, titulo: evento.target.value }))
                    }
                  />
                  <Input
                    aria-label="Descrição da tarefa"
                    value={rascunho.descricao}
                    onChange={(evento) =>
                      setRascunho((atual) => ({ ...atual, descricao: evento.target.value }))
                    }
                  />
                  <Input
                    aria-label="Vencimento da tarefa"
                    type="date"
                    value={rascunho.vencimento}
                    onChange={(evento) =>
                      setRascunho((atual) => ({ ...atual, vencimento: evento.target.value }))
                    }
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => salvarEdicao(task)} disabled={salvando}>
                      {salvando ? "Salvando..." : "Salvar"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditando(null)}>
                      Cancelar
                    </Button>
                  </div>
                </li>
              );
            }

            // "Você"/nome do dono aparece UMA vez por linha — no subtítulo,
            // nunca de novo no lugar do botão — para não repetir a mesma
            // informação em dois pontos da mesma linha.
            const quem = task.responsavelNome
              ? task.souResponsavel
                ? "Você"
                : task.responsavelNome
              : undefined;
            return (
              <li key={task.id} className="flex items-center justify-between rounded border p-3">
                <div>
                  <p className="text-sm font-medium">{task.titulo}</p>
                  <p className="text-xs text-muted-foreground">
                    Vence em {formatarDataCivilBR(task.vencimento)}
                    {task.leadContatoNome ? ` · ${task.leadContatoNome}` : ""}
                    {quem ? ` · ${quem}` : ""}
                  </p>
                </div>
                {podeConcluir ? (
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => concluirEAtualizar(task.id)}>
                      Concluir
                    </Button>
                    <button
                      type="button"
                      className="text-xs underline"
                      onClick={() => comecarEdicao(task)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="text-xs text-red-600 underline"
                      onClick={() => excluir(task)}
                    >
                      Excluir
                    </button>
                  </div>
                ) : (
                  // Nenhum botão aqui — nem "desabilitado" (que ainda sugere
                  // uma ação bloqueada por ora), nem um "Concluir" que
                  // renderiza igual pra todo mundo e falha silenciosamente
                  // com "Tarefa não encontrada" pra quem não é dono (o bug
                  // que este fix corrige). De quem é a tarefa já está dito
                  // no subtítulo acima ("· Fernanda") — repetir aqui, ao
                  // lado de um espaço vazio, não acrescentaria nada.
                  null
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
