import type { Prisma } from "@prisma/client";
import { prismaDaEmpresa } from "@/core/tenancy/escopo";
import { IP_DESCONHECIDO, ipDaRequisicaoAtual } from "@/lib/ip";
import { avaliarAtividadeSuspeita } from "./alerta";

/**
 * Registra uma entrada no audit log: quem fez o quê, em qual entidade, com
 * o estado antes/depois da mudança.
 *
 * `antes`/`depois` passam por `JSON.parse(JSON.stringify(...))` para virar
 * um valor "JSON puro" aceito pelo campo `Json` do Prisma. Isso tem efeitos
 * colaterais que quem chama esta função precisa conhecer:
 *
 * - `Date` vira string ISO (Date.prototype.toJSON = toISOString). Ao ler de
 *   volta, `antes.criadoEm` é string, não instância de Date.
 * - `Prisma.Decimal` (ex.: `Lead.valorEstimado`) vira string, porque a
 *   classe Decimal do Prisma define `toJSON()` retornando o valor como
 *   texto (evita perda de precisão que um `number` teria, mas quem lê de
 *   volta precisa fazer `new Prisma.Decimal(...)` ou `Number(...)` para
 *   voltar a operar com o valor).
 * - Propriedades com valor `undefined` são omitidas do resultado (regra
 *   padrão do `JSON.stringify`). `null` explícito é preservado.
 * - `antes`/`depois` não informados (`undefined`) não são enviados ao
 *   Prisma — a coluna fica com o padrão do banco (NULL), e não sofrem a
 *   coerção acima.
 */

export type ParamsDeAuditoria = {
  /**
   * A empresa da ENTIDADE auditada, não a de quem agiu.
   *
   * ## Por que este campo passou a ser obrigatório (Ciclo 1d)
   *
   * Até aqui a empresa era DEDUZIDA de `userId` por `companyIdDoUsuario`
   * (`core/users/empresa.ts`), que faz `membership.findFirstOrThrow({ where: {
   * userId } })` — ou seja, pega um vínculo ARBITRÁRIO de quem tem mais de um.
   * Enquanto ninguém tinha dois vínculos, isso não se via. `criarUsuario`
   * (`core/users/service.ts`) já sabe criar `Membership`, então "a mesma pessoa
   * em duas empresas" é estado expressável hoje — e no dia em que existir, quem
   * agisse sobre entidade da empresa A poderia gravar o rastro na B. O rastro é
   * exatamente o que se lê depois para reconstituir o estrago; gravá-lo na
   * empresa errada o torna invisível para quem precisa dele e visível para quem
   * não deveria vê-lo.
   *
   * O caso que trava isso é "grava na empresa que RECEBEU por parâmetro, não no
   * vínculo arbitrário do autor" (`tests/unit/audit-isolamento.test.ts`), com um
   * usuário de vínculo duplo.
   *
   * **A origem é sempre a entidade**, e nos 17 pontos que chamam esta função ela
   * já estava em mãos: `companyId` que o serviço recebeu, `task.companyId`,
   * `lead.companyId` ou `usuarioAtual().companyId`. Nenhum deles precisou de uma
   * consulta nova — o que havia era a dedução no lugar do valor.
   */
  companyId: string;
  userId: string;
  acao: string;
  entidade: string;
  entidadeId: string;
  antes?: unknown;
  depois?: unknown;
  ip?: string;
};

/**
 * O `data` de uma linha de auditoria, com a coerção de Json feita num lugar só.
 *
 * ## Por que isto é exportado
 *
 * Por causa de `excluirEtapa` (`core/pipeline/service.ts`), e o motivo é de
 * TIPO, não de gosto. Aquela função grava a linha DENTRO da transação que apaga
 * a etapa (o docstring de `gravarLinhaDeAuditoria` explica por quê), e desde a
 * conversão de `pipeline` no Ciclo 1a a transação dela é aberta sobre o cliente
 * ESCOPADO — cujo `tx` tem tipo próprio (`DynamicClientExtensionThis`) e **não
 * é assignável** a `Prisma.TransactionClient`. Medido em 2026-08-20 com
 * `npm run typecheck`: o erro é TS2345, nos delegates de `User`.
 *
 * As saídas eram três: alargar a assinatura daqui para uma união (que espalha o
 * problema por `companyIdDoUsuario` também), forçar um cast (que esconderia uma
 * incompatibilidade real de tipos atrás de uma afirmação de quem escreveu), ou
 * separar a MONTAGEM do payload da ESCRITA. É a terceira: quem tem o cliente
 * escreve, e a parte que não pode divergir entre os dois caminhos — a coerção
 * de `antes`/`depois` para Json puro, com todos os efeitos colaterais listados
 * no topo deste arquivo — continua morando aqui.
 *
 * O `companyId` era um SEGUNDO parâmetro até o Ciclo 1d, porque
 * `ParamsDeAuditoria` não tinha o campo e os dois chamadores resolviam a empresa
 * de formas diferentes (`gravarLinhaDeAuditoria` deduzia do autor; `excluirEtapa`
 * passava a da entidade). Com o campo obrigatório em `ParamsDeAuditoria`, os dois
 * passaram a dizer a mesma coisa — e manter as duas portas abertas só criaria a
 * chance de elas discordarem numa edição futura, sem erro de tipo nenhum.
 */
export function dadosDeLinhaDeAuditoria(
  params: ParamsDeAuditoria
): Prisma.AuditLogUncheckedCreateInput {
  return {
    companyId: params.companyId,
    userId: params.userId,
    acao: params.acao,
    entidade: params.entidade,
    entidadeId: params.entidadeId,
    antes: params.antes === undefined ? undefined : JSON.parse(JSON.stringify(params.antes)),
    depois: params.depois === undefined ? undefined : JSON.parse(JSON.stringify(params.depois)),
    ip: params.ip,
  };
}

/**
 * Completa o `ip` quando o chamador não tinha um `Request` para consultar.
 *
 * Item 39 da auditoria de 2026-08-21: `AuditLog.ip` estava preenchido em **1
 * dos 23 pontos**. A causa não era desleixo, é estrutural — 22 dos 23 nascem
 * em Server Action, e Server Action não recebe `Request`. O único jeito de
 * alcançar o IP ali é `headers()` de `next/headers`, e chamá-la aqui, no funil
 * único, resolve os 22 de uma vez (ver o docstring de `ipDaRequisicaoAtual`).
 *
 * **A precedência é do chamador.** `params.ip` informado nunca é
 * sobrescrito: o caminho da exportação de leads já lê o IP do `Request` real
 * do route handler, e o do login lê o `Request` que o @auth/core reconstrói.
 * Os dois têm fonte melhor que a ambiente, e continuam vencendo.
 *
 * ONDE ISTO NÃO ALCANÇA, e por quê — a lista importa porque uma coluna
 * preenchida "quase sempre" engana quem investiga:
 *
 * - **Fora de requisição HTTP**: consumidor da fila do WhatsApp, seed,
 *   scripts. Não há requisição, então não há IP — e o `undefined` é a resposta
 *   honesta, não uma falha.
 * - **`excluirEtapa`** (`core/pipeline/service.ts`) grava a linha DENTRO da
 *   transação, por `tx.auditLog.create(dadosDeLinhaDeAuditoria(...))`, sem
 *   passar por aqui. Ela resolve o IP antes de abrir a transação e o passa
 *   explicitamente — o alternativo seria fazer uma chamada assíncrona a
 *   `headers()` com lock de linha em `Lead` na mão.
 */
async function comIpDaRequisicao(params: ParamsDeAuditoria): Promise<ParamsDeAuditoria> {
  // `IP_DESCONHECIDO` é a sentinela que `obterIpDaRequisicao` devolve quando não
  // há borda confiável (Ciclo 2d, `lib/ip.ts`). Ela existe porque os chamadores
  // de rate limit precisam de uma `string` para montar chave — mas aqui a coluna
  // é ANULÁVEL, e gravar a sentinela a deixaria indistinguível de um IP real
  // vindo de uma máquina chamada "desconhecido". Coluna preenchida com um valor
  // que não é um IP é pior que coluna vazia: vazio é ausência de informação,
  // sentinela é informação que parece dado. Normalizada aqui, no funil, e não em
  // cada chamador — mesmo argumento que trouxe `ipDaRequisicaoAtual` para cá.
  const informado = params.ip === IP_DESCONHECIDO ? undefined : params.ip;
  if (informado !== undefined) return { ...params, ip: informado };
  return { ...params, ip: await ipDaRequisicaoAtual() };
}

/**
 * Grava a linha, e só isso.
 *
 * Existe separada de `registrarAuditoria` porque há um caminho que precisa da
 * linha DENTRO de uma transação: `excluirEtapa` (`core/pipeline/service.ts`)
 * apaga a etapa e grava o rastro no mesmo commit — aquela é a única entrada
 * forense da operação (não há entrada por lead), e a etapa de origem deixa de
 * existir, então não há de onde reconstituir para onde os leads foram. Ou a
 * etapa some com o rastro, ou nada some.
 *
 * **`excluirEtapa` não chama mais ESTA função**, e a distinção importa para
 * quem for editar: desde a conversão de `pipeline` (Ciclo 1d) ela monta o
 * payload com `dadosDeLinhaDeAuditoria` e escreve pelo `tx` ESCOPADO, porque o
 * `tx` do cliente escopado não é assignável a `Prisma.TransactionClient` — o
 * porquê está no docstring daquele construtor, logo acima.
 *
 * ## O parâmetro `cliente` foi REMOVIDO no Ciclo 1d
 *
 * Ele existia para receber um `tx` cru, e nenhum chamador o usava assim desde
 * que `excluirEtapa` passou a escrever pelo próprio `tx` escopado — o único
 * chamador restante, `registrarAuditoria`, sempre omitia. Mantê-lo custava mais
 * que a flexibilidade que oferecia: um parâmetro de tipo `PrismaClient` é
 * exatamente a fuga que a Parte 2a de `tests/unit/catraca-prisma-cru.test.ts`
 * existe para pegar — o arquivo não IMPORTA o cliente cru, ele o RECEBE, e com
 * ele some a injeção de `companyId`. A catraca acusou este parâmetro no mesmo
 * commit em que o arquivo saiu da fila de conversão, que é o instante em que
 * ela passa a valer para ele.
 *
 * Quem precisar gravar a linha dentro de uma transação faz o que `excluirEtapa`
 * faz: `tx.auditLog.create({ data: dadosDeLinhaDeAuditoria(params) })`, com o
 * `tx` vindo de `prismaDaEmpresa(companyId).$transaction(...)`.
 *
 * O que NÃO entra na transação é `avaliarAtividadeSuspeita`: ela faz `count` no
 * `AuditLog`, `findMany` de ADMINs e `createMany` de notificações, e rodar isso
 * segurando lock em linhas de `Lead` alonga a transação por trabalho que não é
 * do domínio dela.
 */
export async function gravarLinhaDeAuditoria(
  paramsRecebidos: ParamsDeAuditoria
): Promise<void> {
  const params = await comIpDaRequisicao(paramsRecebidos);

  // A cascata que a versão anterior deste comentário evitava — 17 pontos de
  // chamada em 8 arquivos — foi PAGA no Ciclo 1d, e o que se ganhou foi a
  // empresa da entidade no lugar de um vínculo arbitrário do autor (ver
  // `ParamsDeAuditoria.companyId`). Os dois casos que pareciam não ter empresa
  // própria têm: `core/users/service.ts` audita `User`, que não tem
  // `companyId`, mas as quatro funções de lá já recebiam a empresa de quem
  // gerencia — é ela que delimita QUEM é gerenciável; e
  // `modules/automation/actions.ts` audita workflow do n8n, que não é entidade
  // deste schema, e usa `usuarioAtual().companyId`, a empresa da sessão que
  // operou o fluxo.
  const db = prismaDaEmpresa(params.companyId);

  await db.auditLog.create({ data: dadosDeLinhaDeAuditoria(params) });
}

export async function registrarAuditoria(params: ParamsDeAuditoria): Promise<void> {
  await gravarLinhaDeAuditoria(params);

  // Detecção de rajada destrutiva, avaliada AQUI e não em cada service.
  //
  // Este é o único funil por onde toda ação auditável do sistema passa.
  // Espalhar a chamada pelos services deixaria a regra sujeita à armadilha
  // clássica desta auditoria — "regra numa tela, esquecida na outra": bastaria
  // um caminho de exclusão futuro esquecer de chamar, e ele seria justamente
  // o caminho por onde ninguém veria a sabotagem passar.
  //
  // Falha aqui é ENGOLIDA, ao contrário do fail-closed da exportação de leads
  // (`app/(painel)/export/leads/route.ts`), e a diferença tem razão: lá o log
  // ERA o registro, então sem ele a operação não podia acontecer. Aqui o
  // registro já está gravado acima — o alerta é um extra em cima dele.
  // Derrubar a exclusão de uma tarefa porque um aviso não pôde ser enviado
  // transformaria um problema de notificação em perda de trabalho do usuário.
  try {
    await avaliarAtividadeSuspeita({
      companyId: params.companyId,
      userId: params.userId,
      acao: params.acao,
    });
  } catch (erro) {
    console.error("Falha ao avaliar atividade suspeita (auditoria já gravada):", erro);
  }
}
