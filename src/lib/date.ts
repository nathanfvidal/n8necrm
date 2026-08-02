/**
 * Utilitários de data "civil" (um dia do calendário, sem hora nem fuso) —
 * pensados para o campo `vencimento` de `Task` (Task 18), mas sem NENHUMA
 * dependência de Prisma/Next: função pura, importável tanto por Client
 * quanto por Server Components sem risco de arrastar nada sensível para o
 * bundle do navegador (ao contrário de `@/core/tasks/service`, que tem
 * `import "server-only"`).
 *
 * Por que isto existe: um `<input type="date">` devolve uma STRING no
 * formato "AAAA-MM-DD", sem nenhuma informação de fuso — uma pessoa que
 * digita "05/08/2026" num formulário de tarefa quer dizer "aquele dia
 * inteiro", não um instante específico. `Task.vencimento` no schema é
 * `DateTime` (Prisma não tem um tipo "só data"), então algum instante
 * precisa ser escolhido para representar esse dia.
 *
 * A armadilha clássica: `new Date(str + "T00:00")` (formato "date-time" da
 * spec ECMA-262, sem "Z") é interpretado como meia-noite no FUSO LOCAL de
 * quem roda o código — do navegador de quem preenche o formulário, ou do
 * processo Node do servidor, dependendo de onde a conversão acontece. Para
 * um usuário no Brasil (UTC-3) cujo `Date` acaba sendo formatado depois num
 * fuso diferente (ou vice-versa), "05/08" pode virar "04/08" ou "06/08" sem
 * nenhum erro visível — o tipo de bug que ninguém percebe até reclamar que
 * "a tarefa venceu no dia errado".
 *
 * `parseDataCivil` faz a escolha EXPLÍCITA de sempre ancorar em meia-noite
 * UTC — mesmo instante, sempre, não importa o fuso de quem roda o código —
 * em vez de depender da diferença sutil (e pouco conhecida) que a spec faz
 * entre formato "date-only" (`new Date("2026-08-05")`, sempre UTC) e
 * "date-time" (sempre fuso local): uma refatoração futura que concatenasse
 * hora, ou trocasse para `new Date(ano, mes, dia)` (SEMPRE fuso local,
 * mesmo com componentes numéricos), quebraria essa premissa em silêncio.
 * `formatarDataCivilBR` é a outra metade indissociável: formata sempre a
 * partir dos componentes UTC (`timeZone: "UTC"`), nunca do fuso de quem está
 * vendo a tela — sem isso, exibir `vencimento` com
 * `toLocaleDateString("pt-BR")` simples usaria o fuso LOCAL do processo (ou
 * navegador), e meia-noite UTC de "05/08" viraria "04/08, 21h" na hora de
 * formatar para o Brasil — um dia inteiro antes do que a pessoa digitou.
 */
export function parseDataCivil(valor: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!match) {
    throw new Error(`Data inválida: "${valor}" não está no formato AAAA-MM-DD.`);
  }

  const ano = Number(match[1]);
  const mes = Number(match[2]);
  const dia = Number(match[3]);
  const data = new Date(Date.UTC(ano, mes - 1, dia));

  // `Date.UTC` "rola" datas fora do calendário em vez de rejeitar (ex.: mês
  // 13 vira janeiro do ano seguinte, dia 30 de fevereiro vira 1-2 de março)
  // — sem esta checagem, "2026-02-30" viraria silenciosamente 2 de março em
  // vez de um erro claro para quem preencheu o formulário.
  if (
    data.getUTCFullYear() !== ano ||
    data.getUTCMonth() !== mes - 1 ||
    data.getUTCDate() !== dia
  ) {
    throw new Error(`Data inválida: "${valor}" não corresponde a um dia real do calendário.`);
  }

  return data;
}

/**
 * Formata uma data "civil" (ver `parseDataCivil`) no padrão brasileiro,
 * sempre a partir dos componentes UTC — nunca do fuso de quem está vendo a
 * tela. Par indissociável de `parseDataCivil`: usar um sem o outro
 * reintroduz o deslocamento de um dia que os dois juntos evitam.
 */
export function formatarDataCivilBR(data: Date): string {
  return data.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

/**
 * ---------------------------------------------------------------------
 * A partir daqui: helpers de TIMESTAMP (um INSTANTE — `Lead.criadoEm`,
 * `LeadNote.criadoEm`, `AuditLog.criadoEm`, todo `DateTime` que representa
 * "quando algo aconteceu", não um dia digitado num `<input type="date">`).
 *
 * Isto é DELIBERADAMENTE o oposto da âncora UTC de `parseDataCivil`/
 * `formatarDataCivilBR` acima, e as duas famílias não devem ser misturadas:
 *
 * - Uma data civil (vencimento de tarefa) é o dia que a pessoa DIGITOU —
 *   sempre o mesmo dia, em qualquer fuso de quem olha a tela depois. Por
 *   isso ancora e formata em UTC: um "instante" fixo e arbitrário que
 *   ninguém nunca vê como hora, só como data.
 * - Um timestamp (`criadoEm`) é um INSTANTE real que aconteceu num
 *   momento do mundo — formatá-lo em UTC (ou no fuso do processo Node, que
 *   pode não ser o do Brasil em produção) mostraria a hora errada para
 *   quem está olhando de São Paulo, e pior: o mesmo instante apareceria
 *   com dia diferente dependendo de QUEM formatou (servidor vs. máquina
 *   local de quem roda `npm run dev`) se cada site da aplicação decidisse
 *   o fuso por conta própria via `toLocaleString`/`toLocaleDateString`
 *   sem `timeZone` — exatamente o bug que estas funções existem para
 *   fechar (ver `tests/unit/date.test.ts`, "criadoEm exibido e o ISO usado
 *   para filtrar teriam que concordar").
 *
 * "America/Sao_Paulo" fixo (não o fuso do processo) porque o servidor de
 * produção não necessariamente roda no Brasil, e a base de usuários desta
 * fase é 100% brasileira — mesma decisão já tomada em
 * `export/leads/route.ts` (Task 21), só que ali vivia como uma cópia local
 * da função; as três telas com o mesmo bug em potencial (`leads/page.tsx`,
 * `leads/[id]/page.tsx`, dashboard `page.tsx`) chamavam `toLocaleDateString`/
 * `toLocaleString("pt-BR")` sem `timeZone` nenhum, herdando o fuso do
 * processo Node — daí o "05/08" que a exportação mostra virar "04/08" na
 * tela, ou vice-versa, dependendo de onde o processo está hospedado.
 * ---------------------------------------------------------------------
 */
const FUSO_BRASIL = "America/Sao_Paulo";

/**
 * Formata um timestamp como "DD/MM/AAAA HH:mm" no fuso de São Paulo.
 * `Intl.DateTimeFormat` + `formatToParts` (em vez de `toLocaleString`
 * direto) evita o "," que o locale pt-BR insere entre data e hora por
 * padrão — controle explícito do formato final, sem depender de como a ICU
 * do ambiente formata `toLocaleString` hoje. Mesma implementação que
 * `export/leads/route.ts` (Task 21) tinha embutida localmente; movida para
 * cá para ser o único lugar que decide isso.
 */
export function formatarDataHoraBR(data: Date): string {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO_BRASIL,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(data);

  const valor = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? "";
  return `${valor("day")}/${valor("month")}/${valor("year")} ${valor("hour")}:${valor("minute")}`;
}

/**
 * Formata um timestamp como "DD/MM/AAAA" (sem hora) no fuso de São Paulo —
 * para telas como a lista de leads, que mostram só o dia de criação.
 */
export function formatarDataBR(data: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO_BRASIL,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(data);
}

/**
 * Devolve "AAAA-MM-DD" (dia civil no fuso de São Paulo) para um timestamp —
 * a chave que `lead-table.tsx` usa para o filtro "De"/"Até" por data de
 * criação (comparação de string, formato ISO ordena igual a data).
 *
 * Existe para acompanhar `formatarDataBR` (mesmo fuso, mesmo dia) — antes
 * desta função, `leads/page.tsx` calculava esse valor com
 * `criadoEm.toISOString().slice(0, 10)` (dia civil em UTC) enquanto exibia
 * o dia com `toLocaleDateString("pt-BR")` sem fuso (dia civil no fuso do
 * processo). Os dois quase sempre concordam, exceto exatamente na janela
 * de ~3h ao redor da meia-noite em São Paulo (UTC-3) — onde um lead criado
 * "04/08 23h" no relógio de São Paulo é "05/08 02h" em UTC: a tela
 * mostrava "04/08" (fuso do processo, se o processo rodasse no fuso do
 * Brasil) mas o filtro usava a chave "2026-08-05" (UTC) — filtrar por
 * "04/08" não encontrava a própria linha rotulada "04/08". Usar o mesmo
 * fuso (São Paulo) para os dois elimina a divergência por construção, não
 * por coincidência de qual fuso o processo roda.
 */
export function dataISOEmSaoPaulo(data: Date): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_BRASIL,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(data);

  const valor = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? "";
  return `${valor("year")}-${valor("month")}-${valor("day")}`;
}
