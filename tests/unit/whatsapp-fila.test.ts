// Este arquivo testa `publicarTurno` DE VERDADE (não mockado) — só o limite
// externo é simulado. Ele nasceu do achado CRÍTICO do revisor (C2, fix round
// 1/5): "Your own test at whatsapp-turno.test.ts:198 only shows this working
// because publicarTurno is mocked there."
//
// Até o Ciclo 2d o limite externo era `send` de `@vercel/queue`, e a simulação
// era FIEL à dedupe por `idempotencyKey` documentada pela Vercel: mesma chave
// dentro da janela → `DuplicateMessageError`. Hoje o limite é o adaptador de
// Postgres, e a dedupe virou `@@unique([companyId, chaveIdempotencia])` +
// `createMany({ skipDuplicates: true })` — que **não lança**.
//
// O que se testa aqui e o que NÃO se testa mais aqui, dito em voz alta: a FORMA
// da chave de idempotência deixou de ser responsabilidade deste arquivo, porque
// deixou de ser responsabilidade de `fila/index.ts` — ela mora em
// `fila/postgres.ts#chaveIdempotencia` e tem cobertura contra o Postgres real em
// `tests/unit/fila-postgres.test.ts` (bloco da dedupe). O que sobra aqui, e é o
// motivo do arquivo existir, é a COSTURA: que `publicarTurno` de verdade
// entrega ao adaptador o job e as opções intactos, sem mexer no caminho, e que
// republicar não lança.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import type { OpcoesPublicacao, TurnoJob } from "../../src/modules/whatsapp/fila/tipos";

const publicarMock = vi.fn(async (_job: TurnoJob, _opcoes?: OpcoesPublicacao) => {});
vi.mock("@/modules/whatsapp/fila/postgres", () => ({
  FilaPostgres: class {
    publicar = publicarMock;
  },
}));

const { publicarTurno } = await import("../../src/modules/whatsapp/fila");

describe("publicarTurno — a costura entre o módulo e o adaptador", () => {
  beforeEach(() => {
    publicarMock.mockClear();
  });

  it("a publicação original chega ao adaptador com o job intacto e SEM opções", async () => {
    // Sem opções, e não `{ delaySeconds: undefined }`: o padrão de 8s é do
    // adaptador (`DELAY_PADRAO_SEGUNDOS`), e `publicarTurno` não pode inventar
    // um valor no meio do caminho. O Vitest IGNORA chave de valor `undefined`
    // mesmo em `toHaveBeenCalledWith` exato, então a asserção precisa olhar o
    // argumento em si para acusar a diferença.
    await publicarTurno({ companyId: "empresa-1", conversationId: "conv-1", seq: 3 });

    expect(publicarMock).toHaveBeenCalledTimes(1);
    const [job, opcoes] = publicarMock.mock.calls[0]!;
    expect(job).toEqual({ companyId: "empresa-1", conversationId: "conv-1", seq: 3 });
    expect(opcoes).toBeUndefined();
  });

  it("cada reagendamento chega com a própria tentativa e o delay de 5s", async () => {
    // O que a chave por tentativa protegia (achado C2) começa AQUI: se
    // `tentativaReagendamento` não chegasse ao adaptador, a chave dele seria a
    // da publicação original em toda tentativa, e o reagendamento por lease
    // ocupado voltaria a ser no-op.
    for (const tentativa of [1, 2, 3]) {
      await publicarTurno(
        { companyId: "empresa-1", conversationId: "conv-2", seq: 5, tentativaReagendamento: tentativa },
        { delaySeconds: 5 }
      );
    }

    expect(publicarMock).toHaveBeenCalledTimes(3);
    expect(publicarMock.mock.calls.map(([job]) => job.tentativaReagendamento)).toEqual([1, 2, 3]);
    expect(publicarMock.mock.calls.map(([, opcoes]) => opcoes?.delaySeconds)).toEqual([5, 5, 5]);
  });

  it(
    "o loop real de turno.ts (original + 5 reagendamentos por lease ocupado) NÃO lança, " +
      "e cada volta vira uma publicação distinta",
    async () => {
      const job = { companyId: "empresa-1", conversationId: "conv-3", seq: 7 };

      // Publicação original (ingest.ts).
      await expect(publicarTurno(job)).resolves.toBeUndefined();

      // Sucessivos reagendamentos por lease ocupado — exatamente o que
      // `processarTurno` faz a cada vez que `claimLease` falha.
      for (let tentativa = 1; tentativa <= 5; tentativa++) {
        await expect(
          publicarTurno({ ...job, tentativaReagendamento: tentativa }, { delaySeconds: 5 })
        ).resolves.toBeUndefined();
      }

      expect(publicarMock).toHaveBeenCalledTimes(6);
    }
  );

  it(
    "CONTRASTE — o desfecho da duplicata MUDOU de provedor, e o chamador não vê a mudança: " +
      "republicar o MESMO job (o que o código antigo fazia ao reagendar sem sufixo) resolve, " +
      "em vez de rejeitar com DuplicateMessageError",
    async () => {
      const job = { companyId: "empresa-1", conversationId: "conv-4", seq: 9 };

      await expect(publicarTurno(job)).resolves.toBeUndefined();
      await expect(publicarTurno(job)).resolves.toBeUndefined();

      // As duas chegaram ao adaptador: quem decide que a segunda é no-op é o
      // `skipDuplicates` dele, não este módulo. É a diferença de desenho contra
      // a Vercel — lá a rejeição subia até aqui e os dois chamadores de
      // `publicarTurno` precisavam traduzi-la para "tudo bem".
      expect(publicarMock).toHaveBeenCalledTimes(2);
    }
  );

  it("a instância do adaptador é construída UMA vez, e só na primeira publicação", async () => {
    // A construção preguiçosa é o que impede `next build` de instanciar o
    // adaptador só por alcançar o módulo (`gateway/index.ts` derrubou o build
    // deste projeto exatamente assim). O contrário — memoizar errado e
    // construir um adaptador por publicação — abriria uma conexão por job.
    const { publicarTurno: publicar } = await import("../../src/modules/whatsapp/fila");
    await publicar({ companyId: "empresa-1", conversationId: "conv-5", seq: 1 });
    await publicar({ companyId: "empresa-1", conversationId: "conv-5", seq: 2 });

    const instancias = new Set(publicarMock.mock.instances);
    expect(instancias.size).toBe(1);
  });
});
