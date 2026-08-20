import { describe, it, expect, vi, beforeEach } from "vitest";

const EMPRESA = "empresa-do-teste";

// O banco falso é o CLIENTE ESCOPADO, não o `prisma` cru — e isso mudou no
// Ciclo 1a (Task 4), quando `notes.ts` deixou de importar `@/lib/prisma`.
//
// As operações também mudaram de nome, e não por gosto: o escopo RECUSA
// `findUnique`, `update` e `delete` em modelo de tenant (o `where` delas só
// aceita campo único, e `companyId` não é único em `LeadNote`), então o
// serviço usa `findFirst`, `updateManyAndReturn` e `deleteMany` — ver "Recusa,
// lançando" em `core/tenancy/escopo.ts`. Um mock que continuasse expondo os
// nomes antigos ficaria verde afirmando um contrato que não existe mais.
const prismaMock = vi.hoisted(() => ({
  leadNote: { findFirst: vi.fn(), updateManyAndReturn: vi.fn(), deleteMany: vi.fn() },
}));
const auditoriaMock = vi.hoisted(() => vi.fn());
const escopoMock = vi.hoisted(() => vi.fn());

// `notes.ts` tem `import "server-only"` no topo, que lança fora do pipeline
// de build do Next. Mesmo no-op dos outros testes deste diretório.
vi.mock("server-only", () => ({}));

// ─── Este arquivo MOCKA O ESCOPO, e isso é declaração, não descuido ───
//
// `prismaDaEmpresa` devolve o banco falso direto, sem a extensão do Prisma no
// caminho: nada aqui prova que `companyId` chega à consulta. Provar isso é
// tarefa de `tests/unit/lead-isolamento.test.ts`, contra duas empresas de
// verdade no Postgres — não dá para fazer aqui, porque o banco falso teria de
// ser aplicado por DENTRO do escopo e quem chama `prismaDaEmpresa()` é o
// serviço, onde o teste não alcança para injetar nada (o mesmo motivo está
// documentado em `tests/unit/escopo-empresa.test.ts`).
//
// O que ESTE arquivo prova, e continua provando, é a regra de DONO: só o autor
// edita a própria nota. O que ele ganhou de novo é a asserção de que o escopo
// é PEDIDO com a empresa do autor — sem ela, `prismaDaEmpresa` poderia estar
// sendo chamada com qualquer coisa e todos os casos continuariam verdes.
vi.mock("@/core/tenancy/escopo", () => ({ prismaDaEmpresa: escopoMock }));
vi.mock("@/core/users/empresa", () => ({
  companyIdDoUsuario: vi.fn(async () => EMPRESA),
}));
vi.mock("@/core/audit/log", () => ({ registrarAuditoria: auditoriaMock }));

import { editarNota, excluirNota } from "../../src/core/leads/notes";

const NOTA = { id: "nota-1", leadId: "lead-1", autorId: "user-1", texto: "original" };

beforeEach(() => {
  vi.clearAllMocks();
  escopoMock.mockReturnValue(prismaMock);
  prismaMock.leadNote.findFirst.mockResolvedValue(NOTA);
  prismaMock.leadNote.updateManyAndReturn.mockImplementation(({ data }) => [{ ...NOTA, ...data }]);
  prismaMock.leadNote.deleteMany.mockResolvedValue({ count: 1 });
});

describe("editarNota", () => {
  it("grava o texto novo e marca editadoEm", async () => {
    await editarNota({ notaId: "nota-1", texto: "corrigido", autorId: "user-1" });

    const dados = prismaMock.leadNote.updateManyAndReturn.mock.calls[0][0].data;
    expect(dados.texto).toBe("corrigido");
    expect(dados.editadoEm).toBeInstanceOf(Date);
  });

  it("recusa quem nao e o autor", async () => {
    await expect(
      editarNota({ notaId: "nota-1", texto: "invasao", autorId: "user-2" })
    ).rejects.toThrow("Nota não encontrada");
    expect(prismaMock.leadNote.updateManyAndReturn).not.toHaveBeenCalled();
  });

  // A mensagem é a MESMA nos dois casos, de propósito: diferenciá-las
  // confirmaria a quem adivinha ids que aquele id pertence a alguém.
  it("usa a mesma mensagem para inexistente e para nao-e-sua", async () => {
    prismaMock.leadNote.findFirst.mockResolvedValue(null);
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

  // Não prova que o `companyId` chega à consulta (ver o bloco de mocks acima
  // sobre o que este arquivo pode e não pode provar). Prova que o escopo é
  // PEDIDO, e pedido com a empresa DO AUTOR — sem isto, trocar
  // `companyIdDoUsuario(input.autorId)` por qualquer outra origem passaria
  // despercebido aqui.
  it("pede o cliente escopado na empresa do autor", async () => {
    await editarNota({ notaId: "nota-1", texto: "corrigido", autorId: "user-1" });

    expect(escopoMock).toHaveBeenCalledWith(EMPRESA);
  });
});

describe("excluirNota", () => {
  it("apaga e audita guardando o texto que sumiu", async () => {
    await excluirNota({ notaId: "nota-1", autorId: "user-1" });

    expect(prismaMock.leadNote.deleteMany).toHaveBeenCalledWith({ where: { id: "nota-1" } });
    expect(auditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({ acao: "excluir_nota", antes: { texto: "original" } })
    );
  });

  it("recusa quem nao e o autor", async () => {
    await expect(excluirNota({ notaId: "nota-1", autorId: "user-2" })).rejects.toThrow(
      "Nota não encontrada"
    );
    expect(prismaMock.leadNote.deleteMany).not.toHaveBeenCalled();
  });
});
