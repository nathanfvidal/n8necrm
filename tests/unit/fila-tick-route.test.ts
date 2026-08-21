// A rota da fila deixou de ser consumidor de push e virou TICK autenticado, e
// com isso o que ela responde a um desconhecido passou a importar: até o Ciclo
// 2d a Vercel a mantinha air-gapped da internet, e a partir daqui ela é
// alcançável. Estes casos são a prova de que o segredo em cabeçalho é a defesa,
// e de que ela fecha FECHADO.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const drenarFilaMock = vi.fn();
vi.mock("@/modules/whatsapp/fila/consumidor", () => ({
  drenarFila: (...a: unknown[]) => drenarFilaMock(...a),
}));

const SEGREDO = "segredo-de-tick-abc123";

function requisicao(cabecalhos: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/queues/whatsapp-turn", {
    method: "POST",
    headers: cabecalhos,
  });
}

describe("POST /api/queues/whatsapp-turn (tick da fila)", () => {
  beforeEach(() => {
    process.env.WHATSAPP_QUEUE_SECRET = SEGREDO;
    drenarFilaMock
      .mockReset()
      .mockResolvedValue({ processados: 2, falhados: 0, mortos: 0, esgotou: true });
  });

  it("drena quando o segredo confere", async () => {
    const { POST } = await import("../../src/app/api/queues/whatsapp-turn/route");
    const resposta = await POST(requisicao({ "x-fila-segredo": SEGREDO }));

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toMatchObject({ ok: true, processados: 2, esgotou: true });
    expect(drenarFilaMock).toHaveBeenCalledTimes(1);
  });

  it("responde 404 sem o cabeçalho, e NÃO drena", async () => {
    // 404 e não 401: mesma decisão já tomada na rota do webhook — não confirma
    // a quem está adivinhando que este path sequer existe. Fora da Vercel esta
    // rota deixou de ser air-gapped, então o que ela responde a um desconhecido
    // passou a importar.
    const { POST } = await import("../../src/app/api/queues/whatsapp-turn/route");
    const resposta = await POST(requisicao());

    expect(resposta.status).toBe(404);
    expect(drenarFilaMock).not.toHaveBeenCalled();
  });

  it("responde 404 com segredo errado, e NÃO drena", async () => {
    const { POST } = await import("../../src/app/api/queues/whatsapp-turn/route");
    const resposta = await POST(requisicao({ "x-fila-segredo": "chute" }));

    expect(resposta.status).toBe(404);
    expect(drenarFilaMock).not.toHaveBeenCalled();
  });

  it("responde 404 quando a variável NÃO está definida — fecha fechado", async () => {
    delete process.env.WHATSAPP_QUEUE_SECRET;
    const { POST } = await import("../../src/app/api/queues/whatsapp-turn/route");
    const resposta = await POST(requisicao({ "x-fila-segredo": "qualquer" }));

    expect(resposta.status).toBe(404);
    expect(drenarFilaMock).not.toHaveBeenCalled();
  });

  it("o segredo NÃO é lido no escopo do módulo", async () => {
    // Validação em escopo de módulo já derrubou o build deste projeto uma vez
    // (`gateway/index.ts`): `next build` avalia módulos alcançáveis para
    // coletar configuração de rota, e a variável não existe nesse momento.
    delete process.env.WHATSAPP_QUEUE_SECRET;
    await expect(
      import("../../src/app/api/queues/whatsapp-turn/route")
    ).resolves.toBeDefined();
  });
});
