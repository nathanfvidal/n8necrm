// Este arquivo usa o Prisma REAL contra o Postgres do Supabase, então carrega
// DATABASE_URL do .env aqui — não em vitest.config.ts — para não injetar
// credenciais em testes que não tocam banco. Precisa ser o primeiro import:
// os módulos abaixo (via src/lib/prisma.ts → src/lib/env.ts) leem
// process.env.DATABASE_URL no top-level. Mesmo padrão de
// `tests/unit/lead-isolamento.test.ts`.
import "dotenv/config";

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server" que o Next.js aplica no build — fora desse pipeline (aqui,
// sob Vitest) ele sempre lança. `src/core/pipeline/service.ts` e
// `src/lib/prisma.ts` importam. Ver tests/unit/storage.test.ts, onde o mock
// foi documentado.
vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import {
  criarEtapa,
  editarEtapa,
  moverNaOrdem,
  definirEtapaDeFechamento,
  excluirEtapa,
  EtapaInvalidaError,
} from "../../src/core/pipeline/service";
import { listarEtapas, contarLeadsQueSeguramEtapa } from "../../src/core/pipeline/stages";

/**
 * O par de `tests/unit/lead-isolamento.test.ts`, agora para `pipeline`: para
 * cada função pública, prova de que o escopo da empresa A não alcança dado da
 * empresa B.
 *
 * ## Contra o banco de verdade, e não contra o banco falso
 *
 * `tests/unit/escopo-empresa.test.ts` exercita o MECANISMO (`prismaDaEmpresa`)
 * com um banco falso; `tests/unit/pipeline-transacoes.test.ts` exercita a FORMA
 * das transações com o cliente escopado dublado. Nenhum dos dois responde a
 * pergunta deste arquivo, que é outra: "o serviço de `pipeline` chega ao dado
 * da outra empresa?". Essa só tem resposta contra duas empresas de verdade,
 * com FK, `@@unique` e transação de verdade — e, no caso de
 * `definirEtapaDeFechamento` e `excluirEtapa`, com o `$transaction` REAL, que é
 * o único lugar onde dá para provar que o escopo atravessa a fronteira da
 * transação (o `escopo.ts` só tinha evidência da FÁBRICA do cliente interativo,
 * não de uma transação de ponta a ponta).
 *
 * ## As DUAS metades, sempre
 *
 * Todo caso tem a segunda metade: além de provar que o escopo A não alcança B,
 * prova que o dado da empresa CERTA continua chegando. Sem ela, "não devolver
 * nada para ninguém" passaria como correção — e um serviço quebrado passa em
 * qualquer teste que só afirme ausência.
 *
 * ## Nada é medido com a MESMA consulta que o código faz
 *
 * Lição do reparo de 2026-08-20 (commit 63cecd2): três casos afirmavam o total
 * contra `prisma.user.count({ where: { ativo: true } })` — a mesma consulta sem
 * empresa que o defeito tinha, e o teste espelhava o bug. Aqui as expectativas
 * são ids FIXOS criados pela fixture, conferidos com o `prisma` CRU, fora do
 * escopo — nunca com uma segunda chamada ao serviço sob teste.
 */

// ─── Ids fixos ────────────────────────────────────────────────────────────
//
// Prefixo próprio deste arquivo, para que a limpeza apague por prefixo sem
// tocar em nada do seed nem de outro arquivo de teste.
const P = "iso-pipe";
const EMPRESA_A = `${P}-company-a`;
const EMPRESA_B = `${P}-company-b`;
const EMPRESA_C = `${P}-company-c`;
const USUARIO_A = `${P}-user-a`;
const USUARIO_B = `${P}-user-b`;
const USUARIO_C = `${P}-user-c`;

const ETAPA_A1 = `${P}-stage-a1`;
const ETAPA_A2 = `${P}-stage-a2`;
const ETAPA_A3 = `${P}-stage-a3`;
const ETAPA_B1 = `${P}-stage-b1`;
const ETAPA_B2 = `${P}-stage-b2`;
const ETAPA_C1 = `${P}-stage-c1`;

const CONTATO_A = `${P}-contact-a`;
const CONTATO_B = `${P}-contact-b`;
const LEAD_A = `${P}-lead-a`;
const LEAD_B = `${P}-lead-b`;

/**
 * Desde o Ciclo 1e, `PipelineStage` tem `@@unique([companyId, ordem])`, então o
 * banco NÃO exige mais faixas disjuntas entre empresas — há caso neste arquivo
 * provando isso ("duas empresas podem ter etapas na MESMA posição do funil").
 * As faixas continuam disjuntas por outro motivo, que segue valendo: elas são
 * altas de propósito para não colidir com as do seed (medidas em 2026-08-20 na
 * empresa `company-migracao-1a`: 0, 1, 2 e 3) — se a fixture usasse a mesma
 * faixa, um caso passaria por acidente.
 *
 * A escolha das faixas é o que faz três casos DISCRIMINAREM em vez de
 * decorarem:
 *
 * - A empresa A ocupa 9201-9203 e a B ocupa 9301-9302, então a etapa
 *   imediatamente ABAIXO da última da A, na tabela inteira, é uma etapa da B.
 *   `moverNaOrdem(A3, "baixo")` sem escopo acha essa vizinha e TROCA as duas
 *   de posição, atravessando o tenant; com escopo, recusa por não haver
 *   vizinha.
 * - O `max(ordem)` GLOBAL (9401, da empresa C) é diferente do `max(ordem)` da
 *   empresa A (9203), então `criarEtapa` na A denuncia de qual dos dois ela
 *   partiu.
 * - A empresa C tem UMA etapa só, enquanto a tabela inteira tem muitas: a
 *   guarda "o funil precisa de pelo menos uma etapa" só recusa se a leitura
 *   travada contar o funil DA EMPRESA.
 */
const ORDEM_A1 = 9201;
const ORDEM_A2 = 9202;
const ORDEM_A3 = 9203;
const ORDEM_B1 = 9301;
const ORDEM_B2 = 9302;
const ORDEM_C1 = 9401;
/** Onde `criarEtapa` na empresa A deve cair: `max(ordem da A) + 1`. */
const ORDEM_ESPERADA_DA_NOVA = ORDEM_A3 + 1;

// Família própria deste arquivo ("11944"). Desde o Ciclo 1e o telefone é único
// POR EMPRESA (`@@unique([companyId, telefone])`), então o banco não exige
// mais famílias distintas — elas continuam porque o Postgres de teste é o de
// desenvolvimento (⚠️ R1 do Ciclo 1a) e um resíduo de execução interrompida
// de outro arquivo derrubaria um caso por um motivo que não é o testado.
// Sem colisão com o seed (`1199999000{0..3}`), dedupe.test.ts
// ("119977"), lead-notes.test.ts ("119555"), stage-transition.test.ts
// ("119888") nem lead-isolamento.test.ts ("119333").
const TELEFONE_A = "11944440001";
const TELEFONE_B = "11944440002";

const SENHA_FALSA = "$2b$10$naoUsadaPorNenhumTesteDesteArquivo000000000000000000";

/** Nome que já existe na empresa B — usado para provar que a recusa de nome repetido é POR EMPRESA. */
const NOME_SO_DA_B = "Etapa exclusiva da B";

/**
 * Ordem ditada pelas FKs, e ela não é negociável.
 *
 * `Notification` PRIMEIRO: `Notification_userId_fkey` aponta para `User`, e
 * `registrarAuditoria` → `avaliarAtividadeSuspeita` grava notificação para os
 * ADMINs da empresa a cada ação auditada. Foi exatamente essa linha que faltou
 * nos quatro arquivos corrigidos no commit 63cecd2 — sem ela o `deleteMany` de
 * `User` é barrado, o arquivo deixa usuários para trás, e a execução SEGUINTE
 * falha no `beforeAll` por e-mail duplicado. Banco de desenvolvimento
 * compartilhado se envenena de vez, e o sintoma (`Unique constraint`) não
 * aponta para a causa.
 */
async function limparTudo() {
  const usuarios = [USUARIO_A, USUARIO_B, USUARIO_C];
  const empresas = [EMPRESA_A, EMPRESA_B, EMPRESA_C];

  await prisma.notification.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.notification.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.auditLog.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.leadNote.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.task.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.lead.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.contact.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.contact.deleteMany({ where: { telefone: { in: [TELEFONE_A, TELEFONE_B] } } });
  await prisma.pipelineStage.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.membership.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.company.deleteMany({ where: { id: { in: empresas } } });
}

/**
 * Recria TODO o estado mutável antes de cada caso.
 *
 * É por caso, e não por arquivo, porque metade das funções sob teste apaga
 * etapa (`excluirEtapa`), cria etapa (`criarEtapa`) ou reordena o funil
 * (`moverNaOrdem`) — um caso que rodasse depois do outro herdaria um funil
 * diferente do que a documentação de cada `it` afirma.
 */
async function semear() {
  const empresas = [EMPRESA_A, EMPRESA_B, EMPRESA_C];
  await prisma.notification.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.auditLog.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.lead.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.contact.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.pipelineStage.deleteMany({ where: { companyId: { in: empresas } } });

  await prisma.pipelineStage.createMany({
    data: [
      { id: ETAPA_A1, companyId: EMPRESA_A, nome: "A-1", ordem: ORDEM_A1, cor: "#111111" },
      // A etapa de fechamento DA EMPRESA A. `definirEtapaDeFechamento` tem de
      // desligar esta e nenhuma outra.
      {
        id: ETAPA_A2,
        companyId: EMPRESA_A,
        nome: "A-2",
        ordem: ORDEM_A2,
        cor: "#222222",
        ehGanho: true,
      },
      { id: ETAPA_A3, companyId: EMPRESA_A, nome: "A-3", ordem: ORDEM_A3, cor: "#333333" },
      // A etapa de fechamento DA EMPRESA B. É o oráculo do pior defeito do
      // módulo: ela precisa continuar ligada depois de a A trocar a dela.
      {
        id: ETAPA_B1,
        companyId: EMPRESA_B,
        nome: NOME_SO_DA_B,
        ordem: ORDEM_B1,
        cor: "#444444",
        ehGanho: true,
      },
      { id: ETAPA_B2, companyId: EMPRESA_B, nome: "B-2", ordem: ORDEM_B2, cor: "#555555" },
      // Empresa C: UMA etapa só, e é isso que ela existe para medir.
      { id: ETAPA_C1, companyId: EMPRESA_C, nome: "C-1", ordem: ORDEM_C1, cor: "#666666" },
    ],
  });

  await prisma.contact.createMany({
    data: [
      { id: CONTATO_A, companyId: EMPRESA_A, nome: "Contato da A", telefone: TELEFONE_A },
      { id: CONTATO_B, companyId: EMPRESA_B, nome: "Contato da B", telefone: TELEFONE_B },
    ],
  });

  await prisma.lead.createMany({
    data: [
      {
        id: LEAD_A,
        companyId: EMPRESA_A,
        contactId: CONTATO_A,
        stageId: ETAPA_A3,
        responsavelId: USUARIO_A,
        canal: "MANUAL",
        // Arquivado de propósito: `contarLeadsQueSeguramEtapa` conta
        // arquivados (é o número que o `ON DELETE RESTRICT` enxerga) e
        // `contarLeadsPorEtapa` não. Ver o docstring da função.
        arquivadoEm: new Date(),
      },
      {
        id: LEAD_B,
        companyId: EMPRESA_B,
        contactId: CONTATO_B,
        stageId: ETAPA_B2,
        responsavelId: USUARIO_B,
        canal: "MANUAL",
        arquivadoEm: new Date(),
      },
    ],
  });
}

/** Lê uma etapa com o prisma CRU, fora do escopo — o oráculo independente. */
function lerEtapaCrua(id: string) {
  return prisma.pipelineStage.findUnique({ where: { id } });
}

beforeAll(async () => {
  await limparTudo();

  await prisma.company.createMany({
    data: [
      { id: EMPRESA_A, nome: "Empresa A do isolamento de funil" },
      { id: EMPRESA_B, nome: "Empresa B do isolamento de funil" },
      { id: EMPRESA_C, nome: "Empresa C do isolamento de funil" },
    ],
  });

  await prisma.user.createMany({
    data: [
      {
        id: USUARIO_A,
        nome: "Ana da A",
        email: `${USUARIO_A}@exemplo.invalido`,
        senhaHash: SENHA_FALSA,
      },
      {
        id: USUARIO_B,
        nome: "Bruno da B",
        email: `${USUARIO_B}@exemplo.invalido`,
        senhaHash: SENHA_FALSA,
      },
      {
        id: USUARIO_C,
        nome: "Carla da C",
        email: `${USUARIO_C}@exemplo.invalido`,
        senhaHash: SENHA_FALSA,
      },
    ],
  });

  // O vínculo, e não `User.papel`, é o que define "pessoa desta empresa" — é
  // dele que `companyIdDoUsuario` (usado por `registrarAuditoria`) e
  // `usuarioAtual()` tiram o escopo. Fixture que cria `User` sem `Membership`
  // produz usuário sem empresa nenhuma, e foi esse o bug latente de e67e1e6.
  await prisma.membership.createMany({
    data: [
      { userId: USUARIO_A, companyId: EMPRESA_A, papel: "ADMIN" },
      { userId: USUARIO_B, companyId: EMPRESA_B, papel: "ADMIN" },
      { userId: USUARIO_C, companyId: EMPRESA_C, papel: "ADMIN" },
    ],
  });
}, 60_000);

beforeEach(semear);

afterAll(async () => {
  await limparTudo();
}, 60_000);

describe("listarEtapas", () => {
  it("a empresa A vê o funil dela, e não o da B nem o do seed", async () => {
    const naA = await listarEtapas(EMPRESA_A);
    const ids = naA.map((e) => e.id);

    expect(ids).toEqual([ETAPA_A1, ETAPA_A2, ETAPA_A3]);
    expect(ids).not.toContain(ETAPA_B1);
    expect(ids).not.toContain(ETAPA_C1);

    // A segunda metade: o funil da empresa CERTA continua chegando.
    const naB = await listarEtapas(EMPRESA_B);
    expect(naB.map((e) => e.id)).toEqual([ETAPA_B1, ETAPA_B2]);
  });

  it("a ordem continua sendo por `ordem` crescente dentro da empresa", async () => {
    const naA = await listarEtapas(EMPRESA_A);
    expect(naA.map((e) => e.ordem)).toEqual([ORDEM_A1, ORDEM_A2, ORDEM_A3]);
  });
});

describe("contarLeadsQueSeguramEtapa", () => {
  it("a empresa A conta o lead dela e não enxerga etapa da B", async () => {
    const naA = await contarLeadsQueSeguramEtapa(EMPRESA_A);

    expect(naA[ETAPA_A3]).toBe(1);
    expect(Object.keys(naA)).not.toContain(ETAPA_B2);

    // A segunda metade.
    const naB = await contarLeadsQueSeguramEtapa(EMPRESA_B);
    expect(naB[ETAPA_B2]).toBe(1);
    expect(Object.keys(naB)).not.toContain(ETAPA_A3);
  });
});

describe("criarEtapa", () => {
  it("nasce no fim do funil DA EMPRESA, não no fim da tabela", async () => {
    const nova = await criarEtapa({
      nome: "A-nova",
      cor: "#0f62fe",
      autorId: USUARIO_A,
      companyId: EMPRESA_A,
    });

    // `ORDEM_ESPERADA_DA_NOVA` é `max(ordem da A) + 1`. O `max` GLOBAL é
    // `ORDEM_C1`, de outra empresa — se a agregação não fosse escopada, a
    // etapa nasceria em 9402.
    expect(nova.ordem).toBe(ORDEM_ESPERADA_DA_NOVA);
    expect(nova.companyId).toBe(EMPRESA_A);

    // Oráculo independente: o prisma CRU, fora do escopo.
    const crua = await lerEtapaCrua(nova.id);
    expect(crua?.companyId).toBe(EMPRESA_A);
    expect(crua?.ordem).toBe(ORDEM_ESPERADA_DA_NOVA);
  });

  it("nome que já existe na B NÃO bloqueia a A — e o mesmo nome dentro da A bloqueia", async () => {
    const nova = await criarEtapa({
      nome: NOME_SO_DA_B,
      cor: "#0f62fe",
      autorId: USUARIO_A,
      companyId: EMPRESA_A,
    });
    expect(nova.companyId).toBe(EMPRESA_A);

    // A segunda metade: a recusa por nome repetido continua valendo DENTRO da
    // empresa. Sem este caso, apagar `recusarNomeRepetido` inteiro passaria.
    await expect(
      criarEtapa({
        nome: NOME_SO_DA_B.toUpperCase(),
        cor: "#0f62fe",
        autorId: USUARIO_A,
        companyId: EMPRESA_A,
      })
    ).rejects.toBeInstanceOf(EtapaInvalidaError);
  });
});

describe("a mesma `ordem` em duas empresas — o que o Ciclo 1e destravou", () => {
  it("duas empresas podem ter etapas na MESMA posição do funil", async () => {
    // Até o Ciclo 1e isto era `P2002` em `PipelineStage_ordem_key`: a posição
    // "1" do funil era um recurso do BANCO INTEIRO, não da empresa. É a razão
    // pela qual as faixas de `ordem` deste arquivo tiveram de ser disjuntas.
    const nova = await prisma.pipelineStage.create({
      data: {
        id: `${P}-stage-a-na-ordem-da-b`,
        companyId: EMPRESA_A,
        nome: "A na mesma posição da B",
        ordem: ORDEM_B1,
        cor: "#777777",
      },
    });

    expect(nova.companyId).toBe(EMPRESA_A);
    expect(nova.ordem).toBe(ORDEM_B1);

    // Segunda metade: a etapa da B na mesma posição continua lá, intocada.
    expect((await lerEtapaCrua(ETAPA_B1))?.ordem).toBe(ORDEM_B1);
    expect((await lerEtapaCrua(ETAPA_B1))?.companyId).toBe(EMPRESA_B);
  });

  it("`criarEtapa` na B cai em `max(ordem da B) + 1` mesmo com a A já ocupando esse número", async () => {
    // O defeito VIVO que a composição corrige (§4.2.4 do spec): `criarEtapa` já
    // computa `max` DA EMPRESA desde o Ciclo 1d — corretamente. Com a unicidade
    // global, esse valor podia estar ocupado por outra empresa, e a pessoa via
    // um `P2002` apontando para uma etapa que ela não pode enxergar.
    const esperada = ORDEM_B2 + 1;

    // Ocupa, na empresa A, exatamente a posição em que a próxima etapa da B vai
    // nascer. Antes do Ciclo 1e, o `create` abaixo morreria aqui.
    await prisma.pipelineStage.create({
      data: {
        id: `${P}-stage-a-bloqueadora`,
        companyId: EMPRESA_A,
        nome: "Bloqueadora da A",
        ordem: esperada,
        cor: "#888888",
      },
    });

    const nova = await criarEtapa({
      nome: "Nova da B",
      cor: "#999999",
      autorId: USUARIO_B,
      companyId: EMPRESA_B,
    });

    expect(nova.ordem).toBe(esperada);
    expect(nova.companyId).toBe(EMPRESA_B);
  });
});

describe("editarEtapa", () => {
  it("a empresa A não edita etapa da B — e a linha da B fica intacta", async () => {
    await expect(
      editarEtapa({
        etapaId: ETAPA_B1,
        nome: "invadida",
        cor: "#000000",
        autorId: USUARIO_A,
        companyId: EMPRESA_A,
      })
    ).rejects.toBeInstanceOf(EtapaInvalidaError);

    const crua = await lerEtapaCrua(ETAPA_B1);
    expect(crua?.nome).toBe(NOME_SO_DA_B);
    expect(crua?.cor).toBe("#444444");
  });

  it("a empresa A edita a etapa dela", async () => {
    const depois = await editarEtapa({
      etapaId: ETAPA_A1,
      nome: "A-1 renomeada",
      cor: "#0F62FE",
      autorId: USUARIO_A,
      companyId: EMPRESA_A,
    });

    expect(depois.nome).toBe("A-1 renomeada");
    expect(depois.cor).toBe("#0f62fe");

    const crua = await lerEtapaCrua(ETAPA_A1);
    expect(crua?.nome).toBe("A-1 renomeada");
  });
});

describe("moverNaOrdem", () => {
  it("a empresa A não move etapa da B", async () => {
    await expect(
      moverNaOrdem({
        etapaId: ETAPA_B2,
        direcao: "cima",
        autorId: USUARIO_A,
        companyId: EMPRESA_A,
      })
    ).rejects.toBeInstanceOf(EtapaInvalidaError);

    expect((await lerEtapaCrua(ETAPA_B1))?.ordem).toBe(ORDEM_B1);
    expect((await lerEtapaCrua(ETAPA_B2))?.ordem).toBe(ORDEM_B2);
  });

  it("a última etapa da A não troca de lugar com a primeira da B", async () => {
    // O caso que a faixa de `ordem` foi escolhida para produzir: na tabela
    // INTEIRA existe uma etapa logo abaixo de `ETAPA_A3` (a `ETAPA_B1`, de
    // outra empresa). Sem escopo a vizinha é achada e as duas trocam de
    // posição, atravessando o tenant.
    await expect(
      moverNaOrdem({
        etapaId: ETAPA_A3,
        direcao: "baixo",
        autorId: USUARIO_A,
        companyId: EMPRESA_A,
      })
    ).rejects.toThrow(/última/i);

    expect((await lerEtapaCrua(ETAPA_A3))?.ordem).toBe(ORDEM_A3);
    expect((await lerEtapaCrua(ETAPA_B1))?.ordem).toBe(ORDEM_B1);
  });

  it("dentro da empresa A a troca continua funcionando", async () => {
    await moverNaOrdem({
      etapaId: ETAPA_A2,
      direcao: "cima",
      autorId: USUARIO_A,
      companyId: EMPRESA_A,
    });

    expect((await lerEtapaCrua(ETAPA_A2))?.ordem).toBe(ORDEM_A1);
    expect((await lerEtapaCrua(ETAPA_A1))?.ordem).toBe(ORDEM_A2);
    // Nenhuma etapa ficou estacionada na posição negativa.
    expect((await lerEtapaCrua(ETAPA_A3))?.ordem).toBe(ORDEM_A3);
  });
});

describe("definirEtapaDeFechamento — a escrita destrutiva em massa", () => {
  it("desliga a etapa de ganho DA EMPRESA A e NÃO desliga a da B", async () => {
    await definirEtapaDeFechamento({
      etapaId: ETAPA_A1,
      autorId: USUARIO_A,
      companyId: EMPRESA_A,
    });

    // A empresa A: a nova ligada, a antiga desligada.
    expect((await lerEtapaCrua(ETAPA_A1))?.ehGanho).toBe(true);
    expect((await lerEtapaCrua(ETAPA_A2))?.ehGanho).toBe(false);

    // O oráculo: a etapa de ganho da B continua ligada. Sem escopo no
    // `updateMany({ where: { ehGanho: true } })`, esta linha vira `false` e a
    // taxa de conversão da empresa B passa a mentir em silêncio.
    expect((await lerEtapaCrua(ETAPA_B1))?.ehGanho).toBe(true);
  });

  it("a empresa A não marca etapa da B como fechamento dela", async () => {
    await expect(
      definirEtapaDeFechamento({
        etapaId: ETAPA_B2,
        autorId: USUARIO_A,
        companyId: EMPRESA_A,
      })
    ).rejects.toBeInstanceOf(EtapaInvalidaError);

    expect((await lerEtapaCrua(ETAPA_B2))?.ehGanho).toBe(false);
    // E nada foi desligado na A: a recusa aconteceu antes de qualquer escrita.
    expect((await lerEtapaCrua(ETAPA_A2))?.ehGanho).toBe(true);
  });
});

describe("excluirEtapa — o destino e a leitura travada", () => {
  it("recusa destino de OUTRA empresa, e o lead não sai da etapa", async () => {
    await expect(
      excluirEtapa({
        etapaId: ETAPA_A3,
        destinoId: ETAPA_B2,
        autorId: USUARIO_A,
        companyId: EMPRESA_A,
      })
    ).rejects.toBeInstanceOf(EtapaInvalidaError);

    const lead = await prisma.lead.findUnique({ where: { id: LEAD_A } });
    expect(lead?.stageId).toBe(ETAPA_A3);
    expect(await lerEtapaCrua(ETAPA_A3)).not.toBeNull();
  });

  it("com destino DENTRO da empresa, move o lead e apaga a etapa", async () => {
    const movidos = await excluirEtapa({
      etapaId: ETAPA_A3,
      destinoId: ETAPA_A1,
      autorId: USUARIO_A,
      companyId: EMPRESA_A,
    });

    expect(movidos).toBe(1);
    const lead = await prisma.lead.findUnique({ where: { id: LEAD_A } });
    expect(lead?.stageId).toBe(ETAPA_A1);
    // Mudar a estrutura do funil não é interação com o lead.
    expect(lead?.arquivadoEm).not.toBeNull();
    expect(await lerEtapaCrua(ETAPA_A3)).toBeNull();
  });

  it("a empresa A não apaga etapa da B", async () => {
    await expect(
      excluirEtapa({
        etapaId: ETAPA_B2,
        destinoId: null,
        autorId: USUARIO_A,
        companyId: EMPRESA_A,
      })
    ).rejects.toBeInstanceOf(EtapaInvalidaError);

    expect(await lerEtapaCrua(ETAPA_B2)).not.toBeNull();
  });

  it("a empresa C, com UMA etapa, não consegue esvaziar o funil dela", async () => {
    // A guarda é decidida sobre a leitura travada (`SELECT ... FOR UPDATE`). A
    // tabela inteira tem muitas etapas neste instante; só a contagem DA
    // EMPRESA é 1. Sem escopo no SQL cru, `funil.length <= 1` é falso e a
    // única etapa da C some — `criarLead` para de funcionar para ela.
    await expect(
      excluirEtapa({
        etapaId: ETAPA_C1,
        destinoId: null,
        autorId: USUARIO_C,
        companyId: EMPRESA_C,
      })
    ).rejects.toThrow(/pelo menos uma etapa/i);

    expect(await lerEtapaCrua(ETAPA_C1)).not.toBeNull();
  });

  it("a auditoria da exclusão nasce na empresa que agiu", async () => {
    await excluirEtapa({
      etapaId: ETAPA_A3,
      destinoId: ETAPA_A1,
      autorId: USUARIO_A,
      companyId: EMPRESA_A,
    });

    const linha = await prisma.auditLog.findFirstOrThrow({
      where: { entidadeId: ETAPA_A3, acao: "excluir_etapa" },
    });
    expect(linha.companyId).toBe(EMPRESA_A);
    expect((linha.depois as { leadsMovidos: number }).leadsMovidos).toBe(1);
  });
});
