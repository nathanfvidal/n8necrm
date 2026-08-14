"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  concluirMinhaTaskAction,
  editarTaskAction,
  excluirTaskAction,
  reabrirTaskAction,
} from "@/core/tasks/actions";
import { EmptyState } from "@/components/empty-state";
import { registrarFalhaDeRede } from "@/lib/acao";
import { ConfirmarDialogo } from "@/components/confirmar-dialogo";
import type { OpcaoDeContato } from "@/components/tasks/task-form";
import { formatarDataCivilBR, parseDataCivil } from "@/lib/date";

const CLASSES_SELECT =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export type TaskLinha = {
  id: string;
  titulo: string;
  vencimento: Date;
  descricao?: string | null;
  /**
   * A lista serve às duas telas: pendentes e concluídas. Quem decide qual é
   * a consulta (`/tasks?concluidas=1`), não este componente — ele só troca
   * "Concluir" por "Reabrir". Manter `TaskList` burro é o que permite o
   * filtro morar na URL.
   */
  concluida?: boolean;
  leadId?: string | null;
  leadContatoNome?: string;
  contactId?: string | null;
  contatoNome?: string;
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
 * Rede de segurança para a falha que NÃO chega como `{ ok: false }`.
 *
 * Esta função substituiu um `mensagemDeErroConcluir` que comparava
 * `erro.message` com "Tarefa não encontrada" e "Não autenticado" — texto
 * produzido pelo servidor, casado no cliente. Renomear a mensagem em
 * `service.ts` quebraria o reconhecimento em silêncio, sem erro de tipo e sem
 * teste vermelho no ponto da mudança. As frases boas viraram
 * `MENSAGENS_MELHORADAS` em `core/tasks/actions.ts` e agora valem para as
 * cinco actions, não só para esta.
 *
 * O que sobrou aqui é o caso que resultado nenhum cobre: `concluirMinhaTaskAction`
 * promete não lançar, mas essa é promessa do CÓDIGO do servidor, não do
 * transporte. Server Action é chamada de rede — conexão que cai entre o clique
 * e a resposta, deploy no meio do caminho — e aí o `await` rejeita sem nunca
 * ter entrado no `try` da action.
 */
function mensagemDeFalhaDeRede(erro: unknown): string {
  return registrarFalhaDeRede("Falha ao concluir tarefa", erro);
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

  // ─── Ressincronização com o servidor ───────────────────────────────────
  //
  // Sem isto a lista congela na foto do PRIMEIRO render, e o defeito é
  // grave: `TaskForm` cria a tarefa, chama `router.refresh()`, o Next refaz
  // o Server Component e manda props novas — e `useState` ignora props
  // novas, por definição. O componente continua montado com a lista antiga.
  // Resultado em produção: **criar uma tarefa não a mostrava na tela até a
  // pessoa recarregar a página**.
  //
  // O defeito é anterior a esta branch (`router.refresh()` e este `useState`
  // já conviviam). Ninguém tinha visto porque não havia e2e de tarefas: os
  // testes de unidade renderizam com a lista já preenchida e nunca exercitam
  // "props mudaram depois do mount". O primeiro teste que criou uma tarefa
  // num navegador de verdade encontrou na primeira execução.
  //
  // Ajuste durante o RENDER, não em `useEffect`: é o padrão que o React
  // documenta para "estado derivado de prop que precisa ser reiniciado". O
  // React descarta o render em andamento e refaz imediatamente, sem pintar o
  // quadro intermediário — diferente do efeito, que pinta a lista velha
  // primeiro e só então corrige. Também evita o `react-hooks/set-state-in-
  // effect`, que este projeto trata como erro de lint (mesma escolha de
  // `theme-toggle.tsx` e `notification-bell.tsx`).
  //
  // Comparação por REFERÊNCIA: `page.tsx` monta um array novo a cada render,
  // então toda resposta do servidor ressincroniza. É o que se quer — o
  // servidor é a verdade, e o estado otimista existe só para a janela entre
  // o clique e a confirmação.
  const [ultimoDoServidor, setUltimoDoServidor] = useState(tasksIniciais);
  if (tasksIniciais !== ultimoDoServidor) {
    setUltimoDoServidor(tasksIniciais);
    setTasks(tasksIniciais);
  }

  async function handleConcluir(id: string) {
    setErro(null);
    const tarefa = tasks.find((t) => t.id === id);
    if (!tarefa) return;

    // Atualização otimista: some da lista de pendentes antes da
    // confirmação do servidor — "Concluir" precisa parecer instantâneo.
    setTasks((atual) => atual.filter((t) => t.id !== id));

    // ─── DOIS caminhos de rollback, e os dois são obrigatórios ───
    //
    // Enquanto `concluirMinhaTask` LANÇAVA, o `catch` sozinho dava conta. Com
    // a action devolvendo `ResultadoAcao`, a recusa do servidor (id que não é
    // seu, sessão expirada) passa a chegar como VALOR — e um código que só
    // olhasse o `catch` deixaria a tarefa sumida da lista sem ter sido
    // concluída, em silêncio, que é o pior desfecho possível para quem está
    // usando: some da tela, continua pendente no banco.
    //
    // O `catch` continua necessário pelo motivo oposto: a action promete não
    // lançar, mas a chamada de rede pode falhar antes de alcançá-la.
    // Arrow em `const`, e não `function desfazer`: declaração de função é
    // içada para o topo do escopo, e o TypeScript a analisa de lá — onde
    // `tarefa` ainda é `TaskLinha | undefined`, apesar do `return` acima. A
    // arrow é criada aqui, com o estreitamento já valendo.
    const desfazer = (mensagem: string) => {
      setTasks((atual) => [...atual, tarefa].sort(porVencimentoAsc));
      setErro(mensagem);
    };

    try {
      const resultado = await concluirMinhaTaskAction(id);
      if (!resultado.ok) desfazer(resultado.erro);
    } catch (erroCapturado) {
      desfazer(mensagemDeFalhaDeRede(erroCapturado));
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
export function TaskList({
  tasks: tasksIniciais,
  contatos = [],
  // O texto de lista vazia vem de fora porque a lista serve às duas telas:
  // "Nenhuma tarefa pendente / Você está em dia" é elogio na tela de
  // pendentes e mentira na de concluídas, onde significa "você nunca
  // terminou nada". Achado pelo retrato que o Playwright grava na falha.
  vazioTitulo = "Nenhuma tarefa pendente",
  vazioDescricao = "Você está em dia.",
}: {
  tasks: TaskLinha[];
  contatos?: OpcaoDeContato[];
  vazioTitulo?: string;
  vazioDescricao?: string;
}) {
  const router = useRouter();
  const { tasks, erro, handleConcluir, limparErro } = useTaskList(tasksIniciais);

  // Edição em linha no padrão de `user-table.tsx`: um estado com o id da
  // linha em edição, e só ela troca de forma.
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState({
    titulo: "",
    descricao: "",
    vencimento: "",
    contactId: "",
  });
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
      contactId: task.contactId ?? "",
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
      // `undefined` mantém o vínculo com o LEAD como está — esta tela não
      // oferece trocar o lead de uma tarefa, então nunca manda `null`.
      leadId: undefined,
      // O contato, sim, é editável aqui. `""` (opção "Nenhum" do `<select>`)
      // vira `null`, que é a ordem de DESVINCULAR — antes desta branch o
      // campo era mandado como `undefined` fixo, e desvincular era
      // literalmente inalcançável pela interface.
      contactId: rascunho.contactId || null,
    });
    setSalvando(false);

    if (!resultado.ok) {
      setErroEdicao(resultado.erro);
      return;
    }
    setEditando(null);
    router.refresh();
  }

  // Sem `window.confirm`: a confirmação agora é DOM de verdade
  // (`ConfirmarDialogo`), que é o que torna o e2e desta tela possível sem
  // depender de `page.on("dialog")`.
  async function excluir(task: TaskLinha) {
    setErroEdicao(null);
    const resultado = await excluirTaskAction({ taskId: task.id, leadId: task.leadId });
    if (!resultado.ok) {
      setErroEdicao(resultado.erro);
      return;
    }
    router.refresh();
  }

  async function reabrir(task: TaskLinha) {
    setErroEdicao(null);
    const resultado = await reabrirTaskAction({ taskId: task.id, leadId: task.leadId });
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
        <EmptyState title={vazioTitulo} description={vazioDescricao} />
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
                  {/* `<Textarea>` e não `<Input>`: a descrição tem quebra de
                      linha, e um campo de uma linha só ensina a pessoa a não
                      escrever nada. O rótulo acessível é o MESMO de antes,
                      para não quebrar teste nem hábito de quem usa leitor. */}
                  <Textarea
                    aria-label="Descrição da tarefa"
                    rows={3}
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
                  {contatos.length > 0 && (
                    <select
                      aria-label="Contato da tarefa"
                      className={CLASSES_SELECT}
                      value={rascunho.contactId}
                      onChange={(evento) =>
                        setRascunho((atual) => ({ ...atual, contactId: evento.target.value }))
                      }
                    >
                      <option value="">Nenhum</option>
                      {contatos.map((contato) => (
                        <option key={contato.id} value={contato.id}>
                          {contato.nome}
                        </option>
                      ))}
                    </select>
                  )}
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
              <li key={task.id} className="flex items-start justify-between gap-3 rounded border p-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">{task.titulo}</p>
                  {/* A descrição EXISTIA no banco, o serviço gravava e a
                      action aceitava — só que nada nesta tela a mostrava.
                      Dava para digitar uma descrição ao editar, salvar, e
                      vê-la sumir. `whitespace-pre-wrap` preserva as quebras
                      de linha que o `<Textarea>` permite digitar;
                      `line-clamp-3` impede que uma descrição de 2000
                      caracteres empurre a lista inteira para fora da tela. */}
                  {task.descricao && (
                    <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                      {task.descricao}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Vence em {formatarDataCivilBR(task.vencimento)}
                    {task.contatoNome ? ` · ${task.contatoNome}` : ""}
                    {task.leadContatoNome ? ` · ${task.leadContatoNome}` : ""}
                    {quem ? ` · ${quem}` : ""}
                  </p>
                </div>
                {podeConcluir ? (
                  <div className="flex shrink-0 items-center gap-2">
                    {task.concluida ? (
                      <Button size="sm" variant="outline" onClick={() => reabrir(task)}>
                        Reabrir
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => concluirEAtualizar(task.id)}
                      >
                        Concluir
                      </Button>
                    )}
                    {/* Eram `<button className="text-xs underline">` — texto
                        sublinhado ao lado de um `<Button>` de verdade, que é
                        como uma ação disponível se disfarça de nota de
                        rodapé. Agora são botões, com peso visual proporcional
                        ao que fazem: excluir é `destructive`. */}
                    <Button size="sm" variant="ghost" onClick={() => comecarEdicao(task)}>
                      Editar
                    </Button>
                    <ConfirmarDialogo
                      gatilho={(abrir) => (
                        // O rótulo do gatilho é "Excluir tarefa" e o da
                        // confirmação é "Excluir": nomes distintos de
                        // propósito, para que o localizador do e2e não fique
                        // ambíguo entre os dois. Não dependo de o Base UI
                        // tirar o fundo da árvore de acessibilidade — ele faz
                        // isso hoje, e é conveniente demais para eu apostar.
                        <Button size="sm" variant="ghost" onClick={abrir}>
                          Excluir tarefa
                        </Button>
                      )}
                      titulo="Excluir tarefa"
                      descricao={`"${task.titulo}" será apagada para sempre. Isso não pode ser desfeito.`}
                      rotuloConfirmar="Excluir"
                      onConfirmar={() => excluir(task)}
                    />
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
