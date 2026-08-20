// Sem Prisma nem "server-only" — EvolutionGateway (gateway/evolution.ts) não
// importa nenhum dos dois. Quem tem "server-only" é a porta do pacote
// (gateway/index.ts) e a fábrica que ela reexporta, e nenhuma das duas é
// tocada aqui de propósito: testar a classe direto mantém este arquivo livre
// de banco e de credencial, e por isso ele não precisou mudar quando a
// credencial saiu do ambiente e foi para WhatsappConnection (Ciclo 2a).
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

// ---------------------------------------------------------------------------
// Invólucros de mensagem (ephemeral / viewOnce / documentWithCaption / edited)
// ---------------------------------------------------------------------------
//
// Fonte das expectativas abaixo, medida (não presumida):
//
// - baileys 7.0.0-rc.9, `lib/Utils/messages.js:598-619` (`normalizeMessageContent`):
//   a lista de invólucros é exatamente `ephemeralMessage`, `viewOnceMessage`,
//   `documentWithCaptionMessage`, `viewOnceMessageV2`,
//   `viewOnceMessageV2Extension`, `editedMessage`, com teto de 5 iterações.
// - baileys 7.0.0-rc.9, `lib/Utils/messages.js:585-591` (`getContentType`):
//   o tipo de conteúdo é a PRIMEIRA chave que seja `conversation` ou contenha
//   `Message`, excluída `senderKeyDistributionMessage`.
// - evolution-api 2.3.7, `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts:4652`
//   (`prepareMessage`): monta o payload do webhook com `getContentType` puro e
//   copia `message.message` inteiro, sem `normalizeMessageContent` (0 ocorrências
//   em todo o `src/` da tag 2.3.7) — logo o invólucro chega até nós.
//
// Cada afirmação universal do comentário em `gateway/evolution.ts` tem caso
// aqui: a lista completa de invólucros, o aninhamento, o teto, o invólucro
// malformado, a exclusão de `senderKeyDistributionMessage` e a preservação
// integral do caminho sem invólucro.

/** Payload messages.upsert com um `message` arbitrário e o `messageType` que a Evolution mandaria. */
function payloadComMensagem(message: unknown, messageType: string) {
  const payload = payloadTexto({ messageType });
  payload.data.message = message as never;
  return payload;
}

/** Envolve um conteúdo de mensagem numa das chaves de invólucro do Baileys. */
function envolver(chave: string, conteudo: unknown) {
  return { [chave]: { message: conteudo } };
}

const CHAVES_INVOLUCRO = [
  "ephemeralMessage",
  "viewOnceMessage",
  "documentWithCaptionMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
] as const;

describe("EvolutionGateway.normalizarEventos — invólucros de mensagem", () => {
  const gateway = new EvolutionGateway(CONFIG);

  it.each(CHAVES_INVOLUCRO)(
    "desembrulha texto simples dentro de %s e mapeia para TEXTO",
    (chave) => {
      const eventos = gateway.normalizarEventos(
        payloadComMensagem(envolver(chave, { conversation: "Bom dia, tem em estoque?" }), chave)
      );
      expect(eventos[0]).toMatchObject({ tipo: "TEXTO", texto: "Bom dia, tem em estoque?" });
    }
  );

  it.each(CHAVES_INVOLUCRO)(
    "desembrulha extendedTextMessage dentro de %s (a Evolution só achata o extendedText do NÍVEL RAIZ)",
    (chave) => {
      const eventos = gateway.normalizarEventos(
        payloadComMensagem(
          envolver(chave, { extendedTextMessage: { text: "Segue o link que você pediu" } }),
          chave
        )
      );
      expect(eventos[0]).toMatchObject({ tipo: "TEXTO", texto: "Segue o link que você pediu" });
    }
  );

  it("desembrulha imageMessage dentro de ephemeralMessage: tipo IMAGEM e legenda como texto", () => {
    const eventos = gateway.normalizarEventos(
      payloadComMensagem(
        envolver("ephemeralMessage", { imageMessage: { caption: "Olha esse carro" } }),
        "ephemeralMessage"
      )
    );
    expect(eventos[0]).toMatchObject({ tipo: "IMAGEM", texto: "Olha esse carro" });
  });

  it("desembrulha audioMessage dentro de viewOnceMessageV2: tipo AUDIO e texto nulo", () => {
    const eventos = gateway.normalizarEventos(
      payloadComMensagem(envolver("viewOnceMessageV2", { audioMessage: {} }), "viewOnceMessageV2")
    );
    expect(eventos[0]).toMatchObject({ tipo: "AUDIO", texto: null });
  });

  it("desembrulha documentWithCaptionMessage e extrai a legenda do documentMessage interno", () => {
    const eventos = gateway.normalizarEventos(
      payloadComMensagem(
        envolver("documentWithCaptionMessage", {
          documentMessage: { caption: "Proposta em anexo" },
        }),
        "documentWithCaptionMessage"
      )
    );
    expect(eventos[0]).toMatchObject({ tipo: "DOCUMENTO", texto: "Proposta em anexo" });
  });

  it("desembrulha invólucro aninhado (viewOnceMessageV2 dentro de ephemeralMessage)", () => {
    const eventos = gateway.normalizarEventos(
      payloadComMensagem(
        envolver(
          "ephemeralMessage",
          envolver("viewOnceMessageV2", { conversation: "some depois de ler" })
        ),
        "ephemeralMessage"
      )
    );
    expect(eventos[0]).toMatchObject({ tipo: "TEXTO", texto: "some depois de ler" });
  });

  it("desembrulha até 5 invólucros aninhados (o mesmo teto do normalizeMessageContent do Baileys)", () => {
    let conteudo: unknown = { conversation: "cinco camadas" };
    for (let i = 0; i < 5; i += 1) conteudo = envolver("ephemeralMessage", conteudo);

    const eventos = gateway.normalizarEventos(payloadComMensagem(conteudo, "ephemeralMessage"));
    expect(eventos[0]).toMatchObject({ tipo: "TEXTO", texto: "cinco camadas" });
  });

  it("para no teto: 6 invólucros aninhados viram OUTRO com texto nulo, sem lançar e sem laço infinito", () => {
    let conteudo: unknown = { conversation: "seis camadas" };
    for (let i = 0; i < 6; i += 1) conteudo = envolver("ephemeralMessage", conteudo);

    const payload = payloadComMensagem(conteudo, "ephemeralMessage");
    expect(() => gateway.normalizarEventos(payload)).not.toThrow();
    expect(gateway.normalizarEventos(payload)[0]).toMatchObject({ tipo: "OUTRO", texto: null });
  });

  it("trata invólucro vazio ou malformado como conteúdo desconhecido, sem lançar", () => {
    const casos: unknown[] = [
      { ephemeralMessage: {} },
      { ephemeralMessage: { message: null } },
      { ephemeralMessage: { message: "texto solto em vez de objeto" } },
      { ephemeralMessage: { message: [] } },
      { ephemeralMessage: null },
      { viewOnceMessageV2: { message: {} } },
    ];

    for (const caso of casos) {
      const payload = payloadComMensagem(caso, "ephemeralMessage");
      expect(() => gateway.normalizarEventos(payload)).not.toThrow();
      expect(gateway.normalizarEventos(payload)[0]).toMatchObject({ tipo: "OUTRO", texto: null });
    }
  });

  it("ignora senderKeyDistributionMessage ao derivar o tipo do miolo (mesma exclusão do getContentType)", () => {
    const eventos = gateway.normalizarEventos(
      payloadComMensagem(
        envolver("ephemeralMessage", {
          senderKeyDistributionMessage: { groupId: "x@g.us" },
          conversation: "oi de novo",
        }),
        "ephemeralMessage"
      )
    );
    expect(eventos[0]).toMatchObject({ tipo: "TEXTO", texto: "oi de novo" });
  });

  it("não confunde messageContextInfo com conteúdo ao derivar o tipo do miolo", () => {
    const eventos = gateway.normalizarEventos(
      payloadComMensagem(
        envolver("ephemeralMessage", {
          messageContextInfo: { deviceListMetadataVersion: 2 },
          conversation: "com contexto junto",
        }),
        "ephemeralMessage"
      )
    );
    expect(eventos[0]).toMatchObject({ tipo: "TEXTO", texto: "com contexto junto" });
  });

  it("mantém a política de OUTRO para tipo desconhecido DENTRO de invólucro (enquete efêmera)", () => {
    const eventos = gateway.normalizarEventos(
      payloadComMensagem(
        envolver("ephemeralMessage", { pollCreationMessage: { name: "Qual cor?" } }),
        "ephemeralMessage"
      )
    );
    expect(eventos[0]).toMatchObject({ tipo: "OUTRO", texto: null });
  });

  it("editedMessage desembrulha para protocolMessage e continua caindo em OUTRO (edição não é mensagem nova)", () => {
    const eventos = gateway.normalizarEventos(
      payloadComMensagem(
        envolver("editedMessage", {
          protocolMessage: { editedMessage: { conversation: "texto corrigido" } },
        }),
        "editedMessage"
      )
    );
    expect(eventos[0]).toMatchObject({ tipo: "OUTRO", texto: null });
  });

  it("aplica os filtros de fromMe e de grupo ANTES do desembrulho (invólucro não reabre nenhum dos dois)", () => {
    const efemera = envolver("ephemeralMessage", { conversation: "eco" });

    const eco = payloadComMensagem(efemera, "ephemeralMessage");
    eco.data.key.fromMe = true;
    expect(gateway.normalizarEventos(eco)).toEqual([]);

    const grupo = payloadComMensagem(efemera, "ephemeralMessage");
    grupo.data.key.remoteJid = "120363000000000000@g.us";
    expect(gateway.normalizarEventos(grupo)).toEqual([]);
  });
});

describe("EvolutionGateway.normalizarEventos — mensagens SEM invólucro seguem idênticas", () => {
  const gateway = new EvolutionGateway(CONFIG);

  it("conversation no nível raiz continua TEXTO com o texto intacto", () => {
    const eventos = gateway.normalizarEventos(payloadTexto({ texto: "Oi, tudo bem?" }));
    expect(eventos[0]).toMatchObject({ tipo: "TEXTO", texto: "Oi, tudo bem?" });
  });

  it("extendedTextMessage no nível raiz continua TEXTO com o texto intacto", () => {
    const eventos = gateway.normalizarEventos(
      payloadComMensagem(
        { extendedTextMessage: { text: "mensagem com link" } },
        "extendedTextMessage"
      )
    );
    expect(eventos[0]).toMatchObject({ tipo: "TEXTO", texto: "mensagem com link" });
  });

  it("imageMessage, audioMessage, documentMessage e stickerMessage no nível raiz mantêm tipo e texto", () => {
    expect(
      gateway.normalizarEventos(
        payloadComMensagem({ imageMessage: { caption: "legenda" } }, "imageMessage")
      )[0]
    ).toMatchObject({ tipo: "IMAGEM", texto: "legenda" });

    expect(
      gateway.normalizarEventos(payloadComMensagem({ audioMessage: {} }, "audioMessage"))[0]
    ).toMatchObject({ tipo: "AUDIO", texto: null });

    expect(
      gateway.normalizarEventos(
        payloadComMensagem({ documentMessage: { caption: "contrato" } }, "documentMessage")
      )[0]
    ).toMatchObject({ tipo: "DOCUMENTO", texto: "contrato" });

    expect(
      gateway.normalizarEventos(payloadComMensagem({ stickerMessage: {} }, "stickerMessage"))[0]
    ).toMatchObject({ tipo: "STICKER", texto: null });
  });

  it("messageType desconhecido no nível raiz continua caindo em OUTRO", () => {
    const eventos = gateway.normalizarEventos(
      payloadComMensagem({ pollCreationMessage: { name: "Qual cor?" } }, "pollCreationMessage")
    );
    expect(eventos[0]).toMatchObject({ tipo: "OUTRO", texto: null });
  });

  it("payload sem `message` nenhum continua sem lançar, com texto nulo", () => {
    const payload = payloadTexto();
    delete (payload.data as { message?: unknown }).message;
    expect(() => gateway.normalizarEventos(payload)).not.toThrow();
    expect(gateway.normalizarEventos(payload)[0]).toMatchObject({ tipo: "TEXTO", texto: null });
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

describe("a apikey nunca entra na mensagem de erro (Ciclo 2a)", () => {
  const APIKEY = "chave-secreta-da-instancia-9f3c1a2b";

  it("corpo de erro que ECOA a apikey sai redigido", async () => {
    // Isto não é hipótese: uma API que recusa autenticação frequentemente
    // devolve a credencial recebida no corpo do erro, e `enviarTexto` põe os
    // primeiros 500 caracteres do corpo dentro da mensagem lançada. Daí a
    // mensagem vai para `console.error` e para o Sentry.
    //
    // A defesa é EXATA e não heurística: o adaptador conhece a própria
    // apikey. Uma expressão regular não conseguiria — o formato da apikey da
    // Evolution não é fixo, e por isso `sentry-scrub.ts` não tem padrão para
    // ela.
    const gateway = new EvolutionGateway({
      domain: "https://evo.exemplo.com",
      instance: "instancia-teste",
      apiKey: APIKEY,
    });

    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ erro: "unauthorized", apikey: APIKEY }), {
        status: 401,
      })) as typeof fetch;

    try {
      await expect(gateway.enviarTexto("5511999998888", "oi")).rejects.toThrow(/\[apikey\]/);
      await expect(gateway.enviarTexto("5511999998888", "oi")).rejects.not.toThrow(
        new RegExp(APIKEY)
      );
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  });

  /** Constrói um gateway com a apikey dada e um fetch que responde 401 ecoando `corpo`. */
  function gatewayQueRecebe401(apiKey: string, corpo: string) {
    const gateway = new EvolutionGateway({
      domain: "https://evo.exemplo.com",
      instance: "instancia-teste",
      apiKey,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => corpo })
    );
    return gateway;
  }

  it("apikey com caractere de expressão regular dentro também sai redigida", async () => {
    // Esta é a prova de que `split`/`join` era necessário. A apikey é dado de
    // configuração: nada impede um `.`, um `+` ou um `$` nela. Montada numa
    // `new RegExp(apiKey)`, `a.b+c$d` casaria com quase nada do texto literal
    // — a redação passaria verde e a credencial sairia inteira no erro.
    const chaveEstranha = "a.b+c$d*e?f[g]^h";
    const gateway = gatewayQueRecebe401(
      chaveEstranha,
      JSON.stringify({ erro: "unauthorized", apikey: chaveEstranha })
    );

    try {
      await expect(gateway.enviarTexto("5511999998888", "oi")).rejects.toThrow(/\[apikey\]/);
      await expect(gateway.enviarTexto("5511999998888", "oi")).rejects.not.toThrow(chaveEstranha);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("apikey vazia devolve o corpo intacto, não uma fileira de [apikey]", async () => {
    // `"".split("")` estilhaça a string caractere a caractere; sem a guarda de
    // comprimento zero, `instância desconectada` viraria
    // `[apikey]i[apikey]n[apikey]s...` e o diagnóstico do erro morreria junto.
    // Apikey vazia não é hipótese acadêmica: é o estado de uma conexão recém
    // cadastrada cujo segredo ainda não foi preenchido.
    const gateway = gatewayQueRecebe401("", "instância desconectada");

    try {
      await expect(gateway.enviarTexto("5511999998888", "oi")).rejects.toThrow(
        "instância desconectada"
      );
      await expect(gateway.enviarTexto("5511999998888", "oi")).rejects.not.toThrow("[apikey]");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
