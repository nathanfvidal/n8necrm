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
  moverNaOrdem,
  excluirEtapa,
  EtapaInvalidaError,
} from "../../src/core/pipeline/service";
import { usuarioDoSeed } from "./helpers/usuarios-do-seed";

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

/**
 * Quem age, e em qual empresa.
 *
 * O `companyId` entrou aqui na conversão de `pipeline` (Ciclo 1a): as cinco
 * funções de `service.ts` passaram a exigi-lo. Ele sai do `Membership`, e não
 * de `prisma.company.findFirst()` — é o VÍNCULO que define "pessoa desta
 * empresa" (`prisma/schema.prisma`, linha 50), e a origem em produção é
 * `usuarioAtual().companyId`, que resolve o mesmo vínculo.
 *
 * Este arquivo continua sendo sobre o COMPORTAMENTO do funil de uma empresa
 * (ordem, nome repetido, auditoria, transação contra o Postgres real). Quem
 * prova o isolamento entre duas empresas é `tests/unit/pipeline-isolamento.test.ts`.
 */
async function contextoDoAdmin() {
  // Uma consulta onde eram duas, e o `ativo: true` que faltava: o formato
  // antigo (`User.papel`, sem filtro de ativo) podia devolver o "Atendente
  // WhatsApp (sistema)", que é ADMIN e `ativo: false`. Ver o helper.
  const admin = await usuarioDoSeed("ADMIN");
  return { admin, companyId: admin.companyId };
}

async function novaEtapa(sufixo: string) {
  const { admin, companyId } = await contextoDoAdmin();
  // Maiúscula de propósito: é a única forma de "nasce ... com a cor
  // normalizada" (abaixo) provar alguma coisa. "#123456" já é minúscula em
  // todo caractere — passaria no teste mesmo se `etapaSchema.cor` parasse de
  // chamar `toLowerCase()`.
  const etapa = await criarEtapa({
    nome: `${PREFIXO} ${sufixo}`,
    cor: "#12AB56",
    autorId: admin.id,
    companyId,
  });
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
    const { companyId } = await contextoDoAdmin();
    // `where: { companyId }` acrescentado na conversão: `criarEtapa` passou a
    // usar o `max(ordem)` DA EMPRESA, e o `_max` global mediria outra coisa.
    const antes = await prisma.pipelineStage.aggregate({
      where: { companyId },
      _max: { ordem: true },
    });
    const etapa = await novaEtapa("nasce no fim");

    expect(etapa.ordem).toBe((antes._max.ordem ?? -1) + 1);
    expect(etapa.ehGanho).toBe(false);
    expect(etapa.ehPerdido).toBe(false);
    expect(etapa.cor).toBe("#12ab56");
  });

  it("recusa nome repetido, sem diferenciar maiúscula", async () => {
    const etapa = await novaEtapa("repetido");
    const { admin, companyId } = await contextoDoAdmin();

    await expect(
      criarEtapa({ nome: etapa.nome.toUpperCase(), cor: "#654321", autorId: admin.id, companyId })
    ).rejects.toBeInstanceOf(EtapaInvalidaError);
  });

  it("recusa cor fora do formato com erro de domínio, não erro do Prisma", async () => {
    const { admin, companyId } = await contextoDoAdmin();
    await expect(
      criarEtapa({ nome: `${PREFIXO} cor ruim`, cor: "red; background: url(x)", autorId: admin.id, companyId })
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
    const { admin, companyId } = await contextoDoAdmin();

    const depois = await editarEtapa({
      etapaId: etapa.id,
      nome: `${PREFIXO} editada`,
      cor: "#ABCDEF",
      autorId: admin.id,
      companyId,
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
    const { admin, companyId } = await contextoDoAdmin();

    await expect(
      editarEtapa({ etapaId: segunda.id, nome: primeira.nome, cor: "#123456", autorId: admin.id, companyId })
    ).rejects.toBeInstanceOf(EtapaInvalidaError);
  });

  it("permite salvar a própria etapa sem mudar o nome (não colide consigo mesma)", async () => {
    const etapa = await novaEtapa("mesmo nome");
    const { admin, companyId } = await contextoDoAdmin();

    const depois = await editarEtapa({
      etapaId: etapa.id,
      nome: etapa.nome,
      cor: "#000000",
      autorId: admin.id,
      companyId,
    });
    expect(depois.cor).toBe("#000000");
  });
});

describe("moverNaOrdem — contra o banco real", () => {
  // As DUAS etapas são criadas pelo teste, e nascem no fim do funil. A troca
  // escreve só linhas que este teste criou: nenhuma etapa semeada é tocada, e a
  // adjacência das cinco de produção fica intacta durante a execução inteira.
  it("troca duas etapas de posição sem violar UNIQUE(ordem)", async () => {
    const primeira = await novaEtapa("troca A");
    const segunda = await novaEtapa("troca B");
    const { admin, companyId } = await contextoDoAdmin();

    await moverNaOrdem({ etapaId: segunda.id, direcao: "cima", autorId: admin.id, companyId });

    const depoisPrimeira = await prisma.pipelineStage.findUniqueOrThrow({ where: { id: primeira.id } });
    const depoisSegunda = await prisma.pipelineStage.findUniqueOrThrow({ where: { id: segunda.id } });

    expect(depoisSegunda.ordem).toBe(primeira.ordem);
    expect(depoisPrimeira.ordem).toBe(segunda.ordem);
  });

  it("nenhuma etapa fica na posição de estacionamento depois da troca", async () => {
    const estacionadas = await prisma.pipelineStage.count({ where: { ordem: { lt: 0 } } });
    expect(estacionadas).toBe(0);
  });
});

describe("excluirEtapa", () => {
  it("etapa vazia sai sem destino", async () => {
    const etapa = await novaEtapa("vazia");
    const { admin, companyId } = await contextoDoAdmin();

    const movidos = await excluirEtapa({ etapaId: etapa.id, destinoId: null, autorId: admin.id, companyId });

    expect(movidos).toBe(0);
    expect(await prisma.pipelineStage.findUnique({ where: { id: etapa.id } })).toBeNull();
  });

  // O caso que nenhum outro teste alcança, e o motivo de `contarLeadsQueSeguramEtapa`
  // existir: arquivar NÃO tira o lead da etapa, e a FK é ON DELETE RESTRICT.
  it("etapa com lead ARQUIVADO recusa sem destino — com erro de domínio, não P2003", async () => {
    const etapa = await novaEtapa("so arquivado");
    const { admin, companyId } = await contextoDoAdmin();
    const contato = await prisma.contact.create({
      data: {
        companyId: etapa.companyId,
        nome: "Contato Teste Arquivado",
        telefone: `5511${Date.now()}`.slice(0, 13),
      },
    });
    const lead = await prisma.lead.create({
      data: {
        companyId: etapa.companyId,
        contactId: contato.id,
        stageId: etapa.id,
        canal: "MANUAL",
        arquivadoEm: new Date(),
      },
    });

    try {
      await expect(
        excluirEtapa({ etapaId: etapa.id, destinoId: null, autorId: admin.id, companyId })
      ).rejects.toBeInstanceOf(EtapaInvalidaError);
      // E a etapa continua lá — a recusa aconteceu ANTES de qualquer escrita.
      expect(await prisma.pipelineStage.findUnique({ where: { id: etapa.id } })).not.toBeNull();
    } finally {
      await prisma.lead.delete({ where: { id: lead.id } });
      await prisma.contact.delete({ where: { id: contato.id } });
    }
  });

  it("com destino, move o arquivado junto e apaga a etapa", async () => {
    const origem = await novaEtapa("origem");
    const destino = await novaEtapa("destino");
    const { admin, companyId } = await contextoDoAdmin();
    const contato = await prisma.contact.create({
      data: {
        companyId: origem.companyId,
        nome: "Contato Teste Movido",
        telefone: `5511${Date.now()}`.slice(0, 13),
      },
    });
    const lead = await prisma.lead.create({
      data: {
        companyId: origem.companyId,
        contactId: contato.id,
        stageId: origem.id,
        canal: "MANUAL",
        arquivadoEm: new Date(),
      },
    });

    try {
      const movidos = await excluirEtapa({
        etapaId: origem.id,
        destinoId: destino.id,
        autorId: admin.id,
        companyId,
      });

      expect(movidos).toBe(1);
      const depois = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(depois.stageId).toBe(destino.id);
      // Mudar a estrutura do funil não é interação com o lead.
      expect(depois.arquivadoEm).not.toBeNull();
      expect(await prisma.pipelineStage.findUnique({ where: { id: origem.id } })).toBeNull();
    } finally {
      await prisma.lead.delete({ where: { id: lead.id } });
      await prisma.contact.delete({ where: { id: contato.id } });
    }
  });

  it("a auditoria registra o número REAL de leads movidos, e nasce junto com a exclusão", async () => {
    const origem = await novaEtapa("auditoria origem");
    const destino = await novaEtapa("auditoria destino");
    const { admin, companyId } = await contextoDoAdmin();
    const contato = await prisma.contact.create({
      data: {
        companyId: origem.companyId,
        nome: "Contato Teste Auditoria",
        telefone: `5511${Date.now()}`.slice(0, 13),
      },
    });
    const lead = await prisma.lead.create({
      data: {
        companyId: origem.companyId,
        contactId: contato.id,
        stageId: origem.id,
        canal: "MANUAL",
        arquivadoEm: new Date(),
      },
    });

    try {
      await excluirEtapa({ etapaId: origem.id, destinoId: destino.id, autorId: admin.id, companyId });

      const linha = await prisma.auditLog.findFirstOrThrow({
        where: { entidadeId: origem.id, acao: "excluir_etapa" },
      });
      expect((linha.depois as { leadsMovidos: number }).leadsMovidos).toBe(1);
      expect((linha.depois as { destinoId: string }).destinoId).toBe(destino.id);
    } finally {
      await prisma.lead.delete({ where: { id: lead.id } });
      await prisma.contact.delete({ where: { id: contato.id } });
    }
  });

  it("recusa apagar a etapa de fechamento", async () => {
    const { admin, companyId } = await contextoDoAdmin();
    const fechamento = await prisma.pipelineStage.findFirstOrThrow({
      where: { ehGanho: true, companyId },
    });

    await expect(
      excluirEtapa({ etapaId: fechamento.id, destinoId: null, autorId: admin.id, companyId })
    ).rejects.toThrow(/fechamento/i);
    // Não escreveu nada: a etapa de produção continua lá, com a flag intacta.
    const depois = await prisma.pipelineStage.findUniqueOrThrow({ where: { id: fechamento.id } });
    expect(depois.ehGanho).toBe(true);
  });
});
