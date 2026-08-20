# n8necrm — Ciclo 1a (Tenancy) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O modelo de dados multi-empresa por baixo da aplicação — `Company`, `Membership`, `companyId` nas tabelas de tenant — com o papel vindo do vínculo e um mecanismo que faz esquecer o escopo doer no lint, não na revisão.

**Architecture:** Migração em passos ordenados (criar, preencher, então restringir). `usuarioAtual()` passa a devolver um tipo próprio que **preserva o campo `papel`**, para as 26 chamadas de autorização não mudarem. O escopo é um client Prisma estendido, entregue por uma fábrica que exige `companyId`, e o acesso ao `prisma` cru passa a ser proibido por `no-restricted-imports` em `core/` e `modules/` — o mesmo mecanismo que a base já usa para a fronteira `core`↛`modules`.

**Tech Stack:** Prisma 7.9 + `@prisma/adapter-pg`, Postgres 17.6 (Supabase), Auth.js v5, Vitest 4, ESLint 9.

**Spec:** `docs/superpowers/specs/2026-08-19-ciclo-1a-tenancy-design.md`

## Global Constraints

- **Idioma do código é português.** Comentário explica **por que**, com evidência.
- **Antes de qualquer trabalho de banco, invocar as três skills juntas:** `supabase`, `supabase-postgres-best-practices`, `auditing-supabase-security`. É regra do `CLAUDE.md` global do usuário, e este ciclo é schema, migração e índice.
- **Este projeto usa migrations do Prisma**, não o CLI do Supabase. `supabase db pull`, schema declarativo e `supabase migration new` **não se aplicam** — as migrations são arquivos SQL em `prisma/migrations/`, aplicados por `prisma migrate deploy`.
- **Nenhuma política RLS neste ciclo.** Nem uma. É decisão 3 do spec.
- **Nenhum dos 26 lugares que chamam `hasPermission` pode ser editado.** É o critério que prova que a refatoração não vazou.
- **Não rodar `npm test`** salvo quando um passo pedir explicitamente: a suíte executa o seed contra o banco de desenvolvimento real e reescreve a senha do admin. Rodar os arquivos focados.
- Nenhum segredo no repositório. Nunca ler nem imprimir o `.env`.
- Toda mensagem de commit termina com:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **Branch de trabalho: `ciclo-1a-tenancy`**, criada a partir de `ciclo-4-fluxos`.

## Linha de base medida em 2026-08-19 — não presumir, conferir se mudou

| Medida | Valor |
| --- | --- |
| Chamadas a `hasPermission()` em `src/` (fora de `permissions.ts`) | 26 |
| Arquivos que tocam `.papel` | 25 |
| Advisor de segurança | 13 × `rls_enabled_no_policy` (INFO) + 2 × WARN de `rls_auto_enable` |
| Modelos no schema | 12 |

O advisor tem que continuar exatamente assim no fim do ciclo, **mais** as duas
tabelas novas em `rls_enabled_no_policy` — `Company` e `Membership` nascem com
RLS ligada pelo gatilho `rls_auto_enable()` da plataforma, e sem política é o
estado correto.

## O que este ciclo NÃO faz, e por quê

**Aplicar o escopo em todos os serviços do `core`.** É o volume mecânico da
mudança — dezenas de funções em `leads`, `contacts`, `tasks`, `pipeline`,
`notifications`, `users` — e cada uma é uma chance de filtrar pela coluna errada
ou esquecer um caminho de escrita. Merece ciclo e revisão próprios.

Este ciclo entrega o mecanismo e **prova em um serviço de ponta a ponta**
(`leads`), com teste de isolamento. Os demais ficam importando o `prisma` cru
por uma exceção **nomeada e datada** na regra de ESLint, que o próximo ciclo
remove uma a uma. A exceção é visível e conta quantos faltam; disciplina não
conta nada.

---

### Task 1: Schema e migração

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_tenancy_company_membership/migration.sql`
- Modify: `prisma/seed.ts`
- Test: `tests/unit/migracoes-seguras.test.ts` (existente — conferir se afirma algo sobre o schema)

**Interfaces:**
- Produces: modelos `Company { id, nome, criadoEm, atualizadoEm }` e
  `Membership { id, userId, companyId, papel, criadoEm }` com
  `@@unique([userId, companyId])`; coluna `companyId String` **NOT NULL** com FK
  e índice em `Contact`, `PipelineStage`, `Lead`, `LeadNote`, `Task`,
  `Notification`, `Conversation`, `WhatsappMessage`, `AuditLog`, `BotConfig`.
  `BotConfig.id` passa a `cuid()` com `@@unique([companyId])`.
  `User.papel` **continua existindo** ao fim desta tarefa — a Task 2 a derruba.

**OBRIGATÓRIO antes de começar:** invocar `supabase`,
`supabase-postgres-best-practices` e `auditing-supabase-security`, as três.

- [ ] **Step 1: Ler as três migrations de segurança da base antes de escrever SQL**

```bash
cd "d:/Projetos Programação/N8n + Crm"
cat prisma/migrations/20260730212500_enable_rls_and_revoke_anon_grants/migration.sql
cat prisma/migrations/20260813180000_blindar_privilegios_padrao/migration.sql
```

Elas explicam, no próprio comentário, por que RLS está ligada sem política e por
que os privilégios padrão foram revogados. **Sua migração não pode desfazer
nada disso.** As tabelas novas devem terminar no mesmo estado que as 13 atuais:
RLS ligada, zero políticas, zero grant para `anon`/`authenticated`.

Confirme também qual é o estado atual, no banco, antes de mexer:

```sql
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
SELECT grantee, table_name FROM information_schema.role_table_grants
WHERE grantee IN ('anon','authenticated') AND table_schema = 'public';
```

A segunda tem que devolver zero linhas. Cole as duas saídas no relatório.

- [ ] **Step 2: Editar `prisma/schema.prisma`**

Acrescentar os dois modelos e a coluna. Pontos que **não** são opcionais:

```prisma
model Company {
  id           String        @id @default(cuid())
  nome         String
  criadoEm     DateTime      @default(now())
  atualizadoEm DateTime      @updatedAt
  memberships  Membership[]
  // ... relações inversas das tabelas de tenant
}

/// Vínculo entre pessoa e empresa, e é ONDE O PAPEL VIVE.
///
/// Papel é relação, não atributo: a mesma pessoa pode ser ADMIN na própria
/// empresa e VENDEDOR na de um cliente que ela atende. Enquanto `papel` era
/// coluna de `User`, isso era inexprimível.
///
/// `@@unique([userId, companyId])` porque dois vínculos da mesma pessoa com a
/// mesma empresa não significam nada — e permitir isso faria a resolução de
/// "qual papel?" depender de qual linha o banco devolvesse primeiro.
model Membership {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  companyId String
  company   Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  papel     Role
  criadoEm  DateTime @default(now())

  @@unique([userId, companyId])
  // `usuarioAtual()` busca por userId em toda requisição.
  @@index([userId])
  @@index([companyId])
}
```

Em cada tabela de tenant, `companyId String` + relação + `@@index([companyId])`.

**Índices compostos existentes precisam de atenção.** Onde a query passa a ter
`companyId` como predicado, ele entra como **primeira** coluna do índice —
índice composto só serve query que filtra pelo prefixo. O caso concreto:
`WhatsappMessage` tem hoje `@@index([conversationId, direcao, processadoEm])`,
usado por `turno.ts` a cada job. Decida e **explique no comentário** se ele
passa a `[companyId, conversationId, direcao, processadoEm]` ou se fica como
está porque `conversationId` já é seletivo o bastante. Leia o comentário
existente do índice antes de decidir.

**`BotConfig`** perde o truque de linha única por PK constante:

```prisma
model BotConfig {
  /// Era `@default("bot-config")`, e a unicidade vinha de um segundo `create`
  /// colidir na PK. Config por empresa quebra isso: passariam a existir várias
  /// linhas legítimas. A unicidade continua imposta pelo BANCO, por
  /// `@@unique([companyId])` — uma config por empresa — em vez de por PK
  /// constante.
  id        String @id @default(cuid())
  companyId String
  // ...
  @@unique([companyId])
}
```

- [ ] **Step 3: Achar todo `where` que dependia do id constante**

```bash
cd "d:/Projetos Programação/N8n + Crm"
grep -rn "bot-config" src/ prisma/ tests/ config/
```

Cada um desses passa a buscar por `companyId`. **Este é o passo que o
compilador não protege:** `findUnique({ where: { id: "bot-config" } })` continua
compilando e passa a devolver `null` para sempre. Liste no relatório quantos
encontrou e o que fez com cada um.

- [ ] **Step 4: Escrever a migração à mão, em passos ordenados**

Não use `prisma migrate dev` para gerar isso — ele não sabe fazer backfill e vai
tentar `NOT NULL` numa tabela com linhas, o que falha. Crie o diretório e o
`migration.sql` à mão, seguindo o padrão de nome dos que já existem.

A ordem é obrigatória:

1. `CREATE TABLE "Company"`, `CREATE TABLE "Membership"` (+ índices, + FKs)
2. `INSERT` de **uma** empresa para os dados existentes
3. `INSERT` de um `Membership` por `User`, **copiando `User.papel`**
4. `ALTER TABLE ... ADD COLUMN "companyId" TEXT` — **sem** `NOT NULL`
5. `UPDATE` preenchendo com o id da empresa criada
6. `ALTER COLUMN ... SET NOT NULL` + `ADD CONSTRAINT` das FKs + `CREATE INDEX`
7. `BotConfig`: novo id, `@@unique([companyId])`
**`User.papel` NÃO é derrubada aqui.** Ela sai na Task 2, numa segunda
migração, logo depois de `usuarioAtual()` parar de lê-la.

O motivo é de ordem, não de gosto: derrubar a coluna nesta tarefa regenera o
client do Prisma sem `papel`, e os 26 lugares que fazem `usuario.papel` param de
compilar **antes** de a Task 2 existir para consertá-los. O repositório ficaria
quebrado entre duas tarefas, e o `typecheck` de fechamento desta seria
impossível de passar.

A verificação que protege o `DROP` está escrita abaixo porque pertence a este
raciocínio, mas o SQL dela vai no `migration.sql` da **Task 2**:

```sql
-- Não derruba `User.papel` sem provar que ninguém perde o papel.
--
-- A alternativa considerada e descartada era manter a coluna por um ciclo,
-- "para divergência ser detectável". Detectável por quem? Nada iria conferir.
-- Duas fontes de verdade para AUTORIZAÇÃO não são rede de segurança, são a
-- falha esperando alguém ler a errada. Aqui a conferência acontece no único
-- momento em que ainda dá para desfazer: antes do DROP, dentro da transação
-- da migração.
DO $$
DECLARE
  faltando integer;
BEGIN
  SELECT count(*) INTO faltando
  FROM "User" u
  WHERE NOT EXISTS (
    SELECT 1 FROM "Membership" m
    WHERE m."userId" = u.id AND m.papel = u.papel
  );

  IF faltando > 0 THEN
    RAISE EXCEPTION
      'Abortando: % usuário(s) sem Membership com o papel que User.papel declara. Nada foi apagado.',
      faltando;
  END IF;
END $$;
```

**Também RLS e grants nas tabelas novas.** O gatilho `rls_auto_enable()` da
plataforma liga RLS sozinho no `CREATE TABLE`, mas **não** revoga grant. Siga o
que `20260730212500` faz: `REVOKE ALL ON TABLE ... FROM anon, authenticated`
para `Company` e `Membership`, com comentário dizendo que é o mesmo raciocínio
de duas camadas independentes.

- [ ] **Step 5: Atualizar `prisma/seed.ts`**

O seed passa a criar a empresa, criar os usuários, e criar o vínculo com o
papel. `BotConfig` passa a ser semeada por empresa.

Leia o seed inteiro antes: ele é idempotente por `upsert`, e tem a lógica de
`SEED_PASSWORD` que o Ciclo 0 corrigiu. **Não quebre a idempotência** — rodar
duas vezes não pode criar duas empresas.

- [ ] **Step 6: Aplicar e provar**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx prisma migrate deploy
npx prisma db seed
npx prisma migrate status
```

Depois, por consulta ao **catálogo** e não por leitura do schema:

```sql
-- companyId NOT NULL em todas as de tenant, e ausente em User/RateLimit
SELECT table_name, is_nullable FROM information_schema.columns
WHERE table_schema='public' AND column_name='companyId' ORDER BY table_name;

-- toda companyId tem índice
SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE schemaname='public' AND indexdef LIKE '%companyId%' ORDER BY tablename;

-- RLS ligada nas duas novas, e zero grants
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename IN ('Company','Membership');
SELECT count(*) FROM information_schema.role_table_grants
WHERE grantee IN ('anon','authenticated') AND table_schema='public';

-- BotConfig recusa a segunda config da mesma empresa
-- (rode e espere ERRO de unique violation; é a prova)
```

Cole tudo. O `count` de grants tem que ser **0**.

- [ ] **Step 7: Commit**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git add prisma/
git commit -m "feat(tenancy): Company, Membership e companyId nas tabelas de tenant

O papel passa a viver no vinculo: papel e relacao entre pessoa e empresa, nao
atributo da pessoa. Esta migracao COPIA o papel para o Membership e deixa
User.papel de pe -- derruba-la aqui quebraria o typecheck dos 26 lugares que
a leem, antes de a tarefa seguinte existir para consertar. O DROP, e a
verificacao que o protege, vao na proxima.

BotConfig perde o id constante que impunha linha unica; a unicidade passa a
ser @@unique([companyId]), imposta pelo banco do mesmo jeito por outro
caminho. RateLimit NAO recebe companyId: e infraestrutura global, indexada
por IP.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `usuarioAtual()` resolve empresa e papel

**Files:**
- Modify: `src/core/auth/session.ts`
- Create: `src/core/auth/usuario-ativo.ts` (o tipo, separado para quem só precisa nomeá-lo não importar `server-only`)
- Test: `tests/unit/session.test.ts` (existente)
- Test: `tests/unit/usuario-ativo.test.ts` (novo)

**Interfaces:**
- Consumes: `Membership` (Task 1).
- Produces: `interface UsuarioAtivo { id, nome, email, ativo, companyId, papel }`; `usuarioAtual(): Promise<UsuarioAtivo>`; `usuarioAtualOuLogin(): Promise<UsuarioAtivo>`.

**O critério que define esta tarefa:** nenhum dos 26 lugares que chamam
`hasPermission(usuario.papel, ...)` pode ser editado. O campo `papel` continua
existindo com o mesmo nome e o mesmo tipo; só a origem muda.

- [ ] **Step 1: Contar as chamadas ANTES, para comparar depois**

```bash
cd "d:/Projetos Programação/N8n + Crm"
grep -rn "hasPermission(" src/ --include=*.ts --include=*.tsx | grep -v "permissions.ts" | wc -l
grep -rn "hasPermission(" src/ --include=*.ts --include=*.tsx | grep -v "permissions.ts" > /tmp/antes.txt
```

Guarde o número. No fim da tarefa, o mesmo comando tem que dar o mesmo número e
o `diff` do arquivo tem que ser vazio.

- [ ] **Step 2: Escrever o teste que falha**

Criar `tests/unit/usuario-ativo.test.ts`. Casos, todos com `prisma` mockado:

- usuário com **um** vínculo → devolve `companyId` e o `papel` **do vínculo**
- usuário com **zero** vínculo → lança `Error("Não autenticado")`, mesma
  mensagem de usuário desativado (`ehSessaoInvalida` em `src/lib/acao.ts`
  reconhece essa string exata — confira antes de escrever)
- usuário com **dois** vínculos → lança, com mensagem que **nomeia** a situação
  e é diferente de "Não autenticado" (não é sessão inválida, é conta que a UI
  ainda não sabe servir)
- usuário desativado → lança, como antes
- o `papel` devolvido é o do vínculo, **não** o de nenhuma coluna de `User`

Lembre: `@testing-library/jest-dom` e `user-event` **não** estão instalados.

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/usuario-ativo.test.ts
```

Guarde a saída — evidência RED.

- [ ] **Step 4: Criar `src/core/auth/usuario-ativo.ts`**

```ts
import type { Role } from "@prisma/client";

/**
 * Quem está agindo, e em qual empresa.
 *
 * NÃO é o modelo `User` do Prisma, e isso é deliberado por dois motivos.
 *
 * **O campo `papel` sobrevive de propósito.** Vinte e seis lugares fazem
 * `hasPermission(usuario.papel, acao)`. Se o retorno de `usuarioAtual()`
 * trocasse a forma, os 26 precisariam ser editados — e cada edição manual num
 * `hasPermission` é uma chance de trocar a ação, inverter a condição ou
 * esquecer o `!`, produzindo falha de autorização que nenhum compilador pega.
 * Preservando o campo, a refatoração vira invisível para eles, e "nenhum
 * consumidor mudou" passa a ser o critério que PROVA que ela não vazou.
 *
 * **Deixar de ser o modelo do Prisma é ganho, não perda.** Quem dependia de
 * campo que não está aqui — `senhaHash`, por exemplo — para de compilar. Nada
 * fora de `core/auth` tem por que ler hash de senha.
 */
export interface UsuarioAtivo {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  /** Empresa ativa desta requisição. Todo escopo de query sai daqui. */
  companyId: string;
  /** Papel do usuário NESTA empresa — vem de `Membership`, não de `User`. */
  papel: Role;
}

/**
 * Lançado quando a conta tem mais de um vínculo.
 *
 * Separado de "Não autenticado" porque não é sessão inválida: a sessão é
 * legítima, a aplicação é que ainda não sabe qual empresa servir. Tratar as
 * duas como a mesma coisa mandaria a pessoa para o login num loop, sem nunca
 * dizer o que está errado.
 */
export class EmpresaAmbiguaError extends Error {
  constructor(readonly quantidade: number) {
    super(
      `Sua conta está vinculada a ${quantidade} empresas e o seletor de empresa ainda não existe. ` +
        `Fale com quem administra o sistema.`
    );
    this.name = "EmpresaAmbiguaError";
  }
}
```

- [ ] **Step 5: Reescrever `usuarioAtual()`**

Uma consulta só, trazendo os vínculos junto — não duas idas ao banco. Mantenha
o `cache()` do React que já está lá (dedupe por requisição) e o comentário que o
explica.

```ts
export const usuarioAtual = cache(async function usuarioAtual(): Promise<UsuarioAtivo> {
  const session = await auth();
  if (!session?.user?.email) {
    throw new Error("Não autenticado");
  }

  // `include` e não duas queries: o vínculo é obrigatório para montar o
  // resultado, então buscá-lo depois seria uma segunda ida ao banco em TODA
  // requisição autenticada do sistema.
  const usuario = await prisma.user.findUniqueOrThrow({
    where: { email: session.user.email },
    include: { memberships: true },
  });

  if (!usuario.ativo) {
    throw new Error("Não autenticado");
  }

  // Zero vínculo é tratado como sessão inválida, e não como erro próprio: uma
  // conta sem empresa não tem nada que possa ser servido a ela, e deixá-la
  // entrar num estado sem escopo é exatamente como vazamento entre tenants
  // começa.
  if (usuario.memberships.length === 0) {
    throw new Error("Não autenticado");
  }

  // Mais de um vínculo LANÇA em vez de escolher.
  //
  // A alternativa considerada e descartada era "o vínculo mais antigo". Isso é
  // um chute com cara de regra: nada no domínio diz que o mais antigo é o que
  // a pessoa quer, e o modo de falha é servir dado da EMPRESA ERRADA. Falhar
  // aqui custa zero hoje — a migração cria um vínculo por pessoa, então a
  // situação é inalcançável — e o dia em que alguém criar o segundo por SQL, o
  // erro aponta a causa em vez de a aplicação seguir servindo dado de uma
  // empresa que ninguém escolheu.
  if (usuario.memberships.length > 1) {
    throw new EmpresaAmbiguaError(usuario.memberships.length);
  }

  const vinculo = usuario.memberships[0]!;

  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    ativo: usuario.ativo,
    companyId: vinculo.companyId,
    papel: vinculo.papel,
  };
});
```

Confira o nome real do campo de nome em `User` (`nome`?) antes de escrever.

- [ ] **Step 6: Rodar, e provar que os 26 não mudaram**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/usuario-ativo.test.ts tests/unit/session.test.ts
npm run typecheck
grep -rn "hasPermission(" src/ --include=*.ts --include=*.tsx | grep -v "permissions.ts" | wc -l
grep -rn "hasPermission(" src/ --include=*.ts --include=*.tsx | grep -v "permissions.ts" > /tmp/depois.txt
diff /tmp/antes.txt /tmp/depois.txt && echo ">>> nenhuma chamada de hasPermission mudou"
```

O `diff` vazio é o entregável desta tarefa tanto quanto o código.

**Se o typecheck reclamar em algum consumidor**, leia o erro antes de editar: se
for por campo de `User` que não está em `UsuarioAtivo` (tipo `senhaHash`), isso
é o comportamento pretendido e o consumidor é que estava lendo o que não devia —
reporte qual, não contorne acrescentando o campo ao tipo.

- [ ] **Step 7: Só agora, derrubar `User.papel`**

Nada mais lê a coluna. Crie uma segunda migração, à mão, com **a verificação
antes do `DROP`** (o SQL está na Task 1, na seção da ordem da migração).

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx prisma migrate deploy
npm run typecheck
npx vitest run tests/unit/usuario-ativo.test.ts tests/unit/session.test.ts
```

Prove que a coluna sumiu e que o papel sobreviveu:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='User' AND column_name='papel';
-- espera-se ZERO linhas

SELECT u.email, m.papel FROM "User" u JOIN "Membership" m ON m."userId" = u.id ORDER BY u.email;
-- espera-se um vinculo por usuario, com o papel que a coluna dizia
```

**Se a verificação da migração abortar, não force.** Ela abortou porque algum
usuário ficaria sem papel — reporte quem, com a saída, e pare. É exatamente o
caso para o qual ela existe.

- [ ] **Step 8: Commit**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git add src/core/auth tests/unit/usuario-ativo.test.ts prisma/
git commit -m "feat(tenancy): usuarioAtual resolve empresa e papel pelo vinculo

Preserva o campo papel de proposito: as 26 chamadas de hasPermission nao
mudaram uma linha, e o diff vazio delas e o que PROVA que a refatoracao nao
vazou. Editar 26 checagens de autorizacao a mao sao 26 chances de inverter
uma condicao sem o compilador notar.

Mais de um vinculo LANCA em vez de escolher o mais antigo: escolher em
silencio troca um erro impossivel hoje por leitura de dado da empresa
errada depois.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: O mecanismo de escopo, e o lint que o torna obrigatório

**Files:**
- Create: `src/core/tenancy/escopo.ts`
- Modify: `eslint.config.mjs`
- Test: `tests/unit/escopo-empresa.test.ts`

**Interfaces:**
- Consumes: `companyId` de `UsuarioAtivo` (Task 2).
- Produces: `prismaDaEmpresa(companyId: string)` devolvendo um client Prisma estendido que injeta `companyId` nas operações onde a injeção é sólida; e a regra de lint que proíbe importar `@/lib/prisma` de dentro de `src/core/**` e `src/modules/**`.

**O que este mecanismo alcança, e o que não.** Sejamos exatos, porque a
diferença importa:

- **Alcança:** `findMany`, `findFirst`, `count`, `aggregate`, `groupBy`,
  `updateMany`, `deleteMany`, `create`, `createMany` — dá para injetar
  `where.companyId` ou `data.companyId` com segurança.
- **NÃO alcança:** `findUnique`, `update`, `delete`, `upsert`. O `where` dessas
  só aceita campo único, e o Prisma recusa `companyId` ali. Também não alcança
  `$queryRaw`.

Por isso o lint é a peça central, e não o wrapper: o wrapper cobre o caminho
comum, e o lint garante que ninguém alcance o `prisma` cru para fazer o resto
sem passar por uma exceção visível.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/unit/escopo-empresa.test.ts`. O teste tem que provar isolamento de
verdade, não só que a função existe:

- `findMany` da empresa A **não** devolve linha da empresa B
- `create` grava com o `companyId` do escopo, mesmo sem o chamador passar
- `create` com `companyId` **diferente** do escopo é recusado (ou sobrescrito —
  decida e explique; recusar é mais honesto que corrigir em silêncio)
- `updateMany`/`deleteMany` da empresa A não alcançam linha da empresa B
- as operações por chave única (`findUnique`, `update`, `delete`, `upsert`)
  **lançam** um erro que diz para usar a equivalente escopável (`findFirst`,
  `updateMany`, `deleteMany`) — falhar alto é melhor que devolver dado de outra
  empresa

Use `prisma` mockado; **não** toque o banco real neste teste.

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/escopo-empresa.test.ts
```

- [ ] **Step 3: Criar `src/core/tenancy/escopo.ts`**

Use `prisma.$extends({ query: { $allModels: { async $allOperations(...) } } })`
— confirmado disponível no Prisma 7 e é o padrão que a própria documentação do
Prisma usa para multi-tenancy.

O comentário do arquivo precisa registrar, com evidência:

- a lista de modelos de tenant (os que têm `companyId`) e que `User` e
  `RateLimit` **não** entram
- que `findUnique`/`update`/`delete`/`upsert` lançam, e **por que** — o `where`
  delas só aceita campo único
- que o exemplo oficial do Prisma para multi-tenancy usa `set_config` + RLS no
  Postgres, o que seria mais forte porque o banco faria o filtro; e por que este
  projeto não faz assim: o Prisma conecta como dono da tabela, que **ignora**
  política de linha a menos que `FORCE ROW LEVEL SECURITY` esteja ligada — e a
  migração `20260730212500` diz, textualmente, que ela **não** está, de
  propósito. Ligar `FORCE RLS` + escrever políticas contradiz duas decisões em
  vigor, e fica registrado como caminho de endurecimento futuro, não como
  esquecimento.

- [ ] **Step 4: Acrescentar a regra de lint**

Em `eslint.config.mjs`. **Leia a regra existente primeiro** — a base já usa
`no-restricted-imports` para a fronteira `core`↛`modules`, com padrões
deliberadamente amplos (`**/modules`, `**/modules/*`) e um comentário explicando
por que o arquivo se chama `module-gate.ts` e não `modules.ts`. Siga aquele
estilo.

A regra nova: `src/core/**` e `src/modules/**` não podem importar `@/lib/prisma`
nem `../lib/prisma` e variantes. A mensagem do erro precisa dizer o que fazer
(`prismaDaEmpresa(companyId)` de `@/core/tenancy/escopo`), não só que é
proibido.

**A exceção nomeada e datada.** Aplicar o escopo em todos os serviços é o
próximo ciclo, então hoje dezenas de arquivos violam a regra. Liste-os
explicitamente numa exceção com comentário dizendo: quantos são, que o próximo
ciclo os remove um a um, e que a lista é o contador de quanto falta. Exceção
nomeada conta; disciplina não conta nada.

`src/core/auth/session.ts` e `src/core/rate-limit/limiter.ts` ficam de fora da
regra **permanentemente**, com comentário: o primeiro resolve quem é a pessoa
antes de existir escopo, o segundo opera numa tabela global.

- [ ] **Step 5: Rodar teste e lint**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/escopo-empresa.test.ts
npm run lint
npm run typecheck
```

`npm run lint` tem que passar — se a exceção não cobrir todos os violadores
atuais, ele falha e mostra quais faltam. Cole a saída.

- [ ] **Step 6: Commit**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git add src/core/tenancy eslint.config.mjs tests/unit/escopo-empresa.test.ts
git commit -m "feat(tenancy): client escopado por empresa e o lint que o obriga

O wrapper cobre o caminho comum (findMany, create, updateMany...). As
operacoes por chave unica LANCAM, porque o where delas so aceita campo
unico e o Prisma recusa companyId ali -- falhar alto e melhor que devolver
dado de outra empresa.

Por isso a peca central e o lint, nao o wrapper: no-restricted-imports
proibe alcancar o prisma cru de core/ e modules/, o mesmo mecanismo que a
base ja usa para a fronteira core-modules. Os violadores atuais ficam numa
excecao NOMEADA que conta quantos faltam.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Provar o mecanismo de ponta a ponta em `leads`

**Files:**
- Modify: os serviços de `src/core/leads/`
- Modify: `eslint.config.mjs` (remover `leads` da exceção)
- Test: `tests/unit/lead-isolamento.test.ts` (novo)

**Interfaces:**
- Consumes: `prismaDaEmpresa` (Task 3), `UsuarioAtivo.companyId` (Task 2).
- Produces: `leads` sem nenhum acesso ao `prisma` cru; padrão que o próximo ciclo replica nos demais serviços.

**Por que `leads` e não outro:** é o serviço com mais superfície do núcleo
(criação, edição, movimentação no funil, notas, arquivamento, export) e o que
tem mais teste existente. Se o mecanismo aguenta `leads`, aguenta o resto; se
não aguenta, é melhor descobrir num serviço só.

- [ ] **Step 1: Mapear o que vai mudar**

```bash
cd "d:/Projetos Programação/N8n + Crm"
grep -rn "prisma\." src/core/leads/ | wc -l
grep -rn "findUnique\|findUniqueOrThrow\|\.update(\|\.delete(\|upsert" src/core/leads/
```

O segundo comando lista exatamente os casos que o wrapper **não** cobre. Cada um
precisa virar a equivalente escopável (`findFirst` com `companyId`,
`updateMany`, `deleteMany`) — ou, se não der, ficar documentado por quê. Liste
no relatório quantos eram e o que fez com cada um.

- [ ] **Step 2: Escrever o teste de isolamento primeiro**

`tests/unit/lead-isolamento.test.ts`: para cada função pública de `leads`, uma
prova de que escopo A não alcança dado de B. Este é o teste que dá sentido ao
ciclo inteiro — sem ele, `companyId` é só uma coluna.

- [ ] **Step 3: Rodar e confirmar que falha**

- [ ] **Step 4: Converter os serviços de `leads`**

Cada função pública passa a receber o escopo. **Não leia o escopo de estado
global** (`AsyncLocalStorage` e parentes): funciona até o primeiro caminho que
roda fora do ciclo de request — job de fila, seed, script — e é exatamente onde
ninguém está olhando.

- [ ] **Step 5: Remover `leads` da exceção do lint e provar**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npm run lint
npx vitest run tests/unit/lead-isolamento.test.ts tests/unit/lead-actions.test.ts tests/unit/lead-queries.test.ts tests/unit/leads-arquivar.test.ts tests/unit/leads-atualizar.test.ts tests/unit/export-leads.test.ts
npm run typecheck
```

O lint passar **com `leads` fora da exceção** é a prova de que o serviço não
alcança mais o `prisma` cru.

- [ ] **Step 6: Commit**

---

### Task 5: Verificação final e auditoria

**Files:**
- Create: `docs/auditorias/2026-08-19-ciclo-1a-tenancy.md`

- [ ] **Step 1: Portões**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npm run typecheck
npm run lint
npm test
npm run build
```

Aqui `npm test` é permitido e necessário. Registre que ele reescreve a senha do
admin no banco de desenvolvimento — problema pré-existente, conhecido, que o
controlador rotaciona depois. Não tente consertar.

- [ ] **Step 2: Conferir cada critério de aceite do spec**

Seção 7 do spec, um a um, com comando e saída colados. O que este ambiente não
provar sai como **NÃO VERIFICADO**, com o comando que um humano precisa rodar —
nunca como "ok" presumido.

Inclui, e não são opcionais:

- `get_advisors` de segurança comparado com a linha de base: 13 → **15**
  `rls_enabled_no_policy` (as duas tabelas novas entram, e sem política é o
  estado correto), 2 WARN do `rls_auto_enable`. **Qualquer outro achado é
  regressão.**
- zero grants para `anon`/`authenticated`
- o `diff` vazio das 26 chamadas de `hasPermission`
- teste que prova que escopo A não alcança dado de B

- [ ] **Step 3: Auditoria**

`docs/auditorias/2026-08-19-ciclo-1a-tenancy.md`. **Leia os três que já existem
em `docs/auditorias/` antes** — são o formato.

Cobrir a superfície tocada: o modelo de tenancy, a resolução de papel, o
mecanismo de escopo e seus pontos cegos declarados, e o que a exceção do lint
ainda deixa aberto. Incluir a seção "Herdado, não corrigido aqui" com ponteiro
para os achados de infraestrutura já registrados no spec do Ciclo 4.

**Nada de `✅ OK` sem o comando e a saída.** É a regra que o `AGENTS.md` da base
impõe, e a revisão final do Ciclo 4 pegou uma auditoria afirmando gate que o
código não tinha.

- [ ] **Step 4: Commit e push**
