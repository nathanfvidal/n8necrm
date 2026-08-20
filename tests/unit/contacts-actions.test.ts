// Teste de unidade puro (sem Prisma real, sem `dotenv/config`): cobre a
// derivação de autor e a trava de permissão do documento em `actions.ts` —
// mesmo formato de `task-actions.test.ts` e `lead-actions.test.ts`.
//
// ## O que está sendo protegido, e por que não é só segurança
//
// Achado R2 da auditoria: só ADMIN e GESTOR veem e editam `Contact.documento`
// (CPF/CNPJ). Esconder o campo na tela seria a armadilha clássica — "proteção
// só na interface" — mas aqui há um segundo motivo, mais imediato e mais caro:
//
// O `react-hook-form` guarda o valor padrão dos campos NÃO registrados, então
// o formulário de um VENDEDOR envia `documento: ""` mesmo sem desenhar o
// campo. `""` vira `null` na validação, e `null` no `update` do Prisma APAGA.
// Sem a trava, todo vendedor que corrigisse um telefone apagaria o CPF junto,
// em silêncio e sem erro nenhum.
//
// Por isso os testes abaixo não perguntam "deu erro?" — perguntam "o que
// chegou ao serviço?". A chave tem de estar AUSENTE, não vazia: ausente é
// "não mexa nesta coluna".
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UsuarioAtivo } from "../../src/core/auth/usuario-ativo";

const usuarioAtualMock = vi.fn();
vi.mock("@/core/auth/session", () => ({ usuarioAtual: () => usuarioAtualMock() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const criarContatoMock = vi.fn();
const atualizarContatoMock = vi.fn();
vi.mock("@/core/contacts/service", () => ({
  criarContato: (...args: unknown[]) => criarContatoMock(...args),
  atualizarContato: (...args: unknown[]) => atualizarContatoMock(...args),
  ContatoInvalidoError: class ContatoInvalidoError extends Error {},
}));

const { criarContatoAction, atualizarContatoAction } = await import(
  "../../src/core/contacts/actions"
);

// `UsuarioAtivo`, e não o modelo `User` do Prisma. A troca não é cosmética:
// `usuarioAtual()` devolve `UsuarioAtivo` desde a Task 2 do Ciclo 1a, e o
// campo que interessa aqui é o `companyId`, que `User` não tem.
//
// Enquanto o fake era um `User`, ele não carregava `companyId` — e como as
// actions só repassavam o objeto adiante, o teste ficava VERDE repassando
// `undefined` para o serviço. Foi assim que dois pontos escaparam do bloco
// anterior deste ciclo. Com o tipo certo, esquecer o campo passa a ser erro de
// compilação, e os dois casos de "autor vem sempre da sessão" afirmam o valor.
function usuarioFake(overrides: Partial<UsuarioAtivo> = {}): UsuarioAtivo {
  return {
    id: "usuario-fake-id",
    nome: "Usuário Fake",
    email: "fake@teste.local",
    companyId: "empresa-da-sessao",
    papel: "VENDEDOR",
    ativo: true,
    ...overrides,
  };
}

beforeEach(() => {
  usuarioAtualMock.mockReset();
  criarContatoMock.mockReset();
  atualizarContatoMock.mockReset();
  criarContatoMock.mockResolvedValue({ id: "contato-1" });
  atualizarContatoMock.mockResolvedValue({ id: "contato-1" });
});

const BASE = { nome: "Carlos", telefone: "11999998888" };

describe("documento é restrito a quem tem permissão", () => {
  it("VENDEDOR não consegue GRAVAR documento ao criar", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "VENDEDOR" }));

    await criarContatoAction({ ...BASE, documento: "12345678901" });

    const enviado = criarContatoMock.mock.calls[0][1] as Record<string, unknown>;
    expect("documento" in enviado).toBe(false);
    // Nem por outro caminho: o valor não pode sobrar em lugar nenhum do objeto.
    expect(JSON.stringify(enviado)).not.toContain("12345678901");
  });

  // O caso que perde dado, e o motivo de a chave ser REMOVIDA e não zerada.
  it("edição por VENDEDOR não apaga o documento que já estava lá", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "VENDEDOR" }));

    // Exatamente o que o formulário dele manda: string vazia, porque o campo
    // não foi renderizado mas o valor padrão continua no estado do form.
    await atualizarContatoAction({ id: "contato-1", ...BASE, documento: "" });

    const enviado = atualizarContatoMock.mock.calls[0][1] as Record<string, unknown>;
    expect(
      "documento" in enviado,
      "a chave precisa estar AUSENTE: presente e vazia vira null, e null apaga a coluna"
    ).toBe(false);
  });

  it("GESTOR grava documento normalmente", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "GESTOR" }));

    await atualizarContatoAction({ id: "contato-1", ...BASE, documento: "12345678901" });

    expect(atualizarContatoMock.mock.calls[0][1]).toMatchObject({ documento: "12345678901" });
  });

  it("ADMIN grava documento normalmente", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "ADMIN" }));

    await criarContatoAction({ ...BASE, documento: "12345678901" });

    expect(criarContatoMock.mock.calls[0][1]).toMatchObject({ documento: "12345678901" });
  });

  it("GESTOR consegue APAGAR o documento de propósito", async () => {
    // A trava não pode virar "ninguém nunca limpa o campo": quem tem
    // permissão precisa conseguir corrigir um CPF digitado errado para vazio.
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "GESTOR" }));

    await atualizarContatoAction({ id: "contato-1", ...BASE, documento: "" });

    const enviado = atualizarContatoMock.mock.calls[0][1] as Record<string, unknown>;
    expect(enviado.documento).toBe("");
  });

  it("os demais campos do cadastro seguem livres para VENDEDOR", async () => {
    // A exceção é de UM campo, não da tela. Se isto ficar vermelho, alguém
    // ampliou a restrição para além do que o dono decidiu.
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "VENDEDOR" }));

    await atualizarContatoAction({
      id: "contato-1",
      ...BASE,
      empresa: "Acme",
      cargo: "Diretor",
      endereco: "Rua X",
      cidade: "São Paulo",
      uf: "SP",
      observacoes: "Ligar de manhã.",
    });

    expect(atualizarContatoMock.mock.calls[0][1]).toMatchObject({
      empresa: "Acme",
      cargo: "Diretor",
      endereco: "Rua X",
      cidade: "São Paulo",
      uf: "SP",
      observacoes: "Ligar de manhã.",
    });
  });
});

describe("autor e empresa vêm sempre da sessão", () => {
  it("criar usa o id de usuarioAtual, nunca um id vindo do cliente", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ id: "vendedor-7" }));

    await criarContatoAction(BASE);

    expect(criarContatoMock.mock.calls[0][2]).toBe("vendedor-7");
  });

  it("editar usa o id de usuarioAtual", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ id: "gestor-3", papel: "GESTOR" }));

    await atualizarContatoAction({ id: "contato-1", ...BASE });

    expect(atualizarContatoMock.mock.calls[0][2]).toBe("gestor-3");
  });

  // A empresa é o PRIMEIRO parâmetro do serviço desde o Ciclo 1a, e sai de
  // `usuarioAtual().companyId`. Estes dois casos existem porque a origem é o
  // ponto: uma Server Action é endpoint HTTP público, então um `companyId`
  // aceito dentro de `dados` seria escolhido por quem chama.
  it("criar escopa na empresa da sessão", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ companyId: "empresa-a" }));

    await criarContatoAction(BASE);

    expect(criarContatoMock.mock.calls[0][0]).toBe("empresa-a");
  });

  it("editar escopa na empresa da sessão, e ignora a que vier do cliente", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ companyId: "empresa-a" }));

    // `companyId` forjado no payload do formulário. O tipo da action não o
    // declara; um POST direto o manda assim mesmo.
    await atualizarContatoAction({
      id: "contato-1",
      ...BASE,
      ...({ companyId: "empresa-b" } as Record<string, string>),
    });

    expect(atualizarContatoMock.mock.calls[0][0]).toBe("empresa-a");
  });
});
