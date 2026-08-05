import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocka o pacote "openai" inteiro — este teste não deve fazer nenhuma
// chamada de rede real (ver instrução da Fatia 1: "não faça chamadas reais
// à OpenAI/Evolution nos testes"). `createMock` é reatribuído em
// `beforeEach` de cada teste via `mockImplementationOnce`/`mockResolvedValueOnce`.
const createMock = vi.fn();
class OpenAiClienteFalso {
  chat = { completions: { create: createMock } };
}
vi.mock("openai", () => ({ default: OpenAiClienteFalso }));

const { OpenAiProvider } = await import("../../src/modules/whatsapp/llm/openai");

function completion(conteudo: string | null, finishReason = "stop") {
  return { choices: [{ message: { content: conteudo }, finish_reason: finishReason }] };
}

describe("OpenAiProvider.gerarResposta", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("chama o modelo gpt-4.1-mini com o systemPrompt e o histórico mapeado para user/assistant", async () => {
    createMock.mockResolvedValueOnce(completion("Claro, posso ajudar!"));
    const provider = new OpenAiProvider("chave-teste");

    await provider.gerarResposta({
      systemPrompt: "Você é a Ana, atendente virtual.",
      historico: [
        { autor: "CLIENTE", texto: "Oi" },
        { autor: "IA", texto: "Olá! Como posso ajudar?" },
        { autor: "HUMANO", texto: "Aqui é o vendedor, um momento" },
        { autor: "CLIENTE", texto: "Quero saber do Gol 2018" },
      ],
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const chamada = createMock.mock.calls[0]?.[0];
    expect(chamada.model).toBe("gpt-4.1-mini");
    expect(chamada.messages).toEqual([
      { role: "system", content: "Você é a Ana, atendente virtual." },
      { role: "user", content: "Oi" },
      { role: "assistant", content: "Olá! Como posso ajudar?" },
      { role: "assistant", content: "Aqui é o vendedor, um momento" }, // HUMANO também vira "assistant"
      { role: "user", content: "Quero saber do Gol 2018" },
    ]);
  });

  it("devolve uma única mensagem quando a resposta não tem linha em branco", async () => {
    createMock.mockResolvedValueOnce(completion("Resposta de uma linha só."));
    const provider = new OpenAiProvider("chave-teste");

    const resultado = await provider.gerarResposta({ systemPrompt: "sistema", historico: [] });

    expect(resultado.mensagens).toEqual(["Resposta de uma linha só."]);
  });

  it("separa a resposta em múltiplas mensagens quando o modelo usa linha em branco como separador", async () => {
    createMock.mockResolvedValueOnce(
      completion("Oi! Tudo bem?\n\nTemos sim esse modelo em estoque.\n\nQuer agendar uma visita?")
    );
    const provider = new OpenAiProvider("chave-teste");

    const resultado = await provider.gerarResposta({ systemPrompt: "sistema", historico: [] });

    expect(resultado.mensagens).toEqual([
      "Oi! Tudo bem?",
      "Temos sim esse modelo em estoque.",
      "Quer agendar uma visita?",
    ]);
  });

  it("lança um erro legível quando a OpenAI devolve conteúdo vazio", async () => {
    createMock.mockResolvedValueOnce(completion(null, "content_filter"));
    const provider = new OpenAiProvider("chave-teste");

    await expect(provider.gerarResposta({ systemPrompt: "sistema", historico: [] })).rejects.toThrow(
      /content_filter/
    );
  });
});
