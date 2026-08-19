/**
 * O editor do n8n embutido.
 *
 * Não há SSO: o n8n autentica por cookie próprio, e o fluxo de login por
 * iframe (`N8N_EMBED_LOGIN_ENABLED` + token exchange) exige licença
 * Enterprise. Na primeira visita a pessoa vê a tela de login DO N8N aqui
 * dentro, entra uma vez, e o cookie passa a valer.
 *
 * Isso só funciona porque duas coisas foram configuradas na VPS em
 * 2026-08-19 e estão registradas no spec: o nginx troca `X-Frame-Options`
 * por `frame-ancestors` listando a origem do CRM, e o n8n roda com
 * `N8N_SAMESITE_COOKIE=none` — sem essa segunda, o navegador não envia o
 * cookie de sessão em contexto de terceiro e a tela fica presa no login para
 * sempre.
 *
 * O `frame-src` no CSP do CRM (Task 6) já entrou — `frame-src
 * https://n8n.nateksoft.com` está no lugar e foi provado ao vivo na
 * auditoria do ciclo (`docs/auditorias/2026-08-19-ciclo-4-fluxos.md`, ✅12).
 * Este comentário dizia "falta ainda" até a revisão final apontar que já
 * era falso no HEAD — sem essa diretiva o quadro ficaria mesmo em branco,
 * com violação no console, mas essa fase já passou.
 */
export function EditorN8n({ url, nome }: { url: string; nome: string }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Na primeira vez, entre com sua conta do n8n aqui dentro. O login vale para as próximas.
      </p>
      <iframe
        src={url}
        title={`Editor do n8n — ${nome}`}
        className="h-[70vh] w-full rounded-md border"
        // `sandbox` NÃO é usado aqui de propósito: o editor do n8n precisa de
        // scripts, formulários, popups de OAuth e do próprio cookie de sessão.
        // Um sandbox que permitisse tudo isso não estaria restringindo nada, e
        // um mais estreito quebraria o editor de um jeito difícil de
        // diagnosticar. A contenção real é o `frame-src` de origem única.
      />
    </div>
  );
}
