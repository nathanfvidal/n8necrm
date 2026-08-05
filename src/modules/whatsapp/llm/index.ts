import "server-only";

import { z } from "zod";

import { OpenAiProvider } from "./openai";
import type { LlmProvider } from "./tipos";

export type { LlmProvider, ContextoConversa, MensagemContexto, AutorMensagemContexto } from "./tipos";

// Validação isolada neste módulo, não em src/lib/env.ts — mesmo raciocínio
// de src/lib/storage.ts e gateway/index.ts: só quem importa o provedor de
// LLM precisa de OPENAI_API_KEY.
const llmEnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, {
    message: "OPENAI_API_KEY ausente — defina no .env (platform.openai.com/api-keys)",
  }),
});

function getLlmEnv() {
  const resultado = llmEnvSchema.safeParse({ OPENAI_API_KEY: process.env.OPENAI_API_KEY });
  if (!resultado.success) {
    const detalhes = resultado.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Configuração do provedor de LLM inválida: ${detalhes}`);
  }
  return resultado.data;
}

// Trocar de provedor no futuro (outro modelo, outra API) é trocar esta
// linha por outra implementação de LlmProvider — turno.ts e prompt.ts só
// conhecem a interface.
export const llmProvider: LlmProvider = new OpenAiProvider(getLlmEnv().OPENAI_API_KEY);
