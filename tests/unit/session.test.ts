// Este arquivo usa o Prisma real contra o Postgres do Supabase (para provar
// que `usuarioAtual()` realmente consulta `User.ativo` no banco, não um
// valor simulado), então carrega DATABASE_URL do .env aqui — não em
// vitest.config.ts — mesmo motivo documentado em dedupe.test.ts,
// seed.test.ts etc. Precisa ser o primeiro import.
import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "../../src/lib/prisma";

// `auth()` (Auth.js) depende de contexto de requisição HTTP real, que não
// existe num teste Vitest — mockamos só esse ponto de entrada, exatamente
// como tests/unit/login-page.test.tsx já mocka next-auth/react. Tudo o mais
// em `usuarioAtual()` (a consulta `prisma.user.findUniqueOrThrow` e a
// checagem de `ativo`) roda contra o Postgres real.
const authMock = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));

// Importado após o mock acima, para que `session.ts` use o stub de `auth()`.
const { usuarioAtual } = await import("../../src/core/auth/session");

describe("usuarioAtual — fix round 1/5 (CRITICAL): usuário desativado não pode continuar agindo", () => {
  const EMAIL_ATIVO = "teste-fix1-usuario-ativo@teste.local";
  const EMAIL_DESATIVADO = "teste-fix1-usuario-desativado@teste.local";
  let idAtivo: string;
  let idDesativado: string;

  beforeAll(async () => {
    // Prefixo "teste-fix1-" isola estas linhas do seed (admin@exemplo.com /
    // vendedor@exemplo.com) e de qualquer outro teste — limpo no afterAll.
    const ativo = await prisma.user.create({
      data: {
        nome: "Teste Fix1 Ativo",
        email: EMAIL_ATIVO,
        senhaHash: "hash-fake-nao-usado-em-login",
        papel: "VENDEDOR",
        ativo: true,
      },
    });
    idAtivo = ativo.id;

    const desativado = await prisma.user.create({
      data: {
        nome: "Teste Fix1 Desativado",
        email: EMAIL_DESATIVADO,
        senhaHash: "hash-fake-nao-usado-em-login",
        papel: "VENDEDOR",
        ativo: false,
      },
    });
    idDesativado = desativado.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [idAtivo, idDesativado] } } });
  });

  it("retorna o usuário quando a sessão existe e o usuário está ativo", async () => {
    authMock.mockResolvedValueOnce({ user: { email: EMAIL_ATIVO } });

    const usuario = await usuarioAtual();

    expect(usuario.id).toBe(idAtivo);
    expect(usuario.ativo).toBe(true);
  });

  it("lança 'Não autenticado' quando não há sessão", async () => {
    authMock.mockResolvedValueOnce(null);

    await expect(usuarioAtual()).rejects.toThrow("Não autenticado");
  });

  it(
    "lança quando o usuário da sessão foi desativado (ativo: false) — o cookie de sessão sobrevive à " +
      "desativação (JWT, sem store no servidor), então sem esta checagem a pessoa continuaria agindo " +
      "depois de ser desligada",
    async () => {
      authMock.mockResolvedValueOnce({ user: { email: EMAIL_DESATIVADO } });

      await expect(usuarioAtual()).rejects.toThrow("Não autenticado");
    }
  );

  it(
    "um usuário desativado produz EXATAMENTE a mesma mensagem de erro que 'sem sessão nenhuma' — " +
      "não um shape de erro à parte que algum chamador possa tratar diferente por engano",
    async () => {
      authMock.mockResolvedValueOnce(null);
      let erroSemSessao: unknown;
      try {
        await usuarioAtual();
      } catch (erro) {
        erroSemSessao = erro;
      }

      authMock.mockResolvedValueOnce({ user: { email: EMAIL_DESATIVADO } });
      let erroDesativado: unknown;
      try {
        await usuarioAtual();
      } catch (erro) {
        erroDesativado = erro;
      }

      expect(erroSemSessao).toBeInstanceOf(Error);
      expect(erroDesativado).toBeInstanceOf(Error);
      expect((erroDesativado as Error).message).toBe((erroSemSessao as Error).message);
    }
  );
});
