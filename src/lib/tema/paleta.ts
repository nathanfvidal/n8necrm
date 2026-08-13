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
 * Escolhe preto ou branco para o texto sobre a cor dada, pelo maior contraste.
 *
 * Não existe laço de ajuste aqui, e a ausência é deliberada: com texto preto
 * OU branco puro, nenhuma cor pode falhar em 4.5:1. As duas curvas de
 * contraste — `1.05 / (y + 0.05)` para branco e `(y + 0.05) / 0.05` para
 * preto — se cruzam em `y = 0.179`, e nesse ponto ambas valem 4.583:1. Como
 * se escolhe sempre a melhor das duas, 4.583 é o PIOR caso possível.
 *
 * Uma versão anterior movia a luminosidade da primária num laço até atingir
 * o limiar. O laço nunca executava uma iteração sequer, e código morto que
 * parece proteção é pior que nenhuma proteção: faz quem lê acreditar que há
 * uma defesa ali. Quem garante o invariante é o teste da grade em
 * `tests/unit/tema-paleta.test.ts`, e ele continuaria pegando o problema se
 * algum dia o texto deixar de ser preto/branco puro.
 */
function escolherTexto(cor: Oklch): Oklch {
  const y = luminancia(cor);
  return contraste(y, 1) >= contraste(y, 0) ? BRANCO : PRETO;
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

  const claro: Tokens = {
    background: { L: 1, C: 0, H },
    card: { L: 1, C: 0, H },
    popover: { L: 1, C: 0, H },
    foreground: { L: 0.15, C: sussurro(C, 0.04, 0.008), H },
    primary: marca,
    "primary-foreground": escolherTexto(marca),
    ring: marca,
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

  // A primária do tema escuro tem PISO de luminosidade em 0.6: uma marca
  // escura (L baixo) desapareceria sobre o fundo escuro, então ela sobe até
  // 0.6 antes de escolher o texto. Quando a marca já é clara (L >= 0.6), o
  // piso não faz nada e a primária do tema escuro coincide com a do claro —
  // comportamento correto, não bug.
  const primariaEscuro: Oklch = { ...marca, L: Math.max(marca.L, 0.6) };
  const escuro: Tokens = {
    background: { L: 0.13, C: 0, H },
    sidebar: { L: 0.13, C: 0, H },
    card: { L: 0.16, C: sussurro(C, 0.03, 0.006), H },
    popover: { L: 0.16, C: sussurro(C, 0.03, 0.006), H },
    foreground: { L: 0.97, C: sussurro(C, 0.03, 0.006), H },
    primary: primariaEscuro,
    "primary-foreground": escolherTexto(primariaEscuro),
    ring: primariaEscuro,
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
