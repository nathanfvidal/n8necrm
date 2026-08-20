import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { avaliarAtividadeSuspeita } from "./alerta";
import { companyIdDoUsuario } from "@/core/users/empresa";

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
 * O `companyId` é PARÂMETRO, e é a diferença que importa: `gravarLinhaDeAuditoria`
 * o deduz de quem AGIU (`companyIdDoUsuario`, que pega um vínculo arbitrário de
 * quem tiver dois — o defeito MÉDIA que mantém este arquivo na fila de
 * conversão), enquanto `excluirEtapa` passa a empresa da ENTIDADE, que é a que
 * a linha deveria ter sempre.
 */
export function dadosDeLinhaDeAuditoria(
  params: ParamsDeAuditoria,
  companyId: string
): Prisma.AuditLogUncheckedCreateInput {
  return {
    companyId,
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
 * porquê está no docstring daquele construtor, logo acima. O parâmetro
 * `cliente` continua aceitando um `tx` cru, e hoje ninguém o usa assim: o único
 * chamador é `registrarAuditoria`, que passa o `prisma` do módulo.
 *
 * O que NÃO entra na transação é `avaliarAtividadeSuspeita`: ela faz `count` no
 * `AuditLog`, `findMany` de ADMINs e `createMany` de notificações, e rodar isso
 * segurando lock em linhas de `Lead` alonga a transação por trabalho que não é
 * do domínio dela.
 *
 * `cliente` aceita tanto o `prisma` do módulo quanto o `tx` de um
 * `$transaction` interativo.
 */
export async function gravarLinhaDeAuditoria(
  params: ParamsDeAuditoria,
  cliente: Prisma.TransactionClient = prisma
): Promise<void> {
  // `AuditLog.companyId` é `NOT NULL` desde a Task 1 do Ciclo 1a, e
  // `ParamsDeAuditoria` NÃO ganhou um campo `companyId` — isso cascataria
  // para os 25 pontos que chamam `registrarAuditoria`/`gravarLinhaDeAuditoria`
  // hoje (8 arquivos, só 5 dentro do escopo desta tarefa de reparo), incluindo
  // `core/users/service.ts` (audita `User`, que não tem `companyId` — só
  // `Membership`) e `modules/automation/actions.ts` (audita workflow do n8n,
  // que não é uma entidade deste schema). Resolver a empresa a partir de quem
  // AGIU (`params.userId`, já obrigatório em todo `ParamsDeAuditoria`) via
  // `companyIdDoUsuario` evita essa cascata inteira — ver o comentário do
  // helper para por que isto não é "buscar a única empresa do banco".
  const companyId = await companyIdDoUsuario(params.userId, cliente);

  await cliente.auditLog.create({ data: dadosDeLinhaDeAuditoria(params, companyId) });
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
    await avaliarAtividadeSuspeita({ userId: params.userId, acao: params.acao });
  } catch (erro) {
    console.error("Falha ao avaliar atividade suspeita (auditoria já gravada):", erro);
  }
}
