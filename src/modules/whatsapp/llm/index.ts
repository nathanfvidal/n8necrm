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
    // Nomeia a variável — ver o comentário equivalente em `gateway/index.ts`:
    // com valor `undefined` o Zod para na checagem de tipo e a mensagem
    // customizada acima nunca aparece.
    const detalhes = resultado.error.issues
      .map((issue) => `${issue.path.join(".") || "(desconhecida)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Configuração do provedor de LLM inválida: ${detalhes}`);
  }
  return resultado.data;
}

let instancia: LlmProvider | null = null;

/**
 * Preguiçoso pelo mesmo motivo de `gateway/index.ts` — leia o comentário
 * longo de lá.
 *
 * Em resumo: `next build` avalia todo módulo alcançável para coletar a
 * configuração das rotas, então validar no escopo do módulo transforma uma
 * variável de integração ausente em falha do build INTEIRO, inclusive das
 * telas que não têm nada a ver com WhatsApp. Este arquivo foi o segundo elo
 * da mesma cadeia: corrigir só o gateway fazia o build avançar e quebrar
 * aqui, com outra mensagem.
 */
function obterProvedor(): LlmProvider {
  if (instancia) return instancia;

  // Trocar de provedor no futuro (outro modelo, outra API) é trocar esta
  // linha por outra implementação de LlmProvider — turno.ts e prompt.ts só
  // conhecem a interface.
  instancia = new OpenAiProvider(getLlmEnv().OPENAI_API_KEY);

  return instancia;
}

/** Mesma forma de sempre para quem consome; ver `gateway/index.ts`. */
export const llmProvider: LlmProvider = new Proxy({} as LlmProvider, {
  get(_alvo, propriedade) {
    const real = obterProvedor() as unknown as Record<string | symbol, unknown>;
    const valor = real[propriedade];
    return typeof valor === "function" ? valor.bind(real) : valor;
  },
});
