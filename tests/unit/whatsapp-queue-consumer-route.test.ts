// Testa a validação do segredo compartilhado (fix round 1/5, achado I1) na
// rota consumidora da fila. Mocka `handleCallback` de "@vercel/queue" para
// capturar o handler passado a ele e invocá-lo DIRETO com payloads
// controlados — sem isso, precisaríamos construir um CloudEvent HTTP real
// (headers ce-type, ce-vqs*, etc.) só para exercitar a lógica que é NOSSA
// (validação do segredo + parse do job), não do SDK.
import { describe, it, expect, vi, beforeEach } from "vitest";

type Handler = (mensagem: unknown, metadata?: unknown) => Promise<void>;

let handlerCapturado: Handler | undefined;
const handleCallbackMock = vi.fn((handler: Handler) => {
  handlerCapturado = handler;
  return async () => new Response(null, { status: 200 });
});
vi.mock("@vercel/queue", () => ({ handleCallback: (h: Handler) => handleCallbackMock(h) }));

const processarTurnoMock = vi.fn();
vi.mock("@/modules/whatsapp/turno", () => ({
  processarTurno: (...args: unknown[]) => processarTurnoMock(...args),
}));

const SEGREDO = "segredo-teste-consumidor-abc123";

describe("POST /api/queues/whatsapp-turn (consumidor)", () => {
  beforeEach(async () => {
    process.env.WHATSAPP_QUEUE_SECRET = SEGREDO;
    processarTurnoMock.mockReset().mockResolvedValue(undefined);
    handleCallbackMock.mockClear();
    // Import isolado por teste — o módulo só registra o handler capturado
    // uma vez por import; re-importar (com `vi.resetModules` implícito via
    // `await import` de um caminho já em cache não recarrega, então
    // fazemos isso uma vez fora do loop de testes e reusamos o mesmo
    // handler capturado).
    if (!handlerCapturado) {
      await import("../../src/app/api/queues/whatsapp-turn/route");
    }
  });

  it("processa o job normalmente quando o segredo compartilhado confere", async () => {
    await handlerCapturado!({ conversationId: "conv-1", seq: 1, segredo: SEGREDO });

    expect(processarTurnoMock).toHaveBeenCalledTimes(1);
    expect(processarTurnoMock).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-1", seq: 1 })
    );
  });

  it("NÃO processa e não lança quando o segredo está incorreto (payload forjado)", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      handlerCapturado!({ conversationId: "conv-1", seq: 1, segredo: "segredo-errado" })
    ).resolves.toBeUndefined();

    expect(processarTurnoMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("NÃO processa quando o payload não tem campo `segredo` nenhum", async () => {
    // zod rejeita (campo obrigatório) -- o handler deve lançar aqui (schema
    // inválido), não silenciar como no caso de segredo incorreto.
    await expect(handlerCapturado!({ conversationId: "conv-1", seq: 1 })).rejects.toThrow();
    expect(processarTurnoMock).not.toHaveBeenCalled();
  });

  it("NÃO processa quando WHATSAPP_QUEUE_SECRET não está configurado no ambiente (fail closed)", async () => {
    delete process.env.WHATSAPP_QUEUE_SECRET;
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await handlerCapturado!({ conversationId: "conv-1", seq: 1, segredo: SEGREDO });

    expect(processarTurnoMock).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
    process.env.WHATSAPP_QUEUE_SECRET = SEGREDO;
  });

  it("repassa tentativaReagendamento ao processarTurno quando presente no job", async () => {
    await handlerCapturado!({ conversationId: "conv-2", seq: 4, tentativaReagendamento: 2, segredo: SEGREDO });

    expect(processarTurnoMock).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-2", seq: 4, tentativaReagendamento: 2 })
    );
  });
});
