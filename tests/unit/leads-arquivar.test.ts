import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  lead: { findUniqueOrThrow: vi.fn(), update: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
  pipelineStage: { findMany: vi.fn() },
}));
const auditoriaMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/core/audit/log", () => ({ registrarAuditoria: auditoriaMock }));
vi.mock("@/core/notifications/dispatch", () => ({ notificarNovoLead: vi.fn() }));

import { arquivarLead, desarquivarLead } from "../../src/core/leads/service";
import {
  listarLeads,
  listarLeadsPorEtapa,
  contarLeadsPorEtapa,
} from "../../src/core/leads/queries";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.lead.findUniqueOrThrow.mockResolvedValue({ id: "lead-1", arquivadoEm: null });
  prismaMock.lead.update.mockImplementation(({ data }) => ({ id: "lead-1", ...data }));
  prismaMock.lead.findMany.mockResolvedValue([]);
  prismaMock.lead.groupBy.mockResolvedValue([]);
  prismaMock.pipelineStage.findMany.mockResolvedValue([]);
});

describe("arquivarLead", () => {
  it("grava a data e audita", async () => {
    await arquivarLead({ leadId: "lead-1", autorId: "user-1" });

    expect(prismaMock.lead.update.mock.calls[0][0].data.arquivadoEm).toBeInstanceOf(Date);
    expect(auditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({ acao: "arquivar_lead", entidadeId: "lead-1", userId: "user-1" })
    );
  });

  it("desarquivar limpa a data", async () => {
    prismaMock.lead.findUniqueOrThrow.mockResolvedValue({
      id: "lead-1",
      arquivadoEm: new Date(),
    });

    await desarquivarLead({ leadId: "lead-1", autorId: "user-1" });

    expect(prismaMock.lead.update.mock.calls[0][0].data.arquivadoEm).toBeNull();
    expect(auditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({ acao: "desarquivar_lead" })
    );
  });

  it("recusa arquivar duas vezes", async () => {
    prismaMock.lead.findUniqueOrThrow.mockResolvedValue({
      id: "lead-1",
      arquivadoEm: new Date(),
    });

    await expect(arquivarLead({ leadId: "lead-1", autorId: "user-1" })).rejects.toThrow(
      /já está arquivado/
    );
  });
});

/**
 * O teste que mais importa desta entrega. Arquivar só funciona se TODA
 * listagem filtrar — a armadilha "regra numa tela, esquecida na outra".
 */
describe("todo caminho de listagem exclui arquivados", () => {
  it("listarLeads filtra por padrao", async () => {
    await listarLeads();
    expect(prismaMock.lead.findMany.mock.calls[0][0].where).toMatchObject({
      arquivadoEm: null,
    });
  });

  it("listarLeads pode incluir arquivados quando pedido explicitamente", async () => {
    await listarLeads({ incluirArquivados: true });
    expect(prismaMock.lead.findMany.mock.calls[0][0].where?.arquivadoEm).toBeUndefined();
  });

  it("listarLeadsPorEtapa (kanban) filtra", async () => {
    await listarLeadsPorEtapa();
    expect(prismaMock.lead.findMany.mock.calls[0][0].where).toMatchObject({
      arquivadoEm: null,
    });
  });

  // Caminho novo, e o mais fácil de esquecer: não devolve linha nenhuma, só
  // número. Um arquivado contado aqui não aparece em lista alguma para
  // denunciar o erro — ele só engorda o total do painel e afunda a taxa de
  // conversão, que é o número que alguém olha para decidir alguma coisa.
  it("contarLeadsPorEtapa (painel) filtra", async () => {
    await contarLeadsPorEtapa();
    expect(prismaMock.lead.groupBy.mock.calls[0][0].where).toMatchObject({
      arquivadoEm: null,
    });
  });
});
