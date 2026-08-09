import { type Oklch, luminancia, contraste, girarMatiz } from "./cor";

/**
 * Deriva os ~30 tokens do sistema a partir de UMA cor de marca.
 *
 * A regra que organiza tudo: **a marca vive na ação, não na superfície.**
 * Croma cheio em `primary`, `ring` e nos gráficos; nas superfícies, um
 * sussurro com teto absoluto. Os tetos (0.006 a 0.012) ficam abaixo do
 * limiar em que o olho nomeia uma cor e acima do limiar em que ele percebe
 * temperatura — é o que faz uma marca fria e uma quente produzirem ambientes
 * distintos sem que nada pareça colorido.
 *
 * Croma zero em tudo entregaria o mesmo cinza para todo cliente, e a premissa
 * do white-label morreria de um jeito difícil de perceber.
 */

export const CROMA_MINIMO = 0.04;
const MAX_ITERACOES = 40;
const PASSO_L = 0.02;

export type Tokens = Record<string, Oklch>;

const BRANCO: Oklch = { L: 1, C: 0, H: 0 };
const PRETO: Oklch = { L: 0, C: 0, H: 0 };

/** Vermelho fixo. NUNCA derivado da marca — ver o comentário em `derivarPaleta`. */
const DESTRUCTIVE_CLARO: Oklch = { L: 0.58, C: 0.22, H: 27 };
const DESTRUCTIVE_ESCURO: Oklch = { L: 0.62, C: 0.2, H: 27 };

/** `min(C × fator, teto)` — o sussurro de croma das superfícies. */
function sussurro(C: number, fator: number, teto: number): number {
  return Math.min(C * fator, teto);
}

/**
 * Move a luminosidade da primária até o texto por cima atingir 4.5:1.
 *
 * Termina sempre: o contraste é monotônico em cada direção de `L`, e nos
 * extremos (`L=0` com branco, `L=1` com preto) chega a 21:1. O `throw` no fim
 * é detector de bug, não caminho esperado — se ele disparar, a conversão de
 * cor está errada, e falhar alto é melhor que servir botão ilegível.
 *
 * O limiar é 4.5:1 e não 3:1 porque rótulo de botão é texto normal (14-16px);
 * o relaxamento de 3:1 só vale para texto grande.
 */
export function ajustarParaContraste(
  cor: Oklch,
  minimo = 4.5,
): { primaria: Oklch; texto: Oklch } {
  const y = luminancia(cor);
  const textoBranco = contraste(y, 1) >= contraste(y, 0);
  const texto = textoBranco ? BRANCO : PRETO;
  const alvo = textoBranco ? 1 : 0;
  const direcao = textoBranco ? -PASSO_L : PASSO_L;

  let atual = cor;
  for (let i = 0; i <= MAX_ITERACOES; i++) {
    if (contraste(luminancia(atual), alvo) >= minimo) {
      return { primaria: atual, texto };
    }
    const L = atual.L + direcao;
    if (L < 0 || L > 1) break;
    atual = { ...atual, L };
  }

  throw new Error(
    `Não foi possível atingir ${minimo}:1 em ${MAX_ITERACOES} iterações. ` +
      `Isto indica bug na conversão de cor, não marca inválida.`,
  );
}

/** As cinco séries: matiz da marca e mais quatro giros, com L e C constantes. */
function graficos(marca: Oklch, L: number): Tokens {
  const C = Math.min(Math.max(marca.C, 0.1), 0.16);
  const base: Oklch = { L, C, H: marca.H };
  const giros = [0, 40, -40, 80, -80];
  return Object.fromEntries(
    giros.map((g, i) => [`chart-${i + 1}`, girarMatiz(base, g)]),
  );
}

export function derivarPaleta(marca: Oklch): { claro: Tokens; escuro: Tokens } {
  if (marca.C < CROMA_MINIMO) {
    throw new Error(
      `Croma ${marca.C.toFixed(3)} abaixo do mínimo ${CROMA_MINIMO}. ` +
        `Abaixo disso as superfícies derivadas ficam indistinguíveis de cinza ` +
        `neutro e o white-label deixa de funcionar em silêncio.`,
    );
  }

  const { C, H } = marca;

  const claroPrim = ajustarParaContraste(marca);
  const claro: Tokens = {
    background: { L: 1, C: 0, H },
    card: { L: 1, C: 0, H },
    popover: { L: 1, C: 0, H },
    foreground: { L: 0.15, C: sussurro(C, 0.04, 0.008), H },
    primary: claroPrim.primaria,
    "primary-foreground": claroPrim.texto,
    ring: claroPrim.primaria,
    secondary: { L: 0.97, C: sussurro(C, 0.03, 0.006), H },
    muted: { L: 0.97, C: sussurro(C, 0.03, 0.006), H },
    "muted-foreground": { L: 0.55, C: sussurro(C, 0.05, 0.01), H },
    accent: { L: 0.95, C: sussurro(C, 0.06, 0.012), H },
    border: { L: 0.92, C: sussurro(C, 0.04, 0.008), H },
    input: { L: 0.92, C: sussurro(C, 0.04, 0.008), H },
    sidebar: { L: 0.985, C: sussurro(C, 0.03, 0.006), H },
    "sidebar-accent": { L: 0.95, C: sussurro(C, 0.05, 0.01), H },
    destructive: DESTRUCTIVE_CLARO,
    ...graficos(marca, 0.65),
  };

  // A primária do tema escuro roda o laço OUTRA VEZ, contra o fundo escuro —
  // não reaproveita o resultado do claro. Na prática ela sai mais clara,
  // porque acento escuro sobre fundo escuro desaparece.
  const escuroPrim = ajustarParaContraste({ ...marca, L: Math.max(marca.L, 0.6) });
  const escuro: Tokens = {
    background: { L: 0.13, C: 0, H },
    sidebar: { L: 0.13, C: 0, H },
    card: { L: 0.16, C: sussurro(C, 0.03, 0.006), H },
    popover: { L: 0.16, C: sussurro(C, 0.03, 0.006), H },
    foreground: { L: 0.97, C: sussurro(C, 0.03, 0.006), H },
    primary: escuroPrim.primaria,
    "primary-foreground": escuroPrim.texto,
    ring: escuroPrim.primaria,
    secondary: { L: 0.22, C: sussurro(C, 0.04, 0.008), H },
    muted: { L: 0.22, C: sussurro(C, 0.04, 0.008), H },
    "muted-foreground": { L: 0.7, C: sussurro(C, 0.04, 0.008), H },
    accent: { L: 0.26, C: sussurro(C, 0.06, 0.012), H },
    "sidebar-accent": { L: 0.26, C: sussurro(C, 0.06, 0.012), H },
    border: { L: 0.28, C: sussurro(C, 0.05, 0.01), H },
    input: { L: 0.28, C: sussurro(C, 0.05, 0.01), H },
    destructive: DESTRUCTIVE_ESCURO,
    ...graficos(marca, 0.7),
  };

  return { claro, escuro };
}
