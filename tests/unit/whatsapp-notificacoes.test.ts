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
  // Ids das conversas que ESTE arquivo de teste criou, para escopar a limpeza
  // de notificações abaixo. Toda `it` cria sua conversa via este wrapper em
  // vez de chamar `criarConversation` direto, só para alimentar esta lista.
  const idsConversasDoTeste: string[] = [];

  async function criarConversaDeTeste(...args: Parameters<typeof criarConversation>) {
    const conversa = await criarConversation(...args);
    idsConversasDoTeste.push(conversa.id);
    return conversa;
  }

  afterEach(async () => {
    // Escopado às conversas que ESTE teste criou — NUNCA um `deleteMany` por
    // `tipo` sozinho. `Notification` não tem FK para `Conversation` (payload
    // é só um `conversationId` solto em JSON, mesmo formato de `NOVO_LEAD` —
    // ver `limparDemo` em prisma/seed-demo-limpar.ts para o mesmo problema
    // resolvido do mesmo jeito), então filtrar por `tipo` sozinho apagaria
    // todo aviso desse tipo no banco compartilhado. Isto NÃO é hipotético:
    // `turno.ts` e `agente.ts` já chamam `marcarAguardandoHumano` no fluxo
    // real de mensagens (Fatia 2, Task 2) — rodar esta suíte contra o banco
    // de dev com um `deleteMany` por `tipo` apagaria, agora, avisos
    // pendentes de conversas de clientes reais, e nada ligaria a causa
    // (rodar este teste) ao efeito (aviso sumido em outra tela).
    if (idsConversasDoTeste.length > 0) {
      const notificacoes = await prisma.notification.findMany({
        where: { tipo: TIPO_CONVERSA_AGUARDANDO },
      });
      const idsParaApagar = notificacoes
        .filter((n) =>
          idsConversasDoTeste.includes(
            (n.payload as { conversationId?: string } | null)?.conversationId ?? ""
          )
        )
        .map((n) => n.id);
      if (idsParaApagar.length > 0) {
        await prisma.notification.deleteMany({ where: { id: { in: idsParaApagar } } });
      }
      idsConversasDoTeste.length = 0;
    }
    await limparConversasDeTeste();
  });

  it("marca a conversa e notifica todos os usuários ativos", async () => {
    const conversa = await criarConversaDeTeste();
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
    const conversa = await criarConversaDeTeste();
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
    const conversa = await criarConversaDeTeste();

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
    const conversa = await criarConversaDeTeste();
    await marcarAguardandoHumano(conversa.id);

    const avisos = await notificacoesDaConversa(conversa.id);
    const usuarios = await prisma.user.findMany({
      where: { id: { in: avisos.map((a) => a.userId) } },
      select: { ativo: true },
    });
    expect(usuarios.every((u) => u.ativo)).toBe(true);
  });

  it("limpar zera o campo e deixa a conversa pronta para marcar de novo", async () => {
    const conversa = await criarConversaDeTeste();
    await marcarAguardandoHumano(conversa.id);
    await limparAguardandoHumano(conversa.id);

    const depois = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });
    expect(depois.aguardandoHumanoDesde).toBeNull();

    // O ciclo fecha e reabre: o cliente voltou, ninguém respondeu, avisa de novo.
    expect(await marcarAguardandoHumano(conversa.id)).toBe(true);
  });
});
