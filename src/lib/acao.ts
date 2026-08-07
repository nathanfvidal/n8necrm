/**
 * Contrato de retorno das Server Actions do projeto.
 *
 * ## Por que devolver resultado em vez de lançar
 *
 * O Next **redige erros não tratados** que atravessam uma Server Action em
 * produção — a tela recebe uma mensagem genérica com um identificador, não o
 * `Error.message` original lançado no servidor. Uma action que deixa o erro
 * subir entrega à tela a MESMA mensagem opaca para "entrada inválida",
 * "permissão negada" e "banco fora do ar", e quem está usando o sistema perde
 * a única informação que o faria agir diferente.
 *
 * Por isso cada action captura o erro e devolve `ResultadoAcao`. Não
 * "simplifique" isto de volta para `throw` — seria reintroduzir exatamente a
 * redação genérica que este tipo existe para evitar.
 *
 * ## Por que mora em `src/lib/` e não em `src/core/` nem num módulo
 *
 * Nasceu em `src/modules/whatsapp/actions.ts` (Fatia 2 do WhatsApp), onde era
 * o único consumidor. Com `core/users` e `core/contacts` precisando do mesmo
 * contrato, ficar lá viraria violação de fronteira: `src/core` **não pode**
 * importar de `src/modules` (regra de ESLint em nível de erro, ver
 * `eslint.config.mjs` e a § 3.3 da spec base). `src/lib/` é neutro — tanto
 * `core` quanto `modules` importam dele.
 */
export type ResultadoAcao = { ok: true } | { ok: false; erro: string };

/**
 * Mensagem devolvida quando `usuarioAtual()` rejeita — sessão expirada OU
 * usuário desativado no meio do expediente.
 *
 * Nunca tenta distinguir os dois casos, de propósito: `usuarioAtual()`
 * (`src/core/auth/session.ts`) lança a MESMA `Error("Não autenticado")` para
 * ambos, porque decidiu que os dois merecem a mesma orientação. Inventar a
 * distinção aqui reintroduziria o que aquele helper evita.
 */
export const MENSAGEM_SESSAO_INVALIDA = "Sua sessão expirou. Recarregue a página e entre de novo.";

/**
 * Reconhece a rejeição de `usuarioAtual()`.
 *
 * **Esta é a única comparação de string com `"Não autenticado"` no lado do
 * servidor** — e é aqui de propósito. A detecção por texto é frágil: reescrever
 * a mensagem em `session.ts` quebraria o reconhecimento **em silêncio**, sem
 * erro de tipo e sem teste vermelho no ponto da mudança. Concentrar num lugar
 * não resolve a fragilidade, mas troca "N pontos de quebra silenciosa" por um
 * só, e dá um lugar óbvio para o `SessaoInvalidaError` entrar quando alguém
 * pagar aquela dívida (registrada em
 * `docs/superpowers/plans/2026-08-06-whatsapp-fatia-2-pendencias.md`).
 *
 * Cinco componentes de cliente ainda comparam a string por conta própria
 * (`leads/kanban-board.tsx`, `leads/lead-form.tsx`, `tasks/task-form.tsx`,
 * `tasks/task-list.tsx`, `notifications/notification-bell.tsx`) — são outro
 * caminho: recebem um `Error` de uma action que LANÇA, não um `ResultadoAcao`.
 * Uniformizá-los é a mesma dívida do `SessaoInvalidaError`, não esta função.
 */
export function ehSessaoInvalida(erro: unknown): boolean {
  return erro instanceof Error && erro.message === "Não autenticado";
}
