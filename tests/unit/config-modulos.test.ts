import { describe, it, expect, vi, beforeEach } from "vitest";

// `src/core/config/modulos.ts` não importa `server-only`, mas a cadeia que ele
// puxa pode passar a importar. Mockar aqui custa uma linha e evita o modo de
// falha que `painel-nav.test.tsx` documenta: sob Vitest a condição de
// resolução "react-server" não é aplicada, então `server-only` LANÇA em vez de
// virar no-op, e a quebra acontece na importação — antes de qualquer caso
// rodar, com uma mensagem que não fala de módulo nenhum.
vi.mock("server-only", () => ({}));

const { configDaEmpresaMock, notFoundMock } = vi.hoisted(() => ({
  configDaEmpresaMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/core/config/leitura", () => ({ configDaEmpresa: configDaEmpresaMock }));

// `notFound()` de verdade lança um erro de controle de fluxo e nunca retorna —
// o mock reproduz isso, para que um bug que engula o erro dentro de um
// try/catch apareça como o notFound "não acontecendo". Mesma armadilha que
// `login-page-guard.test.tsx` documenta para `redirect()`.
vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));

const { moduloAtivo, exigirModulo } = await import("../../src/core/config/modulos");

const EMPRESA_A = "cmp_a";
const EMPRESA_B = "cmp_b";

function config(modulos: string[]) {
  return { nome: "Empresa", marca: { corPrimaria: "#6D4AFF", fonte: "Geist" }, modulos };
}

beforeEach(() => {
  configDaEmpresaMock.mockReset();
  notFoundMock.mockClear();
});

describe("moduloAtivo", () => {
  it("pergunta pela empresa que RECEBEU", async () => {
    configDaEmpresaMock.mockResolvedValue(config(["whatsapp"]));
    await moduloAtivo(EMPRESA_A, "whatsapp");
    expect(configDaEmpresaMock).toHaveBeenCalledWith(EMPRESA_A);
  });

  it("devolve true para módulo na lista da empresa", async () => {
    configDaEmpresaMock.mockResolvedValue(config(["whatsapp", "automation"]));
    await expect(moduloAtivo(EMPRESA_A, "automation")).resolves.toBe(true);
  });

  it("devolve false para módulo fora da lista", async () => {
    configDaEmpresaMock.mockResolvedValue(config(["whatsapp"]));
    await expect(moduloAtivo(EMPRESA_A, "automation")).resolves.toBe(false);
  });

  it("duas empresas recebem respostas DIFERENTES na mesma execução", async () => {
    // É o caso que separa "lê do banco por empresa" de "lê um arquivo global".
    // Com o config em arquivo, este teste era impossível de escrever: a
    // resposta não dependia de quem perguntava.
    configDaEmpresaMock.mockImplementation(async (id: string) =>
      id === EMPRESA_A ? config(["whatsapp"]) : config([])
    );

    await expect(moduloAtivo(EMPRESA_A, "whatsapp")).resolves.toBe(true);
    await expect(moduloAtivo(EMPRESA_B, "whatsapp")).resolves.toBe(false);
  });

  // A leitura RECUSA config inválida e o erro sobe (ver o bloco "Config
  // quebrada RECUSA" em `core/config/leitura.ts`). O portão não pode ser o
  // lugar que desfaz essa decisão: um `try/catch` aqui, mesmo bem
  // intencionado, transformaria "linha do banco corrompida" em "módulo
  // desligado" — a empresa perderia a tela com um 404 silencioso em vez do
  // erro que aponta para a linha ruim.
  it("NÃO engole o erro de config inválida — ele sobe para quem chamou", async () => {
    configDaEmpresaMock.mockRejectedValue(new Error("config invalida"));
    await expect(moduloAtivo(EMPRESA_A, "whatsapp")).rejects.toThrow("config invalida");
  });
});

describe("exigirModulo", () => {
  it("passa quando o módulo está ligado — e não chama notFound", async () => {
    configDaEmpresaMock.mockResolvedValue(config(["whatsapp"]));
    await expect(exigirModulo(EMPRESA_A, "whatsapp")).resolves.toBeUndefined();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("chama notFound quando o módulo está desligado", async () => {
    // 404, e não redirecionamento: o link some do menu, mas digitar a URL
    // direto não pode contornar o portão (spec 3.4 do Ciclo original).
    configDaEmpresaMock.mockResolvedValue(config([]));
    await expect(exigirModulo(EMPRESA_A, "whatsapp")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("a MESMA rota passa para uma empresa e dá 404 para a outra", async () => {
    // As duas metades juntas, no mesmo caso: sem a primeira, um portão que
    // barrasse TUDO passaria como correção; sem a segunda, um portão que não
    // barrasse nada também passaria. É a diferença entre as duas empresas que
    // prova que o portão lê por empresa, e não um valor global.
    configDaEmpresaMock.mockImplementation(async (id: string) =>
      id === EMPRESA_A ? config(["automation"]) : config([])
    );

    await expect(exigirModulo(EMPRESA_A, "automation")).resolves.toBeUndefined();
    expect(notFoundMock).not.toHaveBeenCalled();

    await expect(exigirModulo(EMPRESA_B, "automation")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });
});
