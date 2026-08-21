import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Trava o defeito que derrubou o deploy de produção por três dias.
 *
 * `gateway/index.ts` e `llm/index.ts` validavam `EVOLUTION_*` e
 * `OPENAI_API_KEY` no escopo do módulo. `next build` avalia todo módulo
 * alcançável para coletar a configuração das rotas, e a cadeia
 * `api/queues/whatsapp-turn` → `turno.ts` → `gateway` fazia essa validação
 * rodar em tempo de BUILD. Sem aquelas variáveis na Vercel, o build inteiro
 * falhava — inclusive leads, funil e login, que não têm relação nenhuma com
 * WhatsApp:
 *
 *     Failed to collect configuration for /api/queues/whatsapp-turn
 *     [cause]: Configuração do gateway de WhatsApp inválida: ...
 *
 * Ninguém percebeu porque o sintoma aparece só na Vercel: numa máquina de
 * desenvolvimento o `.env` tem tudo, e o build passa.
 *
 * As duas metades importam e o teste cobre as duas:
 *
 * 1. **Importar não pode lançar** — senão o build quebra.
 * 2. **Usar sem configuração ainda tem que lançar**, com a mensagem que
 *    explica o que falta. Adiar a validação não pode virar engolir a
 *    validação.
 *
 * ## O que o Ciclo 2a mudou neste arquivo
 *
 * As três variáveis da Evolution não são mais adiadas: elas foram APAGADAS
 * (Tarefa 10, fase CONTRAI). A credencial vive em `WhatsappConnection`, por
 * empresa, com a apikey cifrada. Então a metade 1 ficou mais forte — importar
 * o gateway não pode nem ler ambiente nem consultar banco — e ganhou uma
 * terceira guarda: a varredura de fonte no fim deste arquivo, que reprova
 * qualquer linha de código de `src/` que volte a citar as três.
 *
 * `vi.mock("server-only")` é local a este arquivo de propósito: aqueles
 * módulos importam `server-only`, que lança fora do bundler do Next. Um alias
 * global no `vitest.config.ts` mudaria o comportamento de toda a suíte para
 * resolver um problema de dois arquivos.
 */
vi.mock("server-only", () => ({}));

// As variáveis que somem do ambiente antes de cada caso. `EVOLUTION_DOMAIN`,
// `EVOLUTION_INSTANCE` e `EVOLUTION_APIKEY` saíram desta lista no Ciclo 2a
// porque saíram do CÓDIGO: não há mais nada em `src/` que as leia, e a
// varredura no fim deste arquivo é quem afirma isso — apagá-las daqui sem
// aquela varredura teria trocado uma prova por uma suposição.
//
// No lugar delas entrou `COFRE_CHAVE_MESTRA`, a credencial que restou fora do
// banco. Ela está aqui pelo mesmo motivo que as outras estavam: o que os casos
// abaixo provam é que nem ela é exigida para IMPORTAR o gateway.
const VARIAVEIS = ["COFRE_CHAVE_MESTRA", "OPENAI_API_KEY"] as const;

const guardadas: Record<string, string | undefined> = {};

beforeEach(() => {
  // Os módulos memoizam a instância no primeiro uso; sem resetar, um teste
  // que construiu com sucesso deixaria o próximo passar por engano.
  vi.resetModules();
  for (const nome of VARIAVEIS) {
    guardadas[nome] = process.env[nome];
    delete process.env[nome];
  }
});

afterEach(() => {
  for (const nome of VARIAVEIS) {
    if (guardadas[nome] === undefined) delete process.env[nome];
    else process.env[nome] = guardadas[nome];
  }
});

describe("gateway do WhatsApp", () => {
  // As duas variáveis que `src/lib/env.ts` valida em ESCOPO DE MÓDULO, com
  // valores sintéticos.
  //
  // Elas existem aqui porque, desde o Ciclo 2a, importar o gateway alcança
  // `core/conexoes/leitura` → `core/tenancy/escopo` → `lib/prisma` →
  // `lib/env`, e aquele arquivo faz `envSchema.parse(...)` no topo. Medido em
  // 2026-08-20: sem estas duas, `await import(...)` do gateway lança
  // `Invalid input: expected string, received undefined` com
  // `path: ["DATABASE_URL"]` — erro do env central, não do gateway.
  //
  // Isso é dívida NOMEADA, e não coberta por este arquivo: `lib/env.ts` é onde
  // o padrão que o resto do repositório abandonou ainda vive, e convertê-lo é
  // mudança de outra tarefa (toca toda rota). Escrito aqui para que o próximo
  // leitor não conclua do título do caso que a garantia é mais larga do que é.
  //
  // A URL aponta para 127.0.0.1 numa porta onde não há Postgres, de propósito:
  // se importar chegasse a CONSULTAR o banco, não passaria batido.
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://ninguem:nada@127.0.0.1:1/nada";
    process.env.AUTH_SECRET = "sintetico-de-teste-nao-e-segredo-1234";
  });

  it("pode ser importado sem NENHUMA credencial de canal — é isso que mantém o build de pé", async () => {
    // A metade 1 da razão deste arquivo existir, e ela não mudou: `next build`
    // avalia todo módulo alcançável para coletar a configuração das rotas, e a
    // cadeia `api/queues/whatsapp-turn` → `turno.ts` → `gateway` já derrubou o
    // deploy de produção por três dias.
    //
    // O que MUDOU no Ciclo 2a é que a credencial saiu do ambiente e foi para o
    // banco: `EVOLUTION_DOMAIN`, `EVOLUTION_INSTANCE` e `EVOLUTION_APIKEY` não
    // existem mais em lugar nenhum, e `COFRE_CHAVE_MESTRA` está apagada do
    // ambiente pelo `beforeEach` do topo. Importar continua não lançando.
    const modulo = await import("../../src/modules/whatsapp/gateway");
    expect(typeof modulo.gatewayDaConversa).toBe("function");
    expect(typeof modulo.gatewayDaEmpresa).toBe("function");
    expect(typeof modulo.gatewayDaCredencial).toBe("function");
  });

  it("o singleton `whatsappGateway` NÃO existe mais — a contração é do módulo, não só das variáveis", async () => {
    // Apagar as variáveis e deixar o `Proxy` de pé só trocaria o modo de
    // falha: o singleton passaria a lançar "EVOLUTION_DOMAIN ausente" em
    // produção em vez de ser um caminho morto que ninguém chama. Um objeto por
    // PROCESSO carrega uma credencial, e um processo serve várias empresas —
    // é o mesmo raciocínio que proíbe memoizar na fábrica.
    const modulo = (await import("../../src/modules/whatsapp/gateway")) as Record<string, unknown>;
    expect(modulo.whatsappGateway).toBeUndefined();
    expect(Object.keys(modulo)).not.toContain("whatsappGateway");
  });

  it("mas USAR com um canal que este CRM não atende ainda lança, dizendo o que falta", async () => {
    // A metade 2: adiar a validação não pode virar engolir a validação.
    //
    // `gatewayDaCredencial` não decifra — quem decifra é
    // `core/conexoes/leitura`. O caminho que lança sem a chave mestra é o da
    // leitura, e ele tem caso próprio em `tests/unit/cofre-chave.test.ts`
    // ("variável ausente lança CofreSemChaveError"). Aqui provamos o que É
    // deste módulo: canal não implementado lança com NOME, mesmo com o
    // ambiente vazio de credencial.
    const { gatewayDaCredencial } = await import("../../src/modules/whatsapp/gateway");
    expect(() =>
      gatewayDaCredencial({
        id: "conn_1",
        companyId: "cmp_a",
        canal: "META_CLOUD",
        dominio: null,
        instancia: null,
        apiKey: "x",
      })
    ).toThrow(/META_CLOUD/);
  });
});

/**
 * A varredura que impede as três variáveis de voltarem por um "só enquanto isso".
 *
 * `EVOLUTION_COMPANY_ID`, a quarta da família, tem varredura própria desde a
 * Tarefa 7 (`whatsapp-ingest.test.ts` e `whatsapp-webhook-route.test.ts`, que
 * banem `process.env` inteiro nas duas árvores onde ela poderia voltar). Esta
 * cobre as outras três, e cobre `src/` inteiro porque elas não têm uma árvore
 * própria: qualquer arquivo que fale com a Evolution poderia relê-las.
 *
 * ## Por que ela mede LEITURA, e não MENÇÃO
 *
 * O plano desta tarefa pedia `readFileSync(arquivo).includes("EVOLUTION_")`
 * sobre `src/` inteiro, esperando lista vazia. Isso é impossível de satisfazer
 * neste repositório, e não por descuido: `whatsapp-ingest.test.ts` tem um caso
 * VERDE que EXIGE a menção (`expect(fonte).toContain("EVOLUTION_COMPANY_ID")`)
 * porque a Tarefa 7 enfrentou a mesma escolha e registrou a decisão por
 * escrito — "o defeito é a variável ser LIDA, não a história dela ser
 * contada". A varredura de `whatsapp-webhook-route.test.ts` segue a mesma
 * forma. Uma varredura de menção aqui obrigaria a apagar os comentários que
 * explicam de onde a credencial veio e por que saiu, que é o oposto do que
 * ⚠️ R5 da auditoria do Ciclo 1a pediu que fosse registrado.
 *
 * Num ponto ela é mais apertada que "não menciona": pega
 * `process.env["EVOLUTION_INSTANCE"]` e destructuring, que um `grep` por
 * `process.env.EVOLUTION_` não pegaria, e é indiferente ao nome do arquivo.
 *
 * ## O que ela NÃO pega, escrito de propósito
 *
 * Uma leitura montada em tempo de execução a partir de pedaços que nunca
 * aparecem juntos numa linha (`const n = "EVOL" + "UTION_APIKEY"`) passa
 * batido. Uma trava que mente sobre o próprio alcance é pior que trava
 * nenhuma; o caso "MORDE" abaixo delimita o que está de fato provado.
 */
describe("varredura de fonte: as três variáveis da Evolution não voltam", () => {
  const NOMES = ["EVOLUTION_DOMAIN", "EVOLUTION_INSTANCE", "EVOLUTION_APIKEY"] as const;

  // Mesma heurística de `whatsapp-ingest.test.ts`: linha de comentário `//` ou
  // continuação de bloco `*`. O caso "MORDE" prova que ela sabe dizer não.
  const eComentario = (linha: string) =>
    linha.trimStart().startsWith("//") || linha.trimStart().startsWith("*");

  const acusa = (linha: string) => !eComentario(linha) && NOMES.some((n) => linha.includes(n));

  async function arquivosTs(dir: string): Promise<string[]> {
    const { readdirSync } = await import("node:fs");
    const encontrados: string[] = [];
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const caminho = `${dir}/${entrada.name}`;
      if (entrada.isDirectory()) encontrados.push(...(await arquivosTs(caminho)));
      else if (/\.tsx?$/.test(entrada.name)) encontrados.push(caminho);
    }
    return encontrados;
  }

  it("a varredura MORDE: acha os arquivos, lê o conteúdo e sabe acusar e absolver", async () => {
    // Sem esta prova, um caminho errado devolveria lista vazia e o caso abaixo
    // ficaria verde para sempre sem ter olhado nada — é a forma que a Tarefa 6
    // e a Tarefa 7 já usaram nas varreduras delas.
    const { readFileSync } = await import("node:fs");
    const arquivos = await arquivosTs("src");
    expect(arquivos.length).toBeGreaterThan(0);
    expect(arquivos).toContain("src/modules/whatsapp/gateway/fabrica.ts");
    expect(readFileSync("src/modules/whatsapp/gateway/fabrica.ts", "utf8")).toContain(
      "gatewayDaCredencial"
    );

    // Acusa as três formas que importam, inclusive as duas que um `grep` por
    // `process.env.EVOLUTION_DOMAIN` deixaria passar:
    expect(acusa("  const d = process.env.EVOLUTION_DOMAIN;")).toBe(true);
    expect(acusa('  const i = process.env["EVOLUTION_INSTANCE"];')).toBe(true);
    expect(acusa("  const { EVOLUTION_APIKEY } = process.env;")).toBe(true);

    // E absolve as duas formas de comentário, que é o que este repositório
    // decidiu preservar:
    expect(acusa("  // antes isto lia EVOLUTION_DOMAIN do ambiente")).toBe(false);
    expect(acusa("   * lida de `EVOLUTION_APIKEY`, uma por deploy")).toBe(false);
  });

  it("nenhuma linha de código de `src/` cita EVOLUTION_DOMAIN, INSTANCE ou APIKEY", async () => {
    const { readFileSync } = await import("node:fs");
    const arquivos = await arquivosTs("src");

    // A violação carrega arquivo, linha e o texto: uma lista de booleanos
    // diria "voltou" sem dizer onde, e quem lê a falha está justamente
    // procurando o arquivo.
    const violacoes = arquivos.flatMap((arquivo) =>
      readFileSync(arquivo, "utf8")
        .split("\n")
        .flatMap((linha, n) => (acusa(linha) ? [`${arquivo}:${n + 1}: ${linha.trim()}`] : []))
    );

    expect(violacoes).toEqual([]);
  });
});

describe("provedor de LLM", () => {
  it("pode ser importado sem OPENAI_API_KEY", async () => {
    const modulo = await import("../../src/modules/whatsapp/llm");
    expect(modulo.llmProvider).toBeDefined();
  });

  it("mas lança ao ser usado sem a chave", async () => {
    const { llmProvider } = await import("../../src/modules/whatsapp/llm");

    expect(() => llmProvider.gerarResposta).toThrow(/Configuração do provedor de LLM inválida/);
  });

  it("constrói normalmente quando a chave existe", async () => {
    process.env.OPENAI_API_KEY = "sk-teste-nao-usada-em-rede";

    const { llmProvider } = await import("../../src/modules/whatsapp/llm");
    expect(typeof llmProvider.gerarResposta).toBe("function");
  });
});
