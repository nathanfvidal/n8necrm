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
 * **Nenhum componente de cliente compara mais essa string.** Eram cinco
 * (`tasks/task-form.tsx`, `tasks/task-list.tsx`, `leads/kanban-board.tsx`,
 * `leads/lead-form.tsx`, `notifications/notification-bell.tsx`), e os cinco
 * saíram quando as actions dos três módulos passaram a devolver
 * `ResultadoAcao` em vez de lançar. Hoje `ehSessaoInvalida` é chamada só do
 * lado do servidor, que é onde ela sempre deveria ter estado.
 *
 * O que os cinco tinham em comum, e o que a mudança fechou: cada um repetia,
 * como literal de string, um texto escrito no `service.ts` do módulo. Renomear a
 * mensagem na origem apagava a tradução **em silêncio** — sem erro de tipo,
 * sem teste vermelho no ponto da mudança — e a pessoa passava a ler o fallback
 * genérico para um problema que ela conseguia corrigir sozinha.
 *
 * `criarLeadManualAction` e `moverLeadDeEtapaAction` carregavam um segundo
 * problema, fechado junto: devolviam `Lead` INTEIRO, e o retorno de uma Server
 * Action é serializado para o navegador — `utm`, `sessionId` e `itemId` iam
 * junto, para chamadores que descartam o retorno. Era o lead da própria
 * pessoa, então nunca foi vazamento entre usuários; era o mesmo padrão que
 * produziu o do funil.
 *
 * Continua de pé a dívida do `SessaoInvalidaError`: a detecção ainda é por
 * texto, num lugar só. Trocá-la por uma classe de erro é o conserto de
 * verdade, e não depende mais de mexer em componente nenhum.
 */
export function ehSessaoInvalida(erro: unknown): boolean {
  return erro instanceof Error && erro.message === "Não autenticado";
}

/**
 * A metade do contrato que mora no CLIENTE.
 *
 * `ResultadoAcao` promete que a action não lança — e essa é promessa do CÓDIGO
 * do servidor, não do transporte. Server Action é chamada de rede: conexão que
 * cai entre o clique e a resposta, aba suspensa, deploy no meio do caminho. Aí
 * o `await` rejeita sem nunca ter entrado no `try` da action, e nenhum
 * `resultado.erro` existe para mostrar.
 *
 * Todo chamador precisa dos DOIS caminhos. Nos componentes com atualização
 * otimista (`task-list.tsx`, `kanban-board.tsx`, `notification-bell.tsx`)
 * esquecer este aqui deixa a linha sumida da tela sem ter sido salva; nos
 * formulários (`lead-form.tsx`, `task-form.tsx`) deixa o botão voltar ao normal
 * sem dizer nada, como se nada tivesse sido tentado.
 *
 * Este helper existe para a mensagem não ser reescrita cinco vezes com cinco
 * redações. O `console.error` guarda o detalhe onde ele serve a alguém e não
 * sai da máquina: não há SDK de Sentry no cliente (`src/instrumentation.ts` só
 * roda quando `NEXT_RUNTIME === "nodejs"`).
 */
export const MENSAGEM_FALHA_DE_REDE =
  "Não foi possível falar com o servidor. Verifique a conexão e tente de novo.";

export function registrarFalhaDeRede(contexto: string, erro: unknown): string {
  console.error(`${contexto}:`, erro);
  return MENSAGEM_FALHA_DE_REDE;
}
