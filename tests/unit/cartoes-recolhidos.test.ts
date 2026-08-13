// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import {
  alternarCartao,
  estaRecolhido,
  inscrever,
  snapshotDoServidor,
  useCartaoRecolhido,
} from "@/components/leads/cartoes-recolhidos";

// A chave é escrita à mão, e não importada do módulo, DE PROPÓSITO: ela é
// contrato com o armazenamento de todo mundo que já usou o sistema. Renomear
// a constante não quebraria nada em compilação e faria cada usuário perder as
// preferências em silêncio — este literal é o que torna a renomeação visível.
const CHAVE = "crm:kanban:cartoes-recolhidos";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("cartões recolhidos", () => {
  it("sem preferência gravada, o cartão vem expandido", () => {
    expect(estaRecolhido("lead-1")).toBe(false);
  });

  it("alterna recolher e expandir", () => {
    alternarCartao("lead-1");
    expect(estaRecolhido("lead-1")).toBe(true);

    alternarCartao("lead-1");
    expect(estaRecolhido("lead-1")).toBe(false);
  });

  it("guarda a preferência sob a chave esperada, como lista de ids", () => {
    alternarCartao("lead-1");
    expect(window.localStorage.getItem(CHAVE)).toBe(JSON.stringify(["lead-1"]));
  });

  it("a preferência é por cartão, não do quadro inteiro", () => {
    alternarCartao("lead-1");
    expect(estaRecolhido("lead-1")).toBe(true);
    expect(estaRecolhido("lead-2")).toBe(false);
  });

  // Sabotagem obrigatória 1: devolver o `Set` (ou qualquer objeto novo) em vez
  // do booleano. O React compara o retorno de `getSnapshot` com `Object.is` —
  // objeto novo a cada chamada é sempre "diferente", e o quadro entra em
  // re-render infinito ("The result of getSnapshot should be cached").
  it("responde com booleano, nunca com a coleção", () => {
    alternarCartao("lead-1");
    expect(typeof estaRecolhido("lead-1")).toBe("boolean");
    // Duas leituras seguidas precisam ser idênticas por `Object.is`, que é
    // exatamente a comparação que o React faz.
    expect(Object.is(estaRecolhido("lead-1"), estaRecolhido("lead-1"))).toBe(true);
  });

  // Sabotagem obrigatória 2: devolver o snapshot do cliente aqui. No servidor
  // não existe `localStorage`; qualquer valor derivado dele divergiria da
  // hidratação, e o React não conserta atributo divergente — congela. Um
  // cartão recolhido ficaria expandido para sempre, com `aria-expanded`
  // mentindo. O espião é o que prova que a função nem CONSULTA o
  // armazenamento — sem ele, devolver `false` por acaso passaria.
  it("o snapshot do servidor é falso e não consulta o armazenamento", () => {
    window.localStorage.setItem(CHAVE, JSON.stringify(["lead-1"]));
    const espiao = vi.spyOn(Storage.prototype, "getItem");

    expect(snapshotDoServidor()).toBe(false);
    expect(espiao).not.toHaveBeenCalled();
  });

  // Sabotagem obrigatória 3: tirar o try/catch de `analisar`. JSON quebrado no
  // armazenamento vira exceção durante o render de um Client Component — o
  // funil inteiro cai por causa de uma preferência de exibição.
  it("valor corrompido no armazenamento não derruba o quadro", () => {
    window.localStorage.setItem(CHAVE, "{isto nao e json");
    expect(estaRecolhido("lead-1")).toBe(false);
  });

  // Mesma queda, por outro caminho: `new Set(objeto)` lança "is not iterable".
  // Só o try/catch não basta aqui — a guarda é o `Array.isArray`.
  it("JSON válido mas do tipo errado também não derruba", () => {
    window.localStorage.setItem(CHAVE, JSON.stringify({ "lead-1": true }));
    expect(estaRecolhido("lead-1")).toBe(false);
  });

  // A primeira versão deste teste só lia (`estaRecolhido("lead-1")` continua
  // verdadeiro com ou sem o filtro, porque `has` compara por identidade e uma
  // string nunca casa com um número). Passava com o filtro REMOVIDO — teste
  // que não exercita o que o nome promete. O que o filtro de fato garante é a
  // ESCRITA: sem ele, o lixo que veio do armazenamento é regravado a cada
  // clique e se acumula para sempre.
  it("não devolve ao armazenamento o que não sabe ler", () => {
    window.localStorage.setItem(CHAVE, JSON.stringify(["lead-1", 42, null, { id: "x" }]));

    alternarCartao("lead-2");

    expect(window.localStorage.getItem(CHAVE)).toBe(JSON.stringify(["lead-1", "lead-2"]));
    expect(estaRecolhido("lead-1")).toBe(true);
  });

  it("armazenamento que recusa a escrita não derruba a interface", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => alternarCartao("lead-1")).not.toThrow();
    // Degradação honesta e testada: a preferência não gruda, porque não existe
    // reserva em memória. O que não pode acontecer é o quadro cair.
    expect(estaRecolhido("lead-1")).toBe(false);
  });

  it("armazenamento que recusa a leitura devolve expandido", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(estaRecolhido("lead-1")).toBe(false);
  });
});

describe("inscrição", () => {
  it("avisa os inscritos quando outra aba muda a preferência", () => {
    const ouvinte = vi.fn();
    const cancelar = inscrever(ouvinte);

    // jsdom não dispara `storage` para escrita da própria janela — é assim no
    // navegador também. O `setItem` aqui faz o papel da outra aba, e o evento
    // é o que o navegador entregaria a esta.
    window.localStorage.setItem(CHAVE, JSON.stringify(["lead-1"]));
    window.dispatchEvent(new StorageEvent("storage", { key: CHAVE }));

    expect(ouvinte).toHaveBeenCalledTimes(1);
    expect(estaRecolhido("lead-1")).toBe(true);
    cancelar();
  });

  it("ignora mudança em outra chave do mesmo domínio", () => {
    const ouvinte = vi.fn();
    const cancelar = inscrever(ouvinte);

    window.dispatchEvent(new StorageEvent("storage", { key: "theme" }));

    expect(ouvinte).not.toHaveBeenCalled();
    cancelar();
  });

  it("cancelar solta o ouvinte", () => {
    const ouvinte = vi.fn();
    const cancelar = inscrever(ouvinte);

    alternarCartao("lead-1");
    expect(ouvinte).toHaveBeenCalledTimes(1);

    cancelar();
    alternarCartao("lead-1");
    expect(ouvinte).toHaveBeenCalledTimes(1);
  });
});

describe("useCartaoRecolhido", () => {
  it("reflete a alternância sem que o componente conheça o armazenamento", () => {
    const { result } = renderHook(() => useCartaoRecolhido("lead-1"));
    expect(result.current).toBe(false);

    act(() => alternarCartao("lead-1"));
    expect(result.current).toBe(true);

    act(() => alternarCartao("lead-1"));
    expect(result.current).toBe(false);
  });

  it("alternar um cartão não re-renderiza o outro com valor errado", () => {
    const primeiro = renderHook(() => useCartaoRecolhido("lead-1"));
    const segundo = renderHook(() => useCartaoRecolhido("lead-2"));

    act(() => alternarCartao("lead-1"));

    expect(primeiro.result.current).toBe(true);
    expect(segundo.result.current).toBe(false);
  });

  it("lê a preferência já no primeiro render, sem piscar expandido", () => {
    window.localStorage.setItem(CHAVE, JSON.stringify(["lead-1"]));

    const { result } = renderHook(() => useCartaoRecolhido("lead-1"));

    expect(result.current).toBe(true);
  });
});
