// Sem Prisma, sem `server-only`, sem `dotenv/config` — `src/lib/date.ts` é
// função pura, exatamente para poder ser testada isolada de qualquer
// infraestrutura. Estes testes forçam `timeZone: "UTC"` na formatação (ver
// comentário em date.ts) para provar que o resultado NÃO depende do fuso
// horário da máquina que roda o teste (dev local, CI, etc.) — a máquina
// pode estar em qualquer fuso, o resultado tem que ser sempre o mesmo dia
// civil que foi digitado.
import { describe, it, expect } from "vitest";
import { parseDataCivil, formatarDataCivilBR } from "../../src/lib/date";

describe("parseDataCivil", () => {
  it("ancora em meia-noite UTC do dia informado (não do fuso local do processo)", () => {
    const data = parseDataCivil("2026-08-05");
    expect(data.toISOString()).toBe("2026-08-05T00:00:00.000Z");
  });

  it("rejeita formato fora de AAAA-MM-DD", () => {
    expect(() => parseDataCivil("05/08/2026")).toThrow(/inválida/i);
  });

  it("rejeita string vazia", () => {
    expect(() => parseDataCivil("")).toThrow(/inválida/i);
  });

  it(
    "rejeita dia que não existe no calendário em vez de rolar silenciosamente para o mês " +
      "seguinte (Date.UTC(2026, 1, 30) viraria 2 de março sem esta checagem)",
    () => {
      expect(() => parseDataCivil("2026-02-30")).toThrow(/não corresponde a um dia real/);
    }
  );

  it("rejeita mês fora do intervalo 01-12", () => {
    expect(() => parseDataCivil("2026-13-01")).toThrow(/não corresponde a um dia real/);
  });
});

describe("formatarDataCivilBR", () => {
  it("formata no padrão brasileiro a partir dos componentes UTC", () => {
    const data = parseDataCivil("2026-08-05");
    expect(formatarDataCivilBR(data)).toBe("05/08/2026");
  });

  it(
    "não desloca de dia para uma data ancorada em meia-noite UTC — o cenário exato do " +
      "bug de \"vencimento aparece um dia antes\" que a dupla parseDataCivil/formatarDataCivilBR evita",
    () => {
      const primeiroDeJaneiro = parseDataCivil("2026-01-01");
      expect(formatarDataCivilBR(primeiroDeJaneiro)).toBe("01/01/2026");

      const ultimoDeDezembro = parseDataCivil("2026-12-31");
      expect(formatarDataCivilBR(ultimoDeDezembro)).toBe("31/12/2026");
    }
  );
});
