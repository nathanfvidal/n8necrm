import { cache } from "react";

import { prismaDaEmpresa } from "@/core/tenancy/escopo";

import { mesclarConfig, type ConfigDaEmpresa } from "./schema";

export { ConfigDaEmpresaInvalidaError, type ConfigDaEmpresa } from "./schema";

/**
 * A configuração de UMA empresa: nome, marca e módulos, com o banco sobrepondo
 * `config/client.ts`.
 *
 * ## `companyId` é parâmetro, e é a única forma de chegar aqui
 *
 * Não existe versão sem argumento, e não há canal ambiente: `AsyncLocalStorage`
 * e estado global são proibidos no programa porque funcionam até o primeiro
 * caminho fora do ciclo de requisição (job de fila, seed, script). A origem do
 * `companyId` é `UsuarioAtivo.companyId` (`core/auth/usuario-ativo.ts`) —
 * **nunca** `prisma.company.findFirst()`, que devolveria "alguma" empresa.
 *
 * O arquivo não tem binding mutável nem coleção em escopo de módulo, e isso não
 * é promessa: o caso "`leitura.ts` não tem binding mutável nem coleção em
 * escopo de módulo" de `tests/unit/config-leitura.test.ts` varre o fonte sem
 * comentários e reprova `let`/`var`/`new Map`/`new Set`/`new WeakMap`/
 * `globalThis` no topo. Sem ele, a frase seria prosa — um `Map` por empresa
 * passaria em todos os outros casos e só apareceria servindo a marca da empresa
 * A para a B, entre requisições, num processo de longa duração.
 *
 * ## Por que `cache()`, e por que ele não é aquele estado global
 *
 * O layout do painel precisa desta configuração mais de uma vez na mesma
 * requisição: em `generateMetadata` (o título), no tema/fonte, e nos módulos
 * que vão por prop para a navegação. Sem memoização seria uma consulta por
 * consumidor, a cada navegação.
 *
 * `cache()` memoiza **por argumento**, dentro de um render de requisição, e
 * nada além disso: sem TTL, sem estado entre requisições, sem canal implícito.
 * `companyId` continua entrando pela assinatura, então duas empresas nunca
 * compartilham entrada. Fora de contexto de requisição — Vitest, seed, job de
 * fila — ele simplesmente **não memoiza** e a função consulta de novo: degrada
 * em custo, nunca em resposta.
 *
 * Nada disso é dedução sobre o React; é o corpo das duas implementações que o
 * pacote publica, medidas em 2026-08-20 no react 19.2.4 desta árvore:
 *
 * - `node_modules/react/cjs/react.development.js` (a que Vitest e qualquer
 *   caminho não-RSC resolvem) traz `exports.cache = function (fn) { return
 *   function () { return fn.apply(null, arguments); }; }` — passa-fio.
 * - `node_modules/react/cjs/react.react-server.development.js` (a condição
 *   `react-server`, que o Next.js carrega num Server Component) lê o dispatcher
 *   em `ReactSharedInternals.A`, devolve `fn.apply(...)` direto quando ele não
 *   existe e, quando existe, percorre `arguments` posição a posição descendo
 *   num nó de cache por valor. A chave É a lista de argumentos.
 *
 * `src/core/auth/session.ts` já depende da primeira metade disso, e registra
 * `tests/unit/session.test.ts` como canário. Aqui as duas metades têm caso
 * próprio: `tests/unit/config-leitura.test.ts` prova que a CORRETUDE não
 * depende do cache (duas chamadas fora de requisição → duas consultas, mesma
 * resposta; empresas diferentes → respostas diferentes), e
 * `tests/unit/config-memoizacao.test.ts` instala um dispatcher e prova a
 * MEMOIZAÇÃO (mesmo `companyId` → uma consulta só; `companyId` diferente →
 * duas; dispatcher novo → consulta nova). Os dois arquivos existem separados
 * porque as duas implementações de `cache` se excluem dentro de um mesmo
 * arquivo de teste.
 *
 * ## Config quebrada RECUSA, e o erro sobe daqui sem tratamento
 *
 * `mesclarConfig` (Task 2) valida o objeto MESCLADO, não a linha crua: uma
 * `corPrimaria` abaixo de `CROMA_MINIMO` gravada no banco reprova a leitura
 * inteira e lança `ConfigDaEmpresaInvalidaError`. Esta função **não captura**.
 *
 * A alternativa era cair no padrão do arquivo em silêncio, e ela foi recusada
 * pelo mesmo argumento que faz `CROMA_MINIMO` existir (`config/client.schema.ts`):
 * abaixo do piso "o white-label para de funcionar em silêncio". Uma leitura que
 * engolisse o erro abriria o painel na marca genérica, e o sintoma — "por que a
 * cor do cliente sumiu?" — não apontaria para a linha ruim. O custo da escolha
 * é real e vale escrever: com o painel lendo esta função no layout, uma linha
 * inválida derruba a navegação daquela empresa (e só daquela — o erro carrega o
 * `companyId`, e a leitura é escopada). É falha barulhenta de propósito.
 *
 * Quem quiser degradar em vez de cair captura no chamador: por isso
 * `ConfigDaEmpresaInvalidaError` é reexportado aqui, para que quem consome só a
 * leitura não precise conhecer `./schema`. O que este arquivo não faz é decidir
 * isso por todo mundo, em silêncio.
 *
 * Dentro de uma requisição a recusa é memoizada junto com o resto — `cache`
 * guarda a Promise rejeitada —, então uma config quebrada não vira uma consulta
 * por chamador só para falhar de novo. Tem caso em
 * `tests/unit/config-memoizacao.test.ts`.
 *
 * ## Uma consulta, e por que ela pode ler `Company`
 *
 * `Company` está FORA de `MODELOS_DE_TENANT`, então `escoparArgumentos` devolve
 * os argumentos INTACTOS — comportamento com caso próprio em
 * `tests/unit/escopo-empresa.test.ts` e cobrado de novo aqui, no caso
 * "`Company` passa INTACTA pelo escopo". O filtro é escrito à mão e é o próprio
 * escopo: `where: { id: companyId }`. Ler `Company` pelo id que veio da sessão
 * é LOOKUP, não origem de empresa.
 *
 * A relação `config` desce no mesmo `select`. Leitura aninhada não é escopada
 * (ver "Leitura ANINHADA" em `core/tenancy/escopo.ts`), e aqui isso não é
 * buraco: a regra que aquele arquivo dá é "relação que fica dentro de `Company`
 * é segura; relação que passa por `User` não é", e `CompanyConfig` pendura em
 * `Company` por `companyId` (`prisma/schema.prisma`, `@@unique([companyId])`).
 * A prova contra Postgres real, com duas empresas e uma sonda, está em
 * `tests/unit/config-isolamento.test.ts`.
 *
 * `findUniqueOrThrow` e não `findFirst`: o escopo só recusa operação por chave
 * única em modelo de TENANT, e `Company` não é um. Empresa que não existe é
 * erro, não lista vazia — o `companyId` veio de um `Membership` válido.
 *
 * O `select` desta consulta é o que casa com `LinhaDeConfig` (`./schema`). Esse
 * tipo é escrito à mão lá para que a mescla não importe `@prisma/client`, e o
 * casamento entre os dois é cobrado pelo `tsc` neste ponto: campo a mais, a
 * menos ou renomeado no schema quebra a chamada de `mesclarConfig` abaixo.
 */
export const configDaEmpresa = cache(async function configDaEmpresa(
  companyId: string,
): Promise<ConfigDaEmpresa> {
  const empresa = await prismaDaEmpresa(companyId).company.findUniqueOrThrow({
    where: { id: companyId },
    select: {
      nome: true,
      config: {
        select: {
          corPrimaria: true,
          fonte: true,
          logoClaro: true,
          logoEscuro: true,
          modulos: true,
        },
      },
    },
  });

  return mesclarConfig(companyId, empresa.nome, empresa.config);
});
