import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

import {
  prismaDaEmpresa,
  escoparArgumentos,
  EscopoDeEmpresaError,
  MODELOS_DE_TENANT,
} from "@/core/tenancy/escopo";

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
            case "createMany":
            case "createManyAndReturn": {
              const dados = Array.isArray(args.data) ? args.data : [args.data];
              for (const d of dados) tabelas[model].push({ ...(d as Linha) });
              return { count: dados.length };
            }
            // `updateManyAndReturn` grava igual a `updateMany` — o que importa
            // aqui é que a linha MUDE de verdade, para que um `companyId`
            // divergente em `data` apareça como linha movida de empresa.
            case "updateManyAndReturn":
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

  // Os casos abaixo mandam payload que o TIPO não aceita (é o ponto: prova que
  // o RUNTIME recusa) e operações que o tipo do delegate estreita demais. Daí
  // o `as any` — a lacuna de tipos está registrada em escopo.ts, seção "O tipo
  // não sabe o que o runtime faz".
  /* eslint-disable @typescript-eslint/no-explicit-any */
  describe("updateMany não pode MOVER a linha para outra empresa", () => {
    // O buraco que estes casos fecham: `updateMany` estava só no grupo do
    // `where`, e esse ramo validava apenas `where.companyId`. O `data` passava
    // intacto, então `{ where: {}, data: { companyId: "B" } }` escolhia a linha
    // DENTRO da empresa A e a gravava na B — filtro certo, escrita fora do
    // escopo, silêncio total.
    it("updateMany com data.companyId de OUTRA empresa é recusado, e a linha não sai da empresa", async () => {
      const a = escopadoPara(EMPRESA_A);

      await expect(
        (a as any).contact.updateMany({ data: { companyId: EMPRESA_B } })
      ).rejects.toThrow(EscopoDeEmpresaError);

      expect(tabelas.Contact.find((l) => l.id === "a1")).toMatchObject({
        companyId: EMPRESA_A,
      });
      expect(chamadas).toHaveLength(0);
    });

    it("updateManyAndReturn tem a mesma trava", async () => {
      const a = escopadoPara(EMPRESA_A);

      await expect(
        (a as any).contact.updateManyAndReturn({ data: { companyId: EMPRESA_B } })
      ).rejects.toThrow(EscopoDeEmpresaError);

      expect(tabelas.Contact.find((l) => l.id === "a1")).toMatchObject({
        companyId: EMPRESA_A,
      });
    });

    it("também pega a forma `{ set: ... }`, que grava a mesma coluna", async () => {
      const a = escopadoPara(EMPRESA_A);

      await expect(
        (a as any).contact.updateMany({ data: { companyId: { set: EMPRESA_B } } })
      ).rejects.toThrow(EscopoDeEmpresaError);
    });

    it("updateMany com companyId IGUAL ao escopo passa — a política é a mesma do create", async () => {
      const a = escopadoPara(EMPRESA_A);
      const r = await (a as any).contact.updateMany({
        data: { nome: "Renomeada", companyId: EMPRESA_A },
      });

      expect(r.count).toBe(1);
      expect(tabelas.Contact.find((l) => l.id === "b1")).toMatchObject({ nome: "Bruno da B" });
    });
  });

  describe("escrita aninhada: divergência recusada em qualquer profundidade", () => {
    // `injetarEmData` só lia e escrevia o nível de cima. O aninhado que OMITE
    // `companyId` falha alto no banco (`NOT NULL` desde a Task 1); o que passa
    // o `companyId` de OUTRA empresa era ACEITO, porque o campo estava
    // preenchido. A varredura profunda fecha esse segundo caso — recusando,
    // não injetando (a forma do payload aninhado varia demais para injetar).
    it("aninhado com companyId de outra empresa é recusado, e nada é gravado", async () => {
      const a = escopadoPara(EMPRESA_A);

      await expect(
        (a as any).lead.create({
          data: {
            canal: "WHATSAPP",
            stageId: "st_1",
            notes: { create: [{ texto: "n", autorId: "u1", companyId: EMPRESA_B }] },
          },
        })
      ).rejects.toThrow(EscopoDeEmpresaError);

      expect(tabelas.Contact).toHaveLength(2);
      expect(chamadas).toHaveLength(0);
    });

    it("aninhado COERENTE com o escopo passa", async () => {
      const a = escopadoPara(EMPRESA_A);

      await expect(
        (a as any).lead.create({
          data: {
            canal: "WHATSAPP",
            stageId: "st_1",
            notes: { create: [{ texto: "n", autorId: "u1", companyId: EMPRESA_A }] },
          },
        })
      ).resolves.toMatchObject({ companyId: EMPRESA_A });
    });

    it("pega fundo, dentro de lote, e diz o CAMINHO onde achou", async () => {
      const a = escopadoPara(EMPRESA_A);

      await expect(
        (a as any).contact.create({
          data: {
            nome: "Fundo",
            leads: {
              create: [
                { canal: "WHATSAPP", stageId: "st_1", companyId: EMPRESA_A },
                {
                  canal: "MANUAL",
                  stageId: "st_1",
                  notes: { create: { texto: "x", autorId: "u1", companyId: EMPRESA_B } },
                },
              ],
            },
          },
        })
      ).rejects.toThrow("data.leads.create[1].notes.create.companyId");
    });

    it("`company: { connect }` aninhado é o mesmo companyId por outro nome", async () => {
      const a = escopadoPara(EMPRESA_A);

      await expect(
        (a as any).lead.create({
          data: {
            canal: "WHATSAPP",
            stageId: "st_1",
            notes: {
              create: [{ texto: "n", autorId: "u1", company: { connect: { id: EMPRESA_B } } }],
            },
          },
        })
      ).rejects.toThrow(EscopoDeEmpresaError);
    });
  });

  describe("relação `company` aninhada: lista BRANCA, não lista de formas conhecidas", () => {
    // A versão anterior conferia `company.connect.id` e deixava o resto passar.
    // As outras duas formas que o próprio Prisma gera em
    // `CompanyCreateNestedOneWithoutLeadNotesInput` escapavam, e as três passam
    // no `tsc`: `connectOrCreate` gravava a linha na empresa do `where` dele, e
    // `create` FABRICAVA uma empresa nova e gravava nela. O array em `connect`
    // escapava por outro motivo — `.id` de um array é `undefined`, e
    // `exigirCoerencia` trata `undefined` como "não passou nada".
    //
    // A lista branca é fechada porque `Company` tem `id` como ÚNICO campo
    // único (prisma/schema.prisma): não sobra forma legítima por descobrir.
    // `Lead` e `LeadNote`, e não `Contact`: a relação `notes` mora em `Lead`
    // (`prisma/schema.prisma`), e `Contact` não tem `notes` nenhum. Com o
    // modelo errado, o banco falso aceitaria — ele não valida forma — e o caso
    // provaria só a varredura; com o certo, prova a varredura E que o payload
    // é o que o Prisma de verdade aceitaria.
    const aninhar = (company: unknown) => ({
      canal: "WHATSAPP",
      stageId: "st_1",
      notes: { create: [{ texto: "n", autorId: "u1", company }] },
    });

    const recusadas: [string, unknown][] = [
      ["connectOrCreate", { connectOrCreate: { where: { id: EMPRESA_B }, create: { nome: "B" } } }],
      ["create (fabrica empresa nova)", { create: { nome: "Nova" } }],
      ["connect em array", { connect: [{ id: EMPRESA_B }] }],
      ["connect com campo que não é `id`", { connect: { nome: "Empresa B" } }],
      ["connect junto de create", { connect: { id: EMPRESA_A }, create: { nome: "Nova" } }],
      ["disconnect", { disconnect: true }],
    ];

    for (const [nome, company] of recusadas) {
      it(`recusa \`company: { ${nome} }\``, async () => {
        const a = escopadoPara(EMPRESA_A);

        await expect(
          (a as any).lead.create({ data: aninhar(company) })
        ).rejects.toThrow(EscopoDeEmpresaError);
        expect(chamadas).toHaveLength(0);
      });
    }

    it("a única forma aceita continua passando: connect com o id do escopo", async () => {
      const a = escopadoPara(EMPRESA_A);

      await expect(
        (a as any).lead.create({ data: aninhar({ connect: { id: EMPRESA_A } }) })
      ).resolves.toMatchObject({ companyId: EMPRESA_A });
    });
  });

  describe("falsos positivos conhecidos: recusam escrita legítima, e dizem por quê", () => {
    // Os dois falham ALTO (recusam, não vazam). Não há exclusão no código de
    // propósito: uma segunda lista, de caminhos a ignorar, compraria deriva
    // silenciosa — o mesmo defeito que a lista branca da relação acabou de
    // fechar. O que existe é mensagem acionável, e é isso que estes casos
    // travam: se a dica sumir da mensagem, quem esbarrar aqui vai ler
    // "bug ou ataque" tendo escrito um log de auditoria.
    it("companyId como CONTEÚDO de coluna Json é recusado, com a saída na mensagem", async () => {
      const a = escopadoPara(EMPRESA_A);

      const promessa = (a as any).auditLog.create({
        data: { acao: "membership.update", antes: { userId: "u1", companyId: EMPRESA_B } },
      });

      await expect(promessa).rejects.toThrow(EscopoDeEmpresaError);
      await expect(promessa).rejects.toThrow("CONTEÚDO de coluna `Json`");
      await expect(promessa).rejects.toThrow("companyIdAlvo");
    });

    it("`where` aninhado dentro de `data` é recusado, com a saída na mensagem", async () => {
      const a = escopadoPara(EMPRESA_A);

      const promessa = (a as any).lead.updateMany({
        data: { notes: { updateMany: { where: { companyId: EMPRESA_B }, data: { texto: "x" } } } },
      });

      await expect(promessa).rejects.toThrow(EscopoDeEmpresaError);
      await expect(promessa).rejects.toThrow("`where` ANINHADO");
      await expect(promessa).rejects.toThrow("chamada separada no cliente escopado");
    });

    // Uma chave `company` dentro de blob Json -- descricao de empresa em
    // `payload` ou `antes` -- cai na lista branca da relacao, que nao sabe que
    // atravessou um Json. Na rodada 1 isto passava; o aperto da rodada 2 o
    // criou. Continua sendo recusa alta, nao vazamento, e por isso a saida e a
    // mesma dos outros dois: nomear o caso na mensagem.
    it("chave `company` dentro de coluna Json é recusada, e a dica nomeia esse caso", async () => {
      const a = escopadoPara(EMPRESA_A);

      const promessa = (a as any).notification.create({
        data: { tipo: "LEAD_NOVO", payload: { company: { nome: "ACME", cnpj: "1" } } },
      });

      await expect(promessa).rejects.toThrow(EscopoDeEmpresaError);
      await expect(promessa).rejects.toThrow("falso positivo conhecido");
      await expect(promessa).rejects.toThrow("chave `company` que seja só descrição");
      await expect(promessa).rejects.toThrow("empresaDoContato");
    });

    // As QUATRO combinações de (o que recusou) × (onde). A afirmação de que a
    // dica acompanha recusa aninhada já foi escrita duas vezes sem teste que a
    // exercitasse, e nas duas estava errada: na segunda, NENHUMA recusa de
    // FORMA carregava a dica e o TOPO carregava. Estes casos são a trava.
    const combinacoes: [string, boolean, () => unknown][] = [
      [
        "companyId ANINHADO",
        true,
        () => ({ model: "auditLog", args: { data: { acao: "x", antes: { companyId: EMPRESA_B } } } }),
      ],
      [
        "companyId no TOPO",
        false,
        () => ({ model: "auditLog", args: { data: { acao: "x", companyId: EMPRESA_B } } }),
      ],
      [
        "FORMA da relação company, ANINHADA",
        true,
        () => ({
          model: "lead",
          args: {
            data: {
              canal: "WHATSAPP",
              stageId: "st_1",
              notes: { create: [{ texto: "n", autorId: "u1", company: { create: { nome: "X" } } }] },
            },
          },
        }),
      ],
      [
        // O vetor exato que a revisão mediu como "TOPO [COM DICA]": a recusa
        // por VALOR divergente dentro de `company.connect.id`, no topo do
        // `data`. Passava a dica sem consultar o `aninhado`.
        "valor divergente em company.connect.id, no TOPO",
        false,
        () => ({
          model: "lead",
          args: { data: { company: { connect: { id: EMPRESA_B } } } },
          operacao: "updateMany",
        }),
      ],
      [
        "FORMA da relação company, no TOPO",
        false,
        () => ({
          model: "lead",
          // `updateMany` chega à varredura sem passar por `injetarEmData`, que
          // é o que torna o `data.company` de TOPO alcançável aqui.
          args: { data: { company: { create: { nome: "X" } } } },
          operacao: "updateMany",
        }),
      ],
    ];

    for (const [nome, esperaDica, montar] of combinacoes) {
      it(`recusa por ${nome} ${esperaDica ? "CARREGA" : "não carrega"} a dica`, async () => {
        const a = escopadoPara(EMPRESA_A);
        const { model, args, operacao } = montar() as any;

        const erro = await (a as any)[model][operacao ?? "create"](args).catch((e: Error) => e);

        expect(erro).toBeInstanceOf(EscopoDeEmpresaError);
        if (esperaDica) {
          expect(erro.message).toContain("falso positivo conhecido");
        } else {
          expect(erro.message).not.toContain("falso positivo");
        }
      });
    }

    it("no TOPO do data a mensagem NÃO carrega a dica — ali é sempre a coluna", async () => {
      const a = escopadoPara(EMPRESA_A);

      const erro = await (a as any).contact
        .create({ data: { nome: "x", companyId: EMPRESA_B } })
        .catch((e: Error) => e);

      expect(erro).toBeInstanceOf(EscopoDeEmpresaError);
      expect(erro.message).toContain("data.companyId");
      expect(erro.message).not.toContain("falso positivo");
    });

    // Referência cíclica: a varredura tem de TERMINAR, e ainda enxergar a
    // divergência que está do outro lado do ciclo.
    //
    // Os dois casos entram por `escoparArgumentos`, não pelo cliente, e o
    // motivo foi medido aqui em 2026-08-20: mandar `data` cíclico pelo cliente
    // morre com `RangeError: Maximum call stack size exceeded` DENTRO do
    // runtime do Prisma (`client.js`, função `Ct`, que desce nos argumentos
    // recursivamente) — antes de o payload chegar a qualquer banco. Ou seja: o
    // ciclo é fatal um passo adiante de qualquer jeito, e o que este arquivo
    // precisa garantir é que o ESCOPO não seja quem trava, nem quem deixa
    // passar. Por isso o teste mira a varredura direto.
    it("referência cíclica não vira laço infinito na varredura", () => {
      const cicloLimpo: Record<string, unknown> = { nome: "Ciclo" };
      cicloLimpo.euMesmo = cicloLimpo;

      expect(
        escoparArgumentos("Contact", "create", { data: cicloLimpo }, EMPRESA_A).data
      ).toMatchObject({ companyId: EMPRESA_A });
    });

    it("referência cíclica não esconde a divergência do outro lado do ciclo", () => {
      const cicloSujo: Record<string, unknown> = {
        canal: "WHATSAPP",
        stageId: "st_1",
        notes: { create: [{ texto: "n", autorId: "u1", companyId: EMPRESA_B }] },
      };
      cicloSujo.euMesmo = cicloSujo;

      expect(() =>
        escoparArgumentos("Lead", "create", { data: cicloSujo }, EMPRESA_A)
      ).toThrow(EscopoDeEmpresaError);
    });
  });

  describe("leitura ANINHADA: a limitação é real e está documentada", () => {
    // Este caso não afirma uma proteção — afirma a AUSÊNCIA dela, de propósito.
    // `$allOperations` vê UMA operação e o `include` desce intacto. Como `User`
    // não é modelo de tenant, `Lead → responsavel → leadsAtribuidos` sai do
    // tenant. Se um dia o Prisma passar a decompor `include` em operações
    // separadas, este caso quebra — e quebrar é o aviso de que o parágrafo em
    // escopo.ts ("Leitura ANINHADA") precisa ser reescrito.
    it("include através de User desce sem filtro — uma chamada só", async () => {
      const a = escopadoPara(EMPRESA_A);
      await (a as any).lead.findMany({
        include: { responsavel: { include: { leadsAtribuidos: true } } },
      });

      expect(chamadas).toHaveLength(1);
      expect((chamadas[0].args as any).include).toEqual({
        responsavel: { include: { leadsAtribuidos: true } },
      });
      expect((chamadas[0].args as any).where).toEqual({ companyId: EMPRESA_A });
    });
  });

  describe("comportamentos declarados que faltavam exercitar", () => {
    it("operação não classificada LANÇA (o fecha-fechado do default)", () => {
      // Pela porta do cliente este ramo é inalcançável: medido em 2026-08-20,
      // `typeof prisma.contact.operacaoInventada` é `undefined` — o delegate
      // não encaminha operação que o runtime não conhece. Por isso a decisão
      // foi extraída para `escoparArgumentos`, e o teste entra por lá.
      expect(() =>
        escoparArgumentos("Contact", "operacaoQueOPrismaAindaNaoTem", {}, EMPRESA_A)
      ).toThrow(EscopoDeEmpresaError);
      expect(() =>
        escoparArgumentos("Contact", "operacaoQueOPrismaAindaNaoTem", {}, EMPRESA_A)
      ).toThrow("ainda não classifica");
    });

    it("`data: { company: ... }` no topo é recusado com nome próprio", async () => {
      const a = escopadoPara(EMPRESA_A);

      await expect(
        (a as any).contact.create({
          data: { nome: "Por relação", company: { connect: { id: EMPRESA_A } } },
        })
      ).rejects.toThrow(/relação `company`/);
      expect(chamadas).toHaveLength(0);
    });

    it("companyId vazio lança na ENTRADA, apontando a origem correta", () => {
      expect(() => prismaDaEmpresa("", clienteBase())).toThrow(EscopoDeEmpresaError);
      expect(() => prismaDaEmpresa("", clienteBase())).toThrow("UsuarioAtivo.companyId");
    });

    it("groupBy e aggregate recebem where.companyId como qualquer leitura", async () => {
      const a = escopadoPara(EMPRESA_A);
      await (a as any).contact.groupBy({ by: ["nome"] });
      await (a as any).contact.aggregate({ _count: true });

      expect(chamadas.map((c) => (c.args as any).where)).toEqual([
        { companyId: EMPRESA_A },
        { companyId: EMPRESA_A },
      ]);
    });

    it("createManyAndReturn injeta em cada linha do lote", async () => {
      const a = escopadoPara(EMPRESA_A);
      await (a as any).contact.createManyAndReturn({
        data: [{ nome: "Um" }, { nome: "Dois" }],
      });

      expect((chamadas[0].args as any).data).toEqual([
        { nome: "Um", companyId: EMPRESA_A },
        { nome: "Dois", companyId: EMPRESA_A },
      ]);
    });

    it("updateManyAndReturn é escopado no where como updateMany", async () => {
      const a = escopadoPara(EMPRESA_A);
      await (a as any).contact.updateManyAndReturn({ data: { nome: "Renomeada" } });

      expect((chamadas[0].args as any).where).toEqual({ companyId: EMPRESA_A });
      expect(tabelas.Contact.find((l) => l.id === "b1")).toMatchObject({ nome: "Bruno da B" });
    });
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  describe("operações por chave única", () => {
    const casos = [
      ["findUnique", "findFirst"],
      ["findUniqueOrThrow", "findFirst"],
      ["update", "updateMany"],
      ["delete", "deleteMany"],
      // A sugestão do `upsert` não é "updateMany" solto: é a receita inteira.
      // Afirmar só o pedaço deixava o teste passar mesmo que a mensagem
      // perdesse o `findFirst` e o `create`, que é o que ensina o caminho.
      ["upsert", "findFirst + create/updateMany"],
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

  /**
   * As travas das AFIRMAÇÕES UNIVERSAIS do arquivo.
   *
   * Três vezes seguidas este arquivo afirmou fechamento em prosa sem exercitar a
   * afirmação ("os dois buracos ficam fechados" com dois abertos; "toda recusa
   * em caminho aninhado" com quase nenhuma; "companyId não é único em nenhum dos
   * 11 modelos" com `BotConfig` tendo `@@unique([companyId])`). O padrão não é
   * descuido, é falta de trava — então toda frase de `escopo.ts` que diga "todo",
   * "sempre", "nenhum", "qualquer" ou "só" passa a ter, aqui, ou o caso que a
   * prova, ou uma qualificação escrita na própria frase dizendo o que não foi
   * verificado.
   */
  // Mesma razao do bloco anterior: payload incompleto de proposito e
  // operacoes que o tipo do delegate nao conhece -- e o runtime que esta
  // sob teste, nao o tipo.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  describe("afirmações universais de escopo.ts", () => {
    it("modelo fora do tenant passa INTACTO — mesma referência de args, em toda operação", () => {
      const args = { where: { id: "u1" }, data: { nome: "x" } };

      for (const operacao of [
        "findMany",
        "findUnique",
        "update",
        "upsert",
        "deleteMany",
        "groupBy",
        "operacaoQueNaoExiste",
      ]) {
        for (const model of ["User", "RateLimit", "Company"]) {
          // Identidade, não igualdade: prova que nada foi copiado nem acrescentado.
          expect(escoparArgumentos(model, operacao, args, EMPRESA_A)).toBe(args);
        }
      }
    });

    it("`Company` tem `id` como ÚNICO campo único — é o que fecha a lista branca", () => {
      const bloco = blocoDoModelo("Company");

      // Se `nome` ganhar `@unique`, ou se aparecer um `@@unique`, então
      // `CompanyWhereUniqueInput` passa a aceitar outro campo e a lista branca de
      // `exigirRelacaoDeEmpresaFechada` (só `connect: { id }`) deixa de ser
      // fechada — passaria a existir forma legítima que ela recusa.
      expect(bloco.filter((l) => /@unique/.test(l))).toEqual([]);
      expect(bloco.filter((l) => /^\s*id\s+String\s+@id/.test(l))).toHaveLength(1);
    });

    it("os 13 modelos de tenant nomeiam a relação `company` — a varredura depende do nome", () => {
      const semRelacao = [...MODELOS_DE_TENANT].filter(
        (m) => !blocoDoModelo(m).some((l) => /^\s*company\s+Company\b/.test(l))
      );

      // A varredura acha a relação pela CHAVE `company`. Um modelo que a nomeasse
      // de outro jeito escaparia da lista branca sem ninguém perceber.
      expect(semRelacao).toEqual([]);
    });

    it("`BotConfig` e `CompanyConfig` são os ÚNICOS modelos de tenant onde companyId é único", () => {
      const comCompanyIdUnico = [...MODELOS_DE_TENANT].filter((m) =>
        blocoDoModelo(m).some(
          (l) => /@@unique\(\[companyId\]\)/.test(l) || /^\s*companyId\s+String.*@unique/.test(l)
        )
      );

      // O bloco "Recusa, lançando" de `escopo.ts` diz quais são as exceções. A
      // frase já esteve errada duas vezes: primeiro dizia "nenhum dos 11"
      // (`BotConfig` desmentia), depois "só `BotConfig`" (o Ciclo 1c
      // acrescentou `CompanyConfig`, também uma linha por empresa). Um
      // TERCEIRO modelo aqui torna a frase de hoje errada de novo — e então o
      // caminho não é frouxar este caso, é reescrever a prosa de `escopo.ts`
      // junto com esta lista.
      //
      // Ordem: a do `MODELOS_DE_TENANT`, não alfabética — o `filter` preserva
      // a ordem de inserção do Set.
      expect(comCompanyIdUnico).toEqual(["BotConfig", "CompanyConfig"]);
    });

    it("`WhatsappConnection` é modelo de tenant, e a lista tem exatamente 13", () => {
      // Deriva: um modelo com `companyId` que ficasse FORA do Set passaria por
      // `escoparArgumentos` intacto — sem filtro, sem injeção, sem erro. É o
      // vazamento mais silencioso que este arquivo pode ter, e a única defesa
      // é esta igualdade exata.
      expect(MODELOS_DE_TENANT.has("WhatsappConnection")).toBe(true);
      expect(MODELOS_DE_TENANT.size).toBe(13);
    });

    it("`WhatsappConnection.webhookTokenHash` é `@unique` GLOBAL — e isso é deliberado", () => {
      const bloco = blocoDoModelo("WhatsappConnection");

      // Diferente de `Conversation.waId` (⚠️ R2 do Ciclo 1a): `waId` ERA
      // global-único sobre um identificador COMPARTILHÁVEL — o mesmo número
      // pode ser atendido por duas empresas, e por isso aquilo era defeito. A
      // Task 3 do Ciclo 1e o compôs (`@@unique([companyId, waId])`), e este
      // `webhookTokenHash` é o caso que NÃO acompanhou, de propósito: um token
      // de webhook é segredo de 256 bits, e duas empresas com o mesmo token é
      // estado que DEVE ser impossível. Se esta linha cair, a resolução do
      // webhook (Tarefa 7 do Ciclo 2a) perde a garantia de que um token aponta
      // uma conexão só — e "compor por simetria com as quatro do Ciclo 1e" é
      // exatamente o engano que o §9.5 daquele spec proíbe por escrito.
      expect(bloco.filter((l) => /^\s*webhookTokenHash\s+String\s+@unique/.test(l))).toHaveLength(1);
    });

    it("TODA mensagem lançada com escopo ativo carrega o companyId", async () => {
      const a = escopadoPara(EMPRESA_A);
      const cliente = a as any;

      const caminhosDeLancamento: [string, () => unknown][] = [
        ["where divergente", () => cliente.contact.findMany({ where: { companyId: EMPRESA_B } })],
        ["data divergente", () => cliente.contact.create({ data: { companyId: EMPRESA_B } })],
        ["operação por chave única", () => cliente.contact.findUnique({ where: { id: "x" } })],
        ["relação company no topo", () => cliente.contact.create({ data: { company: {} } })],
        [
          "forma recusada da relação",
          () =>
            cliente.lead.create({
              data: {
                canal: "WHATSAPP",
                stageId: "st_1",
                notes: { create: [{ texto: "n", autorId: "u1", company: { create: {} } }] },
              },
            }),
        ],
        [
          "operação não classificada",
          () => escoparArgumentos("Contact", "operacaoQueNaoExiste", {}, EMPRESA_A),
        ],
        [
          "teto de nós da varredura",
          () => {
            const fundo: Record<string, unknown> = {};
            let atual = fundo;
            for (let i = 0; i < 100_001; i += 1) {
              const proximo: Record<string, unknown> = {};
              atual["n" + i] = proximo;
              atual = proximo;
            }
            return escoparArgumentos("Contact", "create", { data: fundo }, EMPRESA_A);
          },
        ],
      ];

      for (const [nome, disparar] of caminhosDeLancamento) {
        const erro = await Promise.resolve()
          .then(disparar)
          .then(
            () => new Error(`${nome} NAO lancou`),
            (e: Error) => e
          );

        expect(erro, nome).toBeInstanceOf(EscopoDeEmpresaError);
        expect(erro.message, nome).toContain(EMPRESA_A);
      }
    });

    it("a única mensagem SEM companyId é a de companyId vazio — e é exceção nomeada", () => {
      let erro: Error | null = null;
      try {
        prismaDaEmpresa("", clienteBase());
      } catch (e) {
        erro = e as Error;
      }

      expect(erro).toBeInstanceOf(EscopoDeEmpresaError);
      // Não há escopo para citar: o erro É a ausência dele.
      expect(erro!.message).toContain("UsuarioAtivo.companyId");
    });

    it("operação inventada nunca desce até $allOperations — o delegate não a expõe", async () => {
      const a = escopadoPara(EMPRESA_A);

      expect((a as any).contact.operacaoQueOPrismaAindaNaoTem).toBeUndefined();
      // e o caminho que EXISTE continua descendo
      await (a as any).contact.findMany();
      expect(chamadas).toHaveLength(1);
    });

    it("escrita aninhada bem-sucedida é UMA operação só aos olhos da extensão", async () => {
      const a = escopadoPara(EMPRESA_A);
      await (a as any).lead.create({
        data: {
          canal: "WHATSAPP",
          stageId: "st_1",
          notes: { create: [{ texto: "n", autorId: "u1", companyId: EMPRESA_A }] },
        },
      });

      expect(chamadas).toHaveLength(1);
      expect(chamadas[0]).toMatchObject({ model: "Lead", operation: "create" });
    });

    it("no `where`, a injeção COMPÕE com o filtro do chamador em vez de substituí-lo", async () => {
      const a = escopadoPara(EMPRESA_A);
      await (a as any).contact.findMany({ where: { OR: [{ companyId: EMPRESA_B }] } });

      // O que se prova aqui é a composição dos ARGUMENTOS. Que topo em AND
      // devolva conjunto vazio é semântica do Prisma/SQL, e escopo.ts diz
      // textualmente que essa parte não foi medida contra o Postgres.
      expect((chamadas[0].args as any).where).toEqual({
        OR: [{ companyId: EMPRESA_B }],
        companyId: EMPRESA_A,
      });
    });

    it("`Date` no payload não cega a varredura", () => {
      expect(() =>
        escoparArgumentos(
          "Lead",
          "create",
          {
            data: {
              canal: "WHATSAPP",
              criadoEm: new Date(),
              notes: { create: [{ texto: "n", criadoEm: new Date(), companyId: EMPRESA_B }] },
            },
          },
          EMPRESA_A
        )
      ).toThrow(EscopoDeEmpresaError);
    });
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
});

/** Linhas do bloco `model X { ... }` do schema, sem a abertura nem o fecho. */
function blocoDoModelo(modelo: string): string[] {
  const caminho = fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url));
  const linhas = readFileSync(caminho, "utf8").split(/\r?\n/);
  const inicio = linhas.findIndex((l) => new RegExp(`^model\\s+${modelo}\\s*\\{`).test(l));
  expect(inicio, `modelo ${modelo} nao encontrado no schema`).toBeGreaterThanOrEqual(0);
  const fim = linhas.findIndex((l, i) => i > inicio && /^\}/.test(l));
  // Sem comentário: o bloco de `Company` CITA `@@unique([companyId])` de
  // `BotConfig` numa linha de comentário, e ler isso como declaração fazia o
  // caso de `Company` falhar por um motivo que não existe no schema.
  return linhas.slice(inicio + 1, fim).filter((l) => !/^\s*\/\//.test(l));
}

/**
 * A trava de deriva de `MODELOS_DE_TENANT`.
 *
 * O arquivo é fecha-fechado para OPERAÇÃO (a não classificada lança) e era o
 * contrário para MODELO: modelo fora do Set passa sem filtro nenhum, por
 * desenho — é assim que `User`, `RateLimit` e `Company` funcionam. A
 * consequência é que um modelo NOVO com `companyId` que ninguém acrescente ao
 * Set não dá erro: vaza calado, e nada no código percebe.
 *
 * Este caso é o que percebe. Ele lê o schema, extrai quem tem `companyId`
 * escalar e exige o conjunto EXATO. Adicionar tabela de tenant sem tocar o Set
 * passa a quebrar aqui, com o nome do modelo na mensagem.
 */
function modelosComCompanyIdNoSchema(): Set<string> {
  const caminho = fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url));
  const texto = readFileSync(caminho, "utf8");

  const encontrados = new Set<string>();
  let modeloAtual: string | null = null;

  for (const linha of texto.split(/\r?\n/)) {
    const abertura = /^model\s+(\w+)\s*\{/.exec(linha);
    if (abertura) {
      modeloAtual = abertura[1];
      continue;
    }
    if (/^\}/.test(linha)) {
      modeloAtual = null;
      continue;
    }
    // Campo ESCALAR chamado `companyId` — `companyId String`, com ou sem `?`,
    // com ou sem atributos depois. A relação (`company Company @relation(...)`)
    // tem outro nome e não casa; `@@index([companyId])` começa com `@@`.
    if (modeloAtual && /^\s*companyId\s+\w+/.test(linha)) encontrados.add(modeloAtual);
  }

  return encontrados;
}

describe("MODELOS_DE_TENANT não pode derivar do schema", () => {
  it("bate EXATAMENTE com os modelos que têm companyId em prisma/schema.prisma", () => {
    const noSchema = modelosComCompanyIdNoSchema();

    // Sem esta linha, um regex quebrado devolveria conjunto vazio e o teste
    // ainda acusaria — mas por "sobrando", que é a mensagem errada. Falhar
    // aqui diz a verdade: o leitor do schema é que parou de funcionar.
    expect(noSchema.size).toBeGreaterThan(0);

    const problemas = [
      ...[...noSchema]
        .filter((m) => !MODELOS_DE_TENANT.has(m))
        .map(
          (m) =>
            `${m} tem companyId no schema e NÃO está em MODELOS_DE_TENANT: ` +
            `operação nele passa SEM filtro de empresa (vazamento silencioso)`
        ),
      ...[...MODELOS_DE_TENANT]
        .filter((m) => !noSchema.has(m))
        .map(
          (m) =>
            `${m} está em MODELOS_DE_TENANT e NÃO tem companyId no schema: ` +
            `injetar o filtro nele quebra a query com erro de coluna inexistente`
        ),
    ];

    expect(problemas).toEqual([]);
  });
});
