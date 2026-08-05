/** Papel de quem escreveu uma mensagem no histórico passado ao modelo. */
export type AutorMensagemContexto = "CLIENTE" | "IA" | "HUMANO";

export interface MensagemContexto {
  autor: AutorMensagemContexto;
  texto: string;
}

/**
 * Contexto completo passado ao provedor de LLM para gerar uma resposta:
 * prompt de sistema (montado deterministicamente por `prompt.ts`, a partir
 * de `config/bot.ts` — nunca inclui timestamp ou qualquer conteúdo
 * não-determinístico, ver comentário em prompt.ts) + histórico da conversa,
 * mais antigo primeiro, terminando na mensagem mais recente do cliente.
 */
export interface ContextoConversa {
  systemPrompt: string;
  historico: MensagemContexto[];
}

/**
 * Abstração sobre o provedor de LLM — mesmo espírito de `WhatsappGateway`
 * (gateway/tipos.ts): trocar de modelo/provedor no futuro é escrever um novo
 * arquivo implementando esta interface, não reescrever `turno.ts`.
 *
 * `mensagens: string[]` (não uma string só) porque uma pessoa respondendo no
 * WhatsApp frequentemente manda mais de uma mensagem seguida em vez de um
 * parágrafo único — `config/bot.ts` instrui o modelo a separar mensagens com
 * uma linha em branco quando fizer sentido, e a implementação concreta
 * (`openai.ts`) faz esse split.
 */
export interface LlmProvider {
  gerarResposta(contexto: ContextoConversa): Promise<{ mensagens: string[] }>;
}
