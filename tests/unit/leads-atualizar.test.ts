import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  lead: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn() },
  pipelineStage: { findUnique: vi.fn() },
}));
const auditoriaMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/core/audit/log", () => ({ registrarAuditoria: auditoriaMock }));
vi.mock("@/core/notifications/dispatch", () => ({ notificarNovoLead: vi.fn() }));

import { atualizarLead } from "../../src/core/leads/service";

const LEAD_ANTES = {
  id: "lead-1",
  valorEstimado: null,
  responsavelId: "user-1",
  stageId: "etapa-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.lead.findUniqueOrThrow.mockResolvedValue(LEAD_ANTES);
  prismaMock.user.findUnique.mockResolvedValue({ id: "user-2" });
  prismaMock.pipelineStage.findUnique.mockResolvedValue({ id: "etapa-2" });
  prismaMock.lead.update.mockImplementation(({ data }) => ({ ...LEAD_ANTES, ...data }));
});

describe("atualizarLead", () => {
  it("converte o valor em texto para Decimal", async () => {
    await atualizarLead({
      leadId: "lead-1",
      valorEstimado: "1.500,50",
      responsavelId: "user-1",
      stageId: "etapa-1",
      autorId: "user-1",
    });

    const dados = prismaMock.lead.update.mock.calls[0][0].data;
    expect(dados.valorEstimado.toString()).toBe("1500.5");
  });

  it("recusa valor mal formado antes de tocar o banco", async () => {
    await expect(
      atualizarLead({
        leadId: "lead-1",
        valorEstimado: "1.5",
        responsavelId: "user-1",
        stageId: "etapa-1",
        autorId: "user-1",
      })
    ).rejects.toThrow(/Valor inválido/);

    expect(prismaMock.lead.update).not.toHaveBeenCalled();
  });

  it("aceita null para limpar o valor", async () => {
    await atualizarLead({
      leadId: "lead-1",
      valorEstimado: null,
      responsavelId: "user-1",
      stageId: "etapa-1",
      autorId: "user-1",
    });

    expect(prismaMock.lead.update.mock.calls[0][0].data.valorEstimado).toBeNull();
  });

  it("recusa responsavel inexistente com erro de dominio, nao violacao de FK", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expect(
      atualizarLead({
        leadId: "lead-1",
        valorEstimado: null,
        responsavelId: "fantasma",
        stageId: "etapa-1",
        autorId: "user-1",
      })
    ).rejects.toThrow(/Responsável não encontrado/);
    expect(prismaMock.lead.update).not.toHaveBeenCalled();
  });

  it("recusa etapa inexistente", async () => {
    prismaMock.pipelineStage.findUnique.mockResolvedValue(null);

    await expect(
      atualizarLead({
        leadId: "lead-1",
        valorEstimado: null,
        responsavelId: "user-1",
        stageId: "fantasma",
        autorId: "user-1",
      })
    ).rejects.toThrow(/Etapa não encontrada/);
  });

  it("atualiza ultimaInteracaoEm quando a etapa muda", async () => {
    await atualizarLead({
      leadId: "lead-1",
      valorEstimado: null,
      responsavelId: "user-1",
      stageId: "etapa-2",
      autorId: "user-1",
    });

    expect(prismaMock.lead.update.mock.calls[0][0].data.ultimaInteracaoEm).toBeInstanceOf(Date);
  });

  it("NAO mexe em ultimaInteracaoEm quando a etapa nao muda", async () => {
    await atualizarLead({
      leadId: "lead-1",
      valorEstimado: "100",
      responsavelId: "user-1",
      stageId: "etapa-1",
      autorId: "user-1",
    });

    expect(prismaMock.lead.update.mock.calls[0][0].data.ultimaInteracaoEm).toBeUndefined();
  });

  it("audita apenas os campos que mudaram", async () => {
    await atualizarLead({
      leadId: "lead-1",
      valorEstimado: null,
      responsavelId: "user-2",
      stageId: "etapa-1",
      autorId: "user-9",
    });

    expect(auditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-9",
        acao: "atualizar_lead",
        entidade: "Lead",
        entidadeId: "lead-1",
        antes: { responsavelId: "user-1" },
        depois: { responsavelId: "user-2" },
      })
    );
  });

  it("nao grava auditoria quando nada mudou", async () => {
    await atualizarLead({
      leadId: "lead-1",
      valorEstimado: null,
      responsavelId: "user-1",
      stageId: "etapa-1",
      autorId: "user-1",
    });

    expect(auditoriaMock).not.toHaveBeenCalled();
  });
});
