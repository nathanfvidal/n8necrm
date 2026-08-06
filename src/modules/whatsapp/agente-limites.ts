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
 */
export const MAX_PERSONA_NOME = 80;
export const MAX_PERSONA_PAPEL = 300;
export const MAX_REGRA = 500;
export const MAX_FAQ = 4000;
