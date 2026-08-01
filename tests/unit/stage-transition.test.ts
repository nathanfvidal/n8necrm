// Este arquivo (junto com seed.test.ts, pipeline-stages.test.ts,
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
// vez). `src/lib/prisma.ts` ganhou `import "server-only"` na Task 17 (fix
// round 2/5), e este arquivo importa `prisma` direto — sem mockar aqui, TODO
// teste deste arquivo quebraria na importação, não por causa da lógica
// testada.
vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import { criarLead, moverEtapa } from "../../src/core/leads/service";

// Telefones JÁ NORMALIZADOS que este arquivo grava (o que `criarLead` →
// `encontrarOuCriarContact` efetivamente persiste em `Contact.telefone`).
// Prefixo "119888" é exclusivo deste arquivo: não colide com o seed da
// Task 9 (`1199999000{0..3}`), com dedupe.test.ts (família "119977") nem
// com seed.test.ts (prefixo "1199999"). A limpeza abaixo usa esta lista
// exata — o valor gravado, não o que foi digitado — pelo mesmo motivo
// documentado em dedupe.test.ts.
const TELEFONES_ARMAZENADOS_TESTE = [
  "11988887001",
  "11988887002",
  "11988887003",
  "11988887004",
];

async function limparDadosDeTeste() {
  const contatos = await prisma.contact.findMany({
    where: { telefone: { in: TELEFONES_ARMAZENADOS_TESTE } },
  });
  const contatoIds = contatos.map((c) => c.id);

  const leads = await prisma.lead.findMany({ where: { contactId: { in: contatoIds } } });
  const leadIds = leads.map((l) => l.id);

  // Task 19, fix round 1/5 (achado do revisor — CRITICAL): `criarLead`
  // (service.ts) agora chama `notificarNovoLead` internamente, que grava uma
  // `Notification` real para `autorId` (aqui, sempre o usuário ADMIN do
  // seed) a cada `it()` deste arquivo que cria um lead. Sem esta limpeza, o
  // sino de notificações do ADMIN real acumulava uma linha por execução da
  // suíte inteira, para sempre, no Postgres compartilhado — reproduzido pelo
  // revisor: uma única `vitest run` levou `Notification` de 0 a 5.
  // `Notification` não tem FK para `Lead` (payload é só um `leadId` solto em
  // JSON, ver `src/core/notifications/types.ts`), então filtramos em
  // memória pelo `leadId` gravado no payload, não por uma query relacional.
  const notificacoes = await prisma.notification.findMany({ where: { tipo: "NOVO_LEAD" } });
  const notificacaoIds = notificacoes
    .filter((n) => leadIds.includes((n.payload as { leadId?: string } | null)?.leadId ?? ""))
    .map((n) => n.id);
  if (notificacaoIds.length > 0) {
    await prisma.notification.deleteMany({ where: { id: { in: notificacaoIds } } });
  }

  // Ordem importa por causa das FKs: Notification (acima, sem FK real) →
  // AuditLog (referencia entidadeId por string, sem FK real, mas ainda é
  // dado de teste a limpar) → Lead → Contact.
  await prisma.auditLog.deleteMany({ where: { entidade: "Lead", entidadeId: { in: leadIds } } });
  await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  await prisma.contact.deleteMany({ where: { telefone: { in: TELEFONES_ARMAZENADOS_TESTE } } });
}

describe("movimentação de lead entre etapas", () => {
  let autorId: string;
  let etapaOrigemId: string;
  let etapaDestinoId: string;

  beforeAll(async () => {
    await limparDadosDeTeste();

    const usuario = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN" } });
    autorId = usuario.id;
    const etapas = await prisma.pipelineStage.findMany({ orderBy: { ordem: "asc" } });
    etapaOrigemId = etapas[0].id;
    etapaDestinoId = etapas[1].id;
  });

  afterAll(limparDadosDeTeste);

  it("cria o lead na primeira etapa do funil", async () => {
    const lead = await criarLead({
      nome: "Teste Transição",
      telefone: "11988887001",
      responsavelId: autorId,
      autorId,
    });
    expect(lead.stageId).toBe(etapaOrigemId);
  });

  it("move o lead para a nova etapa e atualiza ultimaInteracaoEm", async () => {
    const lead = await criarLead({
      nome: "Teste Transição 2",
      telefone: "11988887002",
      responsavelId: autorId,
      autorId,
    });

    const antes = lead.ultimaInteracaoEm;
    const movido = await moverEtapa({ leadId: lead.id, novaStageId: etapaDestinoId, autorId });

    expect(movido.stageId).toBe(etapaDestinoId);
    expect(movido.ultimaInteracaoEm.getTime()).toBeGreaterThanOrEqual(antes.getTime());
  });

  it("registra um AuditLog ao mover o lead", async () => {
    const lead = await criarLead({
      nome: "Teste Transição 3",
      telefone: "11988887003",
      responsavelId: autorId,
      autorId,
    });
    await moverEtapa({ leadId: lead.id, novaStageId: etapaDestinoId, autorId });

    const registros = await prisma.auditLog.findMany({
      where: { entidade: "Lead", entidadeId: lead.id, acao: "mover_etapa" },
    });
    expect(registros.length).toBe(1);
  });

  // --- criarLead: encontrarOuCriarContact (Task 12) agora normaliza e pode
  // rejeitar telefone inválido. Um lead não pode ser criado a partir de um
  // telefone que não é reconhecível como telefone brasileiro — ver
  // src/core/leads/dedupe.ts#normalizarTelefone.
  describe("criarLead - telefone inválido", () => {
    it("rejeita telefone que não é um número brasileiro reconhecível, sem criar lead nem contato", async () => {
      await expect(
        criarLead({
          nome: "Teste Telefone Inválido",
          telefone: "abc",
          responsavelId: autorId,
          autorId,
        })
      ).rejects.toThrow(/Telefone inválido/);

      const contatoCriado = await prisma.contact.findFirst({
        where: { nome: "Teste Telefone Inválido" },
      });
      expect(contatoCriado).toBeNull();
    });
  });

  // --- moverEtapa: novaStageId vem de um cliente HTTP não confiável (Server
  // Action pública). A FK de Lead.stageId barraria a escrita, mas só depois
  // de um erro cru do Postgres — moverEtapa precisa recusar antes disso, com
  // uma mensagem acionável, e sem alterar o lead.
  describe("moverEtapa - etapa inexistente", () => {
    it("recusa mover o lead para uma etapa que não existe, sem alterar o lead", async () => {
      const lead = await criarLead({
        nome: "Teste Etapa Inexistente",
        telefone: "11988887004",
        responsavelId: autorId,
        autorId,
      });

      await expect(
        moverEtapa({ leadId: lead.id, novaStageId: "etapa-que-nao-existe", autorId })
      ).rejects.toThrow(/[Ee]tapa/);

      const leadInalterado = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(leadInalterado.stageId).toBe(lead.stageId);
    });
  });
});
