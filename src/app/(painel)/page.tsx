import { prisma } from "@/lib/prisma";
import { usuarioAtualOuLogin } from "@/core/auth/session";
import { listarEtapas } from "@/core/pipeline/stages";
import { contarLeadsPorEtapa } from "@/core/leads/queries";
import { listarTasksPendentes } from "@/core/tasks/service";
import { StageSummary } from "@/components/dashboard/stage-summary";
import { ConversionChart } from "@/components/dashboard/conversion-chart";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatarDataHoraBR } from "@/lib/date";

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
  /**
   * A sessão vem PRIMEIRO, sozinha, e isso mudou no Ciclo 1a (Task 4).
   *
   * Antes as quatro consultas saíam numa `Promise.all` só, `usuarioAtualOuLogin()`
   * inclusive. Não dá mais: `contarLeadsPorEtapa` passou a exigir o escopo de
   * empresa, e a única origem legítima dele é `UsuarioAtivo.companyId` — que
   * só existe depois que a sessão resolve. Uma consulta de tenant que começa
   * antes de a empresa ser conhecida é, por definição, uma consulta sem
   * escopo.
   *
   * O custo é uma rodada a mais de espera, e ele é menor do que parece:
   * `usuarioAtual()` é memoizada por requisição com `cache()` do React
   * (`core/auth/session.ts`), e `(painel)/layout.tsx` já a chamou — layout e
   * página renderizam em paralelo, então na maioria das requisições esta
   * chamada encontra a promessa em voo, não uma consulta nova. "Na maioria" é
   * dedução do contrato de `cache()`, não medição: nada aqui cronometra a
   * diferença, e afirmar ganho medido seria inventar.
   *
   * O que se GANHA em troca é concreto: nenhuma consulta chega ao banco antes
   * de a sessão estar confirmada. A versão anterior desta página disparava
   * três `SELECT` para quem carregava cookie de conta desativada, e
   * documentava isso como troca consciente. A troca deixou de ser necessária.
   *
   * `contarLeadsPorEtapa` e não `listarLeadsPorEtapa`: esta página só mostra
   * NÚMEROS, e contava o tamanho de arrays com teto de 1000 linhas — ver o
   * comentário da função em `leads/queries.ts` sobre por que isso enviesava a
   * taxa de conversão para baixo, em silêncio, justamente na base grande.
   *
   * `user` narrowed para `id`/`nome` via `select` explícito (Task 17: toda
   * relação de `User` precisa disso — `include: { user: true }` traria
   * `senhaHash` junto, mesmo raciocínio de `responsavel` em
   * `leads/queries.ts` e `tasks/queries.ts`). Ninguém consome senha aqui;
   * ela simplesmente nunca sai do banco.
   */
  const usuario = await usuarioAtualOuLogin();

  const [etapas, leadsPorEtapa, atividadeRecente] = await Promise.all([
    listarEtapas(usuario.companyId),
    contarLeadsPorEtapa(usuario.companyId),
    // ATENÇÃO: esta consulta continua SEM `where` nenhum, e `AuditLog` é
    // modelo de tenant. A home do painel mostra hoje os últimos registros de
    // QUALQUER empresa — é o item 1 da fila de conversão anotada em
    // `eslint.config.mjs`, e o motivo de este arquivo continuar na exceção
    // temporária do lint. A Task 4 converte `leads`; esta página é da fila
    // seguinte, e mexer nela aqui misturaria duas conversões num commit só.
    prisma.auditLog.findMany({
      take: 10,
      orderBy: { criadoEm: "desc" },
      include: { user: { select: { id: true, nome: true } } },
    }),
  ]);

  const tasksPendentes = await listarTasksPendentes(usuario.id);

  const resumo = etapas.map((etapa) => ({
    id: etapa.id,
    nome: etapa.nome,
    total: leadsPorEtapa[etapa.id] ?? 0,
    cor: etapa.cor,
    ehGanho: etapa.ehGanho,
  }));

  const totalLeads = resumo.reduce((soma, e) => soma + e.total, 0);

  // A etapa de fechamento é ÚNICA, mas não é mais "a última do funil": desde o
  // CRUD de etapas ela é escolhida na tela (`/etapas`) e pode estar em qualquer
  // posição. Quem garante a unicidade é `definirEtapaDeFechamento`
  // (`core/pipeline/service.ts`), que desliga todas antes de ligar a escolhida na
  // mesma transação; `confirmarInvarianteEhGanho()` (prisma/seed.ts) continua
  // como alarme, checando só "exatamente uma".
  //
  // `etapaGanho` pode vir `undefined` num banco recém-criado, antes do primeiro
  // seed — daí o `?? 0` abaixo.
  const etapaGanho = etapas.find((e) => e.ehGanho);
  const totalGanhos = etapaGanho ? (leadsPorEtapa[etapaGanho.id] ?? 0) : 0;
  const taxaConversao = totalLeads > 0 ? ((totalGanhos / totalLeads) * 100).toFixed(1) : "0.0";

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
                {log.user.nome} — {log.acao} — {log.entidade} — {formatarDataHoraBR(log.criadoEm)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
