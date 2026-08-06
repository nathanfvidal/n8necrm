/**
 * Tetos de tamanho dos campos do agente — persona, regras, FAQ.
 *
 * Mesmo raciocínio de `MAX_CARACTERES_RESPOSTA_HUMANA` em `agente.ts` ("um
 * campo sem limite é um campo que alguém cola um arquivo inteiro dentro"),
 * só que mais forte aqui: aquele texto é pago UMA VEZ por envio humano, este
 * é pago em TODO turno de TODA conversa — um documento colado na FAQ
 * multiplica o custo de token de cada resposta a cada cliente, em silêncio,
 * sem nada avisando na tela (rodada de correção 1, achado I1).
 *
 * Calibrados sobre o conteúdo de fábrica em `config/bot.ts` (medido ao vivo,
 * ver task-7-report.md), com folga generosa para qualquer fork escrever a
 * própria versão sem esbarrar no teto por acaso — o critério é "o que cabe
 * numa persona e numa FAQ de verdade", não "o que o banco aguenta":
 * - `personaNome` de fábrica ("Ana") tem 3 caracteres — é um nome, não uma
 *   frase; 80 cobre qualquer nome composto real.
 * - `personaPapel` de fábrica tem 64 caracteres; 300 cobre uma descrição de
 *   papel bem mais longa que a de fábrica.
 * - a maior regra de fábrica tem 323 caracteres; 500 dá folga para uma regra
 *   igualmente detalhada sem abrir espaço para um parágrafo inteiro.
 * - a FAQ de fábrica inteira (4 perguntas) tem 288 caracteres; 4000 (mesmo
 *   teto de `MAX_CARACTERES_RESPOSTA_HUMANA`) cobre uma FAQ real de dezenas
 *   de perguntas.
 *
 * Módulo separado de `agente-actions.ts` de propósito: aquele arquivo tem
 * `"use server"` no topo, e o Next só permite exportar FUNÇÃO ASSÍNCRONA de
 * um arquivo `"use server"` — uma `export const` ali quebraria o build. Este
 * arquivo é texto puro, sem banco nem segredo, importável tanto pela action
 * (validação, fonte da verdade) quanto pelo Client Component do formulário
 * (mostrar o limite na tela) — mesma ideia de `prompt.ts`.
 *
 * Revisão final da fatia, achado I3: `MAX_REGRA` limita o TAMANHO de cada
 * regra, mas nada limitava a QUANTIDADE de regras — colar um documento
 * inteiro no textarea de regras (`agente-form.tsx`) produz uma linha curta
 * por parágrafo, todas dentro do limite individual, e o prompt de sistema de
 * TODO turno de TODA conversa incha do mesmo jeito que `MAX_CARACTERES_POR_MENSAGEM_CONTEXTO`
 * existe para evitar do lado do histórico (`turno.ts`). `MAX_REGRAS` tapa
 * essa mesma classe de problema do lado da configuração. Calibrado do mesmo
 * jeito que os limites acima: o fork de fábrica (`config/bot.ts`) tem 7
 * regras; uma persona real, bem detalhada, dificilmente passa de umas 15-20
 * antes das regras começarem a se repetir ou se contradizer — 30 dá folga
 * generosa para qualquer fork legítimo sem deixar de barrar um documento
 * colado por engano, que produziria dezenas a centenas de linhas de uma vez.
 */
export const MAX_PERSONA_NOME = 80;
export const MAX_PERSONA_PAPEL = 300;
export const MAX_REGRA = 500;
export const MAX_REGRAS = 30;
export const MAX_FAQ = 4000;
