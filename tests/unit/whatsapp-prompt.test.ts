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
});
