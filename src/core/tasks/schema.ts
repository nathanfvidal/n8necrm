import { z } from "zod";

/**
 * Validação declarativa dos campos NOVOS de tarefa.
 *
 * Por que só os novos: `titulo` e `vencimento` já têm validadores imperativos
 * em `service.ts`, com mensagens que `MENSAGENS_SEGURAS` (`actions.ts`) casa
 * por regex e testes que dependem delas. Reescrever aquilo em Zod dentro
 * desta branch seria mexer em código que funciona e está coberto, para
 * ganhar consistência de estilo e nada mais.
 *
 * Por que Zod nos novos: eu tinha afirmado antes que "não existe Zod de
 * servidor em nenhum módulo" — estava ERRADO. Ele já valida variável de
 * ambiente (`src/lib/env.ts`, `src/lib/storage.ts`) e payload de terceiro
 * (três arquivos do módulo whatsapp). O enunciado correto é mais estreito:
 * Zod nunca havia validado ENTRADA DE USUÁRIO dentro de `src/core/`. Este é
 * o primeiro caso, e `storage.ts:133-138` é o modelo copiado — `safeParse`
 * seguido de erro de domínio, nunca `parse` cru (que lançaria um `ZodError`
 * com o caminho do campo e o valor recebido, atravessando até a tela).
 *
 * A mensagem sai com prefixo que `MENSAGENS_SEGURAS` reconhece. Sem isso a
 * falha cairia no ramo genérico e a pessoa leria "Falha ao salvar a tarefa"
 * no lugar do motivo — que é o defeito que esta validação existe para evitar,
 * não só a gravação do dado ruim.
 */

/**
 * Teto de 2000 caracteres na descrição.
 *
 * `Task.descricao` é `String?` — no Postgres, `text` sem limite. Sem teto,
 * um `<textarea>` aceita um livro colado, e o custo aparece longe do
 * formulário: a listagem carrega tudo, e a linha inflada viaja para o
 * cliente em toda renderização de `/tasks`.
 *
 * 2000 é folgado para o que uma descrição de lembrete é ("levar a proposta
 * impressa, ele pediu duas vias") e apertado o bastante para que colar um
 * documento inteiro falhe com mensagem clara em vez de gravar em silêncio.
 * NÃO é limite de banco: a coluna aceita mais. É limite de produto, e por
 * isso mora aqui e não numa migração.
 */
export const LIMITE_DESCRICAO = 2000;

export const camposNovosDaTarefaSchema = z.object({
  descricao: z
    .string()
    .max(
      LIMITE_DESCRICAO,
      `Descrição longa demais: o limite é ${LIMITE_DESCRICAO} caracteres.`
    )
    .optional(),
  // `.trim().min(1)` e não só `.optional()`: string vazia e string de espaços
  // chegam do `<select>` como "nenhum contato escolhido", e gravá-las viraria
  // uma violação de FK crua (P2003) na hora do `create`. A normalização para
  // `null` é feita por quem chama — aqui o contrato é: ou vem id de verdade,
  // ou não vem campo.
  contactId: z
    .string()
    .trim()
    .min(1, "Contato inválido: identificador vazio.")
    .optional()
    .nullable(),
});

export type CamposNovosDaTarefa = z.infer<typeof camposNovosDaTarefaSchema>;

/**
 * `safeParse` → `Error` de domínio, nunca `parse` cru.
 *
 * Só a PRIMEIRA mensagem é usada. Concatenar todas produziria um parágrafo
 * num alerta de formulário; a pessoa corrige uma coisa, reenvia, e vê a
 * seguinte — que é como formulário se comporta em qualquer lugar.
 */
export function validarCamposNovosDaTarefa(entrada: {
  descricao?: string;
  contactId?: string | null;
}): CamposNovosDaTarefa {
  const analisado = camposNovosDaTarefaSchema.safeParse(entrada);
  if (!analisado.success) {
    throw new Error(analisado.error.issues[0].message);
  }
  return analisado.data;
}
