// Prova que `usuarioAtual()` resolve empresa e papel pelo VÍNCULO
// (`Membership`), não mais pela coluna `User.papel` (Ciclo 1a, Task 2).
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

// `papel: "ADMIN"` aqui é a coluna ANTIGA (`User.papel`) -- de propósito
// diferente do papel usado nos vínculos abaixo, para que nenhum teste passe
// por acidente caso `usuarioAtual()` volte a ler a coluna em vez do vínculo.
const USUARIO_BASE = {
  id: "user-1",
  nome: "Usuária Teste",
  email: "teste-usuario-ativo@exemplo.local",
  ativo: true,
  papel: "ADMIN",
};

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
    "o papel devolvido é o do vínculo, e NÃO o de User.papel -- os dois valores divergem de " +
      "propósito neste caso (vínculo VENDEDOR, coluna antiga ADMIN) para que o teste não passe " +
      "por acidente se alguém reintroduzir a leitura da coluna",
    async () => {
      prismaMock.user.findUniqueOrThrow.mockResolvedValue({
        ...USUARIO_BASE, // papel: "ADMIN" na coluna antiga
        memberships: [membership("VENDEDOR")], // papel: "VENDEDOR" no vínculo
      });

      const usuario = await usuarioAtual();

      expect(usuario.papel).toBe("VENDEDOR");
      expect(usuario.papel).not.toBe(USUARIO_BASE.papel);
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
