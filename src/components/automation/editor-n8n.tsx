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
 *
 * POR QUE O TEMA DO N8N NÃO SEGUE O TEMA DO CRM (e por que não há como
 * consertar isso por aqui): o tema do n8n é configuração POR USUÁRIO, salva
 * dentro da própria conta do n8n em Settings → Personal → Personalisation →
 * Theme (documentado no changelog da versão 1.15.1 do n8n). Não existe
 * parâmetro de URL nem variável de ambiente que force um tema no editor
 * embutido. E o iframe é cross-origin (`n8n.nateksoft.com` dentro do CRM):
 * mesmo que existisse, o CRM não alcança o `localStorage` do n8n nem
 * consegue injetar CSS lá dentro — a política de mesma origem do navegador
 * impede os dois. Por isso a MOLDURA (o `<iframe>` em si) segue o tema do
 * CRM abaixo, mas o CONTEÚDO dela é território do n8n, com o tema que a
 * conta de quem está logado tiver escolhido. A próxima pessoa que achar isso
 * estranho não precisa reabrir a investigação — já foi apurado, é assim
 * mesmo, e o texto abaixo já explica pra quem usa o que fazer.
 */
export function EditorN8n({ url, nome }: { url: string; nome: string }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Na primeira vez, entre com sua conta do n8n aqui dentro — o login vale para as próximas. O
        n8n tem tema próprio, configurado na conta dele: para escolher entre claro e escuro, vá em{" "}
        <span className="font-medium text-foreground">
          Configurações → Pessoal → Personalização → Tema
        </span>{" "}
        dentro do editor abaixo.
      </p>
      <iframe
        src={url}
        title={`Editor do n8n — ${nome}`}
        // Moldura no tema do CRM, nos dois modos: borda e fundo pelos tokens
        // da base (`border`, `bg-muted`), não uma cor fixa — sem isso o
        // quadro parece um retângulo colado por cima da página em vez de
        // parte dela, principalmente no escuro. O CONTEÚDO do iframe não
        // responde a isso (ver o porquê acima); é só a moldura que é nossa.
        className="h-[70vh] w-full rounded-md border border-border bg-muted"
        // `sandbox` NÃO é usado aqui de propósito: o editor do n8n precisa de
        // scripts, formulários, popups de OAuth e do próprio cookie de sessão.
        // Um sandbox que permitisse tudo isso não estaria restringindo nada, e
        // um mais estreito quebraria o editor de um jeito difícil de
        // diagnosticar. A contenção real é o `frame-src` de origem única.
      />
    </div>
  );
}
