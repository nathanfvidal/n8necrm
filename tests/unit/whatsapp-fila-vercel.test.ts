// Testa o ADAPTADOR (FilaVercel) direto, não a função de conveniência
// `publicarTurno`. `whatsapp-fila.test.ts` já cobre o caminho público; este
// arquivo existe para provar que a implementação da Vercel é UMA
// implementação de `FilaTurnos`, substituível, e não a única forma possível.
import { describe, it, expect, vi, beforeEach } from "vitest";

class DuplicateMessageErrorFake extends Error {
  constructor(
    message: string,
    public readonly idempotencyKey?: string
  ) {
    super(message);
    this.name = "DuplicateMessageError";
  }
}

interface OpcoesSendFake {
  idempotencyKey?: string;
  delaySeconds?: number;
}

const sendMock = vi.fn(async (_topico: string, _payload: unknown, _opcoes?: OpcoesSendFake) => ({
  messageId: "msg-1",
}));

vi.mock("@vercel/queue", () => ({
  send: (...args: [string, unknown, OpcoesSendFake?]) => sendMock(...args),
  DuplicateMessageError: DuplicateMessageErrorFake,
}));

process.env.WHATSAPP_QUEUE_SECRET = "segredo-teste-adaptador";

const { FilaVercel } = await import("../../src/modules/whatsapp/fila/vercel");

describe("FilaVercel — adaptador de @vercel/queue", () => {
  beforeEach(() => {
    sendMock.mockClear();
  });

  it("publica no tópico whatsapp-turn com o segredo embutido no payload", async () => {
    await new FilaVercel().publicar({ companyId: "empresa-1", conversationId: "conv-1", seq: 3 });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const [topico, payload] = sendMock.mock.calls[0] ?? [];
    expect(topico).toBe("whatsapp-turn");
    expect(payload).toMatchObject({
      companyId: "empresa-1",
      conversationId: "conv-1",
      seq: 3,
      segredo: "segredo-teste-adaptador",
    });
  });

  it("usa a chave de idempotência sem sufixo na publicação original, e delay padrão de 8s", async () => {
    await new FilaVercel().publicar({ companyId: "empresa-1", conversationId: "conv-1", seq: 3 });

    const opcoes = sendMock.mock.calls[0]?.[2];
    expect(opcoes?.idempotencyKey).toBe("conv-1:3");
    expect(opcoes?.delaySeconds).toBe(8);
  });

  it("sufixa a chave por tentativa de reagendamento e respeita o delay informado", async () => {
    await new FilaVercel().publicar(
      { companyId: "empresa-1", conversationId: "conv-2", seq: 5, tentativaReagendamento: 2 },
      { delaySeconds: 5 }
    );

    const opcoes = sendMock.mock.calls[0]?.[2];
    expect(opcoes?.idempotencyKey).toBe("conv-2:5:r2");
    expect(opcoes?.delaySeconds).toBe(5);
  });
});
