// Este arquivo (e apenas ele, junto com rate-limit.test.ts) usa o Prisma
// real contra o Postgres do Supabase, então carrega DATABASE_URL do .env
// aqui — não em vitest.config.ts — para não injetar credenciais
// (AUTH_SECRET, SUPABASE_SERVICE_ROLE_KEY, ...) em arquivos de teste que não
// tocam banco. Precisa ser o primeiro import: os módulos abaixo (via
// src/lib/prisma.ts → src/lib/env.ts) leem process.env.DATABASE_URL no
// top-level.
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
import { Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { registrarAuditoria } from "../../src/core/audit/log";

// AuditLog.userId é FK obrigatória para User — precisamos de um usuário real
// no Postgres. Criamos um usuário com prefixo "teste-" e removemos, junto
// com os AuditLogs que apontam para ele, no afterAll (a FK é RESTRICT por
// padrão: apagar o usuário antes dos logs falharia).
describe("registrarAuditoria", () => {
  let userId: string;
  let companyId: string;

  // O vínculo continua na fixture, mas o que o exige mudou no Ciclo 1d:
  // `registrarAuditoria` deixou de DEDUZIR a empresa de `companyIdDoUsuario(
  // userId)` e passou a recebê-la em `ParamsDeAuditoria.companyId`. Quem lê
  // `Membership` agora é só a busca de destinatários do alerta de rajada
  // (`core/audit/alerta.ts`), que roda depois da gravação.
  //
  // A empresa é criada aqui, e não reaproveitada do seed, para o teste não
  // depender do que já está no banco de desenvolvimento compartilhado: o
  // `afterAll` apaga exatamente o que este arquivo criou.
  beforeAll(async () => {
    const empresa = await prisma.company.create({
      data: { nome: "Empresa de teste (audit log)" },
    });
    companyId = empresa.id;

    const usuario = await prisma.user.create({
      data: {
        nome: "Usuário de teste (audit log)",
        email: "teste-audit-log@teste.local",
        senhaHash: "hash-fake-nao-usado-em-login",
        papel: "VENDEDOR",
        memberships: { create: { companyId, papel: "VENDEDOR" } },
      },
    });
    userId = usuario.id;
  });

  // Ordem obrigatória: as linhas de auditoria e as notificações referenciam o
  // usuário e a empresa, e o vínculo referencia os dois. Apagar a empresa
  // primeiro esbarraria em chave estrangeira.
  //
  // `Notification` está aqui pelo mesmo motivo de `users-service.test.ts`:
  // `Notification.userId` é RESTRICT, e uma única linha sobrando trava o
  // `delete` do usuário — o arquivo deixa usuário e empresa para trás no
  // banco compartilhado, e a execução seguinte quebra no `beforeAll` por
  // e-mail duplicado (`teste-audit-log@teste.local` é fixo).
  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.company.delete({ where: { id: companyId } });
  });

  it("grava antes/depois e permite ler de volta os valores gravados", async () => {
    await registrarAuditoria({
      companyId,
      userId,
      acao: "criar_lead",
      entidade: "Lead",
      entidadeId: "teste-lead-1",
      depois: { nome: "Fulano de Tal", ativo: true, tags: ["a", "b"] },
      ip: "127.0.0.1",
    });

    const registro = await prisma.auditLog.findFirst({
      where: { userId, entidadeId: "teste-lead-1" },
      orderBy: { criadoEm: "desc" },
    });

    expect(registro).not.toBeNull();
    expect(registro?.acao).toBe("criar_lead");
    expect(registro?.entidade).toBe("Lead");
    expect(registro?.antes).toBeNull();
    expect(registro?.depois).toEqual({ nome: "Fulano de Tal", ativo: true, tags: ["a", "b"] });
    expect(registro?.ip).toBe("127.0.0.1");
  });

  it("coage Date para string ISO e Decimal do Prisma para string, e descarta campos undefined", async () => {
    const dataCriacao = new Date("2026-01-15T10:00:00.000Z");
    const leadFalso = {
      id: "teste-lead-2",
      valorEstimado: new Prisma.Decimal("1500.75"),
      criadoEm: dataCriacao,
      utm: null,
      contactId: undefined, // campo opcional ausente no objeto real do Lead
    };

    await registrarAuditoria({
      companyId,
      userId,
      acao: "mover_estagio",
      entidade: "Lead",
      entidadeId: "teste-lead-2",
      depois: leadFalso,
    });

    const registro = await prisma.auditLog.findFirst({
      where: { userId, entidadeId: "teste-lead-2" },
      orderBy: { criadoEm: "desc" },
    });

    const depois = registro?.depois as Record<string, unknown>;
    expect(depois.valorEstimado).toBe("1500.75");
    expect(depois.criadoEm).toBe("2026-01-15T10:00:00.000Z");
    expect(depois.utm).toBeNull();
    expect("contactId" in depois).toBe(false);
  });
});
