import type {
  ClienteN8n,
  Execucao,
  OpcoesListarExecucoes,
  PaginaExecucoes,
  StatusExecucao,
  WorkflowResumo,
} from "./tipos";

/**
 * Erro do módulo, com o tipo separado da mensagem.
 *
 * A tela precisa dizer QUAL problema é: instância fora do ar, chave inválida
 * ou workflow que sumiu. Sem isso os três viram "lista vazia", que é
 * indistinguível de "não há fluxos" — e essa confusão custa caro justamente
 * na tela para onde alguém corre quando algo já está errado.
 */
export class ErroN8n extends Error {
  constructor(
    message: string,
    readonly tipo: "inalcancavel" | "nao_autorizado" | "nao_encontrado" | "recusado"
  ) {
    super(message);
    this.name = "ErroN8n";
  }
}

const STATUS_CONHECIDOS: StatusExecucao[] = [
  "success",
  "error",
  "waiting",
  "running",
  "canceled",
  "crashed",
  "new",
];

function normalizarStatus(bruto: unknown): StatusExecucao {
  return STATUS_CONHECIDOS.includes(bruto as StatusExecucao) ? (bruto as StatusExecucao) : "unknown";
}

interface WorkflowBruto {
  id?: unknown;
  name?: unknown;
  active?: unknown;
  nodes?: unknown;
  tags?: unknown;
  updatedAt?: unknown;
}

function normalizarWorkflow(bruto: WorkflowBruto): WorkflowResumo {
  return {
    id: String(bruto.id ?? ""),
    nome: typeof bruto.name === "string" ? bruto.name : "(sem nome)",
    ativo: bruto.active === true,
    nos: Array.isArray(bruto.nodes) ? bruto.nodes.length : 0,
    tags: Array.isArray(bruto.tags)
      ? bruto.tags
          .map((t) => (t && typeof t === "object" && "name" in t ? String((t as { name: unknown }).name) : null))
          .filter((t): t is string => t !== null)
      : [],
    atualizadoEm: typeof bruto.updatedAt === "string" ? bruto.updatedAt : "",
  };
}

interface ExecucaoBruta {
  id?: unknown;
  workflowId?: unknown;
  status?: unknown;
  mode?: unknown;
  startedAt?: unknown;
  stoppedAt?: unknown;
}

function normalizarExecucao(bruto: ExecucaoBruta): Execucao {
  return {
    id: String(bruto.id ?? ""),
    workflowId: String(bruto.workflowId ?? ""),
    status: normalizarStatus(bruto.status),
    modo: typeof bruto.mode === "string" ? bruto.mode : "desconhecido",
    iniciadoEm: typeof bruto.startedAt === "string" ? bruto.startedAt : "",
    terminadoEm: typeof bruto.stoppedAt === "string" ? bruto.stoppedAt : null,
  };
}

export interface ConfigClienteN8n {
  baseUrl: string;
  apiKey: string;
}

export class ClienteN8nHttp implements ClienteN8n {
  constructor(private readonly config: ConfigClienteN8n) {}

  /**
   * Um único ponto de saída HTTP.
   *
   * A chave vai SEMPRE em header, nunca em query string: URL vaza para log de
   * proxy, histórico e mensagem de erro. E nenhuma mensagem de erro daqui
   * inclui o corpo da requisição nem a config — o corpo da RESPOSTA é
   * truncado, porque um 500 do n8n pode devolver rastro de pilha longo.
   */
  private async chamar(caminho: string, init?: RequestInit): Promise<unknown> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/api/v1${caminho}`;

    let resposta: Response;
    try {
      resposta = (await fetch(url, {
        ...init,
        headers: {
          "X-N8N-API-KEY": this.config.apiKey,
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
        // A tela de diagnóstico não pode ficar pendurada esperando uma
        // instância que caiu: melhor dizer "fora do ar" em 15s.
        signal: AbortSignal.timeout(15_000),
      })) as Response;
    } catch (erro) {
      throw new ErroN8n(
        `Não foi possível falar com o n8n em ${this.config.baseUrl}: ${erro instanceof Error ? erro.name : "erro desconhecido"}`,
        "inalcancavel"
      );
    }

    if (resposta.status === 401 || resposta.status === 403) {
      throw new ErroN8n("O n8n recusou a chave de API (HTTP " + resposta.status + ").", "nao_autorizado");
    }
    if (resposta.status === 404) {
      throw new ErroN8n("O n8n não encontrou o recurso pedido (HTTP 404).", "nao_encontrado");
    }
    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => "");
      throw new ErroN8n(`O n8n recusou a operação (HTTP ${resposta.status}): ${corpo.slice(0, 300)}`, "recusado");
    }

    return resposta.json().catch(() => null);
  }

  async listarWorkflows(): Promise<WorkflowResumo[]> {
    const json = (await this.chamar("/workflows?limit=100")) as { data?: WorkflowBruto[] } | null;
    return (json?.data ?? []).map(normalizarWorkflow);
  }

  async buscarWorkflow(id: string): Promise<WorkflowResumo> {
    const json = (await this.chamar(`/workflows/${encodeURIComponent(id)}`)) as WorkflowBruto;
    return normalizarWorkflow(json ?? {});
  }

  async listarExecucoes(opcoes: OpcoesListarExecucoes): Promise<PaginaExecucoes> {
    const params = new URLSearchParams();
    params.set("limit", String(opcoes.limite ?? 20));
    // `includeData=false` de propósito: o payload de uma execução de workflow
    // com 65 nós é enorme, e a lista só mostra status e horário.
    params.set("includeData", "false");
    if (opcoes.workflowId) params.set("workflowId", opcoes.workflowId);
    if (opcoes.cursor) params.set("cursor", opcoes.cursor);

    const json = (await this.chamar(`/executions?${params.toString()}`)) as
      | { data?: ExecucaoBruta[]; nextCursor?: unknown }
      | null;

    return {
      itens: (json?.data ?? []).map(normalizarExecucao),
      proximoCursor: typeof json?.nextCursor === "string" ? json.nextCursor : null,
    };
  }

  async ativarWorkflow(id: string): Promise<void> {
    await this.chamar(`/workflows/${encodeURIComponent(id)}/activate`, { method: "POST" });
  }

  async desativarWorkflow(id: string): Promise<void> {
    await this.chamar(`/workflows/${encodeURIComponent(id)}/deactivate`, { method: "POST" });
  }

  async apagarWorkflow(id: string): Promise<void> {
    await this.chamar(`/workflows/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  /**
   * `loadWorkflow: true` é o ponto inteiro desta operação.
   *
   * Sem ele, o n8n reexecuta a versão do workflow que estava salva NO MOMENTO
   * daquela execução — o que testa o passado, não a correção que você acabou
   * de fazer. Com ele, reexecuta o caso real contra a versão atual, que é o
   * teste que alguém de fato quer ao consertar um fluxo.
   *
   * A API pública do n8n não tem endpoint de disparar execução nova com
   * payload arbitrário (verificado no `openapi.yml` da instância, 2026-08-19);
   * este é o mecanismo de teste disponível, e é melhor que payload inventado.
   */
  async reexecutarExecucao(id: string): Promise<void> {
    await this.chamar(`/executions/${encodeURIComponent(id)}/retry`, {
      method: "POST",
      body: JSON.stringify({ loadWorkflow: true }),
    });
  }
}
