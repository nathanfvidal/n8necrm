import { botConfig } from "../../../config/bot";

/**
 * Monta o prompt de sistema a partir de `config/bot.ts`.
 *
 * DETERMINÍSTICO de propósito — sem `new Date()`, sem nome do cliente, sem
 * qualquer valor que mude de uma chamada para a outra. Isto importa por dois
 * motivos:
 *
 * 1. Cache de prompt: provedores de LLM (incluindo a OpenAI) cacheiam o
 *    PREFIXO do prompt entre chamadas quando ele é byte-a-byte idêntico —
 *    um timestamp ali em cima invalidaria esse cache a cada chamada,
 *    triplicando o custo em silêncio (é literalmente o exemplo citado no
 *    plano da Fatia 1: "qualquer `new Date()` acima do ponto de cache
 *    triplica a conta em silêncio").
 * 2. Testabilidade: `montarPromptSistema()` sem argumento nenhum e sempre
 *    devolvendo o mesmo texto é trivial de testar (`toMatchSnapshot`/
 *    `toContain`) sem precisar congelar relógio nenhum.
 *
 * Qualquer dado específico da conversa (nome do cliente, histórico) entra
 * no contexto por outro caminho — o HISTÓRICO de mensagens (`turno.ts`
 * monta isso), nunca dentro deste prompt de sistema.
 */
export function montarPromptSistema(): string {
  const linhasRegras = botConfig.regras.map((regra, indice) => `${indice + 1}. ${regra}`).join("\n");

  return [
    `Você é ${botConfig.persona.nome}, ${botConfig.persona.papel}.`,
    "",
    "Regras:",
    linhasRegras,
  ].join("\n");
}
