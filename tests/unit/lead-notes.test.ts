// Este arquivo (junto com dedupe.test.ts, stage-transition.test.ts,
// lead-queries.test.ts, seed.test.ts, pipeline-stages.test.ts,
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
// vez). `src/core/leads/notes.ts` e `src/lib/prisma.ts` ganharam
// `import "server-only"` na Task 17 (fix round 2/5), e este arquivo importa
// os dois diretamente — sem mockar aqui, TODO teste deste arquivo quebraria
// na importação, não por causa da lógica testada.
vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import { adicionarNota, listarNotas } from "../../src/core/leads/notes";
import { criarLead } from "../../src/core/leads/service";

// Telefone JÁ NORMALIZADO que este arquivo grava (o que `criarLead` →
// `encontrarOuCriarContact` efetivamente persiste em `Contact.telefone`).
// Prefixo "119555" é exclusivo deste arquivo: não colide com o seed da
// Task 9 (`1199999000{0..3}`), dedupe.test.ts (família "119977"),
// seed.test.ts (prefixo "1199999") nem stage-transition.test.ts (família
// "119888") — mesma preocupação de isolamento documentada nesses arquivos.
const TELEFONE_TESTE = "11955556001";

async function limparDadosDeTeste() {
  const contato = await prisma.contact.findUnique({ where: { telefone: TELEFONE_TESTE } });
  if (!contato) return;

  const leads = await prisma.lead.findMany({ where: { contactId: contato.id } });
  const leadIds = leads.map((l) => l.id);

  // Task 19, fix round 1/5 (achado do revisor — CRITICAL): `criarLead`
  // (service.ts) agora chama `notificarNovoLead` internamente, que grava uma
  // `Notification` real para `autorId` (aqui, sempre o usuário ADMIN do
  // seed) toda vez que `beforeAll` cria o lead deste arquivo. Sem esta
  // limpeza, o sino de notificações do ADMIN real acumulava uma linha por
  // execução da suíte inteira, para sempre, no Postgres compartilhado —
  // reproduzido pelo revisor: uma única `vitest run` levou `Notification` de
  // 0 a 5 (este arquivo + stage-transition.test.ts). `Notification` não tem
  // FK para `Lead` (payload é só um `leadId` solto em JSON, ver
  // `src/core/notifications/types.ts`), então filtramos em memória pelo
  // `leadId` gravado no payload, não por uma query relacional.
  const notificacoes = await prisma.notification.findMany({ where: { tipo: "NOVO_LEAD" } });
  const notificacaoIds = notificacoes
    .filter((n) => leadIds.includes((n.payload as { leadId?: string } | null)?.leadId ?? ""))
    .map((n) => n.id);
  if (notificacaoIds.length > 0) {
    await prisma.notification.deleteMany({ where: { id: { in: notificacaoIds } } });
  }

  // Ordem importa por causa das FKs: Notification (acima, sem FK real) →
  // AuditLog (entidadeId por string, sem FK real, mas ainda é dado de teste
  // a limpar) → Lead (LeadNote cai junto via onDelete: Cascade no schema,
  // sem precisar de deleteMany separado) → Contact.
  await prisma.auditLog.deleteMany({ where: { entidade: "Lead", entidadeId: { in: leadIds } } });
  await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  await prisma.contact.deleteMany({ where: { telefone: TELEFONE_TESTE } });
}

describe("notas de lead", () => {
  let usuarioId: string;
  let leadId: string;

  beforeAll(async () => {
    await limparDadosDeTeste();

    const usuario = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN", ativo: true } });
    usuarioId = usuario.id;
    const lead = await criarLead({
      nome: "Teste Notas",
      telefone: TELEFONE_TESTE,
      responsavelId: usuarioId,
      autorId: usuarioId,
    });
    leadId = lead.id;
  });

  afterAll(limparDadosDeTeste);

  it("adiciona uma nota ao lead", async () => {
    const nota = await adicionarNota({ leadId, autorId: usuarioId, texto: "Cliente ligou de volta" });
    expect(nota.texto).toBe("Cliente ligou de volta");
    expect(nota.leadId).toBe(leadId);
    expect(nota.autorId).toBe(usuarioId);
  });

  it("lista as notas em ordem cronológica reversa", async () => {
    await adicionarNota({ leadId, autorId: usuarioId, texto: "Primeira" });
    await adicionarNota({ leadId, autorId: usuarioId, texto: "Segunda" });
    const notas = await listarNotas(leadId);
    expect(notas[0].texto).toBe("Segunda");
  });

  it("lista as notas com o autor incluído — a página de detalhe mostra quem escreveu", async () => {
    await adicionarNota({ leadId, autorId: usuarioId, texto: "Nota com autor" });
    const notas = await listarNotas(leadId);
    expect(notas[0].autor).toBeTruthy();
    expect(notas[0].autor.id).toBe(usuarioId);
  });

  it("apara espaço nas pontas do texto antes de gravar", async () => {
    const nota = await adicionarNota({ leadId, autorId: usuarioId, texto: "  com espaço nas pontas  " });
    expect(nota.texto).toBe("com espaço nas pontas");
  });

  it("preserva quebra de linha NO MEIO do texto (só apara as pontas)", async () => {
    const nota = await adicionarNota({
      leadId,
      autorId: usuarioId,
      texto: "\n  Primeira linha\nSegunda linha  \n",
    });
    expect(nota.texto).toBe("Primeira linha\nSegunda linha");
  });

  it("rejeita texto vazio, sem gravar nada", async () => {
    await expect(adicionarNota({ leadId, autorId: usuarioId, texto: "" })).rejects.toThrow(/vazia/i);
  });

  it("rejeita texto só de espaço em branco", async () => {
    await expect(adicionarNota({ leadId, autorId: usuarioId, texto: "   \n\t  " })).rejects.toThrow(/vazia/i);
  });

  it("rejeita texto acima do limite de tamanho", async () => {
    const textoGigante = "a".repeat(4001);
    await expect(adicionarNota({ leadId, autorId: usuarioId, texto: textoGigante })).rejects.toThrow(/longa/i);
  });

  it("aceita texto exatamente no limite de tamanho", async () => {
    const textoNoLimite = "a".repeat(4000);
    const nota = await adicionarNota({ leadId, autorId: usuarioId, texto: textoNoLimite });
    expect(nota.texto.length).toBe(4000);
  });
});
