/**
 * Teto de linhas que uma listagem de tela devolve numa requisição.
 *
 * ## O que este teto é, e o que ele não é
 *
 * **Não é** proteção de confidencialidade. Neste CRM lead e contato são
 * compartilhados por decisão de produto (equipe colaborativa — ver
 * `core/leads/queries.ts`), então todo usuário autenticado já pode ver a base;
 * paginar não muda isso, só divide em páginas. Quem quiser varrer tudo varre.
 * O controle que responde a extração em massa é o registro da exportação
 * (`app/(painel)/export/leads/route.ts`) e o alerta de rajada
 * (`core/audit/alerta.ts`), não este número.
 *
 * **É** limite de consumo de recurso, no sentido de OWASP API4:2023: `findMany`
 * sem `take` carrega a tabela inteira na memória do processo, serializa tudo
 * para o cliente e cresce sem freio junto com o banco. Numa revenda de 500
 * leads não se nota; o modelo deste produto é fork por cliente, e algum fork
 * vai ter 50 mil contatos. É lá que uma listagem sem teto deixa de renderizar
 * devagar e passa a estourar o tempo de execução da função serverless.
 *
 * ## Por que 1000
 *
 * Alto o bastante para que nenhum cliente atual encoste (o maior hoje está em
 * centenas), e baixo o bastante para bater muito antes do ponto em que a
 * requisição fica pesada demais. O número é folgado de propósito: enquanto
 * ninguém o alcança, ele é uma rede de segurança que não muda nada na tela.
 *
 * ## Truncar em silêncio é pior que não truncar
 *
 * Uma listagem que devolve 1000 de 1500 linhas sem avisar mente para quem
 * está olhando — a pessoa conclui que a base tem 1000. Por isso as consultas
 * buscam `limite + 1` linhas e devolvem `truncado`, e as telas dizem, em
 * texto, que há mais coisa do que está sendo mostrada.
 */
export const LIMITE_LISTAGEM = 1000;

/** Resultado de uma listagem com teto: as linhas e se sobrou coisa de fora. */
export type Listagem<T> = {
  itens: T[];
  truncado: boolean;
};

/**
 * Aplica o teto a um conjunto buscado com `take: limite + 1`.
 *
 * A linha extra é o que permite distinguir "exatamente `limite` linhas" de
 * "`limite` linhas e tem mais" — sem ela, a única alternativa seria comparar
 * `length === limite`, que dispararia aviso falso quando a base tem
 * exatamente o número do teto.
 */
export function aplicarTeto<T>(linhas: T[], limite: number = LIMITE_LISTAGEM): Listagem<T> {
  if (linhas.length <= limite) return { itens: linhas, truncado: false };
  return { itens: linhas.slice(0, limite), truncado: true };
}
