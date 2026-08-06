import { describe, it, expect } from "vitest";
import { montarPromptSistema } from "../../src/modules/whatsapp/prompt";

const BASE = {
  personaNome: "Ana",
  personaPapel: "atendente da Loja X",
  regras: ["Seja breve.", "Não invente preço."],
  faq: "",
};

describe("montarPromptSistema", () => {
  it("usa a persona e numera as regras", () => {
    const prompt = montarPromptSistema(BASE);
    expect(prompt).toContain("Você é Ana, atendente da Loja X.");
    expect(prompt).toContain("1. Seja breve.");
    expect(prompt).toContain("2. Não invente preço.");
  });

  it("inclui a FAQ sob cabeçalho próprio quando há conteúdo", () => {
    const prompt = montarPromptSistema({ ...BASE, faq: "Abrimos às 8h." });
    expect(prompt).toContain("Perguntas frequentes");
    expect(prompt).toContain("Abrimos às 8h.");
  });

  // Cabeçalho sem conteúdo é pior que FAQ nenhuma: o modelo lê como
  // instrução truncada e pode inventar o que "deveria" estar ali.
  it("omite o bloco inteiro da FAQ quando ela está vazia", () => {
    expect(montarPromptSistema({ ...BASE, faq: "" })).not.toContain("Perguntas frequentes");
    expect(montarPromptSistema({ ...BASE, faq: "   \n  " })).not.toContain("Perguntas frequentes");
  });

  // A razão de a função ser pura, registrada como teste e não só como
  // comentário: provedores cacheiam o prefixo do prompt byte-a-byte.
  it("é determinística — mesma config, mesmos bytes", () => {
    expect(montarPromptSistema(BASE)).toBe(montarPromptSistema(BASE));
  });

  // Regressão distinta da de determinismo acima, não redundante com ela: o
  // teste de determinismo só pega valor que muda ENTRE chamadas (ex.:
  // `new Date().toISOString()` dentro da função). Uma data FIXA — escrita
  // por engano na persona ou numa regra, o clássico "promoção válida até
  // 06/08/2026" colado sem querer — produz bytes idênticos nas duas
  // chamadas, passa no teste de determinismo, e envenenaria todo
  // atendimento com informação vencida sem ninguém perceber. Esta guarda
  // por regex é o que pega esse caso.
  //
  // Aplicada só a `BASE` (cujo `faq` é ""), não a uma config com FAQ
  // preenchida: a FAQ é texto livre editável pelo cliente e PODE
  // legitimamente conter uma data ("atendemos até 24/12") — aplicar a
  // mesma guarda a esse conteúdo criaria falso positivo para um uso válido.
  // O que este teste protege é a persona/papel/regras e o esqueleto que o
  // próprio código gera (numeração, cabeçalhos) — nunca texto livre vindo
  // da config.
  it("não introduz nenhum padrão de data reconhecível na persona/regras/esqueleto do prompt", () => {
    const prompt = montarPromptSistema(BASE);
    expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}/); // ISO date
    expect(prompt).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{2,4}/); // DD/MM/AAAA
  });
});
