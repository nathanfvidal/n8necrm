// @vitest-environment jsdom
//
// Cobre só a lógica de ramificação do client component (não layout/estilo,
// mesma instrução das Tasks 14/15/17 para os outros formulários): que a
// string "AAAA-MM-DD" do <input type="date"> chega à action ancorada em
// meia-noite UTC (a ponte para o comportamento coberto em profundidade por
// date.test.ts), que `leadId` passa por prop quando presente, e que os
// erros esperados (`Data inválida`, `Não autenticado`) viram mensagem em
// português sem perder o que a pessoa digitou.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const criarMinhaTaskMock = vi.fn();
vi.mock("@/core/tasks/actions", () => ({
  criarMinhaTaskAction: (...args: unknown[]) => criarMinhaTaskMock(...args),
}));

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const { TaskForm } = await import("../../src/components/tasks/task-form");

afterEach(() => {
  cleanup();
  criarMinhaTaskMock.mockReset();
  refreshMock.mockReset();
});

async function preencherEEnviar(titulo: string, vencimento: string) {
  fireEvent.change(screen.getByLabelText("Título"), { target: { value: titulo } });
  fireEvent.change(screen.getByLabelText("Vencimento"), { target: { value: vencimento } });
  fireEvent.click(screen.getByRole("button", { name: /Adicionar tarefa/ }));
}

describe("TaskForm", () => {
  it("converte a string do <input type=\"date\"> num Date ancorado em meia-noite UTC (sem deslocar de dia)", async () => {
    criarMinhaTaskMock.mockResolvedValue({ ok: true });
    render(<TaskForm />);

    await preencherEEnviar("Ligar pro fornecedor", "2026-08-05");

    await waitFor(() => expect(criarMinhaTaskMock).toHaveBeenCalledTimes(1));
    const [argumento] = criarMinhaTaskMock.mock.calls[0] as [{ vencimento: Date }];
    expect(argumento.vencimento.toISOString()).toBe("2026-08-05T00:00:00.000Z");
  });

  it("propaga leadId à action quando informado via prop (uso na página de detalhe do lead)", async () => {
    criarMinhaTaskMock.mockResolvedValue({ ok: true });
    render(<TaskForm leadId="lead-42" />);

    await preencherEEnviar("Follow-up", "2026-08-05");

    await waitFor(() => expect(criarMinhaTaskMock).toHaveBeenCalledTimes(1));
    const [argumento] = criarMinhaTaskMock.mock.calls[0] as [{ leadId?: string }];
    expect(argumento.leadId).toBe("lead-42");
  });

  it("não envia leadId quando a prop não é passada (uso em /tasks)", async () => {
    criarMinhaTaskMock.mockResolvedValue({ ok: true });
    render(<TaskForm />);

    await preencherEEnviar("Tarefa sem lead", "2026-08-05");

    await waitFor(() => expect(criarMinhaTaskMock).toHaveBeenCalledTimes(1));
    const [argumento] = criarMinhaTaskMock.mock.calls[0] as [{ leadId?: string }];
    expect(argumento.leadId).toBeUndefined();
  });

  // Não há teste RTL para "data que não existe no calendário" (ex.:
  // "2026-02-30"): o próprio `<input type="date">` — nativo no browser, e
  // jsdom reproduz o mesmo comportamento aqui — recusa esse valor antes
  // mesmo de chegar ao componente (`.value` fica vazio), então esse ramo de
  // `parseDataCivil` nunca é alcançado por ESTA UI. Ele continua sendo
  // defesa em profundidade (chamada direta, outro client, um browser mais
  // permissivo) e está coberto a fundo em tests/unit/date.test.ts.

  // ─── O erro chega como DADO, não como exceção ─────────────────────────
  //
  // Estes dois testes mudaram de assunto quando `criarMinhaTaskAction` passou a
  // devolver `ResultadoAcao`. Antes eles provavam a ESCADA de comparações
  // contra `erro.message` que morava neste componente ("Não autenticado" →
  // frase amigável, resto → fallback genérico). Essa escada era o defeito:
  // texto produzido no servidor, casado por string no cliente, quebrando em
  // silêncio se alguém reescrevesse a mensagem em `service.ts`.
  //
  // Quem decide a frase agora é a action (`MENSAGENS_MELHORADAS` e
  // `MENSAGENS_SEGURAS`, em `core/tasks/actions.ts`, com os casos cobertos em
  // `task-actions.test.ts`). O que sobra para o formulário provar é mais
  // simples e mais importante: mostra o que veio, sem reescrever, e não joga
  // fora o que a pessoa digitou.
  it("mostra a mensagem que a action devolveu, sem reescrever", async () => {
    criarMinhaTaskMock.mockResolvedValue({
      ok: false,
      erro: "Sua sessão expirou. Recarregue a página e entre de novo.",
    });
    render(<TaskForm />);

    await preencherEEnviar("Tarefa qualquer", "2026-08-05");

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(
        "Sua sessão expirou. Recarregue a página e entre de novo."
      );
    });
  });

  it("falha NÃO limpa o formulário — o que foi digitado continua lá", async () => {
    criarMinhaTaskMock.mockResolvedValue({ ok: false, erro: "Descrição longa demais." });
    render(<TaskForm />);

    await preencherEEnviar("Tarefa que falhou", "2026-08-05");

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect((screen.getByLabelText("Título") as HTMLInputElement).value).toBe("Tarefa que falhou");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // NÃO existe teste aqui para "parseDataCivil lançou": o comentário algumas
  // linhas acima já explica por quê — o `<input type="date">` (nativo, e o
  // jsdom reproduz) recusa "2026-13-45" antes de o componente ver o valor, e
  // o schema barra o campo vazio. Escrevi esse teste, ele falhou, e a resposta
  // certa era a que já estava escrita no arquivo, não insistir. `parseDataCivil`
  // continua coberto a fundo em `tests/unit/date.test.ts`.

  it("sucesso: limpa o formulário e chama router.refresh", async () => {
    criarMinhaTaskMock.mockResolvedValue({ ok: true });
    render(<TaskForm />);

    await preencherEEnviar("Tarefa concluída no envio", "2026-08-05");

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect((screen.getByLabelText("Título") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

// ─── contactIdPadrao ────────────────────────────────────────────────────
//
// Em `/leads/[id]` o formulário é renderizado SEM a lista de contatos, então
// o `<select>` não existe naquela tela. O contato do lead chega por
// `contactIdPadrao` e precisa viajar assim mesmo — via `defaultValues`, sem
// campo registrado.
//
// Isto merece teste próprio e não confiança no comportamento do
// `react-hook-form`: o MESMO mecanismo (valor padrão de campo não
// registrado seguir no envio) foi o que apagou o CPF de contatos quando o
// campo passou a ser escondido por permissão. Lá o comportamento trabalhou
// contra; aqui trabalha a favor. Nos dois casos, o que decide não é
// intuição — é a asserção sobre o que chegou na action.
describe("TaskForm com contato pré-escolhido", () => {
  it("envia o contactId padrão mesmo sem o <select> na tela", async () => {
    criarMinhaTaskMock.mockResolvedValue({ ok: true });
    render(<TaskForm leadId="lead-1" contactIdPadrao="contato-9" />);

    // Prova de que o select realmente não está lá — se um dia passar a
    // estar, este teste deixa de cobrir o caminho que diz cobrir.
    expect(screen.queryByLabelText("Contato")).toBeNull();

    await preencherEEnviar("Ligar pro cliente", "2026-08-05");

    await waitFor(() => expect(criarMinhaTaskMock).toHaveBeenCalledTimes(1));
    expect(criarMinhaTaskMock.mock.calls[0][0]).toMatchObject({
      contactId: "contato-9",
      leadId: "lead-1",
    });
  });

  it("lead sem contato identificado não manda contactId vazio", async () => {
    // `Lead.contactId` é opcional — um lead de WhatsApp pode não ter contato.
    // Mandar `""` reprovaria no servidor com "Contato inválido" por um campo
    // que ninguém preencheu.
    criarMinhaTaskMock.mockResolvedValue({ ok: true });
    render(<TaskForm leadId="lead-1" contactIdPadrao={null} />);

    await preencherEEnviar("Ligar pro cliente", "2026-08-05");

    await waitFor(() => expect(criarMinhaTaskMock).toHaveBeenCalledTimes(1));
    expect(criarMinhaTaskMock.mock.calls[0][0].contactId).toBeUndefined();
  });
});
