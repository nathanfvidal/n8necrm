import "server-only";

import { clienteN8n, ErroN8n } from "./n8n";

import type { Execucao, WorkflowResumo } from "./n8n";

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
