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
