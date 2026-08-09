/**
 * Matemática de cor para o sistema de identidade. Função pura: sem React, sem
 * Prisma, sem `server-only` — roda em teste sem nenhum mock.
 *
 * OKLCH e não HSL de propósito. Em OKLCH, girar o matiz preserva a
 * luminosidade percebida, e é isso que faz as cinco cores de gráfico saírem
 * igualmente legíveis. Em HSL, amarelo e azul com o mesmo "lightness" têm
 * brilhos muito diferentes na tela.
 *
 * Constantes de conversão: Björn Ottosson, "A perceptual color space for
 * image processing" (2020).
 */

export type Oklch = { L: number; C: number; H: number };

const HEX = /^#[0-9a-fA-F]{6}$/;

/** sRGB com gama para sRGB linear. */
function paraLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function hexParaOklch(hex: string): Oklch {
  if (!HEX.test(hex)) {
    throw new Error(`Cor inválida: "${hex}". Formato esperado: #RRGGBB.`);
  }

  const r = paraLinear(parseInt(hex.slice(1, 3), 16) / 255);
  const g = paraLinear(parseInt(hex.slice(3, 5), 16) / 255);
  const b = paraLinear(parseInt(hex.slice(5, 7), 16) / 255);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const C = Math.sqrt(a * a + bb * bb);
  const H = ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;

  return { L, C, H };
}

/**
 * Devolve sRGB LINEAR (sem gama), que é o espaço em que a luminância relativa
 * do WCAG é definida — por isso não há reaplicação de gama aqui.
 *
 * Os canais são GRAMPEADOS em 0..1. Cores OKLCH fora do gamute sRGB existem
 * (croma alto com luminosidade alta, por exemplo), e o navegador as mapeia
 * sozinho ao renderizar `oklch()`. O grampeamento é a aproximação equivalente
 * para o cálculo de contraste: sem ele um canal negativo produziria
 * luminância sem significado, e o contraste calculado a partir dela não
 * teria valor nenhum.
 */
export function oklchParaRgbLinear(cor: Oklch): [number, number, number] {
  const a = cor.C * Math.cos((cor.H * Math.PI) / 180);
  const b = cor.C * Math.sin((cor.H * Math.PI) / 180);

  const l = (cor.L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (cor.L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (cor.L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const grampear = (v: number) => Math.min(1, Math.max(0, v));

  return [
    grampear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    grampear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    grampear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** Luminância relativa do WCAG 2.1, sobre sRGB linear. */
export function luminancia(cor: Oklch): number {
  const [r, g, b] = oklchParaRgbLinear(cor);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razão de contraste do WCAG 2.1. Simétrica: a ordem não importa. */
export function contraste(y1: number, y2: number): number {
  const claro = Math.max(y1, y2);
  const escuro = Math.min(y1, y2);
  return (claro + 0.05) / (escuro + 0.05);
}

export function girarMatiz(cor: Oklch, graus: number): Oklch {
  return { ...cor, H: ((cor.H + graus) % 360 + 360) % 360 };
}

export function formatarOklch(cor: Oklch): string {
  const n = (v: number) => Number(v.toFixed(3));
  return `oklch(${n(cor.L)} ${n(cor.C)} ${n(cor.H)})`;
}
