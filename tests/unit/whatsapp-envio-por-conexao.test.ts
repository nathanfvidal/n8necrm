// O envio sai pela conexão DA CONVERSA — Ciclo 2a, Tarefa 8, fase MIGRA.
//
// ## Por que este arquivo existe ao lado de `whatsapp-agente.test.ts`
//
// Aquele arquivo (e `whatsapp-turno.test.ts`, e `whatsapp-isolamento.test.ts`)
// mocka `gatewayDaConversa`: eles provam a ORIGEM do gateway — que `agente.ts`
// e `turno.ts` pedem o gateway da conversa, com o `companyId` e o
// `connectionId` certos. Nenhum deles prova o que a origem ENTREGA, porque o
// mock devolve sempre o mesmo espião.
//
// Aqui não há mock nenhum de fábrica, de leitura nem de cofre: a credencial é
// cifrada de verdade no banco de verdade, `credencialDaConexao` a decifra de
// verdade, e o único ponto interposto é o `fetch` global — o último metro
// antes da Evolution. A pergunta que só este arquivo responde é "a mensagem
// saiu pelo NÚMERO certo?", e ela é a razão de o Ciclo 2a existir: responder
// pela conexão errada é a empresa A falando pelo número da B.
//
// ## Duas conexões ATIVAS na fixture, e isso não é enfeite
//
// Com uma conexão só, `credencialDaConexao` e `credencialAtivaUnica` devolvem
// a mesma linha, e um `agente.ts` que ignorasse `connectionId` passaria em
// todos os casos abaixo. Com duas ativas, ignorar `connectionId` cai em
// `ConexaoAmbiguaError` e o caso fica vermelho — que é o ponto.
import "dotenv/config";

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import { cifrar, PROPOSITO_APIKEY_CONEXAO } from "../../src/core/cofre";
import { hashWebhookToken } from "../../src/core/conexoes/webhook-token";
import {
  ConexaoAmbiguaError,
  ConexaoDesativadaError,
} from "../../src/core/conexoes/leitura";
import { responderComoHumano } from "../../src/modules/whatsapp/agente";

/**
 * Prefixo exclusivo deste arquivo, e a limpeza apaga POR ELE.
 *
 * NÃO começa com `teste-`: `limparConversasDeTeste` (`helpers/whatsapp.ts`)
 * apaga toda `Conversation` com `waId` nesse prefixo, e o `afterEach` de
 * `whatsapp-agente.test.ts` levaria a fixture daqui junto se colidisse —
 * mesmo cuidado que `whatsapp-isolamento.test.ts` documenta.
 *
 * A limpeza roda em `afterAll`, e não num `finally`: `finally` não roda quando
 * o caso estoura por timeout, e foi assim que usuários e empresas órfãs
 * ficaram neste banco de desenvolvimento compartilhado (commit 63cecd2).
 */
const P = "ZZEnvioPorConexao2a";

const EMPRESA = `${P}-company`;
const USUARIO = `${P}-user`;

const CONEXAO_COMERCIAL = `${P}-conn-comercial`;
const CONEXAO_SUPORTE = `${P}-conn-suporte`;
const CONEXAO_DESLIGADA = `${P}-conn-desligada`;

const DOMINIO_COMERCIAL = "https://evo-comercial.exemplo.invalido";
const DOMINIO_SUPORTE = "https://evo-suporte.exemplo.invalido";
const DOMINIO_DESLIGADA = "https://evo-desligada.exemplo.invalido";

const INSTANCIA_COMERCIAL = `${P}-inst-comercial`;
const INSTANCIA_SUPORTE = `${P}-inst-suporte`;
const INSTANCIA_DESLIGADA = `${P}-inst-desligada`;

// Valores INVENTADOS para o teste — nenhuma credencial real deste ou de outro
// ambiente entra em arquivo versionado. São eles que provam "a apikey que foi
// para o header é a da conexão da conversa, e não a da vizinha".
const APIKEY_COMERCIAL = "apikey-inventada-comercial-0001";
const APIKEY_SUPORTE = "apikey-inventada-suporte-0002";
const APIKEY_DESLIGADA = "apikey-inventada-desligada-0003";

const SENHA_FALSA = "$2b$10$naoUsadaPorNenhumTesteDesteArquivo000000000000000000";

const chaveMestraOriginal = process.env.COFRE_CHAVE_MESTRA;

let fetchMock: ReturnType<typeof vi.fn>;

/**
 * Ordem ditada pelas FKs, e ela não é negociável (mesma lição de 63cecd2):
 * `Notification` aponta para `User`; `Conversation.iaPausadaPorId` também, e
 * este arquivo preenche esse campo em todo caso que chega ao passo 1;
 * `WhatsappMessage` aponta para `Conversation`; `Conversation` e
 * `WhatsappConnection` apontam para `Company`.
 */
async function limparTudo() {
  await prisma.notification.deleteMany({ where: { userId: USUARIO } });
  await prisma.notification.deleteMany({ where: { companyId: EMPRESA } });
  await prisma.auditLog.deleteMany({ where: { userId: USUARIO } });
  await prisma.auditLog.deleteMany({ where: { companyId: EMPRESA } });
  await prisma.whatsappMessage.deleteMany({ where: { companyId: EMPRESA } });
  await prisma.conversation.deleteMany({ where: { companyId: EMPRESA } });
  await prisma.whatsappConnection.deleteMany({ where: { companyId: EMPRESA } });
  await prisma.membership.deleteMany({ where: { userId: USUARIO } });
  await prisma.user.deleteMany({ where: { id: USUARIO } });
  await prisma.company.deleteMany({ where: { id: EMPRESA } });
}

function linhaDeConexao(
  id: string,
  nome: string,
  dominio: string,
  instancia: string,
  apiKey: string,
  ativa: boolean
) {
  return {
    id,
    companyId: EMPRESA,
    canal: "EVOLUTION" as const,
    nome,
    ativa,
    dominio,
    instancia,
    // Cifrado de verdade, com o mesmo propósito e o mesmo `companyId` que
    // `credencialDaConexao` vai exigir na decifragem — se o AAD do cofre
    // estivesse errado, o caso falharia aqui e não em produção.
    segredoCifrado: cifrar(apiKey, { companyId: EMPRESA, proposito: PROPOSITO_APIKEY_CONEXAO }),
    segredoUltimos4: apiKey.slice(-4),
    segredoAtualizadoEm: new Date(),
    webhookTokenHash: hashWebhookToken(`${id}-token-de-teste`.padEnd(64, "x")),
  };
}

/** Cria uma conversa desta empresa apontando (ou não) para uma conexão. */
async function criarConversa(connectionId: string | null, sufixo: string) {
  return prisma.conversation.create({
    data: {
      companyId: EMPRESA,
      waId: `${P}-wa-${sufixo}`,
      connectionId,
      bufferSeq: 1,
      iaAtiva: true,
    },
  });
}

/** Resposta de sucesso da Evolution, no shape que `enviarTexto` lê. */
function respostaOk(idExterno: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ key: { id: idExterno } }),
    text: async () => "",
  };
}

beforeAll(async () => {
  // Chave inventada, do tamanho que o cofre exige (32 bytes em base64). O
  // ambiente real não é tocado: `afterAll` restaura o valor de antes.
  process.env.COFRE_CHAVE_MESTRA = Buffer.alloc(32, 7).toString("base64");
  await limparTudo();

  await prisma.company.create({ data: { id: EMPRESA, nome: `${P} — envio por conexão` } });
  await prisma.user.create({
    data: {
      id: USUARIO,
      nome: "Atendente do envio por conexão",
      email: `${USUARIO}@exemplo.invalido`,
      senhaHash: SENHA_FALSA,
      papel: "ADMIN",
    },
  });
  // O vínculo, e não `User.papel`, é o que define "pessoa desta empresa"
  // (`User.papel` é espelho depreciado desde a8dd76a). Fixture que cria `User`
  // sem `Membership` produz usuário sem empresa nenhuma — bug latente de
  // e67e1e6.
  await prisma.membership.create({
    data: { userId: USUARIO, companyId: EMPRESA, papel: "ADMIN" },
  });

  await prisma.whatsappConnection.createMany({
    data: [
      linhaDeConexao(
        CONEXAO_COMERCIAL,
        "Comercial",
        DOMINIO_COMERCIAL,
        INSTANCIA_COMERCIAL,
        APIKEY_COMERCIAL,
        true
      ),
      linhaDeConexao(
        CONEXAO_SUPORTE,
        "Suporte",
        DOMINIO_SUPORTE,
        INSTANCIA_SUPORTE,
        APIKEY_SUPORTE,
        true
      ),
      linhaDeConexao(
        CONEXAO_DESLIGADA,
        "Desligada pelo operador",
        DOMINIO_DESLIGADA,
        INSTANCIA_DESLIGADA,
        APIKEY_DESLIGADA,
        false
      ),
    ],
  });
}, 60_000);

beforeEach(async () => {
  // O `fetch` global é o ÚNICO ponto interposto neste arquivo — tudo entre
  // `responderComoHumano` e ele roda de verdade.
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  await prisma.whatsappMessage.deleteMany({ where: { companyId: EMPRESA } });
  await prisma.conversation.deleteMany({ where: { companyId: EMPRESA } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await limparTudo();
  if (chaveMestraOriginal === undefined) delete process.env.COFRE_CHAVE_MESTRA;
  else process.env.COFRE_CHAVE_MESTRA = chaveMestraOriginal;
});

/**
 * Captura a rejeição de uma chamada, e FALHA se ela não rejeitar.
 *
 * `.catch((e) => e)` sozinho tipa o resultado como `void | Error` e, pior,
 * deixaria um caso que passou a NÃO rejeitar seguir para as asserções de
 * mensagem com `undefined` em mãos — que é o formato de teste que morre em
 * silêncio.
 */
async function erroDe(promessa: Promise<unknown>): Promise<Error> {
  try {
    await promessa;
  } catch (erro) {
    return erro as Error;
  }
  throw new Error("Esperava uma recusa, mas a chamada terminou com sucesso.");
}

/** O que o `fetch` interposto viu: para onde foi, e com qual apikey. */
function chamadaDeEnvio(indice = 0) {
  const [url, init] = fetchMock.mock.calls[indice] as [string, RequestInit];
  const headers = init.headers as Record<string, string>;
  return { url, apikey: headers.apikey, corpo: String(init.body) };
}

describe("a resposta humana sai pela conexão que a conversa registra", () => {
  it("conversa da conexão Suporte: envia pelo domínio, pela instância e com a apikey do Suporte", async () => {
    const conversa = await criarConversa(CONEXAO_SUPORTE, "suporte");
    fetchMock.mockResolvedValueOnce(respostaOk(`${P}-ext-1`));

    await responderComoHumano(EMPRESA, conversa.id, "Oi, aqui é o Suporte.", USUARIO);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, apikey } = chamadaDeEnvio();
    expect(url).toBe(`${DOMINIO_SUPORTE}/message/sendText/${INSTANCIA_SUPORTE}`);
    expect(apikey).toBe(APIKEY_SUPORTE);

    // As duas negativas são o coração do caso: a empresa tem OUTRA conexão
    // ativa, e é por ela que uma implementação sem `connectionId` sairia se
    // `credencialAtivaUnica` escolhesse "a primeira". (Hoje ela recusa em vez
    // de escolher — ver o caso de `ConexaoAmbiguaError` abaixo —, mas afirmar
    // só a positiva deixaria essa porta aberta para quem "consertasse" a
    // ambiguidade escolhendo.)
    expect(url).not.toContain("evo-comercial");
    expect(apikey).not.toBe(APIKEY_COMERCIAL);
  });

  it("conversa da conexão Comercial: sai pela Comercial — cada conversa pela SUA", async () => {
    // Sem este segundo caso, "sai pelo Suporte" poderia ser uma implementação
    // que sempre escolhe a última linha cadastrada, ou a de maior id. Com os
    // dois, só resolver POR `connectionId` satisfaz os dois ao mesmo tempo.
    const conversa = await criarConversa(CONEXAO_COMERCIAL, "comercial");
    fetchMock.mockResolvedValueOnce(respostaOk(`${P}-ext-2`));

    await responderComoHumano(EMPRESA, conversa.id, "Oi, aqui é o Comercial.", USUARIO);

    const { url, apikey } = chamadaDeEnvio();
    expect(url).toBe(`${DOMINIO_COMERCIAL}/message/sendText/${INSTANCIA_COMERCIAL}`);
    expect(apikey).toBe(APIKEY_COMERCIAL);
    expect(apikey).not.toBe(APIKEY_SUPORTE);
  });

  it("a segunda metade: com a conexão válida, a conversa continua sendo respondida NORMALMENTE", async () => {
    // Um `responderComoHumano` que recusasse tudo passaria em cada caso de
    // recusa deste arquivo. Esta é a metade que reprova essa "correção":
    // pausa → envia → grava acontece inteiro, com o `idExterno` que a
    // Evolution devolveu.
    const conversa = await criarConversa(CONEXAO_SUPORTE, "feliz");
    await prisma.conversation.update({
      where: { id: conversa.id },
      data: { aguardandoHumanoDesde: new Date() },
    });
    fetchMock.mockResolvedValueOnce(respostaOk(`${P}-ext-3`));

    await responderComoHumano(EMPRESA, conversa.id, "Já te ajudo.", USUARIO);

    const depois = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });
    expect(depois.iaAtiva).toBe(false);
    expect(depois.iaPausadaPorId).toBe(USUARIO);
    expect(depois.aguardandoHumanoDesde).toBeNull();

    const gravada = await prisma.whatsappMessage.findFirstOrThrow({
      where: { conversationId: conversa.id, direcao: "SAIDA", autor: "HUMANO" },
    });
    expect(gravada.texto).toBe("Já te ajudo.");
    expect(gravada.idExterno).toBe(`${P}-ext-3`);
    expect(gravada.companyId).toBe(EMPRESA);
  });
});

describe("recusas: a mensagem NÃO sai, e o erro diz o que fazer", () => {
  it("conexão DESATIVADA: `ConexaoDesativadaError`, e o `fetch` não foi chamado", async () => {
    const conversa = await criarConversa(CONEXAO_DESLIGADA, "desligada");

    await expect(
      responderComoHumano(EMPRESA, conversa.id, "não deve sair", USUARIO)
    ).rejects.toThrow(ConexaoDesativadaError);

    // "A função lançou" NÃO prova nada aqui: uma função que lançasse DEPOIS de
    // já ter mandado a mensagem passaria numa asserção só de rejeição e
    // continuaria falando com o cliente por um número que o operador
    // desligou. O oráculo é o `fetch` não ter sido chamado.
    expect(fetchMock).not.toHaveBeenCalled();

    const mensagens = await prisma.whatsappMessage.findMany({
      where: { conversationId: conversa.id, direcao: "SAIDA" },
    });
    expect(mensagens).toHaveLength(0);

    // E a IA fica CALADA mesmo assim: a pausa é o passo 1, antes do gateway.
    // Se a recusa da conexão acontecesse antes da pausa, o bot voltaria a
    // responder por cima de um humano que acha que já respondeu.
    const depois = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });
    expect(depois.iaAtiva).toBe(false);
  });

  it("a recusa da conexão desativada diz que a linha EXISTE e onde religar", async () => {
    const conversa = await criarConversa(CONEXAO_DESLIGADA, "desligada-msg");

    await expect(
      responderComoHumano(EMPRESA, conversa.id, "não deve sair", USUARIO)
    ).rejects.toThrow(/DESATIVADA/);
    await expect(
      responderComoHumano(EMPRESA, conversa.id, "não deve sair", USUARIO)
    ).rejects.toThrow(/Configurações → Conexões/);
  });

  it("conversa SEM `connectionId` numa empresa com duas ativas: `ConexaoAmbiguaError`, nada enviado", async () => {
    // Este é o caso que a Tarefa 7 deixou nomeado: não houve backfill, então
    // toda conversa anterior ao Ciclo 2a tem `connectionId` nulo. No dia em
    // que a empresa cadastrar a segunda conexão, elas param de ser
    // respondidas — recusa ALTA, não vazamento, e é o desenho: responder pelo
    // número errado é pior que não responder.
    const conversa = await criarConversa(null, "sem-conexao");

    await expect(
      responderComoHumano(EMPRESA, conversa.id, "não deve sair", USUARIO)
    ).rejects.toThrow(ConexaoAmbiguaError);
    expect(fetchMock).not.toHaveBeenCalled();

    const mensagens = await prisma.whatsappMessage.findMany({
      where: { conversationId: conversa.id, direcao: "SAIDA" },
    });
    expect(mensagens).toHaveLength(0);
  });

  it("a recusa por ambiguidade nomeia a CONVERSA e as duas saídas possíveis", async () => {
    // Sem o id da conversa, o log diria "conexão ambígua" e ninguém saberia
    // qual cliente ficou sem resposta. Sem as saídas, quem lesse não saberia
    // que dá para desativar as extras OU apontar a conversa.
    const conversa = await criarConversa(null, "sem-conexao-msg");

    const erro = await erroDe(responderComoHumano(EMPRESA, conversa.id, "x", USUARIO));
    expect(erro).toBeInstanceOf(ConexaoAmbiguaError);
    expect(erro.message).toContain(conversa.id);
    expect(erro.message).toContain("connectionId");
    expect(erro.message).toMatch(/desative as conexões extras/i);
  });
});

describe("conversa anterior ao Ciclo 2a: a recusa é por AMBIGUIDADE, não por falta de conexão", () => {
  // A Tarefa 7 deixou registrado que não houve backfill de `connectionId`. Este
  // describe mede as DUAS metades dessa dívida, porque só a primeira ("recusa")
  // deixaria acreditar que toda conversa velha parou de ser respondida agora —
  // e não é isso: enquanto a empresa tiver UMA conexão ativa, ela continua
  // sendo respondida normalmente. A recusa chega no dia da segunda conexão.
  afterEach(async () => {
    // Repõe o estado da fixture SEMPRE, e num `afterEach` e não num `finally`:
    // `finally` não roda quando o caso estoura por timeout, e o arquivo inteiro
    // depende de as duas conexões estarem ativas.
    await prisma.whatsappConnection.updateMany({
      where: { id: { in: [CONEXAO_COMERCIAL, CONEXAO_SUPORTE] } },
      data: { ativa: true },
    });
  });

  it("com UMA conexão ativa, a conversa sem `connectionId` continua sendo respondida", async () => {
    await prisma.whatsappConnection.update({
      where: { id: CONEXAO_COMERCIAL },
      data: { ativa: false },
    });
    const conversa = await criarConversa(null, "sem-conexao-uma-ativa");
    fetchMock.mockResolvedValueOnce(respostaOk(`${P}-ext-4`));

    await responderComoHumano(EMPRESA, conversa.id, "Oi.", USUARIO);

    // Sai pela única ativa — `credencialAtivaUnica` só recusa quando há MAIS
    // de uma. É por isso que a dívida do backfill é uma bomba com data, e não
    // um defeito em produção hoje.
    const { url, apikey } = chamadaDeEnvio();
    expect(url).toBe(`${DOMINIO_SUPORTE}/message/sendText/${INSTANCIA_SUPORTE}`);
    expect(apikey).toBe(APIKEY_SUPORTE);
  });

  it("a conexão DESATIVADA não entra na conta de 'única ativa'", async () => {
    // Se `credencialAtivaUnica` ignorasse `ativa`, a empresa teria TRÊS
    // conexões na conta e o caso acima recusaria por ambiguidade. Ele passa,
    // então a desligada está fora — e este `it` diz em voz alta qual linha do
    // filtro está sendo medida ali.
    const ativas = await prisma.whatsappConnection.count({
      where: { companyId: EMPRESA, ativa: true },
    });
    const total = await prisma.whatsappConnection.count({ where: { companyId: EMPRESA } });
    expect(total).toBe(3);
    expect(ativas).toBe(2);
  });
});

describe("a apikey decifrada não vaza pela mensagem de erro", () => {
  it("o corpo que a Evolution devolve ECOANDO a apikey sai redigido", async () => {
    // A Tarefa 3 (scrub do Sentry) registrou que `redigirApiKey` cobre
    // `enviarTexto` e SÓ ELE, e deixou como pendência garantir que todo
    // caminho novo até a Evolution passe por lá. Este é o cumprimento dessa
    // pendência pelo caminho que a Tarefa 8 abriu: `responderComoHumano` →
    // fábrica → `EvolutionGateway`, sem mock no meio.
    //
    // O scrub por FORMA (`src/lib/sentry-scrub.ts`) não alcançaria isto: a
    // apikey da Evolution não tem formato fixo, então só o objeto que a
    // carrega sabe qual string apagar.
    const conversa = await criarConversa(CONEXAO_SUPORTE, "erro-401");
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ erro: "unauthorized", apikey: APIKEY_SUPORTE }),
      json: async () => ({}),
    });

    const erro = await erroDe(responderComoHumano(EMPRESA, conversa.id, "oi", USUARIO));

    expect(erro.message).toContain("[apikey]");
    expect(erro.message).not.toContain(APIKEY_SUPORTE);
    // A mensagem inteira, e não só o miolo: `console.error` de `agente.ts`
    // repassa o erro cru para o Sentry, onde ele fica fora do controle de
    // quem opera o CRM, para sempre.
    expect(String(erro.stack ?? "")).not.toContain(APIKEY_SUPORTE);

    // E nada foi gravado: o envio falhou, então a inbox não pode mostrar uma
    // mensagem que o cliente nunca recebeu.
    const mensagens = await prisma.whatsappMessage.findMany({
      where: { conversationId: conversa.id, direcao: "SAIDA" },
    });
    expect(mensagens).toHaveLength(0);
  });
});
