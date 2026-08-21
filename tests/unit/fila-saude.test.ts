import { readFileSync } from "node:fs";

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * A vigia da fila é testada com o Prisma MOCKADO, não contra o banco.
 *
 * O que se afirma aqui é a REGRA — "fila parada há mais de
 * `LIMIAR_FILA_PARADA_MS` é falha" —, e regra se prova com entradas
 * escolhidas. Ir ao banco exigiria fabricar jobs velhos num Postgres
 * COMPARTILHADO com o desenvolvimento, e o teste que fabrica job velho numa
 * fila real é o teste que a vigia depois acusa como incidente.
 *
 * O mock de `@/lib/prisma` também é o que permite importar
 * `fila/postgres.ts` daqui: aquele módulo alcança `@/lib/prisma`, que
 * INSTANCIA o PrismaClient no topo do arquivo e exigiria `DATABASE_URL` —
 * mesma razão registrada em `tests/unit/fila-consumidor.test.ts`.
 */
const contar = vi.fn();
const primeiro = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    turnoJob: {
      count: (...args: unknown[]) => contar(...args),
      findFirst: (...args: unknown[]) => primeiro(...args),
    },
  },
}));

const { LIMIAR_FILA_PARADA_MS, RETRY_APOS_MS, medirSaudeDaFila } = await import(
  "../../src/modules/whatsapp/fila/postgres"
);

/**
 * `TEMPO_MAX_TURNO_MS` é lido do TEXTO de `fila/consumidor.ts`, não importado.
 *
 * Aquele módulo importa `../turno`, que carrega `server-only`; importá-lo aqui
 * obrigaria este arquivo a mockar o turno inteiro só para ler um número. É o
 * mesmo motivo — e a mesma função — que `tests/unit/fila-consumidor.test.ts`
 * já registra para `JOB_LEASE_MS` e `LEASE_DURACAO_MS`.
 */
function constanteDoArquivo(caminhoRelativo: string, nome: string): number {
  const texto = readFileSync(new URL(caminhoRelativo, import.meta.url), "utf8");
  const achado = new RegExp(`const ${nome} = ([0-9_]+);`).exec(texto);
  // Sem esta guarda, um `const` renomeado devolveria NaN e a comparação de
  // ordem passaria calada — o "teste que não exercita".
  if (!achado) throw new Error(`${nome} não foi encontrada em ${caminhoRelativo}`);
  return Number(achado[1].replace(/_/g, ""));
}

const AGORA = new Date("2026-08-21T12:00:00.000Z");

describe("medirSaudeDaFila", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
    contar.mockReset();
    primeiro.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fila vazia devolve idade nula — e nulo NÃO é falha", async () => {
    // Distinção que a vigia precisa acertar: "nada para fazer" e "não está
    // fazendo" têm a mesma aparência numa contagem só. Fila vazia é o estado
    // NORMAL de um CRM pequeno na madrugada, e uma vigia que alarme nisso é
    // desligada na primeira semana — depois disso ela não protege mais nada.
    contar.mockResolvedValue(0);
    primeiro.mockResolvedValue(null);

    const saude = await medirSaudeDaFila();

    expect(saude.prontos).toBe(0);
    expect(saude.idadeDoMaisVelhoMs).toBeNull();
  });

  it("mede a idade do job pronto MAIS VELHO, não a média nem a do mais novo", async () => {
    // A média esconde exatamente o caso que interessa: 99 jobs de 1s e um de
    // 40 min dão média de 24s. É o mais velho que diz há quanto tempo ninguém
    // drena.
    contar.mockResolvedValue(100);
    primeiro.mockResolvedValue({ criadoEm: new Date("2026-08-21T11:20:00.000Z") });

    const saude = await medirSaudeDaFila();

    expect(saude.idadeDoMaisVelhoMs).toBe(40 * 60_000);
    expect(primeiro).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { criadoEm: "asc" } })
    );
  });

  it("só conta job PRONTO: morto não conta, e lease vivo não conta", async () => {
    // Job com lease vivo está sendo trabalhado AGORA — contá-lo faria a vigia
    // acusar o worker justamente enquanto ele trabalha. Job morto já saiu da
    // fila por decisão (`MAX_TENTATIVAS_ENTREGA`) e fica 7 dias só para
    // diagnóstico; contá-lo deixaria a vigia em falha permanente por uma
    // semana depois de um único job envenenado.
    //
    // `toEqual(null)` e não `toBeFalsy()`: em Vitest, chave com valor
    // `undefined` é ignorada em comparação de objeto, e `mortoEm: undefined`
    // no `where` do Prisma significa "não filtre por isso" — o oposto exato do
    // que este caso afirma.
    contar.mockResolvedValue(0);
    primeiro.mockResolvedValue(null);

    await medirSaudeDaFila();

    const onde = contar.mock.calls[0]?.[0]?.where;
    expect(onde.mortoEm).toEqual(null);
    expect(onde.disponivelEm).toEqual({ lte: AGORA });
    expect(onde.OR).toEqual([{ leaseAte: null }, { leaseAte: { lt: AGORA } }]);
  });

  it("a consulta do MAIS VELHO usa o MESMO filtro da contagem", async () => {
    // Duas perguntas com filtros diferentes responderiam sobre duas filas
    // diferentes: `prontos=0` com `idadeDoMaisVelhoMs=40min` seria uma leitura
    // impossível, e quem a lesse não teria como saber qual metade acreditar.
    contar.mockResolvedValue(0);
    primeiro.mockResolvedValue(null);

    await medirSaudeDaFila();

    expect(primeiro.mock.calls[0]?.[0]?.where).toEqual(contar.mock.calls[0]?.[0]?.where);
  });

  it("conta os mortos da ÚLTIMA HORA — fila que mata tudo parece saudável sem isso", async () => {
    // Terceira medida, e diferente das outras duas: job envenenado que morre
    // na última entrega SOME da contagem de prontos. Uma fila que mata tudo o
    // que entra tem `prontos=0` e idade nula — a assinatura idêntica à da
    // madrugada tranquila.
    contar.mockResolvedValue(3);
    primeiro.mockResolvedValue(null);

    const saude = await medirSaudeDaFila();

    expect(saude.mortosRecentes).toBe(3);
    // `calls[1]`, e não `calls[2]`: `contar` recebe só as DUAS contagens
    // (prontos e mortos); a busca do mais velho é `findFirst`, que é outro
    // espião. A primeira redação deste caso usava [2] e falhava por índice
    // fora da lista, não pela regra — exatamente o "caso que reprova pelo
    // motivo errado".
    expect(contar.mock.calls[1]?.[0]?.where).toEqual({
      mortoEm: { gte: new Date(AGORA.getTime() - 60 * 60_000) },
    });
  });

  it("o limiar é 5 min, e é MAIOR que o pior caso de um turno legítimo", async () => {
    // Se o limiar fosse menor que o tempo que um turno legítimo pode demorar,
    // a vigia acusaria trabalho normal. O pior caso legítimo é
    // `TEMPO_MAX_TURNO_MS` (60s) mais `RETRY_APOS_MS` (30s) por reentrega.
    // A comparação é LIDA das constantes, não repetida em número: se alguém
    // subir o teto do turno, o caso morde aqui.
    const tempoMaxTurnoMs = constanteDoArquivo(
      "../../src/modules/whatsapp/fila/consumidor.ts",
      "TEMPO_MAX_TURNO_MS"
    );

    expect(LIMIAR_FILA_PARADA_MS).toBe(5 * 60_000);
    expect(LIMIAR_FILA_PARADA_MS).toBeGreaterThan(tempoMaxTurnoMs + RETRY_APOS_MS);
  });
});
