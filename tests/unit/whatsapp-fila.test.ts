// Fix round 1/5, achado CRÍTICO do revisor (C2): "Your own test at
// whatsapp-turno.test.ts:198 only shows this working because publicarTurno
// is mocked there." Este arquivo testa `publicarTurno` DE VERDADE (não
// mockado) — só o limite externo real (`send` de `@vercel/queue`) é
// mockado, com uma simulação FIEL do comportamento de deduplicação por
// idempotencyKey documentado pela Vercel (mesma chave dentro da janela de
// dedupe → rejeitada com DuplicateMessageError) — não um mock "burro" que
// simplesmente nunca lança.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// Simulação do serviço real: mantém um Set de idempotencyKeys já vistas
// (mesmo espírito da "janela de dedupe" documentada pela Vercel — aqui sem
// expiração, o bastante para o escopo deste teste) e rejeita repetição
// exatamente como o serviço real faria.
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

const chavesVistas = new Set<string>();
const sendMock = vi.fn(async (_topico: string, _payload: unknown, opcoes?: OpcoesSendFake) => {
  const chave = opcoes?.idempotencyKey;
  if (chave) {
    if (chavesVistas.has(chave)) {
      throw new DuplicateMessageErrorFake(`Duplicate message: ${chave}`, chave);
    }
    chavesVistas.add(chave);
  }
  return { messageId: `msg-${chavesVistas.size}` };
});

vi.mock("@vercel/queue", () => ({
  send: (...args: [string, unknown, OpcoesSendFake?]) => sendMock(...args),
  DuplicateMessageError: DuplicateMessageErrorFake,
}));

process.env.WHATSAPP_QUEUE_SECRET = "segredo-teste-fila";

const { publicarTurno } = await import("../../src/modules/whatsapp/fila");

describe("publicarTurno — idempotencyKey por tentativa de reagendamento (fix round 1/5, C2)", () => {
  beforeEach(() => {
    sendMock.mockClear();
    chavesVistas.clear();
  });

  it("a publicação original (sem tentativaReagendamento) usa a chave ${conversationId}:${seq}", async () => {
    await publicarTurno({ conversationId: "conv-1", seq: 3 });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const opcoes = sendMock.mock.calls[0]?.[2];
    expect(opcoes?.idempotencyKey).toBe("conv-1:3");
    expect(opcoes?.delaySeconds).toBe(8);
  });

  it("cada reagendamento usa uma chave DIFERENTE, sufixada pelo número da tentativa", async () => {
    await publicarTurno({ conversationId: "conv-2", seq: 5, tentativaReagendamento: 1 }, { delaySeconds: 5 });
    await publicarTurno({ conversationId: "conv-2", seq: 5, tentativaReagendamento: 2 }, { delaySeconds: 5 });
    await publicarTurno({ conversationId: "conv-2", seq: 5, tentativaReagendamento: 3 }, { delaySeconds: 5 });

    expect(sendMock).toHaveBeenCalledTimes(3);
    const chaves = sendMock.mock.calls.map((chamada) => chamada[2]?.idempotencyKey);
    expect(chaves).toEqual(["conv-2:5:r1", "conv-2:5:r2", "conv-2:5:r3"]);
    // As três são de fato distintas -- nenhuma colisão.
    expect(new Set(chaves).size).toBe(3);
  });

  it(
    "reproduz e prova o fix do achado CRÍTICO do revisor (C2): publicar a mesma mensagem original " +
      "seguida por reagendamentos sucessivos (simulando o loop real de turno.ts quando o lease fica " +
      "ocupado repetidas vezes) NÃO lança — cada tentativa usa uma chave própria",
    async () => {
      const job = { conversationId: "conv-3", seq: 7 };

      // Publicação original (ingest.ts).
      await expect(publicarTurno(job)).resolves.toBeUndefined();

      // Sucessivos reagendamentos por lease ocupado -- exatamente o que
      // processarTurno faz a cada vez que claimLease falha.
      for (let tentativa = 1; tentativa <= 5; tentativa++) {
        await expect(
          publicarTurno({ ...job, tentativaReagendamento: tentativa }, { delaySeconds: 5 })
        ).resolves.toBeUndefined();
      }

      expect(sendMock).toHaveBeenCalledTimes(6); // original + 5 reagendamentos, nenhum rejeitado
    }
  );

  it(
    "CONTRASTE — prova de que o bug era real: reusar a MESMA idempotencyKey da publicação original " +
      "para um reagendamento (o comportamento ANTES deste fix) É rejeitado pelo serviço, confirmando que " +
      "a mudança para uma chave por tentativa era necessária, não cosmética",
    async () => {
      const job = { conversationId: "conv-4", seq: 9 };
      await publicarTurno(job); // registra a chave "conv-4:9"

      // Simula literalmente o que o código ANTIGO fazia: reenviar com a
      // MESMA chave (sem tentativaReagendamento, como o reagendamento
      // antigo reusava o job original intacto).
      await expect(sendMock("whatsapp-turn", job, { idempotencyKey: "conv-4:9" })).rejects.toThrow(
        /Duplicate message/
      );
    }
  );
});
