import Link from "next/link";
import { notFound } from "next/navigation";

import { prismaDaEmpresa } from "@/core/tenancy/escopo";
import { usuarioAtualOuLogin } from "@/core/auth/session";
import { listarUsuarios } from "@/core/users/queries";
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
/**
 * Uma linha do bloco "Pessoa".
 *
 * Campo vazio mostra "—" em vez de sumir: uma grade com buracos variáveis muda
 * de forma de lead para lead e obriga a pessoa a reler os rótulos toda vez. E
 * "—" comunica "não temos esse dado", que é informação; a ausência da linha
 * comunica "este CRM não guarda isso", que é mentira.
 */
function DadoDaPessoa({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="min-w-24 text-muted-foreground">{rotulo}</dt>
      <dd>{valor ?? "—"}</dd>
    </div>
  );
}

export default async function LeadDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const usuario = await usuarioAtualOuLogin();

  // `select` campo a campo, sem nenhum `include`.
  //
  // A versão anterior usava `include: { contact: true, stage: true }` com a
  // justificativa de que "nenhum dos dois tem campo sensível". Aquilo era
  // verdade quando `Contact` era nome, telefone e e-mail — e deixou de ser no
  // dia em que a pessoa ganhou documento, endereço e observações. O comentário
  // continuou lá, correto na aparência e desatualizado no que importa: é assim
  // que uma consulta curinga vira vazamento sem ninguém escrever uma linha
  // nova. Mesmo mecanismo do funil (`core/leads/queries.ts`).
  //
  // ─── O documento NÃO entra aqui, e é decisão, não esquecimento ───
  //
  // `Contact.documento` é restrito a GESTOR/ADMIN (`ver_documento_contato`).
  // Repetir essa checagem nesta tela criaria um SEGUNDO lugar onde a regra
  // precisa ser lembrada — e "regra numa tela, esquecida na outra" é a
  // armadilha que mais se repete neste projeto. Em vez disso o CPF não é
  // buscado nem renderizado aqui: quem precisa dele abre o cadastro completo
  // em `/contatos/[id]`, onde a permissão já mora e já é testada.
  //
  // Travado por `tests/e2e/fronteira-rsc.spec.ts`, que confere a ausência do
  // documento nesta tela até para ADMIN — quem pode vê-lo na outra.
  //
  // Se um dia ele tiver de aparecer aqui, o certo é extrair a decisão para uma
  // função só, usada nas duas telas, e não copiar o `hasPermission` para cá.
  // `findFirst` no cliente ESCOPADO, e não `findUnique` no prisma cru.
  //
  // Duas coisas mudaram de uma vez, e vale separá-las. A que importa: esta
  // consulta alcançava lead de QUALQUER empresa pelo id — a página de detalhe
  // era o caminho mais curto para ler o cliente de outro tenant, incluindo
  // empresa, cargo, cidade e observações do contato. A consequente: o escopo
  // RECUSA `findUnique` em modelo de tenant (o `where` dela só aceita campo
  // único, e `companyId` não é único em `Lead`), então a equivalente escopável
  // é `findFirst` — ver "Recusa, lançando" em `core/tenancy/escopo.ts`.
  //
  // Lead de outra empresa passa a cair no `notFound()` abaixo, que é a mesma
  // resposta de um id inexistente: quem sonda ids não descobre nada.
  const lead = await prismaDaEmpresa(usuario.companyId).lead.findFirst({
    where: { id },
    select: {
      id: true,
      valorEstimado: true,
      responsavelId: true,
      stageId: true,
      arquivadoEm: true,
      contactId: true,
      contact: {
        select: {
          id: true,
          nome: true,
          telefone: true,
          email: true,
          empresa: true,
          cargo: true,
          cidade: true,
          uf: true,
          observacoes: true,
        },
      },
      stage: { select: { nome: true } },
      responsavel: { select: { id: true, nome: true } },
    },
  });

  if (!lead) {
    notFound();
  }

  const notas = await listarNotas(id, usuario.companyId);

  // A lista de pessoas vai para TODO papel, sem gate — inclusive VENDEDOR.
  //
  // Isto diverge de `leads/page.tsx`, que só busca vendedores para quem tem
  // `ver_dashboard_geral`, e a divergência é DELIBERADA: decisão do dono do
  // projeto na auditoria de segurança desta branch — "os leads têm que ser
  // vistos por todos daquela empresa". Editar um lead inclui reatribuí-lo, e
  // `atualizarLead` honra qualquer responsável para quem tem `mover_lead`
  // (que os três papéis têm). Esconder a lista aqui daria um `<select>` vazio
  // numa ação que o servidor aceita.
  //
  // Era `prisma.user.findMany({ where: { ativo: true } })` — TODA pessoa ativa
  // do banco, de qualquer empresa; o mesmo defeito que `leads/page.tsx` tinha,
  // no mesmo `<select>`, na outra tela. `listarUsuarios`
  // (`core/users/queries.ts`) parte de `Membership`, que é o que define
  // "pessoa desta empresa", já traz a projeção segura de `User` (sem
  // `senhaHash`) e já exclui contas de sistema.
  //
  // Só ATIVOS no `<select>` — e `atualizarLead` recusa reatribuição para conta
  // desativada, então tela e servidor concordam. E, como lá, corrigir a tela
  // NÃO substitui a checagem de vínculo no serviço: Server Action é endpoint
  // HTTP público e não passa por este `<select>`.
  const [etapas, equipe] = await Promise.all([
    listarEtapas(usuario.companyId),
    listarUsuarios(usuario.companyId),
  ]);

  const vendedores = equipe
    .filter((pessoa) => pessoa.ativo)
    .map((pessoa) => ({ id: pessoa.id, nome: pessoa.nome }));

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

      {/* ─── Pessoa ───────────────────────────────────────────────────────
          Renderizado NO SERVIDOR, como HTML comum: nada aqui é passado para
          Client Component nenhum, então o cadastro não entra no payload RSC
          além do texto que a tela de fato desenha.

          Responde a pergunta que o vendedor faz antes de ligar: "quem é essa
          pessoa, onde trabalha, o que já sei dela". Até esta branch, o detalhe
          do lead sabia o nome e mais nada — o cadastro existia em
          `/contatos/[id]` e ninguém cruzava os dois. */}
      {lead.contact && (
        <div className="rounded-md border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">Pessoa</h2>
            {/* O documento e o cadastro completo moram lá, com a permissão que
                os protege. Este link é o que torna a ausência do CPF aqui uma
                decisão navegável em vez de um dado que sumiu. */}
            <Link href={`/contatos/${lead.contact.id}`} className="text-sm text-primary underline">
              Ver cadastro completo
            </Link>
          </div>

          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <DadoDaPessoa rotulo="Empresa" valor={lead.contact.empresa} />
            <DadoDaPessoa rotulo="Cargo" valor={lead.contact.cargo} />
            <DadoDaPessoa rotulo="Telefone" valor={lead.contact.telefone} />
            <DadoDaPessoa rotulo="E-mail" valor={lead.contact.email} />
            <DadoDaPessoa
              rotulo="Cidade"
              valor={
                lead.contact.cidade && lead.contact.uf
                  ? `${lead.contact.cidade} — ${lead.contact.uf}`
                  : (lead.contact.cidade ?? lead.contact.uf)
              }
            />
          </dl>

          {lead.contact.observacoes && (
            <div className="mt-3 border-t pt-3">
              <p className="text-xs text-muted-foreground">Observações</p>
              {/* `whitespace-pre-wrap` porque o campo é `<textarea>` e as
                  quebras de linha que a pessoa digitou são parte do sentido.
                  `line-clamp-4` porque o texto vai até 4000 caracteres, e uma
                  observação longa empurraria notas e tarefas para fora da
                  tela — o cadastro completo está a um clique. */}
              <p className="line-clamp-4 whitespace-pre-wrap text-sm">{lead.contact.observacoes}</p>
            </div>
          )}
        </div>
      )}

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
        {/* O contato do próprio lead já vem escolhido: "ligar para o cliente"
            criado daqui nasce ligado à pessoa, sem ninguém procurá-la numa
            lista. É onde a decisão de ligar tarefa a lead E contato paga. */}
        <TaskForm leadId={id} contactIdPadrao={lead.contactId} />
        <TaskList tasks={tarefasLinhas} />
      </div>
    </div>
  );
}
