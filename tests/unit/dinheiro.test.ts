import { describe, it, expect } from "vitest";

import {
  parseValorBR,
  formatarValorBR,
  mascararValorBR,
  VALOR_MAXIMO_BR,
} from "../../src/lib/dinheiro";

describe("parseValorBR", () => {
  it("aceita o formato brasileiro completo", () => {
    expect(parseValorBR("1.500,50").toString()).toBe("1500.5");
  });

  it("aceita valor sem separador de milhar", () => {
    expect(parseValorBR("1500,50").toString()).toBe("1500.5");
  });

  it("aceita inteiro sem decimais", () => {
    expect(parseValorBR("1500").toString()).toBe("1500");
  });

  // O caso que dá o bug silencioso: parseFloat("1.500") devolve 1.5.
  it("trata ponto como MILHAR, nunca como decimal", () => {
    expect(parseValorBR("1.500").toString()).toBe("1500");
    expect(parseValorBR("1.500.000").toString()).toBe("1500000");
  });

  // Ambíguo entre 1,5 e 15 — recusar é a única resposta honesta.
  it("recusa ponto que não forma grupo de milhar", () => {
    expect(() => parseValorBR("1.5")).toThrow(/Valor inválido/);
    expect(() => parseValorBR("1.50")).toThrow(/Valor inválido/);
    expect(() => parseValorBR("12.34")).toThrow(/Valor inválido/);
  });

  it("recusa mais de duas casas decimais", () => {
    expect(() => parseValorBR("10,123")).toThrow(/Valor inválido/);
  });

  it("recusa texto que não é número", () => {
    expect(() => parseValorBR("mil e quinhentos")).toThrow(/Valor inválido/);
    expect(() => parseValorBR("")).toThrow(/Valor inválido/);
    expect(() => parseValorBR("-100")).toThrow(/Valor inválido/);
  });

  // Achado da auditoria de segurança: Server Action é endpoint HTTP público
  // e nada limitava o tamanho da string. 400 mil dígitos entravam e viravam
  // Decimal em 2ms — quem recusava era o Postgres, no fim da pilha.
  it("recusa entrada longa demais ANTES de qualquer processamento", () => {
    expect(() => parseValorBR("9".repeat(1000))).toThrow(/muito longo/);
  });

  // O teto não pode cortar valor legítimo: 999.999.999.999,99 é o maior que
  // `Decimal(14,2)` aceita, e tem 18 caracteres com separadores.
  it("aceita o maior valor que a coluna comporta", () => {
    expect(parseValorBR("999.999.999.999,99").toString()).toBe("999999999999.99");
  });

  // ─── Teto de VALOR (achado 20 da Fase 1) ────────────────────────────────
  //
  // `TAMANHO_MAX` cobria tipo e mínimo, não máximo: 25 dígitos passam nos 32
  // caracteres e casam com `PADRAO_BR`. Quem recusava era o `Decimal(14,2)` do
  // Postgres, três camadas adiante — mensagem genérica para quem digitou e um
  // erro "inesperado" no Sentry que era, na verdade, entrada de formulário.
  it("recusa valor acima do que Decimal(14,2) comporta, e DIZ o limite", () => {
    expect(() => parseValorBR("9".repeat(25))).toThrow(/Valor inválido/);
    // A mensagem precisa carregar o limite: sem ele a pessoa fica adivinhando
    // quantos dígitos sobram.
    expect(() => parseValorBR("9".repeat(25))).toThrow(VALOR_MAXIMO_BR);
  });

  // O par que trava o número: o maior aceito e o primeiro recusado ficam a um
  // dígito de distância. Se `Lead.valorEstimado` mudar de precisão sem esta
  // constante mudar junto, um dos dois casos fica vermelho.
  it("o limite é o 12º dígito inteiro — 13 é recusado, 12 passa", () => {
    expect(parseValorBR("999999999999,99").toString()).toBe("999999999999.99");
    expect(() => parseValorBR("1000000000000")).toThrow(/Valor inválido/);
    expect(() => parseValorBR("1.000.000.000.000,00")).toThrow(/Valor inválido/);
  });

  // Zeros à esquerda não contam. `mascararValorBR` produz esta forma quando
  // alguém digita os centavos primeiro, e recusá-la seria recusar R$ 0,01.
  it("zeros à esquerda não consomem o teto", () => {
    expect(parseValorBR("0000000000000001,00").toString()).toBe("1");
    expect(parseValorBR("0,01").toString()).toBe("0.01");
  });

  // A prova de que a recusa CHEGA à tela em vez de virar "Falha ao salvar o
  // lead": `MENSAGENS_SEGURAS` em `core/leads/actions.ts` reconhece a família
  // por este prefixo exato. Trocar o texto da mensagem sem trocar o prefixo
  // deixa o repasse funcionando; trocar o prefixo o quebra em silêncio.
  it("a mensagem começa com o prefixo que `actions.ts` repassa para a tela", () => {
    expect(() => parseValorBR("9".repeat(25))).toThrow(/^Valor inválido:/);
  });
});

describe("mascararValorBR", () => {
  // Os algarismos são CENTAVOS: "15050" são 15.050 centavos = R$ 150,50.
  it("monta o valor pela direita, como caixa de banco", () => {
    expect(mascararValorBR("15050")).toBe("150,50");
    expect(mascararValorBR("150050")).toBe("1.500,50");
    expect(mascararValorBR("15000000")).toBe("150.000,00");
    expect(mascararValorBR("150000000")).toBe("1.500.000,00");
  });

  it("preenche centavos quando há poucos dígitos", () => {
    expect(mascararValorBR("5")).toBe("0,05");
    expect(mascararValorBR("")).toBe("");
  });

  it("ignora tudo que não é algarismo", () => {
    expect(mascararValorBR("R$ 1.500,50")).toBe("1.500,50");
  });

  // Achado da auditoria: a versão anterior usava
  // `replace(/\B(?=(\d{3})+(?!\d))/g, ".")`, que é QUADRÁTICA — medido
  // 5k→16ms, 20k→317ms, 60k→2.560ms. Com 200 mil dígitos passaria de meio
  // minuto; a implementação linear resolve em milissegundos.
  //
  // O limite de 2s é o guarda: se alguém reintroduzir a expressão regular de
  // lookahead, este teste estoura em vez de a lentidão passar despercebida.
  it("separa milhar em tempo linear, não quadrático", { timeout: 2000 }, () => {
    const digitos = "9".repeat(200_000);
    const saida = mascararValorBR(digitos);

    // 199.998 dígitos inteiros → 66.666 pontos; mais a vírgula e 2 centavos.
    expect(saida.endsWith(",99")).toBe(true);
    expect((saida.match(/\./g) ?? []).length).toBe(66_665);
  });
});

describe("formatarValorBR", () => {
  it("devolve string vazia para valor ausente", () => {
    expect(formatarValorBR(null)).toBe("");
  });

  it("formata com duas casas e separador de milhar", () => {
    expect(formatarValorBR("1500.5")).toBe("1.500,50");
  });

  // Prova a ida e volta: o que a máscara mostra, o parse aceita.
  it("o que mascararValorBR produz, parseValorBR aceita", () => {
    const mascarado = mascararValorBR("150000000");
    expect(parseValorBR(mascarado).toString()).toBe("1500000");
  });
});
