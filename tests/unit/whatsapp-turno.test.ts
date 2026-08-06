// Usa o Prisma real contra o Postgres do Supabase (para provar a atomicidade
// do lease de verdade, com UPDATE condicional concorrente — não dá pra
// provar isso com um mock de banco) — carrega DATABASE_URL do .env aqui,
// mesmo padrão de rate-limit.test.ts (a mesma classe de prova: Promise.all
// contra o banco real).
import "dotenv/config";

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Mocks dos três pontos de saída de turno.ts — nenhuma chamada real à
// OpenAI ou à Evolution nestes testes (instrução explícita da Fatia 1).
const enviarTextoMock = vi.fn();
vi.mock("../../src/modules/whatsapp/gateway", () => ({
  whatsappGateway: { enviarTexto: (...args: unknown[]) => enviarTextoMock(...args) },
}));

const gerarRespostaMock = vi.fn();
vi.mock("../../src/modules/whatsapp/llm", () => ({
  llmProvider: { gerarResposta: (...args: unknown[]) => gerarRespostaMock(...args) },
}));

const publicarTurnoMock = vi.fn();
vi.mock("../../src/modules/whatsapp/fila", () => ({
  publicarTurno: (...args: unknown[]) => publicarTurnoMock(...args),
}));

import { prisma } from "../../src/lib/prisma";
import {
  processarTurno,
  claimLease,
  liberarLease,
  confirmarTitularidadeLease,
} from "../../src/modules/whatsapp/turno";
import { BOT_CONFIG_ID, botConfig } from "../../config/bot";

const PREFIXO = "teste-turno-";

async function criarConversation(
  overrides: Partial<{ waId: string; bufferSeq: number; iaAtiva: boolean }> = {}
) {
  return prisma.conversation.create({
    data: {
      waId: overrides.waId ?? `${PREFIXO}${crypto.randomUUID()}`,
      bufferSeq: overrides.bufferSeq ?? 1,
      iaAtiva: overrides.iaAtiva ?? true,
    },
  });
}

async function criarMensagemEntrada(
  conversationId: string,
  overrides: Partial<{ tipo: "TEXTO" | "AUDIO"; texto: string | null; idExterno: string }> = {}
) {
  return prisma.whatsappMessage.create({
    data: {
      conversationId,
      idExterno: overrides.idExterno ?? `${PREFIXO}${crypto.randomUUID()}`,
      direcao: "ENTRADA",
      autor: "CLIENTE",
      tipo: overrides.tipo ?? "TEXTO",
      texto: overrides.texto ?? "Olá, tudo bem?",
    },
  });
}

async function limparDadosDeTeste() {
  const conversas = await prisma.conversation.findMany({
    where: { waId: { startsWith: PREFIXO } },
    select: { id: true },
  });
  const ids = conversas.map((c) => c.id);
  if (ids.length > 0) {
    await prisma.whatsappMessage.deleteMany({ where: { conversationId: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { id: { in: ids } } });
  }
}

describe("processarTurno", () => {
  beforeEach(() => {
    // Cada chamada precisa de um idExterno ÚNICO (a coluna é @unique) — um
    // teste que envia mais de uma mensagem de saída (ex.: texto + fallback
    // de mídia) colidiria na constraint se todas as chamadas devolvessem o
    // mesmo valor fixo.
    enviarTextoMock
      .mockReset()
      .mockImplementation(async () => ({ idExterno: `${PREFIXO}saida-${crypto.randomUUID()}` }));
    gerarRespostaMock.mockReset().mockResolvedValue({ mensagens: ["Oi! Como posso ajudar?"] });
    publicarTurnoMock.mockReset().mockResolvedValue(undefined);
  });
  afterEach(limparDadosDeTeste);
  afterAll(limparDadosDeTeste);

  it("caminho feliz: processa a mensagem pendente, envia a resposta, marca processadoEm e libera o lease", async () => {
    const conversation = await criarConversation({ bufferSeq: 1 });
    const mensagem = await criarMensagemEntrada(conversation.id, { texto: "Quero saber do Gol 2018" });

    await processarTurno({ conversationId: conversation.id, seq: 1 });

    expect(gerarRespostaMock).toHaveBeenCalledTimes(1);
    expect(enviarTextoMock).toHaveBeenCalledWith(conversation.waId, "Oi! Como posso ajudar?");

    const mensagemAtualizada = await prisma.whatsappMessage.findUniqueOrThrow({
      where: { id: mensagem.id },
    });
    expect(mensagemAtualizada.processadoEm).not.toBeNull();

    const saida = await prisma.whatsappMessage.findFirstOrThrow({
      where: { conversationId: conversation.id, direcao: "SAIDA" },
    });
    expect(saida.autor).toBe("IA");
    expect(saida.texto).toBe("Oi! Como posso ajudar?");
    expect(saida.processadoEm).not.toBeNull();

    const conversationDepois = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(conversationDepois.processandoAte).toBeNull();
  });

  it("junta fragmentos de texto pendentes numa única chamada ao modelo (buffer)", async () => {
    const conversation = await criarConversation({ bufferSeq: 3 });
    await criarMensagemEntrada(conversation.id, { texto: "oi" });
    await criarMensagemEntrada(conversation.id, { texto: "quero saber" });
    await criarMensagemEntrada(conversation.id, { texto: "do gol 2018" });

    await processarTurno({ conversationId: conversation.id, seq: 3 });

    expect(gerarRespostaMock).toHaveBeenCalledTimes(1);
    const contexto = gerarRespostaMock.mock.calls[0]?.[0];
    const ultimaEntradaDoContexto = contexto.historico.at(-1);
    expect(ultimaEntradaDoContexto).toEqual({ autor: "CLIENTE", texto: "oi\nquero saber\ndo gol 2018" });

    const pendentesRestantes = await prisma.whatsappMessage.count({
      where: { conversationId: conversation.id, direcao: "ENTRADA", processadoEm: null },
    });
    expect(pendentesRestantes).toBe(0);
  });

  it("seq desatualizado: se uma mensagem mais nova já chegou (bufferSeq != seq do job), não processa nem chama o modelo", async () => {
    const conversation = await criarConversation({ bufferSeq: 5 }); // já avançou além do seq deste job
    await criarMensagemEntrada(conversation.id);

    await processarTurno({ conversationId: conversation.id, seq: 3 });

    expect(gerarRespostaMock).not.toHaveBeenCalled();
    expect(enviarTextoMock).not.toHaveBeenCalled();

    const conversationDepois = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    // O lease foi reivindicado (para ler bufferSeq) e precisa ser liberado
    // mesmo quando o turno não processa nada — senão a conversa fica travada
    // até o lease expirar sozinho.
    expect(conversationDepois.processandoAte).toBeNull();
  });

  it("mensagem só de mídia (sem texto): responde com o fallback fixo, sem chamar o modelo", async () => {
    const conversation = await criarConversation({ bufferSeq: 1 });
    await criarMensagemEntrada(conversation.id, { tipo: "AUDIO", texto: null });

    await processarTurno({ conversationId: conversation.id, seq: 1 });

    expect(gerarRespostaMock).not.toHaveBeenCalled();
    expect(enviarTextoMock).toHaveBeenCalledTimes(1);
    const [, textoEnviado] = enviarTextoMock.mock.calls[0] as [string, string];
    expect(textoEnviado).toMatch(/áudio|imagem/i);
  });

  it("mistura de texto e mídia: chama o modelo para o texto e ainda acrescenta o fallback de mídia", async () => {
    const conversation = await criarConversation({ bufferSeq: 2 });
    await criarMensagemEntrada(conversation.id, { texto: "quanto custa esse carro?" });
    await criarMensagemEntrada(conversation.id, { tipo: "AUDIO", texto: null });

    await processarTurno({ conversationId: conversation.id, seq: 2 });

    expect(gerarRespostaMock).toHaveBeenCalledTimes(1);
    expect(enviarTextoMock).toHaveBeenCalledTimes(2); // resposta do modelo + fallback de mídia
  });

  it(
    "concorrência: duas chamadas simultâneas de processarTurno para a MESMA conversa resultam em " +
      "exatamente UM processador ativo (uma chama o modelo, a outra detecta o lease ocupado e reagenda)",
    async () => {
      const conversation = await criarConversation({ bufferSeq: 1 });
      await criarMensagemEntrada(conversation.id);

      // Simula uma chamada de LLM que demora — abre uma janela real onde o
      // lease fica ocupado, para a segunda chamada concorrente ter chance
      // de observá-lo ocupado (a correção em si não depende deste atraso:
      // o UPDATE condicional serializa de qualquer forma, mas o atraso
      // torna o teste uma prova mais forte contra uma regressão futura que
      // reduza a janela do lease).
      gerarRespostaMock.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ mensagens: ["Oi! Como posso ajudar?"] }), 300)
          )
      );

      const job = { conversationId: conversation.id, seq: 1 };
      await Promise.all([processarTurno(job), processarTurno(job)]);

      expect(gerarRespostaMock).toHaveBeenCalledTimes(1);
      expect(enviarTextoMock).toHaveBeenCalledTimes(1);
      expect(publicarTurnoMock).toHaveBeenCalledTimes(1);
      // Fix round 1/5 (C2): o job reagendado carrega `tentativaReagendamento: 1`
      // — não o job original intacto — porque cada tentativa precisa de uma
      // idempotencyKey própria (fila.ts). Antes deste fix, o teste afirmava
      // `toHaveBeenCalledWith(job, ...)` (o job SEM o contador), o que só
      // "passava" porque `publicarTurno` estava mockado e nunca de fato
      // tentava enfileirar de novo — mascarando o bug real (ver
      // whatsapp-fila.test.ts para a prova com a função real).
      expect(publicarTurnoMock).toHaveBeenCalledWith(
        { ...job, tentativaReagendamento: 1 },
        { delaySeconds: 5 }
      );

      const conversationDepois = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      expect(conversationDepois.processandoAte).toBeNull();

      const mensagemProcessada = await prisma.whatsappMessage.findFirstOrThrow({
        where: { conversationId: conversation.id, direcao: "ENTRADA" },
      });
      expect(mensagemProcessada.processadoEm).not.toBeNull();
    }
  );

  it(
    "desiste de reagendar depois do teto de tentativas, sem lançar (guarda contra reagendamento eterno)",
    async () => {
      const conversation = await criarConversation({ bufferSeq: 1 });
      // Lease ocupado por "outro processador" (data no futuro) — sem isto,
      // claimLease teria sucesso de cara e o ramo de reagendamento nunca
      // seria exercitado.
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { processandoAte: new Date(Date.now() + 60_000) },
      });
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // `tentativaReagendamento` já no teto — a próxima tentativa (31ª)
      // deve desistir em vez de reagendar de novo.
      await processarTurno({ conversationId: conversation.id, seq: 1, tentativaReagendamento: 30 });

      expect(publicarTurnoMock).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("desistiu depois de"));

      consoleErrorSpy.mockRestore();
    }
  );

  it(
    "re-revisão da leva de fixes: reentrega da MESMA tentativa não pode virar retry eterno " +
      "quando o reagendamento dela já existe na fila",
    async () => {
      // Cenário: a fila entrega o job (seq 1, tentativa 0), o lease está
      // ocupado, o reagendamento r1 é publicado com sucesso e o handler
      // devolve 200 — mas essa confirmação se perde (entrega "pelo menos uma
      // vez" é justamente isso). A fila reentrega o MESMO job (seq 1,
      // tentativa 0). O lease continua ocupado, então o código tenta publicar
      // r1 de novo — e a chave r1 já está registrada na janela de dedupe.
      //
      // Sem tratamento, `DuplicateMessageError` sobe, o handler responde 500,
      // a fila reentrega, e o ciclo se repete até esgotar as tentativas. É a
      // MESMA classe do achado C2 (que era sempre) por outro gatilho (que é
      // raro) — e o reagendamento r1 correto já está na fila fazendo o
      // trabalho, então não há nada a recuperar: a publicação duplicada é uma
      // não-operação, não uma falha.
      const conversation = await criarConversation({ bufferSeq: 1 });
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { processandoAte: new Date(Date.now() + 60_000) },
      });

      const { DuplicateMessageError } = await import("@vercel/queue");
      publicarTurnoMock.mockRejectedValueOnce(new DuplicateMessageError("já publicado"));

      await expect(
        processarTurno({ conversationId: conversation.id, seq: 1, tentativaReagendamento: 0 })
      ).resolves.toBeUndefined();

      expect(publicarTurnoMock).toHaveBeenCalledTimes(1);
    }
  );

  describe("fencing token (fix round 1/5, achado CRÍTICO C1) — prova direta do mecanismo", () => {
    it(
      "liberarLease com um token DESATUALIZADO (ex.: de um processador cujo lease expirou de verdade) " +
        "é um no-op — não apaga o lease de quem reivindicou depois",
      async () => {
        const conversation = await criarConversation({ bufferSeq: 1 });

        // Processador A reivindica o lease — token A.
        const tokenA = await claimLease(conversation.id);
        expect(tokenA).not.toBeNull();

        // Simula o lease de A expirando DE VERDADE (relógio avançou, ou A
        // ficou preso além do próprio lease) — força processandoAte para o
        // passado, exatamente como aconteceria organicamente com o tempo.
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { processandoAte: new Date(Date.now() - 1000) },
        });

        // Processador B reivindica o lease agora livre — token B, DIFERENTE
        // do token A.
        const tokenB = await claimLease(conversation.id);
        expect(tokenB).not.toBeNull();
        expect(tokenB!.processandoAte.getTime()).not.toBe(tokenA!.processandoAte.getTime());

        // A, terminando tarde, tenta liberar com seu token ANTIGO (tokenA).
        // Achado CRÍTICO do revisor: sem o fencing token, isto apagava o
        // lease de B incondicionalmente — abrindo espaço para um TERCEIRO
        // processador entrar enquanto B ainda trabalha.
        await liberarLease(conversation.id, tokenA!.processandoAte);

        const conversationAposLiberacaoDeA = await prisma.conversation.findUniqueOrThrow({
          where: { id: conversation.id },
        });
        // O lease de B continua intacto — a liberação de A foi um no-op.
        expect(conversationAposLiberacaoDeA.processandoAte?.getTime()).toBe(
          tokenB!.processandoAte.getTime()
        );

        // B, ao terminar de verdade, libera com o PRÓPRIO token — agora sim
        // o lease é liberado.
        await liberarLease(conversation.id, tokenB!.processandoAte);
        const conversationAposLiberacaoDeB = await prisma.conversation.findUniqueOrThrow({
          where: { id: conversation.id },
        });
        expect(conversationAposLiberacaoDeB.processandoAte).toBeNull();
      }
    );

    it("confirmarTitularidadeLease reflete corretamente titular atual vs. token antigo", async () => {
      const conversation = await criarConversation({ bufferSeq: 1 });
      const tokenA = await claimLease(conversation.id);

      // Ainda titular e IA ativa: pode seguir (`null`).
      expect(await confirmarTitularidadeLease(conversation.id, tokenA!.processandoAte)).toBeNull();

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { processandoAte: new Date(Date.now() - 1000) },
      });
      const tokenB = await claimLease(conversation.id);

      // O token antigo (A) não é mais o titular; o novo (B) é.
      expect(await confirmarTitularidadeLease(conversation.id, tokenA!.processandoAte)).toBe(
        "lease-perdido"
      );
      expect(await confirmarTitularidadeLease(conversation.id, tokenB!.processandoAte)).toBeNull();
    });
  });

  it(
    "reprodução do probe do revisor (C1): lease expira DE VERDADE em voo (chamada lenta ao modelo) e um " +
      "segundo processador reivindica e conclui o turno inteiro antes do primeiro voltar — o primeiro, ao " +
      "voltar, detecta que perdeu a titularidade e NÃO envia uma segunda resposta (garantia testada: no " +
      "máximo UMA mensagem chega ao cliente, mesmo neste cenário sintético e adversarial)",
    async () => {
      const conversation = await criarConversation({ bufferSeq: 1 });
      await criarMensagemEntrada(conversation.id, { texto: "Quero saber do Gol 2018" });

      // Controle manual de quando a chamada "lenta" do processador A
      // resolve — sem isto, não dá pra garantir determinismo na ordem
      // A-começa / expira-o-lease / B-conclui / A-retoma.
      let resolverChamadaLentaDeA: (valor: { mensagens: string[] }) => void;
      const chamadaLentaDeA = new Promise<{ mensagens: string[] }>((resolve) => {
        resolverChamadaLentaDeA = resolve;
      });

      gerarRespostaMock
        .mockImplementationOnce(() => chamadaLentaDeA) // 1ª chamada (A): fica pendurada até resolvermos.
        .mockResolvedValueOnce({ mensagens: ["Resposta de B"] }); // 2ª chamada (B): resolve na hora.

      const job = { conversationId: conversation.id, seq: 1 };

      // Dispara A — ele reivindica o lease e fica bloqueado dentro da
      // chamada ao modelo (ainda não resolvida).
      const turnoA = processarTurno(job);

      // Espera A efetivamente reivindicar o lease antes de prosseguir —
      // sincronização por polling contra o próprio banco (sem isso, corre
      // o risco de "forçar a expiração" antes de A sequer ter reivindicado
      // nada).
      await esperarAte(async () => {
        const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
        return c.processandoAte !== null;
      });

      // Força a expiração do lease de A — a MESMA técnica que o revisor
      // usou para reproduzir o bug original.
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { processandoAte: new Date(Date.now() - 1000) },
      });

      // B reivindica o lease agora livre e conclui o turno INTEIRO
      // (chamada ao modelo resolve na hora, envia, marca processado, libera
      // o lease) antes de A voltar.
      await processarTurno(job);

      expect(enviarTextoMock).toHaveBeenCalledTimes(1);
      expect(enviarTextoMock).toHaveBeenCalledWith(conversation.waId, "Resposta de B");

      // Só agora A "acorda" — sua chamada ao modelo finalmente resolve.
      resolverChamadaLentaDeA!({ mensagens: ["Resposta de A (deveria ser descartada)"] });
      await turnoA;

      // Garantia central deste teste: mesmo com A tendo chamado o modelo
      // (não há como evitar isso — a chamada já estava em voo quando a
      // expiração foi forçada), A NÃO manda a própria resposta depois de
      // perder a titularidade. Exatamente UMA mensagem chegou ao cliente.
      expect(enviarTextoMock).toHaveBeenCalledTimes(1);
      const totalSaida = await prisma.whatsappMessage.count({
        where: { conversationId: conversation.id, direcao: "SAIDA" },
      });
      expect(totalSaida).toBe(1);

      const saida = await prisma.whatsappMessage.findFirstOrThrow({
        where: { conversationId: conversation.id, direcao: "SAIDA" },
      });
      expect(saida.texto).toBe("Resposta de B");

      // O lease termina liberado (B liberou com seu próprio token; a
      // tentativa de A de liberar depois, se ocorrer, é um no-op pelo
      // mesmo motivo do teste de fencing acima).
      const conversationFinal = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      expect(conversationFinal.processandoAte).toBeNull();
    }
  );

  describe("teto de respostas de IA por conversa por hora (fix round 1/5, achado I2)", () => {
    it("para de responder automaticamente ao atingir o teto, mas continua marcando as pendentes como processadas", async () => {
      const conversation = await criarConversation({ bufferSeq: 1 });

      // Semeia TETO_RESPOSTAS_IA_POR_HORA (20) respostas de IA "recentes"
      // direto no banco — mais rápido e determinístico que rodar 20 turnos
      // de verdade.
      await prisma.whatsappMessage.createMany({
        data: Array.from({ length: 20 }, (_, i) => ({
          conversationId: conversation.id,
          idExterno: `${PREFIXO}saida-teto-${i}-${crypto.randomUUID()}`,
          direcao: "SAIDA" as const,
          autor: "IA" as const,
          tipo: "TEXTO" as const,
          texto: "resposta anterior",
          processadoEm: new Date(),
        })),
      });

      const pendente = await criarMensagemEntrada(conversation.id, { texto: "mais uma pergunta" });

      await processarTurno({ conversationId: conversation.id, seq: 1 });

      expect(gerarRespostaMock).not.toHaveBeenCalled();
      expect(enviarTextoMock).not.toHaveBeenCalled();

      const pendenteAtualizada = await prisma.whatsappMessage.findUniqueOrThrow({
        where: { id: pendente.id },
      });
      // Persistida e marcada como processada (visível no inbox humano) —
      // "para de responder", não "descarta calado".
      expect(pendenteAtualizada.processadoEm).not.toBeNull();
    });

    it("continua respondendo normalmente quando abaixo do teto", async () => {
      const conversation = await criarConversation({ bufferSeq: 1 });
      await prisma.whatsappMessage.createMany({
        data: Array.from({ length: 19 }, (_, i) => ({
          conversationId: conversation.id,
          idExterno: `${PREFIXO}saida-abaixo-${i}-${crypto.randomUUID()}`,
          direcao: "SAIDA" as const,
          autor: "IA" as const,
          tipo: "TEXTO" as const,
          texto: "resposta anterior",
          processadoEm: new Date(),
        })),
      });
      await criarMensagemEntrada(conversation.id, { texto: "mais uma pergunta" });

      await processarTurno({ conversationId: conversation.id, seq: 1 });

      expect(gerarRespostaMock).toHaveBeenCalledTimes(1);
      expect(enviarTextoMock).toHaveBeenCalledTimes(1);
    });

    it("não conta respostas de IA de mais de uma hora atrás para o teto", async () => {
      const conversation = await criarConversation({ bufferSeq: 1 });
      await prisma.whatsappMessage.createMany({
        data: Array.from({ length: 25 }, (_, i) => ({
          conversationId: conversation.id,
          idExterno: `${PREFIXO}saida-antiga-${i}-${crypto.randomUUID()}`,
          direcao: "SAIDA" as const,
          autor: "IA" as const,
          tipo: "TEXTO" as const,
          texto: "resposta bem antiga",
          processadoEm: new Date(),
          criadoEm: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2h atrás
        })),
      });
      await criarMensagemEntrada(conversation.id, { texto: "pergunta nova" });

      await processarTurno({ conversationId: conversation.id, seq: 1 });

      expect(gerarRespostaMock).toHaveBeenCalledTimes(1);
    });
  });

  it(
    "achado do revisor (I4): marca as pendentes como processadas assim que a PRIMEIRA resposta é " +
      "confirmada enviada — uma falha no envio da 2ª mensagem não deixa as pendentes sem marcar (o que " +
      "faria um retry da fila reenviar a 1ª mensagem, já entregue, de novo)",
    async () => {
      const conversation = await criarConversation({ bufferSeq: 1 });
      const pendente = await criarMensagemEntrada(conversation.id, { texto: "me fala sobre o carro" });

      gerarRespostaMock.mockResolvedValue({ mensagens: ["Primeira parte", "Segunda parte"] });
      enviarTextoMock
        .mockReset()
        .mockResolvedValueOnce({ idExterno: `${PREFIXO}saida-ok-${crypto.randomUUID()}` })
        .mockRejectedValueOnce(new Error("Evolution fora do ar"));

      await expect(processarTurno({ conversationId: conversation.id, seq: 1 })).rejects.toThrow(
        "Evolution fora do ar"
      );

      // A pendente FOI marcada como processada, mesmo com a 2ª mensagem
      // tendo falhado — é o comportamento corrigido: perder a 2ª mensagem é
      // aceitável, reenviar a 1ª (que já chegou) não é.
      const pendenteAtualizada = await prisma.whatsappMessage.findUniqueOrThrow({
        where: { id: pendente.id },
      });
      expect(pendenteAtualizada.processadoEm).not.toBeNull();

      // Só a 1ª mensagem foi de fato gravada como SAIDA.
      const totalSaida = await prisma.whatsappMessage.count({
        where: { conversationId: conversation.id, direcao: "SAIDA" },
      });
      expect(totalSaida).toBe(1);

      // O lease foi liberado mesmo com o erro (finally em processarTurno).
      const conversationDepois = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      expect(conversationDepois.processandoAte).toBeNull();
    }
  );

  it("achado do revisor (I5): trunca uma mensagem de entrada excessivamente longa antes de entrar no contexto do modelo", async () => {
    const conversation = await criarConversation({ bufferSeq: 1 });
    const textoEnorme = "a".repeat(5000);
    await criarMensagemEntrada(conversation.id, { texto: textoEnorme });

    await processarTurno({ conversationId: conversation.id, seq: 1 });

    const contexto = gerarRespostaMock.mock.calls[0]?.[0];
    const ultimaEntrada = contexto.historico.at(-1);
    expect(ultimaEntrada.texto.length).toBeLessThan(textoEnorme.length);
    expect(ultimaEntrada.texto).toContain("truncada");
  });

  describe("guarda da IA (Fatia 2)", () => {
    it("não responde quando a conversa está pausada, mas marca as pendentes", async () => {
      const conversation = await criarConversation({ iaAtiva: false });
      await criarMensagemEntrada(conversation.id, { texto: "oi, tem o Onix 2020?" });

      await processarTurno({ conversationId: conversation.id, seq: conversation.bufferSeq });

      expect(enviarTextoMock).not.toHaveBeenCalled();
      const pendentes = await prisma.whatsappMessage.findMany({
        where: { conversationId: conversation.id, direcao: "ENTRADA", processadoEm: null },
      });
      expect(pendentes).toHaveLength(0);
    });

    it("não responde quando o interruptor global está desligado", async () => {
      await prisma.botConfig.update({ where: { id: BOT_CONFIG_ID }, data: { ativo: false } });
      try {
        const conversation = await criarConversation();
        await criarMensagemEntrada(conversation.id, { texto: "bom dia" });

        await processarTurno({ conversationId: conversation.id, seq: conversation.bufferSeq });

        expect(enviarTextoMock).not.toHaveBeenCalled();
      } finally {
        await prisma.botConfig.update({ where: { id: BOT_CONFIG_ID }, data: { ativo: true } });
      }
    });

    // O caso que motiva a mudança de tipo de retorno: pausar DEPOIS que o
    // modelo já respondeu, mas antes do envio. A resposta gerada tem que ser
    // jogada fora -- é dinheiro já gasto, e mandá-la seria falar por cima do
    // humano.
    it("descarta a resposta quando a IA é pausada durante a chamada ao modelo", async () => {
      const conversation = await criarConversation();
      await criarMensagemEntrada(conversation.id, { texto: "quero saber o preço" });

      gerarRespostaMock.mockImplementationOnce(async () => {
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { iaAtiva: false, iaPausadaEm: new Date() },
        });
        return { mensagens: ["Resposta que não deve ser enviada"] };
      });

      await processarTurno({ conversationId: conversation.id, seq: conversation.bufferSeq });

      expect(enviarTextoMock).not.toHaveBeenCalled();
    });

    // A distinção que um booleano não consegue expressar: quem PERDEU o
    // lease não pode marcar as pendentes -- quem assumiu o lease vai
    // respondê-las.
    it("perder o lease NÃO marca as pendentes como processadas", async () => {
      const conversation = await criarConversation();
      await criarMensagemEntrada(conversation.id, { texto: "oi" });

      gerarRespostaMock.mockImplementationOnce(async () => {
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { processandoAte: new Date(Date.now() + 60_000) }, // outro dono
        });
        return { mensagens: ["resposta órfã"] };
      });

      await processarTurno({ conversationId: conversation.id, seq: conversation.bufferSeq });

      const pendentes = await prisma.whatsappMessage.findMany({
        where: { conversationId: conversation.id, direcao: "ENTRADA", processadoEm: null },
      });
      expect(pendentes).toHaveLength(1);
    });

    it("monta o prompt a partir do banco, não de config/bot.ts", async () => {
      const original = await prisma.botConfig.findUniqueOrThrow({ where: { id: BOT_CONFIG_ID } });
      await prisma.botConfig.update({
        where: { id: BOT_CONFIG_ID },
        data: { personaNome: "Beatriz-do-teste" },
      });

      try {
        const conversation = await criarConversation();
        await criarMensagemEntrada(conversation.id, { texto: "oi" });
        enviarTextoMock.mockResolvedValue({ idExterno: `${PREFIXO}saida-${conversation.id}` });

        await processarTurno({ conversationId: conversation.id, seq: conversation.bufferSeq });

        const [chamada] = gerarRespostaMock.mock.calls.at(-1)!;
        expect(chamada.systemPrompt).toContain("Beatriz-do-teste");
        expect(chamada.systemPrompt).not.toContain(botConfig.persona.nome);
      } finally {
        await prisma.botConfig.update({
          where: { id: BOT_CONFIG_ID },
          data: { personaNome: original.personaNome },
        });
      }
    });
  });
});

async function esperarAte(condicao: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    if (await condicao()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("esperarAte: condição não satisfeita dentro do timeout");
}
