// Teste de unidade puro (sem Prisma real, sem `dotenv/config`): cobre só a
// derivação de autor de `actions.ts` — mesmo raciocínio de
// lead-actions.test.ts (Task 13/17). `usuarioAtual()` e `service.ts` são
// mockados diretamente, então este arquivo prova o contrato de segurança
// (Task 13/18: `responsavelId`/`autorId` SEMPRE vêm de `usuarioAtual()`,
// NUNCA de um argumento de input) sem depender de sessão HTTP nem de banco.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Task } from "@prisma/client";

import type { UsuarioAtivo } from "@/core/auth/usuario-ativo";

const usuarioAtualMock = vi.fn();
vi.mock("@/core/auth/session", () => ({ usuarioAtual: () => usuarioAtualMock() }));

// `revalidatePath` lança fora do pipeline do Next ("static generation store
// missing"). O mock é obrigatório — mas um no-op puro deixaria o teste verde
// sem provar nada, então as chamadas são CAPTURADAS e viram asserção abaixo.
const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

const criarTaskMock = vi.fn();
const concluirTaskMock = vi.fn();
vi.mock("@/core/tasks/service", () => ({
  criarTask: (...args: unknown[]) => criarTaskMock(...args),
  concluirTask: (...args: unknown[]) => concluirTaskMock(...args),
}));

const { criarMinhaTaskAction, concluirMinhaTaskAction } = await import("../../src/core/tasks/actions");
const { MENSAGEM_SESSAO_INVALIDA } = await import("../../src/lib/acao");

// `UsuarioAtivo` e NÃO `User` do Prisma, que é o que este dublê fingia ser.
// `usuarioAtual()` devolve `UsuarioAtivo` (`core/auth/usuario-ativo.ts:21-29`),
// e a diferença não é cosmética: `UsuarioAtivo` tem `companyId` e `User` não
// tem. Com o tipo errado, `autor.companyId` chegava `undefined` no serviço e o
// teste ficava verde -- ver o describe "companyId vem da sessão".
//
// `senhaHash` e `criadoEm` somem, e a ausência é o ganho declarado no docstring
// do tipo (`usuario-ativo.ts:17-19`): nada fora de `core/auth` tem por que ler
// hash de senha. `papel` continua, e continua vindo do VÍNCULO -- não é
// `User.papel`, coluna derrubada no Ciclo 1f.
const EMPRESA_FAKE = "empresa-fake-id";

function usuarioFake(overrides: Partial<UsuarioAtivo> = {}): UsuarioAtivo {
  return {
    id: "usuario-fake-id",
    nome: "Usuário Fake",
    email: "fake@teste.local",
    ativo: true,
    companyId: EMPRESA_FAKE,
    papel: "VENDEDOR",
    ...overrides,
  };
}

function taskFake(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-fake-id",
    // Mesma constante da sessão falsa: a tarefa e quem age concordam sobre a
    // empresa, que é o estado que produção sempre teve. Dois literais iguais
    // escritos à mão poderiam divergir sem ninguém notar.
    companyId: EMPRESA_FAKE,
    titulo: "Tarefa fake",
    descricao: null,
    vencimento: new Date("2026-08-05T00:00:00.000Z"),
    concluidaEm: null,
    responsavelId: "usuario-fake-id",
    leadId: null,
    contactId: null,
    criadoEm: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  usuarioAtualMock.mockReset();
  criarTaskMock.mockReset();
  concluirTaskMock.mockReset();
  revalidatePathMock.mockReset();
});

// O `companyId` da SESSÃO, e o defeito que o dublê mal tipado escondia.
//
// `criarTask`/`concluirTask` recebem `companyId: autor.companyId`
// (`core/tasks/actions.ts:72` e `:113`), e o `autor` vem de `usuarioAtual()`,
// que devolve `UsuarioAtivo`. Enquanto o dublê deste arquivo foi tipado como
// `User` do Prisma -- que NÃO tem `companyId` --, esses dois pontos receberam
// `undefined` e nenhum teste reclamou: `undefined` atravessa um mock sem
// levantar nada.
//
// É a terceira vez que esse padrão exato aparece nesta branch, e as três
// ficaram verdes do mesmo jeito. Estes dois casos são o que impede a quarta.
describe("companyId vem da sessão, nunca do formulário", () => {
  it("criar manda o companyId de usuarioAtual() para o serviço", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake());
    criarTaskMock.mockResolvedValue(taskFake());

    await criarMinhaTaskAction({
      titulo: "Ligar",
      vencimento: new Date("2026-08-05T00:00:00.000Z"),
    });

    expect(criarTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: EMPRESA_FAKE, responsavelId: "usuario-fake-id" })
    );
  });

  it("concluir manda o companyId de usuarioAtual() para o serviço", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake());
    concluirTaskMock.mockResolvedValue(taskFake());

    await concluirMinhaTaskAction("task-1");

    expect(concluirTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: EMPRESA_FAKE,
        taskId: "task-1",
        autorId: "usuario-fake-id",
      })
    );
  });
});

// Criar e concluir não invalidavam o cache de rota — só editar e excluir. O
// efeito prático não era teórico: `router.refresh()` no formulário conserta a
// aba de quem agiu, e todo o resto (a mesma pessoa em outra aba, o contador
// do painel) continuava servindo a página em cache, sem a tarefa nova.
// Correção do achado R2 da auditoria da branch. O valor de retorno de uma
// Server Action é SERIALIZADO para o navegador: devolver `Task` mandava a
// linha inteira (`responsavelId`, `contactId`, `criadoEm`) para chamadores
// que descartam o retorno. Era a tarefa do próprio usuário, então não vazava
// entre pessoas — mas é o mesmo padrão que produziu o vazamento do funil.
describe("nada da linha do banco atravessa a fronteira", () => {
  // `toEqual({ ok: true })` e não `toBeUndefined()`: as duas actions passaram
  // a devolver `ResultadoAcao`. A invariante é a mesma e a asserção continua
  // exata — `toEqual` reprova qualquer chave a mais, então um `{ ok: true,
  // task }` acrescentado por descuido fica vermelho aqui.
  it("criar devolve só o resultado, nunca a tarefa", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake());
    criarTaskMock.mockResolvedValue(taskFake({ responsavelId: "segredo" }));

    const devolvido = await criarMinhaTaskAction({
      titulo: "Ligar",
      vencimento: new Date("2026-08-05T00:00:00.000Z"),
    });

    expect(devolvido).toEqual({ ok: true });
  });

  it("concluir devolve só o resultado, mas ainda lê o leadId da tarefa por dentro", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake());
    concluirTaskMock.mockResolvedValue(taskFake({ leadId: "lead-7" }));

    const devolvido = await concluirMinhaTaskAction("task-1");

    expect(devolvido).toEqual({ ok: true });
    // A linha continua sendo lida no servidor — é de lá que sai a rota do
    // lead a invalidar. O que mudou é ela não sair de lá.
    expect(revalidatePathMock).toHaveBeenCalledWith("/leads/lead-7");
  });
});

describe("invalidação de cache", () => {
  it("criar invalida /tasks e o painel", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake());
    criarTaskMock.mockResolvedValue(taskFake());

    await criarMinhaTaskAction({ titulo: "Ligar", vencimento: new Date("2026-08-05T00:00:00.000Z") });

    expect(revalidatePathMock).toHaveBeenCalledWith("/tasks");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
  });

  it("criar com lead invalida também a página daquele lead", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake());
    criarTaskMock.mockResolvedValue(taskFake({ leadId: "lead-9" }));

    await criarMinhaTaskAction({
      titulo: "Ligar",
      vencimento: new Date("2026-08-05T00:00:00.000Z"),
      leadId: "lead-9",
    });

    expect(revalidatePathMock).toHaveBeenCalledWith("/leads/lead-9");
  });

  it("concluir invalida /tasks e o painel", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake());
    concluirTaskMock.mockResolvedValue(taskFake({ concluidaEm: new Date() }));

    await concluirMinhaTaskAction("task-1");

    expect(revalidatePathMock).toHaveBeenCalledWith("/tasks");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
  });

  // O `leadId` vem da tarefa DEVOLVIDA pelo serviço, não de um argumento —
  // `concluirMinhaTaskAction` só recebe o id. Sem isso, concluir uma tarefa a
  // partir de `/tasks` deixaria a página do lead vinculado com cache velho.
  it("concluir invalida a página do lead lendo o vínculo da tarefa devolvida", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake());
    concluirTaskMock.mockResolvedValue(taskFake({ leadId: "lead-7" }));

    await concluirMinhaTaskAction("task-1");

    expect(revalidatePathMock).toHaveBeenCalledWith("/leads/lead-7");
  });
});

describe("criarMinhaTaskAction", () => {
  it("deriva responsavelId da sessão — o input nunca tem esse campo para começo de conversa", async () => {
    const vendedor = usuarioFake({ id: "vendedor-1" });
    usuarioAtualMock.mockResolvedValue(vendedor);
    criarTaskMock.mockResolvedValue(taskFake({ responsavelId: "vendedor-1" }));

    await criarMinhaTaskAction({ titulo: "Ligar", vencimento: new Date("2026-08-05T00:00:00.000Z") });

    expect(criarTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ responsavelId: "vendedor-1", titulo: "Ligar" })
    );
  });

  it("propaga leadId ao service quando informado (vínculo com a página de detalhe do lead)", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake());
    criarTaskMock.mockResolvedValue(taskFake({ leadId: "lead-1" }));

    await criarMinhaTaskAction({
      titulo: "Follow-up",
      vencimento: new Date("2026-08-05T00:00:00.000Z"),
      leadId: "lead-1",
    });

    expect(criarTaskMock).toHaveBeenCalledWith(expect.objectContaining({ leadId: "lead-1" }));
  });

  it("sessão inválida vira resultado com a mensagem da casa, sem chamar o service", async () => {
    usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));

    const resultado = await criarMinhaTaskAction({
      titulo: "X",
      vencimento: new Date("2026-08-05T00:00:00.000Z"),
    });

    // A mensagem vem de `MENSAGEM_SESSAO_INVALIDA` (`src/lib/acao.ts`), a
    // mesma que editar/excluir/reabrir já mostravam. Antes esta action LANÇAVA
    // e o Next redigia o erro em produção: a pessoa lia um identificador
    // opaco no lugar de "sua sessão expirou".
    expect(resultado).toEqual({ ok: false, erro: MENSAGEM_SESSAO_INVALIDA });
    expect(criarTaskMock).not.toHaveBeenCalled();
  });

  it("nao invalida cache nenhum quando a criacao falha", async () => {
    // `revalidatePath` fica FORA do `try`. Se a ordem se invertesse, uma
    // criação recusada ainda derrubaria o cache de três rotas — trabalho
    // inútil disfarçado de correção.
    usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));

    await criarMinhaTaskAction({ titulo: "X", vencimento: new Date("2026-08-05T00:00:00.000Z") });

    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("concluirMinhaTaskAction", () => {
  it("deriva autorId da sessão — a assinatura só aceita taskId, nada de autor vindo do cliente", async () => {
    const vendedor = usuarioFake({ id: "vendedor-2" });
    usuarioAtualMock.mockResolvedValue(vendedor);
    concluirTaskMock.mockResolvedValue(taskFake({ responsavelId: "vendedor-2" }));

    await concluirMinhaTaskAction("task-1");

    // `companyId` entrou nesta comparação EXATA porque ela é exata: enquanto o
    // dublê era `User` (sem `companyId`), a action chamava o serviço com
    // `companyId: undefined` e esta linha continuava verde -- o Vitest trata
    // chave de valor `undefined` como ausente. Era a quarta face do mesmo
    // defeito, e a única que já estava escrita antes do Ciclo 1f. Com os três
    // campos nomeados, um quarto argumento acrescentado por descuido fica
    // vermelho aqui.
    expect(concluirTaskMock).toHaveBeenCalledWith({
      companyId: EMPRESA_FAKE,
      taskId: "task-1",
      autorId: "vendedor-2",
    });
  });

  it(
    "tarefa de outra pessoa vira resultado com a frase completa — o caso de alguém tentando " +
      "concluir a tarefa de um colega (checagem real fica em concluirTask, service.ts)",
    async () => {
      usuarioAtualMock.mockResolvedValue(usuarioFake());
      concluirTaskMock.mockRejectedValue(new Error("Tarefa não encontrada"));

      const resultado = await concluirMinhaTaskAction("task-de-outro-usuario");

      // A frase inteira, e não o "Tarefa não encontrada" cru do serviço: ela
      // morava dentro de `task-list.tsx` e só valia para quem clicasse
      // "Concluir" — quem clicasse "Excluir" na MESMA tarefa lia o texto seco.
      // Agora sai de `MENSAGENS_MELHORADAS` e vale para as cinco actions.
      //
      // A frase preserva a ambiguidade de propósito ("não existe mais OU não
      // pertence a você"): distinguir os dois casos confirmaria, a quem está
      // adivinhando ids, que aquele id existe.
      expect(resultado).toEqual({
        ok: false,
        erro: "Essa tarefa não existe mais ou não pertence a você. Atualize a página.",
      });
    }
  );

  it("sessão inválida vira resultado sem chamar o service", async () => {
    usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));

    const resultado = await concluirMinhaTaskAction("task-1");

    expect(resultado).toEqual({ ok: false, erro: MENSAGEM_SESSAO_INVALIDA });
    expect(concluirTaskMock).not.toHaveBeenCalled();
  });

  it("falha de infraestrutura NAO vaza o motivo para a tela", async () => {
    // O outro lado da moeda de `MENSAGENS_MELHORADAS`: mensagem de domínio a
    // pessoa pode ler e agir; "connect ECONNREFUSED 10.0.0.4:5432" é detalhe
    // de infraestrutura e vai só para o log do servidor.
    usuarioAtualMock.mockResolvedValue(usuarioFake());
    concluirTaskMock.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.4:5432"));

    const resultado = await concluirMinhaTaskAction("task-1");

    expect(resultado).toEqual({
      ok: false,
      erro: "Não foi possível concluir a tarefa. Tente novamente em instantes.",
    });
  });
});
