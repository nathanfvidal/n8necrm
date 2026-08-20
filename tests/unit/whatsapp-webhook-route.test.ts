// Teste de unidade puro (sem Prisma real, sem rede): mocka a resolução de
// conexão, a fábrica de gateway, o ingest, a fila e o rate limit para isolar a
// ROTA — mesmo padrão de tests/unit/export-leads.test.ts.
//
// O que este arquivo deixou de mockar no Ciclo 2a: `@/modules/whatsapp/gateway`
// (o singleton com `EVOLUTION_*` validado no import) saiu, e no lugar entrou
// `@/modules/whatsapp/gateway/fabrica`, que constrói o gateway a partir da
// CONEXÃO resolvida. É a mudança inteira do ciclo, vista de dentro do teste: a
// rota não conhece mais nenhuma credencial de ambiente.
import { describe, it, expect, vi, beforeEach } from "vitest";

const EMPRESA = "cmp_a";
const TOKEN = "a".repeat(64);

const checarRateLimitMock = vi.fn();
vi.mock("@/core/rate-limit/limiter", () => ({
  checarRateLimit: (...a: unknown[]) => checarRateLimitMock(...a),
}));

const resolverConexaoPorWebhookMock = vi.fn();
vi.mock("@/core/conexoes/leitura", () => ({
  resolverConexaoPorWebhook: (...a: unknown[]) => resolverConexaoPorWebhookMock(...a),
}));

const verificarOrigemMock = vi.fn();
const normalizarEventosMock = vi.fn();
const gatewayDaCredencialMock = vi.fn();
vi.mock("@/modules/whatsapp/gateway/fabrica", () => ({
  gatewayDaCredencial: (...a: unknown[]) => gatewayDaCredencialMock(...a),
}));

const ingerirMensagemMock = vi.fn();
vi.mock("@/modules/whatsapp/ingest", () => ({
  ingerirMensagem: (...a: unknown[]) => ingerirMensagemMock(...a),
}));

const publicarTurnoMock = vi.fn();
vi.mock("@/modules/whatsapp/fila", () => ({
  publicarTurno: (...a: unknown[]) => publicarTurnoMock(...a),
}));

// A rota importa `DuplicateMessageError` de "@vercel/queue" (não de fila.ts)
// para reconhecer especificamente esse erro vindo de `publicarTurno` (mockado
// acima) — usamos a classe REAL do pacote: importar só a classe de erro não
// toca rede nem exige env nenhuma, ao contrário de `send`/`handleCallback`.
const { DuplicateMessageError } = await import("@vercel/queue");
const { POST } = await import(
  "../../src/app/api/whatsapp/evolution/[companyId]/[token]/route"
);

/**
 * A credencial que `resolverConexaoPorWebhook` devolve — `CredencialDeConexao`
 * com a apikey JÁ decifrada. O valor aqui é inventado e curto de propósito:
 * nenhum segredo real entra em arquivo de teste.
 */
const CRED = {
  id: "conn_1",
  companyId: EMPRESA,
  canal: "EVOLUTION" as const,
  dominio: "https://evo.exemplo.com",
  instancia: "inst-1",
  apiKey: "apikey-1a2b",
};

/** O resultado de `ingerirMensagem` no formato do Ciclo 2a — com `connectionId`. */
function resultadoIngestao(overrides: Record<string, unknown> = {}) {
  return {
    companyId: EMPRESA,
    connectionId: "conn_1",
    conversationId: "conv-1",
    bufferSeq: 1,
    duplicada: false,
    ...overrides,
  };
}

function eventoNormalizado(idExterno: string, texto = "oi") {
  return {
    idExterno,
    waId: "5511999998888",
    nomeExibicao: null,
    tipo: "TEXTO",
    texto,
    timestamp: new Date(),
  };
}

function requestComCorpo(corpo: unknown, ip = "203.0.113.10") {
  return new Request("https://crm.exemplo.com/api/whatsapp/evolution/x/y", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(corpo),
  });
}

function chamar(request: Request, companyId = EMPRESA, token = TOKEN) {
  return POST(request, { params: Promise.resolve({ companyId, token }) });
}

beforeEach(() => {
  checarRateLimitMock.mockReset().mockResolvedValue(true);
  resolverConexaoPorWebhookMock.mockReset().mockResolvedValue(CRED);
  verificarOrigemMock.mockReset().mockReturnValue(true);
  normalizarEventosMock.mockReset().mockReturnValue([]);
  gatewayDaCredencialMock.mockReset().mockReturnValue({
    verificarOrigem: (...a: unknown[]) => verificarOrigemMock(...a),
    normalizarEventos: (...a: unknown[]) => normalizarEventosMock(...a),
  });
  ingerirMensagemMock.mockReset();
  publicarTurnoMock.mockReset().mockResolvedValue(undefined);
});

describe("resolução da conexão — é ela que substitui EVOLUTION_COMPANY_ID", () => {
  it("resolve pela empresa do path E pelo token, nessa ordem de argumentos", async () => {
    await chamar(requestComCorpo({ instance: "inst-1" }));
    expect(resolverConexaoPorWebhookMock).toHaveBeenCalledWith(EMPRESA, TOKEN);
  });

  it("token desconhecido devolve 404 — e o gateway NUNCA é construído", async () => {
    resolverConexaoPorWebhookMock.mockResolvedValue(null);
    const resposta = await chamar(requestComCorpo({ instance: "inst-1" }));
    // 404 e não 401/403: não confirma, a quem tenta adivinhar, que este path
    // sequer existe. Mesma política do token do Ciclo 1.
    expect(resposta.status).toBe(404);
    expect(gatewayDaCredencialMock).not.toHaveBeenCalled();
    expect(ingerirMensagemMock).not.toHaveBeenCalled();
  });

  it("token de A com companyId de B devolve 404, porque a busca é ESCOPADA", async () => {
    // O `companyId` do path é HIPÓTESE, não autoridade: quem manda é o token.
    // Este caso prova a metade que importa na rota; a metade contra Postgres
    // real é `tests/unit/conexoes-isolamento.test.ts`.
    resolverConexaoPorWebhookMock.mockImplementation(async (companyId: string) =>
      companyId === EMPRESA ? CRED : null
    );
    expect((await chamar(requestComCorpo({ instance: "inst-1" }), "cmp_b")).status).toBe(404);
  });

  it(
    "a resposta de 'token de outra empresa' é INDISTINGUÍVEL da de 'não existe' — status, corpo e " +
      "cabeçalhos",
    async () => {
      // Uma diferença qualquer entre as duas — um status, uma palavra no corpo,
      // um header — vira oráculo: quem sonda descobre que ACERTOU o token e
      // errou só a empresa, e passa a enumerar empresas em vez de tokens. As
      // duas recusas saem do MESMO `return` na rota, e este caso é o que
      // impede alguém de "melhorar a mensagem de erro" e reabrir isso.
      resolverConexaoPorWebhookMock.mockImplementation(async (companyId: string) =>
        companyId === EMPRESA ? CRED : null
      );
      const empresaErrada = await chamar(requestComCorpo({ instance: "inst-1" }), "cmp_b");

      resolverConexaoPorWebhookMock.mockResolvedValue(null);
      const tokenInexistente = await chamar(requestComCorpo({ instance: "inst-1" }));

      expect(empresaErrada.status).toBe(tokenInexistente.status);
      expect(await empresaErrada.clone().text()).toBe(await tokenInexistente.clone().text());
      expect([...empresaErrada.headers].sort()).toEqual([...tokenInexistente.headers].sort());
    }
  );

  it("constrói o gateway a partir da CONEXÃO resolvida, não de variável de ambiente", async () => {
    await chamar(requestComCorpo({ instance: "inst-1" }));
    expect(gatewayDaCredencialMock).toHaveBeenCalledWith(CRED);
  });

  it("instância desconhecida devolve 403 e não escreve nada", async () => {
    verificarOrigemMock.mockReturnValue(false);
    const resposta = await chamar(requestComCorpo({ instance: "instancia-de-outro" }));
    expect(resposta.status).toBe(403);
    expect(ingerirMensagemMock).not.toHaveBeenCalled();
  });

  it("passa companyId E connectionId da conexão para a ingestão", async () => {
    normalizarEventosMock.mockReturnValue([eventoNormalizado("m1")]);
    ingerirMensagemMock.mockResolvedValue(resultadoIngestao());

    await chamar(requestComCorpo({ instance: "inst-1" }));

    expect(ingerirMensagemMock).toHaveBeenCalledWith(expect.objectContaining({ idExterno: "m1" }), {
      companyId: EMPRESA,
      connectionId: "conn_1",
    });
  });

  it(
    "a SEGUNDA METADE: o webhook legítimo entrega a mensagem na empresa CERTA, de ponta a ponta — " +
      "sem este caso, uma rota que recusasse tudo passaria por 'isolada'",
    async () => {
      resolverConexaoPorWebhookMock.mockImplementation(async (companyId: string, token: string) =>
        companyId === EMPRESA && token === TOKEN ? CRED : null
      );
      normalizarEventosMock.mockReturnValue([eventoNormalizado("m1")]);
      ingerirMensagemMock.mockResolvedValue(resultadoIngestao());

      const resposta = await chamar(requestComCorpo({ instance: "inst-1" }));

      expect(resposta.status).toBe(200);
      expect((await resposta.json()) as { ok: boolean }).toEqual({ ok: true });
      // A empresa que chega na fila é a da CONEXÃO, não a do path por si só —
      // aqui elas coincidem porque a combinação é legítima, e é justamente essa
      // coincidência que o caminho feliz tem de produzir.
      expect(publicarTurnoMock).toHaveBeenCalledWith({
        companyId: EMPRESA,
        conversationId: "conv-1",
        seq: 1,
      });
    }
  );

  it("a empresa publicada na fila vem da CONEXÃO, mesmo que o path diga outra coisa", async () => {
    // Blindagem contra a regressão que esvaziaria o ciclo: alguém trocando
    // `conexao.companyId` por `companyId` do path "porque dá no mesmo". Não dá:
    // aqui o resolvedor devolve, de propósito, uma conexão de OUTRA empresa, e
    // é ela que tem de mandar. No banco real essa combinação nunca aparece (a
    // busca é escopada), e é por isso que só um mock consegue exercitá-la.
    resolverConexaoPorWebhookMock.mockResolvedValue({ ...CRED, companyId: "cmp_da_conexao" });
    normalizarEventosMock.mockReturnValue([eventoNormalizado("m1")]);
    ingerirMensagemMock.mockResolvedValue(resultadoIngestao({ companyId: "cmp_da_conexao" }));

    await chamar(requestComCorpo({ instance: "inst-1" }), "cmp_do_path");

    expect(ingerirMensagemMock).toHaveBeenCalledWith(expect.anything(), {
      companyId: "cmp_da_conexao",
      connectionId: "conn_1",
    });
    expect(publicarTurnoMock).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "cmp_da_conexao" })
    );
  });

  it("o rate limit é consultado ANTES de resolver a conexão", async () => {
    // Resolver a conexão é uma ida ao banco. Deixá-la antes do rate limit
    // daria a quem descobriu o path uma consulta por requisição de graça.
    checarRateLimitMock.mockResolvedValue(false);
    const resposta = await chamar(requestComCorpo({ instance: "inst-1" }));
    expect(resposta.status).toBe(429);
    expect(resolverConexaoPorWebhookMock).not.toHaveBeenCalled();
  });

  it("devolve 200 (ack) para JSON malformado, sem resolver conexão nenhuma", async () => {
    const request = new Request("https://crm.exemplo.com/api/whatsapp/evolution/x/y", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
      body: "{ nao é json",
    });
    const resposta = await chamar(request);
    expect(resposta.status).toBe(200);
    expect(resolverConexaoPorWebhookMock).not.toHaveBeenCalled();
  });
});

describe("rate limit por IP", () => {
  it("devolve 429 quando o rate limit por IP estoura", async () => {
    checarRateLimitMock.mockResolvedValue(false);
    const resposta = await chamar(requestComCorpo({}));
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
      await chamar(requestComCorpo({}));
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
      const request = new Request("https://crm.exemplo.com/api/whatsapp/evolution/x/y", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.9", // forjável, deveria ser ignorado quando o outro header existe
          "x-vercel-forwarded-for": "203.0.113.55",
        },
        body: JSON.stringify({}),
      });

      await chamar(request);

      expect(checarRateLimitMock).toHaveBeenCalledWith(
        "whatsapp:webhook:203.0.113.55",
        expect.any(Number),
        expect.any(Number)
      );
    }
  );
});

describe("ingestão e publicação de turno", () => {
  it("ingere cada evento normalizado e publica um turno para cada um que não é duplicado", async () => {
    normalizarEventosMock.mockReturnValue([
      eventoNormalizado("1", "oi"),
      eventoNormalizado("2", "tudo bem?"),
    ]);
    ingerirMensagemMock
      .mockResolvedValueOnce(resultadoIngestao({ bufferSeq: 1 }))
      .mockResolvedValueOnce(resultadoIngestao({ bufferSeq: 2 }));

    const resposta = await chamar(requestComCorpo({ instance: "inst-1" }));

    expect(resposta.status).toBe(200);
    expect(ingerirMensagemMock).toHaveBeenCalledTimes(2);
    expect(publicarTurnoMock).toHaveBeenCalledTimes(2);
    expect(publicarTurnoMock).toHaveBeenNthCalledWith(1, {
      companyId: EMPRESA,
      conversationId: "conv-1",
      seq: 1,
    });
    expect(publicarTurnoMock).toHaveBeenNthCalledWith(2, {
      companyId: EMPRESA,
      conversationId: "conv-1",
      seq: 2,
    });
  });

  it(
    "fix round 1/5 (achado I3): TAMBÉM publica turno para um evento que a ingestão reconheceu como " +
      "redelivery duplicada — antes deste fix, pular a publicação nesse caminho era exatamente o que " +
      "deixava uma mensagem cujo enfileiramento original tivesse falhado PRESA para sempre (a redelivery " +
      "nunca tentava de novo). A idempotencyKey da fila já torna essa republicação segura.",
    async () => {
      normalizarEventosMock.mockReturnValue([eventoNormalizado("1")]);
      ingerirMensagemMock.mockResolvedValue(resultadoIngestao({ duplicada: true }));

      const resposta = await chamar(requestComCorpo({ instance: "inst-1" }));

      expect(resposta.status).toBe(200);
      expect(publicarTurnoMock).toHaveBeenCalledTimes(1);
      expect(publicarTurnoMock).toHaveBeenCalledWith({
        companyId: EMPRESA,
        conversationId: "conv-1",
        seq: 1,
      });
    }
  );

  it(
    "trata DuplicateMessageError vindo de publicarTurno como esperado (200), não como falha — é o caminho " +
      "normal quando o job para este bufferSeq já tinha sido publicado antes",
    async () => {
      normalizarEventosMock.mockReturnValue([eventoNormalizado("1")]);
      ingerirMensagemMock.mockResolvedValue(resultadoIngestao({ duplicada: true }));
      publicarTurnoMock.mockRejectedValueOnce(new DuplicateMessageError("dup", "conv-1:1"));

      const resposta = await chamar(requestComCorpo({ instance: "inst-1" }));

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
      normalizarEventosMock.mockReturnValue([eventoNormalizado("1")]);
      ingerirMensagemMock.mockResolvedValue(resultadoIngestao());
      publicarTurnoMock.mockRejectedValueOnce(new Error("fila indisponível"));

      const resposta = await chamar(requestComCorpo({ instance: "inst-1" }));

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
        eventoNormalizado("1", "a"),
        eventoNormalizado("2", "b"),
      ]);
      ingerirMensagemMock
        .mockRejectedValueOnce(new Error("banco fora do ar"))
        .mockResolvedValueOnce(resultadoIngestao());

      const resposta = await chamar(requestComCorpo({ instance: "inst-1" }));

      expect(resposta.status).toBe(500);
      expect(ingerirMensagemMock).toHaveBeenCalledTimes(2);
      // O 2º evento (que não falhou) ainda foi processado e publicado —
      // uma falha não interrompe os demais.
      expect(publicarTurnoMock).toHaveBeenCalledTimes(1);
    }
  );

  it("devolve 200 (ack) para um payload que normaliza para zero eventos (ex.: connection.update)", async () => {
    normalizarEventosMock.mockReturnValue([]);
    const resposta = await chamar(
      requestComCorpo({ instance: "inst-1", event: "connection.update" })
    );
    expect(resposta.status).toBe(200);
    expect(ingerirMensagemMock).not.toHaveBeenCalled();
  });
});

/**
 * A varredura de FONTE que impede a ponte de voltar por um "só enquanto isso".
 *
 * `EVOLUTION_COMPANY_ID` era ⚠️ R5 da auditoria do Ciclo 1a. O caso irmão em
 * `whatsapp-ingest.test.ts` cobre `ingest.ts`; este cobre a árvore da rota, que
 * é o outro lugar onde a variável poderia reaparecer — e afirma, junto, que a
 * rota ANTIGA (`[token]` sem `[companyId]`) não está mais lá: as duas
 * coexistindo significariam dois caminhos de autenticação para a mesma coisa,
 * um deles com o token do deploy inteiro.
 *
 * A guarda é sobre LER, não sobre citar, pelo mesmo motivo do caso irmão: o
 * defeito é a configuração do webhook voltar a sair do deploy, não a história
 * ser contada. Por isso ela bane `process.env` inteiro desta árvore, o que
 * também pega uma variável nova com outro nome — que é a forma como esta dívida
 * voltaria.
 */
describe("varredura de fonte: a ponte do Ciclo 1a não voltou", () => {
  const RAIZ = "src/app/api/whatsapp";

  async function arquivosDaArvore(dir: string): Promise<string[]> {
    const { readdirSync } = await import("node:fs");
    const encontrados: string[] = [];
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const caminho = `${dir}/${entrada.name}`;
      if (entrada.isDirectory()) encontrados.push(...(await arquivosDaArvore(caminho)));
      else if (entrada.name.endsWith(".ts")) encontrados.push(caminho);
    }
    return encontrados;
  }

  it("a varredura MORDE: acha os arquivos, lê conteúdo e sabe acusar a string", async () => {
    // Sem esta prova, um caminho errado devolveria lista vazia e os dois casos
    // abaixo ficariam verdes para sempre sem terem olhado nada.
    const arquivos = await arquivosDaArvore(RAIZ);
    expect(arquivos.length).toBeGreaterThan(0);
    expect(arquivos.some((a) => a.includes("[companyId]"))).toBe(true);

    const acusa = (texto: string) => texto.includes("process.env");
    expect(acusa("const x = process.env.EVOLUTION_COMPANY_ID;")).toBe(true);
    expect(acusa("const x = umaFuncao(EVOLUTION_COMPANY_ID);")).toBe(false);
  });

  it("nenhum arquivo sob /api/whatsapp LÊ `process.env` — nem esta variável, nem prima dela", async () => {
    const { readFileSync } = await import("node:fs");
    const arquivos = await arquivosDaArvore(RAIZ);
    // Guarda de que a leitura aconteceu: a rota nova É citada abaixo por nome,
    // então a lista não pode estar vazia nem cheia de arquivo errado.
    expect(arquivos).toContain(`${RAIZ}/evolution/[companyId]/[token]/route.ts`);

    const culpados = arquivos.filter((a) => readFileSync(a, "utf8").includes("process.env"));
    expect(culpados).toEqual([]);
  });

  it("a rota antiga `[token]` sem `[companyId]` não existe mais", async () => {
    const { existsSync } = await import("node:fs");
    expect(existsSync(`${RAIZ}/evolution/[token]`)).toBe(false);
    expect(existsSync(`${RAIZ}/evolution/[companyId]/[token]/route.ts`)).toBe(true);
  });
});
