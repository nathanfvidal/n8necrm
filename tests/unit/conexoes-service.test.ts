import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

const registrarAuditoriaMock = vi.fn();
vi.mock("@/core/audit/log", () => ({
  registrarAuditoria: (...a: unknown[]) => registrarAuditoriaMock(...a),
}));

/**
 * Banco falso: guarda linhas num array e implementa só o que o serviço usa —
 * mesmo espírito do banco falso de `tests/unit/escopo-empresa.test.ts`. O que
 * está sob teste aqui é a LÓGICA do serviço; o isolamento por empresa contra
 * Postgres real é `tests/unit/conexoes-isolamento.test.ts`, à parte, porque
 * são duas afirmações diferentes e uma não substitui a outra.
 *
 * O falso INJETA `companyId` no `where` e no `data`, que é exatamente o
 * contrato de `prismaDaEmpresa` — sem isso o teste estaria exercitando um
 * serviço que roda sem escopo nenhum.
 */
type Linha = Record<string, unknown>;
const linhas: Linha[] = [];

function casa(linha: Linha, where: Linha): boolean {
  return Object.entries(where).every(([chave, valor]) => linha[chave] === valor);
}

/**
 * `ativa: true` ANTES do spread de `data`, e isto não é detalhe de conforto: a
 * coluna tem `@default(true)` em `prisma/schema.prisma` (linha 616), então o
 * Postgres a preenche sozinho e `criarConexao` não a envia. Um falso que não
 * emulasse o default deixaria `ativa` `undefined`, e aí `findFirst({ where: {
 * ativa: true } })` — o filtro que `resolverConexaoPorWebhook` usa — nunca
 * acharia a linha recém-criada. O teste ficaria vermelho por defeito do falso,
 * não do serviço. Vem antes do spread para que um `data.ativa` explícito ainda
 * ganhe, que é o que o Postgres faz.
 */
vi.mock("@/core/tenancy/escopo", () => ({
  prismaDaEmpresa: (companyId: string) => ({
    whatsappConnection: {
      findMany: async (a: { where?: Linha } = {}) =>
        linhas
          .filter((l) => casa(l, { ...(a.where ?? {}), companyId }))
          .map((l) => ({ ...l, segredoAtualizadoPor: null })),
      findFirst: async (a: { where?: Linha } = {}) =>
        linhas.find((l) => casa(l, { ...(a.where ?? {}), companyId })) ?? null,
      create: async (a: { data: Linha }) => {
        const linha = { id: `conn_${linhas.length + 1}`, ativa: true, ...a.data, companyId };
        linhas.push(linha);
        return linha;
      },
      updateMany: async (a: { where?: Linha; data: Linha }) => {
        const alvos = linhas.filter((l) => casa(l, { ...(a.where ?? {}), companyId }));
        for (const alvo of alvos) Object.assign(alvo, a.data);
        return { count: alvos.length };
      },
      deleteMany: async (a: { where?: Linha } = {}) => {
        const antes = linhas.length;
        for (let i = linhas.length - 1; i >= 0; i -= 1) {
          if (casa(linhas[i]!, { ...(a.where ?? {}), companyId })) linhas.splice(i, 1);
        }
        return { count: antes - linhas.length };
      },
    },
  }),
}));

import {
  listarConexoes,
  criarConexao,
  substituirSegredo,
  atualizarConexao,
  definirAtiva,
  regenerarWebhookToken,
  apagarConexao,
  ConexaoInvalidaError,
} from "../../src/core/conexoes/service";
import {
  resolverConexaoPorWebhook,
  credencialDaConexao,
  credencialAtivaUnica,
  ConexaoNaoConfiguradaError,
  ConexaoAmbiguaError,
} from "../../src/core/conexoes/leitura";

const EMPRESA_A = "cmp_a";
const AUTOR = "usr_1";
const APIKEY = "apikey-da-evolution-1a2b";

const original = process.env.COFRE_CHAVE_MESTRA;

beforeEach(() => {
  process.env.COFRE_CHAVE_MESTRA = Buffer.alloc(32, 1).toString("base64");
  linhas.length = 0;
  registrarAuditoriaMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  if (original === undefined) delete process.env.COFRE_CHAVE_MESTRA;
  else process.env.COFRE_CHAVE_MESTRA = original;
});

function criarPadrao() {
  return criarConexao(
    EMPRESA_A,
    {
      canal: "EVOLUTION",
      nome: "Comercial",
      dominio: "https://evo.exemplo.com",
      instancia: "inst-1",
      segredo: APIKEY,
    },
    AUTOR
  );
}

describe("criar conexão", () => {
  it("grava o segredo CIFRADO — a coluna não contém a apikey", async () => {
    await criarPadrao();
    expect(String(linhas[0]!.segredoCifrado)).not.toContain(APIKEY);
    expect(String(linhas[0]!.segredoCifrado)).toMatch(/^v1\./);
  });

  it("grava só os últimos 4 caracteres em claro, para a máscara", async () => {
    await criarPadrao();
    expect(linhas[0]!.segredoUltimos4).toBe("1a2b");
  });

  it("grava o HASH do token do webhook, nunca o token", async () => {
    const { webhookToken } = await criarPadrao();
    expect(linhas[0]!.webhookTokenHash).not.toBe(webhookToken);
    expect(String(linhas[0]!.webhookTokenHash)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("devolve o token do webhook UMA vez, e ele nunca volta por uma leitura", async () => {
    const { webhookToken } = await criarPadrao();
    expect(webhookToken).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(await listarConexoes(EMPRESA_A))).not.toContain(webhookToken);
  });

  it("normaliza a barra final do domínio na GRAVAÇÃO", async () => {
    // O adapter já faz `replace(/\/$/, "")` no envio; normalizar aqui evita
    // que a tela mostre uma coisa e o gateway use outra.
    await criarConexao(
      EMPRESA_A,
      {
        canal: "EVOLUTION",
        nome: "X",
        dominio: "https://evo.exemplo.com/",
        instancia: "i",
        segredo: APIKEY,
      },
      AUTOR
    );
    expect(linhas[0]!.dominio).toBe("https://evo.exemplo.com");
  });

  it("recusa `META_CLOUD` com erro nomeado — Ciclo 2b, não este", async () => {
    await expect(
      criarConexao(
        EMPRESA_A,
        { canal: "META_CLOUD", nome: "Meta", dominio: null, instancia: null, segredo: APIKEY },
        AUTOR
      )
    ).rejects.toThrow(ConexaoInvalidaError);
    expect(linhas).toHaveLength(0);
  });

  it("recusa segredo curto demais para ter máscara", async () => {
    await expect(
      criarConexao(
        EMPRESA_A,
        { canal: "EVOLUTION", nome: "X", dominio: "https://e.com", instancia: "i", segredo: "abc" },
        AUTOR
      )
    ).rejects.toThrow(ConexaoInvalidaError);
  });

  it("recusa domínio que não é URL, e instância vazia", async () => {
    for (const parcial of [
      { dominio: "evo.exemplo.com", instancia: "i" },
      { dominio: "https://evo.exemplo.com", instancia: "  " },
    ]) {
      await expect(
        criarConexao(
          EMPRESA_A,
          { canal: "EVOLUTION", nome: "X", segredo: APIKEY, ...parcial },
          AUTOR
        )
      ).rejects.toThrow(ConexaoInvalidaError);
    }
  });
});

describe("listar conexões", () => {
  it("NÃO devolve nenhuma chave que carregue segredo", async () => {
    await criarPadrao();
    const conexoes = await listarConexoes(EMPRESA_A);
    const serializado = JSON.stringify(conexoes);

    // Varredura por NOME de chave E por CONTEÚDO. Só uma das duas deixaria
    // passar o caso oposto: uma chave renomeada com o blob dentro, ou uma
    // chave certa com o valor errado.
    //
    // A metade dos NOMES é uma LISTA FECHADA, e não uma busca por substrings
    // proibidas. A primeira versão deste caso procurava `"segredo"` solto no
    // JSON e reprovava `segredoAtualizadoEm`/`segredoAtualizadoPor` — dois
    // campos que carregam uma data e o nome de uma pessoa, e nenhum segredo.
    // Afrouxar a busca (procurar `segredoCifrado` só, e desistir do resto)
    // teria deixado de cobrir o caso que interessa: um campo NOVO que entre no
    // tipo sem ninguém decidir. A lista fechada cobre os dois — nada sai daqui
    // sem estar escrito nesta linha, inclusive o que ainda não existe.
    for (const conexao of conexoes) {
      expect(Object.keys(conexao).sort()).toEqual([
        "ativa",
        "canal",
        "dominio",
        "id",
        "instancia",
        "mascara",
        "nome",
        "segredoAtualizadoEm",
        "segredoAtualizadoPor",
      ]);
    }

    // E a metade do CONTEÚDO, sobre o objeto inteiro serializado — não sobre
    // campos que alguém lembrou de conferir.
    for (const chave of ["segredoCifrado", "webhookTokenHash", "apiKey"]) {
      expect(serializado).not.toContain(chave);
    }
    expect(serializado).not.toContain(APIKEY);
    expect(serializado).not.toContain("v1.");
  });

  it("devolve a máscara PRONTA, montada no servidor", async () => {
    await criarPadrao();
    const [conexao] = await listarConexoes(EMPRESA_A);
    // O cliente nunca deriva máscara de valor real: ela chega pronta, e os 4
    // caracteres vêm da coluna própria — nada foi decifrado para renderizar.
    expect(conexao!.mascara).toBe("••••••••1a2b");
  });
});

describe("substituir segredo", () => {
  it("troca o cifrado e a máscara, e MANTÉM o token do webhook", async () => {
    await criarPadrao();
    const hashAntes = linhas[0]!.webhookTokenHash;
    const cifradoAntes = linhas[0]!.segredoCifrado;

    await substituirSegredo(EMPRESA_A, String(linhas[0]!.id), "apikey-nova-9z8y", AUTOR);

    expect(linhas[0]!.segredoCifrado).not.toBe(cifradoAntes);
    expect(linhas[0]!.segredoUltimos4).toBe("9z8y");
    // Dois segredos, dois ciclos de vida. Invalidar os dois juntos obrigaria
    // a recolar a URL no painel da Evolution a cada rotação de chave, e o
    // custo dessa fricção é gente deixando de rotacionar.
    expect(linhas[0]!.webhookTokenHash).toBe(hashAntes);
  });

  it("conexão de outra empresa é `ConexaoInvalidaError`, não erro de banco", async () => {
    await criarPadrao();
    await expect(substituirSegredo("cmp_b", String(linhas[0]!.id), APIKEY, AUTOR)).rejects.toThrow(
      ConexaoInvalidaError
    );
  });
});

describe("regenerar o token do webhook", () => {
  it("troca o hash e devolve o token novo uma vez", async () => {
    await criarPadrao();
    const hashAntes = linhas[0]!.webhookTokenHash;
    const { webhookToken } = await regenerarWebhookToken(EMPRESA_A, String(linhas[0]!.id), AUTOR);
    expect(linhas[0]!.webhookTokenHash).not.toBe(hashAntes);
    expect(webhookToken).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("atualizar campos não secretos", () => {
  it("muda nome, domínio e instância sem tocar no segredo", async () => {
    await criarPadrao();
    const cifradoAntes = linhas[0]!.segredoCifrado;
    await atualizarConexao(
      EMPRESA_A,
      String(linhas[0]!.id),
      { nome: "Comercial 2", dominio: "https://evo2.exemplo.com", instancia: "inst-9" },
      AUTOR
    );
    expect(linhas[0]!.nome).toBe("Comercial 2");
    expect(linhas[0]!.instancia).toBe("inst-9");
    expect(linhas[0]!.segredoCifrado).toBe(cifradoAntes);
  });
});

describe("apagar", () => {
  it("apaga a linha da própria empresa", async () => {
    await criarPadrao();
    await apagarConexao(EMPRESA_A, String(linhas[0]!.id), AUTOR);
    expect(linhas).toHaveLength(0);
  });

  it("apagar conexão de outra empresa é recusado e NÃO apaga nada", async () => {
    await criarPadrao();
    await expect(apagarConexao("cmp_b", String(linhas[0]!.id), AUTOR)).rejects.toThrow(
      ConexaoInvalidaError
    );
    expect(linhas).toHaveLength(1);
  });
});

describe("leitura para o webhook e para o envio", () => {
  it("resolve a conexão pelo token e devolve a apikey DECIFRADA", async () => {
    const { webhookToken } = await criarPadrao();
    const cred = await resolverConexaoPorWebhook(EMPRESA_A, webhookToken);
    expect(cred?.apiKey).toBe(APIKEY);
    expect(cred?.instancia).toBe("inst-1");
  });

  it("token certo na empresa ERRADA devolve null", async () => {
    const { webhookToken } = await criarPadrao();
    expect(await resolverConexaoPorWebhook("cmp_b", webhookToken)).toBeNull();
  });

  it("token errado devolve null", async () => {
    await criarPadrao();
    expect(await resolverConexaoPorWebhook(EMPRESA_A, "f".repeat(64))).toBeNull();
  });

  it("conexão INATIVA não resolve o webhook — desativar cala a entrada também", async () => {
    const { webhookToken } = await criarPadrao();
    await definirAtiva(EMPRESA_A, String(linhas[0]!.id), false, AUTOR);
    expect(await resolverConexaoPorWebhook(EMPRESA_A, webhookToken)).toBeNull();
  });

  it("empresa sem conexão ativa lança `ConexaoNaoConfiguradaError` — nunca fallback", async () => {
    await expect(credencialAtivaUnica(EMPRESA_A, "a conversa cnv_9")).rejects.toThrow(
      ConexaoNaoConfiguradaError
    );
  });

  it("DUAS conexões ativas lançam `ConexaoAmbiguaError` com o contexto na mensagem", async () => {
    await criarPadrao();
    await criarConexao(
      EMPRESA_A,
      {
        canal: "EVOLUTION",
        nome: "Suporte",
        dominio: "https://evo.exemplo.com",
        instancia: "inst-2",
        segredo: APIKEY,
      },
      AUTOR
    );
    // Escolher "a primeira" seria escolher em silêncio — o mesmo vazamento que
    // `Company.findFirst()` produz e que a regra do programa proíbe. Responder
    // pelo número errado é pior que não responder.
    await expect(credencialAtivaUnica(EMPRESA_A, "a conversa cnv_9")).rejects.toThrow(/cnv_9/);
    await expect(credencialAtivaUnica(EMPRESA_A, "a conversa cnv_9")).rejects.toThrow(
      ConexaoAmbiguaError
    );
  });

  it("`credencialDaConexao` de id inexistente lança `ConexaoNaoConfiguradaError`", async () => {
    await expect(credencialDaConexao(EMPRESA_A, "conn_inexistente")).rejects.toThrow(
      ConexaoNaoConfiguradaError
    );
  });
});
