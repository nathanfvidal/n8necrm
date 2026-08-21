import { describe, it, expect, vi, beforeEach } from "vitest";

import type { UsuarioAtivo } from "../../src/core/auth/usuario-ativo";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * `@/lib/prisma` é mockado mesmo sem nenhum caso deste arquivo tocar banco.
 *
 * Motivo mecânico: `vi.importActual` abaixo carrega o `service.ts` DE VERDADE
 * (para o `ConexaoInvalidaError` ser a classe real, não uma imitação), e ele
 * puxa `@/core/tenancy/escopo` → `@/lib/prisma` → `@/lib/env`, que faz
 * `envSchema.parse` em ESCOPO DE MÓDULO. Sem este mock o arquivo inteiro
 * quebraria em `DATABASE_URL: Required` antes do primeiro caso — falha pelo
 * motivo errado, exatamente o que o `AGENTS.md` deste projeto manda não
 * mascarar. Carregar `dotenv/config` "resolveria" abrindo conexão real com o
 * Postgres compartilhado para um teste que não precisa dela.
 */
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const usuarioAtualMock = vi.fn();
vi.mock("@/core/auth/session", () => ({ usuarioAtual: () => usuarioAtualMock() }));

const criarConexaoMock = vi.fn();
const substituirSegredoMock = vi.fn();
const atualizarConexaoMock = vi.fn();
const definirAtivaMock = vi.fn();
const apagarConexaoMock = vi.fn();
const regenerarWebhookTokenMock = vi.fn();

/**
 * O serviço inteiro é substituído — `vi.mock` troca o MÓDULO, não uma função
 * dele, então as SEIS escritas precisam estar aqui. Um mock incompleto não
 * daria erro de mock: a action chamaria `undefined(...)` e o caso morreria com
 * "is not a function", uma falha que aponta para o lugar errado (foi assim que
 * `next-themes` derrubou um arquivo desta branch).
 *
 * `ConexaoInvalidaError` vem do módulo REAL, e isso não é preciosismo: a action
 * decide o que é "erro seguro de mostrar" com `erro instanceof
 * ConexaoInvalidaError`. Uma classe imitada aqui deixaria o teste verde mesmo
 * se o serviço renomeasse ou trocasse a dela — e a tela passaria a receber a
 * mensagem genérica para toda validação, sem nenhum caso vermelho.
 */
vi.mock("@/core/conexoes/service", async () => {
  const { ConexaoInvalidaError } = await vi.importActual<
    typeof import("../../src/core/conexoes/service")
  >("../../src/core/conexoes/service");
  return {
    ConexaoInvalidaError,
    criarConexao: (...a: unknown[]) => criarConexaoMock(...a),
    substituirSegredo: (...a: unknown[]) => substituirSegredoMock(...a),
    atualizarConexao: (...a: unknown[]) => atualizarConexaoMock(...a),
    definirAtiva: (...a: unknown[]) => definirAtivaMock(...a),
    regenerarWebhookToken: (...a: unknown[]) => regenerarWebhookTokenMock(...a),
    apagarConexao: (...a: unknown[]) => apagarConexaoMock(...a),
  };
});

import {
  criarConexaoAction,
  substituirSegredoAction,
  atualizarConexaoAction,
  definirAtivaAction,
  regenerarWebhookAction,
  apagarConexaoAction,
} from "../../src/core/conexoes/actions";

/**
 * A fixture é tipada como `UsuarioAtivo`, e o tipo é a metade que importa.
 *
 * Um objeto com a forma do `User` do Prisma NÃO tem `companyId` — `User` não
 * tem essa coluna desde o Ciclo 1a, quem tem é `Membership`. Uma fixture assim
 * deixa a action repassar `companyId: undefined` para o serviço e o caso fica
 * VERDE, porque o Vitest ignora `undefined` ao comparar objeto parcial. O
 * defeito apareceu três vezes nesta branch. Com a anotação de tipo, esquecer o
 * campo passa a ser erro de compilação em vez de teste mentindo.
 */
const ADMIN: UsuarioAtivo = {
  id: "usr_1",
  companyId: "cmp_a",
  papel: "ADMIN",
  nome: "A",
  email: "a@a.com",
  ativo: true,
};
const GESTOR: UsuarioAtivo = { ...ADMIN, papel: "GESTOR" };
const VENDEDOR: UsuarioAtivo = { ...ADMIN, papel: "VENDEDOR" };

const DADOS = {
  canal: "EVOLUTION" as const,
  nome: "Comercial",
  dominio: "https://evo.exemplo.com",
  instancia: "inst-1",
  segredo: "apikey-da-evolution-1a2b",
};

const TOKEN_NOVO = "t".repeat(64);
const TOKEN_REGERADO = "u".repeat(64);

beforeEach(() => {
  usuarioAtualMock.mockReset().mockResolvedValue(ADMIN);
  criarConexaoMock.mockReset().mockResolvedValue({ id: "conn_1", webhookToken: TOKEN_NOVO });
  substituirSegredoMock.mockReset().mockResolvedValue(undefined);
  atualizarConexaoMock.mockReset().mockResolvedValue(undefined);
  definirAtivaMock.mockReset().mockResolvedValue(undefined);
  apagarConexaoMock.mockReset().mockResolvedValue(undefined);
  regenerarWebhookTokenMock.mockReset().mockResolvedValue({ webhookToken: TOKEN_REGERADO });
});

/** Chama as SEIS actions com payload válido. Usado por três casos diferentes. */
function todasAsActions() {
  return [
    criarConexaoAction(DADOS),
    substituirSegredoAction({ id: "conn_1", segredo: "apikey-nova-9z8y" }),
    atualizarConexaoAction({
      id: "conn_1",
      nome: "Comercial",
      dominio: "https://evo.exemplo.com",
      instancia: "inst-1",
    }),
    definirAtivaAction({ id: "conn_1", ativa: false }),
    regenerarWebhookAction({ id: "conn_1" }),
    apagarConexaoAction({ id: "conn_1" }),
  ];
}

const TODOS_OS_MOCKS = [
  criarConexaoMock,
  substituirSegredoMock,
  atualizarConexaoMock,
  definirAtivaMock,
  regenerarWebhookTokenMock,
  apagarConexaoMock,
];

describe("a empresa NUNCA vem por parâmetro", () => {
  it("`criarConexaoAction` passa o `companyId` de `usuarioAtual()`", async () => {
    await criarConexaoAction(DADOS);
    // Server Action é endpoint HTTP público: um `companyId` de formulário
    // seria forjável, e quem tivesse sessão em qualquer empresa cadastraria
    // conexão na de outra.
    //
    // O segundo argumento é afirmado por INTEIRO, e não com
    // `expect.anything()`: `anything()` aprovaria um objeto que carregasse um
    // `companyId` extra vindo do payload, que é justamente o que o caso
    // seguinte existe para reprovar.
    expect(criarConexaoMock).toHaveBeenCalledWith("cmp_a", DADOS, "usr_1");
  });

  it("nenhuma action aceita `companyId` no payload — ele é ignorado", async () => {
    await criarConexaoAction({ ...DADOS, companyId: "cmp_invasora" } as never);
    expect(criarConexaoMock).toHaveBeenCalledWith("cmp_a", DADOS, "usr_1");
  });

  it("as SEIS actions escopam pela empresa da sessão e pelo autor da sessão", async () => {
    // A metade positiva de "ADMIN da própria empresa consegue fazer tudo": não
    // basta as outras empresas serem recusadas, a tela precisa funcionar para
    // quem tem direito. Cada mock é conferido no primeiro e no último
    // argumento — `cmp_a` e `usr_1` saem os dois de `usuarioAtual()`.
    const resultados = await Promise.all(todasAsActions());

    for (const resultado of resultados) expect(resultado.ok).toBe(true);

    expect(criarConexaoMock).toHaveBeenCalledWith("cmp_a", DADOS, "usr_1");
    expect(substituirSegredoMock).toHaveBeenCalledWith("cmp_a", "conn_1", "apikey-nova-9z8y", "usr_1");
    expect(atualizarConexaoMock).toHaveBeenCalledWith(
      "cmp_a",
      "conn_1",
      { nome: "Comercial", dominio: "https://evo.exemplo.com", instancia: "inst-1" },
      "usr_1"
    );
    expect(definirAtivaMock).toHaveBeenCalledWith("cmp_a", "conn_1", false, "usr_1");
    expect(regenerarWebhookTokenMock).toHaveBeenCalledWith("cmp_a", "conn_1", "usr_1");
    expect(apagarConexaoMock).toHaveBeenCalledWith("cmp_a", "conn_1", "usr_1");
  });

  it("ADMIN da empresa A não alcança conexão da B — a recusa vem do escopo, não da tela", async () => {
    // O serviço real confere "existe E é desta empresa" em
    // `exigirConexaoDaEmpresa`, e devolve a MESMA mensagem para "não existe" e
    // "é de outra empresa". Aqui os mocks reproduzem esse contrato: `conn_da_b`
    // pertence a `cmp_b`, e a sessão é de `cmp_a`.
    const { ConexaoInvalidaError } = await import("../../src/core/conexoes/service");
    const soDaEmpresaB = async (companyId: string) => {
      if (companyId !== "cmp_b") throw new ConexaoInvalidaError("Conexão não encontrada.");
      return undefined;
    };
    substituirSegredoMock.mockImplementation(soDaEmpresaB);
    atualizarConexaoMock.mockImplementation(soDaEmpresaB);
    definirAtivaMock.mockImplementation(soDaEmpresaB);
    apagarConexaoMock.mockImplementation(soDaEmpresaB);
    regenerarWebhookTokenMock.mockImplementation(soDaEmpresaB);

    const resultados = await Promise.all([
      substituirSegredoAction({ id: "conn_da_b", segredo: "apikey-nova-9z8y" }),
      atualizarConexaoAction({
        id: "conn_da_b",
        nome: "Sequestrada",
        dominio: "https://evo.exemplo.com",
        instancia: "inst-1",
      }),
      definirAtivaAction({ id: "conn_da_b", ativa: false }),
      regenerarWebhookAction({ id: "conn_da_b" }),
      apagarConexaoAction({ id: "conn_da_b" }),
    ]);

    for (const resultado of resultados) {
      expect(resultado).toEqual({ ok: false, erro: "Conexão não encontrada." });
    }
  });
});

describe("permissão", () => {
  it("VENDEDOR é recusado em TODAS as actions, com mensagem segura de mostrar", async () => {
    usuarioAtualMock.mockResolvedValue(VENDEDOR);

    const resultados = await Promise.all(todasAsActions());

    for (const r of resultados) {
      expect(r).toEqual({ ok: false, erro: expect.stringContaining("permissão") });
    }
    // O gate é a ACTION, não a tela: um POST direto nunca passa pela página.
    for (const mock of TODOS_OS_MOCKS) expect(mock).not.toHaveBeenCalled();
  });

  it("GESTOR também é recusado — `gerenciar_conexoes` é só de ADMIN", async () => {
    // GESTOR tem `ver_fluxos` e `exportar_leads`, então "não é ADMIN" não é
    // sinônimo de "não pode nada" neste sistema. Sem este caso, uma matriz que
    // desse `gerenciar_conexoes` a GESTOR — tomada de canal da empresa —
    // passaria por todos os outros testes deste arquivo.
    usuarioAtualMock.mockResolvedValue(GESTOR);

    const resultados = await Promise.all(todasAsActions());

    for (const r of resultados) {
      expect(r).toEqual({ ok: false, erro: expect.stringContaining("permissão") });
    }
    for (const mock of TODOS_OS_MOCKS) expect(mock).not.toHaveBeenCalled();
  });
});

describe("o que volta para o navegador", () => {
  it("`criarConexaoAction` devolve o PATH do webhook, e nada mais", async () => {
    const resultado = await criarConexaoAction(DADOS);
    expect(resultado).toEqual({
      ok: true,
      webhookPath: `/api/whatsapp/evolution/cmp_a/${TOKEN_NOVO}`,
    });
  });

  it("`substituirSegredoAction` NÃO devolve nada além de `ok`", async () => {
    // O segredo que a pessoa acabou de digitar não volta — nem para
    // confirmação. Confirmar exigiria o servidor devolver o que recebeu, e é
    // exatamente esse retorno que um XSS leria.
    expect(await substituirSegredoAction({ id: "conn_1", segredo: "apikey-nova-9z8y" })).toEqual({
      ok: true,
    });
  });

  it("nenhum retorno de action contém a apikey enviada", async () => {
    const resultados = [
      await criarConexaoAction(DADOS),
      await substituirSegredoAction({ id: "conn_1", segredo: DADOS.segredo }),
    ];
    expect(JSON.stringify(resultados)).not.toContain(DADOS.segredo);
  });

  it("o retorno serializado das SEIS actions só tem chaves de uma LISTA FECHADA", async () => {
    // Lista fechada, e não varredura por substring — a Tarefa 5 mediu as duas
    // metades da falha da varredura: ela reprova campo legítimo cujo NOME
    // contém "segredo" (`segredoAtualizadoEm`, `segredoAtualizadoPor`) e deixa
    // passar campo novo cujo nome ninguém previu (`blob`, `chaveId`,
    // `apikeyCifrada`). A lista fechada pega os dois casos: qualquer chave que
    // apareça no retorno sem estar aqui reprova, inclusive uma que ninguém
    // imaginou.
    //
    // A afirmação é sobre o objeto SERIALIZADO porque é isso que atravessa a
    // fronteira até o navegador — uma propriedade não enumerável ou um getter
    // some no caminho, e um campo extra aparece.
    const permitidas = ["ok", "erro", "webhookPath"];

    const resultados = [
      ...(await Promise.all(todasAsActions())),
      // A metade do erro também: o caminho de falha é o que carrega mensagem
      // vinda de baixo, e é onde um `detalhe`/`causa` entraria sem querer.
      ...(await (async () => {
        for (const mock of TODOS_OS_MOCKS) mock.mockRejectedValue(new Error("qualquer coisa"));
        return Promise.all(todasAsActions());
      })()),
    ];

    for (const resultado of resultados) {
      const chaves = Object.keys(JSON.parse(JSON.stringify(resultado)));
      // Vazio reprovaria em silêncio se `resultados` viesse vazio; a contagem
      // ancora que houve o que conferir.
      expect(chaves.length).toBeGreaterThan(0);
      for (const chave of chaves) {
        expect(permitidas, `chave inesperada no retorno: ${chave}`).toContain(chave);
      }
    }
    expect(resultados).toHaveLength(12);
  });
});

describe("erros", () => {
  it("`ConexaoInvalidaError` chega à tela com o próprio texto", async () => {
    const { ConexaoInvalidaError } = await import("../../src/core/conexoes/service");
    criarConexaoMock.mockRejectedValue(new ConexaoInvalidaError("O domínio precisa ser uma URL."));
    expect(await criarConexaoAction(DADOS)).toEqual({
      ok: false,
      erro: "O domínio precisa ser uma URL.",
    });
  });

  it("qualquer OUTRO erro vira mensagem genérica — nunca o texto interno", async () => {
    // Um erro do cofre carrega o `keyId`; um do Prisma carrega nome de coluna.
    // Nenhum dos dois é para a tela. `console.error` guarda o detalhe onde ele
    // serve a alguém.
    criarConexaoMock.mockRejectedValue(new Error("chave 9f3c1a2b não está em COFRE_CHAVE_MESTRA"));
    const resultado = await criarConexaoAction(DADOS);
    expect(resultado).toEqual({ ok: false, erro: expect.any(String) });
    expect(JSON.stringify(resultado)).not.toContain("9f3c1a2b");
  });

  it("sessão expirada no meio da ação vira resultado, não promessa rejeitada", async () => {
    // `usuarioAtual()` roda DENTRO do `try` de cada action. Fora dele, a
    // rejeição subiria sem nunca produzir um `ResultadoAcao` e a tela não
    // mostraria nada — nem sucesso nem erro. É o ponto que derrubou uma rodada
    // de revisão na Fatia 2 do WhatsApp.
    usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));

    const resultados = await Promise.all(todasAsActions());

    for (const r of resultados) {
      expect(r).toEqual({ ok: false, erro: expect.stringContaining("sessão") });
    }
    for (const mock of TODOS_OS_MOCKS) expect(mock).not.toHaveBeenCalled();
  });
});
