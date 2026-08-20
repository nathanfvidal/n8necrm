import { Badge } from "@/components/ui/badge";

import type { StatusExecucao as TipoStatusExecucao } from "@/modules/automation/n8n";

/**
 * Rótulo em português de cada status de execução do n8n.
 *
 * Movido de `fluxos-table.tsx` (achado do acabamento do Ciclo 4): o mesmo
 * conceito — status de execução — vivia em DOIS lugares e DUAS línguas.
 * `execucoes-table.tsx` mostrava `execucao.status` cru em inglês
 * ("running"), enquanto `fluxos-table.tsx` traduzia via `ROTULO_STATUS`, que
 * só existia ali. Uma tela mentia sobre gravidade (ver `VARIANTE_STATUS`
 * abaixo) e a outra não falava português — os dois defeitos vinham da mesma
 * causa: não existir um único lugar que soubesse o que cada status significa.
 *
 * `unknown` cobre um status novo que a instância passe a devolver — a tela
 * não pode quebrar por causa disso, só mostrar um rótulo genérico.
 */
const ROTULO_STATUS: Record<TipoStatusExecucao, string> = {
  success: "Sucesso",
  error: "Erro",
  waiting: "Aguardando",
  running: "Rodando",
  canceled: "Cancelado",
  crashed: "Falhou",
  new: "Novo",
  unknown: "Desconhecido",
};

/**
 * Variante do Badge para cada status — três famílias visuais, não duas.
 *
 * O bug original em `execucoes-table.tsx` era
 * `variant={status === "success" ? "default" : "destructive"}`: tudo que não
 * é sucesso virava vermelho, incluindo `running` e `waiting` — uma execução
 * rodando normalmente AGORA aparecia como falha na tela de diagnóstico, a
 * que alguém abre durante um incidente. Uma parede de vermelho de execuções
 * saudáveis esconde a que de fato quebrou.
 *
 * O princípio que decide a tabela abaixo: numa lista de 20 execuções, o olho
 * tem que cair sozinho na que falhou. Por isso só UMA família usa
 * `destructive` — e mesmo essa já é baixa opacidade de propósito
 * (`bg-destructive/10`, ver `badge.tsx`), não um vermelho sólido.
 *
 * - `error`, `crashed` → `destructive`. É a única família que deve puxar o
 *   olho — as outras cinco existem para NÃO competir com ela.
 * - `running`, `waiting`, `new` → `outline`. Em andamento não é alarme, mas
 *   também não é "nada a ver aqui": está aberto, ainda rodando — a borda sem
 *   preenchimento é o mesmo vocabulário visual de "em aberto" que o resto da
 *   base usa (ex.: botões `variant="outline"` para ações não-destrutivas).
 * - `success`, `canceled`, `unknown` → `secondary`. Terminaram, sem chamar
 *   atenção: sucesso é o caso comum (se gritar tanto quanto erro, o erro
 *   para de se destacar); cancelado foi decisão de alguém, não defeito, mas
 *   precisa ficar visualmente longe de `destructive` para não ser lido como
 *   erro à primeira vista; desconhecido é status novo do n8n, não defeito
 *   desta tela. Os três dividem o mesmo peso porque nenhum pede ação.
 *
 * `default` (cor primária da marca) fica de fora de propósito — primária é
 * cor de AÇÃO (mesmo raciocínio do comentário em `status-fluxo.tsx`), e
 * nenhum destes seis status é uma ação.
 */
const VARIANTE_STATUS: Record<TipoStatusExecucao, "secondary" | "destructive" | "outline"> = {
  success: "secondary",
  error: "destructive",
  waiting: "outline",
  running: "outline",
  canceled: "secondary",
  crashed: "destructive",
  new: "outline",
  unknown: "secondary",
};

export function StatusExecucao({ status }: { status: TipoStatusExecucao }) {
  return <Badge variant={VARIANTE_STATUS[status]}>{ROTULO_STATUS[status]}</Badge>;
}
