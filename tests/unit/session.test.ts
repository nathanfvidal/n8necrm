// Este arquivo usa o Prisma real contra o Postgres do Supabase (para provar
// que `usuarioAtual()` realmente consulta `User.ativo` no banco, não um
// valor simulado), então carrega DATABASE_URL do .env aqui — não em
// vitest.config.ts — mesmo motivo documentado em dedupe.test.ts,
// seed.test.ts etc. Precisa ser o primeiro import.
import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server" que o Next.js aplica no build — fora desse pipeline (aqui,
// sob Vitest) ele sempre lança, independente de quem importa (ver
// tests/unit/storage.test.ts, onde este mock foi documentado pela primeira
// vez). `src/lib/prisma.ts` ganhou `import "server-only"` na Task 17 (fix
// round 2/5), e este arquivo importa `prisma` direto — sem mockar aqui, TODO
// teste deste arquivo quebraria na importação, não por causa da lógica
// testada.
vi.mock("server-only", () => ({}));

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
  let idEmpresa: string;

  beforeAll(async () => {
    // A partir da Task 2 do Ciclo 1a, `usuarioAtual()` exige um `Membership`
    // (lança "Não autenticado" com zero vínculo — mesmo raciocínio de
    // usuário sem empresa não ter nada que possa ser servido a ela). Uma
    // `Company` própria para este arquivo, e não `company-migracao-1a`
    // (a empresa real de produção): este teste roda contra o Postgres real
    // e não deve depender do id de uma linha que outra migração criou —
    // criar a própria mantém o arquivo isolado, mesmo raciocínio do prefixo
    // "teste-fix1-" abaixo.
    const empresa = await prisma.company.create({
      data: { nome: "Teste Fix1 Empresa" },
    });
    idEmpresa = empresa.id;

    // Prefixo "teste-fix1-" isola estas linhas do seed (admin@exemplo.com /
    // vendedor@exemplo.com) e de qualquer outro teste — limpo no afterAll.
    // `papel` na coluna do `User` fica ADMIN, deliberadamente DIFERENTE do
    // papel do vínculo (VENDEDOR) abaixo — se `usuarioAtual()` algum dia
    // voltasse a ler `User.papel` em vez de `Membership.papel`, o teste
    // "retorna o usuário..." pegaria isso (papel devolvido seria ADMIN, não
    // VENDEDOR), mesmo com a coluna ainda existindo neste ponto da suíte.
    const ativo = await prisma.user.create({
      data: {
        nome: "Teste Fix1 Ativo",
        email: EMAIL_ATIVO,
        senhaHash: "hash-fake-nao-usado-em-login",
        papel: "ADMIN",
        ativo: true,
        memberships: { create: { companyId: idEmpresa, papel: "VENDEDOR" } },
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
        memberships: { create: { companyId: idEmpresa, papel: "VENDEDOR" } },
      },
    });
    idDesativado = desativado.id;
  });

  afterAll(async () => {
    // Apagar os `User` primeiro: `Membership.userId` é `ON DELETE CASCADE`
    // (schema.prisma), então os vínculos somem junto. Só depois a `Company`
    // — apagá-la antes falharia na FK `Membership_companyId_fkey` enquanto
    // algum vínculo ainda existisse.
    await prisma.user.deleteMany({ where: { id: { in: [idAtivo, idDesativado] } } });
    await prisma.company.delete({ where: { id: idEmpresa } });
  });

  it("retorna o usuário quando a sessão existe e o usuário está ativo, com o papel DO VÍNCULO", async () => {
    authMock.mockResolvedValueOnce({ user: { email: EMAIL_ATIVO } });

    const usuario = await usuarioAtual();

    expect(usuario.id).toBe(idAtivo);
    expect(usuario.ativo).toBe(true);
    expect(usuario.companyId).toBe(idEmpresa);
    // VENDEDOR é o papel do Membership; a coluna User.papel deste usuário é
    // ADMIN (ver comentário no beforeAll) — só passa se a origem for o vínculo.
    expect(usuario.papel).toBe("VENDEDOR");
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
