import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// `src/core/tenancy/escopo.ts` importa `@/lib/prisma` para ter um padrão
// ergonômico (`prismaDaEmpresa(id)` sem segundo argumento). Esse módulo faz
// duas coisas que este teste não pode pagar: `import "server-only"` (que só
// resolve para no-op sob a condição "react-server" do Next.js — fora dela
// LANÇA, ver o comentário em tests/unit/storage.test.ts, onde o mock foi
// documentado pela primeira vez) e `env.parse()` em escopo de módulo, que
// exige `DATABASE_URL` e `AUTH_SECRET` reais.
//
// Trocar o módulo inteiro por um objeto vazio é honesto aqui porque NENHUM
// caso deste arquivo usa o cliente padrão: todos passam o segundo parâmetro
// explícito. Se algum caso passasse a depender do padrão, ele quebraria de
// forma barulhenta (`undefined.$extends is not a function`) em vez de abrir
// conexão com o Postgres de verdade — que é exatamente o que este teste NÃO
// pode fazer.
vi.mock("@/lib/prisma", () => ({ prisma: undefined }));

import { prismaDaEmpresa, EscopoDeEmpresaError } from "@/core/tenancy/escopo";

const EMPRESA_A = "cmp_a";
const EMPRESA_B = "cmp_b";

type Linha = Record<string, unknown>;

/**
 * Por que o banco falso entra por BAIXO do escopo, e não por cima.
 *
 * Medido em 2026-08-20 com `npx tsx` contra o Prisma 7.9.1 desta árvore: em
 * `cliente.$extends(A).$extends(B)`, a extensão A (a PRIMEIRA aplicada) é a
 * mais externa — ela roda antes, e só chega em B se A chamar `query(args)`.
 * A ordem observada foi `A-antes → B-antes → A-depois`, e os `args` que
 * chegaram em B já traziam a modificação de A.
 *
 * Consequência para este teste: o banco falso precisa ser aplicado DEPOIS de
 * `prismaDaEmpresa()`, para ficar por dentro. Assim o caminho é
 * `escopo → banco falso`, e o banco falso nunca chama `query()` — o motor do
 * Prisma jamais é alcançado e nenhum socket é aberto. Se a montagem fosse ao
 * contrário, o escopo nunca rodaria e o teste passaria vazio.
 */
function bancoFalso(tabelas: Record<string, Linha[]>) {
  const chamadas: { model: string; operation: string; args: unknown }[] = [];

  const casa = (linha: Linha, where: Record<string, unknown> | undefined) =>
    Object.entries(where ?? {}).every(([campo, valor]) => linha[campo] === valor);

  const extensao = {
    name: "banco-falso-do-teste",
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ model, operation, args }: any): Promise<any> {
          chamadas.push({ model, operation, args: structuredClone(args) });
          tabelas[model] ??= [];
          const where = args?.where as Record<string, unknown> | undefined;

          switch (operation) {
            case "findMany":
              return tabelas[model].filter((l) => casa(l, where));
            case "findFirst":
            case "findFirstOrThrow":
            // `findUnique` só chega aqui para modelo FORA do tenant (em
            // modelo de tenant o escopo lança antes). Precisa devolver linha,
            // não lista — é o que prova que `User` passou intacto.
            case "findUnique":
            case "findUniqueOrThrow":
              return tabelas[model].find((l) => casa(l, where)) ?? null;
            case "count":
              return tabelas[model].filter((l) => casa(l, where)).length;
            case "create": {
              const nova = { ...(args.data as Linha) };
              tabelas[model].push(nova);
              return nova;
            }
            case "createMany": {
              const dados = Array.isArray(args.data) ? args.data : [args.data];
              for (const d of dados) tabelas[model].push({ ...(d as Linha) });
              return { count: dados.length };
            }
            case "updateMany": {
              let count = 0;
              for (const l of tabelas[model]) {
                if (casa(l, where)) {
                  Object.assign(l, args.data as Linha);
                  count += 1;
                }
              }
              return { count };
            }
            case "deleteMany": {
              const antes = tabelas[model].length;
              tabelas[model] = tabelas[model].filter((l) => !casa(l, where));
              return { count: antes - tabelas[model].length };
            }
            default:
              return tabelas[model].filter((l) => casa(l, where));
          }
        },
      },
    },
  };

  return { extensao, chamadas };
}

// Construir um PrismaClient NÃO abre conexão — o `pg` só disca no primeiro
// comando, e o banco falso garante que nenhum comando desça até o motor. A
// string aponta para uma porta impossível de propósito: se algum dia uma
// operação escapar do banco falso, o teste falha com ECONNREFUSED imediato em
// vez de tocar o Postgres de desenvolvimento.
function clienteBase() {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: "postgresql://u:p@127.0.0.1:1/nada" }),
  });
}

describe("prismaDaEmpresa", () => {
  let tabelas: Record<string, Linha[]>;
  let chamadas: { model: string; operation: string; args: unknown }[];

  function escopadoPara(companyId: string) {
    const falso = bancoFalso(tabelas);
    chamadas = falso.chamadas;
    return prismaDaEmpresa(companyId, clienteBase()).$extends(falso.extensao);
  }

  beforeEach(() => {
    tabelas = {
      Contact: [
        { id: "a1", nome: "Ana da A", companyId: EMPRESA_A },
        { id: "b1", nome: "Bruno da B", companyId: EMPRESA_B },
      ],
      User: [
        { id: "u1", nome: "Admin", email: "admin@x.com" },
        { id: "u2", nome: "Outro", email: "outro@x.com" },
      ],
      RateLimit: [{ id: "r1", chave: "login:1.2.3.4", tentativas: 3 }],
    };
  });

  describe("leitura", () => {
    it("findMany da empresa A não devolve linha da empresa B", async () => {
      const a = escopadoPara(EMPRESA_A);
      const linhas = await a.contact.findMany();

      expect(linhas).toHaveLength(1);
      expect(linhas[0]).toMatchObject({ id: "a1", companyId: EMPRESA_A });
    });

    it("injeta companyId mesmo quando o chamador já passou outros filtros", async () => {
      const a = escopadoPara(EMPRESA_A);
      await a.contact.findMany({ where: { nome: "Bruno da B" } });

      expect(chamadas[0].args).toMatchObject({
        where: { nome: "Bruno da B", companyId: EMPRESA_A },
      });
    });

    it("count e findFirst também são escopados", async () => {
      const a = escopadoPara(EMPRESA_A);

      expect(await a.contact.count()).toBe(1);
      expect(await a.contact.findFirst({ where: { id: "b1" } })).toBeNull();
    });

    it("recusa where com companyId de OUTRA empresa em vez de sobrescrever calado", async () => {
      const a = escopadoPara(EMPRESA_A);

      await expect(a.contact.findMany({ where: { companyId: EMPRESA_B } })).rejects.toThrow(
        EscopoDeEmpresaError
      );
    });
  });

  describe("escrita em massa", () => {
    // O `$extends` de query NÃO relaxa os TIPOS dos argumentos — medido aqui
    // em 2026-08-20: mesmo com o escopo injetando `companyId` em tempo de
    // execução, `tsc --noEmit` continuou exigindo `companyId` (e `telefone`)
    // em `ContactCreateInput`. Esta lacuna está registrada em
    // `src/core/tenancy/escopo.ts`, seção "O tipo não sabe o que o runtime
    // faz". Os casos abaixo mandam de propósito o payload INCOMPLETO, porque
    // é justamente isso que prova a injeção; `payload()` só descreve essa
    // lacuna, não esconde defeito.
    const payload = <T,>(dado: Record<string, unknown>) => dado as T;

    it("create grava o companyId do escopo sem o chamador passar", async () => {
      const a = escopadoPara(EMPRESA_A);
      const nova = await a.contact.create({ data: payload({ nome: "Nova", telefone: "1" }) });

      expect(nova).toMatchObject({ companyId: EMPRESA_A });
      expect(chamadas[0].args).toMatchObject({ data: { companyId: EMPRESA_A } });
    });

    it("create com companyId DIFERENTE do escopo é recusado, não corrigido", async () => {
      const a = escopadoPara(EMPRESA_A);

      await expect(
        a.contact.create({ data: payload({ nome: "Intrusa", companyId: EMPRESA_B }) })
      ).rejects.toThrow(EscopoDeEmpresaError);
      // e nada foi gravado
      expect(tabelas.Contact).toHaveLength(2);
    });

    it("create com companyId IGUAL ao escopo passa", async () => {
      const a = escopadoPara(EMPRESA_A);
      await expect(
        a.contact.create({ data: payload({ nome: "Coerente", companyId: EMPRESA_A }) })
      ).resolves.toMatchObject({ companyId: EMPRESA_A });
    });

    it("createMany injeta o companyId em cada linha do lote", async () => {
      const a = escopadoPara(EMPRESA_A);
      await a.contact.createMany({ data: [payload({ nome: "Um" }), payload({ nome: "Dois" })] });

      expect(tabelas.Contact.filter((l) => l.companyId === EMPRESA_A)).toHaveLength(3);
    });

    it("updateMany da empresa A não alcança linha da empresa B", async () => {
      const a = escopadoPara(EMPRESA_A);
      const r = await a.contact.updateMany({ data: { nome: "Renomeado" } });

      expect(r.count).toBe(1);
      expect(tabelas.Contact.find((l) => l.id === "b1")).toMatchObject({ nome: "Bruno da B" });
    });

    it("deleteMany da empresa A não alcança linha da empresa B", async () => {
      const a = escopadoPara(EMPRESA_A);
      const r = await a.contact.deleteMany({ where: { id: "b1" } });

      expect(r.count).toBe(0);
      expect(tabelas.Contact).toHaveLength(2);
    });
  });

  describe("operações por chave única", () => {
    const casos = [
      ["findUnique", "findFirst"],
      ["findUniqueOrThrow", "findFirst"],
      ["update", "updateMany"],
      ["delete", "deleteMany"],
      ["upsert", "updateMany"],
    ] as const;

    for (const [operacao, sugestao] of casos) {
      it(`${operacao} lança e aponta para ${sugestao}`, async () => {
        const a = escopadoPara(EMPRESA_A);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const modelo = (a as any).contact;

        const promessa = modelo[operacao]({
          where: { id: "b1" },
          data: { nome: "x" },
          create: { nome: "x" },
          update: { nome: "x" },
        });

        await expect(promessa).rejects.toThrow(EscopoDeEmpresaError);
        await expect(promessa).rejects.toThrow(sugestao);
      });
    }

    it("nenhuma operação por chave única chega ao banco", async () => {
      const a = escopadoPara(EMPRESA_A);
      await expect(a.contact.findUnique({ where: { id: "b1" } })).rejects.toThrow();

      expect(chamadas).toHaveLength(0);
    });
  });

  describe("modelos que não são de tenant", () => {
    it("User passa intacto, inclusive findUnique", async () => {
      const a = escopadoPara(EMPRESA_A);
      const u = await a.user.findUnique({ where: { id: "u1" } });

      expect(u).toMatchObject({ id: "u1" });
      expect(chamadas[0].args).toEqual({ where: { id: "u1" } });
    });

    it("User.findMany não ganha companyId — a tabela nem tem a coluna", async () => {
      const a = escopadoPara(EMPRESA_A);
      const todos = await a.user.findMany();

      expect(todos).toHaveLength(2);
      expect(chamadas[0].args ?? {}).not.toHaveProperty("where.companyId");
    });

    it("RateLimit passa intacto", async () => {
      const a = escopadoPara(EMPRESA_A);
      await a.rateLimit.findMany();

      expect(chamadas[0].args ?? {}).not.toHaveProperty("where.companyId");
    });
  });

  it("dois escopos sobre o mesmo banco enxergam mundos separados", async () => {
    const a = escopadoPara(EMPRESA_A);
    const bFalso = bancoFalso(tabelas);
    const b = prismaDaEmpresa(EMPRESA_B, clienteBase()).$extends(bFalso.extensao);

    expect(await a.contact.findMany()).toHaveLength(1);
    expect(await b.contact.findMany()).toHaveLength(1);
    expect((await a.contact.findMany())[0].id).toBe("a1");
    expect((await b.contact.findMany())[0].id).toBe("b1");
  });
});
