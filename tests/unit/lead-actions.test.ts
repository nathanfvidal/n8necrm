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

// `actions.ts` passou a importar `./notes` (Task 17) — sem mockar aqui, a
// importação real puxaria `@/lib/prisma` → `@/lib/env`, que exige
// DATABASE_URL/AUTH_SECRET no processo. Este arquivo é deliberadamente um
// teste "puro" (sem Prisma real, ver comentário no topo) — mockar mantém
// essa propriedade em vez de silenciosamente virar um teste de integração.
const adicionarNotaMock = vi.fn();
vi.mock("@/core/leads/notes", () => ({
  adicionarNota: (...args: unknown[]) => adicionarNotaMock(...args),
  TEXTO_MAX_LENGTH: 4000,
}));

// `adicionarNotaAction` chama `revalidatePath` só depois de um `adicionarNota`
// bem-sucedido — fora de uma requisição real do Next.js, a implementação
// real lançaria ("Invariant: static generation store missing"). Mockar
// como no-op deixa este arquivo testar só a autorização/branching da
// action, que é o que ele testa para as outras duas actions também.
const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

const { criarLeadManual, moverLeadDeEtapa, adicionarNotaAction } = await import(
  "../../src/core/leads/actions"
);
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

function formDataComTexto(texto: string): FormData {
  const formData = new FormData();
  formData.set("texto", texto);
  return formData;
}

beforeEach(() => {
  usuarioAtualMock.mockReset();
  vi.mocked(hasPermission).mockClear();
  criarLeadMock.mockReset();
  moverEtapaMock.mockReset();
  adicionarNotaMock.mockReset();
  revalidatePathMock.mockReset();
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

  it(
    "criação com sucesso: revalida o layout do painel (não só a página /leads) — Task 19, para o " +
      "sino de notificações refletir a contagem nova no próximo router.refresh() do cliente",
    async () => {
      usuarioAtualMock.mockResolvedValue(usuarioFake({ id: "vendedor-4" }));
      criarLeadMock.mockResolvedValue(leadFake({ responsavelId: "vendedor-4" }));

      await criarLeadManual({ nome: "X", telefone: "11988880006", responsavelId: "vendedor-4" });

      expect(revalidatePathMock).toHaveBeenCalledWith("/(painel)", "layout");
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

// Fix round 1/5 (Task 17), achado do revisor: uma nota acima do limite de
// tamanho lançava sem tratamento dentro da Server Action original (não
// existe `error.tsx` sob src/app), então a pessoa via a tela de erro
// genérica do Next em vez de uma mensagem. Estes testes cobrem só a
// autorização/branching de `adicionarNotaAction` — o comportamento real de
// `adicionarNota` (trim, limite de tamanho, etc.) já é coberto contra
// Prisma real em tests/unit/lead-notes.test.ts; aqui `adicionarNotaMock`
// simula cada resposta possível dela.
describe("adicionarNotaAction", () => {
  it("deriva autorId da sessão (nunca de FormData) e chama revalidatePath após salvar com sucesso", async () => {
    const vendedor = usuarioFake({ id: "vendedor-4", papel: "VENDEDOR" });
    usuarioAtualMock.mockResolvedValue(vendedor);
    adicionarNotaMock.mockResolvedValue({ id: "nota-1", texto: "Nota qualquer" });

    const resultado = await adicionarNotaAction(
      "lead-1",
      { erro: null },
      formDataComTexto("Nota qualquer")
    );

    expect(adicionarNotaMock).toHaveBeenCalledWith({
      leadId: "lead-1",
      autorId: "vendedor-4",
      texto: "Nota qualquer",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/leads/lead-1");
    expect(resultado).toEqual({ erro: null });
  });

  it("texto vazio/só-espaço: no-op silencioso, não chama adicionarNota nem revalidatePath", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ id: "vendedor-5" }));

    const resultado = await adicionarNotaAction("lead-1", { erro: null }, formDataComTexto("   "));

    expect(adicionarNotaMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(resultado).toEqual({ erro: null });
  });

  it(
    "nota muito longa: devolve { erro } com a mensagem de adicionarNota em vez de lançar — é " +
      "exatamente o caso que quebrava antes deste fix",
    async () => {
      usuarioAtualMock.mockResolvedValue(usuarioFake({ id: "vendedor-6" }));
      adicionarNotaMock.mockRejectedValue(
        new Error("Nota muito longa: o texto tem 4001 caracteres, o máximo permitido é 4000.")
      );

      const resultado = await adicionarNotaAction(
        "lead-1",
        { erro: null },
        formDataComTexto("a".repeat(4001))
      );

      expect(resultado.erro).toMatch(/Nota muito longa/);
      expect(revalidatePathMock).not.toHaveBeenCalled();
    }
  );

  it("qualquer outro erro de adicionarNota (ex.: banco fora do ar) propaga sem virar { erro }", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ id: "vendedor-7" }));
    adicionarNotaMock.mockRejectedValue(new Error("Conexão com o banco falhou"));

    await expect(
      adicionarNotaAction("lead-1", { erro: null }, formDataComTexto("Nota qualquer"))
    ).rejects.toThrow("Conexão com o banco falhou");
  });

  it("propaga 'Não autenticado' sem chamar adicionarNota quando usuarioAtual rejeita", async () => {
    usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));

    await expect(
      adicionarNotaAction("lead-1", { erro: null }, formDataComTexto("Nota qualquer"))
    ).rejects.toThrow("Não autenticado");

    expect(adicionarNotaMock).not.toHaveBeenCalled();
  });
});
