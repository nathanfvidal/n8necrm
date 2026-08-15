import "server-only";

import { prisma } from "@/lib/prisma";
import { gravarLinhaDeAuditoria, registrarAuditoria } from "@/core/audit/log";
import { avaliarAtividadeSuspeita } from "@/core/audit/alerta";
import { etapaSchema } from "./schema";
import type { PipelineStage, Prisma } from "@prisma/client";

export class EtapaInvalidaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "EtapaInvalidaError";
  }
}

/** `safeParse` → erro de domínio. Sem isto a falha cairia no ramo genérico da action. */
function validar(entrada: { nome: string; cor: string }) {
  const analisado = etapaSchema.safeParse(entrada);
  if (!analisado.success) {
    throw new EtapaInvalidaError(analisado.error.issues[0].message);
  }
  return analisado.data;
}

/**
 * Recusa nome repetido, ignorando diferença de maiúscula.
 *
 * A checagem é aqui e não no banco: um índice único case-insensitive em Postgres
 * é funcional (`LOWER(nome)`), o Prisma não o representa, e ele viraria drift no
 * próximo diff — o mesmo motivo pelo qual a branch de contato recusou o índice
 * `pg_trgm` (ver `prisma/schema.prisma`).
 *
 * **Isto NÃO é atômico**, e o comentário existe para ninguém acreditar que é.
 * Dois ADMINs criando o mesmo nome no mesmo instante conseguem. Com a permissão
 * restrita a ADMIN a janela é quase inalcançável, e o pior desfecho — duas
 * colunas com o mesmo nome — se conserta renomeando uma. Aceito, não resolvido.
 */
async function recusarNomeRepetido(nome: string, ignorarId: string | null): Promise<void> {
  const existente = await prisma.pipelineStage.findFirst({
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

export async function criarEtapa(input: {
  nome: string;
  cor: string;
  autorId: string;
}): Promise<PipelineStage> {
  const campos = validar(input);
  await recusarNomeRepetido(campos.nome, null);

  // Etapa nova entra no FIM. `ordem` pode ter buracos (apagar a de ordem 2
  // deixa 0,1,3,4) e isso é correto — por isso `max + 1`, e não `count()`.
  const maior = await prisma.pipelineStage.aggregate({ _max: { ordem: true } });

  const etapa = await prisma.pipelineStage.create({
    data: {
      nome: campos.nome,
      cor: campos.cor,
      ordem: (maior._max.ordem ?? -1) + 1,
      ehGanho: false,
      ehPerdido: false,
    },
  });

  await registrarAuditoria({
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
}): Promise<PipelineStage> {
  const campos = validar(input);

  const atual = await prisma.pipelineStage.findUnique({ where: { id: input.etapaId } });
  if (!atual) {
    throw new EtapaInvalidaError("Essa etapa não existe mais. Atualize a página.");
  }

  await recusarNomeRepetido(campos.nome, atual.id);

  const depois = await prisma.pipelineStage.update({
    where: { id: atual.id },
    data: { nome: campos.nome, cor: campos.cor },
  });

  await registrarAuditoria({
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
 * `PipelineStage_ordem_key` é um índice ÚNICO, e o Postgres o verifica a cada
 * `UPDATE` — não no fim da transação. Trocar as etapas de ordem 0 e 1 com dois
 * `UPDATE`s diretos falha no primeiro, porque por um instante duas linhas
 * teriam a mesma `ordem`.
 *
 * Negativo de propósito: nenhuma etapa real ocupa posição negativa, então o
 * valor nunca colide com uma linha legítima. Ele existe por microssegundos
 * dentro de uma transação atômica — nenhuma leitura o vê.
 *
 * A alternativa idiomática seria uma constraint `DEFERRABLE INITIALLY DEFERRED`,
 * que o Prisma não representa e que viraria drift no próximo diff. Ver § 5 da
 * spec.
 */
export const ORDEM_ESTACIONAMENTO = -1;

export async function moverNaOrdem(input: {
  etapaId: string;
  direcao: "cima" | "baixo";
  autorId: string;
}): Promise<void> {
  const etapa = await prisma.pipelineStage.findUnique({ where: { id: input.etapaId } });
  if (!etapa) {
    throw new EtapaInvalidaError("Essa etapa não existe mais. Atualize a página.");
  }

  // A vizinha é achada por COMPARAÇÃO, não por `ordem ± 1`: buracos em `ordem`
  // são legais e esperados (apagar a etapa de ordem 2 deixa 0,1,3,4).
  const subindo = input.direcao === "cima";
  const vizinha = await prisma.pipelineStage.findFirst({
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

  await prisma.$transaction(async (tx) => {
    await tx.pipelineStage.update({
      where: { id: etapa.id },
      data: { ordem: ORDEM_ESTACIONAMENTO },
    });
    await tx.pipelineStage.update({
      where: { id: vizinha.id },
      data: { ordem: etapa.ordem },
    });
    await tx.pipelineStage.update({
      where: { id: etapa.id },
      data: { ordem: vizinha.ordem },
    });
  });

  await registrarAuditoria({
    userId: input.autorId,
    acao: "reordenar_etapa",
    entidade: "PipelineStage",
    entidadeId: etapa.id,
    antes: { nome: etapa.nome, ordem: etapa.ordem },
    depois: { nome: etapa.nome, ordem: vizinha.ordem },
  });
}

/**
 * Marca UMA etapa como a de fechamento, desligando a anterior no mesmo commit.
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
 */
export async function definirEtapaDeFechamento(input: {
  etapaId: string;
  autorId: string;
}): Promise<void> {
  const etapa = await prisma.pipelineStage.findUnique({ where: { id: input.etapaId } });
  if (!etapa) {
    throw new EtapaInvalidaError("Essa etapa não existe mais. Atualize a página.");
  }

  // Lida ANTES da transação: é o único jeito de saber qual etapa PERDEU a
  // flag. Depois da transação ela já está desligada em todo mundo, e não
  // sobra de onde reconstituir quem era. Sem isto a auditoria grava só quem
  // ganhou a flag — contraria o mesmo princípio de `excluirEtapa` logo abaixo
  // ("ou a etapa some com o rastro, ou nada some"): aqui nada some, mas a
  // troca ficaria só meio registrada.
  const etapaAnterior = await prisma.pipelineStage.findFirst({ where: { ehGanho: true } });

  await prisma.$transaction(async (tx) => {
    await tx.pipelineStage.updateMany({ where: { ehGanho: true }, data: { ehGanho: false } });
    await tx.pipelineStage.update({ where: { id: etapa.id }, data: { ehGanho: true } });
  });

  await registrarAuditoria({
    userId: input.autorId,
    acao: "definir_etapa_de_fechamento",
    entidade: "PipelineStage",
    entidadeId: etapa.id,
    antes: etapaAnterior ? { nome: etapaAnterior.nome } : undefined,
    depois: { nome: etapa.nome },
  });
}

/**
 * Trava a estrutura do funil pelo resto da transação e devolve o que ela é
 * NESTE instante.
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
 * ## Detalhes que não são estilo
 *
 * - `ORDER BY "id"`: ordem determinística de aquisição. Sem ela, duas
 *   transações pegando as mesmas linhas em ordens diferentes podem travar uma
 *   na outra.
 * - Zero interpolação — a consulta é constante, sem nada vindo de fora.
 * - Só `id` e `ehGanho`: é tudo que as guardas precisam, e a trava vale para a
 *   linha inteira de qualquer jeito.
 */
async function travarEstruturaDoFunil(tx: Prisma.TransactionClient) {
  return tx.$queryRaw<Array<{ id: string; ehGanho: boolean }>>`
    SELECT "id", "ehGanho" FROM "PipelineStage" ORDER BY "id" FOR UPDATE
  `;
}

/**
 * Remove uma etapa, movendo antes todos os leads dela para um destino.
 *
 * Devolve quantos leads foram movidos.
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
 * `avaliarAtividadeSuspeita` fica FORA: ela faz `count`, `findMany` de ADMINs e
 * `createMany` de notificações, e rodar isso segurando lock em linhas de `Lead`
 * alonga a transação por trabalho que não é do domínio dela. A falha dela é
 * engolida, como no funil normal — o registro já está gravado.
 */
export async function excluirEtapa(input: {
  etapaId: string;
  destinoId: string | null;
  autorId: string;
}): Promise<number> {
  const etapa = await prisma.pipelineStage.findUnique({ where: { id: input.etapaId } });
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
  const leadsQueSeguram = await prisma.lead.count({ where: { stageId: etapa.id } });

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

  const leadsMovidos = await prisma.$transaction(async (tx) => {
    const funil = await travarEstruturaDoFunil(tx);

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
    // para uma condição que tem nome.
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

    await tx.pipelineStage.delete({ where: { id: etapa.id } });

    await gravarLinhaDeAuditoria(
      {
        userId: input.autorId,
        acao: "excluir_etapa",
        entidade: "PipelineStage",
        entidadeId: etapa.id,
        antes: { nome: etapa.nome, ordem: etapa.ordem, cor: etapa.cor },
        // O `count` da própria escrita, nunca uma leitura anterior.
        depois: { destinoId: destinoId ?? null, leadsMovidos: movidos },
      },
      tx
    );

    return movidos;
  });

  try {
    await avaliarAtividadeSuspeita({ userId: input.autorId, acao: "excluir_etapa" });
  } catch (erro) {
    console.error("Falha ao avaliar atividade suspeita (auditoria já gravada):", erro);
  }

  return leadsMovidos;
}
