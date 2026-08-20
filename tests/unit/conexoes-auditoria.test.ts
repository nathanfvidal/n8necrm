import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

const registrarAuditoriaMock = vi.fn();
vi.mock("@/core/audit/log", () => ({
  registrarAuditoria: (...a: unknown[]) => registrarAuditoriaMock(...a),
}));

// `ACOES_SENSIVEIS` é só um array literal em `core/audit/alerta.ts`, mas
// importá-lo arrasta a cadeia `alerta → rate-limit/limiter → lib/prisma →
// lib/env`, e `lib/env.ts` valida `DATABASE_URL`/`AUTH_SECRET` em ESCOPO DE
// MÓDULO — a armadilha que `CLAUDE.md` registra. Sem este mock o arquivo
// inteiro morre no import, antes de rodar caso nenhum.
//
// A saída óbvia seria `import "dotenv/config"`, como faz
// `alerta-atividade.test.ts`. Recusada: lá o teste fala com o Postgres de
// verdade e PRECISA da credencial; aqui nada toca banco, e `vitest.config.ts`
// diz por extenso que credencial não entra em teste que não precisa dela.
// Cortar a aresta é mais barato e mais honesto que carregar o `.env` inteiro
// para ler uma constante.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

type Linha = Record<string, unknown>;
const linhas: Linha[] = [];
function casa(l: Linha, w: Linha) {
  return Object.entries(w).every(([k, v]) => l[k] === v);
}

// `ativa: true` antes do spread emula o `@default(true)` da coluna, pelo mesmo
// motivo explicado por extenso no falso de `conexoes-service.test.ts`.
vi.mock("@/core/tenancy/escopo", () => ({
  prismaDaEmpresa: (companyId: string) => ({
    whatsappConnection: {
      findMany: async (a: { where?: Linha } = {}) =>
        linhas.filter((l) => casa(l, { ...(a.where ?? {}), companyId })),
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
  criarConexao,
  substituirSegredo,
  atualizarConexao,
  definirAtiva,
  regenerarWebhookToken,
  apagarConexao,
} from "../../src/core/conexoes/service";
import { ACOES_SENSIVEIS } from "../../src/core/audit/alerta";

const EMPRESA = "cmp_a";
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

describe("toda ação de conexão é auditada SEM `antes` e SEM `depois`", () => {
  it("as seis ações auditam, e nenhuma carrega instantâneo", async () => {
    const { id } = await criarConexao(
      EMPRESA,
      { canal: "EVOLUTION", nome: "C", dominio: "https://e.com", instancia: "i", segredo: APIKEY },
      AUTOR
    );
    await substituirSegredo(EMPRESA, id, "apikey-nova-9z8y", AUTOR);
    await atualizarConexao(
      EMPRESA,
      id,
      { nome: "C2", dominio: "https://e2.com", instancia: "i2" },
      AUTOR
    );
    await definirAtiva(EMPRESA, id, false, AUTOR);
    await regenerarWebhookToken(EMPRESA, id, AUTOR);
    await apagarConexao(EMPRESA, id, AUTOR);

    const acoes = registrarAuditoriaMock.mock.calls.map(([p]) => (p as { acao: string }).acao);
    expect(acoes).toEqual([
      "criar_conexao",
      "substituir_segredo_conexao",
      "editar_conexao",
      "desativar_conexao",
      "regenerar_webhook_conexao",
      "apagar_conexao",
    ]);

    for (const [params] of registrarAuditoriaMock.mock.calls) {
      const chaves = Object.keys(params as object);
      // A afirmação é a AUSÊNCIA das duas chaves. Amarrar o conjunto inteiro
      // com `toEqual` faria este caso quebrar por acrescentar `ip`, que não
      // tem nada a ver com a regra.
      expect(chaves).not.toContain("antes");
      expect(chaves).not.toContain("depois");
      expect(params).toMatchObject({
        entidade: "WhatsappConnection",
        userId: AUTOR,
        companyId: EMPRESA,
      });
    }
  });

  it("NENHUM argumento de auditoria contém a apikey nem um blob do cofre", async () => {
    await criarConexao(
      EMPRESA,
      { canal: "EVOLUTION", nome: "C", dominio: "https://e.com", instancia: "i", segredo: APIKEY },
      AUTOR
    );
    const serializado = JSON.stringify(registrarAuditoriaMock.mock.calls);
    expect(serializado).not.toContain(APIKEY);
    expect(serializado).not.toContain("v1.");
  });
});

describe("quais ações de conexão contam como rajada destrutiva", () => {
  it("as quatro que derrubam ou tomam o canal ENTRAM", () => {
    for (const acao of [
      "substituir_segredo_conexao",
      "desativar_conexao",
      "apagar_conexao",
      "regenerar_webhook_conexao",
    ]) {
      expect(ACOES_SENSIVEIS).toContain(acao);
    }
  });

  it("criar, editar e ativar FICAM DE FORA — reparo e trabalho normal não alertam", () => {
    for (const acao of ["criar_conexao", "editar_conexao", "ativar_conexao"]) {
      expect(ACOES_SENSIVEIS).not.toContain(acao);
    }
  });
});
