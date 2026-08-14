// Este arquivo (junto com pipeline-stages.test.ts, rate-limit.test.ts e
// audit-log.test.ts) usa o Prisma real contra o Postgres do Supabase, então
// carrega DATABASE_URL do .env aqui — não em vitest.config.ts — para não
// injetar credenciais em testes que não tocam banco. Precisa ser o primeiro
// import: os módulos abaixo (via src/lib/prisma.ts → src/lib/env.ts) leem
// process.env.DATABASE_URL no top-level.
import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server" que o Next.js aplica no build — fora desse pipeline (aqui,
// sob Vitest) ele sempre lança, independente de quem importa (ver
// tests/unit/storage.test.ts, onde este mock foi documentado pela primeira
// vez). `src/lib/prisma.ts` ganhou `import "server-only"` na Task 17 (fix
// round 2/5), e `seed()`/este arquivo importam `prisma` — sem mockar aqui,
// TODO teste deste arquivo quebraria na importação, não por causa da lógica
// testada.
vi.mock("server-only", () => ({}));

import bcrypt from "bcryptjs";
import { prisma } from "../../src/lib/prisma";
import { seed, WHATSAPP_SYSTEM_USER_ID } from "../../prisma/seed";

// `auth()` (Auth.js) depende de contexto de requisição HTTP real — mockamos
// só esse ponto de entrada, mesmo padrão de tests/unit/session.test.ts, para
// provar que `usuarioAtual()` recusa o usuário sistema do WhatsApp de
// verdade (consultando `ativo` no Postgres real), não por suposição.
const authMock = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));
const { usuarioAtual } = await import("../../src/core/auth/session");

const EMAILS_SEED = ["admin@exemplo.com", "vendedor@exemplo.com"];
const TELEFONE_PREFIXO_SEED = "1199999000";

async function contarLinhasDoSeed() {
  return {
    stages: await prisma.pipelineStage.count(),
    users: await prisma.user.count({ where: { email: { in: EMAILS_SEED } } }),
    contacts: await prisma.contact.count({ where: { telefone: { startsWith: TELEFONE_PREFIXO_SEED } } }),
    leads: await prisma.lead.count({ where: { contact: { telefone: { startsWith: TELEFONE_PREFIXO_SEED } } } }),
  };
}

describe("prisma/seed.ts", () => {
  it(
    "é idempotente: rodar duas vezes seguidas não duplica PipelineStage, User, Contact nem Lead, e não lança " +
      "(Lead.stageId é ON DELETE RESTRICT — um deleteMany() ingênuo em PipelineStage quebraria na 2ª execução)",
    async () => {
      await seed();
      const contagemAposPrimeiraExecucao = await contarLinhasDoSeed();

      await expect(seed()).resolves.toBeUndefined();
      const contagemAposSegundaExecucao = await contarLinhasDoSeed();

      // NÃO `client.funil.length`: desde o CRUD de etapas o banco pode
      // legitimamente ter 6, 3 ou 40 etapas, criadas pela tela. O que este
      // teste prova é que rodar o seed duas vezes NÃO DUPLICA — não que o
      // funil tem o tamanho do config.
      expect(contagemAposSegundaExecucao).toEqual(contagemAposPrimeiraExecucao);
      expect(contagemAposSegundaExecucao.stages).toBeGreaterThanOrEqual(1);
      expect(contagemAposSegundaExecucao.users).toBe(2);
      expect(contagemAposSegundaExecucao.contacts).toBe(4);
      expect(contagemAposSegundaExecucao.leads).toBe(4);
    },
    // seed() faz ~20 round-trips sequenciais contra o Postgres real do
    // Supabase, e este teste chama seed() duas vezes — o timeout padrão do
    // Vitest (5000ms) não sobra folga pra latência de rede.
    20_000
  );

  describe("contrato ehGanho (Task 20 calcula a taxa de conversão a partir exatamente dessa flag)", () => {
    beforeAll(seed);

    it("marca exatamente UMA etapa como ehGanho — e nenhuma outra", async () => {
      const etapas = await prisma.pipelineStage.findMany({ orderBy: { ordem: "asc" } });
      const marcadasComoGanho = etapas.filter((etapa) => etapa.ehGanho);

      expect(marcadasComoGanho).toHaveLength(1);
      // As asserções `.ordem === client.funil.length - 1` e `.nome ===
      // client.funil[length - 1]` saíram: a etapa de fechamento passou a ser
      // escolhida na tela e pode estar em QUALQUER posição, com qualquer nome.
      // Criar "Negociação" no fim e marcá-la como fechamento é o caso de uso
      // central do CRUD de etapas, e derrubaria as duas.
    });

    it("nenhuma etapa é marcada como ehPerdido pelo seed", async () => {
      const etapas = await prisma.pipelineStage.findMany();
      expect(etapas.every((etapa) => etapa.ehPerdido === false)).toBe(true);
    });
  });

  describe("senha semeada (Task 22 faz login end-to-end com essas credenciais)", () => {
    beforeAll(seed);

    it.each(EMAILS_SEED)("o hash gravado para %s verifica com a senha em texto plano 'senha123'", async (email) => {
      const usuario = await prisma.user.findUniqueOrThrow({ where: { email } });
      const senhaValida = await bcrypt.compare("senha123", usuario.senhaHash);
      expect(senhaValida).toBe(true);
    });

    it("o hash gravado não é a senha em texto plano nem um valor vazio", async () => {
      const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@exemplo.com" } });
      expect(admin.senhaHash).not.toBe("senha123");
      expect(admin.senhaHash.length).toBeGreaterThan(0);
    });
  });

  describe(
    "usuário sistema do WhatsApp (Fatia 1: ator de AuditLog para respostas geradas pela IA)",
    () => {
      beforeAll(seed);

      it("semeia o usuário sistema com id estável, ativo: false e papel ADMIN", async () => {
        const usuario = await prisma.user.findUniqueOrThrow({ where: { id: WHATSAPP_SYSTEM_USER_ID } });
        expect(usuario.ativo).toBe(false);
        expect(usuario.papel).toBe("ADMIN");
        expect(usuario.email).toBe("whatsapp-bot@sistema.invalid");
      });

      it("é idempotente: rodar o seed de novo não regrava o usuário sistema (mesmo senhaHash)", async () => {
        const antes = await prisma.user.findUniqueOrThrow({ where: { id: WHATSAPP_SYSTEM_USER_ID } });
        await seed();
        const depois = await prisma.user.findUniqueOrThrow({ where: { id: WHATSAPP_SYSTEM_USER_ID } });
        expect(depois.senhaHash).toBe(antes.senhaHash);
      });

      it("a senha gravada não é um valor conhecido — não verifica com nenhuma senha usada em outro lugar do seed", async () => {
        const usuario = await prisma.user.findUniqueOrThrow({ where: { id: WHATSAPP_SYSTEM_USER_ID } });
        expect(await bcrypt.compare("senha123", usuario.senhaHash)).toBe(false);
        expect(await bcrypt.compare("", usuario.senhaHash)).toBe(false);
      });

      it(
        "usuarioAtual() rejeita o usuário sistema exatamente como rejeita qualquer usuário ativo: false " +
          "— ele nunca consegue manter uma sessão, mesmo que alguém descubra o e-mail",
        async () => {
          const usuario = await prisma.user.findUniqueOrThrow({ where: { id: WHATSAPP_SYSTEM_USER_ID } });
          authMock.mockResolvedValueOnce({ user: { email: usuario.email } });

          await expect(usuarioAtual()).rejects.toThrow("Não autenticado");
        }
      );
    }
  );

  describe(
    "SEED_PASSWORD rotaciona a senha existente (fix round 1/5 — reprodução do achado do revisor: " +
      "definir SEED_PASSWORD depois do primeiro seed não tinha efeito nenhum, porque update: {} nunca " +
      "regravava senhaHash — admin@exemplo.com/senha123 continuava válido pra sempre, dando falsa " +
      "confiança de que a senha tinha sido trocada)",
    () => {
      const SENHA_ORIGINAL = "senha123";
      const SENHA_NOVA = "outraSenhaDeTeste789";

      afterAll(async () => {
        // Restaura a senha original explicitamente — sem isso, o resto da
        // suíte (e a Task 22, que faz login e2e com admin@exemplo.com /
        // senha123) ficaria com a senha rotacionada por este teste.
        process.env.SEED_PASSWORD = SENHA_ORIGINAL;
        await seed();
        delete process.env.SEED_PASSWORD;
      });

      it(
        "sem SEED_PASSWORD definida, reexecutar o seed não altera um senhaHash já existente",
        async () => {
          await seed();
          const antes = await prisma.user.findUniqueOrThrow({ where: { email: "admin@exemplo.com" } });

          await seed();
          const depois = await prisma.user.findUniqueOrThrow({ where: { email: "admin@exemplo.com" } });

          expect(depois.senhaHash).toBe(antes.senhaHash);
        },
        // duas chamadas a seed() (cada uma faz bcrypt.hash + ~20 round-trips
        // contra o Postgres real) não cabem no timeout padrão de 5000ms.
        20_000
      );

      it(
        "com SEED_PASSWORD definida, reexecutar o seed troca o hash e invalida a senha antiga para admin e vendedor",
        async () => {
          await seed();
          const adminAntes = await prisma.user.findUniqueOrThrow({ where: { email: "admin@exemplo.com" } });
          expect(await bcrypt.compare(SENHA_ORIGINAL, adminAntes.senhaHash)).toBe(true);

          process.env.SEED_PASSWORD = SENHA_NOVA;
          await seed();
          delete process.env.SEED_PASSWORD;

          const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@exemplo.com" } });
          const vendedor = await prisma.user.findUniqueOrThrow({ where: { email: "vendedor@exemplo.com" } });

          expect(await bcrypt.compare(SENHA_ORIGINAL, admin.senhaHash)).toBe(false);
          expect(await bcrypt.compare(SENHA_NOVA, admin.senhaHash)).toBe(true);
          expect(await bcrypt.compare(SENHA_ORIGINAL, vendedor.senhaHash)).toBe(false);
          expect(await bcrypt.compare(SENHA_NOVA, vendedor.senhaHash)).toBe(true);
        },
        // três chamadas a seed() nesta única prova (baseline + rotação) —
        // mesmo motivo do timeout acima.
        20_000
      );
    }
  );
});
