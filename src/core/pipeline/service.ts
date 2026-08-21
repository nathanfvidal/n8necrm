import "server-only";

import { prismaDaEmpresa } from "@/core/tenancy/escopo";
import { dadosDeLinhaDeAuditoria, registrarAuditoria } from "@/core/audit/log";
import { ipDaRequisicaoAtual } from "@/lib/ip";
import { avaliarAtividadeSuspeita } from "@/core/audit/alerta";
import { etapaSchema } from "./schema";
import type { PipelineStage } from "@prisma/client";

/**
 * O funil, escopado por empresa (Ciclo 1a).
 *
 * ## Por que este arquivo foi REDESENHADO e não só convertido
 *
 * Os outros módulos da fila trocavam `prisma` por `prismaDaEmpresa(companyId)`
 * num `companyId` que a função já recebia. Aqui não havia nenhum: nenhuma das
 * cinco funções públicas tinha noção de empresa, e a única que precisava de um
 * `companyId` para gravar (`criarEtapa`) o DEDUZIA de quem estava agindo, via
 * `companyIdDoUsuario(autorId)`. Isso deixava o funil inteiro — leitura,
 * reordenação, flag de fechamento e exclusão — operando sobre a tabela toda.
 *
 * As cinco passaram a receber `companyId` explícito. A origem, em toda Server
 * Action, é `usuarioAtual().companyId` (`actions.ts`), nunca parâmetro de
 * formulário: Server Action é endpoint HTTP público e o parâmetro é forjável.
 * O `companyId` viaja como PARÂMETRO e não por `AsyncLocalStorage` — estado
 * global funciona até o primeiro caminho que roda fora do ciclo de requisição
 * (job de fila, seed, script), que é onde ninguém está olhando quando o escopo
 * some.
 *
 * O `companyIdDoUsuario` saiu junto, e o ganho é maior que um import a menos:
 * ele pega um vínculo ARBITRÁRIO de quem tiver mais de um (o próprio arquivo se
 * documenta como ponte temporária por isso). Uma etapa criada por alguém com
 * dois vínculos podia nascer na empresa errada mesmo antes de existir qualquer
 * vazamento de leitura.
 *
 * ## O que o escopo faz por este arquivo, e o que ele NÃO faz
 *
 * `prismaDaEmpresa` injeta `where.companyId`/`data.companyId` e LANÇA nas
 * operações por chave única (`findUnique`, `update`, `delete`, `upsert`) — é
 * por isso que `findUnique` virou `findFirst`, `update` virou
 * `updateManyAndReturn`/`updateMany` e `delete` virou `deleteMany` aqui
 * dentro. O detalhe está em `core/tenancy/escopo.ts`, seção "Recusa,
 * lançando".
 *
 * O que ele NÃO alcança é `$queryRaw` — e este arquivo tem um
 * (`travarEstruturaDoFunil`). Lá o filtro de empresa é escrito À MÃO, e é a
 * única linha do módulo em que ele depende de alguém ter lembrado. O que
 * impede o esquecimento de virar silêncio é `tests/unit/catraca-prisma-cru.test.ts`,
 * que passou a cobrar `companyId` em SQL cru sobre tabela de tenant assim que
 * este arquivo saiu da fila de conversão do lint.
 */
export class EtapaInvalidaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "EtapaInvalidaError";
  }
}

/**
 * O cliente escopado, como tipo — mesmo padrão de `core/leads/service.ts:30`,
 * e o motivo de ele existir aqui é o mesmo: os auxiliares abaixo recebem o
 * cliente, e nomear `Prisma.TransactionClient` num arquivo já convertido seria
 * reabrir por parâmetro a porta que o lint fechou por import (a Parte 2a de
 * `tests/unit/catraca-prisma-cru.test.ts` cobra exatamente isso).
 */
type ClienteDaEmpresa = ReturnType<typeof prismaDaEmpresa>;

/**
 * O `tx` de uma transação INTERATIVA aberta sobre o cliente escopado.
 *
 * Derivado do próprio tipo do cliente, e não escrito à mão, por dois motivos.
 * O primeiro é o de sempre: um tipo escrito à mão envelhece quando o Prisma
 * muda o dele. O segundo é uma armadilha concreta desta base — a Parte 2b de
 * `tests/unit/catraca-prisma-cru.test.ts` varre o TEXTO do arquivo atrás de
 * chamadas de SQL cru, e um tipo escrito como `Pick<ClienteDaEmpresa, "$queryRaw">`
 * casa com essa varredura (o nome da operação aparece como string literal), que
 * então não consegue ler um SQL depois dele e ACUSA — corretamente, pelo que
 * ela sabe. A catraca acusar uma anotação de tipo é o comportamento certo dela:
 * forma que a varredura não entende é o caso em que ela não pode afirmar nada.
 * Medido em 2026-08-20, na primeira execução com este módulo fora da fila.
 */
type TransacaoDaEmpresa = Parameters<Parameters<ClienteDaEmpresa["$transaction"]>[0]>[0];

/** `safeParse` → erro de domínio. Sem isto a falha cairia no ramo genérico da action. */
function validar(entrada: { nome: string; cor: string }) {
  const analisado = etapaSchema.safeParse(entrada);
  if (!analisado.success) {
    throw new EtapaInvalidaError(analisado.error.issues[0].message);
  }
  return analisado.data;
}

/**
 * Recusa nome repetido DENTRO DA EMPRESA, ignorando diferença de maiúscula.
 *
 * A checagem é aqui e não no banco: um índice único case-insensitive em Postgres
 * é funcional (`LOWER(nome)`), o Prisma não o representa, e ele viraria drift no
 * próximo diff — o mesmo motivo pelo qual a branch de contato recusou o índice
 * `pg_trgm` (ver `prisma/schema.prisma`).
 *
 * O `findFirst` era sobre a tabela inteira, e o efeito era nos dois sentidos:
 * a empresa A não conseguia ter uma etapa "Proposta" porque a B já tinha, e a
 * mensagem de erro ("Já existe uma etapa chamada ...") confirmava a existência
 * de um nome de outro cliente a quem sondasse. Agora o `where` sai do cliente
 * escopado com `companyId` injetado.
 *
 * **Isto NÃO é atômico**, e o comentário existe para ninguém acreditar que é.
 * Dois ADMINs criando o mesmo nome no mesmo instante conseguem. Com a permissão
 * restrita a ADMIN a janela é quase inalcançável, e o pior desfecho — duas
 * colunas com o mesmo nome — se conserta renomeando uma. Aceito, não resolvido.
 */
async function recusarNomeRepetido(
  db: ClienteDaEmpresa,
  nome: string,
  ignorarId: string | null
): Promise<void> {
  const existente = await db.pipelineStage.findFirst({
    where: {
      nome: { equals: nome, mode: "insensitive" },
      ...(ignorarId ? { id: { not: ignorarId } } : {}),
    },
    select: { id: true },
  });

  if (existente) {
    throw new EtapaInvalidaError(`Já existe uma etapa chamada "${nome}".`);
  }
}

/**
 * A etapa por id, DENTRO da empresa — ou `null`.
 *
 * Era `prisma.pipelineStage.findUnique({ where: { id } })` em quatro funções, e
 * era a família de defeito que reincidiu seis vezes neste ciclo: validar que o
 * registro EXISTE e nunca que ele é da MESMA EMPRESA. O escopo recusa
 * `findUnique` em modelo de tenant (o `where` dela só aceita campo único, e
 * `companyId` não é único em `PipelineStage`), então a equivalente escopável é
 * `findFirst` — e o `companyId` entra sozinho no `where`.
 *
 * A mensagem de quem chama é a MESMA de "não existe", de propósito: distinguir
 * "não existe" de "existe, mas é de outra empresa" confirmaria, a quem sonda
 * ids, que aquele cuid pertence a alguém. Mesmo raciocínio de
 * `responsavelDaEmpresa` (`core/leads/service.ts`) e de `editarNota`.
 */
function etapaDaEmpresa(db: ClienteDaEmpresa, etapaId: string) {
  return db.pipelineStage.findFirst({ where: { id: etapaId } });
}

/**
 * `update` por id, reescrita como a equivalente escopável — mesmo desenho de
 * `atualizarLeadEscopado` (`core/leads/service.ts`), e pelo mesmo motivo.
 *
 * `updateManyAndReturn` é a equivalente de `update` sob escopo: o `companyId`
 * entra no `where` E o `data` é conferido, e ela devolve as linhas atualizadas,
 * que é o que `editarEtapa` precisa para auditar o "depois".
 *
 * Lista vazia significa que o `where` composto (`id` + `companyId` do escopo)
 * não casou com nenhuma linha. Quem chama já leu a etapa antes, com o mesmo
 * escopo, então isso só acontece se a linha sumir entre as duas consultas —
 * corrida real, ainda que rara. Lançar aqui é o que impede o `[0]` de virar
 * `undefined` e o erro aparecer três linhas adiante, sem relação visível com a
 * causa.
 */
async function atualizarEtapaEscopada(
  db: ClienteDaEmpresa,
  etapaId: string,
  data: { nome?: string; cor?: string }
): Promise<PipelineStage> {
  const [depois] = await db.pipelineStage.updateManyAndReturn({
    where: { id: etapaId },
    data,
  });

  if (!depois) {
    throw new EtapaInvalidaError("Essa etapa não existe mais. Atualize a página.");
  }

  return depois;
}

export async function criarEtapa(input: {
  nome: string;
  cor: string;
  autorId: string;
  companyId: string;
}): Promise<PipelineStage> {
  const db = prismaDaEmpresa(input.companyId);
  const campos = validar(input);
  await recusarNomeRepetido(db, campos.nome, null);

  // Etapa nova entra no FIM DO FUNIL DESTA EMPRESA. `ordem` pode ter buracos
  // (apagar a de ordem 2 deixa 0,1,3,4) e isso é correto — por isso `max + 1`,
  // e não `count()`. O `aggregate` sai do cliente escopado: sem isso o `_max`
  // era o da tabela inteira, e a etapa da empresa A nascia depois da última
  // etapa da empresa B — com um buraco do tamanho do funil alheio no meio.
  //
  // Escopar o `_max` no Ciclo 1d tornou ALCANÇÁVEL um segundo defeito, que só
  // o Ciclo 1e fechou: enquanto `ordem` foi única GLOBAL, `max(da empresa) + 1`
  // podia cair num número já ocupado por OUTRA empresa, e o `create` abaixo
  // devolvia `P2002` na tela `/etapas` apontando para uma etapa que quem
  // clicou não pode ver. Com `@@unique([companyId, ordem])` esse valor só
  // precisa estar livre dentro da empresa, que é exatamente o que o `_max`
  // acima garante. Caso em `tests/unit/pipeline-isolamento.test.ts`
  // ("`criarEtapa` na B cai em `max(ordem da B) + 1` mesmo com a A já ocupando
  // esse número").
  const maior = await db.pipelineStage.aggregate({ _max: { ordem: true } });

  const etapa = await db.pipelineStage.create({
    data: {
      // Explícito porque o `$extends` de query NÃO relaxa os TIPOS: o
      // `PipelineStageUncheckedCreateInput` continua exigindo `companyId`
      // mesmo com a injeção em vigor. Para um valor já igual ao escopo, o
      // escopo age como VERIFICADOR (recusa divergência) em vez de
      // preenchedor — ver "O tipo não sabe o que o runtime faz" em
      // `core/tenancy/escopo.ts`.
      companyId: input.companyId,
      nome: campos.nome,
      cor: campos.cor,
      ordem: (maior._max.ordem ?? -1) + 1,
      ehGanho: false,
      ehPerdido: false,
    },
  });

  await registrarAuditoria({
    companyId: input.companyId,
    userId: input.autorId,
    acao: "criar_etapa",
    entidade: "PipelineStage",
    entidadeId: etapa.id,
    depois: { nome: etapa.nome, cor: etapa.cor, ordem: etapa.ordem },
  });

  return etapa;
}

export async function editarEtapa(input: {
  etapaId: string;
  nome: string;
  cor: string;
  autorId: string;
  companyId: string;
}): Promise<PipelineStage> {
  const db = prismaDaEmpresa(input.companyId);
  const campos = validar(input);

  const atual = await etapaDaEmpresa(db, input.etapaId);
  if (!atual) {
    throw new EtapaInvalidaError("Essa etapa não existe mais. Atualize a página.");
  }

  await recusarNomeRepetido(db, campos.nome, atual.id);

  const depois = await atualizarEtapaEscopada(db, atual.id, {
    nome: campos.nome,
    cor: campos.cor,
  });

  await registrarAuditoria({
    companyId: input.companyId,
    userId: input.autorId,
    acao: "editar_etapa",
    entidade: "PipelineStage",
    entidadeId: atual.id,
    antes: { nome: atual.nome, cor: atual.cor },
    depois: { nome: depois.nome, cor: depois.cor },
  });

  return depois;
}

/**
 * Posição de estacionamento usada durante a troca de duas etapas.
 *
 * `PipelineStage_companyId_ordem_key` é um índice ÚNICO, e o Postgres o
 * verifica a cada `UPDATE` — não no fim da transação. Trocar as etapas de
 * ordem 0 e 1 com dois `UPDATE`s diretos falha no primeiro, porque por um
 * instante duas linhas da mesma empresa teriam a mesma `ordem`.
 *
 * Negativo de propósito: nenhuma etapa real ocupa posição negativa, então o
 * valor nunca colide com uma linha legítima. Ele existe por microssegundos
 * dentro de uma transação atômica — nenhuma leitura o vê.
 *
 * A alternativa idiomática seria uma constraint `DEFERRABLE INITIALLY DEFERRED`,
 * que o Prisma não representa e que viraria drift no próximo diff. Ver § 5 da
 * spec.
 *
 * A unicidade de `ordem` virou `@@unique([companyId, ordem])` no Ciclo 1e, e o
 * estacionamento CONTINUA necessário: a colisão que ele evita é entre duas
 * etapas da MESMA empresa, e essa continua existindo. O que mudou é que `-1`
 * deixou de ser disputado ENTRE empresas — antes, duas empresas reordenando
 * funis diferentes ao mesmo tempo colidiam neste valor.
 */
export const ORDEM_ESTACIONAMENTO = -1;

export async function moverNaOrdem(input: {
  etapaId: string;
  direcao: "cima" | "baixo";
  autorId: string;
  companyId: string;
}): Promise<void> {
  const db = prismaDaEmpresa(input.companyId);

  const etapa = await etapaDaEmpresa(db, input.etapaId);
  if (!etapa) {
    throw new EtapaInvalidaError("Essa etapa não existe mais. Atualize a página.");
  }

  // A vizinha é achada por COMPARAÇÃO, não por `ordem ± 1`: buracos em `ordem`
  // são legais e esperados (apagar a etapa de ordem 2 deixa 0,1,3,4).
  //
  // E ela é achada DENTRO DA EMPRESA. Sem o escopo, a "vizinha" da última
  // etapa da empresa A era a primeira etapa da empresa B — e a troca gravava
  // `ordem` nas duas, atravessando o tenant numa operação que a tela apresenta
  // como "subir uma casa". O caso está travado em
  // `tests/unit/pipeline-isolamento.test.ts` ("a última etapa da A não troca de
  // lugar com a primeira da B"), com as faixas de `ordem` escolhidas para que a
  // vizinha global exista de verdade.
  const subindo = input.direcao === "cima";
  const vizinha = await db.pipelineStage.findFirst({
    where: subindo ? { ordem: { lt: etapa.ordem } } : { ordem: { gt: etapa.ordem } },
    orderBy: { ordem: subindo ? "desc" : "asc" },
  });

  // A tela não desenha ↑ na primeira nem ↓ na última, mas Server Action é
  // endpoint HTTP público. A página não é a defesa.
  if (!vizinha) {
    throw new EtapaInvalidaError(
      subindo ? "Esta etapa já é a primeira do funil." : "Esta etapa já é a última do funil."
    );
  }

  // `db.$transaction`, e não `prisma.$transaction`: o `tx` de um `$transaction`
  // interativo aberto sobre o cliente ESCOPADO carrega a extensão
  // (`_createItxClient` reaplica as extensões — ver o bloco correspondente em
  // `core/tenancy/escopo.ts`). Aquele bloco dizia, com honestidade, que a
  // evidência era da FÁBRICA do cliente interativo e não de uma transação de
  // ponta a ponta contra o Postgres; os casos de `moverNaOrdem`,
  // `definirEtapaDeFechamento` e `excluirEtapa` em
  // `tests/unit/pipeline-isolamento.test.ts` rodam contra o banco real e
  // fecham essa lacuna.
  await db.$transaction(async (tx) => {
    // `updateMany` e não `update`: o escopo recusa `update` em modelo de
    // tenant, e a recusa é o ponto — sem ela, o id sozinho alcançaria a linha
    // de qualquer empresa.
    await tx.pipelineStage.updateMany({
      where: { id: etapa.id },
      data: { ordem: ORDEM_ESTACIONAMENTO },
    });
    await tx.pipelineStage.updateMany({
      where: { id: vizinha.id },
      data: { ordem: etapa.ordem },
    });
    await tx.pipelineStage.updateMany({
      where: { id: etapa.id },
      data: { ordem: vizinha.ordem },
    });
  });

  await registrarAuditoria({
    companyId: input.companyId,
    userId: input.autorId,
    acao: "reordenar_etapa",
    entidade: "PipelineStage",
    entidadeId: etapa.id,
    antes: { nome: etapa.nome, ordem: etapa.ordem },
    depois: { nome: etapa.nome, ordem: vizinha.ordem },
  });
}

/**
 * Marca UMA etapa como a de fechamento DA EMPRESA, desligando a anterior no
 * mesmo commit.
 *
 * O painel calcula a taxa de conversão a partir de `ehGanho`
 * (`app/(painel)/page.tsx`), e o sistema depende de existir exatamente uma etapa
 * com a flag ligada — `confirmarInvarianteEhGanho` (`prisma/seed.ts`) é o alarme
 * que dispara se isso deixar de valer. Até esta branch a invariante era garantida
 * por construção pelo laço do seed; agora é garantida aqui.
 *
 * Desligar vem ANTES de ligar: na ordem inversa, um erro entre os dois passos
 * deixaria duas flags ativas — que é exatamente o bug que o alarme foi escrito
 * para pegar.
 *
 * ## O pior defeito do módulo morava nesta função
 *
 * `updateMany({ where: { ehGanho: true }, data: { ehGanho: false } })` sem
 * empresa nenhuma: uma pessoa da empresa A escolhendo a etapa de fechamento
 * dela DESLIGAVA a etapa de ganho de TODAS as empresas do banco, num commit só.
 * Não era leitura de dado alheio, era escrita destrutiva em massa atravessando
 * tenant — e o efeito na empresa atingida é silencioso: a taxa de conversão do
 * painel dela passa a marcar 0,0% sem erro nenhum, e ninguém liga uma coisa à
 * outra.
 *
 * Isso não é dedução. Na execução RED de `tests/unit/pipeline-isolamento.test.ts`
 * (2026-08-20, antes desta conversão) a etapa "Fechado" da empresa do seed,
 * que não participa de teste nenhum, saiu com `ehGanho = false` — o efeito
 * colateral apareceu numa terceira empresa, fora da fixture. Hoje o
 * `where` sai do cliente escopado com `companyId` injetado.
 */
export async function definirEtapaDeFechamento(input: {
  etapaId: string;
  autorId: string;
  companyId: string;
}): Promise<void> {
  const db = prismaDaEmpresa(input.companyId);

  const etapa = await etapaDaEmpresa(db, input.etapaId);
  if (!etapa) {
    throw new EtapaInvalidaError("Essa etapa não existe mais. Atualize a página.");
  }

  // Lida ANTES da transação: é o único jeito de saber qual etapa PERDEU a
  // flag. Depois da transação ela já está desligada em todo mundo, e não
  // sobra de onde reconstituir quem era. Sem isto a auditoria grava só quem
  // ganhou a flag — contraria o mesmo princípio de `excluirEtapa` logo abaixo
  // ("ou a etapa some com o rastro, ou nada some"): aqui nada some, mas a
  // troca ficaria só meio registrada.
  const etapaAnterior = await db.pipelineStage.findFirst({ where: { ehGanho: true } });

  await db.$transaction(async (tx) => {
    await tx.pipelineStage.updateMany({ where: { ehGanho: true }, data: { ehGanho: false } });
    await tx.pipelineStage.updateMany({ where: { id: etapa.id }, data: { ehGanho: true } });
  });

  await registrarAuditoria({
    companyId: input.companyId,
    userId: input.autorId,
    acao: "definir_etapa_de_fechamento",
    entidade: "PipelineStage",
    entidadeId: etapa.id,
    antes: etapaAnterior ? { nome: etapaAnterior.nome } : undefined,
    depois: { nome: etapa.nome },
  });
}

/**
 * Trava a estrutura do funil DA EMPRESA pelo resto da transação e devolve o que
 * ela é NESTE instante.
 *
 * ## Por que uma leitura travante, e não `count()`
 *
 * Contagem não tranca linha nenhuma. Duas exclusões simultâneas leriam `2`
 * cada uma, as duas passariam pela guarda "o funil precisa de pelo menos uma
 * etapa", e o funil terminaria com ZERO — `criarLead` para de funcionar e o
 * quadro fica vazio. **Mover o `count()` para dentro do `$transaction` não
 * conserta**: sob `READ COMMITTED` (o padrão do Postgres, que o Prisma não
 * troca) uma leitura comum dentro da transação continua enxergando só o que já
 * foi comitado, então as duas leem `2` do mesmo jeito.
 *
 * Com `FOR UPDATE` a segunda transação ESPERA a primeira comitar e só então
 * lê — uma leitura travante reavalia a linha depois de o lock ser liberado.
 * Ela enxerga o funil já reduzido, e recusa. Achado R1 da auditoria desta
 * branch (`docs/auditorias/2026-08-15-crud-etapas-do-funil.md`).
 *
 * ## O `WHERE "companyId"` é escrito À MÃO, e é a única linha assim do módulo
 *
 * `prismaDaEmpresa` não alcança `$queryRaw`: ele não passa por `$allModels`
 * (ver "Não alcança de jeito nenhum" em `core/tenancy/escopo.ts`). Aqui o
 * filtro depende de alguém ter lembrado — em todo o resto do arquivo ele entra
 * sozinho. O que impede o esquecimento de virar silêncio é a Parte 2b de
 * `tests/unit/catraca-prisma-cru.test.ts`, que reprova SQL cru sobre tabela de
 * tenant sem `companyId` em arquivo fora da fila de conversão; ela passou a
 * cobrar este arquivo no instante em que ele saiu da lista de exceção do lint.
 *
 * Sem o filtro, a trava tinha DOIS efeitos, e o segundo é o que dói: ela
 * bloqueava a tabela `PipelineStage` inteira, serializando empresas que não têm
 * nada a ver uma com a outra; e as três guardas decididas sobre ela passavam a
 * valer sobre o funil global — a empresa com UMA etapa só conseguia apagá-la,
 * porque a tabela inteira tinha muitas. Esse caso está travado em
 * `tests/unit/pipeline-isolamento.test.ts` ("a empresa C, com UMA etapa, não
 * consegue esvaziar o funil dela").
 *
 * ## Detalhes que não são estilo
 *
 * - `ORDER BY "id"`: ordem determinística de aquisição. Sem ela, duas
 *   transações pegando as mesmas linhas em ordens diferentes podem travar uma
 *   na outra.
 * - `${companyId}` é PARÂMETRO do template marcado, não interpolação de string:
 *   `$queryRaw` com template tag manda o valor como bind, e `$queryRawUnsafe`
 *   é que concatenaria.
 * - Só `id` e `ehGanho`: é tudo que as guardas precisam, e a trava vale para a
 *   linha inteira de qualquer jeito.
 *
 * O parâmetro é `TransacaoDaEmpresa` (derivado do cliente escopado) e não um
 * tipo de cliente do Prisma: nomear `Prisma.TransactionClient` aqui reabriria
 * por parâmetro a porta que o lint fechou por import — é a Parte 2a da catraca.
 */
async function travarEstruturaDoFunil(tx: TransacaoDaEmpresa, companyId: string) {
  return tx.$queryRaw<Array<{ id: string; ehGanho: boolean }>>`
    SELECT "id", "ehGanho" FROM "PipelineStage" WHERE "companyId" = ${companyId} ORDER BY "id" FOR UPDATE
  `;
}

/**
 * Remove uma etapa DA EMPRESA, movendo antes todos os leads dela para um
 * destino DA MESMA EMPRESA.
 *
 * Devolve quantos leads foram movidos.
 *
 * ## O segundo pior defeito do módulo morava aqui
 *
 * O `destinoId` chega da Server Action, e era conferido contra o funil GLOBAL
 * (a leitura travada trazia a tabela inteira). Um `destinoId` de outra empresa
 * passava na guarda, e o `updateMany` seguinte movia os leads da empresa A para
 * uma etapa da empresa B — os leads mudavam de funil sem mudar de `companyId`,
 * um estado que nenhuma tela mostra e que nenhuma consulta escopada devolve.
 * Hoje a leitura travada só traz as etapas da empresa, então um destino de fora
 * não está lá e a guarda recusa com o erro de domínio de sempre.
 *
 * ## Duas famílias de checagem, em dois lugares diferentes
 *
 * FORA da transação ficam as validações do PEDIDO — a etapa existe, tem leads,
 * veio destino. São leituras baratas que produzem a mensagem certa antes de
 * abrir transação nenhuma, e um resultado velho aqui só custa uma mensagem de
 * erro um pouco fora de hora.
 *
 * DENTRO, sobre a leitura travada, ficam as INVARIANTES — funil não fica vazio,
 * a etapa de fechamento não some, o destino ainda existe. Essas não podem ser
 * decididas com um valor lido antes: entre a leitura e a escrita cabe outra
 * transação inteira. Ver `travarEstruturaDoFunil`.
 *
 * A checagem de `ehGanho` aparece nas DUAS listas, e as duas são necessárias: a
 * de dentro é a que vale, a de fora existe só para a mensagem sair na ordem
 * certa. Ambas têm teste, e tirar qualquer uma das duas deixa a suíte vermelha.
 *
 * ## Por que a transação é INTERATIVA e não a de array
 *
 * Na forma `$transaction([...])` nenhuma operação pode depender do resultado de
 * outra — e o número de leads movidos só existe depois que o `updateMany` roda.
 * Auditar um número lido ANTES da transação seria auditar uma estimativa.
 *
 * ## Por que a linha de auditoria nasce DENTRO
 *
 * Esta é a única entrada forense da operação: não há uma entrada por lead, de
 * propósito — 40 linhas `mover_etapa` afogariam a que importa. E a etapa de
 * origem deixa de existir, então não há de onde reconstituir para onde os leads
 * foram. Ou a etapa some com o rastro, ou nada some. Mesmo raciocínio do
 * fail-closed da exportação de leads, registrado em `core/audit/log.ts`.
 *
 * A escrita da linha deixou de ser `gravarLinhaDeAuditoria(params, tx)` e passou
 * a ser `tx.auditLog.create({ data: dadosDeLinhaDeAuditoria(params, companyId) })`.
 * O motivo é de TIPO e está registrado no docstring do construtor em
 * `core/audit/log.ts`: o `tx` de uma transação aberta sobre o cliente escopado
 * NÃO é assignável a `Prisma.TransactionClient`. Duas consequências, e as duas
 * são melhorias:
 *
 * - o `create` sai do cliente ESCOPADO, então o `companyId` da linha é
 *   conferido pelo escopo em vez de confiado ao chamador;
 * - o `companyId` é o da ENTIDADE (`input.companyId`), e não o vínculo
 *   arbitrário que `companyIdDoUsuario` pegaria de quem tem dois. Isso NÃO
 *   conserta `core/audit/log.ts` — os outros caminhos dele continuam deduzindo
 *   a empresa do autor, e o arquivo segue na fila com o defeito MÉDIA dele.
 *
 * `avaliarAtividadeSuspeita` fica FORA: ela faz `count`, `findMany` de ADMINs e
 * `createMany` de notificações, e rodar isso segurando lock em linhas de `Lead`
 * alonga a transação por trabalho que não é do domínio dela. A falha dela é
 * engolida, como no funil normal — o registro já está gravado.
 */
export async function excluirEtapa(input: {
  etapaId: string;
  destinoId: string | null;
  autorId: string;
  companyId: string;
}): Promise<number> {
  const db = prismaDaEmpresa(input.companyId);

  const etapa = await etapaDaEmpresa(db, input.etapaId);
  if (!etapa) {
    throw new EtapaInvalidaError("Essa etapa não existe mais. Atualize a página.");
  }

  // Repetida de propósito, e a cópia autoritativa é a de dentro da transação.
  // Esta aqui existe pela ORDEM DA MENSAGEM: sem ela, tentar remover a etapa de
  // fechamento (que tem leads) responde "escolha para onde eles vão" — manda a
  // pessoa resolver um problema que não é o dela, para uma operação que vai ser
  // recusada de qualquer jeito. Um teste contra o banco real pegou exatamente
  // isso quando esta linha saiu.
  if (etapa.ehGanho) {
    throw new EtapaInvalidaError(
      "Esta é a etapa de fechamento. Marque outra etapa como fechamento antes de remover esta."
    );
  }

  // Contagem SEM filtro de `arquivadoEm`: é o número que o `ON DELETE RESTRICT`
  // enxerga. `contarLeadsPorEtapa` (`core/leads/queries.ts`) filtra arquivados e
  // faria uma etapa com 5 arquivados parecer vazia — o `delete` morreria na FK
  // e a etapa ficaria indeletável com um erro genérico.
  //
  // O `companyId` entra pelo escopo. Antes o filtro era só `stageId`, o que
  // segurava por FK (a etapa é da empresa, os leads dela também) — item BAIXA
  // da fila, e agora nem depende mais disso.
  const leadsQueSeguram = await db.lead.count({ where: { stageId: etapa.id } });

  if (leadsQueSeguram > 0) {
    if (!input.destinoId) {
      throw new EtapaInvalidaError(
        `Esta etapa ainda tem ${leadsQueSeguram} lead(s), incluindo arquivados. ` +
          "Escolha para onde eles vão."
      );
    }
    if (input.destinoId === etapa.id) {
      throw new EtapaInvalidaError("Escolha uma etapa de destino diferente desta.");
    }
  }

  // Etapa sem lead ignora o destino: não há o que mover, e a auditoria grava
  // `destinoId: null` — comportamento preservado da versão anterior.
  const destinoId = leadsQueSeguram > 0 ? input.destinoId : null;

  // O IP é resolvido AQUI, antes da transação, e não lá dentro.
  //
  // Esta é a única linha de auditoria do sistema que não passa por
  // `gravarLinhaDeAuditoria` — ela é escrita pelo `tx` escopado, pelo motivo de
  // TIPO registrado em `core/audit/log.ts`. Então o preenchimento automático de
  // `ip` (item 39 da auditoria de 2026-08-21) não a alcança, e ela é a exceção
  // que aquele docstring nomeia.
  //
  // Fora da transação porque `ipDaRequisicaoAtual()` é assíncrona, e esperá-la
  // com lock de linha em `Lead` na mão alongaria a transação por trabalho que
  // não é do domínio dela — a mesma razão pela qual `avaliarAtividadeSuspeita`
  // fica de fora.
  const ip = await ipDaRequisicaoAtual();

  const leadsMovidos = await db.$transaction(async (tx) => {
    const funil = await travarEstruturaDoFunil(tx, input.companyId);

    // A etapa pode ter sido apagada entre a leitura de cima e o lock.
    const aindaExiste = funil.find((linha) => linha.id === etapa.id);
    if (!aindaExiste) {
      throw new EtapaInvalidaError("Essa etapa não existe mais. Atualize a página.");
    }

    // Sobre a leitura TRAVADA, não sobre `etapa`: alguém pode ter marcado esta
    // etapa como a de fechamento no intervalo, e apagá-la deixaria o funil sem
    // nenhuma — a taxa de conversão do painel passaria a mentir em silêncio.
    if (aindaExiste.ehGanho) {
      throw new EtapaInvalidaError(
        "Esta é a etapa de fechamento. Marque outra etapa como fechamento antes de remover esta."
      );
    }

    if (funil.length <= 1) {
      throw new EtapaInvalidaError("O funil precisa de pelo menos uma etapa.");
    }

    // Destino conferido contra a leitura travada, e não com um `findUnique`
    // solto: sem isto, um destino apagado no intervalo faria o `updateMany`
    // gravar uma FK morta, e a transação cairia com P2003 — mensagem genérica
    // para uma condição que tem nome. E, desde a conversão, é também o que
    // recusa destino de OUTRA empresa: a leitura travada é escopada.
    if (destinoId && !funil.some((linha) => linha.id === destinoId)) {
      throw new EtapaInvalidaError("Escolha uma etapa de destino diferente desta.");
    }

    let movidos = 0;
    if (destinoId) {
      // Sem filtro de `arquivadoEm`, e correto assim: a etapa vai deixar de
      // existir, então quem segura a chave estrangeira tem que sair junto.
      //
      // NÃO toca `ultimaInteracaoEm`: mudar a estrutura do funil não é interação
      // com o lead, e marcar 40 leads como interagidos hoje corromperia a única
      // coluna que diz o contrário.
      const resultado = await tx.lead.updateMany({
        where: { stageId: etapa.id },
        data: { stageId: destinoId },
      });
      movidos = resultado.count;
    }

    // `deleteMany` e não `delete`: o escopo recusa `delete` em modelo de
    // tenant. O `where` composto (`id` + `companyId`) é o mesmo que a leitura
    // travada acabou de validar.
    await tx.pipelineStage.deleteMany({ where: { id: etapa.id } });

    await tx.auditLog.create({
      data: dadosDeLinhaDeAuditoria(
        {
          companyId: input.companyId,
          userId: input.autorId,
          acao: "excluir_etapa",
          entidade: "PipelineStage",
          entidadeId: etapa.id,
          antes: { nome: etapa.nome, ordem: etapa.ordem, cor: etapa.cor },
          // O `count` da própria escrita, nunca uma leitura anterior.
          depois: { destinoId: destinoId ?? null, leadsMovidos: movidos },
          ip,
        }
      ),
    });

    return movidos;
  });

  try {
    await avaliarAtividadeSuspeita({
      companyId: input.companyId,
      userId: input.autorId,
      acao: "excluir_etapa",
    });
  } catch (erro) {
    console.error("Falha ao avaliar atividade suspeita (auditoria já gravada):", erro);
  }

  return leadsMovidos;
}
