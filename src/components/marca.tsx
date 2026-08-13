import { client } from "../../config/client";

/**
 * A marca do cliente no topo da barra lateral.
 *
 * Dois caminhos, e o de texto é o NORMAL enquanto não houver arquivo de logo
 * — não é remendo. `marca.logo` é opcional no schema justamente por isso.
 *
 * Sem `next/image`: SVG não se beneficia do otimizador. Sem `onError`: exigiria
 * componente de cliente, e o comportamento nativo do navegador com `alt` de
 * imagem quebrada já entrega a mesma degradação de graça.
 */
export function Marca() {
  const { logo } = client.marca;

  if (!logo) {
    return <span className="text-sm font-semibold">{client.nome}</span>;
  }

  return (
    <span className="flex items-center gap-2">
      {/*
        As duas artes vão para o DOM e o CSS esconde uma. Parece desperdício
        de 3 KB e não é: a alternativa — ler o tema em JavaScript e trocar o
        `src` — exigiria componente de cliente e mostraria o logo errado no
        primeiro quadro, porque no servidor não há como saber o tema guardado.
        É o mesmo defeito que o `aria-label` do alternador teve, e ali levou
        um e2e para achar. Aqui o CSS troca junto com o resto do tema, antes
        do primeiro pixel.

        O `alt` carrega o nome porque a arte está SOZINHA: sem texto ao lado,
        ela é a única identificação da marca, e `alt=""` deixaria a barra sem
        nome nenhum para quem usa leitor de tela. Nas duas, porque a escondida
        não é anunciada — só a visível chega na árvore de acessibilidade.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo.claro} alt={client.nome} className="h-8 w-auto dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo.escuro} alt={client.nome} className="hidden h-8 w-auto dark:block" />
    </span>
  );
}
