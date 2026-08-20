import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";

/**
 * Cliente Prisma amarrado a UMA empresa.
 *
 * ## O que este arquivo é, e o que ele não é
 *
 * Ele é metade do isolamento por empresa. A outra metade é a regra de lint em
 * `eslint.config.mjs` que proíbe `src/core/**` e `src/modules/**` de importar
 * `@/lib/prisma` — porque o wrapper cobre o caminho comum e **não cobre tudo**
 * (a lista exata está mais abaixo). Sem o lint, o que este arquivo não alcança
 * vira um `import { prisma }` que ninguém revisa.
 *
 * Ele NÃO é RLS. `CLAUDE.md` já registra a armadilha: o Prisma conecta com o
 * papel dono da tabela, e política de linha não se aplica ao dono a menos que
 * `FORCE ROW LEVEL SECURITY` esteja ligada. A migração
 * `20260730212500_enable_rls_and_revoke_anon_grants` diz isso textualmente,
 * nas suas linhas 3-5:
 *
 *   "this app connects as the table owner via a direct DATABASE_URL/postgres
 *    role, which bypasses RLS unless FORCE ROW LEVEL SECURITY is set -- it is
 *    intentionally NOT set here"
 *
 * ## Por que não o exemplo oficial do Prisma (`set_config` + RLS)
 *
 * O exemplo de multi-tenancy da própria documentação do Prisma usa uma
 * extensão que roda `SELECT set_config('app.current_tenant_id', ...)` dentro
 * de uma transação e deixa o **Postgres** filtrar via política de linha. Isso
 * é estritamente mais forte que o que está aqui, porque o filtro passa a ser
 * do banco: nenhum caminho de código — nem `$queryRaw`, nem `findUnique` —
 * escapa dele.
 *
 * Este projeto não faz assim hoje porque adotá-lo exige ligar `FORCE ROW
 * LEVEL SECURITY` e escrever políticas por tabela, e as duas coisas
 * contradizem decisões em vigor: a migração acima desliga o FORCE de
 * propósito, e a blindagem de `anon`/`authenticated` (três migrações mais o
 * e2e `tests/e2e/banco-blindado.spec.ts`) parte do princípio de que o
 * caminho do navegador chega em ZERO tabela. Mudar isso é um ciclo próprio,
 * com migração, políticas e o e2e reescrito para AFIRMAR a exceção nomeada.
 * Fica registrado aqui como caminho de endurecimento futuro — não como
 * esquecimento.
 *
 * ## Os 11 modelos de tenant
 *
 * Medido em `prisma/schema.prisma` em 2026-08-20 (`awk` sobre os blocos
 * `model`, campo `companyId`): `Membership`, `Contact`, `PipelineStage`,
 * `Lead`, `LeadNote`, `Task`, `Notification`, `AuditLog`, `Conversation`,
 * `BotConfig`, `WhatsappMessage`.
 *
 * Ficam de FORA, e isso é deliberado:
 * - `User` — o comentário na linha 50 do schema diz por quê: "NÃO recebe
 *   `companyId`. A mesma pessoa pode ter `Membership` em VÁRIAS" empresas. A
 *   ligação pessoa↔empresa é o `Membership`, que É escopado.
 * - `RateLimit` — tabela global de defesa, consultada antes de existir
 *   sessão (e portanto antes de existir empresa).
 * - `Company` — é o próprio tenant; filtrar `Company.companyId` não existe.
 *
 * Operação em modelo fora dessa lista passa INTACTA. Isso é o correto e é
 * verificado no teste: injetar `where.companyId` em `User` produziria um erro
 * de coluna inexistente, não uma proteção.
 *
 * ## O que o wrapper alcança, e o que ele recusa
 *
 * **Alcança** (injeta `where.companyId` ou `data.companyId`): `findMany`,
 * `findFirst`, `findFirstOrThrow`, `count`, `aggregate`, `groupBy`,
 * `updateMany`, `updateManyAndReturn`, `deleteMany`, `create`, `createMany`,
 * `createManyAndReturn`.
 *
 * **Recusa, lançando**: `findUnique`, `findUniqueOrThrow`, `update`,
 * `delete`, `upsert`. O motivo é do Prisma, não uma escolha de gosto: o
 * `where` dessas operações é tipado como `XWhereUniqueInput` e só aceita
 * campo único (ou combinação `@@unique`). `companyId` sozinho não é único em
 * nenhum dos 11 modelos, então o Prisma recusa o campo ali — não existe onde
 * pendurar o filtro. Deixar passar sem filtro devolveria a linha de OUTRA
 * empresa a quem pedisse pelo id; lançar transforma isso em erro de
 * desenvolvimento, na hora, com o nome da operação escopável equivalente na
 * mensagem.
 *
 * **Não alcança de jeito nenhum**: `$queryRaw`/`$executeRaw`. Eles não passam
 * por `$allModels`, e por isso o lint é a peça central — é ele que garante
 * que chegar no `prisma` cru para fazer SQL exige uma exceção visível.
 *
 * **Também não alcança escrita ANINHADA.** `contact.create({ data: { notes:
 * { create: [...] } } })` é UMA operação aos olhos da extensão: o
 * `$allOperations` vê `Contact.create` e nunca vê o `LeadNote.create` que
 * acontece dentro. O `companyId` do aninhado não é injetado. Isso não vaza
 * calado, porque a Task 1 tornou `companyId` `NOT NULL` nos 11 modelos e o
 * Prisma recusa o aninhado sem ele — mas o erro vem do banco, não daqui, e
 * quem ler o erro precisa saber que a causa é esta.
 *
 * ## O tipo não sabe o que o runtime faz
 *
 * Medido em 2026-08-20 com `npm run typecheck` sobre o teste desta tarefa:
 * uma extensão `query` do Prisma altera os argumentos em tempo de execução e
 * **não** altera os TIPOS deles. `prismaDaEmpresa(x).contact.create({ data:
 * { nome, telefone } })` compila com erro — `ContactCreateInput` continua
 * exigindo `companyId`, mesmo que o escopo vá injetá-lo um instante depois.
 *
 * O efeito prático é benigno, e vale dizer qual é: hoje os chamadores já
 * passam `companyId` (é o que a Task 1 tornou obrigatório), então para eles o
 * escopo age como VERIFICADOR — confere que o valor bate e recusa se não
 * bater — em vez de preenchedor. A injeção continua importando para código
 * novo escrito sem `companyId`, e é o que o teste exercita.
 *
 * Não há como corrigir isso dentro de uma extensão `query`; corrigir exigiria
 * uma fachada tipada por modelo, que é superfície própria e não cabe nesta
 * tarefa. Fica registrado, não escondido.
 *
 * ## Sem estado global, de propósito
 *
 * O `companyId` entra como parâmetro. Nada de `AsyncLocalStorage`: ele
 * funciona até o primeiro caminho que roda fora do ciclo de requisição (job
 * de fila, seed, script), que é exatamente onde ninguém está olhando quando
 * o escopo some.
 */
export class EscopoDeEmpresaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "EscopoDeEmpresaError";
  }
}

/**
 * Os modelos que têm `companyId`, em PascalCase — que é como o Prisma nomeia
 * o modelo dentro de `$allOperations` (`model: "Contact"`, não `"contact"`;
 * observado na sondagem de 2026-08-20).
 */
export const MODELOS_DE_TENANT: ReadonlySet<string> = new Set([
  "Membership",
  "Contact",
  "PipelineStage",
  "Lead",
  "LeadNote",
  "Task",
  "Notification",
  "AuditLog",
  "Conversation",
  "BotConfig",
  "WhatsappMessage",
]);

/** Operações cujo `where` aceita filtro comum — dá para injetar `companyId`. */
const OPERACOES_COM_WHERE = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "updateManyAndReturn",
  "deleteMany",
]);

/** Operações que gravam linha nova — a injeção é em `data`, não em `where`. */
const OPERACOES_COM_DATA = new Set(["create", "createMany", "createManyAndReturn"]);

/**
 * Operações por chave única, e a equivalente escopável que a mensagem sugere.
 * `upsert` não tem equivalente de uma chamada só: em transação, `findFirst`
 * escopado decide entre `create` e `updateMany`.
 */
const OPERACOES_POR_CHAVE_UNICA: Record<string, string> = {
  findUnique: "findFirst",
  findUniqueOrThrow: "findFirstOrThrow",
  update: "updateMany",
  delete: "deleteMany",
  upsert: "findFirst + create/updateMany dentro de uma transação",
};

function exigirCoerencia(campo: string, valor: unknown, companyId: string, onde: string) {
  if (valor === undefined) return;
  if (valor === companyId) return;
  throw new EscopoDeEmpresaError(
    `${onde} recebeu ${campo}=${JSON.stringify(valor)}, mas o escopo é ${JSON.stringify(companyId)}. ` +
      `O escopo NÃO sobrescreve em silêncio: divergência aqui é bug ou ataque, e os dois merecem parar. ` +
      `Remova o campo (o escopo injeta) ou use o cliente da empresa certa.`
  );
}

function injetarEmData(dado: unknown, companyId: string, onde: string): unknown {
  if (dado === null || typeof dado !== "object") return dado;
  const registro = dado as Record<string, unknown>;

  // `data: { company: { connect: { id } } }` é a forma por relação. O Prisma
  // recusa `companyId` e `company` juntos no mesmo `data`, então injetar aqui
  // trocaria um erro de escopo por um erro obscuro do Prisma. Lançar com nome
  // próprio é mais útil que isso.
  if ("company" in registro) {
    throw new EscopoDeEmpresaError(
      `${onde} passou a relação \`company\` em \`data\`. Sob escopo, a empresa vem do cliente — ` +
        `remova \`company\` e deixe o escopo injetar \`companyId\`.`
    );
  }

  exigirCoerencia("data.companyId", registro.companyId, companyId, onde);
  return { ...registro, companyId };
}

/**
 * Devolve um cliente Prisma que só enxerga (e só grava em) `companyId`.
 *
 * O segundo parâmetro existe por dois motivos, nesta ordem de importância:
 * dentro de `$transaction` o cliente é o `tx`, não o global (mesmo padrão de
 * `companyIdDoUsuario` em `core/users/empresa.ts`); e ele é o que permite ao
 * teste unitário montar um banco falso por baixo sem abrir conexão. Em código
 * de produção normal, omita-o.
 *
 * A extensão devolvida é a MAIS EXTERNA da cadeia: medido em 2026-08-20 no
 * Prisma 7.9.1 desta árvore, em `cliente.$extends(A).$extends(B)` a extensão
 * A roda primeiro e só alcança B se chamar `query()`. Quem estender o
 * resultado desta função depois fica POR DENTRO do escopo — que é a ordem
 * desejada, e a que o teste usa.
 */
export function prismaDaEmpresa(companyId: string, cliente: PrismaClient = prisma) {
  if (!companyId) {
    throw new EscopoDeEmpresaError(
      "prismaDaEmpresa() recebeu companyId vazio. A origem é `UsuarioAtivo.companyId` " +
        "(core/auth/usuario-ativo.ts) — nunca `prisma.company.findFirst()`."
    );
  }

  return cliente.$extends({
    // Nome CONSTANTE, não `escopo-empresa:${companyId}`. O `companyId` no
    // nome ajudaria a ler um stack trace, mas geraria um nome distinto por
    // empresa e por requisição, e o Prisma não documenta o que faz com nomes
    // de extensão além de exibi-los — inventar cardinalidade infinita numa
    // string que não controlamos não vale o ganho de leitura. Quem precisa do
    // valor tem a mensagem do `EscopoDeEmpresaError`, que sempre o carrega.
    name: "escopo-empresa",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!MODELOS_DE_TENANT.has(model)) return query(args);

          const onde = `${model}.${operation}`;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const argumentos = (args ?? {}) as any;

          if (OPERACOES_COM_WHERE.has(operation)) {
            exigirCoerencia(
              "where.companyId",
              argumentos.where?.companyId,
              companyId,
              onde
            );
            return query({
              ...argumentos,
              where: { ...(argumentos.where ?? {}), companyId },
            });
          }

          if (OPERACOES_COM_DATA.has(operation)) {
            const dados = argumentos.data;
            return query({
              ...argumentos,
              data: Array.isArray(dados)
                ? dados.map((d: unknown) => injetarEmData(d, companyId, onde))
                : injetarEmData(dados, companyId, onde),
            });
          }

          const equivalente = OPERACOES_POR_CHAVE_UNICA[operation];
          if (equivalente) {
            throw new EscopoDeEmpresaError(
              `${onde} não é escopável por empresa: o \`where\` dela só aceita campo único, ` +
                `e \`companyId\` não é único em ${model} — o Prisma recusa o campo ali. ` +
                `Use \`${equivalente}\` no cliente escopado. ` +
                `Devolver a linha sem filtro entregaria dado de outra empresa a quem soubesse o id.`
            );
          }

          // Fecha fechado: operação de modelo que este arquivo não classificou
          // (o Prisma pode acrescentar uma) para em vez de passar sem filtro.
          throw new EscopoDeEmpresaError(
            `${onde} é uma operação que o escopo de empresa ainda não classifica. ` +
              `Classifique-a em core/tenancy/escopo.ts antes de usá-la — passar sem filtro ` +
              `seria vazamento silencioso entre empresas.`
          );
        },
      },
    },
  });
}
