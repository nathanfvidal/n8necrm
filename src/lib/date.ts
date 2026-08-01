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
