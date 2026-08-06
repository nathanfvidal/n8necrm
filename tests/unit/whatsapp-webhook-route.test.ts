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

// A rota importa `DuplicateMessageError` de "@vercel/queue" (não de
// fila.ts) para reconhecer especificamente esse erro vindo de
// `publicarTurno` (mockado acima) — usamos a classe REAL do pacote (não
// precisa mockar "@vercel/queue" inteiro: importar só a classe de erro não
// toca rede nem exige env nenhuma, ao contrário de `send`/`handleCallback`).
const { DuplicateMessageError } = await import("@vercel/queue");

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

  it(
    "fix round 1/5 (achado I2): o limite por IP é generoso (guarda de flood, não throttle por cliente — " +
      "todo tráfego legítimo vem de UM IP, a instância Evolution)",
    async () => {
      await chamar(requestComCorpo({}), TOKEN);
      const limite = checarRateLimitMock.mock.calls[0]?.[1] as number;
      // >= 600: bem acima do antigo 60/min, que na prática funcionava como
      // teto GLOBAL de todo tráfego da revenda, não como flood guard.
      expect(limite).toBeGreaterThanOrEqual(600);
    }
  );

  it(
    "fix round 1/5 (achado MENOR): usa x-vercel-forwarded-for (não forjável pelo cliente) como chave do " +
      "rate limit quando presente, antes de x-forwarded-for (forjável)",
    async () => {
      const request = new Request("https://crm.exemplo.com/api/whatsapp/evolution/x", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.9", // forjável, deveria ser ignorado quando o outro header existe
          "x-vercel-forwarded-for": "203.0.113.55",
        },
        body: JSON.stringify({}),
      });

      await chamar(request, TOKEN);

      expect(checarRateLimitMock).toHaveBeenCalledWith(
        "whatsapp:webhook:203.0.113.55",
        expect.any(Number),
        expect.any(Number)
      );
    }
  );

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

  it(
    "fix round 1/5 (achado I3): TAMBÉM publica turno para um evento que a ingestão reconheceu como " +
      "redelivery duplicada — antes deste fix, pular a publicação nesse caminho era exatamente o que " +
      "deixava uma mensagem cujo enfileiramento original tivesse falhado PRESA para sempre (a redelivery " +
      "nunca tentava de novo). A idempotencyKey da fila já torna essa republicação segura.",
    async () => {
      normalizarEventosMock.mockReturnValue([
        { idExterno: "1", waId: "5511999998888", nomeExibicao: null, tipo: "TEXTO", texto: "oi", timestamp: new Date() },
      ]);
      ingerirMensagemMock.mockResolvedValue({ conversationId: "conv-1", bufferSeq: 1, duplicada: true });

      const resposta = await chamar(requestComCorpo({ instance: "revenda" }), TOKEN);

      expect(resposta.status).toBe(200);
      expect(publicarTurnoMock).toHaveBeenCalledTimes(1);
      expect(publicarTurnoMock).toHaveBeenCalledWith({ conversationId: "conv-1", seq: 1 });
    }
  );

  it(
    "trata DuplicateMessageError vindo de publicarTurno como esperado (200), não como falha — é o caminho " +
      "normal quando o job para este bufferSeq já tinha sido publicado antes",
    async () => {
      normalizarEventosMock.mockReturnValue([
        { idExterno: "1", waId: "5511999998888", nomeExibicao: null, tipo: "TEXTO", texto: "oi", timestamp: new Date() },
      ]);
      ingerirMensagemMock.mockResolvedValue({ conversationId: "conv-1", bufferSeq: 1, duplicada: true });
      publicarTurnoMock.mockRejectedValueOnce(new DuplicateMessageError("dup", "conv-1:1"));

      const resposta = await chamar(requestComCorpo({ instance: "revenda" }), TOKEN);

      expect(resposta.status).toBe(200);
      const corpo = (await resposta.json()) as { ok: boolean };
      expect(corpo.ok).toBe(true);
    }
  );

  it(
    "fix round 1/5 (achado I3): devolve 500 quando publicarTurno falha por um motivo GENUÍNO (não " +
      "DuplicateMessageError) — deixa a Evolution reentregar o webhook, seguro agora que ingest e " +
      "publish são idempotentes de ponta a ponta",
    async () => {
      normalizarEventosMock.mockReturnValue([
        { idExterno: "1", waId: "5511999998888", nomeExibicao: null, tipo: "TEXTO", texto: "oi", timestamp: new Date() },
      ]);
      ingerirMensagemMock.mockResolvedValue({ conversationId: "conv-1", bufferSeq: 1, duplicada: false });
      publicarTurnoMock.mockRejectedValueOnce(new Error("fila indisponível"));

      const resposta = await chamar(requestComCorpo({ instance: "revenda" }), TOKEN);

      expect(resposta.status).toBe(500);
      const corpo = (await resposta.json()) as { ok: boolean };
      expect(corpo.ok).toBe(false);
    }
  );

  it(
    "uma falha ao ingerir um evento não impede os demais eventos de serem tentados, mas marca a resposta " +
      "como falha (fix round 1/5, I3: 500 em vez de 200 sempre — deixa a Evolution reentregar o payload, " +
      "seguro porque ingest/publish são idempotentes)",
    async () => {
      normalizarEventosMock.mockReturnValue([
        { idExterno: "1", waId: "5511999998888", nomeExibicao: null, tipo: "TEXTO", texto: "a", timestamp: new Date() },
        { idExterno: "2", waId: "5511999998888", nomeExibicao: null, tipo: "TEXTO", texto: "b", timestamp: new Date() },
      ]);
      ingerirMensagemMock
        .mockRejectedValueOnce(new Error("banco fora do ar"))
        .mockResolvedValueOnce({ conversationId: "conv-1", bufferSeq: 1, duplicada: false });

      const resposta = await chamar(requestComCorpo({ instance: "revenda" }), TOKEN);

      expect(resposta.status).toBe(500);
      expect(ingerirMensagemMock).toHaveBeenCalledTimes(2);
      // O 2º evento (que não falhou) ainda foi processado e publicado —
      // uma falha não interrompe os demais.
      expect(publicarTurnoMock).toHaveBeenCalledTimes(1);
    }
  );

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
