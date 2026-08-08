import type { Instrumentation } from "next";

import { redigirPiiProfundo } from "@/lib/sentry-scrub";

/**
 * Observabilidade — Sentry, **só no servidor**.
 *
 * ## Por que não há `instrumentation-client.ts`
 *
 * O SDK de navegador do Sentry envia os eventos direto para o domínio de
 * ingestão dele, e o CSP deste projeto tem `connect-src 'self'` justamente
 * para que nenhum script no cliente consiga mandar dado para fora (ver o
 * comentário longo em `src/proxy.ts`). Instalar o SDK no cliente exigiria
 * abrir esse buraco no exato lugar onde a proteção foi colocada.
 *
 * A troca é boa porque praticamente toda a lógica deste CRM roda no
 * servidor: Server Actions, Server Components e route handlers. O que fica de
 * fora é erro de JavaScript que só acontece no navegador do vendedor —
 * decisão registrada, não esquecimento.
 *
 * Pelo mesmo motivo, `next.config.ts` **não** usa `withSentryConfig`: aquele
 * wrapper injeta instrumentação de cliente por conta própria
 * (`instrumentationClientInject`). O custo de não usá-lo é não ter upload
 * automático de source map — o stack trace do servidor chega em código
 * compilado. Vale reavaliar quando houver um erro real difícil de ler.
 *
 * ## Sem DSN, nada acontece
 *
 * Mesmo padrão de `RESEND_API_KEY` em `core/notifications/dispatch.ts`: sem
 * `SENTRY_DSN` a função retorna antes de inicializar. Um `Sentry.init()` com
 * DSN vazio "funciona" até a primeira tentativa de envio falhar em silêncio,
 * o que é pior para diagnosticar do que nunca ligar.
 *
 * `SENTRY_DSN` (não `NEXT_PUBLIC_SENTRY_DSN`): o prefixo público empacotaria
 * o valor no bundle do navegador, e aqui ele nunca é lido no cliente.
 */

export async function register() {
  // `register` roda em todo runtime; este projeto só instrumenta Node.
  // O proxy roda em runtime próprio e não deve carregar o SDK.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.SENTRY_DSN) return;

  const Sentry = await import("@sentry/nextjs");

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    // Ligado por variável de ambiente, desligado por padrão. Nasceu na
    // verificação desta integração e ficou porque resolve um problema real:
    // quando o Sentry "não recebe nada", a pergunta é se o `register()` não
    // rodou, se o `onRequestError` não disparou, ou se o envio falhou — e as
    // três têm a mesma aparência (silêncio). Com `SENTRY_DEBUG=1` o SDK
    // imprime cada etapa no log do servidor, e a resposta sai em segundos.
    // Nunca imprime o DSN.
    debug: !!process.env.SENTRY_DEBUG,
    // `false` é o padrão do SDK; explícito porque é a decisão que impede o
    // Sentry de anexar IP, cookie e corpo de requisição por conta própria.
    sendDefaultPii: false,

    /**
     * Ruído que não é defeito e não tem ação possível.
     *
     * "The destination stream closed early" é do streaming de SSR do React:
     * o cliente desconectou antes de a resposta terminar — trocou de página,
     * fechou a aba, perdeu sinal. Não há nada a corrigir, e no painel ele
     * aparece como erro NÃO TRATADO, competindo com erro de verdade. Já
     * chegou 4 vezes vindo de `GET /contatos/[id]`.
     *
     * Esta lista precisa continuar curtíssima e cada entrada precisa ser
     * inacionável POR NATUREZA, não só chata. Silenciar erro é a forma mais
     * fácil de tornar a observabilidade inútil sem ninguém perceber — foi
     * justamente por não ter monitoramento que o deploy ficou três dias
     * quebrado sem aviso.
     */
    ignoreErrors: ["The destination stream closed early."],
    // Sem tracing: o valor aqui é saber que quebrou e onde, não medir
    // latência. Amostragem de traces custa volume e não responde nenhuma
    // pergunta que este CRM tenha hoje.
    tracesSampleRate: 0,
    // NUNCA `?? process.env.NODE_ENV`. `next start` roda com
    // NODE_ENV=production, então uma execução na máquina de quem desenvolve —
    // ou a suíte e2e, que sobe o build de produção — chegava ao Sentry
    // carimbada como `production`, misturada com erro de cliente de verdade.
    //
    // Não é hipótese: o painel do Sentry mostrou `Não autenticado` em
    // `GET /leads` e `The destination stream closed early` em
    // `GET /contatos/[id]` como se fossem produção, quando vieram do e2e local.
    // Observabilidade que mente sobre a origem é pior que não ter, porque a
    // reação a "erro em produção" é diferente da reação a "erro no meu teste".
    //
    // `VERCEL_ENV` só existe dentro da Vercel e vale `production`, `preview` ou
    // `development`. Fora dela é a máquina de alguém — a menos que um deploy
    // próprio declare `SENTRY_ENVIRONMENT` de propósito.
    //
    // Para não mandar nada da máquina local, basta remover `SENTRY_DSN` do
    // `.env`: `register()` retorna antes de inicializar.
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? "local",

    /**
     * Último portão antes do envio. O SDK não olha dentro do TEXTO do erro, e
     * as mensagens deste sistema carregam dado de cliente por construção
     * ("Telefone inválido: ...", "já está cadastrado para Maria Silva").
     *
     * Também remove `cookies` e `headers` da requisição: com
     * `sendDefaultPii: false` o SDK já não deveria anexá-los, mas o cookie de
     * sessão é credencial viva — vale um segundo cadeado, e o custo é uma
     * linha.
     */
    beforeSend(evento) {
      if (evento.request) {
        delete evento.request.cookies;
        delete evento.request.headers;
      }
      return redigirPiiProfundo(evento) as typeof evento;
    },
  });
}

/**
 * Captura erros que o próprio Next intercepta durante o render, numa Server
 * Action ou num route handler — os que hoje só aparecem no console do
 * servidor e somem quando o processo reinicia.
 *
 * `err` pode não ser o erro original: quando acontece dentro de um Server
 * Component, o React o processa antes, e é o `digest` que liga o que chegou
 * aqui ao que apareceu na tela de quem estava usando.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.SENTRY_DSN) return;

  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(err, request, context);
};
