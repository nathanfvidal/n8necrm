import { LoadingState } from "@/components/loading-state";

/**
 * Fallback instantâneo de TODA rota do painel.
 *
 * Um arquivo só cobre as dez rotas: `loading.tsx` embrulha `page.tsx` **e
 * qualquer segmento abaixo** num `<Suspense>`
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md,
 * seção "Instant Loading States"). Se algum dia uma tela merecer esqueleto
 * próprio, basta um `loading.tsx` aninhado nela — não antecipar.
 *
 * ## Por que isto faltava, e o que muda
 *
 * Até aqui o painel não tinha NENHUM `loading.tsx` nem `<Suspense>`, e todo
 * `<Link>` da navegação tem `prefetch={false}` (correção de segurança do
 * logout — ver `nav-links.tsx`). A soma disso é que clicar em "Leads" não
 * mudava absolutamente nada na tela até o servidor terminar de renderizar: a
 * página antiga ficava lá, inteira e clicável, e a pessoa clicava de novo.
 *
 * Medido antes de escrever isto, contra o build de produção com login real:
 * trocar para `/leads` custa 6 consultas e ~1000 ms; para `/` (dashboard),
 * 6 consultas e ~1000 ms. A mediana de uma consulta é 85 ms — o tempo é
 * viagem de rede, não trabalho de banco. Este arquivo NÃO reduz nada disso;
 * ele faz o mesmo segundo ser um segundo em que a tela responde.
 *
 * ## Por que funciona apesar de o layout ser `force-dynamic`
 *
 * O doc do `loading.js` avisa que dado de runtime lido **no layout** não
 * ganha fallback — sem Cache Components, a navegação bloqueia até o layout
 * terminar. `(painel)/layout.tsx` lê `usuarioAtual()`, notificações e
 * `headers()`, então a ressalva se aplicaria.
 *
 * Ela não morde aqui porque o layout compartilhado não é refeito em
 * navegação client-side — *"shared layouts won't automatically be refetched
 * on every navigation, only the page segment that changes"*
 * (.../05-config/01-next-config-js/staleTimes.md). Isso foi confirmado na
 * medição, não presumido do doc: a troca de aba emite 6 consultas e um F5
 * emite 8, e as duas de diferença são exatamente as do layout (o `User`
 * duplicado e a de `Notification`). Em troca de aba o layout não roda, e o
 * que bloqueia é a página — que é o que este `<Suspense>` cobre.
 */
export default function CarregandoPainel() {
  return <LoadingState />;
}
