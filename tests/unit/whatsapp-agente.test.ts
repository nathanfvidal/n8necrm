// Usa o Prisma real contra o Postgres do Supabase, mesmo motivo de
// whatsapp-turno.test.ts: a prova de que `pausarIa` não reescreve a autoria
// depende de um UPDATE condicional de verdade contra o banco, não de um
// mock — carrega DATABASE_URL do .env aqui, mesmo padrão de
// rate-limit.test.ts.
import "dotenv/config";

import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import { pausarIa, religarIa } from "../../src/modules/whatsapp/agente";
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
