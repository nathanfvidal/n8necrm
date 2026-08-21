import { checarRateLimit } from "./limiter";

/**
 * Teto de respostas automáticas de IA **por empresa**, por hora.
 *
 * Irmão de `./export-leads.ts` e `./login.ts`: o mecanismo (contador atômico
 * em Postgres, `INSERT ... ON CONFLICT ... RETURNING`) mora em `./limiter.ts`,
 * a política mora aqui. Módulo separado porque `modules/whatsapp/turno.ts` é
 * o consumidor da fila e não deve carregar decisão de orçamento junto com
 * mecânica de lease.
 *
 * ## O buraco que ele fecha (achado 24 da Fase 1)
 *
 * `turno.ts` tinha DOIS controles de custo, e nenhum deles é global:
 *
 * - `TETO_RESPOSTAS_IA_POR_HORA = 20`, por CONVERSA. Contém um cliente em
 *   loop; não contém N clientes.
 * - `max_tokens: 400` e `HISTORICO_MAX_MENSAGENS = 20`, que limitam o custo
 *   de UMA chamada, não quantas chamadas acontecem.
 *
 * O próprio arquivo admitia o que sobrava: "um teto de GASTO mensal
 * configurado no painel da OpenAI continua sendo o único backstop real". Isso
 * é configuração humana, fora do sistema, que ninguém aqui controla e que a
 * Fase 1 listou entre os itens NÃO VERIFICADOS. Cem conversas independentes
 * dentro do teto de 20 cada dão 2000 chamadas numa hora, e nada no código
 * as vê como um conjunto.
 *
 * ## De onde sai o número, e o que ele assume
 *
 * O custo de um turno é limitado pelo próprio código, e isto é medível sem
 * consultar preço nenhum:
 *
 * - **Entrada**: prompt de sistema (`prompt.ts`, montado sobre
 *   `agente-limites.ts`: persona + até 20 regras de 500 caracteres + FAQ de
 *   4000) mais até `HISTORICO_MAX_MENSAGENS` (20) mensagens truncadas em
 *   `MAX_CARACTERES_POR_MENSAGEM_CONTEXTO` (2000) cada. Teto de ~50 mil
 *   caracteres, que a régua usual de ~4 caracteres por token põe perto de
 *   **12 mil tokens de entrada no pior caso**.
 * - **Saída**: `MAX_TOKENS_RESPOSTA` (400), teto duro do SDK.
 *
 * O modelo é `gpt-4.1-mini` (`llm/openai.ts`). Pelo preço público da OpenAI
 * na data desta correção (2026-08-21 — US$ 0,40 por milhão de tokens de
 * entrada e US$ 1,60 por milhão de saída; **preço não é constante e não foi
 * verificado por este código**), o pior caso fica em torno de **meio centavo
 * de dólar por turno**, e o turno TÍPICO — conversa curta, poucas mensagens
 * de histórico — custa uma fração disso.
 *
 * 200 por hora, então, é:
 *
 * - **Teto de gasto**: ~US$ 1/hora no pior caso aritmético acima, ~US$ 24 num
 *   dia inteiro de flood sustentado. É a ordem de grandeza de um susto, não
 *   de um prejuízo — que é exatamente o que um limite de contenção deve ser.
 * - **Folga para o uso legítimo**: 200 respostas/hora são 10 conversas
 *   esgotando o teto de 20 ao mesmo tempo, ou 100 clientes diferentes com 2
 *   respostas cada dentro da mesma hora. Para a revenda única que este CRM
 *   atende hoje (UI de empresa única, decisão 2 do `CLAUDE.md`), 100 pessoas
 *   escrevendo no WhatsApp em uma hora já é um dia excepcional.
 *
 * O número é DEFENSÁVEL, não ótimo: ele depende de um preço externo que pode
 * mudar e de um perfil de uso que ainda não foi observado em produção.
 *
 * **Alternativa deixada por escrever, de propósito:** tornar este teto
 * configurável por empresa (uma coluna em `BotConfig`, editável na tela do
 * agente). É decisão de produto — envolve quem pode mexer, o que acontece
 * quando alguém põe 100 mil, e se o valor entra no plano comercial — e
 * inventá-la aqui, sem o dono, seria decidir preço de produto dentro de uma
 * correção de segurança. Uma constante que contém o dano hoje vale mais que
 * um campo configurável que ninguém definiu quem configura.
 *
 * ## Cota por EMPRESA, não por conta nem por IP
 *
 * Não há conta: este caminho roda fora de requisição de usuário (consumidor
 * de fila). Não há IP útil: todo tráfego legítimo chega de um endereço só, a
 * instância da Evolution — é literalmente o achado que criou o teto por
 * conversa, registrado em `turno.ts`. O que gasta orçamento de OpenAI é a
 * EMPRESA dona das conversas, e é ela que a chave nomeia.
 *
 * A janela de 1h é igual à do export de leads, e continua abaixo de
 * `RETENCAO_RATE_LIMIT_MS` (24h) — o invariante da poda em `./limiter.ts`, que
 * `tests/unit/rate-limit.test.ts` guarda.
 */
export const LIMITE_RESPOSTAS_IA_POR_EMPRESA = 200;

export const JANELA_IA_EMPRESA_MS = 60 * 60_000;

/**
 * A chave da cota. Exportada porque os testes que rodam turnos de verdade
 * contra o banco compartilhado precisam zerá-la entre execuções — sem isso,
 * rodar a suíte várias vezes na mesma hora acumularia contagem e o
 * ducentésimo turno do dia falharia por um motivo que não é o do teste.
 */
export function chaveIaDaEmpresa(companyId: string): string {
  return `ia:whatsapp:empresa:${companyId}`;
}

/**
 * `false` quando a empresa já esgotou a cota da janela corrente.
 *
 * Consome uma unidade a cada chamada — por isso quem chama só deve chamar
 * quando a chamada ao modelo vai MESMO acontecer. Ver o ponto de uso em
 * `modules/whatsapp/turno.ts`.
 */
export async function checarLimiteIaDaEmpresa(companyId: string): Promise<boolean> {
  return checarRateLimit(
    chaveIaDaEmpresa(companyId),
    LIMITE_RESPOSTAS_IA_POR_EMPRESA,
    JANELA_IA_EMPRESA_MS
  );
}
