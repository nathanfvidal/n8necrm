import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { usuarioAtualOuLogin } from "@/core/auth/session";
import { listarNotas, TEXTO_MAX_LENGTH } from "@/core/leads/notes";
import { listarTasksPendentesDoLead } from "@/core/tasks/queries";
import { listarEtapas } from "@/core/pipeline/stages";
import { formatarValorBR } from "@/lib/dinheiro";
import { LeadEditForm } from "@/components/leads/lead-edit-form";
import { LeadNoteForm } from "@/components/leads/lead-note-form";
import { LeadNoteList } from "@/components/leads/lead-note-list";
import { TaskForm } from "@/components/tasks/task-form";
import { TaskList, type TaskLinha } from "@/components/tasks/task-list";

/**
 * Página de detalhe de um lead: dados básicos + histórico de notas.
 *
 * `(painel)/layout.tsx` já garante sessão válida e usuário ativo antes de
 * qualquer página sob este route group renderizar (redireciona para
 * `/login` quando `usuarioAtual()` rejeita) — não repetimos essa checagem
 * aqui, mesma observação já feita em `leads/page.tsx` (Task 16).
 *
 * Sem escopo por responsável, de propósito: mesma decisão de negócio da
 * tabela (`leads/page.tsx`) e do kanban (Task 15) — revenda pequena, equipe
 * colaborativa, qualquer vendedor pode precisar do histórico de um lead que
 * "pertence" a outro colega. `moverEtapa` (service.ts) também nunca checou
 * dono. Uma barreira só nesta página, sozinha entre três telas que já
 * mostram o mesmo dado sem filtro, não seria controle — seria uma
 * inconsistência a mais.
 *
 * Seção de tarefas (Task 18): a Task 17 deixou de propósito de fora
 * (comentário acima, versão anterior) porque o CRUD de `Task` só chegava
 * nesta task — uma seção sem nenhuma ação real por trás não valeria a pena.
 * Agora a seção lista TODAS as tarefas PENDENTES ligadas a este lead,
 * qualquer que seja o responsável — fix round 1/5, achado do revisor,
 * revertendo a versão original (escopada por `responsavelId`, mesmo
 * raciocínio de `/tasks`). A versão original escondia de um colega que
 * outro colega já tinha um lembrete agendado para aquele MESMO lead — na
 * prática, risco real de contato duplicado com o cliente (ex.: dois
 * vendedores ligando no mesmo dia sem saber um do outro), pior do que a UI
 * mostrar um lembrete que a pessoa não pode concluir. Também deixava a
 * página inconsistente: notas são compartilhadas (Task 17), o lead é
 * compartilhado (decisão de negócio de `leads/queries.ts`) — só tarefa
 * ficava escondida.
 *
 * `souResponsavel` (calculado abaixo, por tarefa, comparando
 * `task.responsavelId` com `usuario.id`) é o que faz `TaskList` mostrar o
 * botão "Concluir" só pra quem pode de fato concluir — a checagem de dono
 * em `concluirTask` (`core/tasks/service.ts`) continua sendo a barreira
 * real e não foi tocada; isto aqui é só a UI não oferecer uma ação que vai
 * falhar pra quem não é dono. Por isso, ao contrário do resto desta página,
 * aqui SIM chamamos `usuarioAtual()` — não por segurança (o layout já
 * protege a rota), mas para saber quem é o usuário e computar
 * `souResponsavel` de cada tarefa.
 */
export default async function LeadDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const usuario = await usuarioAtualOuLogin();

  // `responsavel` narrowed para só `id`/`nome` (fix round 1/5, achado do
  // revisor): `include: { responsavel: true }` carregava a linha inteira de
  // `User`, `senhaHash` incluído, só para renderizar um nome. `contact` e
  // `stage` continuam com `include` completo — nenhum dos dois tem campo
  // sensível (Contact não guarda senha; PipelineStage é config de funil).
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      contact: true,
      stage: true,
      responsavel: { select: { id: true, nome: true } },
    },
  });

  if (!lead) {
    notFound();
  }

  const notas = await listarNotas(id);

  const [etapas, vendedores] = await Promise.all([
    listarEtapas(),
    prisma.user.findMany({
      where: { ativo: true },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
  ]);

  const tasksPendentes = await listarTasksPendentesDoLead(id);
  const tarefasLinhas: TaskLinha[] = tasksPendentes.map((task) => ({
    id: task.id,
    titulo: task.titulo,
    vencimento: task.vencimento,
    descricao: task.descricao,
    leadId: task.leadId,
    responsavelNome: task.responsavel.nome,
    souResponsavel: task.responsavelId === usuario.id,
  }));

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">
          {lead.contact?.nome ?? "Sem contato identificado"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {lead.stage.nome} · {lead.responsavel?.nome ?? "Sem responsável"}
        </p>
      </div>

      {/* `valorEstimado` é `Prisma.Decimal` — objeto Decimal.js, NÃO
          serializável para Client Component. Converte para string AQUI, no
          servidor, e nunca com `Number` (ponto flutuante é a origem clássica
          de centavo que some). Ver `src/lib/dinheiro.ts`. */}
      <LeadEditForm
        lead={{
          id: lead.id,
          valorEstimado: lead.valorEstimado?.toString() ?? null,
          responsavelId: lead.responsavelId,
          stageId: lead.stageId,
          arquivadoEm: lead.arquivadoEm,
        }}
        valorFormatado={formatarValorBR(lead.valorEstimado?.toString() ?? null)}
        vendedores={vendedores}
        etapas={etapas.map((etapa) => ({ id: etapa.id, nome: etapa.nome }))}
      />

      <LeadNoteForm leadId={id} textoMaxLength={TEXTO_MAX_LENGTH} />

      {/* `idDoUsuarioAtual` decide quais notas mostram os botões de editar e
          excluir — conveniência de interface, não autorização: quem recusa é
          `editarNota`/`excluirNota` no servidor. */}
      <LeadNoteList
        notas={notas.map((nota) => ({
          id: nota.id,
          texto: nota.texto,
          criadoEm: nota.criadoEm,
          editadoEm: nota.editadoEm,
          autorId: nota.autorId,
          autorNome: nota.autor.nome,
        }))}
        leadId={id}
        idDoUsuarioAtual={usuario.id}
        textoMaxLength={TEXTO_MAX_LENGTH}
      />

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Tarefas</h2>
        <TaskForm leadId={id} />
        <TaskList tasks={tarefasLinhas} />
      </div>
    </div>
  );
}
