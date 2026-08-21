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
 * ## Qual caminho isto atende — e qual NÃO atende
 *
 * Atende o **carregamento completo**: primeiro acesso, F5, link colado. O SSR
 * streama o shell e este esqueleto no primeiro pedaço, antes de as consultas
 * terminarem. É onde estava o pior número da medição — F5 em `/leads` levava
 * 1738 ms, e até aqui eram 1738 ms de tela em branco.
 *
 * **NÃO atende a troca de aba**, e essa correção custou caro para ser
 * aprendida. O doc do `loading.js` diz, na seção "Navigation": *"The Fallback
 * UI is **prefetched**, making navigation immediate unless prefetching hasn't
 * completed."* Toda navegação deste painel é `prefetch={false}` — correção de
 * segurança do logout, que não se mexe —, então no clique o roteador **não
 * tem o fallback em mãos**: ele busca o segmento, e quando a resposta chega,
 * o conteúdo vem junto. O esqueleto só aparecia nas vezes em que o render do
 * servidor demorava o bastante para o fallback ser pintado no meio do
 * streaming, o que é sorte, não garantia — o teste que afirmava isso falhou
 * em 2 de 3 execuções da suíte até a causa ser entendida.
 *
 * Quem dá sinal na troca de aba é o `IndicadorDeLink` (`useLinkStatus`), e o
 * doc daquele hook recomenda exatamente esse par para o caso `prefetch=false`.
 * Os dois mecanismos existem porque cobrem caminhos diferentes.
 *
 * `tests/e2e/transicao.spec.ts` trava cada um no seu caminho: aqui, que o
 * marcador do esqueleto sai no HTML ANTES da `<table>`; lá, que o link acende
 * enquanto a navegação está a caminho.
 *
 * ## "Toda navegação deste painel é `prefetch={false}`" — quem prova isso
 *
 * Esta frase aparece duas vezes acima e é UNIVERSAL. Até 2026-08-21 ela não
 * tinha trava nenhuma: existia em `nav-links.tsx` e em mais nada, e a
 * auditoria da branch de tenancy achou 13 dos 15 `<Link>` do painel sem a
 * prop — dois deles em `<nav>` na mesma tela do botão "Sair"
 * (docs/auditorias/2026-08-21-fase1-seguranca-branch-tenancy.md).
 *
 * Agora quem a sustenta são dois arquivos, e nenhum dos dois é decorativo:
 * `tests/unit/prefetch-do-painel.test.ts` varre `src/app/(painel)/**` e
 * `src/components/**` e reprova qualquer `<Link>` sem a prop; o teste de
 * pré-busca em `transicao.spec.ts` observa o fio no build de produção, com
 * controle próprio para não ficar verde por não estar medindo nada.
 */
export default function CarregandoPainel() {
  return <LoadingState />;
}
