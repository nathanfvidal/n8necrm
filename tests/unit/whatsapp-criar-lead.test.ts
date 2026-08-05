// Usa o Prisma real contra o Postgres do Supabase, mesmo padrão de
// dedupe.test.ts/lead-notes.test.ts. Prefixo "119711" é exclusivo deste
// arquivo — não colide com nenhuma família já reservada (119977 dedupe,
// 119888 stage-transition, 119555 lead-notes, 119666 notifications, 119444
// lead-creation-resilience, 1199999000{0-3} seed base, 119930* seed-demo).
import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import { criarLeadDeWhatsapp } from "../../src/core/leads/service";

const TELEFONE_TESTE = "11971110001";

describe(
  "criarLeadDeWhatsapp — plumbing sem chamador ainda (Fatia 1); prova que a função em si funciona, " +
    "para a Fatia 2 poder ligá-la a uma tela sem precisar debugar a base",
  () => {
    let adminId: string;
    let leadIdCriado: string | undefined;
    let contactIdCriado: string | undefined;

    beforeAll(async () => {
      const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@exemplo.com" } });
      adminId = admin.id;
    });

    afterAll(async () => {
      if (leadIdCriado) await prisma.lead.deleteMany({ where: { id: leadIdCriado } });
      if (contactIdCriado) await prisma.contact.deleteMany({ where: { id: contactIdCriado } });
      await prisma.auditLog.deleteMany({ where: { entidade: "Lead", entidadeId: leadIdCriado ?? "" } });
    });

    it("cria um Contact + Lead com canal WHATSAPP e registra AuditLog", async () => {
      const lead = await criarLeadDeWhatsapp({
        nome: "Cliente WhatsApp Teste",
        telefone: TELEFONE_TESTE,
        responsavelId: adminId,
        autorId: adminId,
      });
      leadIdCriado = lead.id;
      contactIdCriado = lead.contactId ?? undefined;

      expect(lead.canal).toBe("WHATSAPP");

      const contact = await prisma.contact.findUniqueOrThrow({ where: { id: lead.contactId! } });
      expect(contact.telefone).toBe(TELEFONE_TESTE);
      expect(contact.nome).toBe("Cliente WhatsApp Teste");

      const auditoria = await prisma.auditLog.findFirst({
        where: { entidade: "Lead", entidadeId: lead.id, acao: "criar_lead" },
      });
      expect(auditoria).not.toBeNull();
      expect(auditoria?.userId).toBe(adminId);
    });

    it("lança um erro claro quando responsavelId não corresponde a nenhum usuário", async () => {
      await expect(
        criarLeadDeWhatsapp({
          nome: "X",
          telefone: TELEFONE_TESTE,
          responsavelId: "usuario-inexistente-xyz",
          autorId: adminId,
        })
      ).rejects.toThrow(/Responsável não encontrado/);
    });
  }
);
