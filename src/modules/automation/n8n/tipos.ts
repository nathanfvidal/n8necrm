/**
 * Contrato do módulo de automação.
 *
 * Sem `server-only` e sem `fetch`, pelo mesmo motivo de `gateway/tipos.ts` e
 * `fila/tipos.ts`: quem só precisa nomear o tipo — um componente de tela, um
 * teste, um adapter futuro — não deveria arrastar junto a marcação de servidor
 * nem o SDK de um provedor.
 */

/**
 * Status de execução, normalizado.
 *
 * `unknown` existe porque a lista de status do n8n muda entre versões, e um
 * status novo não pode derrubar a tela inteira de diagnóstico — que é
 * justamente a tela para onde alguém corre quando algo está errado.
 */
export type StatusExecucao =
  | "success"
  | "error"
  | "waiting"
  | "running"
  | "canceled"
  | "crashed"
  | "new"
  | "unknown";

export interface WorkflowResumo {
  id: string;
  nome: string;
  ativo: boolean;
  /** Quantidade de nós — proxy barato de complexidade, útil na lista. */
  nos: number;
  tags: string[];
  atualizadoEm: string;
}

export interface Execucao {
  id: string;
  workflowId: string;
  status: StatusExecucao;
  /** Como foi disparada: `webhook`, `trigger`, `manual`, `retry`, ... */
  modo: string;
  iniciadoEm: string;
  /** `null` enquanto a execução ainda está rodando. */
  terminadoEm: string | null;
}

export interface PaginaExecucoes {
  itens: Execucao[];
  /** Cursor opaco do n8n. `null` quando não há mais página. */
  proximoCursor: string | null;
}

export interface OpcoesListarExecucoes {
  workflowId?: string;
  limite?: number;
  cursor?: string;
}

/**
 * Abstração sobre a API pública do n8n.
 *
 * `apagarWorkflow` e `desativarWorkflow` existem aqui porque a decisão 3 do
 * spec pediu controle total. Quem os chama (`actions.ts`) é que impõe
 * permissão, confirmação e auditoria — o adapter só fala HTTP.
 */
export interface ClienteN8n {
  listarWorkflows(): Promise<WorkflowResumo[]>;
  buscarWorkflow(id: string): Promise<WorkflowResumo>;
  listarExecucoes(opcoes: OpcoesListarExecucoes): Promise<PaginaExecucoes>;
  ativarWorkflow(id: string): Promise<void>;
  desativarWorkflow(id: string): Promise<void>;
  apagarWorkflow(id: string): Promise<void>;
  /** Reexecuta uma execução passada contra a versão ATUAL do workflow. */
  reexecutarExecucao(id: string): Promise<void>;
}
