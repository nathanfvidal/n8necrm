import { z } from "zod";

/**
 * Validação declarativa dos campos de uma etapa do funil.
 *
 * Segue a decisão da branch de cadastro de contato: Zod valida entrada de
 * usuário dentro de `core/`, com `safeParse` convertido em erro de domínio por
 * quem tem o erro. O `throw` NÃO mora aqui — `EtapaInvalidaError` é declarado em
 * `service.ts`, e `service.ts` importa este arquivo. Importar de volta fecharia
 * um ciclo de módulos, que às vezes funciona em ESM e às vezes entrega
 * `undefined` na hora do `new`.
 */

/**
 * Teto do nome. É limite de produto, não de banco: a coluna é `text`. Quarenta
 * caracteres cabem em "Proposta enviada aguardando retorno" e não cabem numa
 * frase — o nome de etapa é rótulo de coluna do kanban, e um rótulo que quebra
 * em três linhas estraga o quadro para todo mundo.
 */
export const LIMITE_NOME_ETAPA = 40;

export const etapaSchema = z.object({
  nome: z.preprocess(
    (valor) => (typeof valor === "string" ? valor.trim() : valor),
    z
      .string()
      .min(1, "O nome da etapa não pode ficar em branco.")
      .max(LIMITE_NOME_ETAPA, `Nome: o limite é ${LIMITE_NOME_ETAPA} caracteres.`)
  ),

  /**
   * Só `#rrggbb`, minúsculo, sempre.
   *
   * Isto é validação de SEGURANÇA, não de estética. `etapa.cor` atravessa para
   * `style={{ borderTopColor }}` em `components/leads/kanban-board.tsx` e para
   * `fill=` em `components/dashboard/conversion-chart.tsx`. Até esta branch o
   * valor vinha de uma constante do seed; agora vem de quem digitou. O
   * `<input type="color">` da tela só produz este formato — mas ele é
   * conveniência de navegador, e a Server Action responde a qualquer POST.
   *
   * A normalização para minúsculas vem antes da regra para que `#0F62FE` e
   * `#0f62fe` não virem duas cores diferentes na mesma coluna.
   */
  cor: z.preprocess(
    (valor) => (typeof valor === "string" ? valor.trim().toLowerCase() : valor),
    z.string().regex(/^#[0-9a-f]{6}$/, "Cor inválida: use o formato #rrggbb, como #0f62fe.")
  ),
});

export type CamposDaEtapa = z.infer<typeof etapaSchema>;
