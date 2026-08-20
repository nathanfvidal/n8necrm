// Usa o Prisma real contra o Postgres do Supabase (para provar a transação
// e a corrida de idExterno de verdade, não com um mock) — carrega
// DATABASE_URL do .env aqui, mesmo padrão de dedupe.test.ts/rate-limit.test.ts.
import "dotenv/config";

import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server" que o Next.js aplica no build — fora desse pipeline (aqui,
// sob Vitest) ele sempre lança. src/lib/prisma.ts, ingest.ts e
// gateway/tipos.ts (transitivamente, via type-only import) precisam disto
// mockado antes de qualquer import real acontecer.
vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import { cifrar, PROPOSITO_APIKEY_CONEXAO } from "../../src/core/cofre";
import { hashWebhookToken } from "../../src/core/conexoes/webhook-token";
import { ingerirMensagem } from "../../src/modules/whatsapp/ingest";
import type { EventoWhatsapp } from "../../src/modules/whatsapp/gateway/tipos";

// Prefixo exclusivo deste arquivo, tanto para waId (Conversation) quanto
// para idExterno (WhatsappMessage) — nunca um deleteMany() sem esse filtro,
// mesma preocupação documentada em dedupe.test.ts/rate-limit.test.ts (banco
// compartilhado, incidentes de vazamento já aconteceram).
const PREFIXO = "teste-ingest-";

/**
 * ## Por que este arquivo passou a criar `Company` e `WhatsappConnection`
 *
 * Até o Ciclo 2a, `ingerirMensagem` tirava a empresa de `EVOLUTION_COMPANY_ID`
 * e este arquivo dependia do `.env` de desenvolvimento apontar para uma empresa
 * que existisse. Agora a empresa e a conexão viajam no CONTEXTO, e
 * `Conversation.connectionId` é FK para `WhatsappConnection` — um
 * `connectionId` inventado não é "um id qualquer", é violação de chave
 * estrangeira. A fixture cria as duas linhas de verdade.
 *
 * `MARCA` é o prefixo exclusivo do nome da empresa, e a limpeza apaga POR ELE:
 * o banco é o mesmo de desenvolvimento (⚠️ R1 da auditoria do Ciclo 1a), e
 * fixture que não limpa envenena a execução seguinte — já foi medido
 * acontecendo. A limpeza roda em `afterAll`, nunca num `finally`: `finally` não
 * roda quando o caso estoura por TIMEOUT, e foi assim que usuários e empresas
 * órfãs ficaram neste banco (padrão de `63cecd2`).
 */
const MARCA = "ZZTesteIngest2a";
const APIKEY = "apikey-do-ingest-9f8e";

let EMPRESA: string;
let CONEXAO: string;

const chaveOriginal = process.env.COFRE_CHAVE_MESTRA;

function evento(overrides: Partial<EventoWhatsapp> = {}): EventoWhatsapp {
  return {
    idExterno: `${PREFIXO}msg-${crypto.randomUUID()}`,
    waId: `${PREFIXO}5511999990001`,
    nomeExibicao: "Cliente Teste",
    tipo: "TEXTO",
    texto: "Olá, tudo bem?",
    timestamp: new Date(),
    ...overrides,
  };
}

async function limparDadosDeTeste() {
  const conversas = await prisma.conversation.findMany({
    where: { waId: { startsWith: PREFIXO } },
    select: { id: true },
  });
  const conversationIds = conversas.map((c) => c.id);

  if (conversationIds.length > 0) {
    // WhatsappMessage.conversationId tem onDelete: Cascade, mas apagamos
    // explicitamente por clareza e porque alguns testes criam mensagem sem
    // passar pela Conversation criada aqui (idExterno com o prefixo, mesmo
    // waId de outro teste) — cobrir os dois casos evita depender do cascade
    // silenciosamente.
    await prisma.whatsappMessage.deleteMany({ where: { conversationId: { in: conversationIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
  }

  await prisma.whatsappMessage.deleteMany({ where: { idExterno: { startsWith: PREFIXO } } });
}

/**
 * Ordem das FKs, e ela não é opinião: `WhatsappMessage` → `Conversation` →
 * `WhatsappConnection` → `Company`. `Conversation` aponta para as DUAS últimas,
 * então some antes das duas. Não há `Notification` nem `User` criados aqui — se
 * um dia houver, `Notification` vem antes de `User`.
 */
async function limparEmpresaDeTeste() {
  await limparDadosDeTeste();

  const empresas = await prisma.company.findMany({
    where: { nome: { startsWith: MARCA } },
    select: { id: true },
  });
  const ids = empresas.map((e) => e.id);
  if (ids.length === 0) return;

  const conversas = await prisma.conversation.findMany({
    where: { companyId: { in: ids } },
    select: { id: true },
  });
  const conversationIds = conversas.map((c) => c.id);
  if (conversationIds.length > 0) {
    await prisma.whatsappMessage.deleteMany({ where: { conversationId: { in: conversationIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
  }

  await prisma.whatsappConnection.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.company.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  // Chave mestra determinística do teste: `cifrar` a exige, e o `.env` de
  // desenvolvimento não é fonte confiável para um caso que precisa decifrar o
  // que ele mesmo cifrou. Restaurada no `afterAll` — mesmo padrão de
  // `conexoes-isolamento.test.ts`.
  process.env.COFRE_CHAVE_MESTRA = Buffer.alloc(32, 7).toString("base64");
  await limparEmpresaDeTeste();

  const empresa = await prisma.company.create({ data: { nome: `${MARCA}-A` } });
  EMPRESA = empresa.id;

  const conexao = await prisma.whatsappConnection.create({
    data: {
      companyId: empresa.id,
      canal: "EVOLUTION",
      nome: "Comercial",
      dominio: "https://evo-ingest.exemplo.com",
      instancia: `${MARCA}-inst`,
      segredoCifrado: cifrar(APIKEY, {
        companyId: empresa.id,
        proposito: PROPOSITO_APIKEY_CONEXAO,
      }),
      segredoUltimos4: APIKEY.slice(-4),
      segredoAtualizadoEm: new Date(),
      webhookTokenHash: hashWebhookToken("c".repeat(64)),
    },
  });
  CONEXAO = conexao.id;
});

afterAll(async () => {
  await limparEmpresaDeTeste();
  if (chaveOriginal === undefined) delete process.env.COFRE_CHAVE_MESTRA;
  else process.env.COFRE_CHAVE_MESTRA = chaveOriginal;
});

/** O contexto que a rota do webhook monta a partir da conexão resolvida. */
function contexto() {
  return { companyId: EMPRESA, connectionId: CONEXAO };
}

describe("ingerirMensagem", () => {
  afterEach(limparDadosDeTeste);

  it("cria a Conversation na primeira mensagem, com bufferSeq = 1", async () => {
    const resultado = await ingerirMensagem(evento(), contexto());

    expect(resultado.duplicada).toBe(false);
    expect(resultado.bufferSeq).toBe(1);

    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: resultado.conversationId },
    });
    expect(conversation.waId).toBe(`${PREFIXO}5511999990001`);
    expect(conversation.bufferSeq).toBe(1);
  });

  it("grava Conversation.telefone quando o waId normaliza para um telefone BR reconhecível", async () => {
    // waId no formato bruto que a Evolution manda: código do país (55) +
    // DDD + celular já com o 9º dígito. normalizarTelefoneWhatsapp ignora
    // qualquer caractere não-numérico (inclusive o prefixo "teste-ingest-"
    // deste arquivo) antes de normalizar — por isso o telefone gravado é só
    // os dígitos, sem o prefixo.
    const waId = `${PREFIXO}5511988887001`;
    const resultado = await ingerirMensagem(evento({ waId }), contexto());

    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: resultado.conversationId },
    });
    expect(conversation.waId).toBe(waId);
    expect(conversation.telefone).toBe("11988887001");
  });

  it("deixa Conversation.telefone nulo quando o waId não normaliza para um telefone BR reconhecível", async () => {
    // Só dígitos do prefixo de teste seriam curtos demais/não-numéricos —
    // usa um waId numérico mas claramente fora do formato BR (poucos
    // dígitos, sem DDD plausível) para testar o caminho `ok: false`.
    const waId = `${PREFIXO}123`;
    const resultado = await ingerirMensagem(evento({ waId }), contexto());

    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: resultado.conversationId },
    });
    expect(conversation.telefone).toBeNull();
  });

  it("reutiliza a MESMA Conversation para mensagens seguintes do mesmo waId, incrementando bufferSeq", async () => {
    const waId = `${PREFIXO}5511999990002`;

    const primeira = await ingerirMensagem(evento({ waId }), contexto());
    const segunda = await ingerirMensagem(evento({ waId }), contexto());
    const terceira = await ingerirMensagem(evento({ waId }), contexto());

    expect(segunda.conversationId).toBe(primeira.conversationId);
    expect(terceira.conversationId).toBe(primeira.conversationId);
    expect([primeira.bufferSeq, segunda.bufferSeq, terceira.bufferSeq]).toEqual([1, 2, 3]);

    const total = await prisma.whatsappMessage.count({
      where: { conversation: { waId } },
    });
    expect(total).toBe(3);
  });

  it(
    "idempotência: o MESMO idExterno submetido duas vezes cria exatamente UMA WhatsappMessage, sem " +
      "incrementar bufferSeq na segunda vez (prova a defesa contra redelivery do webhook)",
    async () => {
      const waId = `${PREFIXO}5511999990003`;
      const idExterno = `${PREFIXO}msg-duplicada-${crypto.randomUUID()}`;
      const mensagem = evento({ waId, idExterno });

      const primeira = await ingerirMensagem(mensagem, contexto());
      expect(primeira.duplicada).toBe(false);
      expect(primeira.bufferSeq).toBe(1);

      // Redelivery: MESMO payload (mesmo idExterno) — como a Evolution faria
      // num retry de rede, ou um reenvio manual do mesmo corpo.
      const segunda = await ingerirMensagem(mensagem, contexto());
      expect(segunda.duplicada).toBe(true);
      expect(segunda.conversationId).toBe(primeira.conversationId);
      // bufferSeq não avança na redelivery — continua 1, não 2.
      expect(segunda.bufferSeq).toBe(1);

      const total = await prisma.whatsappMessage.count({ where: { idExterno } });
      expect(total).toBe(1);

      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: { id: primeira.conversationId },
      });
      expect(conversation.bufferSeq).toBe(1);
    }
  );

  it(
    "sob concorrência, N chamadas simultâneas com o MESMO idExterno gravam exatamente UMA WhatsappMessage " +
      "(mesma prova de Promise.all que dedupe.test.ts faz para Contact.telefone)",
    async () => {
      const waId = `${PREFIXO}5511999990004`;
      const idExterno = `${PREFIXO}msg-corrida-${crypto.randomUUID()}`;

      const resultados = await Promise.all(
        Array.from({ length: 8 }, () => ingerirMensagem(evento({ waId, idExterno }), contexto()))
      );

      const total = await prisma.whatsappMessage.count({ where: { idExterno } });
      expect(total).toBe(1);

      const idsConversation = new Set(resultados.map((r) => r.conversationId));
      expect(idsConversation.size).toBe(1);

      // Exatamente uma das chamadas "ganhou" a corrida (duplicada: false);
      // todas as outras se reconheceram como redelivery.
      const vencedoras = resultados.filter((r) => !r.duplicada);
      expect(vencedoras).toHaveLength(1);
    }
  );

  it("grava texto null e o tipo correto para uma mensagem de mídia sem legenda (ex.: áudio)", async () => {
    const resultado = await ingerirMensagem(
      evento({ waId: `${PREFIXO}5511999990005`, tipo: "AUDIO", texto: null }),
      contexto()
    );

    const mensagem = await prisma.whatsappMessage.findFirstOrThrow({
      where: { conversationId: resultado.conversationId },
    });
    expect(mensagem.tipo).toBe("AUDIO");
    expect(mensagem.texto).toBeNull();
    expect(mensagem.direcao).toBe("ENTRADA");
    expect(mensagem.autor).toBe("CLIENTE");
    expect(mensagem.processadoEm).toBeNull();
  });

  it("atualiza nomeExibicao quando uma mensagem seguinte traz um nome novo, sem apagar com null", async () => {
    const waId = `${PREFIXO}5511999990006`;

    const primeira = await ingerirMensagem(evento({ waId, nomeExibicao: "Nome Antigo" }), contexto());
    await ingerirMensagem(evento({ waId, nomeExibicao: null }), contexto());
    const terceira = await ingerirMensagem(evento({ waId, nomeExibicao: "Nome Novo" }), contexto());

    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: primeira.conversationId },
    });
    expect(conversation.id).toBe(terceira.conversationId);
    expect(conversation.nomeExibicao).toBe("Nome Novo");
  });
});

describe("a conversa registra por qual conexão entrou (Ciclo 2a)", () => {
  afterEach(limparDadosDeTeste);

  it("`Conversation.connectionId` é gravado com a conexão que resolveu o webhook", async () => {
    // Sem isto, multi-instância seria mentira: a resposta sairia por "alguma"
    // conexão da empresa, e com duas cadastradas o cliente receberia resposta
    // de um número que nunca falou com ele.
    const meuEvento = evento({ waId: `${PREFIXO}5511999990007` });
    const resultado = await ingerirMensagem(meuEvento, contexto());
    expect(resultado.connectionId).toBe(CONEXAO);

    const conversa = await prisma.conversation.findFirst({
      where: { waId: meuEvento.waId },
      select: { connectionId: true, companyId: true },
    });
    expect(conversa?.connectionId).toBe(CONEXAO);
    expect(conversa?.companyId).toBe(EMPRESA);
  });

  it("a empresa devolvida é a do CONTEXTO, não a de nenhuma variável de ambiente", async () => {
    // A segunda metade do caso acima: prova que o valor veio do argumento. Se
    // `ingerirMensagem` voltasse a ler uma constante do deploy, este caso
    // continuaria verde só por coincidência de `EMPRESA` — por isso ele afirma
    // também que a empresa da fixture NÃO é a que o `.env` ainda nomeia.
    const resultado = await ingerirMensagem(evento({ waId: `${PREFIXO}5511999990008` }), contexto());
    expect(resultado.companyId).toBe(EMPRESA);
    expect(resultado.companyId).not.toBe(process.env.EVOLUTION_COMPANY_ID);
  });

  it("`ingest.ts` não LÊ `EVOLUTION_COMPANY_ID` — nem ela, nem `process.env` nenhum", async () => {
    const { readFileSync } = await import("node:fs");
    // A ponte que o Ciclo 1a criou dizendo "o Ciclo 2 remove" — ⚠️ R5 da
    // auditoria daquele ciclo. Este caso é o que impede ela de voltar por um
    // "só enquanto isso".
    //
    // ## Por que "não LÊ" e não "não MENCIONA"
    //
    // O plano desta tarefa pedia as duas coisas ao mesmo tempo: um caso
    // afirmando que a string não aparece no arquivo, e — no mesmo passo — um
    // comentário novo que a cita, para registrar o que mudou no Ciclo 2a e por
    // quê. As duas não cabem juntas. Vale a que fecha o defeito: o defeito é a
    // variável ser LIDA, não a história dela ser contada. Apagar a história
    // seria o oposto do que o comentário de ⚠️ R5 pediu.
    //
    // A guarda ficou mais apertada, não mais frouxa: `process.env` inteiro está
    // banido deste arquivo, então nem esta variável nem uma prima dela volta
    // por aqui — e o que sobra de `EVOLUTION_COMPANY_ID` tem de estar em linha
    // de comentário.
    const fonte = readFileSync("src/modules/whatsapp/ingest.ts", "utf8");

    // A varredura MORDE: sem estas duas linhas, um `readFileSync` que
    // devolvesse "" (caminho errado, arquivo movido) deixaria o caso verde para
    // sempre, e o filtro de comentário abaixo não teria nada para filtrar.
    expect(fonte).toContain("ingerirMensagem");
    expect(fonte).toContain("EVOLUTION_COMPANY_ID");

    expect(fonte).not.toContain("process.env");

    const eComentario = (linha: string) =>
      linha.trimStart().startsWith("//") || linha.trimStart().startsWith("*");
    const forasDeComentario = fonte
      .split("\n")
      .filter((l) => l.includes("EVOLUTION_COMPANY_ID") && !eComentario(l));
    expect(forasDeComentario).toEqual([]);

    // E a metade que prova que o filtro de comentário sabe dizer não: uma linha
    // de código com a variável NÃO é classificada como comentário.
    expect(eComentario('  const x = process.env.EVOLUTION_COMPANY_ID;')).toBe(false);
  });
});
