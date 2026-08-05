// Usa o Prisma real contra o Postgres do Supabase (para provar a atomicidade
// do lease de verdade, com UPDATE condicional concorrente — não dá pra
// provar isso com um mock de banco) — carrega DATABASE_URL do .env aqui,
// mesmo padrão de rate-limit.test.ts (a mesma classe de prova: Promise.all
// contra o banco real).
import "dotenv/config";

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Mocks dos três pontos de saída de turno.ts — nenhuma chamada real à
// OpenAI ou à Evolution nestes testes (instrução explícita da Fatia 1).
const enviarTextoMock = vi.fn();
vi.mock("../../src/modules/whatsapp/gateway", () => ({
  whatsappGateway: { enviarTexto: (...args: unknown[]) => enviarTextoMock(...args) },
}));

const gerarRespostaMock = vi.fn();
vi.mock("../../src/modules/whatsapp/llm", () => ({
  llmProvider: { gerarResposta: (...args: unknown[]) => gerarRespostaMock(...args) },
}));

const publicarTurnoMock = vi.fn();
vi.mock("../../src/modules/whatsapp/fila", () => ({
  publicarTurno: (...args: unknown[]) => publicarTurnoMock(...args),
}));

import { prisma } from "../../src/lib/prisma";
import { processarTurno } from "../../src/modules/whatsapp/turno";

const PREFIXO = "teste-turno-";

async function criarConversation(overrides: Partial<{ waId: string; bufferSeq: number }> = {}) {
  return prisma.conversation.create({
    data: {
      waId: overrides.waId ?? `${PREFIXO}${crypto.randomUUID()}`,
      bufferSeq: overrides.bufferSeq ?? 1,
    },
  });
}

async function criarMensagemEntrada(
  conversationId: string,
  overrides: Partial<{ tipo: "TEXTO" | "AUDIO"; texto: string | null; idExterno: string }> = {}
) {
  return prisma.whatsappMessage.create({
    data: {
      conversationId,
      idExterno: overrides.idExterno ?? `${PREFIXO}${crypto.randomUUID()}`,
      direcao: "ENTRADA",
      autor: "CLIENTE",
      tipo: overrides.tipo ?? "TEXTO",
      texto: overrides.texto ?? "Olá, tudo bem?",
    },
  });
}

async function limparDadosDeTeste() {
  const conversas = await prisma.conversation.findMany({
    where: { waId: { startsWith: PREFIXO } },
    select: { id: true },
  });
  const ids = conversas.map((c) => c.id);
  if (ids.length > 0) {
    await prisma.whatsappMessage.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
  }
}

describe("processarTurno", () => {
  beforeEach(() => {
    // Cada chamada precisa de um idExterno ÚNICO (a coluna é @unique) — um
    // teste que envia mais de uma mensagem de saída (ex.: texto + fallback
    // de mídia) colidiria na constraint se todas as chamadas devolvessem o
    // mesmo valor fixo.
    enviarTextoMock
      .mockReset()
      .mockImplementation(async () => ({ idExterno: `${PREFIXO}saida-${crypto.randomUUID()}` }));
    gerarRespostaMock.mockReset().mockResolvedValue({ mensagens: ["Oi! Como posso ajudar?"] });
    publicarTurnoMock.mockReset().mockResolvedValue(undefined);
  });
  afterEach(limparDadosDeTeste);
  afterAll(limparDadosDeTeste);

  it("caminho feliz: processa a mensagem pendente, envia a resposta, marca processadoEm e libera o lease", async () => {
    const conversation = await criarConversation({ bufferSeq: 1 });
    const mensagem = await criarMensagemEntrada(conversation.id, { texto: "Quero saber do Gol 2018" });

    await processarTurno({ conversationId: conversation.id, seq: 1 });

    expect(gerarRespostaMock).toHaveBeenCalledTimes(1);
    expect(enviarTextoMock).toHaveBeenCalledWith(conversation.waId, "Oi! Como posso ajudar?");

    const mensagemAtualizada = await prisma.whatsappMessage.findUniqueOrThrow({
      where: { id: mensagem.id },
    });
    expect(mensagemAtualizada.processadoEm).not.toBeNull();

    const saida = await prisma.whatsappMessage.findFirstOrThrow({
      where: { conversationId: conversation.id, direcao: "SAIDA" },
    });
    expect(saida.autor).toBe("IA");
    expect(saida.texto).toBe("Oi! Como posso ajudar?");
    expect(saida.processadoEm).not.toBeNull();

    const conversationDepois = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(conversationDepois.processandoAte).toBeNull();
  });

  it("junta fragmentos de texto pendentes numa única chamada ao modelo (buffer)", async () => {
    const conversation = await criarConversation({ bufferSeq: 3 });
    await criarMensagemEntrada(conversation.id, { texto: "oi" });
    await criarMensagemEntrada(conversation.id, { texto: "quero saber" });
    await criarMensagemEntrada(conversation.id, { texto: "do gol 2018" });

    await processarTurno({ conversationId: conversation.id, seq: 3 });

    expect(gerarRespostaMock).toHaveBeenCalledTimes(1);
    const contexto = gerarRespostaMock.mock.calls[0]?.[0];
    const ultimaEntradaDoContexto = contexto.historico.at(-1);
    expect(ultimaEntradaDoContexto).toEqual({ autor: "CLIENTE", texto: "oi\nquero saber\ndo gol 2018" });

    const pendentesRestantes = await prisma.whatsappMessage.count({
      where: { conversationId: conversation.id, direcao: "ENTRADA", processadoEm: null },
    });
    expect(pendentesRestantes).toBe(0);
  });

  it("seq desatualizado: se uma mensagem mais nova já chegou (bufferSeq != seq do job), não processa nem chama o modelo", async () => {
    const conversation = await criarConversation({ bufferSeq: 5 }); // já avançou além do seq deste job
    await criarMensagemEntrada(conversation.id);

    await processarTurno({ conversationId: conversation.id, seq: 3 });

    expect(gerarRespostaMock).not.toHaveBeenCalled();
    expect(enviarTextoMock).not.toHaveBeenCalled();

    const conversationDepois = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    // O lease foi reivindicado (para ler bufferSeq) e precisa ser liberado
    // mesmo quando o turno não processa nada — senão a conversa fica travada
    // até o lease expirar sozinho.
    expect(conversationDepois.processandoAte).toBeNull();
  });

  it("mensagem só de mídia (sem texto): responde com o fallback fixo, sem chamar o modelo", async () => {
    const conversation = await criarConversation({ bufferSeq: 1 });
    await criarMensagemEntrada(conversation.id, { tipo: "AUDIO", texto: null });

    await processarTurno({ conversationId: conversation.id, seq: 1 });

    expect(gerarRespostaMock).not.toHaveBeenCalled();
    expect(enviarTextoMock).toHaveBeenCalledTimes(1);
    const [, textoEnviado] = enviarTextoMock.mock.calls[0] as [string, string];
    expect(textoEnviado).toMatch(/áudio|imagem/i);
  });

  it("mistura de texto e mídia: chama o modelo para o texto e ainda acrescenta o fallback de mídia", async () => {
    const conversation = await criarConversation({ bufferSeq: 2 });
    await criarMensagemEntrada(conversation.id, { texto: "quanto custa esse carro?" });
    await criarMensagemEntrada(conversation.id, { tipo: "AUDIO", texto: null });

    await processarTurno({ conversationId: conversation.id, seq: 2 });

    expect(gerarRespostaMock).toHaveBeenCalledTimes(1);
    expect(enviarTextoMock).toHaveBeenCalledTimes(2); // resposta do modelo + fallback de mídia
  });

  it(
    "concorrência: duas chamadas simultâneas de processarTurno para a MESMA conversa resultam em " +
      "exatamente UM processador ativo (uma chama o modelo, a outra detecta o lease ocupado e reagenda)",
    async () => {
      const conversation = await criarConversation({ bufferSeq: 1 });
      await criarMensagemEntrada(conversation.id);

      // Simula uma chamada de LLM que demora — abre uma janela real onde o
      // lease fica ocupado, para a segunda chamada concorrente ter chance
      // de observá-lo ocupado (a correção em si não depende deste atraso:
      // o UPDATE condicional serializa de qualquer forma, mas o atraso
      // torna o teste uma prova mais forte contra uma regressão futura que
      // reduza a janela do lease).
      gerarRespostaMock.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ mensagens: ["Oi! Como posso ajudar?"] }), 300)
          )
      );

      const job = { conversationId: conversation.id, seq: 1 };
      await Promise.all([processarTurno(job), processarTurno(job)]);

      expect(gerarRespostaMock).toHaveBeenCalledTimes(1);
      expect(enviarTextoMock).toHaveBeenCalledTimes(1);
      expect(publicarTurnoMock).toHaveBeenCalledTimes(1);
      expect(publicarTurnoMock).toHaveBeenCalledWith(job, { delaySeconds: 5 });

      const conversationDepois = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      expect(conversationDepois.processandoAte).toBeNull();

      const mensagemProcessada = await prisma.whatsappMessage.findFirstOrThrow({
        where: { conversationId: conversation.id, direcao: "ENTRADA" },
      });
      expect(mensagemProcessada.processadoEm).not.toBeNull();
    }
  );
});
