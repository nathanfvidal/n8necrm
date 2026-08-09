# Identidade visual e shell do painel — plano de implementação

> **Para trabalhadores agênticos:** SUB-SKILL OBRIGATÓRIA — use
> `superpowers:subagent-driven-development` (recomendada) ou
> `superpowers:executing-plans` para executar tarefa a tarefa. Os passos usam
> caixa (`- [ ]`) para acompanhamento.

**Objetivo:** fazer um hex em `config/client.ts` definir a cara das 13 telas, e trocar a
navegação plana por uma barra lateral no estilo do painel da Vercel, com tema claro/escuro.

**Arquitetura:** um módulo puro (`src/lib/tema/`) converte a cor da marca para OKLCH e
deriva ~30 tokens com contraste **calculado**, nunca escolhido. O layout raiz emite esses
tokens numa tag `<style>` de especificidade dobrada (`:root:root`), que vence o
`globals.css` sem depender da ordem de inserção do bundle. A navegação passa a ser servidor
(calcula links e gates) + um componente cliente fino (pinta o ativo).

**Stack:** Next.js 16 · React · TypeScript · Tailwind 4 + shadcn · Zod · `next-themes`
0.4.6 · `lucide-react` · Vitest + Testing Library · Playwright.

**Spec:** [`2026-08-09-identidade-e-shell-design.md`](../specs/2026-08-09-identidade-e-shell-design.md)

## Restrições globais

Valem para **todas** as tarefas:

- **Não alterar o CSP** (`src/proxy.ts`). Acrescentar nonce a `style-src` invalidaria
  `'unsafe-inline'` e quebraria todo atributo `style=` do sistema, a começar pelo kanban.
- **Todo `<Link>` do painel leva `prefetch={false}`.** É correção de segurança: sem ela o
  Auth.js reemite o cookie de sessão numa requisição pré-carregada que chega depois do
  logout, e "Sair" deixa de revogar.
- **`core/` nunca importa de `modules/`** — ESLint em nível de erro.
- **Contraste mínimo 4.5:1** entre `--primary` e `--primary-foreground`.
- **`--destructive` nunca é derivado da marca.**
- **Todo teste novo é sabotado antes de ser aceito:** quebre o código de propósito,
  confirme que o teste falha, desfaça. Teste que não falha quando deveria não é teste.
- **Commits:** Conventional Commits, português **sem acentos**, e o trailer
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Verificação antes de cada commit:** `npm test`, `npm run typecheck`, `npm run lint`.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/tema/cor.ts` | matemática de cor: hex⇄OKLCH, luminância, contraste, giro de matiz |
| `src/lib/tema/paleta.ts` | um `Oklch` → os ~30 tokens de claro e escuro |
| `src/lib/tema/fontes.ts` | enum fechado de fontes → objeto do `next/font` |
| `src/lib/tema/index.ts` | tokens → string de CSS com `:root:root` |
| `config/client.schema.ts` | validação Zod: hex, piso de croma, enum de fonte, logo opcional |
| `config/client.ts` | passa a **executar** o schema (hoje só declara o tipo) |
| `src/app/layout.tsx` | emite o `<style>`, aplica a fonte, `lang="pt-BR"`, metadata |
| `src/components/marca.tsx` | logo ou nome do cliente em texto |
| `src/components/ui/sheet.tsx` | primitivo do shadcn para a gaveta (não existe hoje) |
| `src/components/nav-links.tsx` | **cliente**: pinta o item ativo por `usePathname` |
| `src/components/painel-nav.tsx` | **servidor**: links, gates, grupos, rodapé |
| `src/components/theme-toggle.tsx` | **cliente**: interruptor de dois estados |
| `src/app/(painel)/layout.tsx` | monta o `ThemeProvider` com o nonce |

---

## Task 1: Matemática de cor

**Arquivos:**
- Criar: `src/lib/tema/cor.ts`
- Teste: `tests/unit/tema-cor.test.ts`

**Interfaces:**
- Consome: nada.
- Produz:
  - `type Oklch = { L: number; C: number; H: number }`
  - `hexParaOklch(hex: string): Oklch`
  - `oklchParaRgbLinear(cor: Oklch): [number, number, number]`
  - `luminancia(cor: Oklch): number`
  - `contraste(y1: number, y2: number): number`
  - `girarMatiz(cor: Oklch, graus: number): Oklch`
  - `formatarOklch(cor: Oklch): string`

- [ ] **Passo 1: escrever o teste que falha**

`tests/unit/tema-cor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  hexParaOklch,
  oklchParaRgbLinear,
  luminancia,
  contraste,
  girarMatiz,
  formatarOklch,
} from "@/lib/tema/cor";

describe("hexParaOklch", () => {
  it("leva preto e branco aos extremos de L, com croma zero", () => {
    const preto = hexParaOklch("#000000");
    expect(preto.L).toBeCloseTo(0, 3);
    expect(preto.C).toBeCloseTo(0, 3);

    const branco = hexParaOklch("#FFFFFF");
    expect(branco.L).toBeCloseTo(1, 3);
    expect(branco.C).toBeCloseTo(0, 3);
  });

  // Valor de referência publicado para o azul puro de sRGB. Serve de âncora:
  // se a matriz de conversão for trocada por engano, este caso quebra.
  it("converte o azul puro para o valor de referência", () => {
    const azul = hexParaOklch("#0000FF");
    expect(azul.L).toBeCloseTo(0.452, 2);
    expect(azul.C).toBeCloseTo(0.313, 2);
    expect(azul.H).toBeCloseTo(264.05, 0);
  });

  it("aceita minúsculas e converte a cor da marca padrão", () => {
    const marca = hexParaOklch("#0f62fe");
    expect(marca.L).toBeCloseTo(0.556, 1);
    expect(marca.C).toBeCloseTo(0.243, 1);
    expect(marca.H).toBeCloseTo(262, 0);
  });

  it("recusa formato inválido", () => {
    expect(() => hexParaOklch("0F62FE")).toThrow();
    expect(() => hexParaOklch("#FFF")).toThrow();
    expect(() => hexParaOklch("#GGGGGG")).toThrow();
  });
});

describe("luminancia e contraste", () => {
  it("dá 21:1 entre preto e branco", () => {
    const yPreto = luminancia(hexParaOklch("#000000"));
    const yBranco = luminancia(hexParaOklch("#FFFFFF"));
    expect(contraste(yPreto, yBranco)).toBeCloseTo(21, 0);
  });

  it("é simétrico na ordem dos argumentos", () => {
    const a = luminancia(hexParaOklch("#0F62FE"));
    const b = luminancia(hexParaOklch("#FFFFFF"));
    expect(contraste(a, b)).toBeCloseTo(contraste(b, a), 6);
  });

  it("dá 1:1 para a cor contra ela mesma", () => {
    const y = luminancia(hexParaOklch("#0F62FE"));
    expect(contraste(y, y)).toBeCloseTo(1, 6);
  });
});

describe("oklchParaRgbLinear", () => {
  // Cor fora do gamute sRGB: o navegador mapeia sozinho no CSS, mas o cálculo
  // de contraste precisa de um RGB possível. Grampear é aproximação
  // deliberada — sem ela, a luminância sai de um canal negativo e o contraste
  // vira número sem sentido.
  it("grampeia canais fora de 0..1", () => {
    const canais = oklchParaRgbLinear({ L: 0.9, C: 0.37, H: 150 });
    for (const c of canais) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});

describe("girarMatiz", () => {
  it("preserva L e C e normaliza para 0..360", () => {
    const base = { L: 0.5, C: 0.2, H: 350 };
    const girado = girarMatiz(base, 40);
    expect(girado.L).toBe(0.5);
    expect(girado.C).toBe(0.2);
    expect(girado.H).toBeCloseTo(30, 6);
  });

  it("normaliza giro negativo", () => {
    expect(girarMatiz({ L: 0.5, C: 0.2, H: 10 }, -40).H).toBeCloseTo(330, 6);
  });
});

describe("formatarOklch", () => {
  it("emite a função CSS com três casas", () => {
    // Valores escolhidos para não cair em ambiguidade de arredondamento
    // binário: 0.5565.toFixed(3) depende da representação IEEE754 e não é
    // base confiável para um teste.
    expect(formatarOklch({ L: 0.5, C: 0.2, H: 261.9143 }))
      .toBe("oklch(0.5 0.2 261.914)");
  });
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

Rode: `npx vitest run tests/unit/tema-cor.test.ts`
Esperado: FALHA — `Failed to resolve import "@/lib/tema/cor"`.

- [ ] **Passo 3: implementar**

`src/lib/tema/cor.ts`:

```ts
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
 * luminância sem significado, e o laço de ajuste decidiria com base em lixo.
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
```

- [ ] **Passo 4: rodar e confirmar que passa**

Rode: `npx vitest run tests/unit/tema-cor.test.ts`
Esperado: PASSA, 11 casos.

- [ ] **Passo 5: sabotar**

Troque `0.7152` por `0.2126` em `luminancia`. Rode de novo: o caso "dá 21:1 entre preto e
branco" **deve continuar passando** (preto e branco têm todos os canais iguais), mas o de
simetria não prova nada aqui. Se nenhum teste quebrar, **acrescente** este caso e só então
desfaça a sabotagem:

```ts
it("pesa o verde mais que o vermelho, como o WCAG manda", () => {
  const yVerde = luminancia(hexParaOklch("#00FF00"));
  const yVermelho = luminancia(hexParaOklch("#FF0000"));
  expect(yVerde).toBeGreaterThan(yVermelho * 3);
});
```

Desfaça a sabotagem e confirme verde.

- [ ] **Passo 6: verificar e commitar**

```bash
npm test && npm run typecheck && npm run lint
git add src/lib/tema/cor.ts tests/unit/tema-cor.test.ts
```

```
feat(tema): matematica de cor em oklch

Giro de matiz em oklch preserva luminosidade percebida, que e o que
faz as cinco cores de grafico sairem igualmente legiveis. Em HSL nao
sairiam.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

## Task 2: Derivação da paleta

**Arquivos:**
- Criar: `src/lib/tema/paleta.ts`
- Teste: `tests/unit/tema-paleta.test.ts`

**Interfaces:**
- Consome: de `@/lib/tema/cor` — `Oklch`, `hexParaOklch`, `luminancia`, `contraste`,
  `girarMatiz`.
- Produz:
  - `const CROMA_MINIMO = 0.04`
  - `type Tokens = Record<string, Oklch>`
  - `escolherTexto(cor: Oklch): Oklch` — devolve preto ou branco
  - `derivarPaleta(marca: Oklch): { claro: Tokens; escuro: Tokens }`

> ⚠️ **Correção aplicada durante a execução (2026-08-09).** O código abaixo mostra
> `ajustarParaContraste` com um laço que move a luminosidade até atingir 4.5:1. **Esse laço
> nunca executa** e foi removido — as duas curvas de contraste se cruzam em `y = 0.179`
> valendo 4.583:1 cada, então o pior caso já passa. Se você está executando este plano do
> zero, **não construa o laço**: implemente só a escolha entre preto e branco. A § 5.2 da
> spec traz a prova. O resto desta task vale como está.

- [ ] **Passo 1: escrever o teste que falha**

`tests/unit/tema-paleta.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hexParaOklch, luminancia, contraste } from "@/lib/tema/cor";
import { derivarPaleta, CROMA_MINIMO } from "@/lib/tema/paleta";

describe("derivarPaleta", () => {
  it("recusa cor de croma abaixo do piso", () => {
    // #808080 é cinza puro: croma zero.
    expect(() => derivarPaleta(hexParaOklch("#808080"))).toThrow(/croma/i);
  });

  it("aceita marca escura sem reclamar da luminosidade", () => {
    // Azul-marinho: L baixo, croma suficiente. Recusar seria o sistema
    // sendo burro — a identidade é matiz e croma, não luminosidade.
    expect(() => derivarPaleta(hexParaOklch("#0B2545"))).not.toThrow();
  });

  it("mantém o vermelho de destructive fora da derivação", () => {
    const azul = derivarPaleta(hexParaOklch("#0F62FE"));
    const verde = derivarPaleta(hexParaOklch("#0E8A16"));
    expect(azul.claro.destructive).toEqual(verde.claro.destructive);
    expect(azul.claro.destructive.H).toBeCloseTo(27, 6);
  });

  it("dá às cinco cores de gráfico L e C iguais entre si", () => {
    const { claro } = derivarPaleta(hexParaOklch("#0F62FE"));
    const series = [1, 2, 3, 4, 5].map((n) => claro[`chart-${n}`]);
    for (const s of series) {
      expect(s.L).toBeCloseTo(series[0].L, 6);
      expect(s.C).toBeCloseTo(series[0].C, 6);
    }
    // ...e matizes distintos, senão não dá para diferenciar série nenhuma.
    const matizes = new Set(series.map((s) => Math.round(s.H)));
    expect(matizes.size).toBe(5);
  });

  it("aplica piso de croma nos gráficos, mesmo com marca pálida", () => {
    // Oklch construída, não hex: precisa de croma ENTRE o piso de entrada
    // (0.04) e o piso dos gráficos (0.10) para o caso significar alguma
    // coisa, e adivinhar um hex nessa faixa é chute.
    const { claro } = derivarPaleta({ L: 0.6, C: 0.05, H: 250 });
    expect(claro["chart-1"].C).toBeGreaterThanOrEqual(0.1);
  });

  it("deixa fundo e cartão do tema claro sem croma nenhum", () => {
    const { claro } = derivarPaleta(hexParaOklch("#0F62FE"));
    expect(claro.background.C).toBe(0);
    expect(claro.card.C).toBe(0);
  });

  it("mantém as superfícies abaixo do teto de sussurro", () => {
    const { claro, escuro } = derivarPaleta(hexParaOklch("#0F62FE"));
    expect(claro.muted.C).toBeLessThanOrEqual(0.006);
    expect(claro.accent.C).toBeLessThanOrEqual(0.012);
    expect(escuro.border.C).toBeLessThanOrEqual(0.01);
  });

  it("dá à primária o croma cheio da marca", () => {
    const marca = hexParaOklch("#0F62FE");
    const { claro } = derivarPaleta(marca);
    expect(claro.primary.C).toBeCloseTo(marca.C, 6);
    expect(claro.primary.H).toBeCloseTo(marca.H, 6);
  });

  it("iguala o ring à primária", () => {
    const { claro, escuro } = derivarPaleta(hexParaOklch("#0F62FE"));
    expect(claro.ring).toEqual(claro.primary);
    expect(escuro.ring).toEqual(escuro.primary);
  });
});

describe("invariante de contraste", () => {
  // O teste central da spec. Roda sobre uma GRADE, não sobre um caso: um
  // único exemplo passaria com o texto fixado em branco, que é exatamente o
  // defeito que este teste existe para pegar.
  it("garante 4.5:1 entre primary e primary-foreground para toda marca válida", () => {
    let casos = 0;

    for (let H = 0; H < 360; H += 15) {
      for (let C = CROMA_MINIMO; C <= 0.37; C += 0.03) {
        for (let L = 0.1; L <= 0.9; L += 0.1) {
          const { claro, escuro } = derivarPaleta({ L, C, H });

          for (const tema of [claro, escuro]) {
            const razao = contraste(
              luminancia(tema.primary),
              luminancia(tema["primary-foreground"]),
            );
            expect(razao).toBeGreaterThanOrEqual(4.5);
            casos++;
          }
        }
      }
    }

    // Prova que a grade rodou de verdade — um laço com limite errado
    // passaria em silêncio sem esta linha.
    expect(casos).toBeGreaterThan(4000);
  });

  it("escolhe preto sobre marca clara e branco sobre marca escura", () => {
    const clara = derivarPaleta({ L: 0.9, C: 0.15, H: 90 });
    expect(clara.claro["primary-foreground"].L).toBeCloseTo(0, 3);

    const escura = derivarPaleta({ L: 0.2, C: 0.15, H: 260 });
    expect(escura.claro["primary-foreground"].L).toBeCloseTo(1, 3);
  });
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

Rode: `npx vitest run tests/unit/tema-paleta.test.ts`
Esperado: FALHA — `Failed to resolve import "@/lib/tema/paleta"`.

- [ ] **Passo 3: implementar**

`src/lib/tema/paleta.ts`:

```ts
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
```

- [ ] **Passo 4: rodar e confirmar que passa**

Rode: `npx vitest run tests/unit/tema-paleta.test.ts`
Esperado: PASSA. A grade roda ~4.700 casos e deve levar menos de dois segundos — é
aritmética pura.

> Se o caso "escolhe preto sobre marca clara" falhar, **não relaxe o teste.** Confira
> primeiro se `ajustarParaContraste` está comparando contra `alvo` e não contra a cor
> original.

- [ ] **Passo 5: sabotar (três vezes — é o teste central da spec)**

1. Em `ajustarParaContraste`, troque `const texto = textoBranco ? BRANCO : PRETO;` por
   `const texto = BRANCO;`. A grade **deve** quebrar, nos matizes amarelos.
2. Em `derivarPaleta`, troque `destructive: DESTRUCTIVE_CLARO` por
   `destructive: claroPrim.primaria`. O caso do vermelho fixo **deve** quebrar.
3. Em `gráficos`, troque `L` por `L + i * 0.05`. O caso de L e C iguais **deve** quebrar.

Desfaça as três e confirme verde.

- [ ] **Passo 6: verificar e commitar**

```bash
npm test && npm run typecheck && npm run lint
git add src/lib/tema/paleta.ts tests/unit/tema-paleta.test.ts
```

```
feat(tema): deriva ~30 tokens de um hex da marca

Contraste do texto sobre a primaria e calculado, nunca escolhido: o
laco move a luminosidade ate 4.5:1. Testado sobre uma grade de ~4700
combinacoes, nao sobre um caso — um exemplo so passaria com o texto
fixado em branco.

Vermelho de destructive fica fora da derivacao. Em cliente de marca
vermelha, "Excluir" ficaria igual a "Salvar".

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

## Task 3: Validação do config

**Arquivos:**
- Modificar: `config/client.schema.ts`
- Modificar: `config/client.ts`
- Teste: `tests/unit/client-config.test.ts`

**Interfaces:**
- Consome: de `@/lib/tema/cor` — `hexParaOklch`; de `@/lib/tema/paleta` — `CROMA_MINIMO`.
- Produz: `marcaSchema` exportado de `config/client.schema.ts`; `client` passa a ser o
  resultado de `clientConfigSchema.parse(...)`.

- [ ] **Passo 1: escrever o teste que falha**

`tests/unit/client-config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { marcaSchema } from "../../config/client.schema";

describe("marcaSchema", () => {
  it("aceita uma marca completa", () => {
    const r = marcaSchema.safeParse({
      nome: "AutoCenter",
      corPrimaria: "#0F62FE",
      fonte: "Geist",
      logo: "/logo.svg",
    });
    expect(r.success).toBe(true);
  });

  it("aceita marca sem logo — o logo é opcional", () => {
    const r = marcaSchema.safeParse({
      nome: "AutoCenter",
      corPrimaria: "#0F62FE",
      fonte: "Geist",
    });
    expect(r.success).toBe(true);
  });

  it("recusa hex malformado", () => {
    for (const cor of ["0F62FE", "#FFF", "#GGGGGG", "azul"]) {
      expect(marcaSchema.safeParse({ nome: "X", corPrimaria: cor, fonte: "Geist" }).success)
        .toBe(false);
    }
  });

  it("recusa cinza — croma abaixo do piso", () => {
    const r = marcaSchema.safeParse({
      nome: "X",
      corPrimaria: "#808080",
      fonte: "Geist",
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r)).toMatch(/croma/i);
  });

  it("recusa fonte fora da lista fechada", () => {
    const r = marcaSchema.safeParse({
      nome: "X",
      corPrimaria: "#0F62FE",
      fonte: "Comic Sans",
    });
    expect(r.success).toBe(false);
  });
});

describe("config/client.ts", () => {
  it("passa pela validação de verdade, não só pelo tipo", async () => {
    // Antes desta task o arquivo só DECLARAVA o tipo e o schema nunca rodava.
    // Se esta importação lançar, o fork está mal configurado — e é para
    // quebrar aqui, no build, e não em produção.
    const { client } = await import("../../config/client");
    expect(client.marca.corPrimaria).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

Rode: `npx vitest run tests/unit/client-config.test.ts`
Esperado: FALHA — `marcaSchema` não é exportado.

- [ ] **Passo 3: implementar o schema**

Em `config/client.schema.ts`, substitua o campo `marca` do `clientConfigSchema` e
acrescente antes dele:

```ts
import { hexParaOklch } from "../src/lib/tema/cor";
import { CROMA_MINIMO } from "../src/lib/tema/paleta";

/** Lista FECHADA por causa do CSP: `font-src 'self'` obriga a empacotar no build. */
export const FONTES = ["Geist", "Inter", "Manrope", "IBM Plex Sans"] as const;

export const marcaSchema = z.object({
  nome: z.string().min(1),
  corPrimaria: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Cor da marca precisa ser #RRGGBB")
    .refine(
      (hex) => hexParaOklch(hex).C >= CROMA_MINIMO,
      `Cor da marca tem croma abaixo de ${CROMA_MINIMO}: é cinza na prática. ` +
        `Abaixo desse piso as superfícies derivadas ficam indistinguíveis de ` +
        `neutro e o white-label para de funcionar em silêncio.`,
    ),
  fonte: z.enum(FONTES),
  /** Opcional: fork sem arquivo de logo mostra o nome do cliente em texto. */
  logo: z.string().startsWith("/").optional(),
});
```

E dentro de `clientConfigSchema`, troque o bloco `marca: z.object({...})` por
`marca: marcaSchema,`.

- [ ] **Passo 4: fazer o config executar o schema**

Em `config/client.ts`, troque a declaração de tipo por uma validação de verdade:

```ts
import { clientConfigSchema } from "./client.schema";

/**
 * `parse` e não anotação de tipo: até 2026-08-09 este arquivo só DECLARAVA
 * `: ClientConfig`, então o schema Zod existia e nunca rodava — `marca` e
 * `entidade` podiam conter qualquer coisa sem ninguém notar.
 *
 * Validar em escopo de módulo já derrubou o deploy deste projeto uma vez: o
 * módulo `whatsapp` validava VARIÁVEIS DE AMBIENTE na importação, e
 * `next build` fazia a validação rodar sem elas na Vercel. Aqui é seguro pelo
 * motivo oposto — os valores estão neste arquivo versionado, não no ambiente,
 * e não há como faltarem no build.
 */
export const client = clientConfigSchema.parse({
  nome: "AutoCenter Exemplo",
  // ... resto do objeto EXATAMENTE como está hoje, com duas mudanças em `marca`:
  marca: {
    nome: "AutoCenter Exemplo",
    corPrimaria: "#0F62FE",
    fonte: "Geist",
    // `logo` sai: não há arquivo, e o campo agora é opcional.
  },
});
```

> Mantenha `modulos`, `entidade`, `funil` e `whatsapp` idênticos ao que já estão. Esta task
> só mexe em `marca` e no `parse`.

- [ ] **Passo 5: rodar e confirmar que passa**

Rode: `npx vitest run tests/unit/client-config.test.ts && npm test`
Esperado: PASSA, e a suíte inteira continua verde — `painel-nav.test.tsx` mocka
`config/client`, então não é afetado.

- [ ] **Passo 6: sabotar**

Troque `corPrimaria: "#0F62FE"` por `"#808080"` em `config/client.ts`. O teste
"passa pela validação de verdade" **deve** falhar na importação. Desfaça.

- [ ] **Passo 7: verificar e commitar**

```bash
npm test && npm run typecheck && npm run lint && npm run build
git add config/client.schema.ts config/client.ts tests/unit/client-config.test.ts
```

```
feat(config): valida a marca no build, nao so no tipo

O schema Zod existia e nunca rodava: o arquivo so anotava o tipo.
Fork com cor invalida ou fonte fora da lista agora nao compila, em
vez de servir tela ilegivel.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

## Task 4: Emissão do CSS e layout raiz

**Arquivos:**
- Criar: `src/lib/tema/fontes.ts`, `src/lib/tema/index.ts`
- Modificar: `src/app/layout.tsx`
- Teste: `tests/unit/tema-css.test.ts`

**Interfaces:**
- Consome: `derivarPaleta`, `hexParaOklch`, `formatarOklch`, `client`.
- Produz: `derivarTema(marca): string`; `fonteDaMarca(nome): NextFontWithVariable`.

- [ ] **Passo 1: escrever o teste que falha**

`tests/unit/tema-css.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { derivarTema } from "@/lib/tema";

const css = derivarTema({ corPrimaria: "#0F62FE" });

describe("derivarTema", () => {
  it("dobra a especificidade dos dois blocos", () => {
    // `:root:root` casa o mesmo elemento que `:root`, com especificidade
    // maior — é o que torna a vitória sobre globals.css independente da
    // ordem em que o Next insere o bundle de CSS.
    expect(css).toContain(":root:root{");
    expect(css).toContain(":root:root.dark{");
  });

  it("emite os tokens obrigatórios nos dois temas", () => {
    for (const bloco of css.split(":root:root").slice(1)) {
      for (const token of ["--primary", "--primary-foreground", "--background",
                           "--sidebar", "--ring", "--destructive", "--chart-1"]) {
        expect(bloco).toContain(`${token}:`);
      }
    }
  });

  it("usa a função oklch do CSS", () => {
    expect(css).toMatch(/--primary:oklch\([\d.]+ [\d.]+ [\d.]+\)/);
  });

  it("não emite quebra de linha — vai inline no HTML", () => {
    expect(css).not.toContain("\n");
  });

  it("propaga a recusa de cor inválida", () => {
    expect(() => derivarTema({ corPrimaria: "#808080" })).toThrow(/croma/i);
  });
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

Rode: `npx vitest run tests/unit/tema-css.test.ts`
Esperado: FALHA — `Failed to resolve import "@/lib/tema"`.

- [ ] **Passo 3: implementar a emissão**

`src/lib/tema/index.ts`:

```ts
import { hexParaOklch, formatarOklch } from "./cor";
import { derivarPaleta, type Tokens } from "./paleta";

function bloco(seletor: string, tokens: Tokens): string {
  const linhas = Object.entries(tokens)
    .map(([nome, cor]) => `--${nome}:${formatarOklch(cor)}`)
    .join(";");
  return `${seletor}{${linhas}}`;
}

/**
 * Devolve o CSS que o layout raiz injeta numa tag `<style>`.
 *
 * **Tag `<style>` e não atributo `style` no `<html>`:** atributo carrega um
 * único conjunto de valores, e precisamos de claro E escuro no mesmo
 * documento. Atributo tornaria o modo escuro impossível.
 *
 * **`:root:root` e não `:root`:** casa exatamente o mesmo elemento, com
 * especificidade (0,2,0) contra (0,1,0). Vence os valores de `globals.css`
 * sem depender da ordem de inserção, que quem decide é o Next. O
 * `globals.css` fica intacto como fallback: se a injeção falhar, aparece o
 * cinza padrão em vez de tela sem cor.
 *
 * **Sem nonce, e o CSP fica como está.** `style-src` tem `'unsafe-inline'`
 * porque o kanban pinta etapas com atributo `style`; acrescentar nonce à
 * diretiva INVALIDARIA o `'unsafe-inline'` e quebraria aquilo.
 */
export function derivarTema(marca: { corPrimaria: string }): string {
  const { claro, escuro } = derivarPaleta(hexParaOklch(marca.corPrimaria));
  return bloco(":root:root", claro) + bloco(":root:root.dark", escuro);
}
```

`src/lib/tema/fontes.ts`:

```ts
import { Geist, Inter, Manrope, IBM_Plex_Sans } from "next/font/google";

import { FONTES } from "../../../config/client.schema";

/**
 * Lista FECHADA porque o CSP tem `font-src 'self'`: a fonte precisa estar
 * empacotada no build, e `next/font` só empacota o que é importado
 * estaticamente. Fonte digitada livremente no config não teria como chegar
 * ao navegador.
 *
 * As quatro entram no bundle e só a escolhida recebe a variável — custo
 * irrelevante para quatro fontes, e evita um passo de geração de código.
 *
 * `FONTES` vem do schema e não é redigitada aqui: o `Record` abaixo é tipado
 * por ela, então acrescentar uma fonte na lista sem carregá-la aqui **não
 * compila**. Duas listas soltas divergiriam em silêncio.
 */
type NomeDeFonte = (typeof FONTES)[number];

const POR_NOME: Record<NomeDeFonte, { variable: string }> = {
  Geist: Geist({ variable: "--font-marca", subsets: ["latin"] }),
  Inter: Inter({ variable: "--font-marca", subsets: ["latin"] }),
  Manrope: Manrope({ variable: "--font-marca", subsets: ["latin"] }),
  "IBM Plex Sans": IBM_Plex_Sans({
    variable: "--font-marca",
    subsets: ["latin"],
    weight: ["400", "500", "600", "700"],
  }),
};

export function fonteDaMarca(nome: NomeDeFonte) {
  return POR_NOME[nome];
}
```

- [ ] **Passo 4: ligar no layout raiz**

Substitua `src/app/layout.tsx` inteiro:

```tsx
import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";

import { client } from "../../config/client";
import { derivarTema } from "@/lib/tema";
import { fonteDaMarca } from "@/lib/tema/fontes";
import "./globals.css";

const fonte = fonteDaMarca(client.marca.fonte);
// Mono não entra no config: nenhuma tela mostra código, e o único uso é
// herdado do create-next-app.
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const tema = derivarTema(client.marca);

export const metadata: Metadata = {
  title: client.nome,
  description: `Painel de gestão — ${client.nome}`,
};

/**
 * `suppressHydrationWarning` no `<html>`: o `ThemeProvider` (montado no
 * layout do painel) acrescenta `class="dark"` a ESTE elemento depois da
 * hidratação, e sem isto o React reclama da diferença entre servidor e
 * cliente.
 *
 * O layout raiz continua SÍNCRONO: `client` é importação estática, não há
 * `headers()` aqui. Ler o nonce na raiz tornaria toda rota dinâmica.
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${fonte.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/*
          `dangerouslySetInnerHTML` é a única forma de emitir CSS inline em
          React, e aqui não há superfície de injeção: `tema` é constante de
          build derivada de `config/client.ts` — arquivo versionado, não
          entrada de usuário — e todo valor passa por `formatarOklch`, que
          emite exclusivamente números. Nenhum texto do config chega a este
          string.
        */}
        <style dangerouslySetInnerHTML={{ __html: tema }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
```

E em `src/app/globals.css`, dentro do bloco `@theme inline`, troque:

```css
  --font-sans: var(--font-geist-sans);
```

por:

```css
  --font-sans: var(--font-marca);
```

- [ ] **Passo 5: rodar e confirmar que passa**

```bash
npx vitest run tests/unit/tema-css.test.ts
npm run build
```

Esperado: testes passam e o build compila. Suba com `npm start` e confirme no inspetor que
`<html>` tem `lang="pt-BR"` e que existe uma tag `<style>` com `:root:root{--primary:oklch(`.

- [ ] **Passo 6: sabotar**

Troque `:root:root` por `:root` em `bloco()`. O caso de especificidade **deve** quebrar.
Desfaça.

- [ ] **Passo 7: verificar e commitar**

```bash
npm test && npm run typecheck && npm run lint
git add src/lib/tema/index.ts src/lib/tema/fontes.ts src/app/layout.tsx src/app/globals.css tests/unit/tema-css.test.ts
```

```
feat(tema): injeta os tokens da marca no layout raiz

Seletor `:root:root` dobra a especificidade sem mudar o que casa, o
que torna a vitoria sobre globals.css independente da ordem em que o
Next insere o bundle. globals.css fica como fallback.

lang passa a pt-BR: o valor "en" fazia leitor de tela pronunciar
portugues com fonetica inglesa.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

## Task 5: Componente da marca

**Arquivos:**
- Criar: `src/components/marca.tsx`
- Teste: `tests/unit/marca.test.tsx`

**Interfaces:**
- Consome: `client` de `config/client`.
- Produz: `<Marca />` — componente síncrono, sem props.

- [ ] **Passo 1: escrever o teste que falha**

`tests/unit/marca.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  marca: { nome: "AutoCenter", corPrimaria: "#0F62FE", fonte: "Geist" } as {
    nome: string;
    corPrimaria: string;
    fonte: string;
    logo?: string;
  },
}));

vi.mock("../../config/client", () => ({
  client: {
    get nome() {
      return mocks.marca.nome;
    },
    get marca() {
      return mocks.marca;
    },
  },
}));

import { Marca } from "@/components/marca";

afterEach(() => {
  cleanup();
  mocks.marca = { nome: "AutoCenter", corPrimaria: "#0F62FE", fonte: "Geist" };
});

describe("Marca", () => {
  it("sem logo, mostra o nome do cliente em texto", () => {
    render(<Marca />);
    expect(screen.getByText("AutoCenter")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("com logo, mostra a imagem com o nome como texto alternativo", () => {
    mocks.marca = { ...mocks.marca, logo: "/logo.svg" };
    render(<Marca />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "/logo.svg");
    expect(img).toHaveAttribute("alt", "AutoCenter");
  });
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

Rode: `npx vitest run tests/unit/marca.test.tsx`
Esperado: FALHA — `Failed to resolve import "@/components/marca"`.

- [ ] **Passo 3: implementar**

`src/components/marca.tsx`:

```tsx
import { client } from "../../config/client";

/**
 * A marca do cliente no topo da barra lateral.
 *
 * Dois caminhos, e o de texto é o NORMAL enquanto não houver arquivo de logo
 * — não é remendo. `marca.logo` é opcional no schema justamente por isso.
 *
 * Sem `next/image`: SVG não se beneficia do otimizador. Sem `onError`: exigiria
 * componente de cliente, e o comportamento nativo do navegador com `alt` de
 * imagem quebrada já entrega a mesma degradação de graça.
 */
export function Marca() {
  if (!client.marca.logo) {
    return <span className="text-sm font-semibold">{client.nome}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={client.marca.logo} alt={client.nome} className="h-6 w-auto" />
  );
}
```

- [ ] **Passo 4: rodar e confirmar que passa**

Rode: `npx vitest run tests/unit/marca.test.tsx` — esperado: PASSA, 2 casos.

- [ ] **Passo 5: sabotar**

Troque `if (!client.marca.logo)` por `if (false)`. O caso "sem logo" **deve** quebrar
(imagem com `src` indefinido). Desfaça.

- [ ] **Passo 6: verificar e commitar**

```bash
npm test && npm run typecheck && npm run lint
git add src/components/marca.tsx tests/unit/marca.test.tsx
```

```
feat(marca): logo com nome do cliente como caminho normal

Fork sem arquivo de logo mostra o nome em texto — estado esperado, nao
degradacao. `marca.logo` e opcional no schema pelo mesmo motivo.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

## Task 6: Links de navegação (cliente)

**Arquivos:**
- Criar: `src/components/nav-links.tsx`
- Teste: `tests/unit/nav-links.test.tsx`

**Interfaces:**
- Consome: nada do projeto — recebe tudo por prop, de propósito.
- Produz:
  - `type LinkDoPainel = { href: string; label: string; icone: LucideIcon }`
  - `<NavLinks grupos={LinkDoPainel[][]} />`

- [ ] **Passo 1: escrever o teste que falha**

`tests/unit/nav-links.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LayoutDashboard, Target, Columns3 } from "lucide-react";

const mocks = vi.hoisted(() => ({ caminho: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.caminho }));

// `next/link` mockado para INSPECIONAR as props. `prefetch` não vira atributo
// no DOM, então sem isto não há como provar que a proteção está em todos os
// links — e a alternativa (um atributo espelho `data-prefetch`) colocaria
// artefato de teste no código de produção.
const linksRenderizados = vi.hoisted(() => [] as { href: string; prefetch: unknown }[]);
vi.mock("next/link", () => ({
  default: ({ href, prefetch, children, ...resto }: never) => {
    const props = { href, prefetch } as { href: string; prefetch: unknown };
    linksRenderizados.push(props);
    return <a href={props.href} {...(resto as object)}>{children as React.ReactNode}</a>;
  },
}));

import { NavLinks } from "@/components/nav-links";

const GRUPO_A = [
  { href: "/", label: "Dashboard", icone: LayoutDashboard },
  { href: "/leads", label: "Leads", icone: Target },
  { href: "/leads/kanban", label: "Funil", icone: Columns3 },
];

afterEach(() => {
  cleanup();
  mocks.caminho = "/";
  linksRenderizados.length = 0;
});

describe("NavLinks", () => {
  it("marca o item ativo com aria-current", () => {
    mocks.caminho = "/leads";
    render(<NavLinks grupos={[GRUPO_A]} />);
    expect(screen.getByRole("link", { name: /Leads/ })).toHaveAttribute("aria-current", "page");
  });

  // A regra do href MAIS LONGO. Com `startsWith` simples, /leads e
  // /leads/kanban acendem os dois na página do kanban.
  it("acende só o href mais longo que casa", () => {
    mocks.caminho = "/leads/kanban";
    render(<NavLinks grupos={[GRUPO_A]} />);
    expect(screen.getByRole("link", { name: /Funil/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Leads/ })).not.toHaveAttribute("aria-current");
  });

  it("não deixa a raiz acender em toda rota", () => {
    mocks.caminho = "/contatos";
    render(<NavLinks grupos={[GRUPO_A]} />);
    expect(screen.getByRole("link", { name: /Dashboard/ })).not.toHaveAttribute("aria-current");
  });

  // Sem isto, "Sair" deixa de revogar sessão: o Next pré-carrega a rota
  // protegida, a resposta chega depois do logout e o Auth.js reemite o cookie.
  it("põe prefetch=false em TODOS os links", () => {
    render(<NavLinks grupos={[GRUPO_A]} />);
    expect(linksRenderizados).toHaveLength(3);
    for (const link of linksRenderizados) {
      expect(link.prefetch).toBe(false);
    }
  });

  it("não renderiza régua quando só há um grupo com conteúdo", () => {
    const { container } = render(<NavLinks grupos={[GRUPO_A, []]} />);
    expect(container.querySelectorAll("hr")).toHaveLength(0);
  });

  it("renderiza régua entre dois grupos com conteúdo", () => {
    const grupoB = [{ href: "/usuarios", label: "Equipe", icone: Target }];
    const { container } = render(<NavLinks grupos={[GRUPO_A, grupoB]} />);
    expect(container.querySelectorAll("hr")).toHaveLength(1);
  });
});
```

- [ ] **Passo 2: rodar e confirmar que falha**

Rode: `npx vitest run tests/unit/nav-links.test.tsx`
Esperado: FALHA — `Failed to resolve import "@/components/nav-links"`.

- [ ] **Passo 3: implementar**

`src/components/nav-links.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";

export type LinkDoPainel = { href: string; label: string; icone: LucideIcon };

/**
 * Só o que precisa de `usePathname` mora aqui.
 *
 * A nav inteira NÃO virou componente de cliente de propósito: isso arrastaria
 * `config/client` para o navegador, incluindo número e mensagem de WhatsApp.
 * Não é segredo, mas é dado que não precisa sair do servidor — e manteria
 * `PainelNav` impossível de testar sem mock de banco. Este componente recebe
 * os links prontos e não importa config nenhum.
 */
export function NavLinks({ grupos }: { grupos: LinkDoPainel[][] }) {
  const caminho = usePathname();

  const todos = grupos.flat();
  const casam = todos.filter(
    (l) => caminho === l.href || (l.href !== "/" && caminho.startsWith(`${l.href}/`)),
  );
  // O MAIS LONGO vence: com prefixo simples, /leads e /leads/kanban acenderiam
  // juntos na página do funil.
  const ativo = casam.sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const comConteudo = grupos.filter((g) => g.length > 0);

  return (
    <nav className="flex flex-col gap-1">
      {comConteudo.map((grupo, i) => (
        <div key={i} className="flex flex-col gap-1">
          {/* A régua só existe ENTRE grupos com conteúdo. Renderizá-la sempre
              deixaria um separador pendurado sobre o nada quando o módulo
              está desligado E o usuário não é admin — combinação que ninguém
              testa à mão. */}
          {i > 0 && <hr className="my-2 border-sidebar-border" />}
          {grupo.map(({ href, label, icone: Icone }) => (
            <Link
              key={href}
              href={href}
              prefetch={false}
              aria-current={href === ativo ? "page" : undefined}
              className={
                href === ativo
                  ? "flex items-center gap-2 rounded-md bg-sidebar-accent px-2 py-1.5 text-sm font-medium text-sidebar-accent-foreground"
                  : "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
              }
            >
              <Icone size={16} aria-hidden />
              {label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
```

> Nada de atributo espelho no código de produção. `prefetch` não aparece no DOM, e a prova
> de que ele está em todos os links vem do mock de `next/link` no teste, que inspeciona as
> props diretamente. É esse teste que trava a regressão do logout.

- [ ] **Passo 4: rodar e confirmar que passa**

Rode: `npx vitest run tests/unit/nav-links.test.tsx` — esperado: PASSA, 6 casos.

- [ ] **Passo 5: sabotar (duas)**

1. Troque o `sort` por `casam[0]?.href`. O caso do href mais longo **deve** quebrar.
2. Troque `{i > 0 && <hr .../>}` por `<hr ... />`. O caso da régua **deve** quebrar.

Desfaça as duas.

- [ ] **Passo 6: verificar e commitar**

```bash
npm test && npm run typecheck && npm run lint
git add src/components/nav-links.tsx tests/unit/nav-links.test.tsx
```

```
feat(nav): item ativo pelo href mais longo, com aria-current

Prefixo simples acenderia /leads e /leads/kanban juntos na pagina do
funil. aria-current entra porque estado ativo so por cor nao chega a
quem usa leitor de tela.

Regua so entre grupos com conteudo: separador pendurado sobre o nada
aparece quando o modulo esta desligado E o usuario nao e admin.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

## Task 7: Barra lateral (servidor)

**Arquivos:**
- Criar: `src/components/ui/sheet.tsx`
- Modificar: `src/components/painel-nav.tsx` (reescrita)
- Modificar: `tests/unit/painel-nav.test.tsx`

**Interfaces:**
- Consome: `<Marca />` (Task 5), `<NavLinks grupos={...} />` e `LinkDoPainel` (Task 6),
  `moduloAtivo`, `hasPermission`, `sairAction`, `<NotificationBell>`, e
  **`<ThemeToggle />` da Task 8**.
- Produz: `<PainelNav>` com a mesma assinatura de props de hoje.

> ⚠️ **Esta task importa `<ThemeToggle />`, que só nasce na Task 8.** As duas se cruzam.
> Faça o **Passo 1 da Task 8** (criar `src/components/theme-toggle.tsx`) antes do Passo 4
> daqui, ou nada compila. O resto da Task 8 pode esperar.

- [ ] **Passo 1: acrescentar o primitivo da gaveta**

```bash
npx shadcn@latest add sheet
```

Confirme que criou `src/components/ui/sheet.tsx` e que `npm run lint` continua limpo.

- [ ] **Passo 2: escrever os testes que faltam**

Acrescente a `tests/unit/painel-nav.test.tsx` (mantendo os casos existentes e os mocks de
`config/client`, `@/core/notifications/actions` e `next/navigation` que já estão lá — só
some `usePathname` ao mock de `next/navigation`):

```tsx
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/",
}));
```

E os casos novos:

```tsx
it("mostra o nome do usuario no rodape da barra", () => {
  render(<PainelNav nomeUsuario="Rodrigo" papelUsuario="ADMIN" />);
  expect(screen.getByTestId("usuario-logado")).toHaveTextContent("Rodrigo");
});

it("mantem o logout como form, nunca como link", () => {
  const { container } = render(<PainelNav nomeUsuario="Rodrigo" papelUsuario="ADMIN" />);
  // GET que desloga e disparavel por <img src> de qualquer site.
  expect(container.querySelector("form")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Sair/ })).not.toBeInTheDocument();
});

it("nao renderiza regua para VENDEDOR com o modulo desligado", () => {
  mocks.modulos = [];
  const { container } = render(<PainelNav nomeUsuario="Ana" papelUsuario="VENDEDOR" />);
  expect(container.querySelectorAll("hr")).toHaveLength(0);
});
```

> ⚠️ Este caso **muta `mocks.modulos`**. Confirme que o arquivo tem um `afterEach` que o
> devolve ao valor inicial; se não tiver, acrescente — senão os casos seguintes herdam a
> lista vazia e passam ou falham por ordem de execução, que é o pior tipo de teste
> instável:
>
> ```tsx
> afterEach(() => {
>   cleanup();
>   mocks.modulos = ["whatsapp"];
> });
> ```

- [ ] **Passo 3: rodar e confirmar que falha**

Rode: `npx vitest run tests/unit/painel-nav.test.tsx`
Esperado: FALHA nos três casos novos — não há `data-testid` no rodapé nem grupos.

- [ ] **Passo 4: reescrever a nav**

`src/components/painel-nav.tsx`:

```tsx
import {
  LayoutDashboard, Target, Columns3, Users, ListChecks, MessageSquare, UserCog, Menu,
} from "lucide-react";

import { moduloAtivo } from "@/lib/module-gate";
import { hasPermission } from "@/core/auth/permissions";
import { sairAction } from "@/core/auth/actions";
import { Marca } from "@/components/marca";
import { NavLinks, type LinkDoPainel } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell, type NotificacaoApresentada } from "@/components/notifications/notification-bell";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import type { Role } from "@prisma/client";

const GRUPO_TRABALHO: LinkDoPainel[] = [
  { href: "/", label: "Dashboard", icone: LayoutDashboard },
  { href: "/leads", label: "Leads", icone: Target },
  { href: "/leads/kanban", label: "Funil", icone: Columns3 },
  { href: "/contatos", label: "Contatos", icone: Users },
  { href: "/tasks", label: "Tarefas", icone: ListChecks },
];

/**
 * `PainelNav` continua SÍNCRONA e sem Prisma — é o que a deixa testável com
 * `render(<PainelNav />)` sem nenhum mock de banco. Quem busca notificação é
 * `(painel)/layout.tsx`, e o valor chega por prop.
 */
export function PainelNav({
  notificacoesNaoLidas = [],
  nomeUsuario,
  papelUsuario,
}: {
  notificacoesNaoLidas?: NotificacaoApresentada[];
  nomeUsuario?: string;
  papelUsuario?: Role;
} = {}) {
  // Segundo grupo: módulo e administração. Pode ficar VAZIO — vendedor num
  // fork sem whatsapp. `NavLinks` é quem trata a régua nesse caso.
  const grupoExtra: LinkDoPainel[] = [
    ...(moduloAtivo("whatsapp")
      ? [{ href: "/conversas", label: "Conversas", icone: MessageSquare }]
      : []),
    ...(papelUsuario && hasPermission(papelUsuario, "gerenciar_usuarios")
      ? [{ href: "/usuarios", label: "Equipe", icone: UserCog }]
      : []),
  ];

  const grupos = [GRUPO_TRABALHO, grupoExtra];
  const temNaoLida = notificacoesNaoLidas.length > 0;

  const conteudo = (
    <div className="flex h-full flex-col gap-4 p-3">
      <div className="px-2 py-1">
        <Marca />
      </div>

      <div className="flex-1">
        <NavLinks grupos={grupos} />
      </div>

      <div className="border-t pt-3">
        <div className="flex items-center gap-2 px-2">
          <Avatar className="size-6">
            <AvatarFallback>{nomeUsuario?.slice(0, 1).toUpperCase() ?? "?"}</AvatarFallback>
          </Avatar>
          {/* Quem está logado, visível sempre: num computador compartilhado
              da revenda, é o que faz alguém perceber que ficou na conta do
              colega antes de mexer no funil no nome dele. */}
          {nomeUsuario && (
            <span className="truncate text-sm text-muted-foreground" data-testid="usuario-logado">
              {nomeUsuario}
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center gap-1 px-1">
          <ThemeToggle />
          <NotificationBell notificacoes={notificacoesNaoLidas} />
          {/* Form + Server Action em vez de link: um GET que desloga pode ser
              disparado por qualquer site com um <img src>. Ver sairAction. */}
          <form action={sairAction} className="ml-auto">
            <button
              type="submit"
              className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:text-foreground"
            >
              Sair
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden w-[248px] shrink-0 border-r bg-sidebar lg:block">{conteudo}</aside>

      <div className="flex items-center gap-2 border-b p-2 lg:hidden">
        <Sheet>
          <SheetTrigger
            aria-label="Abrir menu"
            className="relative rounded-md p-2 hover:bg-sidebar-accent"
          >
            <Menu size={18} />
            {/* O sino tem um único ponto de montagem, no rodapé — no celular
                ele fica dentro da gaveta. Este ponto evita que o aviso se
                perca atrás de um toque, sem criar um segundo <NotificationBell>
                para o e2e confundir com o primeiro. */}
            {temNaoLida && (
              <span className="absolute right-1 top-1 size-2 rounded-full bg-primary" />
            )}
          </SheetTrigger>
          <SheetContent side="left" className="w-[248px] bg-sidebar p-0">
            {conteudo}
          </SheetContent>
        </Sheet>
        <Marca />
      </div>
    </>
  );
}
```

- [ ] **Passo 5: rodar e confirmar que passa**

Rode: `npx vitest run tests/unit/painel-nav.test.tsx`
Esperado: PASSA — os casos antigos e os três novos.

> Se aparecer erro de `ThemeToggle` não encontrado, execute a **Task 8 primeiro** e volte.
> As duas tasks se cruzam nesse ponto.

- [ ] **Passo 6: sabotar**

Remova `data-testid="usuario-logado"`. O caso do rodapé **deve** quebrar. Troque o
`<form action={sairAction}>` por um `<Link href="/sair">Sair</Link>` — o caso do logout
**deve** quebrar. Desfaça as duas.

- [ ] **Passo 7: ajustar o layout do painel**

Em `src/app/(painel)/layout.tsx`, troque a `<div className="min-h-screen">` que envolve
`<PainelNav>` e `<main>` por:

```tsx
<div className="flex min-h-screen flex-col lg:flex-row">
  <PainelNav … />
  <main className="flex-1">{children}</main>
</div>
```

- [ ] **Passo 8: verificar e commitar**

```bash
npm test && npm run typecheck && npm run lint && npm run build
git add src/components/painel-nav.tsx src/components/ui/sheet.tsx tests/unit/painel-nav.test.tsx src/app/\(painel\)/layout.tsx
```

```
feat(nav): barra lateral com rodape de usuario

Usuario, tema, sino e Sair descem para o rodape da barra e a barra
superior some no desktop. No celular vira gaveta, e o botao que a abre
ganha um ponto quando ha nao lida — o sino tem um ponto de montagem
so, entao o aviso nao se perde atras de um toque.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

## Task 8: Tema claro/escuro

**Arquivos:**
- Criar: `src/components/theme-toggle.tsx`
- Modificar: `src/app/(painel)/layout.tsx`
- Teste: `tests/e2e/tema.spec.ts`

**Interfaces:**
- Consome: `next-themes` 0.4.6 (`ThemeProvider`, `useTheme`).
- Produz: `<ThemeToggle />` — componente de cliente, sem props.

- [ ] **Passo 1: implementar o interruptor**

`src/components/theme-toggle.tsx`:

```tsx
"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Dois estados, sem "sistema" — `enableSystem={false}` no provider.
 *
 * `montado` evita erro de hidratação: no servidor não há como saber o tema
 * guardado, então o primeiro render precisa ser igual dos dois lados. Sem
 * isso, o React reclama de o ícone divergir.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  const escuro = resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label={escuro ? "Usar tema claro" : "Usar tema escuro"}
      data-tema={montado ? resolvedTheme : undefined}
      onClick={() => setTheme(escuro ? "light" : "dark")}
      className="rounded-md p-2 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
    >
      {montado && escuro ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
```

- [ ] **Passo 2: montar o provider com o nonce**

Em `src/app/(painel)/layout.tsx`, acrescente as importações e envolva o retorno:

```tsx
import { headers } from "next/headers";
import { ThemeProvider } from "next-themes";
```

E dentro da função (que **já é `async`**), antes do `return`:

```tsx
  // `headers()` é assíncrona no Next 16. Ler o nonce aqui não custa nada:
  // este layout já é `force-dynamic`. Na raiz, tornaria TODA rota dinâmica
  // para servir um recurso que só o painel usa.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
```

E o retorno passa a ser:

```tsx
  return (
    <ThemeProvider
      attribute="class"
      themes={["light", "dark"]}
      enableSystem={false}
      defaultTheme="dark"
      nonce={nonce}
    >
      <div className="flex min-h-screen flex-col lg:flex-row">
        <PainelNav
          notificacoesNaoLidas={notificacoesNaoLidas}
          nomeUsuario={usuario.nome}
          papelUsuario={usuario.papel}
        />
        <main className="flex-1">{children}</main>
      </div>
    </ThemeProvider>
  );
```

> ⚠️ **O `nonce` não é opcional na prática.** `script-src` usa `'strict-dynamic'`, o que faz
> o `'self'` ser ignorado — só roda script com nonce. Sem ele, o script anti-flash é
> bloqueado e o tema escuro pisca branco a cada carga, **e só em produção**.

- [ ] **Passo 3: escrever o teste e2e**

`tests/e2e/tema.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test.describe("tema", () => {
  test("alterna e sobrevive à navegação", async ({ page }) => {
    await page.goto("/");

    const html = page.locator("html");
    await expect(html).toHaveClass(/dark/);

    await page.getByRole("button", { name: "Usar tema claro" }).click();
    await expect(html).not.toHaveClass(/dark/);

    // A escolha precisa sobreviver a uma navegação de verdade, não só ao
    // clique — é onde persistência mal ligada quebra.
    await page.getByRole("link", { name: /Leads/ }).click();
    await page.waitForURL("**/leads");
    await expect(html).not.toHaveClass(/dark/);
  });

  test("o script de tema não é bloqueado pelo CSP", async ({ page }) => {
    // Testa a CAUSA, não o sintoma. "Piscou branco?" é difícil de medir sem
    // captura de vídeo e daria teste instável; o que realmente quebra é o
    // script inline sem nonce sendo recusado pelo `strict-dynamic`, e isso
    // o navegador reporta no console.
    const violacoes: string[] = [];
    page.on("console", (m) => {
      if (/Content Security Policy/i.test(m.text())) violacoes.push(m.text());
    });

    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/dark/);
    expect(violacoes).toEqual([]);
  });
});
```

> Este spec precisa de sessão. Siga o padrão de `tests/e2e/auth.setup.ts`, que já reaproveita
> `storageState` — não faça login dentro do teste.

- [ ] **Passo 4: rodar tudo**

```bash
npm test && npm run typecheck && npm run lint && npm run build
npm run test:e2e
```

> Rode e2e **só** por `npm run test:e2e` — o script encadeia uma guarda de porta. Nunca
> `npx playwright test` direto.

Esperado: 642+ unitários verdes, 24 e2e verdes.

- [ ] **Passo 5: sabotar**

Remova `nonce={nonce}` do `ThemeProvider` e rode `npm run build && npm start`, abrindo o
painel. O console do navegador **deve** mostrar violação de CSP e o tema **deve** piscar.
Desfaça.

> Esta sabotagem não roda em `npm run dev` — o CSP de desenvolvimento tem `'unsafe-eval'` e
> mascara o sintoma. É exatamente por isso que ela existe.

- [ ] **Passo 6: commitar**

```bash
git add src/components/theme-toggle.tsx src/app/\(painel\)/layout.tsx tests/e2e/tema.spec.ts
```

```
feat(tema): interruptor claro/escuro em dois estados

enableSystem=false: com "sistema" no meio o botao precisaria de tres
icones e de um rotulo explicando o estado atual.

O nonce no ThemeProvider nao e opcional. script-src usa strict-dynamic,
entao o self e ignorado e script sem nonce nao roda — sem ele o tema
pisca branco a cada carga, e so em producao.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

## Verificação final

Depois da Task 8, com a árvore limpa:

```bash
npm test          # 642+ unitários
npm run typecheck # limpo
npm run lint      # 0 erros (1 aviso pre-existente em lead-table.tsx:117)
npm run build     # compila
npm run test:e2e  # 24 verdes, incluindo auth.spec.ts
```

**O e2e de logout (`auth.spec.ts`, "o botão Sair encerra a sessão de verdade") é o teste
mais importante desta lista.** Ele é o detector histórico do defeito em que o prefetch fazia
o Auth.js reemitir o cookie. Se ele ficar intermitente depois desta reforma, a causa é um
`<Link>` sem `prefetch={false}` — não é teste instável.

Conferência visual, com `npm run build && npm start`:

- [ ] `<html lang="pt-BR">` e aba com o nome do cliente
- [ ] tag `<style>` com `:root:root{--primary:oklch(`
- [ ] barra lateral de 248px no desktop, sem barra superior
- [ ] gaveta abaixo de 1024px, fechando ao navegar
- [ ] item ativo preenchido, e só um por vez em `/leads/kanban`
- [ ] alternar tema e recarregar mantém a escolha
- [ ] trocar `corPrimaria` em `config/client.ts` muda botão, foco e gráficos, e o cinza
      continua cinza

## Fora deste plano

Revisão tela a tela — tabelas cruas de `/contatos` e da equipe, atividade recente do
dashboard mostrando `log.acao` técnico, tratamento consistente de formulário. É a spec
seguinte, e depende desta.
