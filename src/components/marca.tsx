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
  if (!client.marca.logo) {
    return <span className="text-sm font-semibold">{client.nome}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={client.marca.logo} alt={client.nome} className="h-6 w-auto" />
  );
}
