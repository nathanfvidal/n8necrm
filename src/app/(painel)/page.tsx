import { prisma } from "@/lib/prisma";
import { usuarioAtual } from "@/core/auth/session";
import { listarEtapas } from "@/core/pipeline/stages";
import { listarLeadsPorEtapa } from "@/core/leads/queries";
import { listarTasksPendentes } from "@/core/tasks/service";
import { StageSummary } from "@/components/dashboard/stage-summary";
import { ConversionChart } from "@/components/dashboard/conversion-chart";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Dashboard — a página que TODO usuário vê primeiro depois do login
 * (`(painel)/layout.tsx` já garante sessão válida e usuário ativo; não
 * repetimos essa checagem aqui, mesmo padrão de `leads/page.tsx` e
 * `tasks/page.tsx`). Chamamos `usuarioAtual()` de novo só para saber QUEM
 * está logado — é o escopo de `listarTasksPendentes` abaixo.
 *
 * Leads NÃO são escopados por usuário aqui, de propósito: decisão de
 * negócio já documentada em `leads/queries.ts`/`leads/page.tsx` (revenda
 * pequena, equipe colaborativa — qualquer vendedor cobre qualquer lead).
 * `listarLeadsPorEtapa` já lista todo lead para todo papel, sem filtro, e o
 * dashboard segue a mesma regra: a taxa de conversão e os cartões por etapa
 * são do funil inteiro, não "meu funil".
 *
 * "Tarefas pendentes" é a exceção: tarefa é lembrete pessoal (ver checagem
 * de dono em `concluirTask`, `core/tasks/service.ts`, e o mesmo raciocínio
 * em `tasks/page.tsx`), então este card mostra só as do usuário logado —
 * `listarTasksPendentes(usuario.id)`, não a lista inteira.
 */
export default async function DashboardPage() {
  const usuario = await usuarioAtual();

  const [etapas, leadsPorEtapa, tasksPendentes] = await Promise.all([
    listarEtapas(),
    listarLeadsPorEtapa(),
    listarTasksPendentes(usuario.id),
  ]);

  const resumo = etapas.map((etapa) => ({
    nome: etapa.nome,
    total: (leadsPorEtapa[etapa.id] ?? []).length,
    cor: etapa.cor,
    ehGanho: etapa.ehGanho,
  }));

  const totalLeads = resumo.reduce((soma, e) => soma + e.total, 0);

  // A etapa "ganha" é SEMPRE a última do funil e SEMPRE única — invariante
  // garantida por `confirmarInvarianteEhGanho()` (prisma/seed.ts, Task 9) a
  // cada execução do seed. `etapaGanho` pode ainda vir `undefined` aqui só
  // num banco que nunca rodou o seed (funil vazio) — tratado como 0
  // conversões, não como erro, para a página não quebrar num ambiente
  // recém-provisionado.
  const etapaGanho = etapas.find((e) => e.ehGanho);
  const totalGanhos = etapaGanho ? (leadsPorEtapa[etapaGanho.id] ?? []).length : 0;
  const taxaConversao = totalLeads > 0 ? ((totalGanhos / totalLeads) * 100).toFixed(1) : "0.0";

  // `user` narrowed para `id`/`nome` via `select` explícito (Task 17: toda
  // relação de `User` precisa disso — `include: { user: true }` traria
  // `senhaHash` junto, mesmo raciocínio de `responsavel` em
  // `leads/queries.ts` e `tasks/queries.ts`). Ninguém consome senha aqui;
  // ela simplesmente nunca sai do banco.
  const atividadeRecente = await prisma.auditLog.findMany({
    take: 10,
    orderBy: { criadoEm: "desc" },
    include: { user: { select: { id: true, nome: true } } },
  });

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>

      <StageSummary etapas={resumo} />

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-medium">Leads por etapa</h2>
          <ConversionChart dados={resumo} />
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Taxa de conversão</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{taxaConversao}%</p>
              <p className="text-xs text-muted-foreground">
                {totalGanhos} de {totalLeads} lead{totalLeads === 1 ? "" : "s"} em &ldquo;
                {etapaGanho?.nome ?? "Ganho"}&rdquo;
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Tarefas pendentes (suas)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{tasksPendentes.length}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Atividade recente</h2>
        {atividadeRecente.length === 0 ? (
          <EmptyState
            title="Nenhuma atividade ainda"
            description="Ações como criar um lead ou mover de etapa aparecem aqui."
          />
        ) : (
          <ul className="space-y-1 text-sm">
            {atividadeRecente.map((log) => (
              <li key={log.id} className="text-muted-foreground">
                {log.user.nome} — {log.acao} — {log.entidade} — {log.criadoEm.toLocaleString("pt-BR")}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
