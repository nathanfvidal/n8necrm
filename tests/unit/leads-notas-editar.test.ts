import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  leadNote: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));
const auditoriaMock = vi.hoisted(() => vi.fn());

// `notes.ts` tem `import "server-only"` no topo, que lança fora do pipeline
// de build do Next. Mesmo no-op dos outros testes deste diretório.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/core/audit/log", () => ({ registrarAuditoria: auditoriaMock }));

import { editarNota, excluirNota } from "../../src/core/leads/notes";

const NOTA = { id: "nota-1", leadId: "lead-1", autorId: "user-1", texto: "original" };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.leadNote.findUnique.mockResolvedValue(NOTA);
  prismaMock.leadNote.update.mockImplementation(({ data }) => ({ ...NOTA, ...data }));
});

describe("editarNota", () => {
  it("grava o texto novo e marca editadoEm", async () => {
    await editarNota({ notaId: "nota-1", texto: "corrigido", autorId: "user-1" });

    const dados = prismaMock.leadNote.update.mock.calls[0][0].data;
    expect(dados.texto).toBe("corrigido");
    expect(dados.editadoEm).toBeInstanceOf(Date);
  });

  it("recusa quem nao e o autor", async () => {
    await expect(
      editarNota({ notaId: "nota-1", texto: "invasao", autorId: "user-2" })
    ).rejects.toThrow("Nota não encontrada");
    expect(prismaMock.leadNote.update).not.toHaveBeenCalled();
  });

  // A mensagem é a MESMA nos dois casos, de propósito: diferenciá-las
  // confirmaria a quem adivinha ids que aquele id pertence a alguém.
  it("usa a mesma mensagem para inexistente e para nao-e-sua", async () => {
    prismaMock.leadNote.findUnique.mockResolvedValue(null);
    await expect(
      editarNota({ notaId: "sumida", texto: "x", autorId: "user-1" })
    ).rejects.toThrow("Nota não encontrada");
  });

  it("recusa texto vazio", async () => {
    await expect(
      editarNota({ notaId: "nota-1", texto: "   ", autorId: "user-1" })
    ).rejects.toThrow(/Nota vazia/);
  });

  it("recusa texto longo demais", async () => {
    await expect(
      editarNota({ notaId: "nota-1", texto: "x".repeat(4001), autorId: "user-1" })
    ).rejects.toThrow(/muito longa/);
  });

  it("audita com o texto anterior", async () => {
    await editarNota({ notaId: "nota-1", texto: "corrigido", autorId: "user-1" });

    expect(auditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: "editar_nota",
        entidade: "LeadNote",
        entidadeId: "nota-1",
        antes: { texto: "original" },
      })
    );
  });
});

describe("excluirNota", () => {
  it("apaga e audita guardando o texto que sumiu", async () => {
    await excluirNota({ notaId: "nota-1", autorId: "user-1" });

    expect(prismaMock.leadNote.delete).toHaveBeenCalledWith({ where: { id: "nota-1" } });
    expect(auditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({ acao: "excluir_nota", antes: { texto: "original" } })
    );
  });

  it("recusa quem nao e o autor", async () => {
    await expect(excluirNota({ notaId: "nota-1", autorId: "user-2" })).rejects.toThrow(
      "Nota não encontrada"
    );
    expect(prismaMock.leadNote.delete).not.toHaveBeenCalled();
  });
});
