// Prova que `usuarioAtual()` resolve empresa e papel pelo VÍNCULO
// (`Membership`). A coluna `User.papel` que ele substituiu não existe mais
// desde o Ciclo 1f -- e a trava que impede a volta está em `LINHA_HOSTIL`,
// abaixo, porque nem o `tsc` nem a varredura textual alcançam este arquivo.
//
// Prisma e `auth()` mockados aqui, ao contrário de `session.test.ts`
// (Postgres real) -- o que este arquivo prova é a REGRA de resolução (qual
// vínculo vira `companyId`/`papel`, e quando lança), não que a consulta em
// si acerta o banco. Isso já é coberto por `session.test.ts` e pela
// migração de dados da Task 1 (um vínculo por usuário existente).
import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findUniqueOrThrow: vi.fn() },
}));
const authMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({ auth: authMock }));

import { usuarioAtual } from "../../src/core/auth/session";
import { EmpresaAmbiguaError } from "../../src/core/auth/usuario-ativo";

// A linha de `User` como ela é DEPOIS do Ciclo 1f: sem `papel`. A coluna foi
// derrubada, e o papel mora em `Membership`.
const USUARIO_BASE = {
  id: "user-1",
  nome: "Usuária Teste",
  email: "teste-usuario-ativo@exemplo.local",
  ativo: true,
};

// A linha HOSTIL: `USUARIO_BASE` com a coluna derrubada de volta, e com valor
// DIVERGENTE do vínculo (ADMIN aqui, VENDEDOR lá).
//
// Ela existe porque a trava que este arquivo carregava desde o Ciclo 1a --
// "nenhum teste passa por acidente caso `usuarioAtual()` volte a ler a coluna"
// -- perderia a premissa quando a coluna sumisse, e sumiria EM SILÊNCIO: o
// objeto é um literal sem tipo, então nem o `tsc` nem a varredura textual de
// `user-papel-nao-volta.test.ts` (que só olha chamadas a `prisma.user.*`, e
// aqui é `prismaMock`) acusariam a perda. Apagar a trava junto com a coluna
// custaria a única asserção do projeto que separa "resolveu pelo vínculo" de
// "resolveu pela linha de `User`".
//
// Reancorada, ela deixa de descrever o presente e passa a descrever a
// REGRESSÃO: se alguém voltar a resolver o papel pela linha, o caso abaixo
// devolve "ADMIN" e fica vermelho. É a forma que uma trava deve ter, e o
// Ciclo 1f a exercitou de verdade: a regressão foi feita à mão em
// `src/core/auth/session.ts` e o caso ficou vermelho antes de ser desfeita.
//
// Este é o único ponto do repositório onde `papel` numa linha de `User` é
// deliberado. Ver `.superpowers/sdd/medicao-user-papel.md` § 1, item 11.
const LINHA_HOSTIL = { ...USUARIO_BASE, papel: "ADMIN" };

function membership(papel: string, companyId = "empresa-1") {
  return { id: `membership-${companyId}`, userId: USUARIO_BASE.id, companyId, papel, criadoEm: new Date() };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { email: USUARIO_BASE.email } });
});

describe("usuarioAtual — resolve empresa e papel pelo vínculo", () => {
  it("usuário com um vínculo devolve companyId e papel DO VÍNCULO", async () => {
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({
      ...USUARIO_BASE,
      memberships: [membership("VENDEDOR", "empresa-1")],
    });

    const usuario = await usuarioAtual();

    expect(usuario.companyId).toBe("empresa-1");
    expect(usuario.papel).toBe("VENDEDOR");
  });

  it(
    "com a coluna derrubada REINTRODUZIDA na linha, o papel devolvido continua sendo o do " +
      "vínculo -- os dois valores divergem de propósito (vínculo VENDEDOR, coluna ADMIN) para " +
      "que este caso fique vermelho se alguém voltar a resolver o papel pela linha de User",
    async () => {
      prismaMock.user.findUniqueOrThrow.mockResolvedValue({
        ...LINHA_HOSTIL, // papel: "ADMIN" na coluna que não existe mais
        memberships: [membership("VENDEDOR")], // papel: "VENDEDOR" no vínculo
      });

      const usuario = await usuarioAtual();

      expect(usuario.papel).toBe("VENDEDOR");
      expect(usuario.papel).not.toBe(LINHA_HOSTIL.papel);
    }
  );

  it(
    "usuário com ZERO vínculo lança 'Não autenticado' -- mesma mensagem de sessão inválida " +
      "(ver `ehSessaoInvalida` em src/lib/acao.ts, que reconhece essa string exata). Zero vínculo " +
      "é tratado como sessão inválida e não como erro próprio: uma conta sem empresa não tem nada " +
      "que possa ser servido a ela",
    async () => {
      prismaMock.user.findUniqueOrThrow.mockResolvedValue({ ...USUARIO_BASE, memberships: [] });

      await expect(usuarioAtual()).rejects.toThrow("Não autenticado");
    }
  );

  it(
    "usuário com DOIS vínculos lança EmpresaAmbiguaError, distinto de 'Não autenticado' -- não é " +
      "sessão inválida, é conta que a UI ainda não sabe servir. Tratar as duas situações como a " +
      "mesma coisa mandaria a pessoa para o login num loop, sem nunca dizer o que está errado",
    async () => {
      prismaMock.user.findUniqueOrThrow.mockResolvedValue({
        ...USUARIO_BASE,
        memberships: [membership("VENDEDOR", "empresa-1"), membership("GESTOR", "empresa-2")],
      });

      await expect(usuarioAtual()).rejects.toBeInstanceOf(EmpresaAmbiguaError);
      await expect(usuarioAtual()).rejects.not.toThrow("Não autenticado");
    }
  );

  it("usuário desativado lança 'Não autenticado', como antes desta tarefa", async () => {
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({
      ...USUARIO_BASE,
      ativo: false,
      memberships: [membership("VENDEDOR")],
    });

    await expect(usuarioAtual()).rejects.toThrow("Não autenticado");
  });

  it("sem sessão (auth() devolve null) lança 'Não autenticado', sem consultar o banco", async () => {
    authMock.mockResolvedValue(null);

    await expect(usuarioAtual()).rejects.toThrow("Não autenticado");
    expect(prismaMock.user.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
