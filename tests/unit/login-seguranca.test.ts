import { describe, it, expect, beforeEach, vi } from "vitest";

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server" que o Next.js aplica no build — fora desse pipeline (aqui,
// sob Vitest) ele sempre lança (ver tests/unit/storage.test.ts, onde este
// mock foi documentado pela primeira vez). `src/core/auth/credenciais.ts`
// importa `src/lib/prisma.ts`, que tem `import "server-only"`.
vi.mock("server-only", () => ({}));

// O limiter de verdade fala com o Postgres; aqui interessa a LÓGICA que o
// envolve (ordem das dimensões, formato da chave), não o SQL — esse já é
// coberto contra o banco real em tests/unit/rate-limit.test.ts, inclusive a
// atomicidade sob concorrência.
const checarRateLimitMock = vi.fn<(chave: string, limite: number, janelaMs: number) => Promise<boolean>>();
vi.mock("../../src/core/rate-limit/limiter", () => ({
  checarRateLimit: (chave: string, limite: number, janelaMs: number) =>
    checarRateLimitMock(chave, limite, janelaMs),
}));

const findUniqueMock = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: (...a: unknown[]) => findUniqueMock(...a) } } }));
vi.mock("../../src/lib/prisma", () => ({
  prisma: { user: { findUnique: (...a: unknown[]) => findUniqueMock(...a) } },
}));

const compareMock = vi.fn();
vi.mock("bcryptjs", () => ({ default: { compare: (...a: unknown[]) => compareMock(...a) } }));

// A auditoria de login (Fase 2 da auditoria de 2026-08-21) e mockada aqui de
// proposito. O que interessa NESTE arquivo e QUANDO cada uma e chamada -- a
// simetria entre conta existente e inexistente e a ausencia de escrita no
// caminho de falha. O que a linha gravada REALMENTE contem depois de chegar no
// Postgres esta em `tests/unit/auditoria-login.test.ts`, contra o banco de
// verdade, porque `AuditLog.companyId` e NOT NULL e um mock com a forma do
// delegate fica verde recebendo `undefined`.
const auditarLoginMock = vi.fn();
const tentativaRecusadaMock = vi.fn();
vi.mock("../../src/core/auth/auditoria-login", () => ({
  ACAO_LOGIN: "login",
  ACAO_LOGOUT: "logout",
  PREFIXO_TENTATIVA_RECUSADA: "[auditoria] login recusado",
  auditarLogin: (...a: unknown[]) => auditarLoginMock(...a),
  auditarLogout: vi.fn(),
  registrarTentativaRecusada: (...a: unknown[]) => tentativaRecusadaMock(...a),
}));

const {
  checarLimiteLogin,
  LIMITE_LOGIN_POR_IP,
  LIMITE_LOGIN_POR_CONTA,
  JANELA_LOGIN_MS,
} = await import("../../src/core/rate-limit/login");

const chavesUsadas = () => checarRateLimitMock.mock.calls.map((c) => c[0]);

describe("checarLimiteLogin", () => {
  beforeEach(() => {
    checarRateLimitMock.mockReset();
    checarRateLimitMock.mockResolvedValue(true);
  });

  it("consome as duas dimensões — IP e conta — quando ambas estão dentro do limite", async () => {
    const resultado = await checarLimiteLogin("203.0.113.10", "alguem@exemplo.com");

    expect(resultado).toEqual({ permitido: true });
    expect(checarRateLimitMock).toHaveBeenCalledTimes(2);
    expect(checarRateLimitMock).toHaveBeenNthCalledWith(
      1,
      "login:ip:203.0.113.10",
      LIMITE_LOGIN_POR_IP,
      JANELA_LOGIN_MS
    );
    expect(checarRateLimitMock).toHaveBeenNthCalledWith(
      2,
      "login:conta:alguem@exemplo.com",
      LIMITE_LOGIN_POR_CONTA,
      JANELA_LOGIN_MS
    );
  });

  it("o limite por conta é mais apertado que o por IP (um NAT de escritório é um IP só)", () => {
    expect(LIMITE_LOGIN_POR_CONTA).toBeLessThan(LIMITE_LOGIN_POR_IP);
  });

  it("bloqueia pelo IP e, nesse caso, NÃO consome a cota da conta", async () => {
    // Se o IP bloqueado ainda gastasse o balde do e-mail, um atacante já
    // barrado conseguiria manter a vítima trancada fora da própria conta —
    // o limite viraria arma contra quem ele existe para proteger.
    checarRateLimitMock.mockResolvedValueOnce(false);

    const resultado = await checarLimiteLogin("203.0.113.10", "vitima@exemplo.com");

    expect(resultado).toEqual({ permitido: false, dimensao: "ip" });
    expect(checarRateLimitMock).toHaveBeenCalledTimes(1);
    expect(chavesUsadas()).not.toContain("login:conta:vitima@exemplo.com");
  });

  it("bloqueia pela conta quando o IP passa mas o e-mail estourou", async () => {
    checarRateLimitMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const resultado = await checarLimiteLogin("203.0.113.10", "alvo@exemplo.com");

    expect(resultado).toEqual({ permitido: false, dimensao: "conta" });
  });

  it("normaliza caixa e espaços na chave da conta, para variar a grafia não render balde novo", async () => {
    await checarLimiteLogin("203.0.113.10", "  Alguem@Exemplo.COM  ");

    expect(chavesUsadas()[1]).toBe("login:conta:alguem@exemplo.com");
  });

  it("corta e-mail absurdamente longo — `RateLimit.chave` é PRIMARY KEY e o índice btree tem teto", async () => {
    // Sem o corte, um POST público com um "e-mail" de 10 KB derruba o INSERT
    // com erro de tamanho de linha de índice e vira 500 num endpoint aberto.
    await checarLimiteLogin("203.0.113.10", `${"a".repeat(10_000)}@exemplo.com`);

    const chaveDaConta = chavesUsadas()[1]!;
    expect(chaveDaConta.length).toBeLessThanOrEqual("login:conta:".length + 200);
  });
});

describe("autorizarCredenciais — o limite roda antes do banco e do bcrypt", () => {
  const requisicao = (ip = "203.0.113.77") =>
    new Request("https://crm.exemplo.com/api/auth/callback/credentials", {
      method: "POST",
      headers: { "x-vercel-forwarded-for": ip },
    });

  beforeEach(() => {
    checarRateLimitMock.mockReset();
    checarRateLimitMock.mockResolvedValue(true);
    findUniqueMock.mockReset();
    compareMock.mockReset();
  });

  it("lança MuitasTentativasDeLoginError e NÃO consulta o usuário quando o limite estourou", async () => {
    const { autorizarCredenciais, MuitasTentativasDeLoginError } = await import(
      "../../src/core/auth/credenciais"
    );
    checarRateLimitMock.mockResolvedValueOnce(false);

    await expect(
      autorizarCredenciais({ email: "admin@exemplo.com", senha: "chute" }, requisicao())
    ).rejects.toBeInstanceOf(MuitasTentativasDeLoginError);

    // O ponto do achado: força bruta tem que sair cara para o atacante. Se o
    // findUnique/bcrypt rodassem antes, o limite economizaria só a resposta,
    // não o trabalho.
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(compareMock).not.toHaveBeenCalled();
  });

  it("usa o IP não forjável (x-vercel-forwarded-for) como chave, não o x-forwarded-for do cliente", async () => {
    const { autorizarCredenciais } = await import("../../src/core/auth/credenciais");
    findUniqueMock.mockResolvedValue(null);

    const request = new Request("https://crm.exemplo.com/api/auth/callback/credentials", {
      method: "POST",
      headers: {
        "x-forwarded-for": "198.51.100.9", // forjável: deve ser ignorado
        "x-vercel-forwarded-for": "203.0.113.55",
      },
    });
    await autorizarCredenciais({ email: "a@b.com", senha: "x" }, request);

    expect(chavesUsadas()[0]).toBe("login:ip:203.0.113.55");
  });

  it("consome a cota da conta mesmo quando o e-mail não existe — senão o bloqueio vira oráculo de enumeração", async () => {
    const { autorizarCredenciais } = await import("../../src/core/auth/credenciais");
    findUniqueMock.mockResolvedValue(null);

    const resultado = await autorizarCredenciais(
      { email: "nao-existe-zzz@exemplo.com", senha: "x" },
      requisicao()
    );

    expect(resultado).toBeNull();
    expect(chavesUsadas()).toContain("login:conta:nao-existe-zzz@exemplo.com");
  });

  it("não consome cota nenhuma quando o corpo tem tipo errado (rejeitado antes, sem custo)", async () => {
    const { autorizarCredenciais } = await import("../../src/core/auth/credenciais");

    const resultado = await autorizarCredenciais({ email: ["a"], senha: {} }, requisicao());

    expect(resultado).toBeNull();
    expect(checarRateLimitMock).not.toHaveBeenCalled();
  });
});

describe("autorizarCredenciais — tempo de resposta não revela se a conta existe", () => {
  const requisicao = () =>
    new Request("https://crm.exemplo.com/api/auth/callback/credentials", {
      method: "POST",
      headers: { "x-vercel-forwarded-for": "203.0.113.88" },
    });

  // Sem `papel`: a coluna `User.papel` foi derrubada no Ciclo 1f
  // (`20260821130000_derruba_user_papel_de_vez`) e o papel mora em
  // `Membership`. Esta frase creditava o DROP ao Ciclo 1a e ficou errada por
  // dois dias — o Ciclo 1a derrubou e RESTAUROU a coluna no mesmo dia.
  // `autorizarCredenciais` nunca leu o campo, nem antes nem depois, então o
  // mock reflete o que `prisma.user.findUnique` devolve de verdade hoje.
  const usuarioAtivo = {
    id: "u1",
    nome: "Fulano",
    email: "existe@exemplo.com",
    senhaHash: "$2b$10$hashRealDeMentiraParaOTeste......................",
    ativo: true,
    // O vinculo passou a vir na MESMA consulta (Fase 2 da auditoria de
    // 2026-08-21): ele e a unica origem sa do `companyId` da linha de
    // auditoria de login, e traze-lo aqui evita uma segunda ida ao banco
    // dentro do caminho de login. `prisma.company.findFirst()` esta proibido
    // (`core/users/empresa.ts`).
    memberships: [{ companyId: "empresa-1" }],
  };

  beforeEach(() => {
    checarRateLimitMock.mockReset();
    checarRateLimitMock.mockResolvedValue(true);
    findUniqueMock.mockReset();
    compareMock.mockReset();
    compareMock.mockResolvedValue(false);
    auditarLoginMock.mockReset();
    tentativaRecusadaMock.mockReset();
  });

  it("compara a senha MESMO quando o e-mail não existe — sair antes é o que vaza o tempo", async () => {
    const { autorizarCredenciais } = await import("../../src/core/auth/credenciais");
    findUniqueMock.mockResolvedValue(null);

    const resultado = await autorizarCredenciais(
      { email: "nao-existe@exemplo.com", senha: "chute" },
      requisicao()
    );

    expect(resultado).toBeNull();
    // O ponto do achado: sem esta chamada, e-mail inexistente responde ~3x
    // mais rápido e o atacante separa contas reais das inventadas.
    expect(compareMock).toHaveBeenCalledTimes(1);
  });

  it("o hash inerte tem o MESMO custo bcrypt dos hashes reais ($2b$10$)", async () => {
    const { autorizarCredenciais } = await import("../../src/core/auth/credenciais");
    findUniqueMock.mockResolvedValue(null);

    await autorizarCredenciais({ email: "nao-existe@exemplo.com", senha: "x" }, requisicao());

    const hashUsado = compareMock.mock.calls[0]![1] as string;
    // Custo menor aqui recriaria exatamente a diferença de tempo que este
    // hash existe para apagar.
    expect(hashUsado).toMatch(/^\$2b\$10\$/);
    expect(hashUsado).toHaveLength(60);
  });

  it("conta desativada também passa pelo compare — senão o tempo diz quais contas estão ativas", async () => {
    const { autorizarCredenciais } = await import("../../src/core/auth/credenciais");
    findUniqueMock.mockResolvedValue({ ...usuarioAtivo, ativo: false });

    await autorizarCredenciais({ email: usuarioAtivo.email, senha: "x" }, requisicao());

    expect(compareMock).toHaveBeenCalledTimes(1);
  });

  it("REGRESSÃO: conta desativada com a senha CERTA continua sendo recusada", async () => {
    // A correção moveu a checagem de `ativo` para depois do compare. Se
    // alguém escrever `if (!user || !senhaValida)` e esquecer o `ativo`, um
    // funcionário demitido volta a entrar — este teste é a trava.
    const { autorizarCredenciais } = await import("../../src/core/auth/credenciais");
    findUniqueMock.mockResolvedValue({ ...usuarioAtivo, ativo: false });
    compareMock.mockResolvedValue(true);

    const resultado = await autorizarCredenciais(
      { email: usuarioAtivo.email, senha: "senha-certa" },
      requisicao()
    );

    expect(resultado).toBeNull();
  });

  it("usuário ativo com a senha certa entra, sem vazar o hash no retorno", async () => {
    const { autorizarCredenciais } = await import("../../src/core/auth/credenciais");
    findUniqueMock.mockResolvedValue(usuarioAtivo);
    compareMock.mockResolvedValue(true);

    const resultado = await autorizarCredenciais(
      { email: usuarioAtivo.email, senha: "senha-certa" },
      requisicao()
    );

    // Contrato novo: sem `role`. O campo já foi devolvido aqui, mas nada em
    // `src/` autorizava com `session.user.role`/`token.role` (medido), e o
    // valor que ele carregava — `User.papel` — deixou de ser a fonte de
    // verdade do papel desde que a gestão de equipe passou a gravar em
    // `Membership`. Um `toEqual` exaustivo (não `toMatchObject`) prova que
    // `role` NÃO está mais presente — a mesma lógica de "prova por ausência"
    // já usada para `senhaHash` em `users-service.test.ts`.
    expect(resultado).toEqual({
      id: "u1",
      name: "Fulano",
      email: "existe@exemplo.com",
    });
    // O objeto que vai para o token JWT não pode carregar o hash junto.
    expect(JSON.stringify(resultado)).not.toContain("$2b$");
  });
});

/**
 * A porta de entrada deixa rastro — item 39 da auditoria de 2026-08-21.
 *
 * O `RateLimit` não substituía: conta acerto e erro juntos, é volátil (janela
 * de 10 min) e guarda contagem, não o par conta/IP/instante. Estes casos
 * travam QUANDO cada registro acontece; o conteúdo da linha gravada está em
 * `tests/unit/auditoria-login.test.ts`, contra o Postgres de verdade.
 */
describe("autorizarCredenciais — auditoria de login", () => {
  const requisicao = () =>
    new Request("https://crm.exemplo.com/api/auth/callback/credentials", {
      method: "POST",
      headers: { "x-vercel-forwarded-for": "203.0.113.99" },
    });

  const usuarioAtivo = {
    id: "u1",
    nome: "Fulano",
    email: "existe@exemplo.com",
    senhaHash: "$2b$10$hashRealDeMentiraParaOTeste......................",
    ativo: true,
    memberships: [{ companyId: "empresa-1" }],
  };

  beforeEach(() => {
    checarRateLimitMock.mockReset();
    checarRateLimitMock.mockResolvedValue(true);
    findUniqueMock.mockReset();
    compareMock.mockReset();
    compareMock.mockResolvedValue(false);
    auditarLoginMock.mockReset();
    tentativaRecusadaMock.mockReset();
  });

  it("login aceito grava a linha com a empresa DO VÍNCULO e o IP não forjável", async () => {
    const { autorizarCredenciais } = await import("../../src/core/auth/credenciais");
    findUniqueMock.mockResolvedValue(usuarioAtivo);
    compareMock.mockResolvedValue(true);

    await autorizarCredenciais({ email: usuarioAtivo.email, senha: "senha-certa" }, requisicao());

    expect(auditarLoginMock).toHaveBeenCalledTimes(1);
    // Objeto inspecionado à mão, e não `toHaveBeenCalledWith`: o Vitest ignora
    // chave de valor `undefined` até na forma exata, então um `companyId` que
    // não fosse resolvido passaria despercebido — a armadilha medida nesta
    // branch.
    const argumento = auditarLoginMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(argumento.userId).toBe("u1");
    expect(argumento.companyId).toBe("empresa-1");
    expect(argumento.ip).toBe("203.0.113.99");
  });

  it("a senha NÃO viaja para a auditoria — nem em claro, nem em tamanho", async () => {
    // Precedente literal de `redefinirSenha` (`core/users/service.ts`), que
    // audita sem `antes` nem `depois` "porque não há nada aqui que seja seguro
    // guardar". A varredura é sobre o argumento INTEIRO serializado, e não
    // sobre um campo esperado: um campo novo carregando a senha entraria sem
    // ninguém notar.
    const { autorizarCredenciais } = await import("../../src/core/auth/credenciais");
    findUniqueMock.mockResolvedValue(usuarioAtivo);
    compareMock.mockResolvedValue(true);

    const senha = "SenhaSecreta!123";
    await autorizarCredenciais({ email: usuarioAtivo.email, senha }, requisicao());

    const serializado = JSON.stringify(auditarLoginMock.mock.calls[0]![0]);
    expect(serializado).not.toContain(senha);
    expect(serializado).not.toContain(usuarioAtivo.senhaHash);
    // Nem o TAMANHO: ele reduz o espaço de busca de graça.
    expect(serializado).not.toContain(String(senha.length));
  });

  it("senha errada em conta EXISTENTE registra a tentativa e NÃO grava no AuditLog", async () => {
    const { autorizarCredenciais } = await import("../../src/core/auth/credenciais");
    findUniqueMock.mockResolvedValue(usuarioAtivo);

    await autorizarCredenciais({ email: usuarioAtivo.email, senha: "errada" }, requisicao());

    expect(tentativaRecusadaMock).toHaveBeenCalledTimes(1);
    expect(auditarLoginMock).not.toHaveBeenCalled();
    const argumento = tentativaRecusadaMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(argumento.conta).toBe("existente");
    expect(argumento.motivo).toBe("credenciais");
  });

  it("e-mail INEXISTENTE registra a tentativa com o MESMO trabalho — sem escrita no banco", async () => {
    // Esta é a metade que impede a auditoria de virar o oráculo de enumeração
    // que `HASH_INERTE` existe para fechar. Se a conta existente gravasse uma
    // linha e a inexistente não, o `INSERT` (mediana de 85 ms neste banco)
    // reapareceria como diferença de tempo sobre os ~240 ms de bcrypt — o
    // mesmo canal, com outro nome.
    const { autorizarCredenciais } = await import("../../src/core/auth/credenciais");
    findUniqueMock.mockResolvedValue(null);

    await autorizarCredenciais({ email: "nao-existe@exemplo.com", senha: "x" }, requisicao());

    expect(tentativaRecusadaMock).toHaveBeenCalledTimes(1);
    expect(auditarLoginMock).not.toHaveBeenCalled();
    expect((tentativaRecusadaMock.mock.calls[0]![0] as Record<string, unknown>).conta).toBe(
      "inexistente"
    );
  });

  it("conta DESATIVADA com a senha certa é recusada e registrada, sem linha de login", async () => {
    const { autorizarCredenciais } = await import("../../src/core/auth/credenciais");
    findUniqueMock.mockResolvedValue({ ...usuarioAtivo, ativo: false });
    compareMock.mockResolvedValue(true);

    const resultado = await autorizarCredenciais(
      { email: usuarioAtivo.email, senha: "senha-certa" },
      requisicao()
    );

    expect(resultado).toBeNull();
    expect(auditarLoginMock).not.toHaveBeenCalled();
    expect((tentativaRecusadaMock.mock.calls[0]![0] as Record<string, unknown>).motivo).toBe(
      "desativada"
    );
  });

  it("bloqueio por limite também é tentativa registrada — é o formato da força bruta", async () => {
    const { autorizarCredenciais, MuitasTentativasDeLoginError } = await import(
      "../../src/core/auth/credenciais"
    );
    checarRateLimitMock.mockResolvedValueOnce(false);

    await expect(
      autorizarCredenciais({ email: "alvo@exemplo.com", senha: "chute" }, requisicao())
    ).rejects.toBeInstanceOf(MuitasTentativasDeLoginError);

    expect(tentativaRecusadaMock).toHaveBeenCalledTimes(1);
    expect((tentativaRecusadaMock.mock.calls[0]![0] as Record<string, unknown>).motivo).toBe(
      "limite"
    );
    // E o banco continua intocado: o limite roda ANTES da consulta, que é o
    // que torna a força bruta cara para quem ataca.
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("vínculo != 1 não inventa empresa e não derruba o login", async () => {
    // Mesma postura de `usuarioAtual()`: zero vínculo é sessão inválida, mais
    // de um LANÇA em vez de escolher. Aqui a autorização já terminou — negar o
    // login por causa do rastro seria negação de serviço —, então a anomalia
    // vai para o log e nenhuma linha é gravada numa empresa escolhida a dedo.
    const { autorizarCredenciais } = await import("../../src/core/auth/credenciais");
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    compareMock.mockResolvedValue(true);

    for (const memberships of [[], [{ companyId: "a" }, { companyId: "b" }]]) {
      auditarLoginMock.mockReset();
      findUniqueMock.mockResolvedValue({ ...usuarioAtivo, memberships });

      const resultado = await autorizarCredenciais(
        { email: usuarioAtivo.email, senha: "senha-certa" },
        requisicao()
      );

      expect(resultado).not.toBeNull();
      expect(auditarLoginMock).not.toHaveBeenCalled();
    }
    expect(aviso).toHaveBeenCalledTimes(2);

    aviso.mockRestore();
  });
});
