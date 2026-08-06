/**
 * Formato PLANO, igual ao da linha de `BotConfig` no banco — e não ao formato
 * aninhado de `config/bot.ts`. Quem chama em runtime é sempre o banco;
 * converter na borda rara (seed, restauração) é melhor que converter no
 * caminho quente de toda resposta.
 *
 * Declarado aqui como tipo estrutural em vez de importado de
 * `@prisma/client`: este módulo é montagem de texto, não deve depender do
 * client do banco. Mesmo raciocínio de `gateway/tipos.ts`.
 */
export type ConfigDoPrompt = {
  personaNome: string;
  personaPapel: string;
  regras: string[];
  faq: string;
};

/**
 * Monta o prompt de sistema a partir da config do agente.
 *
 * DETERMINÍSTICA de propósito — sem `new Date()`, sem nome do cliente, sem
 * qualquer valor que mude entre chamadas com a mesma config. Isto importa por
 * dois motivos:
 *
 * 1. Cache de prompt: provedores de LLM cacheiam o PREFIXO do prompt quando
 *    ele é byte-a-byte idêntico — um timestamp ali em cima invalidaria esse
 *    cache a cada chamada, triplicando o custo em silêncio.
 * 2. Testabilidade: dada a mesma config, sempre o mesmo texto — trivial de
 *    testar sem congelar relógio nenhum.
 *
 * A config vem por ARGUMENTO, não por leitura interna do banco (Fatia 2): uma
 * consulta escondida dentro de algo que todo mundo trata como função pura é
 * exatamente o tipo de surpresa que este comentário existe para evitar. Quem
 * lê o banco é `turno.ts`, uma vez por turno.
 */
export function montarPromptSistema(config: ConfigDoPrompt): string {
  const linhasRegras = config.regras.map((regra, indice) => `${indice + 1}. ${regra}`).join("\n");

  const blocos = [
    `Você é ${config.personaNome}, ${config.personaPapel}.`,
    "",
    "Regras:",
    linhasRegras,
  ];

  // Bloco omitido INTEIRO quando não há FAQ — cabeçalho sem conteúdo é lido
  // pelo modelo como instrução truncada.
  const faq = config.faq.trim();
  if (faq.length > 0) {
    blocos.push("", "Perguntas frequentes (use estas respostas quando forem aplicáveis):", faq);
  }

  return blocos.join("\n");
}
