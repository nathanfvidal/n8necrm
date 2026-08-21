import { describe, it, expect, vi, beforeEach } from "vitest";

const EMPRESA = "empresa-do-teste";

// O banco falso é o CLIENTE ESCOPADO, não o `prisma` cru — `service.ts` deixou
// de importar `@/lib/prisma` no Ciclo 1a (Task 4). Três coisas mudaram de
// nome, e cada uma por um motivo próprio:
//
// - `lead.findUniqueOrThrow` → `lead.findFirstOrThrow` e `lead.update` →
//   `lead.updateManyAndReturn` (que devolve LISTA): o escopo recusa operação
//   por chave única em modelo de tenant — ver "Recusa, lançando" em
//   `core/tenancy/escopo.ts`.
// - `pipelineStage.findUnique` → `pipelineStage.findFirst`: mesma razão.
// - `user.findUnique` → `membership.findFirst`: esta é a correção do achado
//   B. O serviço conferia que o responsável EXISTE e está ATIVO, nunca que ele
//   é da mesma empresa — e quem define "pessoa desta empresa" é `Membership`,
//   não `User`, que não tem `companyId` nenhum. O mock precisa devolver o
//   VÍNCULO, com a pessoa dentro dele.
const prismaMock = vi.hoisted(() => ({
  lead: { findFirstOrThrow: vi.fn(), updateManyAndReturn: vi.fn() },
  membership: { findFirst: vi.fn() },
  pipelineStage: { findFirst: vi.fn() },
}));
const auditoriaMock = vi.hoisted(() => vi.fn());
const escopoMock = vi.hoisted(() => vi.fn());

// Este arquivo MOCKA O ESCOPO: nada aqui prova que `companyId` chega à
// consulta — isso é `tests/unit/lead-isolamento.test.ts`, contra duas empresas
// de verdade no Postgres. O que este arquivo prova continua sendo a regra de
// negócio de `atualizarLead` (conversão de valor, recusa de responsável
// desativado, auditoria só do que mudou).
vi.mock("@/core/tenancy/escopo", () => ({ prismaDaEmpresa: escopoMock }));
vi.mock("@/core/users/empresa", () => ({
  companyIdDoUsuario: vi.fn(async () => EMPRESA),
}));
vi.mock("@/core/audit/log", () => ({ registrarAuditoria: auditoriaMock }));
vi.mock("@/core/notifications/dispatch", () => ({ notificarNovoLead: vi.fn() }));

import { atualizarLead } from "../../src/core/leads/service";

const LEAD_ANTES = {
  id: "lead-1",
  valorEstimado: null,
  responsavelId: "user-1",
  stageId: "etapa-1",
};

/** O formato que `responsavelDaEmpresa` (`service.ts`) lê: vínculo com a pessoa dentro. */
function vinculoDe(pessoa: { nome?: string; ativo: boolean }) {
  return { user: { nome: pessoa.nome ?? "Fulano", ativo: pessoa.ativo } };
}

beforeEach(() => {
  vi.clearAllMocks();
  escopoMock.mockReturnValue(prismaMock);
  prismaMock.lead.findFirstOrThrow.mockResolvedValue(LEAD_ANTES);
  prismaMock.membership.findFirst.mockResolvedValue(vinculoDe({ ativo: true }));
  prismaMock.pipelineStage.findFirst.mockResolvedValue({ id: "etapa-2" });
  prismaMock.lead.updateManyAndReturn.mockImplementation(({ data }) => [{ ...LEAD_ANTES, ...data }]);
});

describe("atualizarLead", () => {
  it("converte o valor em texto para Decimal", async () => {
    await atualizarLead({
      leadId: "lead-1",
      valorEstimado: "1.500,50",
      responsavelId: "user-1",
      stageId: "etapa-1",
      autorId: "user-1",
    });

    const dados = prismaMock.lead.updateManyAndReturn.mock.calls[0][0].data;
    expect(dados.valorEstimado.toString()).toBe("1500.5");
  });

  it("recusa valor mal formado antes de tocar o banco", async () => {
    await expect(
      atualizarLead({
        leadId: "lead-1",
        valorEstimado: "1.5",
        responsavelId: "user-1",
        stageId: "etapa-1",
        autorId: "user-1",
      })
    ).rejects.toThrow(/Valor inválido/);

    expect(prismaMock.lead.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it("aceita null para limpar o valor", async () => {
    await atualizarLead({
      leadId: "lead-1",
      valorEstimado: null,
      responsavelId: "user-1",
      stageId: "etapa-1",
      autorId: "user-1",
    });

    expect(prismaMock.lead.updateManyAndReturn.mock.calls[0][0].data.valorEstimado).toBeNull();
  });

  // Vínculo ausente cobre DOIS casos de uma vez, e a mensagem é a mesma para
  // os dois de propósito: id que não existe, e id que existe mas é de outra
  // empresa. Diferenciá-los confirmaria a quem sonda ids que aquele cuid
  // pertence a alguém — ver `responsavelDaEmpresa` em `service.ts`.
  it("recusa responsavel sem vinculo nesta empresa com erro de dominio, nao violacao de FK", async () => {
    prismaMock.membership.findFirst.mockResolvedValue(null);

    await expect(
      atualizarLead({
        leadId: "lead-1",
        valorEstimado: null,
        responsavelId: "fantasma",
        stageId: "etapa-1",
        autorId: "user-1",
      })
    ).rejects.toThrow(/Responsável não encontrado/);
    expect(prismaMock.lead.updateManyAndReturn).not.toHaveBeenCalled();
  });

  // Achado da auditoria: a checagem conferia existência, não situação — dava
  // para entregar um lead a quem não consegue mais entrar no sistema. A tela
  // só lista usuários ativos, mas Server Action é endpoint HTTP público.
  it("recusa atribuir o lead a usuario desativado", async () => {
    prismaMock.membership.findFirst.mockResolvedValue(vinculoDe({ nome: "Beto", ativo: false }));

    await expect(
      atualizarLead({
        leadId: "lead-1",
        valorEstimado: null,
        responsavelId: "user-2",
        stageId: "etapa-1",
        autorId: "user-1",
      })
    ).rejects.toThrow(/desativado/);
    expect(prismaMock.lead.updateManyAndReturn).not.toHaveBeenCalled();
  });

  // O contrário disto trancaria a edição: um lead que já pertence a alguém
  // desativado ficaria impossível de corrigir, inclusive para reatribuir.
  it("permite salvar sem trocar o responsavel, mesmo que ele esteja desativado", async () => {
    prismaMock.membership.findFirst.mockResolvedValue(vinculoDe({ nome: "Ana", ativo: false }));

    await atualizarLead({
      leadId: "lead-1",
      valorEstimado: "100",
      responsavelId: "user-1",
      stageId: "etapa-1",
      autorId: "user-1",
    });

    expect(prismaMock.lead.updateManyAndReturn).toHaveBeenCalled();
  });

  it("recusa etapa inexistente", async () => {
    prismaMock.pipelineStage.findFirst.mockResolvedValue(null);

    await expect(
      atualizarLead({
        leadId: "lead-1",
        valorEstimado: null,
        responsavelId: "user-1",
        stageId: "fantasma",
        autorId: "user-1",
      })
    ).rejects.toThrow(/Etapa não encontrada/);
  });

  it("atualiza ultimaInteracaoEm quando a etapa muda", async () => {
    await atualizarLead({
      leadId: "lead-1",
      valorEstimado: null,
      responsavelId: "user-1",
      stageId: "etapa-2",
      autorId: "user-1",
    });

    expect(prismaMock.lead.updateManyAndReturn.mock.calls[0][0].data.ultimaInteracaoEm).toBeInstanceOf(Date);
  });

  it("NAO mexe em ultimaInteracaoEm quando a etapa nao muda", async () => {
    await atualizarLead({
      leadId: "lead-1",
      valorEstimado: "100",
      responsavelId: "user-1",
      stageId: "etapa-1",
      autorId: "user-1",
    });

    expect(prismaMock.lead.updateManyAndReturn.mock.calls[0][0].data.ultimaInteracaoEm).toBeUndefined();
  });

  it("audita apenas os campos que mudaram", async () => {
    await atualizarLead({
      leadId: "lead-1",
      valorEstimado: null,
      responsavelId: "user-2",
      stageId: "etapa-1",
      autorId: "user-9",
    });

    expect(auditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-9",
        acao: "atualizar_lead",
        entidade: "Lead",
        entidadeId: "lead-1",
        antes: { responsavelId: "user-1" },
        depois: { responsavelId: "user-2" },
      })
    );
  });

  it("nao grava auditoria quando nada mudou", async () => {
    await atualizarLead({
      leadId: "lead-1",
      valorEstimado: null,
      responsavelId: "user-1",
      stageId: "etapa-1",
      autorId: "user-1",
    });

    expect(auditoriaMock).not.toHaveBeenCalled();
  });

  // O caso que faltava a uma afirmação UNIVERSAL sobre chamadores.
  //
  // `atualizarLeadEscopado` (`core/leads/service.ts`) documenta que "a lista
  // não pode vir vazia: as chamadoras já leram o lead antes, com o mesmo
  // escopo". A afirmação é verdadeira hoje — os 4 chamadores fazem
  // `findFirstOrThrow` sob o mesmo `db` antes —, mas é sobre TODA chamadora
  // presente e futura, e o ramo que ela justifica não tinha caso nenhum. Se
  // amanhã alguém chamar sem ler antes, ou se a leitura e a escrita saírem de
  // escopos diferentes, é este `throw` que segura — e sem este teste ninguém
  // saberia se ele ainda funciona, nem qual mensagem ele dá.
  //
  // A mensagem importa: é ela que diz "sumiu do ESCOPO desta empresa", em vez
  // de deixar o `[0]` virar `undefined` e o erro aparecer três linhas adiante,
  // sem relação visível com a causa.
  it("lança quando a gravação escopada não devolve linha nenhuma", async () => {
    prismaMock.lead.updateManyAndReturn.mockResolvedValue([]);

    await expect(
      atualizarLead({
        leadId: "lead-1",
        valorEstimado: null,
        responsavelId: "user-2",
        stageId: "etapa-1",
        autorId: "user-9",
      })
    ).rejects.toThrow(/^Lead não encontrado ao gravar: "lead-1"/);

    // E não audita uma atualização que não aconteceu.
    expect(auditoriaMock).not.toHaveBeenCalled();
  });
});
