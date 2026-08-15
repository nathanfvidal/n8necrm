"use client";

import { useLinkStatus } from "next/link";

/**
 * Ponto que pulsa no link enquanto a navegação está a caminho.
 *
 * Precisa ser descendente de um `<Link>` — é assim que `useLinkStatus` acha a
 * navegação a que se refere. Componente separado, e não o `<Link>` inteiro
 * virando cliente, porque o hook só funciona num descendente
 * (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-link-status.md,
 * "Good to know").
 *
 * O doc diz que o hook *"is most useful when `prefetch={false}` is set"*, que
 * é exatamente a situação desta navegação — e por um motivo de segurança que
 * NÃO se mexe aqui: um prefetch de `<Link>` já desfez um logout neste sistema
 * (ver AGENTS.md e `nav-links.tsx`). Reativar prefetch é decisão de auditoria
 * própria, não item de uma branch de performance. Enquanto for assim, este
 * ponto é o único sinal que o clique recebe antes de a página trocar.
 *
 * ## Três detalhes que não são estilo
 *
 * 1. **`aria-hidden` declara que isto é decoração, e precisa continuar
 *    verdade.** Hoje o `<span>` é vazio, então tirar o atributo não mudaria
 *    o nome acessível de nada — seria errado dizer que ele está segurando a
 *    parede sozinho. O que ele protege é o futuro: no dia em que alguém
 *    achar que o ponto ficaria melhor como "carregando…", o texto entra no
 *    nome do link, `getByRole("link", { name: "Leads" })` para de casar, e
 *    isso é como TODA a suíte e2e navega o painel. Quem trava o par é o
 *    teste "o nome acessível do link continua sendo só o rótulo" em
 *    `nav-links.test.tsx`: ele fica vermelho se aparecer texto aqui sem
 *    `aria-hidden`.
 * 2. **Espaço sempre reservado.** `visibility: hidden` em vez de não
 *    renderizar: o próprio doc alerta que indicador inline causa layout
 *    shift, e um item de menu que "cresce" ao ser clicado é pior que não ter
 *    aviso nenhum.
 * 3. **Aparece com 100 ms de atraso** (`animation-delay`, em `globals.css`).
 *    Uma navegação rápida não deve piscar — o ponto só existe para a
 *    navegação que demora, que aqui é a regra e não a exceção.
 *
 * O posicionamento e a animação vivem em classe CSS, nunca em prop `style`.
 * Mesma regra do cartão do kanban: a única `style` inline do projeto é a da
 * cor da etapa, e é assim que ela continua sendo a única no dia em que
 * alguém for endurecer o `style-src` do CSP.
 */
export function IndicadorDeLink() {
  const { pending } = useLinkStatus();

  return <span aria-hidden className={pending ? "pista-de-link pendente" : "pista-de-link"} />;
}
