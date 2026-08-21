// Este arquivo (junto com dedupe.test.ts, stage-transition.test.ts,
// lead-queries.test.ts, lead-notes.test.ts, seed.test.ts, pipeline-stages.test.ts,
// rate-limit.test.ts e audit-log.test.ts) usa o Prisma real contra o
// Postgres do Supabase, então carrega DATABASE_URL do .env aqui — não em
// vitest.config.ts — para não injetar credenciais em testes que não tocam
// banco. Precisa ser o primeiro import: os módulos abaixo (via
// src/lib/prisma.ts → src/lib/env.ts) leem process.env.DATABASE_URL no
// top-level.
import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server" que o Next.js aplica no build — fora desse pipeline (aqui,
// sob Vitest) ele sempre lança, independente de quem importa (ver
// tests/unit/storage.test.ts, onde este mock foi documentado pela primeira
// vez). `src/core/notifications/dispatch.ts`, `src/core/leads/notes.ts` e
// `src/lib/prisma.ts` têm `import "server-only"`, e este arquivo importa os
// três (via `criarLead`/`dispatch.ts`) direta ou indiretamente — sem mockar
// aqui, TODO teste deste arquivo quebraria na importação, não por causa da
// lógica testada.
vi.mock("server-only", () => ({}));

// RESEND_API_KEY não existe no .env deste projeto (decisão deliberada da
// Task 19 — não há conta Resend real disponível). `dispatch.ts` lê essa
// variável no top-level (`const resend = process.env.RESEND_API_KEY ? ... :
// null`) para decidir se tenta enviar e-mail — com ela ausente, `resend` é
// `null` e este arquivo só exercita o caminho de notificação in-app, que é
// o que os asserts abaixo checam. O caminho "Resend configurado mas a
// chamada falha" é coberto separadamente, com Prisma e Resend mockados
// (ver tests/unit/notification-email-resilience.test.ts) — não dá para
// testar aqui sem uma chave real.

import { prisma } from "../../src/lib/prisma";
import { criarLead } from "../../src/core/leads/service";
import {
  notificarNovoLead,
  listarNotificacoesNaoLidas,
  marcarComoLida,
} from "../../src/core/notifications/dispatch";
import { extrairPayloadNovoLead } from "../../src/core/notifications/types";

// Telefone JÁ NORMALIZADO que este arquivo grava. Prefixo "119666" é
// exclusivo deste arquivo — não colide com o seed da Task 9
// (`1199999000{0..3}`), dedupe.test.ts ("119977"), lead-notes.test.ts
// ("119555"), stage-transition.test.ts ("119888") nem lead-actions.test.ts
// (mockado, sem tocar banco).
const TELEFONE_TESTE = "11966660001";

async function limparDadosDeTeste() {
  // `findFirst`, e nao `findUnique`: desde o Ciclo 1e a chave unica de
  // `Contact` e `@@unique([companyId, telefone])` e o telefone sozinho deixou
  // de existir em `ContactWhereUniqueInput`. Uma linha so continua sendo o
  // esperado aqui — este arquivo reserva uma familia de telefone propria (ver
  // o bloco acima) e todos os casos gravam na mesma empresa.
  const contato = await prisma.contact.findFirst({ where: { telefone: TELEFONE_TESTE } });
  if (!contato) return;

  const leads = await prisma.lead.findMany({ where: { contactId: contato.id } });
  const leadIds = leads.map((l) => l.id);

  // `Notification` não tem FK para `Lead` (payload é só um `leadId` solto em
  // JSON, ver comentário em `notifications/types.ts`), então não dá para
  // filtrar por `leadId` diretamente na query — filtramos em memória entre
  // as notificações do tipo que este arquivo cria e o conjunto de `leadId`s
  // que ele mesmo gerou.
  const todasNotificacoes = await prisma.notification.findMany({ where: { tipo: "NOVO_LEAD" } });
  const idsParaApagar = todasNotificacoes
    .filter((n) => {
      const payload = extrairPayloadNovoLead(n.payload);
      return payload !== null && leadIds.includes(payload.leadId);
    })
    .map((n) => n.id);
  if (idsParaApagar.length > 0) {
    await prisma.notification.deleteMany({ where: { id: { in: idsParaApagar } } });
  }

  await prisma.auditLog.deleteMany({ where: { entidade: "Lead", entidadeId: { in: leadIds } } });
  await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  await prisma.contact.deleteMany({ where: { telefone: TELEFONE_TESTE } });
}

describe("notificações", () => {
  let adminId: string;
  let vendedorId: string;
  let leadId: string;
  // As quatro funcoes publicas de `dispatch.ts` passaram a receber `companyId`
  // no Ciclo 1d. Em producao ele vem de `usuarioAtual().companyId`; aqui, do
  // proprio lead que a fixture cria.
  let companyId: string;

  beforeAll(async () => {
    await limparDadosDeTeste();

    const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN", ativo: true } });
    adminId = admin.id;
    const vendedor = await prisma.user.findFirstOrThrow({ where: { papel: "VENDEDOR", ativo: true } });
    vendedorId = vendedor.id;

    // `criarLead` (leads/service.ts) já chama `notificarNovoLead` internamente
    // desde a Task 19 — este `beforeAll`, sozinho, já prova a integração do
    // fluxo principal (o teste abaixo só confirma o resultado).
    const lead = await criarLead({
      nome: "Teste Notificação",
      telefone: TELEFONE_TESTE,
      responsavelId: adminId,
      autorId: adminId,
    });
    leadId = lead.id;
    companyId = lead.companyId;
  });

  afterAll(limparDadosDeTeste);

  it("criarLead notifica automaticamente o responsável, sem precisar chamar notificarNovoLead manualmente", async () => {
    const naoLidas = await listarNotificacoesNaoLidas(companyId, adminId);
    const notificacaoDoLead = naoLidas.find((n) => extrairPayloadNovoLead(n.payload)?.leadId === leadId);

    expect(notificacaoDoLead).toBeTruthy();
    expect(notificacaoDoLead?.tipo).toBe("NOVO_LEAD");
    expect(extrairPayloadNovoLead(notificacaoDoLead!.payload)?.contatoNome).toBe("Teste Notificação");
  });

  it("cria uma notificação in-app ao notificar novo lead explicitamente", async () => {
    await notificarNovoLead(companyId, leadId);
    const naoLidas = await listarNotificacoesNaoLidas(companyId, adminId);
    expect(naoLidas.some((n) => extrairPayloadNovoLead(n.payload)?.leadId === leadId)).toBe(true);
  });

  it("listarNotificacoesNaoLidas é escopada por usuário: não vaza notificação de outro responsável", async () => {
    const naoLidasDoVendedor = await listarNotificacoesNaoLidas(companyId, vendedorId);
    expect(naoLidasDoVendedor.some((n) => extrairPayloadNovoLead(n.payload)?.leadId === leadId)).toBe(false);
  });

  it("marca notificação como lida e ela some da lista de não lidas", async () => {
    await notificarNovoLead(companyId, leadId);
    const naoLidas = await listarNotificacoesNaoLidas(companyId, adminId);
    const notificacao = naoLidas[0];

    await marcarComoLida({ companyId, notificationId: notificacao.id, userId: adminId });

    const atualizadas = await listarNotificacoesNaoLidas(companyId, adminId);
    expect(atualizadas.find((n) => n.id === notificacao.id)).toBeUndefined();
  });

  it(
    "marcarComoLida rejeita quando o id não pertence ao usuário informado (checagem de dono, " +
      "mesmo padrão de concluirTask) — e a notificação continua não lida para o dono de verdade",
    async () => {
      await notificarNovoLead(companyId, leadId);
      const naoLidasAntes = await listarNotificacoesNaoLidas(companyId, adminId);
      const notificacaoDoAdmin = naoLidasAntes.find(
        (n) => extrairPayloadNovoLead(n.payload)?.leadId === leadId
      )!;

      await expect(
        marcarComoLida({ companyId, notificationId: notificacaoDoAdmin.id, userId: vendedorId })
      ).rejects.toThrow("Notificação não encontrada");

      const naoLidasDepois = await listarNotificacoesNaoLidas(companyId, adminId);
      expect(naoLidasDepois.some((n) => n.id === notificacaoDoAdmin.id)).toBe(true);
    }
  );

  it("marcarComoLida rejeita um id inexistente com a MESMA mensagem (não revela se o id existe)", async () => {
    await expect(
      marcarComoLida({ companyId, notificationId: "id-que-nao-existe", userId: adminId })
    ).rejects.toThrow("Notificação não encontrada");
  });
});
