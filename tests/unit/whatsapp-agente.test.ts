// Usa o Prisma real contra o Postgres do Supabase, mesmo motivo de
// whatsapp-turno.test.ts: a prova de que `pausarIa` não reescreve a autoria
// depende de um UPDATE condicional de verdade contra o banco, não de um
// mock — carrega DATABASE_URL do .env aqui, mesmo padrão de
// rate-limit.test.ts.
import "dotenv/config";

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Mock do gateway — nenhuma chamada real à Evolution nestes testes (mesmo
// padrão de tests/unit/whatsapp-turno.test.ts). Sem isto, um teste desta
// suíte mandaria mensagem de verdade para um telefone real.
const enviarTextoMock = vi.fn();
vi.mock("../../src/modules/whatsapp/gateway", () => ({
  whatsappGateway: { enviarTexto: (...args: unknown[]) => enviarTextoMock(...args) },
}));

import { prisma } from "../../src/lib/prisma";
import { pausarIa, religarIa, responderComoHumano } from "../../src/modules/whatsapp/agente";
import { criarConversation, idsDeUsuariosSemeados, limparConversasDeTeste } from "./helpers/whatsapp";

describe("pausar e religar a IA", () => {
  let ID_DO_ADMIN: string;
  let ID_DO_VENDEDOR: string;

  beforeAll(async () => {
    ({ ID_DO_ADMIN, ID_DO_VENDEDOR } = await idsDeUsuariosSemeados());
  });

  afterEach(limparConversasDeTeste);
  afterAll(limparConversasDeTeste);

  it("pausar grava quem pausou e quando", async () => {
    const conversa = await criarConversation();
    await pausarIa(conversa.id, ID_DO_ADMIN);

    const depois = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });
    expect(depois.iaAtiva).toBe(false);
    expect(depois.iaPausadaPorId).toBe(ID_DO_ADMIN);
    expect(depois.iaPausadaEm).toBeInstanceOf(Date);
  });

  // Sem isto, um segundo humano entrando na conversa reescreveria a autoria
  // da pausa -- e a tela passaria a mostrar a pessoa errada.
  it("pausar de novo não reescreve quem pausou primeiro", async () => {
    const conversa = await criarConversation();
    await pausarIa(conversa.id, ID_DO_ADMIN);
    const primeira = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });

    await pausarIa(conversa.id, ID_DO_VENDEDOR);
    const segunda = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });

    expect(segunda.iaPausadaPorId).toBe(ID_DO_ADMIN);
    expect(segunda.iaPausadaEm?.getTime()).toBe(primeira.iaPausadaEm?.getTime());
  });

  it("religar limpa o estado da pausa", async () => {
    const conversa = await criarConversation();
    await pausarIa(conversa.id, ID_DO_ADMIN);
    await religarIa(conversa.id);

    const depois = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });
    expect(depois.iaAtiva).toBe(true);
    expect(depois.iaPausadaEm).toBeNull();
    expect(depois.iaPausadaPorId).toBeNull();
  });
});

describe("resposta humana", () => {
  let ID_DO_ADMIN: string;

  beforeAll(async () => {
    ({ ID_DO_ADMIN } = await idsDeUsuariosSemeados());
  });

  beforeEach(() => {
    enviarTextoMock.mockReset();
  });

  afterEach(limparConversasDeTeste);
  afterAll(limparConversasDeTeste);

  it("pausa a IA, envia e grava — nessa ordem", async () => {
    const conversa = await criarConversation();
    enviarTextoMock.mockResolvedValueOnce({ idExterno: `teste-turno-humano-${crypto.randomUUID()}` });

    await responderComoHumano(conversa.id, "Oi! Aqui é o João, vou te ajudar.", ID_DO_ADMIN);

    expect(enviarTextoMock).toHaveBeenCalledWith(conversa.waId, "Oi! Aqui é o João, vou te ajudar.");

    const depois = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });
    expect(depois.iaAtiva).toBe(false);
    expect(depois.iaPausadaPorId).toBe(ID_DO_ADMIN);

    const mensagem = await prisma.whatsappMessage.findFirstOrThrow({
      where: { conversationId: conversa.id, direcao: "SAIDA", autor: "HUMANO" },
    });
    expect(mensagem.texto).toBe("Oi! Aqui é o João, vou te ajudar.");
  });

  // O teste que justifica a ordem escolhida. Se gravasse primeiro, a inbox
  // mostraria uma mensagem que o cliente nunca recebeu -- o pior dos três
  // modos de falha, porque o humano acredita ter respondido.
  it("falha de envio deixa a IA pausada e NENHUMA mensagem gravada", async () => {
    const conversa = await criarConversation();
    enviarTextoMock.mockRejectedValueOnce(new Error("gateway fora do ar"));

    await expect(responderComoHumano(conversa.id, "teste", ID_DO_ADMIN)).rejects.toThrow(
      /gateway fora do ar/
    );

    const depois = await prisma.conversation.findUniqueOrThrow({ where: { id: conversa.id } });
    expect(depois.iaAtiva).toBe(false); // pausado: a IA não aproveita a brecha

    const mensagens = await prisma.whatsappMessage.findMany({
      where: { conversationId: conversa.id, direcao: "SAIDA" },
    });
    expect(mensagens).toHaveLength(0);
  });

  it("recusa texto vazio sem chamar o gateway", async () => {
    const conversa = await criarConversation();
    await expect(responderComoHumano(conversa.id, "   ", ID_DO_ADMIN)).rejects.toThrow(
      /mensagem vazia/i
    );
    expect(enviarTextoMock).not.toHaveBeenCalled();
  });

  // M1 da rodada de correção 1: o teto de 4000 caracteres era a única regra
  // de negócio da função sem teste.
  it("recusa texto acima do limite de 4000 caracteres sem chamar o gateway", async () => {
    const conversa = await criarConversation();
    const textoEnorme = "a".repeat(4001);
    await expect(responderComoHumano(conversa.id, textoEnorme, ID_DO_ADMIN)).rejects.toThrow(
      /limite de 4000 caracteres/i
    );
    expect(enviarTextoMock).not.toHaveBeenCalled();
  });
});
