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

/**
 * URL base do n8n, validada — para quem precisa montar uma URL fora do
 * `ClienteN8nHttp` (o iframe do editor embutido, `fluxos/[id]/page.tsx`).
 *
 * Existe porque `[id]/page.tsx` lia `process.env.N8N_API_URL` CRU, com `?.`,
 * para montar `urlEditor` — achado M5 da revisão final: com a env ausente ou
 * inválida, isso produzia silenciosamente `src="undefined/workflow/<id>"`
 * no navegador, sem erro nenhum no servidor. O resto do módulo é estrito
 * sobre essa env (`lerEnv()` acima); esse `?.` era otimismo fora de lugar.
 * Mesma validação de `obterCliente()`, mesma mensagem de erro clara.
 */
export function urlBaseN8n(): string {
  return lerEnv().N8N_API_URL;
}
