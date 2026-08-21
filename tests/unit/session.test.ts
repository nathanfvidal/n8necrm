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
    // Até o Ciclo 1f este `beforeAll` gravava ADMIN na coluna `User.papel` e
    // VENDEDOR no vínculo, divergentes de propósito: se `usuarioAtual()` lesse
    // `User.papel` em vez de `Membership.papel`, o teste "retorna o usuário..."
    // pegaria isso (o papel devolvido seria ADMIN, não VENDEDOR). O Ciclo 1f
    // primeiro parou de escrever a coluna e depois a derrubou
    // (`20260821130000_derruba_user_papel_de_vez`): não existe mais coluna em
    // que divergir, e a `create` abaixo não menciona `papel`.
    //
    // A divergência não sumiu do projeto, mudou de endereço: vive em
    // `LINHA_HOSTIL`, em `tests/unit/usuario-ativo.test.ts`, que reintroduz um
    // papel divergente na linha FALSA de `User` (um dublê em memória, não uma
    // coluna) justamente para a regra de resolução pelo vínculo continuar
    // tendo o que contradizer. Aqui o vínculo é a única fonte, e é só o que os
    // testes abaixo veem.
    const ativo = await prisma.user.create({
      data: {
        nome: "Teste Fix1 Ativo",
        email: EMAIL_ATIVO,
        senhaHash: "hash-fake-nao-usado-em-login",
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
    //
    // `Notification` antes de tudo: a FK `Notification_userId_fkey` é
    // RESTRICT (não cascade), então uma linha sobrando trava o `deleteMany`
    // abaixo e o arquivo deixa usuários com e-mail fixo para trás — a
    // execução seguinte quebra no `beforeAll` por unicidade. Mesmo reparo de
    // `users-service.test.ts`, onde o estrago foi medido.
    await prisma.notification.deleteMany({
      where: { userId: { in: [idAtivo, idDesativado] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [idAtivo, idDesativado] } } });
    await prisma.company.delete({ where: { id: idEmpresa } });
  });

  it("retorna o usuário quando a sessão existe e o usuário está ativo, com o papel DO VÍNCULO", async () => {
    authMock.mockResolvedValueOnce({ user: { email: EMAIL_ATIVO } });

    const usuario = await usuarioAtual();

    expect(usuario.id).toBe(idAtivo);
    expect(usuario.ativo).toBe(true);
    expect(usuario.companyId).toBe(idEmpresa);
    // VENDEDOR é o papel do Membership, e desde o Ciclo 1f é a única origem
    // possível: este `User` não carrega mais papel nenhum. Esta asserção
    // deixou de DISCRIMINAR a origem quando a coluna espelho parou de ser
    // escrita (ver o comentário no `beforeAll`) — quem discrimina hoje é
    // `LINHA_HOSTIL`, em `tests/unit/usuario-ativo.test.ts`. O que ela ainda
    // prova é que o papel chega do vínculo, e não nulo nem inventado.
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
