// Sem Prisma nem "server-only" — EvolutionGateway (gateway/evolution.ts) não
// importa nenhum dos dois (só gateway/index.ts, que faz a validação de env e
// instancia o singleton, tem "server-only" — não testado aqui de propósito,
// testar a classe direto evita precisar de EVOLUTION_DOMAIN/INSTANCE/APIKEY
// num teste que não toca rede de verdade).
import { describe, it, expect, vi, afterEach } from "vitest";

import { EvolutionGateway } from "../../src/modules/whatsapp/gateway/evolution";

const CONFIG = { domain: "https://evo.exemplo.com", instance: "revenda-principal", apiKey: "chave-teste" };

function payloadTexto(overrides: Partial<{ remoteJid: string; texto: string; fromMe: boolean; instance: string; event: string; messageType: string }> = {}) {
  return {
    event: overrides.event ?? "messages.upsert",
    instance: overrides.instance ?? CONFIG.instance,
    data: {
      key: {
        remoteJid: overrides.remoteJid ?? "5511999998888@s.whatsapp.net",
        fromMe: overrides.fromMe ?? false,
        id: "3EB0C767D097B7C0A1B2",
      },
      message: { conversation: overrides.texto ?? "Oi, tudo bem?" },
      messageType: overrides.messageType ?? "conversation",
      pushName: "Cliente Teste",
      messageTimestamp: 1735900000,
    },
  };
}

describe("EvolutionGateway.verificarOrigem", () => {
  const gateway = new EvolutionGateway(CONFIG);

  it("aceita um payload cujo campo instance bate com a instância configurada", () => {
    expect(gateway.verificarOrigem(payloadTexto())).toBe(true);
  });

  it("rejeita um payload de outra instância Evolution (mesmo domínio, instance diferente)", () => {
    expect(gateway.verificarOrigem(payloadTexto({ instance: "outra-instancia" }))).toBe(false);
  });

  it("rejeita qualquer payload que não tenha o formato mínimo esperado, sem lançar", () => {
    expect(gateway.verificarOrigem({ lixo: true })).toBe(false);
    expect(gateway.verificarOrigem(null)).toBe(false);
    expect(gateway.verificarOrigem("string qualquer")).toBe(false);
    expect(gateway.verificarOrigem(undefined)).toBe(false);
  });
});

describe("EvolutionGateway.normalizarEventos", () => {
  const gateway = new EvolutionGateway(CONFIG);

  it("normaliza uma mensagem de texto recebida, extraindo waId sem o sufixo @s.whatsapp.net", () => {
    const eventos = gateway.normalizarEventos(payloadTexto());
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      idExterno: "3EB0C767D097B7C0A1B2",
      waId: "5511999998888",
      nomeExibicao: "Cliente Teste",
      tipo: "TEXTO",
      texto: "Oi, tudo bem?",
    });
    expect(eventos[0]?.timestamp).toBeInstanceOf(Date);
  });

  it("devolve [] para eco de mensagem enviada pela própria instância (fromMe: true) — evita loop de resposta", () => {
    const eventos = gateway.normalizarEventos(payloadTexto({ fromMe: true }));
    expect(eventos).toEqual([]);
  });

  it("devolve [] para mensagem de grupo (remoteJid termina em @g.us)", () => {
    const eventos = gateway.normalizarEventos(
      payloadTexto({ remoteJid: "120363000000000000@g.us" })
    );
    expect(eventos).toEqual([]);
  });

  it("devolve [] para eventos que não são messages.upsert (ex.: connection.update)", () => {
    const eventos = gateway.normalizarEventos(payloadTexto({ event: "connection.update" }));
    expect(eventos).toEqual([]);
  });

  it("devolve [] para payload malformado/inesperado, sem lançar (webhook não pode derrubar por isso)", () => {
    expect(() => gateway.normalizarEventos({ lixo: true })).not.toThrow();
    expect(gateway.normalizarEventos({ lixo: true })).toEqual([]);
    expect(gateway.normalizarEventos(null)).toEqual([]);
    expect(gateway.normalizarEventos([1, 2, 3])).toEqual([]);
  });

  it("mapeia imageMessage para tipo IMAGEM e extrai a legenda (caption) como texto", () => {
    const payload = payloadTexto({ messageType: "imageMessage" });
    payload.data.message = { imageMessage: { caption: "Olha esse carro" } } as never;
    const eventos = gateway.normalizarEventos(payload);
    expect(eventos[0]).toMatchObject({ tipo: "IMAGEM", texto: "Olha esse carro" });
  });

  it("mapeia audioMessage para tipo AUDIO com texto nulo (áudio não tem legenda)", () => {
    const payload = payloadTexto({ messageType: "audioMessage" });
    payload.data.message = { audioMessage: {} } as never;
    const eventos = gateway.normalizarEventos(payload);
    expect(eventos[0]).toMatchObject({ tipo: "AUDIO", texto: null });
  });

  it("mapeia um messageType desconhecido para OUTRO em vez de lançar", () => {
    const eventos = gateway.normalizarEventos(payloadTexto({ messageType: "pollCreationMessage" }));
    expect(eventos[0]?.tipo).toBe("OUTRO");
  });
});

describe("EvolutionGateway.enviarTexto", () => {
  const gateway = new EvolutionGateway(CONFIG);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("faz POST em {domain}/message/sendText/{instance} com apikey e devolve o id da mensagem enviada", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ key: { id: "MSG-ENVIADA-123" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await gateway.enviarTexto("5511999998888", "Olá! Como posso ajudar?");

    expect(resultado).toEqual({ idExterno: "MSG-ENVIADA-123" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opcoes] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://evo.exemplo.com/message/sendText/revenda-principal");
    expect(opcoes.method).toBe("POST");
    expect((opcoes.headers as Record<string, string>).apikey).toBe("chave-teste");
    expect(JSON.parse(opcoes.body as string)).toEqual({
      number: "5511999998888",
      text: "Olá! Como posso ajudar?",
    });
  });

  it("lança um erro legível quando a Evolution responde com status de erro", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "instância desconectada" })
    );

    await expect(gateway.enviarTexto("5511999998888", "oi")).rejects.toThrow(/HTTP 500/);
  });

  it("gera um id local em vez de falhar quando a resposta não traz key.id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

    const resultado = await gateway.enviarTexto("5511999998888", "oi");
    expect(resultado.idExterno).toMatch(/^evolution-sem-id-/);
  });
});
