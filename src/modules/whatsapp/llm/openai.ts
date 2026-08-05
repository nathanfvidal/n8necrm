import OpenAI from "openai";

import type { ContextoConversa, LlmProvider } from "./tipos";

// gpt-4.1-mini — decisão do Rodrigo (ver plano da Fatia 1, "Decisões que
// precisam ficar registradas"), trocando a recomendação inicial de Claude
// Opus. É o mesmo modelo que os fluxos n8n de clínica já usam em produção,
// então o comportamento (inclusive a fraqueza conhecida de pular chamada de
// ferramenta às vezes) já é familiar — não relevante ainda nesta fatia, que
// não tem NENHUMA ferramenta real.
const MODELO = "gpt-4.1-mini";

/**
 * Implementação de `LlmProvider` contra a API de Chat Completions da OpenAI.
 * Não lê `process.env` diretamente — recebe a API key já validada pelo
 * construtor (`llm/index.ts` faz essa validação, mesmo raciocínio de
 * `gateway/evolution.ts` vs. `gateway/index.ts`).
 */
export class OpenAiProvider implements LlmProvider {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async gerarResposta(contexto: ContextoConversa): Promise<{ mensagens: string[] }> {
    const completion = await this.client.chat.completions.create({
      model: MODELO,
      messages: [
        { role: "system", content: contexto.systemPrompt },
        ...contexto.historico.map((mensagem) => ({
          // "HUMANO" (atendente da revenda respondendo direto pelo celular,
          // Fatia 2) entra como "assistant" no histórico, igual "IA" — do
          // ponto de vista do modelo, ambos são "o que já foi respondido ao
          // cliente"; a distinção entre os dois só importa para quem lê o
          // inbox no CRM (Conversation/WhatsappMessage.autor), não para o
          // prompt.
          role: (mensagem.autor === "CLIENTE" ? "user" : "assistant") as "user" | "assistant",
          content: mensagem.texto,
        })),
      ],
    });

    const texto = completion.choices[0]?.message?.content?.trim();
    if (!texto) {
      throw new Error(
        `Resposta vazia da OpenAI (modelo ${MODELO}) — finish_reason: ${completion.choices[0]?.finish_reason ?? "desconhecido"}`
      );
    }

    // Uma "mensagem" no WhatsApp costuma ser um balão curto — quando o
    // modelo tem mais de uma coisa a dizer, `config/bot.ts` instrui ele a
    // separar com uma linha em branco entre balões, imitando quem manda
    // mensagens seguidas em vez de um parágrafo só. `\n\s*\n` cobre tanto
    // uma linha em branco "limpa" quanto uma com espaço/tab sobrando nela.
    const mensagens = texto
      .split(/\n\s*\n/)
      .map((parte) => parte.trim())
      .filter((parte) => parte.length > 0);

    return { mensagens: mensagens.length > 0 ? mensagens : [texto] };
  }
}
