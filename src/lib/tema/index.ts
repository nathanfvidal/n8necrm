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
