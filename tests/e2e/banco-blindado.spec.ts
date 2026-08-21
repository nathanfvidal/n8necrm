// Invariantes de segurança do banco, conferidas contra o Postgres de verdade.
//
// ## Por que isto existe, e por que aqui
//
// A auditoria da branch de tarefas encontrou o seguinte: toda tabela criada
// pelo papel `postgres` nascia com privilégio TOTAL para `anon` e
// `authenticated` — os dois papéis da API pública do Supabase. Nenhuma tabela
// estava exposta no momento da medição, porque alguém havia ligado RLS e
// revogado os grants À MÃO em cada uma das 13. A proteção existia e dependia
// de duas lembranças por tabela nova.
//
// A migração `20260813180000_blindar_privilegios_padrao` resolve metade: o
// privilégio padrão passou a excluir esses dois papéis, e isso vale sozinho
// para toda tabela futura.
//
// A outra metade não tem equivalente declarativo. **O Postgres não tem "RLS
// por padrão"**, e o Prisma não emite `ENABLE ROW LEVEL SECURITY` em migração
// nenhuma. Medido: uma tabela criada agora nasce com `relrowsecurity = false`.
// Contra isso não há configuração — há vigilância. Este arquivo é a
// vigilância.
//
// Fica em `tests/e2e/` e não em `tests/unit/` por um motivo prático: os
// unitários deste projeto são puros, sem banco e sem `dotenv`. Uma invariante
// sobre o banco REAL precisa do banco real, e a suíte e2e é onde a conexão
// existe e onde o portão de merge já passa. Não abre navegador — é um teste
// de banco vestido de Playwright.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { test, expect } from "@playwright/test";

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// `_prisma_migrations` é do próprio Prisma e não guarda dado de cliente, mas
// continua na lista de propósito: ela revela o histórico de schema, e não há
// razão nenhuma para a API pública alcançá-la.
test.afterAll(async () => {
  await prisma.$disconnect();
});

test("toda tabela do schema public tem RLS ligada", async () => {
  const semRls: { tabela: string }[] = await prisma.$queryRawUnsafe(`
    SELECT c.relname::text AS tabela
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
    ORDER BY 1`);

  // Mensagem com os nomes dentro: quem quebrar isto amanhã precisa saber QUAL
  // tabela, não só que "alguma" falhou. O conserto é uma linha no
  // `migration.sql` que a criou:
  //   ALTER TABLE "NomeDaTabela" ENABLE ROW LEVEL SECURITY;
  expect(
    semRls.map((t) => t.tabela),
    "tabela sem RLS no schema exposto — a API pública do Supabase alcança isto"
  ).toEqual([]);
});

test("nenhuma tabela concede privilegio a anon ou authenticated", async () => {
  const grants: { papel: string; tabela: string; priv: string }[] = await prisma.$queryRawUnsafe(`
    SELECT grantee::text AS papel, table_name::text AS tabela, privilege_type::text AS priv
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
    ORDER BY 1, 2, 3`);

  // RLS sem política já bloqueia estes papéis, então isto é a segunda
  // barreira, não a única. Vale manter as duas: RLS é comportamento em tempo
  // de consulta e pode ser desligada por engano numa migração futura; o grant
  // ausente é estrutural.
  expect(
    grants,
    "anon/authenticated têm acesso direto a tabela do CRM"
  ).toEqual([]);
});

test("o privilegio PADRAO nao volta a conceder acesso a tabela futura", async () => {
  // Esta é a invariante que a migração instalou. Sem ela, a próxima tabela
  // criada nasce concedida — foi exatamente o achado R1.
  const acls: { acl: string }[] = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(d.defaclacl::text, '') AS acl
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
    WHERE n.nspname = 'public'
      AND d.defaclrole::regrole::text = 'postgres'
      AND d.defaclobjtype IN ('r', 'S')`);

  const concedidos = acls.filter((a) => /\banon=|\bauthenticated=/.test(a.acl));

  expect(
    concedidos.map((a) => a.acl),
    "privilégio padrão voltou a conceder a anon/authenticated: toda tabela nova nascerá exposta"
  ).toEqual([]);
});

test("nenhuma tabela do CRM esta sem politica E sem RLS ao mesmo tempo", async () => {
  // RLS ligada e ZERO políticas nega tudo a quem não é dono da tabela — é a
  // postura deste projeto, e é deliberada: a aplicação conecta como dona
  // (`postgres`) e passa por cima da RLS, enquanto `anon`/`authenticated`
  // batem na porta fechada. O que NÃO pode existir é tabela sem RLS: aí não
  // há porta nenhuma.
  const expostas: { tabela: string }[] = await prisma.$queryRawUnsafe(`
    SELECT c.relname::text AS tabela
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity
      AND EXISTS (
        SELECT 1 FROM information_schema.role_table_grants g
        WHERE g.table_schema = 'public' AND g.table_name = c.relname
          AND g.grantee IN ('anon', 'authenticated')
      )
    ORDER BY 1`);

  // Esta é a combinação que significa "legível pela internet com a chave
  // anônima". Se algum dia der vermelho, é incidente, não tarefa.
  expect(
    expostas.map((t) => t.tabela),
    "tabela SEM RLS e COM grant público: legível pela internet"
  ).toEqual([]);
});

// ---------------------------------------------------------------------------
// O schema `realtime`: a vigilância que o Ciclo 3 vai EDITAR
// ---------------------------------------------------------------------------
//
// Tudo acima olha para o schema `public`. O canal do Ciclo 3 não passa por
// `public` — passa por `realtime`, e NENHUM dos quatro testes acima enxerga
// esse schema. Os três testes abaixo fecham esse ponto cego.
//
// A regra é a do spec do programa: **afirmar a exceção exata, nunca
// afrouxar**. Quando o Ciclo 3 abrir `SELECT` numa tabela com política
// filtrando por `auth.jwt() ->> 'company_id'`, estes testes são EDITADOS para
// nomear aquela política e aquele grant — nunca deletados, nunca
// transformados em `>= 0`. A diferença importa: editar uma afirmação aparece
// no diff como uma decisão; afrouxar um teste aparece como uma linha a menos
// que ninguém lê.
//
// O Ciclo 1b emite o JWT que essa política vai ler, e emitir o token não abre
// canal nenhum. Se algum destes ficar vermelho durante o 1b, alguma coisa
// saiu do escopo dele.

/**
 * O estado de fábrica dos grants do schema `realtime`, medido em 2026-08-20
 * contra `uzumzfxjcxrbxaucvfsr`.
 *
 * ## Por que isto não é `[]`
 *
 * O brief desta tarefa pedia `toEqual([])`, como no teste do schema `public`.
 * Medido: **são 8**, e nenhum deles é deste projeto. Quem os concede é o
 * próprio Supabase, ao instalar a extensão de Realtime — `realtime.messages`
 * (a tabela de Broadcast/Presence) e `realtime.subscription` (a de
 * `postgres_changes`) nascem assim em todo projeto. Revogá-los para deixar o
 * teste verde quebraria a infraestrutura de Realtime que o Ciclo 3 vai usar,
 * e o Ciclo 3 é justamente o que esta vigilância existe para proteger.
 *
 * Então a afirmação mais forte que é VERDADE aqui não é "zero grants", é
 * "exatamente estes oito, nenhum a mais". Fixar o conjunto é mais estrito que
 * contar: um grant NOVO fica vermelho, e um grant REMOVIDO também — inclusive
 * a remoção acidental que arrancaria o Realtime junto.
 *
 * `realtime.messages` está com RLS LIGADA e ZERO políticas (ver os dois testes
 * abaixo), então estes grants não abrem nada hoje: a porta existe e está
 * trancada. É a mesma postura do schema `public`, e é essa tranca que o Ciclo
 * 3 vai destrancar de forma nomeada.
 */
const GRANTS_REALTIME_DE_FABRICA = [
  { papel: "anon", tabela: "messages", priv: "INSERT" },
  { papel: "anon", tabela: "messages", priv: "SELECT" },
  { papel: "anon", tabela: "messages", priv: "UPDATE" },
  { papel: "anon", tabela: "subscription", priv: "SELECT" },
  { papel: "authenticated", tabela: "messages", priv: "INSERT" },
  { papel: "authenticated", tabela: "messages", priv: "SELECT" },
  { papel: "authenticated", tabela: "messages", priv: "UPDATE" },
  { papel: "authenticated", tabela: "subscription", priv: "SELECT" },
];

test("o schema realtime nao tem politica nenhuma — ainda", async () => {
  // Esta afirmação é o oposto de um afrouxamento: ela declara, HOJE, que a
  // exceção do Ciclo 3 NÃO existe.
  //
  // ## Por que lista as tabelas em vez de só afirmar "nenhuma política"
  //
  // "Zero políticas" é também o que uma consulta QUEBRADA devolve. Medido
  // nesta tarefa: com o `WHERE` trocado por `false`, a primeira versão —
  // que consultava `pg_policies` direto e afirmava `toEqual([])` — continuava
  // VERDE. Uma vigilância que não lê nada e não reclama.
  //
  // O `LEFT JOIN` conserta isso amarrando as duas leituras ao MESMO
  // predicado `n.nspname = 'realtime'`: a consulta é obrigada a devolver uma
  // linha por tabela de fábrica do schema, cada uma com a coluna `politicas`
  // vazia. Cegar o predicado zera as linhas e o teste fica vermelho — não
  // existe mais o resultado "vazio" que passava por bom.
  //
  // Quando o Ciclo 3 criar a política dele, `politicas` de `messages` deixa
  // de ser "" e este teste é EDITADO para nomear aquela política exata.
  const porTabela: { tabela: string; politicas: string }[] =
    await prisma.$queryRawUnsafe(`
    SELECT c.relname::text AS tabela,
           COALESCE(string_agg(p.policyname, ', ' ORDER BY p.policyname), '') AS politicas
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_policies p ON p.schemaname = n.nspname AND p.tablename = c.relname
    WHERE n.nspname = 'realtime' AND c.relkind IN ('r', 'p')
    GROUP BY 1 ORDER BY 1`);

  expect(
    porTabela,
    "ou apareceu política no schema realtime (canal aberto sem passar pelo Ciclo 3), " +
      "ou a varredura parou de enxergar o schema — nos dois casos investigue, não ajuste o esperado"
  ).toEqual([
    { tabela: "messages", politicas: "" },
    { tabela: "schema_migrations", politicas: "" },
    { tabela: "subscription", politicas: "" },
  ]);
});

test("o schema realtime nao ganhou nem perdeu grant desde a medicao de fabrica", async () => {
  // O teste do schema `public` cobre só `public`. O caminho do navegador que
  // este ciclo prepara passa por `realtime`, e um grant ali seria invisível
  // para toda a vigilância existente.
  const grants: { papel: string; tabela: string; priv: string }[] = await prisma.$queryRawUnsafe(`
    SELECT grantee::text AS papel, table_name::text AS tabela, privilege_type::text AS priv
    FROM information_schema.role_table_grants
    WHERE table_schema = 'realtime' AND grantee IN ('anon', 'authenticated')
    ORDER BY 1, 2, 3`);

  expect(
    grants,
    "o conjunto de grants de anon/authenticated no schema realtime mudou — " +
      "se foi o Ciclo 3, EDITE GRANTS_REALTIME_DE_FABRICA nomeando o grant novo"
  ).toEqual(GRANTS_REALTIME_DE_FABRICA);
});

test("realtime.messages continua com RLS ligada, que e o que tranca os grants de fabrica", async () => {
  // Sem este teste, os dois de cima mentem por omissão. `realtime.messages`
  // concede INSERT/SELECT/UPDATE a `anon` (ver GRANTS_REALTIME_DE_FABRICA);
  // o que impede a leitura hoje é RLS ligada com zero políticas. Desligar a
  // RLS abriria a tabela inteira SEM criar política nenhuma e SEM mexer em
  // grant nenhum — os outros dois testes continuariam verdes enquanto a
  // porta ficava escancarada.
  //
  // `relkind = 'p'`: `realtime.messages` é tabela PARTICIONADA. Filtrar por
  // `'r'`, como faz o teste do schema `public`, não a encontraria.
  const rls: { tabela: string; ligada: boolean }[] = await prisma.$queryRawUnsafe(`
    SELECT c.relname::text AS tabela, c.relrowsecurity AS ligada
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'realtime' AND c.relname = 'messages'
      AND c.relkind IN ('r', 'p')`);

  expect(
    rls,
    "realtime.messages sumiu ou está sem RLS: os grants de fábrica de anon/authenticated ficam valendo sozinhos"
  ).toEqual([{ tabela: "messages", ligada: true }]);
});
