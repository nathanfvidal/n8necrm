import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { usuarioAtual } from "@/core/auth/session";
import { listarNotas, adicionarNota } from "@/core/leads/notes";
import { EmptyState } from "@/components/empty-state";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

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
 * Sem seção de tarefas: o plano de arquivos lista uma seção de tarefas
 * vinculadas ao lead, mas o CRUD de `Task` só chega na Task 18 — hoje não
 * existe nenhuma forma de criar uma tarefa vinculada a um lead, então uma
 * seção "Tarefas" aqui seria sempre um EmptyState estático, sem nenhuma
 * informação real por trás e sem ação possível (nem "adicionar tarefa" nem
 * listagem de verdade). Preferimos deixar a seção de fora agora — a Task 18
 * adiciona a consulta e a UI juntas — a exibir uma seção permanentemente
 * vazia que parece funcionalidade e não é.
 */
export default async function LeadDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const lead = await prisma.lead.findUnique({
    where: { id },
    include: { contact: true, stage: true, responsavel: true },
  });

  if (!lead) {
    notFound();
  }

  const notas = await listarNotas(id);

  async function salvarNota(formData: FormData) {
    "use server";

    // Autor SEMPRE derivado da sessão dentro da Server Action, nunca de um
    // campo (visível ou oculto) do formulário — decisão de segurança da
    // Task 13 (ver src/core/auth/session.ts e src/core/leads/actions.ts):
    // uma Server Action é um endpoint HTTP público, e qualquer valor vindo
    // do cliente é trivialmente forjável por um POST direto.
    const autor = await usuarioAtual();

    const texto = formData.get("texto");
    // `adicionarNota` já rejeita texto vazio/só-espaço com um erro de
    // domínio (ver notes.ts) — o `if` abaixo evita chegar até lá no caso
    // comum (usuário não digitou nada e apertou salvar): sem ele, essa
    // submissão comum lançaria uma exceção não tratada dentro de uma Server
    // Action sem `useActionState`, o que o App Router renderiza como erro
    // de página em vez de simplesmente não fazer nada.
    if (typeof texto !== "string" || !texto.trim()) return;

    await adicionarNota({ leadId: id, autorId: autor.id, texto });
  }

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

      <form action={salvarNota} className="space-y-2">
        <Textarea
          name="texto"
          placeholder="Adicionar nota..."
          maxLength={4000}
          required
        />
        <Button type="submit">Salvar nota</Button>
      </form>

      <div className="space-y-2">
        {notas.length === 0 ? (
          <EmptyState
            title="Sem notas"
            description="Nenhuma nota registrada para este lead."
          />
        ) : (
          notas.map((nota) => (
            <div key={nota.id} className="rounded border p-3 text-sm">
              {/* `whitespace-pre-wrap` preserva as quebras de linha que a
                  pessoa digitou E quebra linha automaticamente em texto
                  longo; `break-words` garante que mesmo uma string sem
                  nenhum espaço (ex.: um link colado, um ID colado por
                  engano) quebre dentro do card em vez de estourar a
                  largura do layout. React escapa `{nota.texto}` por
                  padrão — não há `dangerouslySetInnerHTML` em lugar
                  nenhum desta página — então texto de nota nunca é
                  interpretado como HTML/script, só exibido como texto. */}
              <p className="whitespace-pre-wrap break-words">{nota.texto}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {nota.autor.nome} · {nota.criadoEm.toLocaleString("pt-BR")}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
