// Sem `import "server-only"` de propósito — diferente de `dispatch.ts`, este
// arquivo não toca Prisma. `notification-bell.tsx` (Client Component) importa
// `extrairPayloadNovoLead` diretamente daqui para renderizar o conteúdo de
// cada notificação sem precisar confiar cegamente no formato do JSON vindo do
// servidor.

/**
 * Formato do `payload` gravado por `notificarNovoLead` (dispatch.ts) para
 * notificações do tipo "NOVO_LEAD".
 */
export type NovoLeadPayload = { leadId: string; contatoNome: string };

/**
 * Extrai `NovoLeadPayload` de um `Notification.payload` (coluna `Json`,
 * tipada como `Prisma.JsonValue` — ou seja, `unknown` na prática) de forma
 * defensiva, devolvendo `null` em vez de lançar quando o formato não bate.
 *
 * Por que isso importa (ver instrução da Task 19): `payload` não tem
 * validação de schema no banco, e não existe FK entre `Notification` e
 * `Lead` — é só um id solto dentro do JSON. Duas situações fazem o formato
 * não bater com o esperado, e nenhuma das duas é um bug:
 * 1. O lead referenciado em `payload.leadId` foi apagado depois que a
 *    notificação foi criada — o `leadId`/`contatoNome` gravados continuam
 *    intactos (payload é uma cópia congelada no momento da criação, não uma
 *    referência viva), então isso NÃO quebra a extração; só o link "Ver
 *    lead" na UI dá 404 se alguém clicar (mesmo risco aceito já documentado
 *    em `painel-nav.tsx` para os links de módulo).
 * 2. Uma notificação de um `tipo` futuro (fora de "NOVO_LEAD") grava um
 *    payload com outro formato — este guard devolve `null` para qualquer
 *    coisa que não tenha `leadId`/`contatoNome` como string, e quem chama
 *    decide o fallback (ver `notification-bell.tsx`), em vez de o app
 *    quebrar ao tentar ler um campo que não existe.
 */
export function extrairPayloadNovoLead(payload: unknown): NovoLeadPayload | null {
  if (
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    typeof (payload as Record<string, unknown>).leadId === "string" &&
    typeof (payload as Record<string, unknown>).contatoNome === "string"
  ) {
    return payload as NovoLeadPayload;
  }
  return null;
}
