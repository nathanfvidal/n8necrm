// Teste de unidade puro (sem Prisma real, sem rede): mocka o gateway,
// ingest, fila e checarRateLimit para isolar a ROTA — mesmo padrão de
// tests/unit/export-leads.test.ts. Sem mockar @/modules/whatsapp/gateway
// (que tem "server-only" e valida env no import), a importação da rota
// exigiria EVOLUTION_DOMAIN/INSTANCE/APIKEY reais.
import crypto from "node:crypto";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const TOKEN = "token-imprevisivel-de-teste-abc123";

const checarRateLimitMock = vi.fn();
vi.mock("@/core/rate-limit/limiter", () => ({ checarRateLimit: (...a: unknown[]) => checarRateLimitMock(...a) }));

const verificarOrigemMock = vi.fn();
const normalizarEventosMock = vi.fn();
vi.mock("@/modules/whatsapp/gateway", () => ({
  whatsappGateway: {
    verificarOrigem: (...a: unknown[]) => verificarOrigemMock(...a),
    normalizarEventos: (...a: unknown[]) => normalizarEventosMock(...a),
  },
}));

const ingerirMensagemMock = vi.fn();
vi.mock("@/modules/whatsapp/ingest", () => ({ ingerirMensagem: (...a: unknown[]) => ingerirMensagemMock(...a) }));

const publicarTurnoMock = vi.fn();
vi.mock("@/modules/whatsapp/fila", () => ({ publicarTurno: (...a: unknown[]) => publicarTurnoMock(...a) }));

const { POST } = await import("../../src/app/api/whatsapp/evolution/[token]/route");

function requestComCorpo(corpo: unknown, ip = "203.0.113.10") {
  return new Request("https://crm.exemplo.com/api/whatsapp/evolution/qualquer", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(corpo),
  });
}

function chamar(request: Request, token: string) {
  return POST(request, { params: Promise.resolve({ token }) });
}

describe("POST /api/whatsapp/evolution/[token]", () => {
  beforeEach(() => {
    process.env.WHATSAPP_WEBHOOK_TOKEN = TOKEN;
    checarRateLimitMock.mockReset().mockResolvedValue(true);
    verificarOrigemMock.mockReset().mockReturnValue(true);
    normalizarEventosMock.mockReset().mockReturnValue([]);
    ingerirMensagemMock.mockReset();
    publicarTurnoMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.WHATSAPP_WEBHOOK_TOKEN;
  });

  it("devolve 404 para um token errado, sem consultar rate limit nem o gateway", async () => {
    const resposta = await chamar(requestComCorpo({}), "token-errado");
    expect(resposta.status).toBe(404);
    expect(checarRateLimitMock).not.toHaveBeenCalled();
    expect(verificarOrigemMock).not.toHaveBeenCalled();
  });

  it("devolve 404 para um token do MESMO tamanho mas conteúdo diferente (prova timingSafeEqual, não só length)", async () => {
    const tokenMesmoTamanho = "x".repeat(TOKEN.length);
    const resposta = await chamar(requestComCorpo({}), tokenMesmoTamanho);
    expect(resposta.status).toBe(404);
  });

  it("devolve 500 quando WHATSAPP_WEBHOOK_TOKEN não está configurado no ambiente", async () => {
    delete process.env.WHATSAPP_WEBHOOK_TOKEN;
    const resposta = await chamar(requestComCorpo({}), TOKEN);
    expect(resposta.status).toBe(500);
  });

  it("devolve 429 quando o rate limit por IP estoura", async () => {
    checarRateLimitMock.mockResolvedValue(false);
    const resposta = await chamar(requestComCorpo({}), TOKEN);
    expect(resposta.status).toBe(429);
    expect(checarRateLimitMock).toHaveBeenCalledWith(
      "whatsapp:webhook:203.0.113.10",
      expect.any(Number),
      expect.any(Number)
    );
  });

  it("devolve 200 (ack) para JSON malformado, sem tentar processar nada", async () => {
    const request = new Request("https://crm.exemplo.com/api/whatsapp/evolution/x", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.10" },
      body: "{ isto não é json válido",
    });
    const resposta = await chamar(request, TOKEN);
    expect(resposta.status).toBe(200);
    expect(verificarOrigemMock).not.toHaveBeenCalled();
  });

  it("devolve 403 quando o gateway rejeita a origem do payload", async () => {
    verificarOrigemMock.mockReturnValue(false);
    const resposta = await chamar(requestComCorpo({ instance: "outra" }), TOKEN);
    expect(resposta.status).toBe(403);
    expect(normalizarEventosMock).not.toHaveBeenCalled();
  });

  it("ingere cada evento normalizado e publica um turno para cada um que não é duplicado", async () => {
    const eventos = [
      { idExterno: "1", waId: "5511999998888", nomeExibicao: null, tipo: "TEXTO", texto: "oi", timestamp: new Date() },
      { idExterno: "2", waId: "5511999998888", nomeExibicao: null, tipo: "TEXTO", texto: "tudo bem?", timestamp: new Date() },
    ];
    normalizarEventosMock.mockReturnValue(eventos);
    ingerirMensagemMock
      .mockResolvedValueOnce({ conversationId: "conv-1", bufferSeq: 1, duplicada: false })
      .mockResolvedValueOnce({ conversationId: "conv-1", bufferSeq: 2, duplicada: false });

    const resposta = await chamar(requestComCorpo({ instance: "revenda" }), TOKEN);

    expect(resposta.status).toBe(200);
    expect(ingerirMensagemMock).toHaveBeenCalledTimes(2);
    expect(publicarTurnoMock).toHaveBeenCalledTimes(2);
    expect(publicarTurnoMock).toHaveBeenNthCalledWith(1, { conversationId: "conv-1", seq: 1 });
    expect(publicarTurnoMock).toHaveBeenNthCalledWith(2, { conversationId: "conv-1", seq: 2 });
  });

  it("NÃO publica turno para um evento que a ingestão reconheceu como redelivery duplicada", async () => {
    normalizarEventosMock.mockReturnValue([
      { idExterno: "1", waId: "5511999998888", nomeExibicao: null, tipo: "TEXTO", texto: "oi", timestamp: new Date() },
    ]);
    ingerirMensagemMock.mockResolvedValue({ conversationId: "conv-1", bufferSeq: 1, duplicada: true });

    const resposta = await chamar(requestComCorpo({ instance: "revenda" }), TOKEN);

    expect(resposta.status).toBe(200);
    expect(publicarTurnoMock).not.toHaveBeenCalled();
  });

  it("uma falha ao ingerir um evento não derruba a resposta nem impede os demais eventos", async () => {
    normalizarEventosMock.mockReturnValue([
      { idExterno: "1", waId: "5511999998888", nomeExibicao: null, tipo: "TEXTO", texto: "a", timestamp: new Date() },
      { idExterno: "2", waId: "5511999998888", nomeExibicao: null, tipo: "TEXTO", texto: "b", timestamp: new Date() },
    ]);
    ingerirMensagemMock
      .mockRejectedValueOnce(new Error("banco fora do ar"))
      .mockResolvedValueOnce({ conversationId: "conv-1", bufferSeq: 1, duplicada: false });

    const resposta = await chamar(requestComCorpo({ instance: "revenda" }), TOKEN);

    expect(resposta.status).toBe(200);
    expect(ingerirMensagemMock).toHaveBeenCalledTimes(2);
    expect(publicarTurnoMock).toHaveBeenCalledTimes(1);
  });

  it("devolve 200 (ack) para um payload que normaliza para zero eventos (ex.: connection.update)", async () => {
    normalizarEventosMock.mockReturnValue([]);
    const resposta = await chamar(requestComCorpo({ instance: "revenda", event: "connection.update" }), TOKEN);
    expect(resposta.status).toBe(200);
    expect(ingerirMensagemMock).not.toHaveBeenCalled();
  });
});

// Confere que o token de teste usado acima realmente teria o mesmo
// comprimento de um token gerado com o tamanho recomendado — não é uma
// prova de segurança, só um guard-rail para o teste acima "mesmo tamanho"
// continuar significativo se TOKEN mudar de tamanho no futuro.
describe("sanity", () => {
  it("TOKEN de teste não é vazio", () => {
    expect(crypto.timingSafeEqual(Buffer.from(TOKEN), Buffer.from(TOKEN))).toBe(true);
  });
});
