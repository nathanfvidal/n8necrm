// Este arquivo usa o Prisma real contra o Postgres do Supabase — mesma
// disciplina de seed.test.ts e audit-log.test.ts. Carrega DATABASE_URL aqui,
// não em vitest.config.ts, para não injetar credencial em teste que não toca
// banco. Precisa ser o primeiro import.
import "dotenv/config";

import { describe, it, expect, vi, afterAll } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import {
  criarEtapa,
  editarEtapa,
  EtapaInvalidaError,
} from "../../src/core/pipeline/service";

/**
 * TODA etapa criada aqui nasce com prefixo próprio e é apagada no fim. O banco é
 * o mesmo de produção: um teste que falha no meio sem limpar deixa lixo numa
 * base real, e uma etapa órfã aparece no kanban de quem estiver trabalhando.
 *
 * Curto de propósito: `LIMITE_NOME_ETAPA` (`core/pipeline/schema.ts`) é 40, e
 * `nome` aqui é PREFIXO + sufixo do caso de teste — "Servico" no prefixo
 * original estourava esse teto assim que somado ao sufixo mais longo
 * ("vai tentar colidir"). "ZZ Teste" sozinho já é o que a consulta de
 * verificação do Passo 5 usa (`LIKE 'ZZ Teste%'`).
 */
const PREFIXO = `ZZ Teste ${Date.now()}`;
const criadas: string[] = [];

async function novaEtapa(sufixo: string) {
  const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN" } });
  const etapa = await criarEtapa({ nome: `${PREFIXO} ${sufixo}`, cor: "#123456", autorId: admin.id });
  criadas.push(etapa.id);
  return etapa;
}

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { entidadeId: { in: criadas } } });
  await prisma.pipelineStage.deleteMany({ where: { id: { in: criadas } } });
  await prisma.$disconnect();
}, 60_000);

describe("criarEtapa", () => {
  it("nasce no fim do funil, sem ehGanho, com a cor normalizada", async () => {
    const antes = await prisma.pipelineStage.aggregate({ _max: { ordem: true } });
    const etapa = await novaEtapa("nasce no fim");

    expect(etapa.ordem).toBe((antes._max.ordem ?? -1) + 1);
    expect(etapa.ehGanho).toBe(false);
    expect(etapa.ehPerdido).toBe(false);
    expect(etapa.cor).toBe("#123456");
  });

  it("recusa nome repetido, sem diferenciar maiúscula", async () => {
    const etapa = await novaEtapa("repetido");
    const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN" } });

    await expect(
      criarEtapa({ nome: etapa.nome.toUpperCase(), cor: "#654321", autorId: admin.id })
    ).rejects.toBeInstanceOf(EtapaInvalidaError);
  });

  it("recusa cor fora do formato com erro de domínio, não erro do Prisma", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN" } });
    await expect(
      criarEtapa({ nome: `${PREFIXO} cor ruim`, cor: "red; background: url(x)", autorId: admin.id })
    ).rejects.toBeInstanceOf(EtapaInvalidaError);
  });

  it("grava auditoria de criar_etapa", async () => {
    const etapa = await novaEtapa("auditoria");
    const linhas = await prisma.auditLog.findMany({ where: { entidadeId: etapa.id } });

    expect(linhas).toHaveLength(1);
    expect(linhas[0].acao).toBe("criar_etapa");
    expect(linhas[0].entidade).toBe("PipelineStage");
  });
});

describe("editarEtapa", () => {
  it("troca nome e cor sem mexer em ordem nem em ehGanho", async () => {
    const etapa = await novaEtapa("editar");
    const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN" } });

    const depois = await editarEtapa({
      etapaId: etapa.id,
      nome: `${PREFIXO} editada`,
      cor: "#ABCDEF",
      autorId: admin.id,
    });

    expect(depois.nome).toBe(`${PREFIXO} editada`);
    expect(depois.cor).toBe("#abcdef");
    expect(depois.ordem).toBe(etapa.ordem);
    expect(depois.ehGanho).toBe(etapa.ehGanho);
  });

  // O caminho mais provável do nome duplicado é este, não a criação: quem já
  // tem "Proposta" e "Proposta enviada" renomeia uma delas.
  it("recusa RENOMEAR para um nome que já existe", async () => {
    const primeira = await novaEtapa("alvo do conflito");
    const segunda = await novaEtapa("vai colidir");
    const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN" } });

    await expect(
      editarEtapa({ etapaId: segunda.id, nome: primeira.nome, cor: "#123456", autorId: admin.id })
    ).rejects.toBeInstanceOf(EtapaInvalidaError);
  });

  it("permite salvar a própria etapa sem mudar o nome (não colide consigo mesma)", async () => {
    const etapa = await novaEtapa("mesmo nome");
    const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN" } });

    const depois = await editarEtapa({
      etapaId: etapa.id,
      nome: etapa.nome,
      cor: "#000000",
      autorId: admin.id,
    });
    expect(depois.cor).toBe("#000000");
  });
});
