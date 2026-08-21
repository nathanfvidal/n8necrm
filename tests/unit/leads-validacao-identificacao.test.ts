// Achado 18 da auditoria de 2026-08-21
// (`docs/auditorias/2026-08-21-fase1-seguranca-branch-tenancy.md`, "Validação e
// abuso"): `criarLead` repassava `nome` e `email` INTACTOS a
// `db.contact.create` (`core/leads/dedupe.ts`). Só `telefone` era normalizado.
// As regras existiam apenas no Zod de `components/leads/lead-form.tsx` — que é
// do CLIENTE, e Server Action é endpoint HTTP público. O teto de fato era o
// `bodySizeLimit` de 1 MB.
//
// Este arquivo prova as DUAS metades: a recusa acontece, e o caso legítimo
// continua passando. Sem a segunda, "recusar tudo" passaria como correção.
//
// Usa o Prisma real contra o Postgres, mesmo padrão de
// `lead-creation-resilience.test.ts`. Prefixo "119712" é exclusivo deste
// arquivo — nenhuma outra família de telefone da suíte o usa (as reservadas
// hoje: 119977 dedupe, 119888 stage-transition, 119555 lead-notes, 119666
// notifications, 119444 lead-creation-resilience, 119711 whatsapp-criar-lead,
// 1199999000{0-3} seed base, 119930* seed-demo).
import "dotenv/config";

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// "server-only" não resolve fora do pipeline do Next — sem este mock, a
// importação de `criarLead` (que alcança `src/lib/prisma.ts`) quebraria antes
// de qualquer asserção. Ver `tests/unit/storage.test.ts`, onde foi documentado.
vi.mock("server-only", () => ({}));

// Mocka só `notificarNovoLead`, pelo mesmo motivo de
// `lead-creation-resilience.test.ts`: o lead e a auditoria continuam usando o
// Prisma REAL, e não sobra `Notification` deste arquivo para limpar depois.
vi.mock("@/core/notifications/dispatch", () => ({
  notificarNovoLead: vi.fn(),
}));

import { prisma } from "../../src/lib/prisma";
import {
  criarLead,
  criarLeadDeWhatsapp,
  LeadInvalidoError,
} from "../../src/core/leads/service";
import { LIMITE_EMAIL, LIMITE_NOME } from "../../src/core/contacts/schema";
import { usuarioDoSeed } from "./helpers/usuarios-do-seed";

const TELEFONE_LEGITIMO = "11971120001";
const TELEFONE_RECUSADO = "11971120002";
const TELEFONES = [TELEFONE_LEGITIMO, TELEFONE_RECUSADO];

async function limpar() {
  const contatos = await prisma.contact.findMany({
    where: { telefone: { in: TELEFONES } },
    select: { id: true },
  });
  const leads = await prisma.lead.findMany({
    where: { contactId: { in: contatos.map((c) => c.id) } },
    select: { id: true },
  });

  // Ordem das FKs: `AuditLog` aponta para `Company`/`User` (não para `Lead`),
  // mas apagar a linha de auditoria antes do lead é o que mantém a limpeza
  // legível — e `Lead.contactId` é FK real, então o contato só pode sair
  // depois do lead.
  await prisma.auditLog.deleteMany({
    where: { entidade: "Lead", entidadeId: { in: leads.map((l) => l.id) } },
  });
  await prisma.lead.deleteMany({ where: { id: { in: leads.map((l) => l.id) } } });
  await prisma.contact.deleteMany({ where: { telefone: { in: TELEFONES } } });
}

describe("criarLead valida `nome` e `email` no SERVIDOR, como o caminho de contato", () => {
  let autor: { id: string; companyId: string };

  beforeAll(async () => {
    autor = await usuarioDoSeed("ADMIN");
    await limpar();
  });

  // `afterAll` e não `finally` por caso: `finally` NÃO roda quando o teste
  // estoura por timeout, e este arquivo compartilha o banco com a suíte
  // inteira — um contato órfão com telefone reservado faria o próximo caso
  // deste mesmo arquivo colidir na constraint UNIQUE.
  afterAll(async () => {
    await limpar();
  });

  // ─── A metade que RECUSA ────────────────────────────────────────────────

  it("recusa nome vazio com a MESMA mensagem do caminho de contato", async () => {
    await expect(
      criarLead({
        nome: "   ",
        telefone: TELEFONE_RECUSADO,
        responsavelId: autor.id,
        autorId: autor.id,
      })
    ).rejects.toThrow(LeadInvalidoError);

    // `rejects.toThrow()` SEM argumento aceitaria qualquer erro — inclusive um
    // erro de FK do Postgres, que é justamente o que a correção veio evitar.
    // A mensagem é a asserção que distingue recusa de acidente.
    await expect(
      criarLead({
        nome: "",
        telefone: TELEFONE_RECUSADO,
        responsavelId: autor.id,
        autorId: autor.id,
      })
    ).rejects.toThrow("O nome é obrigatório.");
  });

  it(`recusa nome acima de ${LIMITE_NOME} caracteres`, async () => {
    await expect(
      criarLead({
        nome: "a".repeat(LIMITE_NOME + 1),
        telefone: TELEFONE_RECUSADO,
        responsavelId: autor.id,
        autorId: autor.id,
      })
    ).rejects.toThrow(`O nome pode ter no máximo ${LIMITE_NOME} caracteres.`);

    // O limite é INCLUSIVO — exatamente no teto passa. Sem este caso, trocar
    // `>` por `>=` na regra não seria notado por ninguém.
    const noLimite = await criarLead({
      nome: "b".repeat(LIMITE_NOME),
      telefone: TELEFONE_LEGITIMO,
      responsavelId: autor.id,
      autorId: autor.id,
    });
    const contato = await prisma.contact.findUniqueOrThrow({
      where: { id: noLimite.contactId! },
    });
    expect(contato.nome).toHaveLength(LIMITE_NOME);

    await limpar();
  });

  it("recusa e-mail malformado e e-mail longo demais", async () => {
    await expect(
      criarLead({
        nome: "Fulano",
        telefone: TELEFONE_RECUSADO,
        email: "nao-e-email",
        responsavelId: autor.id,
        autorId: autor.id,
      })
    ).rejects.toThrow("E-mail inválido.");

    await expect(
      criarLead({
        nome: "Fulano",
        telefone: TELEFONE_RECUSADO,
        email: `${"a".repeat(LIMITE_EMAIL)}@exemplo.com`,
        responsavelId: autor.id,
        autorId: autor.id,
      })
    ).rejects.toThrow(`O e-mail pode ter no máximo ${LIMITE_EMAIL} caracteres.`);
  });

  it("a recusa acontece ANTES de tocar o banco — nenhum contato órfão fica para trás", async () => {
    // O valor prático da validação não é só a mensagem: é não gravar. Um
    // `Contact` criado e um `Lead` que falha depois deixariam a agenda com uma
    // pessoa que ninguém cadastrou.
    await expect(
      criarLead({
        nome: "c".repeat(LIMITE_NOME + 1),
        telefone: TELEFONE_RECUSADO,
        responsavelId: autor.id,
        autorId: autor.id,
      })
    ).rejects.toThrow(LeadInvalidoError);

    const orfao = await prisma.contact.findFirst({ where: { telefone: TELEFONE_RECUSADO } });
    expect(orfao).toBeNull();
  });

  // ─── A metade que PASSA ─────────────────────────────────────────────────

  it("o caso legítimo continua criando lead, contato e auditoria", async () => {
    const lead = await criarLead({
      nome: "  Cliente Legítimo  ",
      telefone: TELEFONE_LEGITIMO,
      email: "  Cliente@Exemplo.COM  ",
      responsavelId: autor.id,
      autorId: autor.id,
    });

    const contato = await prisma.contact.findUniqueOrThrow({ where: { id: lead.contactId! } });

    // Normalização, e não só aceitação: o `trim` do nome e o `toLowerCase` do
    // e-mail são as mesmas duas regras que `criarContato` já aplicava. Sem
    // elas, o mesmo e-mail escrito em duas caixas viraria dois valores na
    // coluna, e toda consulta futura precisaria lembrar dos dois.
    expect(contato.nome).toBe("Cliente Legítimo");
    expect(contato.email).toBe("cliente@exemplo.com");
    expect(contato.telefone).toBe(TELEFONE_LEGITIMO);
    expect(contato.companyId).toBe(autor.companyId);

    const auditoria = await prisma.auditLog.findFirst({
      where: { entidade: "Lead", entidadeId: lead.id, acao: "criar_lead" },
    });
    expect(auditoria).not.toBeNull();

    await limpar();
  });

  it("e-mail ausente continua virando `null`, não string vazia", async () => {
    // A regra que `checarEmail` herdou de `contacts/service.ts`: dois jeitos
    // de dizer "não tem" na mesma coluna é o começo de toda consulta errada.
    const lead = await criarLead({
      nome: "Sem E-mail",
      telefone: TELEFONE_LEGITIMO,
      email: "   ",
      responsavelId: autor.id,
      autorId: autor.id,
    });

    const contato = await prisma.contact.findUniqueOrThrow({ where: { id: lead.contactId! } });
    expect(contato.email).toBeNull();

    await limpar();
  });

  // ─── O caminho do WhatsApp, sem chamador hoje ───────────────────────────

  it("criarLeadDeWhatsapp recusa nome longo — o `pushName` vem de fora", async () => {
    // Achado menor do mesmo item: esta função não tem chamador nesta fatia, e
    // o `nome` que ela receberá vem do `pushName` do webhook da Evolution, ou
    // seja, é escolhido por quem manda a mensagem. Ligada sem esta trava, o
    // teto do nome de um contato seria decidido por um desconhecido.
    await expect(
      criarLeadDeWhatsapp({
        nome: "d".repeat(LIMITE_NOME + 1),
        telefone: TELEFONE_RECUSADO,
        responsavelId: autor.id,
        autorId: autor.id,
      })
    ).rejects.toThrow(`O nome pode ter no máximo ${LIMITE_NOME} caracteres.`);

    expect(await prisma.contact.findFirst({ where: { telefone: TELEFONE_RECUSADO } })).toBeNull();
  });

  it("criarLeadDeWhatsapp continua criando o lead com nome aceitável", async () => {
    const lead = await criarLeadDeWhatsapp({
      nome: "  Cliente do Zap  ",
      telefone: TELEFONE_LEGITIMO,
      responsavelId: autor.id,
      autorId: autor.id,
    });

    expect(lead.canal).toBe("WHATSAPP");
    const contato = await prisma.contact.findUniqueOrThrow({ where: { id: lead.contactId! } });
    expect(contato.nome).toBe("Cliente do Zap");

    await limpar();
  });
});
