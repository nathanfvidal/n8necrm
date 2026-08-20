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
// sob Vitest) ele sempre lança. `src/modules/whatsapp/queries.ts`,
// `agente.ts` e `src/lib/prisma.ts` importam.
vi.mock("server-only", () => ({}));

// Mock do gateway — NENHUMA chamada real à Evolution neste arquivo (mesmo
// padrão de `tests/unit/whatsapp-agente.test.ts`). Aqui ele é mais que
// higiene: é o ORÁCULO do pior defeito do módulo. `responderComoHumano`
// manda uma mensagem de WhatsApp de verdade, e "a função lançou" não prova
// que ela não mandou — uma função que lança DEPOIS de já ter enviado
// passaria num teste que só olhasse a rejeição, e continuaria falando com o
// cliente da outra empresa na vida real. Por isso todo caso de recusa afirma
// `enviarTextoMock` NÃO chamado, e não só a rejeição.
const enviarTextoMock = vi.fn();
vi.mock("../../src/modules/whatsapp/gateway", () => ({
  whatsappGateway: { enviarTexto: (...args: unknown[]) => enviarTextoMock(...args) },
}));

import { prisma } from "../../src/lib/prisma";
import { botConfig } from "../../config/bot";
import {
  listarConversas,
  buscarConversaComMensagens,
  listarConversasDoContato,
} from "../../src/modules/whatsapp/queries";
import {
  pausarIa,
  religarIa,
  lerConfigBot,
  salvarConfigBot,
  restaurarConfigPadrao,
  responderComoHumano,
} from "../../src/modules/whatsapp/agente";
import {
  claimLease,
  confirmarTitularidadeLease,
  liberarLease,
} from "../../src/modules/whatsapp/turno";
import {
  limparAguardandoHumano,
  marcarAguardandoHumano,
} from "../../src/modules/whatsapp/notificacoes";

/**
 * O par de `tests/unit/pipeline-isolamento.test.ts` e
 * `tests/unit/lead-isolamento.test.ts`, agora para o módulo `whatsapp`: para
 * cada uma das nove funções públicas de `queries.ts` e `agente.ts`, prova de
 * que o escopo da empresa A não alcança dado da empresa B.
 *
 * ## Contra o banco de verdade, e não contra o banco falso
 *
 * `tests/unit/escopo-empresa.test.ts` exercita o MECANISMO (`prismaDaEmpresa`)
 * com um banco falso. Este arquivo responde outra pergunta: "o módulo
 * `whatsapp` chega ao dado da outra empresa?". Essa só tem resposta contra
 * duas empresas de verdade, com FK e `@unique` GLOBAL de verdade — `waId` e
 * `idExterno` são `@unique` sem empresa (`prisma/schema.prisma`), e é
 * exatamente esse tipo de coluna que faz um filtro por id parecer suficiente.
 *
 * ## As DUAS metades, sempre
 *
 * Todo caso tem a segunda metade: além de provar que o escopo A não alcança
 * B, prova que o dado da empresa CERTA continua chegando. Sem ela, "não
 * devolver nada para ninguém" passaria como correção — e um módulo quebrado
 * passa em qualquer teste que só afirme ausência.
 *
 * ## Nada é medido com a MESMA consulta que o código faz
 *
 * Lição do reparo de 2026-08-20 (commit 63cecd2): três casos afirmavam o
 * total contra a mesma consulta sem empresa que o defeito tinha, e o teste
 * espelhava o bug. Aqui as expectativas são ids FIXOS criados pela fixture,
 * conferidos com o `prisma` CRU, fora do escopo — nunca com uma segunda
 * chamada à função sob teste.
 */

// ─── Ids fixos ────────────────────────────────────────────────────────────
//
// Prefixo próprio deste arquivo, para que a limpeza apague por prefixo sem
// tocar em nada do seed nem de outro arquivo de teste.
const P = "iso-wa";
const EMPRESA_A = `${P}-company-a`;
const EMPRESA_B = `${P}-company-b`;
const USUARIO_A = `${P}-user-a`;
const USUARIO_B = `${P}-user-b`;
const CONTATO_A = `${P}-contact-a`;
const CONTATO_B = `${P}-contact-b`;
const CONVERSA_A = `${P}-conv-a`;
const CONVERSA_A_SEM_ESPERA = `${P}-conv-a2`;
const CONVERSA_B = `${P}-conv-b`;
const CONFIG_A = `${P}-bot-a`;
const CONFIG_B = `${P}-bot-b`;
const MENSAGEM_A = `${P}-msg-a`;
const MENSAGEM_B = `${P}-msg-b`;

/**
 * `Conversation.waId` é `@unique` GLOBAL (`prisma/schema.prisma`) — a mesma
 * família de `Contact.telefone`. O prefixo é PRÓPRIO deste arquivo e **não**
 * começa com `teste-`, de propósito: `limparConversasDeTeste`
 * (`tests/unit/helpers/whatsapp.ts`) apaga toda `Conversation` com `waId`
 * começando em `teste-`, e um `afterEach` de outro arquivo levaria a fixture
 * daqui junto se o prefixo colidisse.
 */
const WA_A = `${P}-wa-a`;
const WA_A_SEM_ESPERA = `${P}-wa-a2`;
const WA_B = `${P}-wa-b`;

// `Contact.telefone` é `@unique` GLOBAL. Família própria deste arquivo
// ("11966"), sem colisão com o seed (`1199999000{0..3}`), dedupe.test.ts
// ("119977"), lead-notes.test.ts ("119555"), stage-transition.test.ts
// ("119888"), lead-isolamento.test.ts ("119333") nem
// pipeline-isolamento.test.ts ("11944").
const TELEFONE_A = "11966660001";
const TELEFONE_B = "11966660002";

const SENHA_FALSA = "$2b$10$naoUsadaPorNenhumTesteDesteArquivo000000000000000000";

/**
 * As esperas são o que faz `listarConversas` DISCRIMINAR em vez de decorar.
 *
 * A função ordena por `aguardandoHumanoDesde` ASC (nulos por último) e corta
 * em `take: 100`. Se a conversa da B fosse uma linha qualquer, num banco de
 * desenvolvimento com mais de cem conversas ela poderia ficar de fora do
 * corte por acaso, e a metade "não vaza" passaria sem ter medido nada. Com a
 * espera MAIS ANTIGA de todas, a conversa da B é a primeira linha que a
 * consulta sem escopo devolve — o vazamento fica dentro do corte por
 * construção, e não por sorte.
 */
const ESPERA_DA_B = new Date("2000-01-01T00:00:00.000Z");
const ESPERA_DA_A = new Date("2000-01-02T00:00:00.000Z");

const PERSONA_DA_A = "Persona da empresa A";
const PERSONA_DA_B = "Persona da empresa B";

/**
 * Ordem ditada pelas FKs, e ela não é negociável.
 *
 * `Notification` PRIMEIRO: `Notification_userId_fkey` aponta para `User`.
 * Foi exatamente essa linha que faltou nos quatro arquivos corrigidos no
 * commit 63cecd2 — sem ela o `deleteMany` de `User` é barrado, o arquivo
 * deixa usuários para trás, e a execução SEGUINTE falha no `beforeAll` por
 * e-mail duplicado. Banco de desenvolvimento compartilhado se envenena de
 * vez, e o sintoma (`Unique constraint`) não aponta para a causa.
 *
 * `Conversation` antes de `User` pelo mesmo motivo, por outra FK:
 * `Conversation.iaPausadaPorId` aponta para `User`, e metade dos casos deste
 * arquivo preenche esse campo.
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
  await prisma.conversation.deleteMany({ where: { waId: { in: [WA_A, WA_A_SEM_ESPERA, WA_B] } } });
  await prisma.botConfig.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.contact.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.contact.deleteMany({ where: { telefone: { in: [TELEFONE_A, TELEFONE_B] } } });
  await prisma.membership.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.company.deleteMany({ where: { id: { in: empresas } } });
}

/**
 * Recria TODO o estado mutável antes de cada caso.
 *
 * É por caso, e não por arquivo, porque quase toda função sob teste GRAVA:
 * `pausarIa`/`religarIa` mexem no estado da IA, `salvarConfigBot` e
 * `restaurarConfigPadrao` reescrevem a config, `responderComoHumano` faz as
 * duas coisas e ainda cria mensagem. Um caso que rodasse depois do outro
 * herdaria um estado diferente do que o `it` dele afirma.
 */
async function semear() {
  const empresas = [EMPRESA_A, EMPRESA_B];
  await prisma.whatsappMessage.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.conversation.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.botConfig.deleteMany({ where: { companyId: { in: empresas } } });

  await prisma.conversation.createMany({
    data: [
      {
        id: CONVERSA_A,
        companyId: EMPRESA_A,
        waId: WA_A,
        telefone: TELEFONE_A,
        contactId: CONTATO_A,
        nomeExibicao: "Cliente da A",
        iaAtiva: true,
        aguardandoHumanoDesde: ESPERA_DA_A,
      },
      {
        id: CONVERSA_A_SEM_ESPERA,
        companyId: EMPRESA_A,
        waId: WA_A_SEM_ESPERA,
        contactId: CONTATO_A,
        nomeExibicao: "Outro cliente da A",
        iaAtiva: true,
      },
      // A conversa que o escopo da A NÃO pode alcançar por nenhuma das nove
      // portas. É a espera mais antiga da tabela — ver `ESPERA_DA_B`.
      {
        id: CONVERSA_B,
        companyId: EMPRESA_B,
        waId: WA_B,
        telefone: TELEFONE_B,
        contactId: CONTATO_B,
        nomeExibicao: "Cliente da B",
        iaAtiva: true,
        aguardandoHumanoDesde: ESPERA_DA_B,
      },
    ],
  });

  await prisma.whatsappMessage.createMany({
    data: [
      {
        id: MENSAGEM_A,
        companyId: EMPRESA_A,
        conversationId: CONVERSA_A,
        idExterno: `${P}-ext-a`,
        direcao: "ENTRADA",
        autor: "CLIENTE",
        tipo: "TEXTO",
        texto: "Mensagem que só a empresa A pode ler",
      },
      {
        id: MENSAGEM_B,
        companyId: EMPRESA_B,
        conversationId: CONVERSA_B,
        idExterno: `${P}-ext-b`,
        direcao: "ENTRADA",
        autor: "CLIENTE",
        tipo: "TEXTO",
        texto: "Mensagem que só a empresa B pode ler",
      },
    ],
  });

  await prisma.botConfig.createMany({
    data: [
      {
        id: CONFIG_A,
        companyId: EMPRESA_A,
        ativo: true,
        personaNome: PERSONA_DA_A,
        personaPapel: "atendente da A",
        regras: ["regra da A"],
        faq: "faq da A",
      },
      {
        id: CONFIG_B,
        companyId: EMPRESA_B,
        ativo: true,
        personaNome: PERSONA_DA_B,
        personaPapel: "atendente da B",
        regras: ["regra da B"],
        faq: "faq da B",
      },
    ],
  });
}

/** Lê uma conversa com o prisma CRU, fora do escopo — o oráculo independente. */
function lerConversaCrua(id: string) {
  return prisma.conversation.findUniqueOrThrow({ where: { id } });
}

/** Lê a config de uma empresa com o prisma CRU, fora do escopo. */
function lerConfigCrua(companyId: string) {
  return prisma.botConfig.findUniqueOrThrow({ where: { companyId } });
}

beforeAll(async () => {
  await limparTudo();

  await prisma.company.createMany({
    data: [
      { id: EMPRESA_A, nome: "Empresa A do isolamento de WhatsApp" },
      { id: EMPRESA_B, nome: "Empresa B do isolamento de WhatsApp" },
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
  // dele que `usuarioAtual()` tira o `companyId` que as Server Actions
  // repassam para as funções deste módulo. Fixture que cria `User` sem
  // `Membership` produz usuário sem empresa nenhuma, e foi esse o bug latente
  // de e67e1e6.
  await prisma.membership.createMany({
    data: [
      { userId: USUARIO_A, companyId: EMPRESA_A, papel: "ADMIN" },
      { userId: USUARIO_B, companyId: EMPRESA_B, papel: "ADMIN" },
    ],
  });

  await prisma.contact.createMany({
    data: [
      { id: CONTATO_A, companyId: EMPRESA_A, nome: "Contato da A", telefone: TELEFONE_A },
      { id: CONTATO_B, companyId: EMPRESA_B, nome: "Contato da B", telefone: TELEFONE_B },
    ],
  });
}, 60_000);

beforeEach(async () => {
  enviarTextoMock.mockReset();
  await semear();
});

afterAll(limparTudo);

// ─── queries.ts ───────────────────────────────────────────────────────────

describe("listarConversas", () => {
  it("a inbox da A não mostra conversa da B, e mostra as duas da A", async () => {
    const lista = await listarConversas(EMPRESA_A);
    const ids = lista.map((c) => c.id);

    expect(ids).not.toContain(CONVERSA_B);
    // A segunda metade: sem ela, uma função que devolvesse lista vazia para
    // todo mundo passaria como correção.
    expect(ids).toContain(CONVERSA_A);
    expect(ids).toContain(CONVERSA_A_SEM_ESPERA);
    // Nenhuma linha de fora da empresa, e não só a da fixture: se o escopo
    // não estivesse valendo, a inbox traria as conversas do seed junto.
    expect(lista.every((c) => c.companyId === EMPRESA_A)).toBe(true);
  });

  it("a inbox da B mostra a conversa da B — o escopo discrimina, não filtra sempre a mesma", async () => {
    const ids = (await listarConversas(EMPRESA_B)).map((c) => c.id);
    expect(ids).toContain(CONVERSA_B);
    expect(ids).not.toContain(CONVERSA_A);
  });
});

describe("buscarConversaComMensagens", () => {
  it("o id da conversa da B não abre a thread para a empresa A", async () => {
    expect(await buscarConversaComMensagens(EMPRESA_A, CONVERSA_B)).toBeNull();
  });

  it("a conversa da própria empresa continua abrindo, com as mensagens", async () => {
    const conversa = await buscarConversaComMensagens(EMPRESA_A, CONVERSA_A);
    expect(conversa?.id).toBe(CONVERSA_A);
    expect(conversa?.mensagens.map((m) => m.id)).toEqual([MENSAGEM_A]);
  });
});

describe("listarConversasDoContato", () => {
  // O contato vem de `buscarContatoComHistorico` (`core/contacts/queries.ts`),
  // que desde o bloco seguinte deste ciclo também valida empresa — hoje ela
  // devolve `null` e a página nem chega aqui. Este caso continua valendo, e é
  // a razão de ele ter sido escrito antes daquela conversão: ele mede o que
  // ESTA função faz sozinha, sem depender de quem a chama filtrar antes. Um
  // segundo chamador futuro herda a garantia; a cadeia inteira é medida em
  // `tests/unit/contact-isolamento.test.ts`.
  it("um contactId da B não devolve as conversas da B para a empresa A", async () => {
    expect(await listarConversasDoContato(EMPRESA_A, CONTATO_B)).toEqual([]);
  });

  it("o contato da própria empresa continua devolvendo as conversas dele", async () => {
    const ids = (await listarConversasDoContato(EMPRESA_A, CONTATO_A)).map((c) => c.id);
    expect(ids).toContain(CONVERSA_A);
    expect(ids).toContain(CONVERSA_A_SEM_ESPERA);
  });
});

// ─── agente.ts ────────────────────────────────────────────────────────────

describe("pausarIa", () => {
  it("a empresa A não cala a IA da conversa da B", async () => {
    await pausarIa(EMPRESA_A, CONVERSA_B, USUARIO_A);

    const b = await lerConversaCrua(CONVERSA_B);
    expect(b.iaAtiva).toBe(true);
    expect(b.iaPausadaPorId).toBeNull();
  });

  it("a conversa da própria empresa continua sendo pausada", async () => {
    await pausarIa(EMPRESA_A, CONVERSA_A, USUARIO_A);

    const a = await lerConversaCrua(CONVERSA_A);
    expect(a.iaAtiva).toBe(false);
    expect(a.iaPausadaPorId).toBe(USUARIO_A);
  });
});

describe("religarIa", () => {
  it("a empresa A não religa a IA da conversa da B", async () => {
    await prisma.conversation.update({
      where: { id: CONVERSA_B },
      data: { iaAtiva: false, iaPausadaEm: new Date(), iaPausadaPorId: USUARIO_B },
    });

    await religarIa(EMPRESA_A, CONVERSA_B);

    const b = await lerConversaCrua(CONVERSA_B);
    expect(b.iaAtiva).toBe(false);
    expect(b.iaPausadaPorId).toBe(USUARIO_B);
  });

  it("a conversa da própria empresa continua sendo religada", async () => {
    await prisma.conversation.update({
      where: { id: CONVERSA_A },
      data: { iaAtiva: false, iaPausadaEm: new Date(), iaPausadaPorId: USUARIO_A },
    });

    await religarIa(EMPRESA_A, CONVERSA_A);

    const a = await lerConversaCrua(CONVERSA_A);
    expect(a.iaAtiva).toBe(true);
    expect(a.iaPausadaEm).toBeNull();
    expect(a.iaPausadaPorId).toBeNull();
  });
});

describe("lerConfigBot", () => {
  it("cada empresa lê a própria persona", async () => {
    expect((await lerConfigBot(EMPRESA_A)).personaNome).toBe(PERSONA_DA_A);
    // A segunda chamada é o que impede o caso de passar por acaso: uma
    // função que devolvesse sempre a MESMA linha (a primeira da tabela)
    // acertaria a primeira asserção metade das vezes.
    expect((await lerConfigBot(EMPRESA_B)).personaNome).toBe(PERSONA_DA_B);
  });
});

describe("salvarConfigBot", () => {
  it("salvar na A não toca a config da B", async () => {
    await salvarConfigBot(
      EMPRESA_A,
      {
        ativo: false,
        personaNome: "Persona nova da A",
        personaPapel: "papel novo da A",
        regras: ["regra nova"],
        faq: "faq nova",
      },
      USUARIO_A
    );

    expect((await lerConfigCrua(EMPRESA_A)).personaNome).toBe("Persona nova da A");
    const b = await lerConfigCrua(EMPRESA_B);
    expect(b.personaNome).toBe(PERSONA_DA_B);
    expect(b.ativo).toBe(true);
  });
});

describe("restaurarConfigPadrao", () => {
  it("restaurar na A não devolve a config da B ao padrão do fork", async () => {
    await restaurarConfigPadrao(EMPRESA_A, USUARIO_A);

    expect((await lerConfigCrua(EMPRESA_A)).personaNome).toBe(botConfig.persona.nome);
    expect((await lerConfigCrua(EMPRESA_B)).personaNome).toBe(PERSONA_DA_B);
  });
});

describe("responderComoHumano", () => {
  /**
   * O pior defeito da fila, e o motivo de este arquivo existir.
   *
   * Sem escopo, um usuário da empresa A respondia numa conversa da B: a
   * mensagem saía pela instância Evolution da B, para o cliente da B, com o
   * número da B. Não é leitura de dado alheio — é FALAR com o cliente de
   * outra empresa se passando por ela.
   *
   * Por isso a asserção central deste caso é `enviarTextoMock` NÃO ter sido
   * chamado, e não a rejeição: uma implementação que lançasse DEPOIS do
   * envio passaria num teste que só olhasse `rejects.toThrow()`, e
   * continuaria mandando a mensagem na vida real.
   */
  it("a empresa A não envia mensagem pela conversa da B — o gateway não é chamado", async () => {
    enviarTextoMock.mockResolvedValue({ idExterno: `${P}-nao-deveria-existir` });

    await expect(
      responderComoHumano(EMPRESA_A, CONVERSA_B, "Oi, aqui é da empresa A.", USUARIO_A)
    ).rejects.toThrow();

    // 1. Nada saiu pelo WhatsApp.
    expect(enviarTextoMock).not.toHaveBeenCalled();

    // 2. Nada foi gravado na thread da B.
    const saidas = await prisma.whatsappMessage.findMany({
      where: { conversationId: CONVERSA_B, direcao: "SAIDA" },
    });
    expect(saidas).toEqual([]);

    // 3. E o efeito colateral do passo 1 da função (pausar a IA) também não
    // aconteceu: a recusa vem ANTES de qualquer escrita, não no meio dela.
    const b = await lerConversaCrua(CONVERSA_B);
    expect(b.iaAtiva).toBe(true);
    expect(b.aguardandoHumanoDesde).toEqual(ESPERA_DA_B);
  });

  it("responder na própria empresa continua enviando e gravando", async () => {
    const idExterno = `${P}-ext-envio-${crypto.randomUUID()}`;
    enviarTextoMock.mockResolvedValue({ idExterno });

    await responderComoHumano(EMPRESA_A, CONVERSA_A, "Oi! Já te ajudo.", USUARIO_A);

    expect(enviarTextoMock).toHaveBeenCalledWith(WA_A, "Oi! Já te ajudo.");

    const gravada = await prisma.whatsappMessage.findFirstOrThrow({
      where: { conversationId: CONVERSA_A, direcao: "SAIDA", autor: "HUMANO" },
    });
    expect(gravada.texto).toBe("Oi! Já te ajudo.");
    expect(gravada.companyId).toBe(EMPRESA_A);

    const a = await lerConversaCrua(CONVERSA_A);
    expect(a.iaAtiva).toBe(false);
    expect(a.aguardandoHumanoDesde).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Ciclo 1d — o lease, que é SQL CRU, e o aviso de conversa aguardando humano
// ─────────────────────────────────────────────────────────────────────────
//
// Os casos acima cobrem as nove portas de `queries.ts`/`agente.ts`, que o
// escopo protege sozinho. Os de baixo cobrem os dois pontos do módulo onde ele
// NÃO protege, e por motivos diferentes:
//
// 1. `claimLease`/`liberarLease` são `$queryRaw`/`$executeRaw`. O escopo não os
//    alcança POR CONSTRUÇÃO — a extensão vê os delegates de modelo, e SQL cru
//    não passa por lá (`core/tenancy/escopo.ts`, "Não alcança de jeito
//    nenhum"). O `WHERE "companyId"` deles é escrito à mão, e escrita à mão
//    precisa de teste, não de leitura atenta. A Parte 2b da catraca cobra que a
//    linha EXISTA no texto do template; estes casos cobram que ela FUNCIONE.
//
// 2. `marcarAguardandoHumano` alcançava a conversa por id sozinho, e o efeito
//    dela não é ler: é criar uma `Notification` para cada pessoa da empresa da
//    conversa, com o RÓTULO do cliente no payload.

describe("o lease do turno, que é SQL cru", () => {
  it("claimLease com o escopo da A não reivindica a conversa da B", async () => {
    const lease = await claimLease(EMPRESA_A, CONVERSA_B);

    expect(lease).toBeNull();

    // Não basta devolver `null`: a coluna não pode ter sido tocada. Um `UPDATE`
    // que gravasse e devolvesse vazio deixaria a conversa da B presa até o
    // lease expirar — negação de serviço de uma empresa sobre a outra.
    const noBanco = await prisma.conversation.findUniqueOrThrow({ where: { id: CONVERSA_B } });
    expect(noBanco.processandoAte).toBeNull();
  });

  it("claimLease com o escopo da B reivindica a conversa da B — a recusa é de EMPRESA", async () => {
    const lease = await claimLease(EMPRESA_B, CONVERSA_B);

    expect(lease).not.toBeNull();

    const noBanco = await prisma.conversation.findUniqueOrThrow({ where: { id: CONVERSA_B } });
    expect(noBanco.processandoAte).not.toBeNull();
  });

  it("liberarLease com o escopo da A não solta o lease que a B está segurando", async () => {
    const lease = await claimLease(EMPRESA_B, CONVERSA_B);
    expect(lease).not.toBeNull();

    await liberarLease(EMPRESA_A, CONVERSA_B, lease!.processandoAte);

    const noBanco = await prisma.conversation.findUniqueOrThrow({ where: { id: CONVERSA_B } });
    expect(noBanco.processandoAte).not.toBeNull();

    // A metade que impede "não soltar nunca" de passar por correção.
    await liberarLease(EMPRESA_B, CONVERSA_B, lease!.processandoAte);
    const depois = await prisma.conversation.findUniqueOrThrow({ where: { id: CONVERSA_B } });
    expect(depois.processandoAte).toBeNull();
  });

  it("confirmarTitularidadeLease da A dá `lease-perdido` para a conversa da B", async () => {
    const lease = await claimLease(EMPRESA_B, CONVERSA_B);

    // Mesmo com o token CERTO em mãos, o escopo da A não enxerga a linha — e o
    // desfecho é o que aborta o turno antes de qualquer envio ao cliente.
    expect(await confirmarTitularidadeLease(EMPRESA_A, CONVERSA_B, lease!.processandoAte)).toBe(
      "lease-perdido"
    );
    expect(await confirmarTitularidadeLease(EMPRESA_B, CONVERSA_B, lease!.processandoAte)).toBeNull();
  });
});

describe("marcarAguardandoHumano / limparAguardandoHumano", () => {
  it("a empresa A não marca a conversa da B, e ninguém é avisado", async () => {
    const marcou = await marcarAguardandoHumano(EMPRESA_A, CONVERSA_B);

    expect(marcou).toBe(false);

    // O fan-out é o dano real: uma `Notification` por pessoa da empresa, com o
    // rótulo do cliente no payload. "Devolveu false" não provaria que ele não
    // aconteceu — avisar e só depois devolver `false` passaria igual.
    expect(await prisma.notification.count({ where: { userId: USUARIO_B } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: USUARIO_A } })).toBe(0);

    const noBanco = await prisma.conversation.findUniqueOrThrow({ where: { id: CONVERSA_B } });
    expect(noBanco.aguardandoHumanoDesde).toEqual(ESPERA_DA_B);
  });

  it("a empresa A marca a PRÓPRIA conversa e avisa só a própria equipe", async () => {
    const marcou = await marcarAguardandoHumano(EMPRESA_A, CONVERSA_A_SEM_ESPERA);

    expect(marcou).toBe(true);
    expect(await prisma.notification.count({ where: { userId: USUARIO_A } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: USUARIO_B } })).toBe(0);
  });

  it("a empresa A não limpa a espera da conversa da B", async () => {
    await limparAguardandoHumano(EMPRESA_A, CONVERSA_B);

    const noBanco = await prisma.conversation.findUniqueOrThrow({ where: { id: CONVERSA_B } });
    expect(noBanco.aguardandoHumanoDesde).toEqual(ESPERA_DA_B);

    // A metade que impede "não limpar nunca" de passar por correção.
    await limparAguardandoHumano(EMPRESA_B, CONVERSA_B);
    const depois = await prisma.conversation.findUniqueOrThrow({ where: { id: CONVERSA_B } });
    expect(depois.aguardandoHumanoDesde).toBeNull();
  });
});
