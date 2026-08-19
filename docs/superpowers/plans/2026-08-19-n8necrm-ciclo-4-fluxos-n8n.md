# n8necrm — Ciclo 4 (Fluxos n8n) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma tela **Fluxos** no CRM que lista, diagnostica e opera os workflows da instância n8n em `n8n.nateksoft.com`, com o editor do n8n embutido num iframe.

**Architecture:** Módulo `automation` em `src/modules/`, seguindo a estrutura que `gateway/` e `fila/` já usam (`tipos.ts` sem dependência de servidor + adapter concreto + `index.ts` com singleton preguiçoso). Toda chamada à API do n8n sai do servidor; a chave nunca chega ao navegador. Ações destrutivas passam por confirmação por digitação e gravam em `AuditLog`.

**Tech Stack:** Next.js 16.3, React 19.2, Zod 4, Vitest 4, Tailwind 4, shadcn (Base UI), Prisma 7.

**Spec:** `docs/superpowers/specs/2026-08-19-ciclo-4-fluxos-n8n-design.md`

## Global Constraints

Valem para toda tarefa. Não repetidas em cada uma.

- **Idioma do código é português.** Nomes de arquivo, funções, variáveis, testes e comentários seguem o que a base faz (`publicarTurno`, `obterGateway`, `tipos.ts`).
- **Comentário explica POR QUE, com evidência.** Comentário que só reafirma o código não passa em revisão aqui.
- **`N8N_API_KEY` nunca chega ao navegador.** Nenhum componente cliente a recebe, nem por prop, nem embutida em payload RSC. Toda chamada sai de código de servidor.
- **Validação de env é PREGUIÇOSA**, dentro da função que usa, nunca em escopo de módulo. Validar no topo já derrubou o build deste projeto uma vez (ver `src/modules/whatsapp/gateway/index.ts`).
- **A instância n8n é de PRODUÇÃO**, com 6 workflows ativos atendendo clientes reais. Nenhum passo deste plano ativa, desativa, apaga ou reexecuta nada contra ela. Todo teste usa `fetch` mockado.
- **Nenhum segredo entra no repositório.** `.env.example` recebe nome e comentário, nunca valor.
- **`src/core/` não importa de `src/modules/`.** É regra de ESLint (`no-restricted-imports`), não convenção.
- **Toda mensagem de commit termina com:**
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **Branch de trabalho: `ciclo-4-fluxos`**, criada a partir de `ciclo-0-fundacao`. Não commitar na `main`.
- **Provar, não presumir.** Todo critério fecha com o comando executado e a saída obtida.

## Estado já pronto — não refazer

Verificado em 2026-08-19:

- `N8N_API_URL` e `N8N_API_KEY` já estão no `.env` local e a chave responde HTTP 200
- nginx da VPS já serve `Content-Security-Policy: frame-ancestors 'self' http://localhost:3000` no bloco do n8n, sem `X-Frame-Options`
- `N8N_SAMESITE_COOKIE=none` já aplicado e confirmado dentro do container
- O enum de `modulos` em `config/client.schema.ts` **já inclui `"automation"`** — não há schema a mudar

---

### Task 1: Cliente da API do n8n

**Files:**
- Create: `src/modules/automation/n8n/tipos.ts`
- Create: `src/modules/automation/n8n/cliente.ts`
- Create: `src/modules/automation/n8n/index.ts`
- Test: `tests/unit/n8n-cliente.test.ts`

**Interfaces:**
- Consumes: nada de tarefas anteriores.
- Produces:
  - `type StatusExecucao = "success" | "error" | "waiting" | "running" | "canceled" | "crashed" | "new" | "unknown"`
  - `interface WorkflowResumo { id: string; nome: string; ativo: boolean; nos: number; tags: string[]; atualizadoEm: string }`
  - `interface Execucao { id: string; workflowId: string; status: StatusExecucao; modo: string; iniciadoEm: string; terminadoEm: string | null }`
  - `interface PaginaExecucoes { itens: Execucao[]; proximoCursor: string | null }`
  - `class ErroN8n extends Error { readonly tipo: "inalcancavel" | "nao_autorizado" | "nao_encontrado" | "recusado" }`
  - `interface ClienteN8n` com `listarWorkflows()`, `buscarWorkflow(id)`, `listarExecucoes(opcoes)`, `ativarWorkflow(id)`, `desativarWorkflow(id)`, `apagarWorkflow(id)`, `reexecutarExecucao(id)`
  - `export const clienteN8n: ClienteN8n` (Proxy preguiçoso, mesmo padrão de `whatsappGateway`)

**Por que `ErroN8n` com `tipo` em vez de deixar o erro cru subir:** a tela precisa distinguir "instância fora do ar", "chave inválida" e "workflow sumiu". Sem essa distinção, os três viram lista vazia — que é indistinguível de "não há fluxos", e é o modo de falha mais caro de diagnosticar.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/unit/n8n-cliente.test.ts`:

```ts
// Testa o adapter contra `fetch` mockado. NUNCA contra a instância real:
// n8n.nateksoft.com atende clientes em produção, e este arquivo exercita
// ativar/desativar/apagar.
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

process.env.N8N_API_URL = "https://n8n.exemplo.invalid";
process.env.N8N_API_KEY = "chave-de-teste";

const { ClienteN8nHttp, ErroN8n } = await import("../../src/modules/automation/n8n/cliente");

function resposta(corpo: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => corpo, text: async () => JSON.stringify(corpo) };
}

const cliente = () => new ClienteN8nHttp({ baseUrl: "https://n8n.exemplo.invalid", apiKey: "chave-de-teste" });

describe("ClienteN8nHttp", () => {
  beforeEach(() => fetchMock.mockReset());

  it("lista workflows normalizando o formato bruto da API", async () => {
    fetchMock.mockResolvedValueOnce(
      resposta({
        data: [
          { id: "abc", name: "Noiva Inteligente", active: true, nodes: [{}, {}, {}], tags: [{ name: "prod" }], updatedAt: "2026-08-19T21:00:00.000Z" },
        ],
      })
    );

    const workflows = await cliente().listarWorkflows();

    expect(workflows).toEqual([
      { id: "abc", nome: "Noiva Inteligente", ativo: true, nos: 3, tags: ["prod"], atualizadoEm: "2026-08-19T21:00:00.000Z" },
    ]);
  });

  it("manda a chave no header X-N8N-API-KEY, nunca na URL", async () => {
    fetchMock.mockResolvedValueOnce(resposta({ data: [] }));

    await cliente().listarWorkflows();

    const [url, opcoes] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).not.toContain("chave-de-teste");
    expect((opcoes as RequestInit).headers).toMatchObject({ "X-N8N-API-KEY": "chave-de-teste" });
  });

  it("devolve o cursor de paginação das execuções", async () => {
    fetchMock.mockResolvedValueOnce(
      resposta({
        data: [{ id: "1", workflowId: "abc", status: "success", mode: "webhook", startedAt: "2026-08-19T21:00:00.000Z", stoppedAt: "2026-08-19T21:00:02.000Z" }],
        nextCursor: "cursor-2",
      })
    );

    const pagina = await cliente().listarExecucoes({ workflowId: "abc", limite: 20 });

    expect(pagina.proximoCursor).toBe("cursor-2");
    expect(pagina.itens[0]).toEqual({
      id: "1",
      workflowId: "abc",
      status: "success",
      modo: "webhook",
      iniciadoEm: "2026-08-19T21:00:00.000Z",
      terminadoEm: "2026-08-19T21:00:02.000Z",
    });
  });

  it("status desconhecido vira 'unknown' em vez de estourar", async () => {
    fetchMock.mockResolvedValueOnce(
      resposta({ data: [{ id: "1", workflowId: "abc", status: "inventado_no_futuro", mode: "trigger", startedAt: "2026-08-19T21:00:00.000Z", stoppedAt: null }] })
    );

    const pagina = await cliente().listarExecucoes({});

    expect(pagina.itens[0]?.status).toBe("unknown");
  });

  it("reexecutar manda loadWorkflow: true — reexecuta contra a versão ATUAL do fluxo", async () => {
    fetchMock.mockResolvedValueOnce(resposta({ id: "99" }));

    await cliente().reexecutarExecucao("42");

    const [url, opcoes] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://n8n.exemplo.invalid/api/v1/executions/42/retry");
    expect((opcoes as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((opcoes as RequestInit).body))).toEqual({ loadWorkflow: true });
  });

  it("HTTP 401 vira ErroN8n tipo 'nao_autorizado'", async () => {
    fetchMock.mockResolvedValueOnce(resposta({ message: "unauthorized" }, 401));

    await expect(cliente().listarWorkflows()).rejects.toMatchObject({ tipo: "nao_autorizado" });
  });

  it("HTTP 404 vira ErroN8n tipo 'nao_encontrado'", async () => {
    fetchMock.mockResolvedValueOnce(resposta({ message: "not found" }, 404));

    await expect(cliente().buscarWorkflow("sumiu")).rejects.toMatchObject({ tipo: "nao_encontrado" });
  });

  it("falha de rede vira ErroN8n tipo 'inalcancavel', não o erro cru do fetch", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    const erro = await cliente().listarWorkflows().catch((e) => e);

    expect(erro).toBeInstanceOf(ErroN8n);
    expect(erro.tipo).toBe("inalcancavel");
  });

  it("a mensagem do erro nunca contém a chave da API", async () => {
    fetchMock.mockResolvedValueOnce(resposta({ message: "boom" }, 500));

    const erro = await cliente().listarWorkflows().catch((e) => e);

    expect(String(erro.message)).not.toContain("chave-de-teste");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/n8n-cliente.test.ts
```

Esperado: FALHA por resolução de módulo — `src/modules/automation/n8n/cliente` ainda não existe. Guarde a saída: é a evidência RED.

- [ ] **Step 3: Criar `src/modules/automation/n8n/tipos.ts`**

```ts
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
```

- [ ] **Step 4: Criar `src/modules/automation/n8n/cliente.ts`**

```ts
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
```

- [ ] **Step 5: Criar `src/modules/automation/n8n/index.ts`**

```ts
import "server-only";

import { z } from "zod";

import { ClienteN8nHttp } from "./cliente";
import type { ClienteN8n } from "./tipos";

export { ErroN8n } from "./cliente";
export type {
  ClienteN8n,
  Execucao,
  OpcoesListarExecucoes,
  PaginaExecucoes,
  StatusExecucao,
  WorkflowResumo,
} from "./tipos";

const envSchema = z.object({
  N8N_API_URL: z.string().url({
    message: "N8N_API_URL ausente ou inválida — defina no .env (ex.: https://n8n.nateksoft.com)",
  }),
  N8N_API_KEY: z.string().min(1, {
    message: "N8N_API_KEY ausente — defina no .env (n8n → Settings → n8n API)",
  }),
});

function lerEnv() {
  const resultado = envSchema.safeParse({
    N8N_API_URL: process.env.N8N_API_URL,
    N8N_API_KEY: process.env.N8N_API_KEY,
  });
  if (!resultado.success) {
    // O NOME da variável entra à força: com valor `undefined` o Zod falha na
    // checagem de tipo e nunca chega ao `.url()`/`.min()`, então a mensagem
    // customizada não aparece e sobra "expected string, received undefined"
    // sem dizer qual variável. Mesma armadilha documentada em
    // `whatsapp/gateway/index.ts`.
    const detalhes = resultado.error.issues
      .map((i) => `${i.path.join(".") || "(desconhecida)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Configuração do módulo de automação inválida: ${detalhes}`);
  }
  return resultado.data;
}

let instancia: ClienteN8n | null = null;

/**
 * Construção preguiçosa, no primeiro USO e não na importação.
 *
 * `next build` avalia cada módulo alcançável para coletar configuração de
 * rota. Validar env no escopo do módulo faz a validação rodar em tempo de
 * build, onde variável de integração não tem por que existir — foi assim que
 * o deploy deste projeto quebrou por três dias em 2026-08-07, pelo módulo do
 * WhatsApp. O erro continua estrito; só mudou de momento.
 */
function obterCliente(): ClienteN8n {
  if (instancia) return instancia;
  const env = lerEnv();
  instancia = new ClienteN8nHttp({ baseUrl: env.N8N_API_URL, apiKey: env.N8N_API_KEY });
  return instancia;
}

export const clienteN8n: ClienteN8n = new Proxy({} as ClienteN8n, {
  get(_alvo, propriedade) {
    const real = obterCliente() as unknown as Record<string | symbol, unknown>;
    const valor = real[propriedade];
    return typeof valor === "function" ? valor.bind(real) : valor;
  },
});
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/n8n-cliente.test.ts
```

Esperado: PASS, 9 testes. Guarde a saída: é a evidência GREEN.

- [ ] **Step 7: Typecheck e commit**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npm run typecheck
git add src/modules/automation tests/unit/n8n-cliente.test.ts
git commit -m "feat(automation): cliente da API publica do n8n

Estrutura espelha gateway/ e fila/: tipos sem server-only, adapter HTTP
concreto, index com singleton preguicoso.

ErroN8n carrega o TIPO separado da mensagem para a tela distinguir
instancia fora do ar, chave invalida e recurso sumido -- os tres viram
lista vazia sem isso, e lista vazia e indistinguivel de nao ha fluxos.

reexecutarExecucao manda loadWorkflow: true: reexecuta o caso real contra a
versao ATUAL do fluxo. A API publica nao tem endpoint de disparar execucao
nova com payload proprio (verificado no openapi.yml da instancia).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Permissão `gerenciar_fluxos` e auditoria

**Files:**
- Modify: `src/core/auth/permissions.ts`
- Modify: `src/core/audit/alerta.ts` (constante `ACOES_SENSIVEIS`)
- Test: `tests/unit/permissions.test.ts` (existente)
- Test: `tests/unit/alerta-atividade.test.ts` (existente — conferir, pode não precisar de mudança)

**Interfaces:**
- Consumes: nada da Task 1.
- Produces: `"gerenciar_fluxos"` como membro do tipo `Acao`, presente **apenas** em `ADMIN`. A Task 3 chama `hasPermission(papel, "gerenciar_fluxos")`.

**Por que ADMIN apenas:** o mesmo raciocínio que já está escrito em `gerenciar_funil` no próprio arquivo — desativar um fluxo derruba o atendimento de um cliente inteiro, e alargar depois é fácil, estreitar depois de estragar não é.

- [ ] **Step 1: Rodar o teste existente para ter a linha de base**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/permissions.test.ts tests/unit/alerta-atividade.test.ts
```

Esperado: PASS. Se falhar aqui, o problema é anterior à sua mudança — pare e reporte.

- [ ] **Step 2: Acrescentar a ação ao tipo e à matriz**

Em `src/core/auth/permissions.ts`, acrescentar ao union `Acao`, depois de `"gerenciar_funil"`:

```ts
  /**
   * Ativar, desativar e apagar workflows na instância n8n, e reexecutar uma
   * execução passada.
   *
   * ADMIN apenas, pelo mesmo motivo de `gerenciar_funil`, mas com o custo do
   * erro maior: a instância n8n deste projeto atende CLIENTES REAIS — em
   * 2026-08-19 eram 6 workflows ativos, um deles executando a cada poucos
   * segundos por webhook. Desativar um fluxo pela tela derruba o WhatsApp de
   * um cliente pagante, e nada no CRM avisa esse cliente.
   */
  | "gerenciar_fluxos";
```

E acrescentar `"gerenciar_fluxos"` **somente** à lista de `ADMIN` na `matriz`.

- [ ] **Step 3: Acrescentar as ações destrutivas à detecção de rajada**

Em `src/core/audit/alerta.ts`, acrescentar a `ACOES_SENSIVEIS`:

```ts
  "desativar_fluxo",
  "apagar_fluxo",
```

E, no comentário de bloco logo acima da constante, acrescentar a justificativa no mesmo tom das que já estão lá:

```
 * `desativar_fluxo` e `apagar_fluxo` entram: cada um derruba o atendimento de
 * um cliente inteiro, e a instância n8n é compartilhada por vários. Uma
 * rajada aqui é o cenário exato que a detecção existe para pegar.
 *
 * `ativar_fluxo` e `reexecutar_execucao` ficam de fora: religar é reparo, e
 * reexecutar um caso real é diagnóstico — nenhum dos dois destrói nada.
```

- [ ] **Step 4: Acrescentar o caso ao teste de permissões**

Em `tests/unit/permissions.test.ts`, acrescentar ao bloco existente:

```ts
  it("gerenciar_fluxos e exclusiva de ADMIN — derruba atendimento de cliente", () => {
    expect(hasPermission("ADMIN", "gerenciar_fluxos")).toBe(true);
    expect(hasPermission("GESTOR", "gerenciar_fluxos")).toBe(false);
    expect(hasPermission("VENDEDOR", "gerenciar_fluxos")).toBe(false);
  });
```

- [ ] **Step 5: Rodar os dois testes**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/permissions.test.ts tests/unit/alerta-atividade.test.ts
```

Esperado: PASS. Se `alerta-atividade.test.ts` afirmar o **tamanho** de `ACOES_SENSIVEIS` ou a lista literal, ele vai falhar — nesse caso ajuste o teste para incluir as duas ações novas, **não** remova as ações da constante.

- [ ] **Step 6: Commit**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git add src/core/auth/permissions.ts src/core/audit/alerta.ts tests/unit/permissions.test.ts
git commit -m "feat(auth): permissao gerenciar_fluxos, exclusiva de ADMIN

E desativar_fluxo/apagar_fluxo entram em ACOES_SENSIVEIS: cada um derruba o
atendimento de um cliente inteiro, e a instancia n8n e compartilhada por
varios. ativar_fluxo e reexecutar_execucao ficam de fora -- religar e
reparo, reexecutar e diagnostico.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Server actions com auditoria

**Files:**
- Create: `src/modules/automation/actions.ts`
- Test: `tests/unit/automation-actions.test.ts`

**Interfaces:**
- Consumes: `clienteN8n` e `ErroN8n` (Task 1); `hasPermission(papel, "gerenciar_fluxos")` (Task 2).
- Produces, todas devolvendo `Promise<ResultadoAcao>`:
  - `ativarFluxoAction(id: string, nome: string)`
  - `desativarFluxoAction(id: string, nome: string)`
  - `apagarFluxoAction(id: string, nome: string)`
  - `reexecutarExecucaoAction(execucaoId: string, workflowId: string)`

**Por que o `nome` entra por parâmetro:** ele vai para o `AuditLog`. O workflow pode ser apagado logo em seguida, e aí o id sozinho não conta a história — "quem apagou o fluxo do cliente" precisa do nome legível na linha de auditoria, não de um id que não resolve mais.

**Por que devolver `ResultadoAcao` em vez de lançar:** é o contrato que a base já usa (`src/lib/acao.ts`), e o motivo está escrito lá — a UI precisa distinguir "não fez" de "fez e não gravou".

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/unit/automation-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const usuarioAtualMock = vi.fn();
vi.mock("@/core/auth/session", () => ({ usuarioAtual: () => usuarioAtualMock() }));

const registrarAuditoriaMock = vi.fn();
vi.mock("@/core/audit/log", () => ({ registrarAuditoria: (...a: unknown[]) => registrarAuditoriaMock(...a) }));

const clienteMock = {
  ativarWorkflow: vi.fn(),
  desativarWorkflow: vi.fn(),
  apagarWorkflow: vi.fn(),
  reexecutarExecucao: vi.fn(),
};
class ErroN8nFake extends Error {
  constructor(msg: string, readonly tipo: string) {
    super(msg);
    this.name = "ErroN8n";
  }
}
vi.mock("@/modules/automation/n8n", () => ({ clienteN8n: clienteMock, ErroN8n: ErroN8nFake }));

const acoes = await import("../../src/modules/automation/actions");

const ADMIN = { id: "u1", papel: "ADMIN" };
const GESTOR = { id: "u2", papel: "GESTOR" };

describe("actions do modulo automation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usuarioAtualMock.mockResolvedValue(ADMIN);
  });

  it("desativar chama o n8n e grava auditoria com o NOME, nao so o id", async () => {
    clienteMock.desativarWorkflow.mockResolvedValueOnce(undefined);

    const r = await acoes.desativarFluxoAction("wf-1", "Noiva Inteligente");

    expect(r).toEqual({ ok: true });
    expect(clienteMock.desativarWorkflow).toHaveBeenCalledWith("wf-1");
    expect(registrarAuditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        acao: "desativar_fluxo",
        entidade: "N8nWorkflow",
        entidadeId: "wf-1",
        antes: { nome: "Noiva Inteligente", ativo: true },
        depois: { nome: "Noiva Inteligente", ativo: false },
      })
    );
  });

  it("GESTOR e recusado e NADA e chamado no n8n", async () => {
    usuarioAtualMock.mockResolvedValue(GESTOR);

    const r = await acoes.desativarFluxoAction("wf-1", "Noiva Inteligente");

    expect(r.ok).toBe(false);
    expect(clienteMock.desativarWorkflow).not.toHaveBeenCalled();
    expect(registrarAuditoriaMock).not.toHaveBeenCalled();
  });

  it("apagar grava auditoria ANTES de nao poder mais ler o workflow", async () => {
    clienteMock.apagarWorkflow.mockResolvedValueOnce(undefined);

    await acoes.apagarFluxoAction("wf-9", "Barbearia BOX64");

    expect(registrarAuditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({ acao: "apagar_fluxo", entidadeId: "wf-9", antes: { nome: "Barbearia BOX64" } })
    );
  });

  it("se o n8n recusa, NAO grava auditoria de sucesso", async () => {
    clienteMock.desativarWorkflow.mockRejectedValueOnce(new ErroN8nFake("recusou", "recusado"));

    const r = await acoes.desativarFluxoAction("wf-1", "X");

    expect(r.ok).toBe(false);
    expect(registrarAuditoriaMock).not.toHaveBeenCalled();
  });

  it("instancia fora do ar vira mensagem legivel, nao erro cru", async () => {
    clienteMock.ativarWorkflow.mockRejectedValueOnce(new ErroN8nFake("timeout", "inalcancavel"));

    const r = await acoes.ativarFluxoAction("wf-1", "X");

    expect(r).toEqual({ ok: false, erro: expect.stringContaining("n8n") });
  });

  it("reexecutar nao exige permissao de gerenciar — e diagnostico, nao destruicao", async () => {
    usuarioAtualMock.mockResolvedValue(GESTOR);
    clienteMock.reexecutarExecucao.mockResolvedValueOnce(undefined);

    const r = await acoes.reexecutarExecucaoAction("exec-1", "wf-1");

    expect(r).toEqual({ ok: true });
    expect(clienteMock.reexecutarExecucao).toHaveBeenCalledWith("exec-1");
  });

  it("sessao invalida vira mensagem de sessao, nao erro cru", async () => {
    usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));

    const r = await acoes.desativarFluxoAction("wf-1", "X");

    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/automation-actions.test.ts
```

Esperado: FALHA por módulo inexistente. Evidência RED.

- [ ] **Step 3: Criar `src/modules/automation/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";

import { registrarAuditoria } from "@/core/audit/log";
import { hasPermission } from "@/core/auth/permissions";
import { usuarioAtual } from "@/core/auth/session";
import { ehSessaoInvalida, MENSAGEM_SESSAO_INVALIDA, type ResultadoAcao } from "@/lib/acao";
import { clienteN8n, ErroN8n } from "@/modules/automation/n8n";

/**
 * Mora em `src/modules/automation/`, não em `src/core/`: automação é módulo
 * opcional, ligado por `config/client.ts`. A regra de ESLint
 * (`no-restricted-imports` em `src/core/**`) faz essa fronteira valer — o
 * import de `@/core/*` daqui é a direção permitida, nunca o contrário.
 *
 * `usuarioAtual()` é a única fonte de "quem está agindo". Server Action é
 * endpoint HTTP público: um id vindo do formulário seria forjável.
 */

const ENTIDADE = "N8nWorkflow";

/** Traduz o erro para algo que dá para mostrar, sem vazar chave nem rastro. */
function mensagemDeErro(erro: unknown): string {
  if (ehSessaoInvalida(erro)) return MENSAGEM_SESSAO_INVALIDA;
  if (erro instanceof ErroN8n) {
    switch (erro.tipo) {
      case "inalcancavel":
        return "Não foi possível falar com o n8n. A instância pode estar fora do ar.";
      case "nao_autorizado":
        return "O n8n recusou a chave de API do CRM. Verifique N8N_API_KEY.";
      case "nao_encontrado":
        return "Esse fluxo não existe mais no n8n. Recarregue a lista.";
      default:
        return "O n8n recusou a operação. Veja os logs da instância.";
    }
  }
  console.error("Erro inesperado numa action de automação:", erro);
  return "Não foi possível concluir a operação.";
}

/**
 * Guarda comum das operações destrutivas.
 *
 * A ordem importa e é deliberada: **permissão, depois n8n, depois auditoria.**
 * Auditar antes de o n8n confirmar produziria linha de auditoria para operação
 * que não aconteceu — pior que não auditar, porque parece verdade.
 */
async function operar(
  acao: string,
  entidadeId: string,
  executar: () => Promise<void>,
  registro: { antes?: unknown; depois?: unknown }
): Promise<ResultadoAcao> {
  try {
    const usuario = await usuarioAtual();
    if (!hasPermission(usuario.papel, "gerenciar_fluxos")) {
      return { ok: false, erro: "Você não tem permissão para gerenciar fluxos." };
    }

    await executar();

    await registrarAuditoria({
      userId: usuario.id,
      acao,
      entidade: ENTIDADE,
      entidadeId,
      antes: registro.antes,
      depois: registro.depois,
    });

    revalidatePath("/(painel)", "layout");
    return { ok: true };
  } catch (erro) {
    return { ok: false, erro: mensagemDeErro(erro) };
  }
}

export async function ativarFluxoAction(id: string, nome: string): Promise<ResultadoAcao> {
  return operar("ativar_fluxo", id, () => clienteN8n.ativarWorkflow(id), {
    antes: { nome, ativo: false },
    depois: { nome, ativo: true },
  });
}

export async function desativarFluxoAction(id: string, nome: string): Promise<ResultadoAcao> {
  return operar("desativar_fluxo", id, () => clienteN8n.desativarWorkflow(id), {
    antes: { nome, ativo: true },
    depois: { nome, ativo: false },
  });
}

/**
 * `antes: { nome }` sem `depois` — o workflow deixou de existir.
 *
 * O nome vem por parâmetro e não de uma leitura no n8n porque, depois do
 * DELETE, não há de onde reconstituí-lo: o id sozinho não conta a história de
 * "quem apagou o fluxo de qual cliente". Mesmo raciocínio de `excluirEtapa`
 * em `core/pipeline/service.ts`.
 */
export async function apagarFluxoAction(id: string, nome: string): Promise<ResultadoAcao> {
  return operar("apagar_fluxo", id, () => clienteN8n.apagarWorkflow(id), { antes: { nome } });
}

/**
 * Reexecutar NÃO exige `gerenciar_fluxos`, de propósito.
 *
 * É diagnóstico, não destruição: reexecuta um caso que já aconteceu, contra a
 * versão atual do fluxo. Exigir permissão de ADMIN aqui tiraria de GESTOR a
 * única ferramenta de "isso ainda quebra?" sem dar nenhuma segurança em troca
 * — quem pode ver a execução já pode ver o que ela fez.
 *
 * Continua auditado, porque dispara trabalho real na instância do cliente.
 */
export async function reexecutarExecucaoAction(
  execucaoId: string,
  workflowId: string
): Promise<ResultadoAcao> {
  try {
    const usuario = await usuarioAtual();

    await clienteN8n.reexecutarExecucao(execucaoId);

    await registrarAuditoria({
      userId: usuario.id,
      acao: "reexecutar_execucao",
      entidade: "N8nExecucao",
      entidadeId: execucaoId,
      depois: { workflowId },
    });

    revalidatePath("/(painel)", "layout");
    return { ok: true };
  } catch (erro) {
    return { ok: false, erro: mensagemDeErro(erro) };
  }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/automation-actions.test.ts
```

Esperado: PASS, 7 testes. Evidência GREEN.

- [ ] **Step 5: Typecheck e commit**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npm run typecheck
git add src/modules/automation/actions.ts tests/unit/automation-actions.test.ts
git commit -m "feat(automation): server actions com auditoria

Ordem deliberada: permissao, depois n8n, depois auditoria. Auditar antes de
o n8n confirmar produziria linha para operacao que nao aconteceu -- pior que
nao auditar, porque parece verdade.

O nome do workflow entra por parametro e vai para o AuditLog: depois do
DELETE nao ha de onde reconstitui-lo, e o id sozinho nao conta quem apagou o
fluxo de qual cliente.

Reexecutar nao exige gerenciar_fluxos: e diagnostico, nao destruicao.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Tela de lista `/fluxos`

**Files:**
- Create: `src/modules/automation/queries.ts`
- Create: `src/app/(painel)/fluxos/page.tsx`
- Create: `src/components/automation/fluxos-table.tsx`
- Create: `src/components/automation/status-fluxo.tsx`
- Modify: `config/client.ts` (acrescentar `"automation"` a `modulos`)
- Modify: o componente de navegação do painel (procurar por onde `/conversas` entra no menu — provavelmente `src/components/painel-nav.tsx`, confirmar com `grep -rn "conversas" src/components/`)
- Test: `tests/unit/fluxos-table.test.tsx`

**Interfaces:**
- Consumes: `clienteN8n`, `WorkflowResumo`, `ErroN8n` (Task 1).
- Produces: `listarFluxos(): Promise<{ ok: true; fluxos: WorkflowResumo[] } | { ok: false; motivo: "inalcancavel" | "nao_autorizado" | "recusado" }>` em `queries.ts`, consumido pela Task 5.

**Por que a query devolve um resultado em vez de lançar:** a página precisa renderizar um estado de erro específico, e não um 500. "O n8n está fora do ar" é informação útil; uma tela de erro genérica não é.

- [ ] **Step 1: Escrever o teste da tabela**

Criar `tests/unit/fluxos-table.test.tsx`. Siga o padrão de `tests/unit/etapas-table.test.tsx` (leia-o antes) para render e queries de Testing Library.

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/modules/automation/actions", () => ({
  ativarFluxoAction: vi.fn(),
  desativarFluxoAction: vi.fn(),
  apagarFluxoAction: vi.fn(),
}));

import { FluxosTable } from "../../src/components/automation/fluxos-table";

const fluxos = [
  { id: "a", nome: "Noiva Inteligente", ativo: true, nos: 65, tags: ["prod"], atualizadoEm: "2026-08-19T21:00:00.000Z" },
  { id: "b", nome: "My workflow", ativo: false, nos: 11, tags: [], atualizadoEm: "2026-08-10T10:00:00.000Z" },
];

describe("FluxosTable", () => {
  it("mostra nome, contagem de nos e o estado de cada fluxo", () => {
    render(<FluxosTable fluxos={fluxos} podeGerenciar={true} />);

    expect(screen.getByText("Noiva Inteligente")).toBeInTheDocument();
    expect(screen.getByText("65")).toBeInTheDocument();
    expect(screen.getByText("Ativo")).toBeInTheDocument();
    expect(screen.getByText("Desligado")).toBeInTheDocument();
  });

  it("sem permissao de gerenciar, nao renderiza nenhum botao de acao destrutiva", () => {
    render(<FluxosTable fluxos={fluxos} podeGerenciar={false} />);

    expect(screen.queryByRole("button", { name: /desativar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /apagar/i })).not.toBeInTheDocument();
  });

  it("com permissao, o fluxo ativo oferece desativar e o desligado oferece ativar", () => {
    render(<FluxosTable fluxos={fluxos} podeGerenciar={true} />);

    expect(screen.getByRole("button", { name: /desativar/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ativar/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/fluxos-table.test.tsx
```

Esperado: FALHA por módulo inexistente.

- [ ] **Step 3: Criar `src/modules/automation/queries.ts`**

```ts
import "server-only";

import { clienteN8n, ErroN8n, type WorkflowResumo } from "./n8n";

import type { Execucao } from "./n8n";

/** Um fluxo com a execução mais recente dele já anexada, para a lista. */
export interface FluxoComUltimaExecucao extends WorkflowResumo {
  ultimaExecucao: Execucao | null;
}

export type ResultadoFluxos =
  | { ok: true; fluxos: FluxoComUltimaExecucao[] }
  | { ok: false; motivo: "inalcancavel" | "nao_autorizado" | "nao_encontrado" | "recusado" };

/**
 * Devolve resultado em vez de lançar.
 *
 * A tela de fluxos é para onde alguém corre quando algo já está errado — se
 * ela mesma virar um 500 genérico, o diagnóstico morre junto. "A instância
 * está fora do ar" é informação; tela de erro genérica não é.
 */
export async function listarFluxos(): Promise<ResultadoFluxos> {
  try {
    const fluxos = await clienteN8n.listarWorkflows();

    // DUAS chamadas no total, não uma por fluxo.
    //
    // A lista precisa mostrar a última execução de cada fluxo, e o caminho
    // ingênuo — `listarExecucoes({ workflowId })` dentro do laço — seria N+1
    // requisições contra uma instância que atende clientes em produção. Uma
    // página de execuções recentes cobre todos os fluxos que rodaram algo
    // ultimamente, que é exatamente o que interessa nesta tela; fluxo parado
    // há muito tempo simplesmente aparece sem última execução, e isso é
    // informação verdadeira, não lacuna.
    const recentes = await clienteN8n.listarExecucoes({ limite: 100 });
    const ultimaPorFluxo = new Map<string, Execucao>();
    for (const execucao of recentes.itens) {
      // `listarExecucoes` já vem do n8n em ordem decrescente, então a
      // PRIMEIRA que aparece para cada workflow é a mais recente.
      if (!ultimaPorFluxo.has(execucao.workflowId)) ultimaPorFluxo.set(execucao.workflowId, execucao);
    }

    const comExecucao: FluxoComUltimaExecucao[] = fluxos.map((fluxo) => ({
      ...fluxo,
      ultimaExecucao: ultimaPorFluxo.get(fluxo.id) ?? null,
    }));

    // Ativos primeiro, depois alfabético: quem abre esta tela quer ver
    // primeiro o que está no ar atendendo cliente.
    comExecucao.sort(
      (a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome, "pt-BR")
    );
    return { ok: true, fluxos: comExecucao };
  } catch (erro) {
    if (erro instanceof ErroN8n) return { ok: false, motivo: erro.tipo };
    throw erro;
  }
}
```

**Consequência para `FluxosTable`:** a prop `fluxos` passa a ser
`FluxoComUltimaExecucao[]`, e a tabela ganha uma coluna "Última execução" que
mostra o status e o horário, ou `—` quando `ultimaExecucao` é `null`. Ajuste os
dados do teste do Step 1 para incluir o campo.

- [ ] **Step 4: Criar `src/components/automation/status-fluxo.tsx`**

```tsx
import { Badge } from "@/components/ui/badge";

/**
 * "Desligado" e não "Inativo": um fluxo desligado é um estado que alguém
 * escolheu, e a palavra precisa deixar claro que não é defeito nem erro.
 */
export function StatusFluxo({ ativo }: { ativo: boolean }) {
  return ativo ? <Badge>Ativo</Badge> : <Badge variant="secondary">Desligado</Badge>;
}
```

- [ ] **Step 5: Criar `src/components/automation/fluxos-table.tsx`**

Componente cliente. Leia `src/components/pipeline/etapas-table.tsx` antes, para seguir o mesmo uso de `Table`, `toast` (sonner) e tratamento de `ResultadoAcao`.

```tsx
"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";

import { StatusFluxo } from "@/components/automation/status-fluxo";
import { ConfirmarDialogo } from "@/components/confirmar-dialogo";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatarDataHoraBR } from "@/lib/date";
import { ativarFluxoAction, desativarFluxoAction } from "@/modules/automation/actions";
import type { WorkflowResumo } from "@/modules/automation/n8n/tipos";

export function FluxosTable({
  fluxos,
  podeGerenciar,
}: {
  fluxos: WorkflowResumo[];
  podeGerenciar: boolean;
}) {
  const [pendente, iniciar] = useTransition();

  function alternar(fluxo: WorkflowResumo) {
    iniciar(async () => {
      const acao = fluxo.ativo ? desativarFluxoAction : ativarFluxoAction;
      const r = await acao(fluxo.id, fluxo.nome);
      if (r.ok) toast.success(fluxo.ativo ? `"${fluxo.nome}" desativado.` : `"${fluxo.nome}" ativado.`);
      else toast.error(r.erro);
    });
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Fluxo</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead>Nós</TableHead>
          <TableHead>Atualizado</TableHead>
          {podeGerenciar ? <TableHead className="text-right">Ações</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {fluxos.map((fluxo) => (
          <TableRow key={fluxo.id}>
            <TableCell>
              <Link href={`/fluxos/${fluxo.id}`} className="font-medium hover:underline">
                {fluxo.nome}
              </Link>
            </TableCell>
            <TableCell>
              <StatusFluxo ativo={fluxo.ativo} />
            </TableCell>
            <TableCell>{fluxo.nos}</TableCell>
            <TableCell>{fluxo.atualizadoEm ? formatarDataHoraBR(new Date(fluxo.atualizadoEm)) : "—"}</TableCell>
            {podeGerenciar ? (
              <TableCell className="text-right">
                <ConfirmarDialogo
                  gatilho={(abrir) => (
                    <Button variant="outline" size="sm" onClick={abrir} disabled={pendente}>
                      {fluxo.ativo ? "Desativar" : "Ativar"}
                    </Button>
                  )}
                  titulo={fluxo.ativo ? `Desativar "${fluxo.nome}"?` : `Ativar "${fluxo.nome}"?`}
                  descricao={
                    fluxo.ativo
                      ? "O fluxo para de responder imediatamente. Se ele atende clientes por WhatsApp, as mensagens deixam de ser respondidas e ninguém é avisado."
                      : "O fluxo volta a responder imediatamente."
                  }
                  exigirDigitar={fluxo.ativo ? fluxo.nome : undefined}
                  rotuloConfirmar={fluxo.ativo ? "Desativar" : "Ativar"}
                  rotuloConfirmando="Aplicando…"
                  onConfirmar={() => alternar(fluxo)}
                />
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

**Nota para o implementador:** `exigirDigitar` **ainda não existe** em `ConfirmarDialogo`. Ele é adicionado na Task 5, Step 1. Se você estiver executando as tarefas em ordem, esta prop causará erro de tipo até lá — nesse caso, faça a Task 5 Step 1 antes deste passo e diga isso no relatório. **Não** invente um segundo componente de confirmação.

- [ ] **Step 6: Criar `src/app/(painel)/fluxos/page.tsx`**

```tsx
import { EmptyState } from "@/components/empty-state";
import { FluxosTable } from "@/components/automation/fluxos-table";
import { hasPermission } from "@/core/auth/permissions";
import { usuarioAtualOuLogin } from "@/core/auth/session";
import { exigirModulo } from "@/lib/module-gate";
import { listarFluxos } from "@/modules/automation/queries";

/**
 * Cada estado de falha do n8n tem texto próprio, e isso não é zelo:
 * "instância fora do ar", "chave recusada" e "lista vazia" exigem ações
 * completamente diferentes de quem lê, e os três seriam a mesma tela em
 * branco se o erro virasse lista vazia.
 */
const MOTIVOS: Record<string, { titulo: string; descricao: string }> = {
  inalcancavel: {
    titulo: "Não foi possível falar com o n8n",
    descricao: "A instância pode estar fora do ar ou o endereço em N8N_API_URL pode estar errado.",
  },
  nao_autorizado: {
    titulo: "O n8n recusou a chave do CRM",
    descricao: "Gere uma chave nova em n8n → Settings → n8n API e atualize N8N_API_KEY.",
  },
  nao_encontrado: {
    titulo: "Endpoint não encontrado no n8n",
    descricao: "A API pública pode estar desabilitada nesta instância.",
  },
  recusado: {
    titulo: "O n8n recusou a consulta",
    descricao: "Veja os logs da instância para entender o motivo.",
  },
};

export default async function FluxosPage() {
  exigirModulo("automation");

  const usuario = await usuarioAtualOuLogin();
  const resultado = await listarFluxos();

  if (!resultado.ok) {
    const m = MOTIVOS[resultado.motivo] ?? MOTIVOS.recusado;
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Fluxos</h1>
        <EmptyState titulo={m.titulo} descricao={m.descricao} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Fluxos</h1>
      {resultado.fluxos.length === 0 ? (
        <EmptyState titulo="Nenhum fluxo" descricao="Esta instância do n8n não tem workflow nenhum." />
      ) : (
        <FluxosTable
          fluxos={resultado.fluxos}
          podeGerenciar={hasPermission(usuario.papel, "gerenciar_fluxos")}
        />
      )}
    </div>
  );
}
```

**Confira a assinatura de `EmptyState`** antes de usar (`src/components/empty-state.tsx`) — as props podem não se chamar `titulo`/`descricao`. Ajuste a chamada ao que o componente de fato aceita; não mude o componente.

- [ ] **Step 7: Ligar o módulo e o menu**

Em `config/client.ts`, trocar `modulos: ["whatsapp"]` por `modulos: ["whatsapp", "automation"]`.

Descobrir o componente de navegação e acrescentar o link, seguindo exatamente o padrão do link de Conversas (que é gateado por módulo):

```bash
cd "d:/Projetos Programação/N8n + Crm"
grep -rn "conversas" src/components/ --include=*.tsx | head
```

O link de Fluxos deve aparecer só quando `moduloAtivo("automation")` for verdadeiro **e** o papel tiver `gerenciar_fluxos` — GESTOR e VENDEDOR não devem ver a entrada.

- [ ] **Step 8: Rodar os testes tocados**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/fluxos-table.test.tsx tests/unit/client-config.test.ts tests/unit/painel-nav.test.tsx tests/unit/nav-links.test.tsx
```

Esperado: PASS. Se `painel-nav` ou `nav-links` afirmarem a lista completa de links, eles vão falhar — acrescente Fluxos à expectativa, não remova o link.

- [ ] **Step 9: Typecheck e commit**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npm run typecheck
git add config/client.ts src/app/\(painel\)/fluxos src/components/automation src/modules/automation/queries.ts tests/unit/fluxos-table.test.tsx src/components
git commit -m "feat(automation): tela de lista de fluxos

A query devolve resultado em vez de lancar: a tela de fluxos e para onde
alguem corre quando algo ja esta errado, e um 500 generico mata o
diagnostico junto. Cada motivo de falha tem texto proprio, porque
inalcancavel, chave recusada e lista vazia exigem acoes diferentes de quem le.

Modulo automation ligado em config/client.ts.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Confirmação por digitação e tela de detalhe

**Files:**
- Modify: `src/components/confirmar-dialogo.tsx` (prop opcional `exigirDigitar`)
- Create: `src/app/(painel)/fluxos/[id]/page.tsx`
- Create: `src/components/automation/execucoes-table.tsx`
- Test: `tests/unit/confirmar-dialogo-digitar.test.tsx`

**Interfaces:**
- Consumes: `listarFluxos` (Task 4); `clienteN8n.listarExecucoes` e `buscarWorkflow` (Task 1); `reexecutarExecucaoAction` e `apagarFluxoAction` (Task 3).
- Produces: `ConfirmarDialogo` passa a aceitar `exigirDigitar?: string`. Quando presente, o botão de confirmar fica desabilitado até o texto digitado bater **exatamente**.

**Por que estender `ConfirmarDialogo` em vez de criar outro componente:** já existe um diálogo de confirmação usado por lead, nota, tarefa e agente. Um segundo componente com a mesma responsabilidade divergiria em aparência e comportamento na primeira mudança de qualquer um dos dois. A prop é opcional e não muda nenhum uso existente.

- [ ] **Step 1: Escrever o teste da confirmação por digitação**

Criar `tests/unit/confirmar-dialogo-digitar.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConfirmarDialogo } from "../../src/components/confirmar-dialogo";

function montar(onConfirmar = vi.fn()) {
  render(
    <ConfirmarDialogo
      gatilho={(abrir) => <button onClick={abrir}>abrir</button>}
      titulo="Apagar Noiva Inteligente?"
      descricao="Isso não tem volta."
      exigirDigitar="Noiva Inteligente"
      rotuloConfirmar="Apagar"
      rotuloConfirmando="Apagando…"
      onConfirmar={onConfirmar}
    />
  );
  return onConfirmar;
}

describe("ConfirmarDialogo com exigirDigitar", () => {
  it("comeca com o botao de confirmar desabilitado", async () => {
    montar();
    await userEvent.click(screen.getByText("abrir"));

    expect(screen.getByRole("button", { name: "Apagar" })).toBeDisabled();
  });

  it("texto parecido mas diferente NAO habilita", async () => {
    montar();
    await userEvent.click(screen.getByText("abrir"));
    await userEvent.type(screen.getByRole("textbox"), "noiva inteligente");

    expect(screen.getByRole("button", { name: "Apagar" })).toBeDisabled();
  });

  it("texto exato habilita e confirma", async () => {
    const onConfirmar = montar();
    await userEvent.click(screen.getByText("abrir"));
    await userEvent.type(screen.getByRole("textbox"), "Noiva Inteligente");

    const botao = screen.getByRole("button", { name: "Apagar" });
    expect(botao).toBeEnabled();
    await userEvent.click(botao);

    expect(onConfirmar).toHaveBeenCalledTimes(1);
  });

  it("sem exigirDigitar, o dialogo continua funcionando como antes", async () => {
    const onConfirmar = vi.fn();
    render(
      <ConfirmarDialogo
        gatilho={(abrir) => <button onClick={abrir}>abrir</button>}
        titulo="Remover?"
        descricao="…"
        rotuloConfirmar="Remover"
        rotuloConfirmando="Removendo…"
        onConfirmar={onConfirmar}
      />
    );
    await userEvent.click(screen.getByText("abrir"));

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remover" }));
    expect(onConfirmar).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/confirmar-dialogo-digitar.test.tsx
```

Esperado: os três primeiros casos falham (não há campo de texto); o quarto passa. Evidência RED.

- [ ] **Step 3: Estender `ConfirmarDialogo`**

Acrescentar a prop opcional, o estado do campo e o gate do botão. Leia o arquivo inteiro antes; ele tem comentários explicando por que o gatilho é injetado e por que "Cancelar" vem primeiro — **preserve-os**.

```tsx
  /**
   * Quando presente, exige que a pessoa digite este texto EXATO para o botão
   * de confirmar habilitar.
   *
   * Existe para as operações em que o custo do erro recai sobre terceiros:
   * desativar ou apagar um fluxo do n8n derruba o atendimento de um cliente
   * que não está na sala para reclamar. Um diálogo comum vira reflexo depois
   * da décima vez; digitar o nome não vira.
   *
   * Comparação exata, sem `trim` e sem ignorar caixa: metade do valor está em
   * obrigar a LER o nome para reproduzi-lo.
   */
  exigirDigitar?: string;
```

No corpo:

```tsx
  const [digitado, setDigitado] = useState("");
  const precisaDigitar = exigirDigitar !== undefined;
  const podeConfirmar = !precisaDigitar || digitado === exigirDigitar;
```

Renderizar o campo entre a descrição e o rodapé, quando `precisaDigitar`:

```tsx
          {precisaDigitar ? (
            <div className="space-y-2">
              <Label htmlFor="confirmar-digitando">
                Digite <span className="font-medium">{exigirDigitar}</span> para confirmar
              </Label>
              <Input
                id="confirmar-digitando"
                value={digitado}
                onChange={(evento) => setDigitado(evento.target.value)}
                autoComplete="off"
              />
            </div>
          ) : null}
```

E o botão de confirmar passa a `disabled={confirmando || !podeConfirmar}`. Ao fechar o diálogo, limpar `digitado` — senão a segunda abertura já vem habilitada, o que anula a proteção inteira.

- [ ] **Step 4: Rodar o teste e o dos usos existentes**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/confirmar-dialogo-digitar.test.tsx tests/unit/lead-note-list.test.tsx tests/unit/task-list.test.tsx tests/unit/agente-form.test.tsx tests/unit/etapas-table.test.tsx
```

Esperado: todos PASS. Os usos existentes **não** foram editados — se algum falhar, a prop não é retrocompatível e precisa ser reformulada.

- [ ] **Step 5: Criar `src/components/automation/execucoes-table.tsx`**

```tsx
"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatarDataHoraBR } from "@/lib/date";
import { reexecutarExecucaoAction } from "@/modules/automation/actions";
import type { Execucao } from "@/modules/automation/n8n/tipos";

function duracao(execucao: Execucao): string {
  if (!execucao.terminadoEm) return "em andamento";
  const ms = new Date(execucao.terminadoEm).getTime() - new Date(execucao.iniciadoEm).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function ExecucoesTable({ execucoes }: { execucoes: Execucao[] }) {
  const [pendente, iniciar] = useTransition();

  function reexecutar(execucao: Execucao) {
    iniciar(async () => {
      const r = await reexecutarExecucaoAction(execucao.id, execucao.workflowId);
      if (r.ok) toast.success("Reexecução enfileirada. Atualize em alguns segundos.");
      else toast.error(r.erro);
    });
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Status</TableHead>
          <TableHead>Início</TableHead>
          <TableHead>Duração</TableHead>
          <TableHead>Disparo</TableHead>
          <TableHead className="text-right">Ação</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {execucoes.map((execucao) => (
          <TableRow key={execucao.id}>
            <TableCell>
              <Badge variant={execucao.status === "success" ? "default" : "destructive"}>{execucao.status}</Badge>
            </TableCell>
            <TableCell>{execucao.iniciadoEm ? formatarDataHoraBR(new Date(execucao.iniciadoEm)) : "—"}</TableCell>
            <TableCell>{duracao(execucao)}</TableCell>
            <TableCell>{execucao.modo}</TableCell>
            <TableCell className="text-right">
              {/* "Reexecutar" e não "Testar": o botão roda de novo um caso que
                  aconteceu de verdade, na instância de produção. Chamá-lo de
                  teste sugeriria um sandbox que não existe. */}
              <Button variant="outline" size="sm" onClick={() => reexecutar(execucao)} disabled={pendente}>
                Reexecutar
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 6: Criar `src/components/automation/apagar-fluxo.tsx`**

Componente cliente, porque `ConfirmarDialogo` é cliente e a página de detalhe é de servidor.

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { ConfirmarDialogo } from "@/components/confirmar-dialogo";
import { Button } from "@/components/ui/button";
import { apagarFluxoAction } from "@/modules/automation/actions";

export function ApagarFluxo({ id, nome }: { id: string; nome: string }) {
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  return (
    <ConfirmarDialogo
      gatilho={(abrir) => (
        <Button variant="destructive" size="sm" onClick={abrir} disabled={pendente}>
          Apagar fluxo
        </Button>
      )}
      titulo={`Apagar "${nome}"?`}
      descricao="O workflow é removido da instância do n8n e não há como desfazer pelo CRM. Se ele atende clientes, o atendimento para na hora."
      exigirDigitar={nome}
      rotuloConfirmar="Apagar"
      rotuloConfirmando="Apagando…"
      onConfirmar={() =>
        iniciar(async () => {
          const r = await apagarFluxoAction(id, nome);
          if (r.ok) {
            toast.success(`"${nome}" foi apagado.`);
            // Volta para a lista: a página de detalhe passou a apontar para
            // um workflow que não existe mais.
            router.push("/fluxos");
          } else {
            toast.error(r.erro);
          }
        })
      }
    />
  );
}
```

- [ ] **Step 7: Criar `src/app/(painel)/fluxos/[id]/page.tsx`**

**Sem componente de abas:** `src/components/ui/` não tem `tabs` (confira com `ls src/components/ui/`). Em vez de introduzir um componente novo só para isso, a troca de visão é um link com query param — renderizado no servidor, sem estado de cliente.

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";

import { ApagarFluxo } from "@/components/automation/apagar-fluxo";
import { EditorN8n } from "@/components/automation/editor-n8n";
import { ExecucoesTable } from "@/components/automation/execucoes-table";
import { StatusFluxo } from "@/components/automation/status-fluxo";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/core/auth/permissions";
import { usuarioAtualOuLogin } from "@/core/auth/session";
import { exigirModulo } from "@/lib/module-gate";
import { clienteN8n, ErroN8n } from "@/modules/automation/n8n";

export default async function FluxoDetalhePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aba?: string }>;
}) {
  exigirModulo("automation");

  const { id } = await params;
  const { aba } = await searchParams;
  const usuario = await usuarioAtualOuLogin();
  const podeGerenciar = hasPermission(usuario.papel, "gerenciar_fluxos");

  let fluxo;
  let execucoes;
  try {
    // Em paralelo: são duas chamadas independentes, e serializá-las dobraria
    // o tempo de uma tela cujo propósito é diagnosticar rápido.
    [fluxo, execucoes] = await Promise.all([
      clienteN8n.buscarWorkflow(id),
      clienteN8n.listarExecucoes({ workflowId: id, limite: 20 }),
    ]);
  } catch (erro) {
    // `nao_encontrado` vira 404 de verdade, e não uma tela de erro: o fluxo
    // pode ter sido apagado por outra pessoa entre a lista e o clique.
    if (erro instanceof ErroN8n && erro.tipo === "nao_encontrado") notFound();
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Fluxo</h1>
        <EmptyState
          titulo="Não foi possível carregar este fluxo"
          descricao={
            erro instanceof ErroN8n && erro.tipo === "inalcancavel"
              ? "A instância do n8n pode estar fora do ar."
              : "O n8n recusou a consulta. Veja os logs da instância."
          }
        />
      </div>
    );
  }

  // Montada NO SERVIDOR e passada pronta. `N8N_API_KEY` não acompanha: o
  // editor autentica pelo cookie de sessão do próprio n8n, não pela chave da
  // API — que nunca deve sair daqui.
  const urlEditor = `${process.env.N8N_API_URL?.replace(/\/$/, "")}/workflow/${encodeURIComponent(id)}`;
  const mostrandoEditor = aba === "editar";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{fluxo.nome}</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <StatusFluxo ativo={fluxo.ativo} />
            <span>{fluxo.nos} nós</span>
            {fluxo.tags.length > 0 ? <span>· {fluxo.tags.join(", ")}</span> : null}
          </div>
        </div>
        {podeGerenciar ? <ApagarFluxo id={fluxo.id} nome={fluxo.nome} /> : null}
      </div>

      <nav className="flex gap-2 border-b">
        <Link href={`/fluxos/${id}`} aria-current={!mostrandoEditor ? "page" : undefined}>
          <Button variant={!mostrandoEditor ? "default" : "ghost"} size="sm">
            Execuções
          </Button>
        </Link>
        <Link href={`/fluxos/${id}?aba=editar`} aria-current={mostrandoEditor ? "page" : undefined}>
          <Button variant={mostrandoEditor ? "default" : "ghost"} size="sm">
            Editar
          </Button>
        </Link>
      </nav>

      {mostrandoEditor ? (
        <EditorN8n url={urlEditor} nome={fluxo.nome} />
      ) : execucoes.itens.length === 0 ? (
        <EmptyState
          titulo="Nenhuma execução"
          descricao="Este fluxo ainda não rodou, ou as execuções antigas já foram podadas pelo n8n."
        />
      ) : (
        <ExecucoesTable execucoes={execucoes.itens} />
      )}
    </div>
  );
}
```

**Notas para o implementador:**

- `EditorN8n` é criado na **Task 6, Step 3**. Se estiver executando em ordem, faça aquele passo antes deste, ou deixe o import quebrado e conserte lá — e diga qual escolheu no relatório.
- Confira a assinatura real de `EmptyState` e as `variant` que o `Button` da base aceita (`ghost` pode não existir) antes de rodar. Ajuste a chamada ao componente; **não** mude os componentes compartilhados por causa desta tela.
- A paginação por cursor **não** entra nesta tarefa: a primeira página de 20 execuções resolve o diagnóstico, e `proximoCursor` já existe no tipo para quando for preciso. Registre como dívida no relatório, não construa por antecipação.

- [ ] **Step 8: Rodar a suíte inteira e commitar**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npm test
npm run typecheck
git add -A src tests
git commit -m "feat(automation): confirmacao por digitacao e tela de detalhe

ConfirmarDialogo ganha exigirDigitar opcional, sem tocar em nenhum uso
existente. Comparacao exata, sem trim e sem ignorar caixa: metade do valor
esta em obrigar a LER o nome para reproduzi-lo. Um dialogo comum vira
reflexo depois da decima vez; digitar o nome nao vira.

O botao chama-se Reexecutar, nao Testar: roda de novo um caso real na
instancia de producao, e chamar de teste sugeriria um sandbox inexistente.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Iframe do editor, CSP e verificação final

**Files:**
- Modify: `src/proxy.ts` (acrescentar `frame-src`)
- Modify: `src/app/(painel)/fluxos/[id]/page.tsx` (aba "Editar")
- Create: `src/components/automation/editor-n8n.tsx`
- Modify: `.env.example` (documentar `N8N_API_URL` e `N8N_API_KEY`)
- Test: `tests/unit/proxy-csp-frame-src.test.ts` — **conferir primeiro** se `tests/unit/proxy-matcher.test.ts` já cobre a montagem do CSP; se cobrir, acrescente o caso lá em vez de criar arquivo novo

**Interfaces:**
- Consumes: tudo das tarefas anteriores.
- Produces: nada consumido por outra tarefa. É a última.

- [ ] **Step 1: Acrescentar `frame-src` ao CSP**

Em `src/proxy.ts`, no array que monta o CSP, acrescentar depois de `"connect-src 'self'"`:

```ts
    // O editor do n8n é embutido num iframe na tela /fluxos. `frame-src` é a
    // diretiva que permite ISSO — não confundir com `frame-ancestors`, que diz
    // quem pode embutir O CRM e continua `'none'`.
    //
    // A origem é fixa e única de propósito: um `frame-src` amplo permitiria a
    // qualquer script já presente na página embutir conteúdo de terceiro.
    // `script-src` não é tocado.
    "frame-src https://n8n.nateksoft.com",
```

- [ ] **Step 2: Escrever o teste do CSP**

Se `proxy-matcher.test.ts` já monta o CSP, acrescente lá; senão crie o arquivo. O teste precisa afirmar as duas coisas:

```ts
  it("o CSP permite embutir o n8n e continua proibindo embutir o CRM", () => {
    const csp = montarCsp("nonce-de-teste", false); // ajuste ao nome real da função

    expect(csp).toContain("frame-src https://n8n.nateksoft.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self' 'nonce-nonce-de-teste'");
  });
```

**Confira o nome e a assinatura reais da função** em `src/proxy.ts` antes de escrever — ela pode não ser exportada, e nesse caso exportá-la só para o teste é aceitável, com um comentário dizendo por quê.

- [ ] **Step 3: Criar `src/components/automation/editor-n8n.tsx`**

```tsx
/**
 * O editor do n8n embutido.
 *
 * Não há SSO: o n8n autentica por cookie próprio, e o fluxo de login por
 * iframe (`N8N_EMBED_LOGIN_ENABLED` + token exchange) exige licença
 * Enterprise. Na primeira visita a pessoa vê a tela de login DO N8N aqui
 * dentro, entra uma vez, e o cookie passa a valer.
 *
 * Isso só funciona porque duas coisas foram configuradas na VPS em
 * 2026-08-19 e estão registradas no spec: o nginx troca `X-Frame-Options`
 * por `frame-ancestors` listando a origem do CRM, e o n8n roda com
 * `N8N_SAMESITE_COOKIE=none` — sem essa segunda, o navegador não envia o
 * cookie de sessão em contexto de terceiro e a tela fica presa no login para
 * sempre.
 */
export function EditorN8n({ url, nome }: { url: string; nome: string }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Na primeira vez, entre com sua conta do n8n aqui dentro. O login vale para as próximas.
      </p>
      <iframe
        src={url}
        title={`Editor do n8n — ${nome}`}
        className="h-[70vh] w-full rounded-md border"
        // `sandbox` NÃO é usado aqui de propósito: o editor do n8n precisa de
        // scripts, formulários, popups de OAuth e do próprio cookie de sessão.
        // Um sandbox que permitisse tudo isso não estaria restringindo nada, e
        // um mais estreito quebraria o editor de um jeito difícil de
        // diagnosticar. A contenção real é o `frame-src` de origem única.
      />
    </div>
  );
}
```

- [ ] **Step 4: Ligar a aba "Editar" na página de detalhe**

Monte a URL **no servidor**: `${process.env.N8N_API_URL}/workflow/${id}` e passe pronta. Nunca passe `N8N_API_KEY` a este componente.

- [ ] **Step 5: Documentar as variáveis no `.env.example`**

Acrescentar, no padrão de comentário do arquivo (denso, explica o modo de falha, diz onde obter):

```
# URL base da instância n8n (sem barra no final), ex.: "https://n8n.nateksoft.com".
# Também é a origem usada para montar o link do editor embutido em /fluxos, e
# precisa bater com o `frame-src` de src/proxy.ts -- se as duas divergirem, o
# iframe fica em branco sem nenhuma mensagem de erro no servidor, só uma
# violação de CSP no console do navegador.
N8N_API_URL="https://n8n.nateksoft.com"
# Chave da API pública do n8n: painel do n8n -> Settings -> n8n API.
#
# Dá poder TOTAL sobre os workflows da instância -- inclusive os de outros
# clientes, se ela for compartilhada. Só é lida em código de servidor
# (src/modules/automation/n8n/), nunca chega ao navegador.
#
# O JWT que o n8n emite NÃO tem claim `exp`: não expira sozinho. Revogar exige
# apagar a chave no painel do n8n.
N8N_API_KEY="gerar-em-n8n-settings-n8n-api"
```

- [ ] **Step 6: Verificação final — os critérios de aceite do spec**

Cada item fecha com o comando e a saída colados. O que este ambiente não permitir provar sai como **não verificado**, com o comando que um humano precisa rodar.

```bash
cd "d:/Projetos Programação/N8n + Crm"
npm run typecheck
npm test
npm run build
```

Depois, com `npm run dev` no ar e login feito com o usuário do seed, dirigindo o navegador por Playwright:

- [ ] a lista mostra os workflows reais da instância, com o estado ativo/desligado batendo com a API
- [ ] o detalhe pagina execuções e mostra status e duração
- [ ] o diálogo de desativar **não** habilita o botão até o nome ser digitado exato
- [ ] um GESTOR não vê o link no menu e recebe 404 em `/fluxos`
- [ ] **nenhuma resposta ao navegador contém `N8N_API_KEY`** — provar procurando o valor no HTML e no payload RSC:
  `curl -s http://localhost:3000/fluxos -H "Cookie: <sessão>" | grep -c "<primeiros 12 chars da chave>"` deve devolver `0`
- [ ] o iframe carrega o editor do n8n (ou a tela de login dele, que já prova que o framing passou)
- [ ] com `N8N_API_URL` apontando para um host inexistente, a tela diz "Não foi possível falar com o n8n" em vez de quebrar

**Não ative, desative nem apague nenhum workflow da instância real durante a verificação.** Ela atende clientes. Para exercitar o caminho destrutivo, confirme que o diálogo habilita o botão e **cancele**.

- [ ] **Step 7: Auditoria de segurança e commit final**

O `AGENTS.md` da base exige auditoria antes de integrar. Escreva `docs/auditorias/2026-08-19-ciclo-4-fluxos.md` cobrindo a superfície tocada: exposição da chave, permissões, CSP, e o que o iframe abre. Depois:

```bash
cd "d:/Projetos Programação/N8n + Crm"
git add -A
git commit -m "feat(automation): editor do n8n em iframe e frame-src no CSP

frame-src permite embutir o n8n; frame-ancestors continua 'none' e segue
proibindo embutir o CRM. Sao diretivas diferentes e faceis de confundir.

O iframe nao usa sandbox de proposito: o editor precisa de script,
formulario, popup de OAuth e do proprio cookie. Um sandbox permissivo o
bastante nao restringiria nada. A contencao e o frame-src de origem unica.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push
```
