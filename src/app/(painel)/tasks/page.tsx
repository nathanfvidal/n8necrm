import { usuarioAtualOuLogin } from "@/core/auth/session";
import { listarMinhasTasks } from "@/core/tasks/queries";
import { listarContatos } from "@/core/contacts/queries";
import { LIMITE_LISTAGEM } from "@/core/listagem";
import { TaskForm } from "@/components/tasks/task-form";
import { TaskList, type TaskLinha } from "@/components/tasks/task-list";

/**
 * `(painel)/layout.tsx` já garante sessão válida e usuário ativo antes de
 * qualquer página sob este route group renderizar (mesma observação já
 * feita em `leads/page.tsx`, Task 16) — não repetimos essa checagem aqui.
 * Chamamos `usuarioAtual()` de novo só para saber QUEM está logado: é o
 * escopo de `listarTasksComLead` — tarefa é lembrete pessoal, sempre
 * escopada ao próprio usuário (ver a checagem de dono em `concluirTask`,
 * `core/tasks/service.ts`), diferente do pipeline de leads (sem escopo por
 * responsável, decisão de negócio documentada em `leads/queries.ts`).
 */
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ concluidas?: string }>;
}) {
  // Filtro pela URL, no molde de `?arquivados=1` em `/leads`: é
  // compartilhável, sobrevive ao F5, filtra no Postgres em vez de esconder no
  // navegador, e mantém `TaskList` burro — ele recebe uma lista e a mostra,
  // sem saber que existe filtro.
  const mostrarConcluidas = (await searchParams).concluidas === "1";

  const usuario = await usuarioAtualOuLogin();
  const [{ itens: tasks, truncado }, { itens: contatos }] = await Promise.all([
    listarMinhasTasks(usuario.companyId, usuario.id, { concluidas: mostrarConcluidas }),
    // O `<select>` de contato do formulário de tarefa. Escopado desde o Ciclo
    // 1a: sem `companyId`, ele listava a agenda de TODAS as empresas, e
    // escolher uma linha ali gravava a tarefa apontando para o cliente de
    // outro fork — o mesmo defeito que o `<select>` de responsável do funil
    // teve na Task 4.
    listarContatos(usuario.companyId),
  ]);

  const linhas: TaskLinha[] = tasks.map((t) => ({
    id: t.id,
    titulo: t.titulo,
    vencimento: t.vencimento,
    descricao: t.descricao,
    concluida: t.concluidaEm !== null,
    leadId: t.leadId,
    leadContatoNome: t.leadContatoNome ?? undefined,
    contactId: t.contactId,
    contatoNome: t.contatoNome ?? undefined,
  }));

  // Só `id` e `nome` atravessam para o cliente. `ContatoListado` traz também
  // telefone, e-mail e `totalLeads` — nada disso é preciso para preencher um
  // `<select>`, e servir o e-mail de toda a agenda em `/tasks` seria repetir
  // em outra tela o vazamento que o funil acabou de fechar.
  const opcoesDeContato = contatos.map((c) => ({ id: c.id, nome: c.nome }));

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          {mostrarConcluidas ? "Tarefas concluídas" : "Tarefas"}
        </h1>
        {/* Mesmo padrão do alternador de arquivados em `/leads`: `<form
            method="get">` sem JS, com o campo escondido presente só quando o
            filtro está desligado — é o que faz o botão alternar nos dois
            sentidos, já que campo ausente some da query string. */}
        <form method="get" className="flex items-center">
          {!mostrarConcluidas && <input type="hidden" name="concluidas" value="1" />}
          <button type="submit" className="text-sm underline">
            {mostrarConcluidas ? "Ver pendentes" : "Ver concluídas"}
          </button>
        </form>
      </div>

      {/* Criar tarefa só faz sentido na lista de pendentes — um formulário de
          criação em cima do histórico criaria uma tarefa que sumiria da tela
          no mesmo instante, por não estar concluída. */}
      {!mostrarConcluidas && <TaskForm contatos={opcoesDeContato} />}

      {truncado && (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          Mostrando as {LIMITE_LISTAGEM} tarefas mais recentes desta lista. Há mais no banco.
        </p>
      )}

      <TaskList
        tasks={linhas}
        contatos={opcoesDeContato}
        vazioTitulo={mostrarConcluidas ? "Nenhuma tarefa concluída" : "Nenhuma tarefa pendente"}
        vazioDescricao={
          mostrarConcluidas
            ? "O que você concluir aparece aqui."
            : "Você está em dia."
        }
      />
    </div>
  );
}
