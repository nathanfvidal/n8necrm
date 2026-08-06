// Usa o Prisma real contra o Postgres do Supabase (para provar a transação
// e a corrida de idExterno de verdade, não com um mock) — carrega
// DATABASE_URL do .env aqui, mesmo padrão de dedupe.test.ts/rate-limit.test.ts.
import "dotenv/config";

import { describe, it, expect, afterEach, afterAll, vi } from "vitest";

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server" que o Next.js aplica no build — fora desse pipeline (aqui,
// sob Vitest) ele sempre lança. src/lib/prisma.ts, ingest.ts e
// gateway/tipos.ts (transitivamente, via type-only import) precisam disto
// mockado antes de qualquer import real acontecer.
vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import { ingerirMensagem } from "../../src/modules/whatsapp/ingest";
import type { EventoWhatsapp } from "../../src/modules/whatsapp/gateway/tipos";

// Prefixo exclusivo deste arquivo, tanto para waId (Conversation) quanto
// para idExterno (WhatsappMessage) — nunca um deleteMany() sem esse filtro,
// mesma preocupação documentada em dedupe.test.ts/rate-limit.test.ts (banco
// compartilhado, incidentes de vazamento já aconteceram).
const PREFIXO = "teste-ingest-";

function evento(overrides: Partial<EventoWhatsapp> = {}): EventoWhatsapp {
  return {
    idExterno: `${PREFIXO}msg-${crypto.randomUUID()}`,
    waId: `${PREFIXO}5511999990001`,
    nomeExibicao: "Cliente Teste",
    tipo: "TEXTO",
    texto: "Olá, tudo bem?",
    timestamp: new Date(),
    ...overrides,
  };
}

async function limparDadosDeTeste() {
  const conversas = await prisma.conversation.findMany({
    where: { waId: { startsWith: PREFIXO } },
    select: { id: true },
  });
  const conversationIds = conversas.map((c) => c.id);

  if (conversationIds.length > 0) {
    // WhatsappMessage.conversationId tem onDelete: Cascade, mas apagamos
    // explicitamente por clareza e porque alguns testes criam mensagem sem
    // passar pela Conversation criada aqui (idExterno com o prefixo, mesmo
    // waId de outro teste) — cobrir os dois casos evita depender do cascade
    // silenciosamente.
    await prisma.whatsappMessage.deleteMany({ where: { conversationId: { in: conversationIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
  }

  await prisma.whatsappMessage.deleteMany({ where: { idExterno: { startsWith: PREFIXO } } });
}

describe("ingerirMensagem", () => {
  afterEach(limparDadosDeTeste);
  afterAll(limparDadosDeTeste);

  it("cria a Conversation na primeira mensagem, com bufferSeq = 1", async () => {
    const resultado = await ingerirMensagem(evento());

    expect(resultado.duplicada).toBe(false);
    expect(resultado.bufferSeq).toBe(1);

    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: resultado.conversationId },
    });
    expect(conversation.waId).toBe(`${PREFIXO}5511999990001`);
    expect(conversation.bufferSeq).toBe(1);
  });

  it("grava Conversation.telefone quando o waId normaliza para um telefone BR reconhecível", async () => {
    // waId no formato bruto que a Evolution manda: código do país (55) +
    // DDD + celular já com o 9º dígito. normalizarTelefoneWhatsapp ignora
    // qualquer caractere não-numérico (inclusive o prefixo "teste-ingest-"
    // deste arquivo) antes de normalizar — por isso o telefone gravado é só
    // os dígitos, sem o prefixo.
    const waId = `${PREFIXO}5511988887001`;
    const resultado = await ingerirMensagem(evento({ waId }));

    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: resultado.conversationId },
    });
    expect(conversation.waId).toBe(waId);
    expect(conversation.telefone).toBe("11988887001");
  });

  it("deixa Conversation.telefone nulo quando o waId não normaliza para um telefone BR reconhecível", async () => {
    // Só dígitos do prefixo de teste seriam curtos demais/não-numéricos —
    // usa um waId numérico mas claramente fora do formato BR (poucos
    // dígitos, sem DDD plausível) para testar o caminho `ok: false`.
    const waId = `${PREFIXO}123`;
    const resultado = await ingerirMensagem(evento({ waId }));

    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: resultado.conversationId },
    });
    expect(conversation.telefone).toBeNull();
  });

  it("reutiliza a MESMA Conversation para mensagens seguintes do mesmo waId, incrementando bufferSeq", async () => {
    const waId = `${PREFIXO}5511999990002`;

    const primeira = await ingerirMensagem(evento({ waId }));
    const segunda = await ingerirMensagem(evento({ waId }));
    const terceira = await ingerirMensagem(evento({ waId }));

    expect(segunda.conversationId).toBe(primeira.conversationId);
    expect(terceira.conversationId).toBe(primeira.conversationId);
    expect([primeira.bufferSeq, segunda.bufferSeq, terceira.bufferSeq]).toEqual([1, 2, 3]);

    const total = await prisma.whatsappMessage.count({
      where: { conversation: { waId } },
    });
    expect(total).toBe(3);
  });

  it(
    "idempotência: o MESMO idExterno submetido duas vezes cria exatamente UMA WhatsappMessage, sem " +
      "incrementar bufferSeq na segunda vez (prova a defesa contra redelivery do webhook)",
    async () => {
      const waId = `${PREFIXO}5511999990003`;
      const idExterno = `${PREFIXO}msg-duplicada-${crypto.randomUUID()}`;
      const mensagem = evento({ waId, idExterno });

      const primeira = await ingerirMensagem(mensagem);
      expect(primeira.duplicada).toBe(false);
      expect(primeira.bufferSeq).toBe(1);

      // Redelivery: MESMO payload (mesmo idExterno) — como a Evolution faria
      // num retry de rede, ou um reenvio manual do mesmo corpo.
      const segunda = await ingerirMensagem(mensagem);
      expect(segunda.duplicada).toBe(true);
      expect(segunda.conversationId).toBe(primeira.conversationId);
      // bufferSeq não avança na redelivery — continua 1, não 2.
      expect(segunda.bufferSeq).toBe(1);

      const total = await prisma.whatsappMessage.count({ where: { idExterno } });
      expect(total).toBe(1);

      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: { id: primeira.conversationId },
      });
      expect(conversation.bufferSeq).toBe(1);
    }
  );

  it(
    "sob concorrência, N chamadas simultâneas com o MESMO idExterno gravam exatamente UMA WhatsappMessage " +
      "(mesma prova de Promise.all que dedupe.test.ts faz para Contact.telefone)",
    async () => {
      const waId = `${PREFIXO}5511999990004`;
      const idExterno = `${PREFIXO}msg-corrida-${crypto.randomUUID()}`;

      const resultados = await Promise.all(
        Array.from({ length: 8 }, () => ingerirMensagem(evento({ waId, idExterno })))
      );

      const total = await prisma.whatsappMessage.count({ where: { idExterno } });
      expect(total).toBe(1);

      const idsConversation = new Set(resultados.map((r) => r.conversationId));
      expect(idsConversation.size).toBe(1);

      // Exatamente uma das chamadas "ganhou" a corrida (duplicada: false);
      // todas as outras se reconheceram como redelivery.
      const vencedoras = resultados.filter((r) => !r.duplicada);
      expect(vencedoras).toHaveLength(1);
    }
  );

  it("grava texto null e o tipo correto para uma mensagem de mídia sem legenda (ex.: áudio)", async () => {
    const resultado = await ingerirMensagem(
      evento({ waId: `${PREFIXO}5511999990005`, tipo: "AUDIO", texto: null })
    );

    const mensagem = await prisma.whatsappMessage.findFirstOrThrow({
      where: { conversationId: resultado.conversationId },
    });
    expect(mensagem.tipo).toBe("AUDIO");
    expect(mensagem.texto).toBeNull();
    expect(mensagem.direcao).toBe("ENTRADA");
    expect(mensagem.autor).toBe("CLIENTE");
    expect(mensagem.processadoEm).toBeNull();
  });

  it("atualiza nomeExibicao quando uma mensagem seguinte traz um nome novo, sem apagar com null", async () => {
    const waId = `${PREFIXO}5511999990006`;

    const primeira = await ingerirMensagem(evento({ waId, nomeExibicao: "Nome Antigo" }));
    await ingerirMensagem(evento({ waId, nomeExibicao: null }));
    const terceira = await ingerirMensagem(evento({ waId, nomeExibicao: "Nome Novo" }));

    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: primeira.conversationId },
    });
    expect(conversation.id).toBe(terceira.conversationId);
    expect(conversation.nomeExibicao).toBe("Nome Novo");
  });
});
