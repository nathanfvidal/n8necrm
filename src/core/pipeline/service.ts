import "server-only";

import { prisma } from "@/lib/prisma";
import { registrarAuditoria } from "@/core/audit/log";
import { etapaSchema } from "./schema";
import type { PipelineStage } from "@prisma/client";

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
