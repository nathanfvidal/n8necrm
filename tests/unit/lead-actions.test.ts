// Teste de unidade puro (sem Prisma real): cobre a autorização de
// actions.ts — os dois gates de `hasPermission` e o clamp de
// `responsavelId` (fix round 1/5, achado do revisor: essa lógica não tinha
// nenhuma cobertura própria além de leitura/typecheck/lint). `auth()` do
// Auth.js é o que de fato não dá para rodar fora de um request HTTP — mas
// nada impede mockar `usuarioAtual()`, `hasPermission()` e o `service`
// diretamente, isolando a decisão de autorização da action de tudo o mais.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { User, Lead } from "@prisma/client";

const usuarioAtualMock = vi.fn();
vi.mock("@/core/auth/session", () => ({ usuarioAtual: () => usuarioAtualMock() }));

// `hasPermission` é mantida REAL por padrão (spy em volta da implementação
// verdadeira) — os testes de clamp de `responsavelId` usam papéis de
// verdade (VENDEDOR/GESTOR) contra a matriz real de
// src/core/auth/permissions.ts, não uma simulação. Só o teste de "sem
// permissão" força um retorno `false` pontual com `mockReturnValueOnce`,
// porque hoje nenhum papel real carece de `criar_lead`/`mover_lead` (os 3
// papéis têm as duas) — isolar essa branch é a única forma de exercitá-la
// sem inventar um papel novo, que está fora do escopo deste fix.
vi.mock("@/core/auth/permissions", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/core/auth/permissions")>();
  return { ...real, hasPermission: vi.fn(real.hasPermission) };
});

const criarLeadMock = vi.fn();
const moverEtapaMock = vi.fn();
vi.mock("@/core/leads/service", () => ({
  criarLead: (...args: unknown[]) => criarLeadMock(...args),
  moverEtapa: (...args: unknown[]) => moverEtapaMock(...args),
}));

const { criarLeadManual, moverLeadDeEtapa } = await import("../../src/core/leads/actions");
const { hasPermission } = await import("../../src/core/auth/permissions");

function usuarioFake(overrides: Partial<User>): User {
  return {
    id: "usuario-fake-id",
    nome: "Usuário Fake",
    email: "fake@teste.local",
    senhaHash: "hash",
    papel: "VENDEDOR",
    ativo: true,
    criadoEm: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function leadFake(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-fake-id",
    contactId: "contact-fake-id",
    itemId: null,
    stageId: "stage-fake-id",
    responsavelId: "usuario-fake-id",
    canal: "MANUAL",
    valorEstimado: null,
    sessionId: null,
    utm: null,
    criadoEm: new Date("2026-01-01T00:00:00.000Z"),
    ultimaInteracaoEm: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  usuarioAtualMock.mockReset();
  vi.mocked(hasPermission).mockClear();
  criarLeadMock.mockReset();
  moverEtapaMock.mockReset();
});

describe("criarLeadManual", () => {
  it("rejeita e NÃO chama o service quando o chamador não tem a permissão criar_lead", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "VENDEDOR" }));
    vi.mocked(hasPermission).mockReturnValueOnce(false); // simula um papel sem criar_lead

    await expect(
      criarLeadManual({ nome: "X", telefone: "11988880001", responsavelId: "usuario-fake-id" })
    ).rejects.toThrow("Sem permissão para criar lead");

    expect(criarLeadMock).not.toHaveBeenCalled();
  });

  it(
    "VENDEDOR (papel real, matriz real de permissions.ts) NÃO CONSEGUE atribuir o lead a outra pessoa: " +
      "o responsavelId enviado ao service é o do próprio autor, não o do formulário",
    async () => {
      const vendedor = usuarioFake({ id: "vendedor-1", papel: "VENDEDOR" });
      usuarioAtualMock.mockResolvedValue(vendedor);
      criarLeadMock.mockResolvedValue(leadFake({ responsavelId: vendedor.id }));

      await criarLeadManual({
        nome: "X",
        telefone: "11988880002",
        responsavelId: "outra-pessoa-id",
      });

      expect(criarLeadMock).toHaveBeenCalledWith(
        expect.objectContaining({ responsavelId: "vendedor-1", autorId: "vendedor-1" })
      );
      // prova que a decisão realmente passou pela matriz real: VENDEDOR não
      // tem ver_dashboard_geral.
      expect(hasPermission("VENDEDOR", "ver_dashboard_geral")).toBe(false);
    }
  );

  it(
    "GESTOR (papel real) CONSEGUE atribuir o lead a outra pessoa: o responsavelId do formulário é " +
      "respeitado sem alteração",
    async () => {
      const gestor = usuarioFake({ id: "gestor-1", papel: "GESTOR" });
      usuarioAtualMock.mockResolvedValue(gestor);
      criarLeadMock.mockResolvedValue(leadFake({ responsavelId: "outra-pessoa-id" }));

      await criarLeadManual({
        nome: "X",
        telefone: "11988880003",
        responsavelId: "outra-pessoa-id",
      });

      expect(criarLeadMock).toHaveBeenCalledWith(
        expect.objectContaining({ responsavelId: "outra-pessoa-id", autorId: "gestor-1" })
      );
    }
  );

  it("o responsavelId do formulário é respeitado quando é o próprio autor (não é atribuição a outra pessoa)", async () => {
    const vendedor = usuarioFake({ id: "vendedor-2", papel: "VENDEDOR" });
    usuarioAtualMock.mockResolvedValue(vendedor);
    criarLeadMock.mockResolvedValue(leadFake({ responsavelId: vendedor.id }));

    await criarLeadManual({ nome: "X", telefone: "11988880004", responsavelId: "vendedor-2" });

    expect(criarLeadMock).toHaveBeenCalledWith(expect.objectContaining({ responsavelId: "vendedor-2" }));
  });

  it(
    "propaga 'Não autenticado' sem chamar hasPermission nem o service quando usuarioAtual rejeita " +
      "(sessão ausente OU usuário desativado — fix 1: os dois casos chegam aqui do mesmo jeito)",
    async () => {
      usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));

      await expect(
        criarLeadManual({ nome: "X", telefone: "11988880005", responsavelId: "qualquer" })
      ).rejects.toThrow("Não autenticado");

      expect(hasPermission).not.toHaveBeenCalled();
      expect(criarLeadMock).not.toHaveBeenCalled();
    }
  );
});

describe("moverLeadDeEtapa", () => {
  it("rejeita e NÃO chama o service quando o chamador não tem a permissão mover_lead", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "VENDEDOR" }));
    vi.mocked(hasPermission).mockReturnValueOnce(false); // simula um papel sem mover_lead

    await expect(moverLeadDeEtapa({ leadId: "lead-1", novaStageId: "stage-2" })).rejects.toThrow(
      "Sem permissão para mover lead"
    );

    expect(moverEtapaMock).not.toHaveBeenCalled();
  });

  it("delega ao service com autorId derivado da sessão (nunca do input) quando o chamador tem permissão", async () => {
    const vendedor = usuarioFake({ id: "vendedor-3", papel: "VENDEDOR" });
    usuarioAtualMock.mockResolvedValue(vendedor);
    moverEtapaMock.mockResolvedValue(leadFake({ stageId: "stage-2" }));

    await moverLeadDeEtapa({ leadId: "lead-1", novaStageId: "stage-2" });

    expect(moverEtapaMock).toHaveBeenCalledWith({
      leadId: "lead-1",
      novaStageId: "stage-2",
      autorId: "vendedor-3",
    });
  });

  it(
    "propaga 'Não autenticado' sem chamar hasPermission nem o service quando usuarioAtual rejeita " +
      "(sessão ausente OU usuário desativado)",
    async () => {
      usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));

      await expect(moverLeadDeEtapa({ leadId: "lead-1", novaStageId: "stage-2" })).rejects.toThrow(
        "Não autenticado"
      );

      expect(hasPermission).not.toHaveBeenCalled();
      expect(moverEtapaMock).not.toHaveBeenCalled();
    }
  );
});
