// Usa o Prisma real contra o Postgres do Supabase — mesmo motivo de
// whatsapp-agente.test.ts: a prova de que `marcarAguardandoHumano` não
// duplica aviso sob concorrência depende de um UPDATE condicional de
// verdade contra o banco, não de um mock — carrega DATABASE_URL do .env
// aqui, mesmo padrão de rate-limit.test.ts.
import "dotenv/config";
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Importe `prisma` exatamente como `tests/unit/whatsapp-agente.test.ts` faz —
// leia aquele arquivo antes de escrever este. O `vi.mock("server-only")` acima
// precisa vir antes de qualquer import que alcance `src/lib/prisma.ts`, e é por
// isso que os imports aqui são dinâmicos.
const { prisma } = await import("@/lib/prisma");
const { criarConversation, limparConversasDeTeste } = await import("./helpers/whatsapp");
const { marcarAguardandoHumano, limparAguardandoHumano } = await import(
  "../../src/modules/whatsapp/notificacoes"
);
const { TIPO_CONVERSA_AGUARDANDO } = await import(
  "../../src/modules/whatsapp/notificacao-tipos"
);

async function notificacoesDaConversa(conversationId: string) {
  const todas = await prisma.notification.findMany({
    where: { tipo: TIPO_CONVERSA_AGUARDANDO },
  });
  return todas.filter(
    (n) => (n.payload as { conversationId?: string } | null)?.conversationId === conversationId
  );
}

describe("aviso de conversa aguardando humano", () => {
  afterEach(async () => {
    await prisma.notification.deleteMany({ where: { tipo: TIPO_CONVERSA_AGUARDANDO } });
    await limparConversasDeTeste();
  });

  it("marca a conversa e notifica todos os usuários ativos", async () => {
    const conversa = await criarConversation();
    const ganhou = await marcarAguardandoHumano(conversa.id);

    expect(ganhou).toBe(true);

    const depois = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });
    expect(depois.aguardandoHumanoDesde).toBeInstanceOf(Date);

    const ativos = await prisma.user.count({ where: { ativo: true } });
    expect(await notificacoesDaConversa(conversa.id)).toHaveLength(ativos);
  });

  // O comportamento que a fatia inteira existe para garantir: um cliente
  // ansioso mandando cinco mensagens não vira cinco avisos por pessoa.
  it("marcar de novo não cria segundo aviso", async () => {
    const conversa = await criarConversation();
    await marcarAguardandoHumano(conversa.id);
    const primeira = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });

    const ganhouDeNovo = await marcarAguardandoHumano(conversa.id);

    expect(ganhouDeNovo).toBe(false);
    const ativos = await prisma.user.count({ where: { ativo: true } });
    expect(await notificacoesDaConversa(conversa.id)).toHaveLength(ativos);

    // E não reescreve o instante: quem espera há mais tempo continua no topo.
    const depois = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });
    expect(depois.aguardandoHumanoDesde?.getTime()).toBe(primeira.aguardandoHumanoDesde?.getTime());
  });

  // Turnos concorrentes na mesma conversa são normais neste sistema — o lease
  // existe porque acontecem. Sem UPDATE condicional atômico, a equipe receberia
  // dois avisos da mesma conversa.
  it("duas marcações simultâneas produzem um aviso só", async () => {
    const conversa = await criarConversation();

    const resultados = await Promise.all([
      marcarAguardandoHumano(conversa.id),
      marcarAguardandoHumano(conversa.id),
      marcarAguardandoHumano(conversa.id),
    ]);

    expect(resultados.filter(Boolean)).toHaveLength(1);
    const ativos = await prisma.user.count({ where: { ativo: true } });
    expect(await notificacoesDaConversa(conversa.id)).toHaveLength(ativos);
  });

  it("não notifica usuário inativo — inclusive o usuário de sistema do WhatsApp", async () => {
    const conversa = await criarConversation();
    await marcarAguardandoHumano(conversa.id);

    const avisos = await notificacoesDaConversa(conversa.id);
    const usuarios = await prisma.user.findMany({
      where: { id: { in: avisos.map((a) => a.userId) } },
      select: { ativo: true },
    });
    expect(usuarios.every((u) => u.ativo)).toBe(true);
  });

  it("limpar zera o campo e deixa a conversa pronta para marcar de novo", async () => {
    const conversa = await criarConversation();
    await marcarAguardandoHumano(conversa.id);
    await limparAguardandoHumano(conversa.id);

    const depois = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });
    expect(depois.aguardandoHumanoDesde).toBeNull();

    // O ciclo fecha e reabre: o cliente voltou, ninguém respondeu, avisa de novo.
    expect(await marcarAguardandoHumano(conversa.id)).toBe(true);
  });
});
