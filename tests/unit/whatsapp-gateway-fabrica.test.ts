// A fábrica de gateway POR CONEXÃO — Ciclo 2a, Tarefa 6, fase EXPANDE.
//
// O que este arquivo prende, além do caminho feliz:
//
//   1. o caminho NOVO (credencial vinda do banco, por empresa);
//   2. o caminho ANTIGO (`whatsappGateway`, singleton de `EVOLUTION_*`)
//      CONTINUA funcionando — é a definição de "expande", e sem este caso a
//      tarefa não teria como afirmar que não quebrou nada;
//   3. a apikey decifrada não sai na mensagem de erro quando a Evolution
//      recusa — pendência que a Tarefa 3 (scrub do Sentry) deixou nomeada
//      para quem construísse um caminho novo até a Evolution;
//   4. nada é memoizado, nem por empresa nem por conexão.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

vi.mock("server-only", () => ({}));

const credencialDaConexaoMock = vi.fn();
const credencialAtivaUnicaMock = vi.fn();
vi.mock("@/core/conexoes/leitura", () => ({
  credencialDaConexao: (...a: unknown[]) => credencialDaConexaoMock(...a),
  credencialAtivaUnica: (...a: unknown[]) => credencialAtivaUnicaMock(...a),
}));

import {
  gatewayDaCredencial,
  gatewayDaEmpresa,
  gatewayDaConversa,
  CanalNaoImplementadoError,
  ConexaoIncompletaError,
} from "../../src/modules/whatsapp/gateway/fabrica";
import { EvolutionGateway } from "../../src/modules/whatsapp/gateway/evolution";
import { whatsappGateway } from "../../src/modules/whatsapp/gateway/index";

const CRED = {
  id: "conn_1",
  companyId: "cmp_a",
  canal: "EVOLUTION" as const,
  dominio: "https://evo.exemplo.com",
  instancia: "inst-1",
  apiKey: "apikey-da-evolution-1a2b",
};

beforeEach(() => {
  credencialDaConexaoMock.mockReset();
  credencialAtivaUnicaMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("gatewayDaCredencial", () => {
  it("constrói um `EvolutionGateway` com os campos da conexão", () => {
    const gateway = gatewayDaCredencial(CRED);
    expect(gateway).toBeInstanceOf(EvolutionGateway);
    // `verificarOrigem` compara o `instance` do payload com o da CONEXÃO — é
    // essa comparação que substitui o antigo `EVOLUTION_INSTANCE` do ambiente.
    expect(gateway.verificarOrigem({ instance: "inst-1" })).toBe(true);
    expect(gateway.verificarOrigem({ instance: "outra-instancia" })).toBe(false);
  });

  it("recusa `META_CLOUD` com `CanalNaoImplementadoError`", () => {
    // O valor existe no enum desde a Tarefa 1 para o Ciclo 2b não precisar de
    // migração. Este ramo existe para que aquele ciclo TROQUE uma recusa por
    // uma implementação, em vez de acrescentar um `else` a um `if` que hoje
    // cairia silenciosamente no Evolution.
    expect(() => gatewayDaCredencial({ ...CRED, canal: "META_CLOUD" })).toThrow(
      CanalNaoImplementadoError
    );
  });

  it("recusa conexão Evolution sem domínio ou sem instância", () => {
    // O serviço valida na escrita (Tarefa 5), mas uma linha editada por SQL à
    // mão chega aqui. Sem esta guarda, `undefined` viraria a string "undefined"
    // dentro da URL de envio e a falha apareceria como HTTP 404 da Evolution.
    for (const parcial of [{ dominio: null }, { instancia: null }]) {
      expect(() => gatewayDaCredencial({ ...CRED, ...parcial })).toThrow(/conn_1/);
    }
  });

  it("linha incompleta NÃO se disfarça de canal não implementado", () => {
    // Os dois são recusas, mas mandam para lugares DIFERENTES: "canal não
    // implementado" manda esperar o Ciclo 2b, "conexão incompleta" manda
    // corrigir a linha em Configurações → Conexões. Fundir os dois numa classe
    // só faria alguém abrir o roadmap por causa de um `dominio` nulo.
    expect(() => gatewayDaCredencial({ ...CRED, dominio: null })).toThrow(ConexaoIncompletaError);
    expect(() => gatewayDaCredencial({ ...CRED, dominio: null })).not.toThrow(
      CanalNaoImplementadoError
    );
    expect(() => gatewayDaCredencial({ ...CRED, canal: "META_CLOUD" })).not.toThrow(
      ConexaoIncompletaError
    );
  });

  it("nenhuma recusa carrega a apikey decifrada na mensagem", () => {
    // As duas mensagens de recusa citam id e canal — e este caso existe para
    // que ninguém acrescente `JSON.stringify(credencial)` numa delas achando
    // que ajuda o diagnóstico. A mensagem vai para o Sentry.
    for (const quebrado of [
      { ...CRED, canal: "META_CLOUD" as const },
      { ...CRED, dominio: null },
      { ...CRED, instancia: null },
    ]) {
      expect(() => gatewayDaCredencial(quebrado)).toThrow();
      try {
        gatewayDaCredencial(quebrado);
      } catch (erro) {
        expect(String((erro as Error).message)).not.toContain(CRED.apiKey);
      }
    }
  });
});

describe("gatewayDaConversa", () => {
  it("usa a conexão que a CONVERSA registra", async () => {
    credencialDaConexaoMock.mockResolvedValue(CRED);
    const gateway = await gatewayDaConversa("cmp_a", { id: "cnv_1", connectionId: "conn_1" });
    expect(credencialDaConexaoMock).toHaveBeenCalledWith("cmp_a", "conn_1");
    expect(credencialAtivaUnicaMock).not.toHaveBeenCalled();
    expect(gateway).toBeInstanceOf(EvolutionGateway);
  });

  it("`connectionId` nulo cai na única ativa, e o CONTEXTO leva o id da conversa", async () => {
    credencialAtivaUnicaMock.mockResolvedValue(CRED);
    await gatewayDaConversa("cmp_a", { id: "cnv_9", connectionId: null });
    expect(credencialDaConexaoMock).not.toHaveBeenCalled();
    // O `conversationId` na mensagem é o que transforma "conexão ambígua" num
    // erro acionável: sem ele, quem lesse o log não saberia qual conversa
    // ficou sem resposta.
    expect(String(credencialAtivaUnicaMock.mock.calls[0]![1])).toContain("cnv_9");
  });

  it("o erro de conexão ambígua sobe INTACTO — a fábrica não escolhe por ninguém", async () => {
    class Ambigua extends Error {}
    credencialAtivaUnicaMock.mockRejectedValue(new Ambigua("duas ativas"));
    await expect(gatewayDaConversa("cmp_a", { id: "cnv_9", connectionId: null })).rejects.toThrow(
      Ambigua
    );
  });

  it("conexão de OUTRA empresa recusa, e NÃO cai na ativa da empresa do parâmetro", async () => {
    // `credencialDaConexao` busca escopada (`prismaDaEmpresa`): um id de outra
    // empresa simplesmente não é encontrado e ele lança. O que este caso trava
    // é a fábrica não ter um `catch` que "resolva" isso caindo na única ativa —
    // isso responderia o cliente pela conexão errada em silêncio, que é o
    // gênero exato de falha que o ciclo inteiro existe para eliminar.
    class NaoConfigurada extends Error {}
    credencialDaConexaoMock.mockRejectedValue(new NaoConfigurada("id de outra empresa"));
    credencialAtivaUnicaMock.mockResolvedValue(CRED);

    await expect(
      gatewayDaConversa("cmp_b", { id: "cnv_1", connectionId: "conn_de_cmp_a" })
    ).rejects.toThrow(NaoConfigurada);
    expect(credencialAtivaUnicaMock).not.toHaveBeenCalled();
  });

  it("conexão DESATIVADA sem `connectionId` recusa — nunca vira 'a primeira ativa'", async () => {
    // Desativar em Configurações tira a conexão do conjunto de
    // `credencialAtivaUnica` (`ativa: true` no filtro, Tarefa 5). Com a única
    // conexão da empresa desativada, o resultado é a recusa NOMEADA subindo,
    // não um envio por outra credencial.
    class NaoConfigurada extends Error {}
    credencialAtivaUnicaMock.mockRejectedValue(new NaoConfigurada("nenhuma ativa"));
    await expect(
      gatewayDaConversa("cmp_a", { id: "cnv_9", connectionId: null })
    ).rejects.toThrow(NaoConfigurada);
  });
});

describe("gatewayDaEmpresa", () => {
  it("resolve pela única conexão ativa da empresa", async () => {
    credencialAtivaUnicaMock.mockResolvedValue(CRED);
    const gateway = await gatewayDaEmpresa("cmp_a", "um teste");
    expect(credencialAtivaUnicaMock).toHaveBeenCalledWith("cmp_a", "um teste");
    expect(gateway).toBeInstanceOf(EvolutionGateway);
  });
});

describe("a apikey decifrada não vaza quando a Evolution recusa", () => {
  it("o corpo de erro que ECOA a apikey sai redigido do gateway da fábrica", async () => {
    // A Tarefa 3 (scrub do Sentry) registrou explicitamente que `redigirApiKey`
    // protege o corpo de erro de `enviarTexto` e SÓ ELE, e deixou como
    // pendência garantir que todo caminho novo até a Evolution passe por lá.
    // Este caso é o cumprimento dessa pendência pelo caminho da fábrica: ele
    // não confia no comentário de `evolution.ts`, exercita ponta a ponta.
    //
    // O scrub por FORMA (`src/lib/sentry-scrub.ts`) não alcançaria isto: a
    // apikey da Evolution não tem formato fixo, então só o objeto que a
    // carrega sabe qual string apagar.
    credencialAtivaUnicaMock.mockResolvedValue(CRED);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ erro: "unauthorized", apikey: CRED.apiKey }),
      })
    );

    const gateway = await gatewayDaEmpresa("cmp_a", "um teste de redação");
    await expect(gateway.enviarTexto("5511999998888", "oi")).rejects.toThrow(/\[apikey\]/);
    await expect(gateway.enviarTexto("5511999998888", "oi")).rejects.not.toThrow(
      new RegExp(CRED.apiKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
  });
});

describe("o caminho ANTIGO continua vivo — é o que 'expande' quer dizer", () => {
  it("`whatsappGateway` ainda constrói a partir de `EVOLUTION_*`, ao lado da fábrica", async () => {
    // A Tarefa 10 é quem CONTRAI (mata as variáveis). Enquanto ela não roda, a
    // suíte inteira e as rotas em produção dependem deste singleton. Sem este
    // caso, "não removi nada" seria afirmação sem prova — e o modo de falha é
    // silencioso: só apareceria como envio quebrado em produção.
    vi.stubEnv("EVOLUTION_DOMAIN", "https://evo-antiga.exemplo.com");
    vi.stubEnv("EVOLUTION_INSTANCE", "instancia-do-ambiente");
    vi.stubEnv("EVOLUTION_APIKEY", "apikey-do-ambiente");

    expect(whatsappGateway.verificarOrigem({ instance: "instancia-do-ambiente" })).toBe(true);
    expect(whatsappGateway.verificarOrigem({ instance: "inst-1" })).toBe(false);
  });

  it("os dois caminhos são objetos SEPARADOS — a fábrica não reusa o singleton", () => {
    // Se a fábrica devolvesse o singleton, `verificarOrigem` compararia contra
    // `EVOLUTION_INSTANCE` e não contra a instância da CONEXÃO — e o webhook de
    // uma empresa passaria a aceitar payload da instância do deploy.
    //
    // As três variáveis são repostas aqui, e não herdadas do caso anterior: o
    // singleton de `index.ts` guarda a instância na primeira construção, então
    // um caso que dependesse da ordem passaria em suíte e falharia sozinho.
    vi.stubEnv("EVOLUTION_DOMAIN", "https://evo-antiga.exemplo.com");
    vi.stubEnv("EVOLUTION_INSTANCE", "instancia-do-ambiente");
    vi.stubEnv("EVOLUTION_APIKEY", "apikey-do-ambiente");

    const daFabrica = gatewayDaCredencial(CRED);
    expect(daFabrica).not.toBe(whatsappGateway);
    expect(daFabrica.verificarOrigem({ instance: "instancia-do-ambiente" })).toBe(false);
  });
});

describe("nada é memoizado, e isso é a decisão", () => {
  it("duas chamadas para a MESMA empresa consultam duas vezes", async () => {
    credencialAtivaUnicaMock.mockResolvedValue(CRED);
    await gatewayDaEmpresa("cmp_a", "primeira");
    await gatewayDaEmpresa("cmp_a", "segunda");
    // Um `Map` de gateway por empresa em escopo de módulo seria estado global
    // — proibido no programa —, e o modo de falha é servir a credencial da
    // empresa A para a B entre requisições num processo de longa duração. O
    // custo de não memoizar é uma consulta e uma decifragem de ~40 bytes por
    // mensagem enviada.
    expect(credencialAtivaUnicaMock).toHaveBeenCalledTimes(2);
  });

  it("duas chamadas para a mesma CONEXÃO também consultam duas vezes", async () => {
    credencialDaConexaoMock.mockResolvedValue(CRED);
    await gatewayDaConversa("cmp_a", { id: "cnv_1", connectionId: "conn_1" });
    await gatewayDaConversa("cmp_a", { id: "cnv_2", connectionId: "conn_1" });
    // O caso acima sozinho deixaria passar um cache indexado por
    // `connectionId`, que tem o MESMO modo de falha: a conexão trocada pela
    // tela continuaria sendo servida pela credencial velha.
    expect(credencialDaConexaoMock).toHaveBeenCalledTimes(2);
  });

  it("gateways de duas chamadas iguais são instâncias distintas", async () => {
    credencialDaConexaoMock.mockResolvedValue(CRED);
    const a = await gatewayDaConversa("cmp_a", { id: "cnv_1", connectionId: "conn_1" });
    const b = await gatewayDaConversa("cmp_a", { id: "cnv_1", connectionId: "conn_1" });
    // Contar chamadas provaria pouco se a fábrica consultasse e devolvesse um
    // objeto guardado. A identidade fecha a porta que a contagem deixa aberta.
    expect(a).not.toBe(b);
  });

  it("o módulo não tem binding mutável nem coleção em escopo de módulo", () => {
    // Mesma varredura de `tests/unit/config-leitura.test.ts`: sem ela, a frase
    // acima seria prosa, e um `Map` por empresa passaria em todos os outros
    // casos deste arquivo.
    //
    // `fileURLToPath(new URL(...))` e não caminho relativo ao `cwd`: é o padrão
    // que `config-leitura.test.ts` já usa, e ele não depende de de onde o
    // Vitest foi invocado.
    const caminho = fileURLToPath(
      new URL("../../src/modules/whatsapp/gateway/fabrica.ts", import.meta.url)
    );
    // Tirar os comentários é OBRIGATÓRIO: este projeto documenta a própria
    // regra em prosa longa, e a prosa cita `Map` e `globalThis` literalmente.
    const fonte = readFileSync(caminho, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

    for (const proibido of [
      /^let\s/m,
      /^var\s/m,
      /new Map\(/,
      /new Set\(/,
      /new WeakMap\(/,
      /globalThis/,
    ]) {
      expect(fonte).not.toMatch(proibido);
    }
  });

  it("a varredura MORDE — ela reprova um cache de verdade", () => {
    // Sem este caso, a varredura acima poderia estar quebrada (regex trocada,
    // arquivo lido vazio) e continuaria verde para sempre. O `AGENTS.md` deste
    // projeto existe porque um verde que não prova nada quase deixou passar um
    // defeito real de segurança.
    const fonteComCache = 'const cachePorEmpresa = new Map();\nlet ultima = null;\n';
    expect(fonteComCache).toMatch(/new Map\(/);
    expect(fonteComCache).toMatch(/^let\s/m);
  });
});
