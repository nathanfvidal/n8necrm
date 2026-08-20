import { describe, it, expect, vi, beforeEach } from "vitest";

const EMPRESA = "empresa-do-teste";

// O banco falso é o CLIENTE ESCOPADO, não o `prisma` cru — `service.ts` e
// `queries.ts` deixaram de importar `@/lib/prisma` no Ciclo 1a (Task 4).
//
// `findFirstOrThrow` e `updateManyAndReturn` no lugar de `findUniqueOrThrow` e
// `update`: o escopo RECUSA as duas antigas em modelo de tenant, porque o
// `where` delas só aceita campo único e `companyId` não é único em `Lead` (ver
// "Recusa, lançando" em `core/tenancy/escopo.ts`). `updateManyAndReturn`
// devolve LISTA, daí o `[{...}]` abaixo.
const prismaMock = vi.hoisted(() => ({
  lead: {
    findFirstOrThrow: vi.fn(),
    updateManyAndReturn: vi.fn(),
    findMany: vi.fn(),
    groupBy: vi.fn(),
  },
  pipelineStage: { findMany: vi.fn() },
}));
const auditoriaMock = vi.hoisted(() => vi.fn());
const escopoMock = vi.hoisted(() => vi.fn());

// Este arquivo MOCKA O ESCOPO: `prismaDaEmpresa` devolve o banco falso direto,
// sem a extensão do Prisma no caminho, então nada aqui prova que `companyId`
// chega à consulta — isso é `tests/unit/lead-isolamento.test.ts`, contra duas
// empresas de verdade. O que este arquivo prova é a regra que ele sempre
// provou: TODA listagem filtra arquivado.
vi.mock("@/core/tenancy/escopo", () => ({ prismaDaEmpresa: escopoMock }));
vi.mock("@/core/users/empresa", () => ({
  companyIdDoUsuario: vi.fn(async () => EMPRESA),
}));
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
  escopoMock.mockReturnValue(prismaMock);
  prismaMock.lead.findFirstOrThrow.mockResolvedValue({ id: "lead-1", arquivadoEm: null });
  prismaMock.lead.updateManyAndReturn.mockImplementation(({ data }) => [{ id: "lead-1", ...data }]);
  prismaMock.lead.findMany.mockResolvedValue([]);
  prismaMock.lead.groupBy.mockResolvedValue([]);
  prismaMock.pipelineStage.findMany.mockResolvedValue([]);
});

describe("arquivarLead", () => {
  it("grava a data e audita", async () => {
    await arquivarLead({ leadId: "lead-1", autorId: "user-1" });

    expect(prismaMock.lead.updateManyAndReturn.mock.calls[0][0].data.arquivadoEm).toBeInstanceOf(Date);
    expect(auditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({ acao: "arquivar_lead", entidadeId: "lead-1", userId: "user-1" })
    );
  });

  it("desarquivar limpa a data", async () => {
    prismaMock.lead.findFirstOrThrow.mockResolvedValue({
      id: "lead-1",
      arquivadoEm: new Date(),
    });

    await desarquivarLead({ leadId: "lead-1", autorId: "user-1" });

    expect(prismaMock.lead.updateManyAndReturn.mock.calls[0][0].data.arquivadoEm).toBeNull();
    expect(auditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({ acao: "desarquivar_lead" })
    );
  });

  it("recusa arquivar duas vezes", async () => {
    prismaMock.lead.findFirstOrThrow.mockResolvedValue({
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
    await listarLeads(EMPRESA);
    expect(prismaMock.lead.findMany.mock.calls[0][0].where).toMatchObject({
      arquivadoEm: null,
    });
  });

  it("listarLeads pode incluir arquivados quando pedido explicitamente", async () => {
    await listarLeads(EMPRESA, { incluirArquivados: true });
    expect(prismaMock.lead.findMany.mock.calls[0][0].where?.arquivadoEm).toBeUndefined();
  });

  it("listarLeadsPorEtapa (kanban) filtra", async () => {
    await listarLeadsPorEtapa(EMPRESA);
    expect(prismaMock.lead.findMany.mock.calls[0][0].where).toMatchObject({
      arquivadoEm: null,
    });
  });

  // Caminho novo, e o mais fácil de esquecer: não devolve linha nenhuma, só
  // número. Um arquivado contado aqui não aparece em lista alguma para
  // denunciar o erro — ele só engorda o total do painel e afunda a taxa de
  // conversão, que é o número que alguém olha para decidir alguma coisa.
  it("contarLeadsPorEtapa (painel) filtra", async () => {
    await contarLeadsPorEtapa(EMPRESA);
    expect(prismaMock.lead.groupBy.mock.calls[0][0].where).toMatchObject({
      arquivadoEm: null,
    });
  });
});
