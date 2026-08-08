import { Prisma } from "@prisma/client";

/**
 * Conversão entre o texto que uma pessoa digita e o `Decimal` do banco.
 *
 * Puro, sem Prisma Client nem Next — só o tipo `Decimal`. Importável por
 * Client e Server Component, igual a `src/lib/date.ts`.
 *
 * ## Por que a regra é estrita
 *
 * "1.500" é ambíguo: 1500 pela convenção brasileira (ponto = milhar) ou 1,5
 * pela americana (ponto = decimal). Nenhuma regra resolve isso a partir do
 * texto. O modo de falhar é o pior possível — `parseFloat("1.500,50")`
 * devolve `1.5` sem erro nenhum, e um negócio de mil e quinhentos vira um e
 * cinquenta no painel do gestor.
 *
 * Aqui o ponto é SEMPRE milhar e precisa formar grupos de três; a vírgula é
 * SEMPRE decimal, com no máximo duas casas. "1.5" é recusado em vez de
 * adivinhado.
 *
 * A tela nem chega a produzir esses casos: `mascararValorBR` faz a pessoa
 * digitar só algarismos e monta o valor pela direita. Este parse é a segunda
 * camada — Server Action é endpoint HTTP público e a máscara vive no cliente.
 */

/**
 * Grupos de milhar separados por ponto (`1.500.000`) ou um inteiro corrido
 * (`1500000`), com no máximo duas casas decimais após a vírgula.
 *
 * A alternância `\d{1,3}(?:\.\d{3})*|\d+` é o que recusa "1.5": o primeiro
 * ramo exige exatamente três dígitos após cada ponto, e o segundo não aceita
 * ponto nenhum.
 */
const PADRAO_BR = /^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/;

export function parseValorBR(texto: string): Prisma.Decimal {
  const limpo = texto.trim().replace(/^R\$\s*/, "");

  const match = PADRAO_BR.exec(limpo);
  if (!match) {
    throw new Error(
      `Valor inválido: "${texto}" não é um valor em reais. Use 1.500,50 ou 1500,50.`
    );
  }

  const inteiro = match[1].replace(/\./g, "");
  const centavos = (match[2] ?? "").padEnd(2, "0");

  return new Prisma.Decimal(`${inteiro}.${centavos}`);
}

/**
 * Monta o valor pela direita a partir de algarismos, como caixa de banco:
 * "150050" vira "1.500,50". Os dígitos são CENTAVOS — "15050" são 15.050
 * centavos, isto é R$ 150,50.
 *
 * Assim ninguém digita separador, e a ordem de grandeza aparece formada na
 * tela — que é a conferência que protege contra errar entre 150 mil e 1,5
 * milhão.
 */
export function mascararValorBR(digitos: string): string {
  const so = digitos.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!so) return "";

  const preenchido = so.padStart(3, "0");
  const inteiro = preenchido.slice(0, -2);
  const centavos = preenchido.slice(-2);

  return `${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${centavos}`;
}

/**
 * `Decimal` NÃO atravessa a fronteira servidor→cliente (é objeto Decimal.js,
 * não valor serializável). Consultas convertem com `.toString()`; esta função
 * recebe essa string — ou o próprio `Decimal` no servidor — e formata.
 *
 * Nunca `Number`: dinheiro em ponto flutuante é a origem clássica de centavo
 * que some.
 */
export function formatarValorBR(valor: Prisma.Decimal | string | null): string {
  if (valor === null) return "";
  return mascararValorBR(new Prisma.Decimal(valor).toFixed(2));
}
