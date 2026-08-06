import { describe, it, expect } from "vitest";

import { montarPromptSistema } from "../../src/modules/whatsapp/prompt";
import { botConfig } from "../../config/bot";

describe("montarPromptSistema", () => {
  it("é determinístico: duas chamadas seguidas produzem exatamente o mesmo texto", () => {
    // Prova direta do requisito do plano ("qualquer new Date() acima do
    // ponto de cache triplica a conta em silêncio") — nenhuma diferença
    // byte-a-byte entre chamadas, mesmo com uma pausa real entre elas.
    const primeira = montarPromptSistema();
    const segunda = montarPromptSistema();
    expect(segunda).toBe(primeira);
  });

  it("não contém nenhum timestamp/data reconhecível (guarda contra regressão futura)", () => {
    const prompt = montarPromptSistema();
    expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}/); // ISO date
    expect(prompt).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{2,4}/); // DD/MM/AAAA
  });

  it("inclui o nome e o papel da persona configurados em config/bot.ts", () => {
    const prompt = montarPromptSistema();
    expect(prompt).toContain(botConfig.persona.nome);
    expect(prompt).toContain(botConfig.persona.papel);
  });

  it("inclui todas as regras configuradas, numeradas", () => {
    const prompt = montarPromptSistema();
    botConfig.regras.forEach((regra, indice) => {
      expect(prompt).toContain(`${indice + 1}. ${regra}`);
    });
  });
});
