// Sem banco: os limites externos (`./postgres` e `../turno`) são mockados. O
// que este arquivo prova é a MÁQUINA do drenador — quem é concluído, quem é
// falhado, e o teto de duração. O comportamento contra o Postgres real é de
// `fila-postgres.test.ts`.
import { readFileSync } from "node:fs";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const reivindicarJobMock = vi.fn();
const concluirJobMock = vi.fn();
const falharJobMock = vi.fn();
const podarJobsMortosMock = vi.fn();

// Mock COMPLETO, sem `vi.importActual`: o módulo real importa `@/lib/prisma`,
// que INSTANCIA o PrismaClient no topo do arquivo — `importActual` exigiria
// `DATABASE_URL` e faria este arquivo, que não toca banco, passar a depender de
// um. Mesma razão pela qual `catraca-prisma-cru.test.ts` lê o schema em disco em
// vez de importar `MODELOS_DE_TENANT`.
//
// O caminho do mock é o alias; `consumidor.ts` importa `"./postgres"`, e as duas
// formas terminam no MESMO arquivo resolvido (`vite-tsconfig-paths` em
// `vitest.config.ts`), que é a chave que o Vitest usa.
vi.mock("@/modules/whatsapp/fila/postgres", () => ({
  reivindicarJob: () => reivindicarJobMock(),
  concluirJob: (...a: unknown[]) => concluirJobMock(...a),
  falharJob: (...a: unknown[]) => falharJobMock(...a),
  podarJobsMortos: (...a: unknown[]) => podarJobsMortosMock(...a),
}));

const processarTurnoMock = vi.fn();
vi.mock("@/modules/whatsapp/turno", () => ({
  processarTurno: (...a: unknown[]) => processarTurnoMock(...a),
}));

const { drenarFila, TEMPO_MAX_TURNO_MS } = await import(
  "../../src/modules/whatsapp/fila/consumidor"
);

/**
 * `JOB_LEASE_MS` e `LEASE_DURACAO_MS` são lidos do TEXTO dos arquivos, não
 * importados: os dois módulos que os declaram alcançam `@/lib/prisma`, e
 * importá-los faria este arquivo — que não toca banco — passar a exigir
 * `DATABASE_URL`.
 */
function constanteDoArquivo(caminhoRelativo: string, nome: string): number {
  const texto = readFileSync(new URL(caminhoRelativo, import.meta.url), "utf8");
  const achado = new RegExp(`const ${nome} = ([\\d_]+);`).exec(texto);
  // Sem esta guarda, um `const` renomeado devolveria NaN e a comparação de
  // ordem passaria calada — o "teste que não exercita".
  if (!achado) throw new Error(`${nome} não foi encontrada em ${caminhoRelativo}`);
  return Number(achado[1].replace(/_/g, ""));
}

const TOKEN = new Date("2026-08-21T12:00:00.000Z");
function jobReivindicado(id: string) {
  return {
    id,
    companyId: "empresa-1",
    conversationId: "conv-1",
    seq: 7,
    tentativaReagendamento: 0,
    tentativasEntrega: 1,
    leaseAte: TOKEN,
  };
}

beforeEach(() => {
  reivindicarJobMock.mockReset().mockResolvedValue(null);
  concluirJobMock.mockReset().mockResolvedValue(true);
  falharJobMock.mockReset().mockResolvedValue("reagendado");
  podarJobsMortosMock.mockReset().mockResolvedValue(0);
  processarTurnoMock.mockReset().mockResolvedValue(undefined);
  // A poda é por sorteio; travar o sorteio em "não poda" mantém os casos
  // abaixo determinísticos — o caso da poda tem o sorteio próprio.
  vi.spyOn(Math, "random").mockReturnValue(0.99);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("as três durações têm ordem, e a ordem é invariante", () => {
  it("TEMPO_MAX_TURNO_MS < LEASE_DURACAO_MS < JOB_LEASE_MS", async () => {
    // `maxDuration = 60` na rota era o teto do plano Hobby da Vercel, e o
    // comentário de LEASE_DURACAO_MS diz que 75s foi escolhido para ficar ACIMA
    // dele. Fora da Vercel nada mata a função: sem este teto em código, um
    // `processarTurno` pendurado passaria dos 75s, o lease da conversa expiraria
    // embaixo dele, e o fencing token — que existe para o caso RARO — viraria o
    // caso comum.
    const leaseConversa = constanteDoArquivo(
      "../../src/modules/whatsapp/turno.ts",
      "LEASE_DURACAO_MS"
    );
    const leaseJob = constanteDoArquivo(
      "../../src/modules/whatsapp/fila/postgres.ts",
      "JOB_LEASE_MS"
    );

    expect(TEMPO_MAX_TURNO_MS).toBeLessThan(leaseConversa);
    expect(leaseConversa).toBeLessThan(leaseJob);
  });
});

describe("drenarFila", () => {
  it("sem job pronto, não chama processarTurno e reporta que esgotou", async () => {
    const r = await drenarFila();
    expect(processarTurnoMock).not.toHaveBeenCalled();
    expect(r).toMatchObject({ processados: 0, esgotou: true });
  });

  it("processa o job e o CONCLUI com o token da reivindicação", async () => {
    reivindicarJobMock.mockResolvedValueOnce(jobReivindicado("j1")).mockResolvedValue(null);

    const r = await drenarFila();

    expect(processarTurnoMock).toHaveBeenCalledWith({
      companyId: "empresa-1",
      conversationId: "conv-1",
      seq: 7,
      tentativaReagendamento: 0,
    });
    expect(concluirJobMock).toHaveBeenCalledWith("empresa-1", "j1", TOKEN);
    expect(falharJobMock).not.toHaveBeenCalled();
    expect(r.processados).toBe(1);
  });

  it("handler que lança vira falharJob, e o laço continua", async () => {
    reivindicarJobMock
      .mockResolvedValueOnce(jobReivindicado("j1"))
      .mockResolvedValueOnce(jobReivindicado("j2"))
      .mockResolvedValue(null);
    processarTurnoMock.mockRejectedValueOnce(new Error("openai caiu"));

    const r = await drenarFila();

    expect(falharJobMock).toHaveBeenCalledWith(
      "empresa-1",
      "j1",
      TOKEN,
      expect.stringContaining("openai caiu")
    );
    expect(concluirJobMock).toHaveBeenCalledWith("empresa-1", "j2", TOKEN);
    expect(r).toMatchObject({ processados: 1, falhados: 1 });
  });

  it("turno que passa do teto vira FALHA, e não pendura o laço", async () => {
    vi.useFakeTimers();
    reivindicarJobMock.mockResolvedValueOnce(jobReivindicado("j1")).mockResolvedValue(null);
    processarTurnoMock.mockImplementation(() => new Promise(() => {})); // nunca resolve

    const promessa = drenarFila();
    await vi.advanceTimersByTimeAsync(TEMPO_MAX_TURNO_MS + 1_000);
    const r = await promessa;

    expect(falharJobMock).toHaveBeenCalledWith(
      "empresa-1",
      "j1",
      TOKEN,
      expect.stringContaining("teto")
    );
    expect(r.falhados).toBe(1);
    vi.useRealTimers();
  });

  it("job que morreu é contado e registrado", async () => {
    reivindicarJobMock.mockResolvedValueOnce(jobReivindicado("j1")).mockResolvedValue(null);
    processarTurnoMock.mockRejectedValueOnce(new Error("sempre falha"));
    falharJobMock.mockResolvedValueOnce("morto");
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await drenarFila();

    expect(r.mortos).toBe(1);
    expect(erro).toHaveBeenCalledWith(expect.stringContaining("conv-1"));
  });

  it("respeita o teto do lote e reporta que NÃO esgotou", async () => {
    reivindicarJobMock.mockResolvedValue(jobReivindicado("jN"));

    const r = await drenarFila({ loteMax: 3 });

    expect(processarTurnoMock).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ processados: 3, esgotou: false });
  });

  it("poda pela empresa do job, quando o sorteio manda", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.001);
    reivindicarJobMock.mockResolvedValueOnce(jobReivindicado("j1")).mockResolvedValue(null);

    await drenarFila();

    expect(podarJobsMortosMock).toHaveBeenCalledWith("empresa-1");
  });

  it("poda que falha não derruba a drenagem", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.001);
    reivindicarJobMock.mockResolvedValueOnce(jobReivindicado("j1")).mockResolvedValue(null);
    podarJobsMortosMock.mockRejectedValueOnce(new Error("banco tossiu"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await drenarFila();
    expect(r.processados).toBe(1);
  });
});
