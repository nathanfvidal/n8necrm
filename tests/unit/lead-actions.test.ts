// Teste de unidade puro (sem Prisma real): cobre a autorização de
// actions.ts — os dois gates de `hasPermission` e o clamp de
// `responsavelId` (fix round 1/5, achado do revisor: essa lógica não tinha
// nenhuma cobertura própria além de leitura/typecheck/lint). `auth()` do
// Auth.js é o que de fato não dá para rodar fora de um request HTTP — mas
// nada impede mockar `usuarioAtual()`, `hasPermission()` e o `service`
// diretamente, isolando a decisão de autorização da action de tudo o mais.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { User, Lead } from "@prisma/client";

const usuarioAtualMock = vi.fn();
vi.mock("@/core/auth/session", () => ({ usuarioAtual: () => usuarioAtualMock() }));

// `hasPermission` é mantida REAL por padrão (spy em volta da implementação
// verdadeira) — os testes de clamp de `responsavelId` usam papéis de
// verdade (VENDEDOR/GESTOR) contra a matriz real de
// src/core/auth/permissions.ts, não uma simulação. Só o teste de "sem
// permissão" força um retorno `false` pontual com `mockReturnValueOnce`,
// porque hoje nenhum papel real carece de `criar_lead`/`mover_lead` (os 3
// papéis têm as duas) — isolar essa branch é a única forma de exercitá-la
// sem inventar um papel novo, que está fora do escopo deste fix.
vi.mock("@/core/auth/permissions", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/core/auth/permissions")>();
  return { ...real, hasPermission: vi.fn(real.hasPermission) };
});

const criarLeadMock = vi.fn();
const moverEtapaMock = vi.fn();

// `LeadInvalidoError` precisa existir no mock: `paraResultadoErro`
// (`actions.ts`) faz `erro instanceof LeadInvalidoError`, e as duas actions
// deste describe lançam essa classe no ramo de "sem permissão". Uma classe
// substituta serve porque `instanceof` compara contra a MESMA referência que
// `actions.ts` importa — que é esta, já que o módulo está mockado. Puxar a real
// com `importOriginal` traria `@/lib/prisma` junto e transformaria este arquivo
// num teste de integração, que é exatamente o que o comentário do topo diz que
// ele não é.
const { LeadInvalidoErrorFake } = vi.hoisted(() => {
  class LeadInvalidoErrorFake extends Error {}
  return { LeadInvalidoErrorFake };
});

vi.mock("@/core/leads/service", () => ({
  criarLead: (...args: unknown[]) => criarLeadMock(...args),
  moverEtapa: (...args: unknown[]) => moverEtapaMock(...args),
  LeadInvalidoError: LeadInvalidoErrorFake,
}));

// `actions.ts` passou a importar `./notes` (Task 17) — sem mockar aqui, a
// importação real puxaria `@/lib/prisma` → `@/lib/env`, que exige
// DATABASE_URL/AUTH_SECRET no processo. Este arquivo é deliberadamente um
// teste "puro" (sem Prisma real, ver comentário no topo) — mockar mantém
// essa propriedade em vez de silenciosamente virar um teste de integração.
const adicionarNotaMock = vi.fn();
vi.mock("@/core/leads/notes", () => ({
  adicionarNota: (...args: unknown[]) => adicionarNotaMock(...args),
  TEXTO_MAX_LENGTH: 4000,
}));

// `adicionarNotaAction` chama `revalidatePath` só depois de um `adicionarNota`
// bem-sucedido — fora de uma requisição real do Next.js, a implementação
// real lançaria ("Invariant: static generation store missing"). Mockar
// como no-op deixa este arquivo testar só a autorização/branching da
// action, que é o que ele testa para as outras duas actions também.
const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

const { criarLeadManualAction, moverLeadDeEtapaAction, adicionarNotaAction } = await import(
  "../../src/core/leads/actions"
);
const { hasPermission } = await import("../../src/core/auth/permissions");
const { MENSAGEM_SESSAO_INVALIDA } = await import("../../src/lib/acao");

function usuarioFake(overrides: Partial<User>): User {
  return {
    id: "usuario-fake-id",
    nome: "Usuário Fake",
    email: "fake@teste.local",
    senhaHash: "hash",
    papel: "VENDEDOR",
    ativo: true,
    criadoEm: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function leadFake(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-fake-id",
    contactId: "contact-fake-id",
    itemId: null,
    stageId: "stage-fake-id",
    responsavelId: "usuario-fake-id",
    canal: "MANUAL",
    valorEstimado: null,
    sessionId: null,
    utm: null,
    criadoEm: new Date("2026-01-01T00:00:00.000Z"),
    ultimaInteracaoEm: new Date("2026-01-01T00:00:00.000Z"),
    // Lead ativo. `arquivadoEm` nasceu com a edição/arquivamento
    // (2026-08-08) e é obrigatório no tipo, ainda que nulo.
    arquivadoEm: null,
    ...overrides,
  };
}

function formDataComTexto(texto: string): FormData {
  const formData = new FormData();
  formData.set("texto", texto);
  return formData;
}

beforeEach(() => {
  usuarioAtualMock.mockReset();
  vi.mocked(hasPermission).mockClear();
  criarLeadMock.mockReset();
  moverEtapaMock.mockReset();
  adicionarNotaMock.mockReset();
  revalidatePathMock.mockReset();
});

describe("criarLeadManualAction", () => {
  it("recusa e NÃO chama o service quando o chamador não tem a permissão criar_lead", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "VENDEDOR" }));
    vi.mocked(hasPermission).mockReturnValueOnce(false); // simula um papel sem criar_lead

    const resultado = await criarLeadManualAction({
      nome: "X",
      telefone: "11988880001",
      responsavelId: "usuario-fake-id",
    });

    expect(resultado).toEqual({ ok: false, erro: "Você não tem permissão para criar leads." });
    expect(criarLeadMock).not.toHaveBeenCalled();
  });

  // ─── O que NÃO atravessa a fronteira ──────────────────────────────────
  //
  // Esta action devolvia `Lead`. O retorno de uma Server Action é serializado
  // para o navegador, então `utm` (JSON de rastreio), `sessionId` e `itemId`
  // viajavam junto — para um `LeadForm` que descarta o retorno. `toEqual`
  // reprova qualquer chave a mais, então um `{ ok: true, lead }` acrescentado
  // por descuido fica vermelho aqui.
  it("sucesso devolve só o resultado, nunca o Lead", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ id: "vendedor-8" }));
    criarLeadMock.mockResolvedValue(
      leadFake({ utm: { origem: "google", termo: "segredo" }, sessionId: "sess-secreta" })
    );

    const resultado = await criarLeadManualAction({
      nome: "X",
      telefone: "11988880007",
      responsavelId: "vendedor-8",
    });

    expect(resultado).toEqual({ ok: true });
    expect(JSON.stringify(resultado)).not.toContain("sess-secreta");
  });

  // O texto vem de `dedupe.ts` e é a única mensagem desta action que a pessoa
  // consegue AGIR sobre: ela corrige o telefone e tenta de novo. Antes chegava
  // à tela por outro caminho (a action relançava, `lead-form.tsx` reconhecia
  // por prefixo). Sem `/^Telefone inválido/` em `MENSAGENS_SEGURAS`, cairia no
  // ramo genérico e a pessoa não saberia qual campo consertar.
  it("telefone inválido chega à tela com o motivo, não com o genérico", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ id: "vendedor-9" }));
    criarLeadMock.mockRejectedValue(
      new Error('Telefone inválido: "abc" não contém um número de telefone brasileiro reconhecível.')
    );

    const resultado = await criarLeadManualAction({
      nome: "X",
      telefone: "abc",
      responsavelId: "vendedor-9",
    });

    expect(resultado).toEqual({
      ok: false,
      erro: 'Telefone inválido: "abc" não contém um número de telefone brasileiro reconhecível.',
    });
  });

  it("falha de infraestrutura NÃO vaza o motivo para a tela", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ id: "vendedor-10" }));
    criarLeadMock.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.4:5432"));

    const resultado = await criarLeadManualAction({
      nome: "X",
      telefone: "11988880008",
      responsavelId: "vendedor-10",
    });

    expect(resultado).toEqual({
      ok: false,
      erro: "Não foi possível criar o lead. Tente novamente em instantes.",
    });
  });

  it("não revalida cache nenhum quando a criação falha", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ id: "vendedor-11" }));
    criarLeadMock.mockRejectedValue(new Error("qualquer coisa"));

    await criarLeadManualAction({ nome: "X", telefone: "11988880009", responsavelId: "vendedor-11" });

    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  // Este teste afirmava o CONTRÁRIO até a auditoria de segurança desta
  // branch: o VENDEDOR tinha o `responsavelId` trocado em silêncio pelo
  // próprio id. A trava foi removida porque não travava nada — `atualizarLead`
  // aceita qualquer responsável para quem tem `mover_lead`, que os três papéis
  // têm, então bastava criar para si e reatribuir no clique seguinte. Decisão
  // do dono: lead é colaborativo, criar e editar concordam.
  //
  // O `autorId` continua vindo da sessão — é isso que o teste guarda agora:
  // quem atribui muda, quem AGE não.
  it(
    "VENDEDOR atribui o lead a outra pessoa, e o autorId continua sendo o da sessão",
    async () => {
      const vendedor = usuarioFake({ id: "vendedor-1", papel: "VENDEDOR" });
      usuarioAtualMock.mockResolvedValue(vendedor);
      criarLeadMock.mockResolvedValue(leadFake({ responsavelId: "outra-pessoa-id" }));

      await criarLeadManualAction({
        nome: "X",
        telefone: "11988880002",
        responsavelId: "outra-pessoa-id",
      });

      expect(criarLeadMock).toHaveBeenCalledWith(
        expect.objectContaining({ responsavelId: "outra-pessoa-id", autorId: "vendedor-1" })
      );
      // A decisão passa pela matriz real, e é `criar_lead` que manda agora —
      // `ver_dashboard_geral` deixou de participar desta action.
      expect(hasPermission("VENDEDOR", "criar_lead")).toBe(true);
    }
  );

  it(
    "GESTOR (papel real) CONSEGUE atribuir o lead a outra pessoa: o responsavelId do formulário é " +
      "respeitado sem alteração",
    async () => {
      const gestor = usuarioFake({ id: "gestor-1", papel: "GESTOR" });
      usuarioAtualMock.mockResolvedValue(gestor);
      criarLeadMock.mockResolvedValue(leadFake({ responsavelId: "outra-pessoa-id" }));

      await criarLeadManualAction({
        nome: "X",
        telefone: "11988880003",
        responsavelId: "outra-pessoa-id",
      });

      expect(criarLeadMock).toHaveBeenCalledWith(
        expect.objectContaining({ responsavelId: "outra-pessoa-id", autorId: "gestor-1" })
      );
    }
  );

  it(
    "criação com sucesso: revalida o layout do painel (não só a página /leads) — Task 19, para o " +
      "sino de notificações refletir a contagem nova no próximo router.refresh() do cliente",
    async () => {
      usuarioAtualMock.mockResolvedValue(usuarioFake({ id: "vendedor-4" }));
      criarLeadMock.mockResolvedValue(leadFake({ responsavelId: "vendedor-4" }));

      await criarLeadManualAction({ nome: "X", telefone: "11988880006", responsavelId: "vendedor-4" });

      expect(revalidatePathMock).toHaveBeenCalledWith("/(painel)", "layout");
    }
  );

  it("o responsavelId do formulário é respeitado quando é o próprio autor (não é atribuição a outra pessoa)", async () => {
    const vendedor = usuarioFake({ id: "vendedor-2", papel: "VENDEDOR" });
    usuarioAtualMock.mockResolvedValue(vendedor);
    criarLeadMock.mockResolvedValue(leadFake({ responsavelId: vendedor.id }));

    await criarLeadManualAction({ nome: "X", telefone: "11988880004", responsavelId: "vendedor-2" });

    expect(criarLeadMock).toHaveBeenCalledWith(expect.objectContaining({ responsavelId: "vendedor-2" }));
  });

  it(
    "sessão inválida vira resultado, sem chamar hasPermission nem o service " +
      "(sessão ausente OU usuário desativado — os dois casos chegam aqui do mesmo jeito)",
    async () => {
      usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));

      const resultado = await criarLeadManualAction({
        nome: "X",
        telefone: "11988880005",
        responsavelId: "qualquer",
      });

      // Antes esta action LANÇAVA, e o Next redige erro não tratado de Server
      // Action em produção: a pessoa lia um identificador opaco no lugar de
      // "sua sessão expirou".
      expect(resultado).toEqual({ ok: false, erro: MENSAGEM_SESSAO_INVALIDA });
      expect(hasPermission).not.toHaveBeenCalled();
      expect(criarLeadMock).not.toHaveBeenCalled();
    }
  );
});

describe("moverLeadDeEtapaAction", () => {
  it("recusa e NÃO chama o service quando o chamador não tem a permissão mover_lead", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "VENDEDOR" }));
    vi.mocked(hasPermission).mockReturnValueOnce(false); // simula um papel sem mover_lead

    const resultado = await moverLeadDeEtapaAction({ leadId: "lead-1", novaStageId: "stage-2" });

    expect(resultado).toEqual({ ok: false, erro: "Você não tem permissão para mover leads." });
    expect(moverEtapaMock).not.toHaveBeenCalled();
  });

  it("sucesso devolve só o resultado, nunca o Lead", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ id: "vendedor-12" }));
    moverEtapaMock.mockResolvedValue(leadFake({ sessionId: "sess-secreta", utm: { t: "x" } }));

    const resultado = await moverLeadDeEtapaAction({ leadId: "lead-1", novaStageId: "stage-2" });

    expect(resultado).toEqual({ ok: true });
    expect(JSON.stringify(resultado)).not.toContain("sess-secreta");
  });

  // ─── Mover mudava o banco e deixava quatro telas em cache velho ───────
  //
  // Esta action não invalidava NADA. O quadro ficava certo pela atualização
  // otimista e todo o resto mentia: `/leads` com a etapa anterior na coluna
  // "Etapa", o histórico do contato idem, e o painel com a contagem por etapa
  // de antes — logo depois de ele ter passado a calcular a taxa de conversão
  // com `groupBy` exato. Número exato servido de cache velho parece confiável,
  // que é o que o torna pior que um aproximado.
  it("mover invalida as quatro telas que mostram a etapa, mais a do contato", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ id: "vendedor-14" }));
    moverEtapaMock.mockResolvedValue(leadFake({ id: "lead-1", contactId: "contato-9" }));

    await moverLeadDeEtapaAction({ leadId: "lead-1", novaStageId: "stage-2" });

    expect(revalidatePathMock).toHaveBeenCalledWith("/leads");
    expect(revalidatePathMock).toHaveBeenCalledWith("/leads/kanban");
    expect(revalidatePathMock).toHaveBeenCalledWith("/leads/lead-1");
    // `/` é o painel — a razão de esta lacuna ter deixado de ser barata.
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    // `contatos/[id]` renderiza `lead.etapaNome`; sem isto o histórico da
    // pessoa mostraria a etapa anterior.
    expect(revalidatePathMock).toHaveBeenCalledWith("/contatos/contato-9");
  });

  // O `contactId` vem da linha DEVOLVIDA pelo serviço — a action só recebe
  // `leadId` e `novaStageId`. Um lead de clique de WhatsApp pode não ter
  // contato ainda (`Lead.contact` é nullable), e aí não existe caminho de
  // contato para invalidar.
  it("lead sem contato: invalida o resto sem inventar uma rota de contato", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ id: "vendedor-15" }));
    moverEtapaMock.mockResolvedValue(leadFake({ id: "lead-1", contactId: null }));

    await moverLeadDeEtapaAction({ leadId: "lead-1", novaStageId: "stage-2" });

    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    const rotas = revalidatePathMock.mock.calls.map((c) => c[0] as string);
    expect(rotas.some((rota) => rota.startsWith("/contatos/"))).toBe(false);
  });

  it("mover recusado não invalida cache nenhum", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ papel: "VENDEDOR" }));
    vi.mocked(hasPermission).mockReturnValueOnce(false);

    await moverLeadDeEtapaAction({ leadId: "lead-1", novaStageId: "stage-2" });

    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  // `Etapa não encontrada: "<stageId>"` interpolava um cuid interno, e
  // `MENSAGENS_SEGURAS` o repassava verbatim ao navegador. A pessoa não pode
  // fazer nada com um id; `MENSAGENS_MELHORADAS` troca por uma frase acionável.
  it("etapa inexistente vira frase acionável, sem o id interno", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ id: "vendedor-13" }));
    moverEtapaMock.mockRejectedValue(
      new Error('Etapa não encontrada: "clx9etapa0000segredo" não corresponde a nenhuma etapa do funil.')
    );

    const resultado = await moverLeadDeEtapaAction({
      leadId: "lead-1",
      novaStageId: "clx9etapa0000segredo",
    });

    expect(resultado).toEqual({ ok: false, erro: "Essa etapa não existe mais. Atualize a página." });
    expect(JSON.stringify(resultado)).not.toContain("clx9etapa0000segredo");
  });

  it("delega ao service com autorId derivado da sessão (nunca do input) quando o chamador tem permissão", async () => {
    const vendedor = usuarioFake({ id: "vendedor-3", papel: "VENDEDOR" });
    usuarioAtualMock.mockResolvedValue(vendedor);
    moverEtapaMock.mockResolvedValue(leadFake({ stageId: "stage-2" }));

    await moverLeadDeEtapaAction({ leadId: "lead-1", novaStageId: "stage-2" });

    expect(moverEtapaMock).toHaveBeenCalledWith({
      leadId: "lead-1",
      novaStageId: "stage-2",
      autorId: "vendedor-3",
    });
  });

  it(
    "sessão inválida vira resultado, sem chamar hasPermission nem o service " +
      "(sessão ausente OU usuário desativado)",
    async () => {
      usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));

      const resultado = await moverLeadDeEtapaAction({ leadId: "lead-1", novaStageId: "stage-2" });

      expect(resultado).toEqual({ ok: false, erro: MENSAGEM_SESSAO_INVALIDA });
      expect(hasPermission).not.toHaveBeenCalled();
      expect(moverEtapaMock).not.toHaveBeenCalled();
    }
  );
});

// Fix round 1/5 (Task 17), achado do revisor: uma nota acima do limite de
// tamanho lançava sem tratamento dentro da Server Action original (não
// existe `error.tsx` sob src/app), então a pessoa via a tela de erro
// genérica do Next em vez de uma mensagem. Estes testes cobrem só a
// autorização/branching de `adicionarNotaAction` — o comportamento real de
// `adicionarNota` (trim, limite de tamanho, etc.) já é coberto contra
// Prisma real em tests/unit/lead-notes.test.ts; aqui `adicionarNotaMock`
// simula cada resposta possível dela.
describe("adicionarNotaAction", () => {
  it("deriva autorId da sessão (nunca de FormData) e chama revalidatePath após salvar com sucesso", async () => {
    const vendedor = usuarioFake({ id: "vendedor-4", papel: "VENDEDOR" });
    usuarioAtualMock.mockResolvedValue(vendedor);
    adicionarNotaMock.mockResolvedValue({ id: "nota-1", texto: "Nota qualquer" });

    const resultado = await adicionarNotaAction(
      "lead-1",
      { erro: null },
      formDataComTexto("Nota qualquer")
    );

    expect(adicionarNotaMock).toHaveBeenCalledWith({
      leadId: "lead-1",
      autorId: "vendedor-4",
      texto: "Nota qualquer",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/leads/lead-1");
    expect(resultado).toEqual({ erro: null });
  });

  it("texto vazio/só-espaço: no-op silencioso, não chama adicionarNota nem revalidatePath", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ id: "vendedor-5" }));

    const resultado = await adicionarNotaAction("lead-1", { erro: null }, formDataComTexto("   "));

    expect(adicionarNotaMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(resultado).toEqual({ erro: null });
  });

  it(
    "nota muito longa: devolve { erro } com a mensagem de adicionarNota em vez de lançar — é " +
      "exatamente o caso que quebrava antes deste fix",
    async () => {
      usuarioAtualMock.mockResolvedValue(usuarioFake({ id: "vendedor-6" }));
      adicionarNotaMock.mockRejectedValue(
        new Error("Nota muito longa: o texto tem 4001 caracteres, o máximo permitido é 4000.")
      );

      const resultado = await adicionarNotaAction(
        "lead-1",
        { erro: null },
        formDataComTexto("a".repeat(4001))
      );

      expect(resultado.erro).toMatch(/Nota muito longa/);
      expect(revalidatePathMock).not.toHaveBeenCalled();
    }
  );

  it("qualquer outro erro de adicionarNota (ex.: banco fora do ar) propaga sem virar { erro }", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake({ id: "vendedor-7" }));
    adicionarNotaMock.mockRejectedValue(new Error("Conexão com o banco falhou"));

    await expect(
      adicionarNotaAction("lead-1", { erro: null }, formDataComTexto("Nota qualquer"))
    ).rejects.toThrow("Conexão com o banco falhou");
  });

  it("propaga 'Não autenticado' sem chamar adicionarNota quando usuarioAtual rejeita", async () => {
    usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));

    await expect(
      adicionarNotaAction("lead-1", { erro: null }, formDataComTexto("Nota qualquer"))
    ).rejects.toThrow("Não autenticado");

    expect(adicionarNotaMock).not.toHaveBeenCalled();
  });
});
