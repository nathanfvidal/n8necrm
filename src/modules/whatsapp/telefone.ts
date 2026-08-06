/**
 * Irmã não-lançadora de `normalizarTelefone` (src/core/leads/dedupe.ts).
 *
 * `normalizarTelefone` lança quando o valor não é reconhecível como telefone
 * brasileiro — comportamento correto num formulário (a pessoa vê o erro e
 * corrige). Num webhook de WhatsApp isso seria errado: uma exceção não
 * tratada faria o handler do webhook devolver 500 (ou, se capturada cedo
 * demais, faria a ingestão inteira da mensagem falhar) por causa de um
 * `wa_id` que não bate no formato brasileiro esperado — silenciosamente
 * ignorando um cliente de verdade em vez de degradar de forma visível.
 *
 * Esta função NÃO importa nem modifica `src/core/leads/dedupe.ts` — é uma
 * reimplementação deliberada da MESMA lógica de dígitos (código do país,
 * unificação do 9º dígito, validação de 10/11 dígitos), para que
 * `Conversation.telefone` (só gravado quando `ok: true`) sempre concorde com
 * o que `encontrarOuCriarContact` gravaria em `Contact.telefone` para o
 * mesmo número — sem isso, o mesmo cliente podia deduplicar diferente na
 * ingestão do WhatsApp e num lead criado manualmente com o mesmo telefone.
 *
 * `Conversation.waId` (o identificador bruto que a Evolution manda) é SEMPRE
 * gravado pelo chamador, independente do resultado desta função — só
 * `Conversation.telefone` fica nulo quando `ok: false`. Ver a decisão
 * "Telefone" no plano da Fatia 1: "degrada visível, nunca mutila calado".
 */
export type ResultadoNormalizacao =
  | { ok: true; telefone: string }
  | { ok: false; motivo: "nao-brasileiro" | "invalido"; bruto: string };

// Mesma faixa documentada em dedupe.ts: plano de numeração da Anatel
// (Resolução 553/2010) — celular no formato antigo (sem 9º dígito) sempre
// começa em 6-9; fixo sempre começa em 2-5; as duas faixas nunca se
// sobrepõem.
const PRIMEIRO_DIGITO_CELULAR_SEM_NONO_DIGITO = new Set(["6", "7", "8", "9"]);

function unificarNonoDigitoCelular(digitos: string): string {
  if (digitos.length !== 10) return digitos;

  const ddd = digitos.slice(0, 2);
  const assinante = digitos.slice(2);
  const primeiroDigitoAssinante = assinante.charAt(0);

  if (PRIMEIRO_DIGITO_CELULAR_SEM_NONO_DIGITO.has(primeiroDigitoAssinante)) {
    return `${ddd}9${assinante}`;
  }

  return digitos;
}

/**
 * Normaliza um telefone (tipicamente um `wa_id` da Evolution, ex.:
 * "5511999998888") para a mesma forma canônica que `normalizarTelefone`
 * (DDD + 8/9 dígitos, sem código do país), sem nunca lançar.
 *
 * `motivo: "nao-brasileiro"` — depois de remover o código do país (quando
 * aplicável) e a formatação, sobrou uma contagem de dígitos que não é 10 nem
 * 11: o número claramente não é um telefone brasileiro reconhecível (ex.:
 * um `wa_id` de outro país, que a Evolution manda no mesmo formato
 * `<código do país><número>@s.whatsapp.net`, mas com um código de país
 * diferente de 55 e um comprimento de número totalmente diferente).
 *
 * `motivo: "invalido"` — não sobrou dígito nenhum utilizável (string vazia,
 * só caracteres não numéricos), ou sobrou pouquíssimo (claramente lixo, não
 * um número truncado de outro país). Na prática esta função não distingue
 * "nao-brasileiro" de "invalido" por uma regra diferente da contagem de
 * dígitos — ambos os motivos existem para o CHAMADOR poder logar/exibir uma
 * mensagem mais específica no futuro, mesmo que hoje os dois casos sejam
 * tratados da mesma forma (não persistir `Conversation.telefone`).
 */
export function normalizarTelefoneWhatsapp(bruto: string): ResultadoNormalizacao {
  const digitos = bruto.replace(/\D/g, "");

  if (digitos.length === 0) {
    return { ok: false, motivo: "invalido", bruto };
  }

  const semCodigoPais =
    (digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")
      ? digitos.slice(2)
      : digitos;

  const normalizado = unificarNonoDigitoCelular(semCodigoPais);

  if (normalizado.length !== 10 && normalizado.length !== 11) {
    // Curto demais para conter DDD (2) + o mínimo de um assinante de fixo
    // (8) mesmo antes de qualquer tentativa de remover código de país: não é
    // "um telefone de outro país", é lixo/incompleto (ex.: "12345", "()").
    // Igual ou mais longo que isso, mas ainda assim não convergiu para 10/11
    // dígitos: mais provável ser um número de outro país no mesmo formato
    // `<código do país><número>` que o wa_id da Evolution usa, só que com
    // um código de país e/ou comprimento nacional diferentes do Brasil.
    const motivo = digitos.length < 10 ? "invalido" : "nao-brasileiro";
    return { ok: false, motivo, bruto };
  }

  return { ok: true, telefone: normalizado };
}
