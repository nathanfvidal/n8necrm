// Este arquivo usa o Prisma REAL contra o Postgres do Supabase, então carrega
// DATABASE_URL do .env aqui — não em vitest.config.ts — para não injetar
// credenciais em testes que não tocam banco. Precisa ser o primeiro import:
// os módulos abaixo (via src/lib/prisma.ts → src/lib/env.ts) leem
// process.env.DATABASE_URL no top-level. Mesmo padrão de
// `tests/unit/pipeline-isolamento.test.ts`.
import "dotenv/config";

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server" que o Next.js aplica no build — fora desse pipeline (aqui,
// sob Vitest) ele sempre lança. Ver tests/unit/storage.test.ts, onde o mock
// foi documentado pela primeira vez.
vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import { prismaDaEmpresa } from "../../src/core/tenancy/escopo";
import { encontrarOuCriarContact } from "../../src/core/leads/dedupe";
import { criarEtapa } from "../../src/core/pipeline/service";
import { ingerirMensagem } from "../../src/modules/whatsapp/ingest";
import type { EventoWhatsapp } from "../../src/modules/whatsapp/gateway/tipos";

/**
 * A prova que dá sentido ao Ciclo 1e: **duas empresas coexistem** com o mesmo
 * telefone de contato, a mesma ordem de etapa, o mesmo `waId` de conversa e o
 * mesmo `idExterno` de mensagem — cada uma vendo só o seu.
 *
 * ## Por que este arquivo existe separado dos `*-isolamento`
 *
 * Cada `*-isolamento.test.ts` responde "o escopo da empresa A alcança dado da
 * B?" para um módulo. Este responde outra pergunta, que nenhum deles faz: "o
 * BANCO aceita as duas linhas?". Enquanto as quatro unicidades foram globais, a
 * resposta era não — e a resposta do banco era o que impedia a segunda empresa
 * de existir, independente de qualquer escopo estar certo.
 *
 * Também não pode ser `tests/unit/escopo-empresa.test.ts` (banco FALSO, que
 * nunca chama `query()`: prova o mecanismo de injeção, não o que o índice faz)
 * nem um e2e (a afirmação é sobre constraint de banco, e um e2e provaria a
 * mesma coisa mais devagar e com mais coisas capazes de falhar no caminho).
 *
 * ## As DUAS metades, sempre
 *
 * Todo par de casos tem a segunda metade. Sem ela, apagar as quatro constraints
 * passaria em todos os casos de coexistência — e a dedup é justamente o que as
 * constraints compram. O segundo caso de cada `describe` de par é essa metade:
 * a dedup de contato DENTRO da empresa e a dedup de reentrega de webhook
 * DENTRO da empresa continuam valendo.
 *
 * ## Nada é medido com a MESMA consulta que o código faz
 *
 * As expectativas são conferidas com o `prisma` CRU, fora do escopo, nunca com
 * uma segunda chamada à função sob teste — lição do reparo de 2026-08-20
 * (commit 63cecd2).
 */

// ─── Ids fixos ────────────────────────────────────────────────────────────
//
// Prefixo próprio deste arquivo, para que a limpeza apague por prefixo sem
// tocar em nada do seed nem de outro arquivo de teste.
const P = "uni-emp";
const EMPRESA_A = `${P}-company-a`;
const EMPRESA_B = `${P}-company-b`;
const USUARIO_A = `${P}-user-a`;
const USUARIO_B = `${P}-user-b`;
const ETAPA_A = `${P}-stage-a`;
const ETAPA_B = `${P}-stage-b`;
const CONEXAO_A = `${P}-conn-a`;
const CONEXAO_B = `${P}-conn-b`;

/**
 * **O valor COMPARTILHADO pelas duas empresas** — é o ponto do arquivo inteiro.
 *
 * Família de telefone própria ("11955"), sem colisão com o seed
 * (`1199999000{0..3}`), `dedupe.test.ts` ("119977"), `lead-notes.test.ts`
 * ("119555"), `stage-transition.test.ts` ("119888"), `lead-isolamento.test.ts`
 * ("119333"), `pipeline-isolamento.test.ts` ("11944"),
 * `whatsapp-isolamento.test.ts` ("11966") nem `contact-isolamento.test.ts`
 * ("11922"). A separação por família continua valendo mesmo depois do Ciclo 1e
 * porque o banco de teste é o de desenvolvimento (⚠️ R1 do Ciclo 1a) e um
 * resíduo de execução interrompida derruba um caso por um motivo que não é o
 * testado.
 */
const TELEFONE_COMPARTILHADO = "11955550001";
/** Mesma posição do funil nas duas empresas. Faixa alta, longe do seed (0..3). */
const ORDEM_COMPARTILHADA = 9901;
/**
 * `waId` deliberadamente NÃO numérico: `ingerirMensagem` passa por
 * `normalizarTelefoneWhatsapp`, que aqui devolve `{ ok: false }` e grava
 * `Conversation.telefone = null`. É intencional — o que está sob teste é a
 * chave `@@unique([companyId, waId])`, que é sobre a STRING, e um prefixo
 * próprio garante que nenhum resíduo de `whatsapp-isolamento.test.ts` (família
 * "11966") entre no `findMany` cru por `waId` deste arquivo.
 */
const WAID_COMPARTILHADO = `${P}-wa-compartilhado`;
const ID_EXTERNO_COMPARTILHADO = `${P}-ext-compartilhado`;

const SENHA_FALSA = "$2b$10$naoUsadaPorNenhumTesteDesteArquivo000000000000000000";

/**
 * Ordem ditada pelas FKs, e ela não é negociável.
 *
 * `Notification` PRIMEIRO: `Notification_userId_fkey` aponta para `User`, e
 * `registrarAuditoria` → `avaliarAtividadeSuspeita` (que `criarEtapa` dispara)
 * grava notificação para os ADMINs da empresa. Sem esta linha o `deleteMany` de
 * `User` é barrado, o arquivo deixa usuários para trás, e a execução SEGUINTE
 * falha no `beforeAll` por e-mail duplicado — foi o bug do commit 63cecd2.
 *
 * `WhatsappMessage` antes de `Conversation` (`WhatsappMessage.conversationId`);
 * `Conversation` antes de `WhatsappConnection` (`Conversation.connectionId`) e
 * antes de `Contact` (`Conversation.contactId`); `Membership` antes de `User`.
 */
async function limparTudo() {
  const usuarios = [USUARIO_A, USUARIO_B];
  const empresas = [EMPRESA_A, EMPRESA_B];

  await prisma.notification.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.notification.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.auditLog.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.whatsappMessage.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.conversation.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.conversation.deleteMany({ where: { waId: WAID_COMPARTILHADO } });
  await prisma.whatsappConnection.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.lead.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.contact.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.contact.deleteMany({ where: { telefone: TELEFONE_COMPARTILHADO } });
  await prisma.pipelineStage.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.membership.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.company.deleteMany({ where: { id: { in: empresas } } });
}

/** Recria TODO o estado mutável antes de cada caso — quase todo caso GRAVA. */
async function semear() {
  const empresas = [EMPRESA_A, EMPRESA_B];
  await prisma.notification.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.auditLog.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.whatsappMessage.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.conversation.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.conversation.deleteMany({ where: { waId: WAID_COMPARTILHADO } });
  await prisma.lead.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.contact.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.contact.deleteMany({ where: { telefone: TELEFONE_COMPARTILHADO } });
  await prisma.pipelineStage.deleteMany({ where: { companyId: { in: empresas } } });

  await prisma.pipelineStage.createMany({
    data: [
      {
        id: ETAPA_A,
        companyId: EMPRESA_A,
        nome: "Primeira da A",
        ordem: ORDEM_COMPARTILHADA,
        cor: "#111111",
      },
      {
        id: ETAPA_B,
        companyId: EMPRESA_B,
        nome: "Primeira da B",
        ordem: ORDEM_COMPARTILHADA,
        cor: "#222222",
      },
    ],
  });
}

/** O contexto que `ingerirMensagem` exige desde o Ciclo 2a. */
function contextoDe(companyId: string, connectionId: string) {
  return { companyId, connectionId };
}

/**
 * Um evento de entrada normalizado, com o `waId`/`idExterno` compartilhados.
 *
 * Os seis campos são os que `EventoWhatsapp`
 * (`src/modules/whatsapp/gateway/tipos.ts`) exige — `nomeExibicao` e `texto`
 * são `string | null` (não opcionais), e `timestamp` é `Date` obrigatório.
 * Instante fixo de propósito: nada neste arquivo depende de "agora", e um
 * `new Date()` faria a fixture variar entre execuções sem ganhar nada.
 */
function eventoCompartilhado(): EventoWhatsapp {
  return {
    idExterno: ID_EXTERNO_COMPARTILHADO,
    waId: WAID_COMPARTILHADO,
    nomeExibicao: "Cliente compartilhado",
    tipo: "TEXTO",
    texto: "oi",
    timestamp: new Date("2026-08-20T12:00:00.000Z"),
  };
}

beforeAll(async () => {
  await limparTudo();

  await prisma.company.createMany({
    data: [
      { id: EMPRESA_A, nome: "Empresa A das unicidades" },
      { id: EMPRESA_B, nome: "Empresa B das unicidades" },
    ],
  });

  await prisma.user.createMany({
    data: [
      {
        id: USUARIO_A,
        nome: "Ana da A",
        email: `${USUARIO_A}@exemplo.invalido`,
        senhaHash: SENHA_FALSA,
        papel: "ADMIN",
      },
      {
        id: USUARIO_B,
        nome: "Bruno da B",
        email: `${USUARIO_B}@exemplo.invalido`,
        senhaHash: SENHA_FALSA,
        papel: "ADMIN",
      },
    ],
  });

  // O vínculo, e não `User.papel`, é o que define "pessoa desta empresa" — é
  // dele que `registrarAuditoria` (chamado por `criarEtapa`) tira o escopo.
  // Fixture que cria `User` sem `Membership` produz usuário sem empresa
  // nenhuma: foi o bug latente do commit e67e1e6.
  await prisma.membership.createMany({
    data: [
      { userId: USUARIO_A, companyId: EMPRESA_A, papel: "ADMIN" },
      { userId: USUARIO_B, companyId: EMPRESA_B, papel: "ADMIN" },
    ],
  });

  // Uma conexão por empresa: `ingerirMensagem` recebe `{ companyId,
  // connectionId }` desde o Ciclo 2a, e `Conversation.connectionId` é FK.
  // `webhookTokenHash` é `@unique` GLOBAL de propósito (segredo de 256 bits;
  // duas empresas com o mesmo token é estado que deve ser impossível) — por
  // isso os dois valores aqui são distintos, e isso NÃO contradiz este ciclo.
  await prisma.whatsappConnection.createMany({
    data: [
      {
        id: CONEXAO_A,
        companyId: EMPRESA_A,
        canal: "EVOLUTION",
        nome: "Conexão da A",
        dominio: "https://exemplo.invalido",
        instancia: `${P}-inst-a`,
        segredoCifrado: `${P}-cifrado-a`,
        segredoUltimos4: "aaaa",
        segredoAtualizadoEm: new Date("2026-08-20T00:00:00.000Z"),
        webhookTokenHash: `${P}-hash-a`,
      },
      {
        id: CONEXAO_B,
        companyId: EMPRESA_B,
        canal: "EVOLUTION",
        nome: "Conexão da B",
        dominio: "https://exemplo.invalido",
        instancia: `${P}-inst-b`,
        segredoCifrado: `${P}-cifrado-b`,
        segredoUltimos4: "bbbb",
        segredoAtualizadoEm: new Date("2026-08-20T00:00:00.000Z"),
        webhookTokenHash: `${P}-hash-b`,
      },
    ],
  });
}, 60_000);

beforeEach(semear);

afterAll(limparTudo);

describe("Contact.telefone — `@@unique([companyId, telefone])`", () => {
  it("o MESMO telefone existe nas duas empresas, e cada escopo vê só o seu", async () => {
    const naA = await encontrarOuCriarContact({
      nome: "Cliente visto pela A",
      telefone: TELEFONE_COMPARTILHADO,
      companyId: EMPRESA_A,
    });

    // Antes do Ciclo 1e esta chamada lançava "Telefone já cadastrado em outra
    // empresa" — o ramo que `dedupe.ts` carregava só para explicar a recusa.
    const naB = await encontrarOuCriarContact({
      nome: "Cliente visto pela B",
      telefone: TELEFONE_COMPARTILHADO,
      companyId: EMPRESA_B,
    });

    expect(naA.id).not.toBe(naB.id);

    // Oráculo cru, fora do escopo: são DUAS linhas.
    const cruas = await prisma.contact.findMany({
      where: { telefone: TELEFONE_COMPARTILHADO },
      orderBy: { companyId: "asc" },
      select: { id: true, companyId: true, nome: true },
    });
    expect(cruas).toHaveLength(2);
    expect(cruas.map((c) => c.companyId).sort()).toEqual([EMPRESA_A, EMPRESA_B].sort());

    // E cada empresa enxerga só a sua.
    const vistosPelaA = await prismaDaEmpresa(EMPRESA_A).contact.findMany({
      where: { telefone: TELEFONE_COMPARTILHADO },
    });
    expect(vistosPelaA.map((c) => c.id)).toEqual([naA.id]);

    const vistosPelaB = await prismaDaEmpresa(EMPRESA_B).contact.findMany({
      where: { telefone: TELEFONE_COMPARTILHADO },
    });
    expect(vistosPelaB.map((c) => c.id)).toEqual([naB.id]);
  });

  it("a dedup DENTRO da empresa continua valendo — a segunda metade", async () => {
    // Sem este caso, apagar a constraint passaria no caso acima. A dedup é o
    // que a constraint compra, e ela não pode ter sido afrouxada.
    const primeiro = await encontrarOuCriarContact({
      nome: "Cliente da A",
      telefone: TELEFONE_COMPARTILHADO,
      companyId: EMPRESA_A,
    });
    const segundo = await encontrarOuCriarContact({
      nome: "Nome diferente, mesma pessoa",
      telefone: TELEFONE_COMPARTILHADO,
      companyId: EMPRESA_A,
    });

    expect(segundo.id).toBe(primeiro.id);
    // Nunca sobrescreve o nome de quem já existe — regra de `dedupe.ts`.
    expect(segundo.nome).toBe("Cliente da A");

    const total = await prisma.contact.count({
      where: { companyId: EMPRESA_A, telefone: TELEFONE_COMPARTILHADO },
    });
    expect(total).toBe(1);
  });
});

describe("PipelineStage.ordem — `@@unique([companyId, ordem])`", () => {
  it("a MESMA posição do funil existe nas duas empresas, e cada escopo vê só a sua", async () => {
    // As duas etapas em `ORDEM_COMPARTILHADA` foram criadas por `semear`: antes
    // do Ciclo 1e o próprio `createMany` da fixture morreria em `P2002`.
    const cruas = await prisma.pipelineStage.findMany({
      where: { ordem: ORDEM_COMPARTILHADA },
      select: { id: true, companyId: true },
    });
    expect(cruas).toHaveLength(2);

    const daA = await prismaDaEmpresa(EMPRESA_A).pipelineStage.findMany({
      where: { ordem: ORDEM_COMPARTILHADA },
    });
    expect(daA.map((e) => e.id)).toEqual([ETAPA_A]);

    const daB = await prismaDaEmpresa(EMPRESA_B).pipelineStage.findMany({
      where: { ordem: ORDEM_COMPARTILHADA },
    });
    expect(daB.map((e) => e.id)).toEqual([ETAPA_B]);
  });

  it("`criarEtapa` na B não colide com a posição que a A já ocupa", async () => {
    // O defeito VIVO que a composição corrige: `criarEtapa` calcula
    // `max(ordem DA EMPRESA) + 1` desde o Ciclo 1d — e com a unicidade global
    // esse número podia estar ocupado por outra empresa, produzindo `P2002` na
    // tela `/etapas` apontando para uma etapa invisível para quem clicou.
    const esperada = ORDEM_COMPARTILHADA + 1;

    await prisma.pipelineStage.create({
      data: {
        id: `${P}-stage-a-bloqueadora`,
        companyId: EMPRESA_A,
        nome: "Bloqueadora da A",
        ordem: esperada,
        cor: "#333333",
      },
    });

    const nova = await criarEtapa({
      nome: "Nova da B",
      cor: "#444444",
      autorId: USUARIO_B,
      companyId: EMPRESA_B,
    });

    expect(nova.ordem).toBe(esperada);
    expect(nova.companyId).toBe(EMPRESA_B);

    const crua = await prisma.pipelineStage.findUnique({ where: { id: nova.id } });
    expect(crua?.companyId).toBe(EMPRESA_B);
  });
});

describe("Conversation.waId e WhatsappMessage.idExterno — o caminho do webhook", () => {
  it("o MESMO número e o MESMO id de mensagem entram nas duas empresas", async () => {
    // É o laço de 500 da §6 da auditoria do Ciclo 2a: antes desta mudança, a
    // segunda chamada colidia em `Conversation_waId_key`, o `catch` não achava
    // mensagem por `idExterno` (ela não chegou a ser gravada), o erro subia, a
    // rota devolvia 500 e a Evolution reentregava — para sempre, porque a
    // segunda tentativa repetia tudo.
    const naA = await ingerirMensagem(eventoCompartilhado(), contextoDe(EMPRESA_A, CONEXAO_A));
    const naB = await ingerirMensagem(eventoCompartilhado(), contextoDe(EMPRESA_B, CONEXAO_B));

    expect(naA.duplicada).toBe(false);
    expect(naB.duplicada).toBe(false);
    expect(naA.conversationId).not.toBe(naB.conversationId);
    expect(naA.companyId).toBe(EMPRESA_A);
    expect(naB.companyId).toBe(EMPRESA_B);

    // Oráculo cru: duas conversas e duas mensagens, uma de cada empresa.
    const conversas = await prisma.conversation.findMany({
      where: { waId: WAID_COMPARTILHADO },
      select: { id: true, companyId: true, connectionId: true },
    });
    expect(conversas).toHaveLength(2);
    expect(conversas.map((c) => c.companyId).sort()).toEqual([EMPRESA_A, EMPRESA_B].sort());
    // A conexão de entrada é gravada em cada uma — é por ela que a resposta sai.
    expect(conversas.map((c) => c.connectionId).sort()).toEqual([CONEXAO_A, CONEXAO_B].sort());

    const mensagens = await prisma.whatsappMessage.findMany({
      where: { idExterno: ID_EXTERNO_COMPARTILHADO },
      select: { companyId: true },
    });
    expect(mensagens).toHaveLength(2);
    expect(mensagens.map((m) => m.companyId).sort()).toEqual([EMPRESA_A, EMPRESA_B].sort());

    // E cada escopo vê só a sua conversa.
    const daA = await prismaDaEmpresa(EMPRESA_A).conversation.findMany({
      where: { waId: WAID_COMPARTILHADO },
    });
    expect(daA.map((c) => c.id)).toEqual([naA.conversationId]);

    const daB = await prismaDaEmpresa(EMPRESA_B).conversation.findMany({
      where: { waId: WAID_COMPARTILHADO },
    });
    expect(daB.map((c) => c.id)).toEqual([naB.conversationId]);
  });

  it("a reentrega DENTRO da mesma empresa continua deduplicando — a segunda metade", async () => {
    // A metade que impede "resolver" o ciclo quebrando a idempotência: sem
    // ela, apagar `@@unique([companyId, idExterno])` passaria no caso acima.
    const primeira = await ingerirMensagem(eventoCompartilhado(), contextoDe(EMPRESA_A, CONEXAO_A));
    expect(primeira.duplicada).toBe(false);

    const reentrega = await ingerirMensagem(eventoCompartilhado(), contextoDe(EMPRESA_A, CONEXAO_A));

    expect(reentrega.duplicada).toBe(true);
    expect(reentrega.conversationId).toBe(primeira.conversationId);
    // `bufferSeq` NÃO foi incrementado de novo — é o que faz o job de turno não
    // reprocessar a mesma mensagem.
    expect(reentrega.bufferSeq).toBe(primeira.bufferSeq);

    const mensagens = await prisma.whatsappMessage.count({
      where: { companyId: EMPRESA_A, idExterno: ID_EXTERNO_COMPARTILHADO },
    });
    expect(mensagens).toBe(1);

    const conversas = await prisma.conversation.count({
      where: { companyId: EMPRESA_A, waId: WAID_COMPARTILHADO },
    });
    expect(conversas).toBe(1);
  });
});
