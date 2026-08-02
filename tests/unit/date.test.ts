// Sem Prisma, sem `server-only`, sem `dotenv/config` — `src/lib/date.ts` é
// função pura, exatamente para poder ser testada isolada de qualquer
// infraestrutura. Estes testes forçam `timeZone: "UTC"` na formatação (ver
// comentário em date.ts) para provar que o resultado NÃO depende do fuso
// horário da máquina que roda o teste (dev local, CI, etc.) — a máquina
// pode estar em qualquer fuso, o resultado tem que ser sempre o mesmo dia
// civil que foi digitado.
import { describe, it, expect } from "vitest";
import {
  parseDataCivil,
  formatarDataCivilBR,
  formatarDataBR,
  formatarDataHoraBR,
  dataISOEmSaoPaulo,
} from "../../src/lib/date";

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

// Diferente do bloco acima: estes três helpers formatam um TIMESTAMP (um
// INSTANTE — `Lead.criadoEm` e afins), sempre no fuso "America/Sao_Paulo"
// fixo, nunca em UTC nem no fuso do processo que roda o teste — ver o
// comentário grande em src/lib/date.ts explicando por que as duas famílias
// (data civil vs. timestamp) não podem compartilhar a mesma âncora.
describe("formatarDataBR / formatarDataHoraBR / dataISOEmSaoPaulo (timestamps, fuso São Paulo)", () => {
  // 2026-08-05T02:00:00.000Z é 04/08/2026 23:00 em São Paulo (UTC-3) — um
  // instante que cai em dias civis DIFERENTES em UTC (05/08) e em São Paulo
  // (04/08). Este é o instante exato da classe de bug fechada aqui: antes,
  // `leads/page.tsx` exibia `criadoEm` com `toLocaleDateString("pt-BR")`
  // sem fuso (dependia do fuso do processo Node) mas calculava
  // `criadoEmISO` com `toISOString().slice(0, 10)` (sempre UTC) — os dois
  // podiam divergir de dia nesta janela de ~3h ao redor da meia-noite em
  // São Paulo, e `lead-table.tsx` filtra comparando `criadoEmISO` como
  // string. Rotular a linha "04/08" e o filtro não achar essa mesma linha
  // ao digitar "04/08" é exatamente essa divergência.
  const instanteProximoDaMeiaNoiteSP = new Date("2026-08-05T02:00:00.000Z");

  it("formatarDataBR usa o dia civil de São Paulo, não o de UTC", () => {
    expect(formatarDataBR(instanteProximoDaMeiaNoiteSP)).toBe("04/08/2026");
  });

  it("formatarDataHoraBR mostra a hora local de São Paulo (23:00), não a hora UTC (02:00)", () => {
    expect(formatarDataHoraBR(instanteProximoDaMeiaNoiteSP)).toBe("04/08/2026 23:00");
  });

  it("dataISOEmSaoPaulo concorda com formatarDataBR para o mesmo instante", () => {
    expect(dataISOEmSaoPaulo(instanteProximoDaMeiaNoiteSP)).toBe("2026-08-04");
  });

  it(
    "o rótulo exibido (formatarDataBR) e a chave usada para filtrar (dataISOEmSaoPaulo) " +
      "sempre concordam no dia — a regressão que este teste existe para pegar: se algum dos " +
      "dois voltar a usar UTC (ou o fuso do processo) enquanto o outro usa São Paulo, esta " +
      "asserção quebra para o instante acima sem precisar rodar a máquina de teste num fuso " +
      "específico",
    () => {
      const diaExibido = formatarDataBR(instanteProximoDaMeiaNoiteSP); // "04/08/2026"
      const [dia, mes, ano] = diaExibido.split("/");
      const diaExibidoComoISO = `${ano}-${mes}-${dia}`;

      expect(dataISOEmSaoPaulo(instanteProximoDaMeiaNoiteSP)).toBe(diaExibidoComoISO);
    }
  );

  it("não muda o comportamento de parseDataCivil/formatarDataCivilBR (data civil continua ancorada em UTC)", () => {
    const vencimento = parseDataCivil("2026-08-05");
    expect(formatarDataCivilBR(vencimento)).toBe("05/08/2026");
  });
});
