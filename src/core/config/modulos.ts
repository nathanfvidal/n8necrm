import { notFound } from "next/navigation";

import { configDaEmpresa } from "./leitura";

export type { ModuloNome } from "./schema";
import type { ModuloNome } from "./schema";

/**
 * O portão de módulos, agora POR EMPRESA.
 *
 * ## Por que este arquivo saiu de `src/lib/` para `src/core/`
 *
 * Ele passou a ler o banco, e `src/lib/**` **não** é coberto pelo bloco
 * `no-restricted-imports` que proíbe o prisma cru — a regra tem três blocos,
 * `src/core/**`, `src/modules/**` e `src/app/**` (`eslint.config.mjs`, os três
 * `files:` do `eslintConfig`), e nenhum alcança `src/lib`. O próprio
 * `tests/unit/catraca-prisma-cru.test.ts` registra isso por escrito: "a trava
 * alcança árvores que o lint nem cobre (src/components, src/lib, ...)". Um
 * leitor de modelo de tenant morando em `src/lib/` seria o único caminho de
 * leitura do projeto que o lint não olha. Aqui ele fica debaixo da regra, e é a
 * regra que garante que a leitura passe por `prismaDaEmpresa` — hoje, uma
 * camada abaixo, em `./leitura`.
 *
 * ## Por que o nome é `modulos`, com `o`
 *
 * O arquivo antigo chamava-se `module-gate` e não `modules` porque
 * `FRONTEIRA_CORE_MODULES` (`eslint.config.mjs`) usa os padrões `**\/modules` e
 * `**\/modules/*` para a fronteira core↛modules, propositalmente amplos para
 * pegar tanto `@/modules` quanto grafias relativas. Um `modules.ts` importado
 * de `src/core/**` colidiria com eles por coincidência de nome, bloqueando
 * código legítimo com um erro que aponta para a regra errada. `modulos` é
 * português e não casa com `modules`, então a colisão não volta. Isto não é
 * presumido: a tarefa que criou este arquivo rodou `npm run lint` com ele em
 * disco, e `src/app/(painel)/contatos/[id]/page.tsx` importa daqui.
 *
 * ## `companyId` como PRIMEIRO parâmetro, sempre explícito
 *
 * Não existe versão sem argumento e não há canal ambiente: `AsyncLocalStorage`
 * e estado global são proibidos no programa porque funcionam até o primeiro
 * caminho fora do ciclo de requisição (job de fila, seed, script) — o mesmo
 * argumento escrito em `./leitura`. A origem do valor é
 * `UsuarioAtivo.companyId` (`core/auth/usuario-ativo.ts`), **nunca**
 * `prisma.company.findFirst()`.
 *
 * O `companyId` vir primeiro é a forma que o resto da base já usa: catorze
 * funções de `src/modules/whatsapp` e três de `src/core/tasks` abrem a
 * assinatura com ele, medido em 2026-08-20 com
 * `perl -0777 -ne 'while(/export\s+(?:async\s+)?function\s+(\w+)\s*\(\s*companyId/gs){...}'`
 * sobre os dois diretórios. (O briefing desta tarefa dizia "nove e sete"; a
 * contagem em disco é outra, e vale mais que o número escrito de memória.)
 *
 * As seis páginas que chamam o portão já resolvem a sessão no mesmo corpo, e a
 * consulta extra não se paga em ida ao banco: `configDaEmpresa` é memoizada por
 * requisição pelo `cache()` do React — com a chave sendo o `companyId` — e
 * `(painel)/layout.tsx` já a pediu antes da página renderizar. A memoização tem
 * caso próprio em `tests/unit/config-memoizacao.test.ts`; ela vale no
 * servidor do Next e **não** sob Vitest, pelo motivo medido no bloco "Por que
 * `cache()`" de `./leitura`. Nada aqui depende dela para estar CORRETO — só
 * para ser barato.
 */
export async function moduloAtivo(companyId: string, nome: ModuloNome): Promise<boolean> {
  // Sem `try/catch`: config inválida RECUSA em `./leitura` e o erro sobe daqui
  // intacto. Capturar transformaria "linha do banco corrompida" em "módulo
  // desligado", e o sintoma viraria um 404 que não aponta para nada. Tem caso
  // próprio em `tests/unit/config-modulos.test.ts` ("NÃO engole o erro de
  // config inválida").
  const config = await configDaEmpresa(companyId);
  return config.modulos.includes(nome);
}

/**
 * Chamar no topo de uma `page.tsx` de módulo opcional, DEPOIS de resolver a
 * sessão. Módulo desligado não some só do menu — a rota devolve 404, então
 * digitar a URL diretamente não contorna o portão (spec 3.4 do Ciclo original).
 *
 * A ordem mudou junto com este arquivo: antes o portão rodava ANTES de
 * `usuarioAtualOuLogin()`, e um visitante sem sessão recebia 404 num módulo
 * desligado. Agora recebe redirecionamento para `/login` — o estado dos
 * módulos de uma empresa deixa de ser observável por quem não está
 * autenticado, e é o que `(painel)/layout.tsx` já faria de qualquer forma.
 *
 * O caso "a MESMA rota passa para uma empresa e dá 404 para a outra", em
 * `tests/unit/config-modulos.test.ts`, é o que impede a leitura preguiçosa de
 * "barrar tudo" passar como correção: ele exige as duas metades no mesmo
 * corpo.
 */
export async function exigirModulo(companyId: string, nome: ModuloNome): Promise<void> {
  if (!(await moduloAtivo(companyId, nome))) notFound();
}
