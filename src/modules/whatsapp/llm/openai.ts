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
// Fix round 1/5, achado CRÍTICO do revisor: sem timeout explícito, o SDK da
// OpenAI usa o default de 600_000ms (10 minutos) com até 2 retries — um
// único handler de turno podia ficar rodando por MINUTOS enquanto o lease
// (Conversation.processandoAte) já tinha expirado há muito tempo, abrindo
// espaço para um segundo processador reivindicar a mesma conversa e gerar
// uma segunda resposta pro mesmo cliente. 20s de timeout + no máximo 1 retry
// interno do SDK limita o pior caso a ~40s — `LEASE_DURACAO_MS` em turno.ts
// foi recalibrado para cobrir esse pior caso com folga (ver comentário lá).
const TIMEOUT_MS = 20_000;
const MAX_RETRIES = 1;

// Fix round 1/5, achado do revisor (I5): sem `max_tokens`, nada limita o
// tamanho da resposta que o modelo pode gerar — nem o custo por chamada nem
// (pior) o tempo de geração, que é o que alimenta diretamente o risco do
// lease descrito acima. 400 tokens é folgado para 2-3 balões curtos de
// WhatsApp (a regra de `config/bot.ts` pede respostas curtas); um valor
// baixo o bastante para nunca aproximar o teto do timeout de 20s.
const MAX_TOKENS_RESPOSTA = 400;

export class OpenAiProvider implements LlmProvider {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey, timeout: TIMEOUT_MS, maxRetries: MAX_RETRIES });
  }

  async gerarResposta(contexto: ContextoConversa): Promise<{ mensagens: string[] }> {
    const completion = await this.client.chat.completions.create({
      model: MODELO,
      max_tokens: MAX_TOKENS_RESPOSTA,
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
