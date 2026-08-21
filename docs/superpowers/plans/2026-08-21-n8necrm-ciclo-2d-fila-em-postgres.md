# n8necrm — Ciclo 2d (Sair da Vercel: a fila vira Postgres) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O CRM deixa de depender da Vercel. A fila de turnos do WhatsApp sai do Vercel Queues e passa a viver numa tabela do Postgres que o projeto já tem, com lease atômico no mesmo idioma de `claimLease` e `checarRateLimit`. O app fica agnóstico de hospedagem: roda em qualquer Node.

**Architecture:** Uma tabela `TurnoJob` (14º modelo de tenant) com reivindicação por `UPDATE` condicional atômico + fencing token. Um segundo adaptador de `FilaTurnos` (`fila/postgres.ts`) atrás da interface que o Ciclo 0 já criou. Um drenador (`fila/consumidor.ts`) com teto de duração por turno, acionado por **dois** gatilhos que não presumem plataforma: um endpoint HTTP autenticado por cabeçalho e um worker em processo. O IP do cliente deixa de vir de um cabeçalho de plataforma e passa a exigir configuração explícita, com comportamento seguro por padrão. A troca é **expande → migra → contrai**: a fila nova nasce e funciona (Tarefas 1–5), as duas pontas viram juntas (Tarefa 6), e só então a Vercel sai (Tarefa 7).

**Tech Stack:** Next.js 16.3 (App Router), React 19.2, Prisma 7.9 + `@prisma/adapter-pg`, Postgres 17.6 (Supabase `uzumzfxjcxrbxaucvfsr`), Node 22.21, Zod 4, Vitest 4, Playwright 1.62.

**Spec:** `docs/superpowers/specs/2026-08-21-ciclo-2d-fila-em-postgres-design.md`

## Global Constraints

- **Idioma do código é português.** Comentário explica **por que**, com evidência. Nunca "o quê".
- **Antes de qualquer trabalho que toque o banco, invocar as três skills juntas:** `supabase`, `supabase-postgres-best-practices`, `auditing-supabase-security`. Vale para as Tarefas 1, 2 e 11.
- **Este projeto usa migrations do Prisma, não o CLI do Supabase.** As migrations são arquivos SQL escritos à mão em `prisma/migrations/`, aplicados por `npx prisma migrate deploy`. `supabase db pull`, schema declarativo e `supabase migration new` **não se aplicam**.
- **Nenhuma política RLS e nenhum grant neste ciclo.** A tabela nova nasce com RLS **ligada e zero políticas** (default-deny). Se uma tarefa parecer precisar de política, ela saiu do escopo — **pare e reporte**.
- **A catraca `tests/unit/catraca-prisma-cru.test.ts` está em ZERO temporários** e gira num sentido só. Este ciclo acrescenta **uma** entrada à `EXCECAO_PERMANENTE` (Tarefa 2), com o motivo escrito — e **nenhuma** temporária. Se outra tarefa parecer precisar do prisma cru, **pare e reporte antes** de acrescentar linha nenhuma.
- **`MODELOS_DE_TENANT` está em 13** e há trava de deriva que **morde**: `tests/unit/escopo-empresa.test.ts` lê o schema e falha nomeando o modelo. A Tarefa 1 o leva a 14; nenhuma outra tarefa toca a lista.
- **`PERDOADAS` em `tests/unit/migracoes-seguras.test.ts` tem 2 entradas e continua com 2.** A migração da Tarefa 1 cria tabela NOVA, e o analisador já isenta coluna criada dentro do próprio `CREATE TABLE`.
- **`companyId` viaja como parâmetro explícito.** `AsyncLocalStorage` e estado global **PROIBIDOS** — e a fila é exatamente o caminho fora do ciclo de request onde eles falham calados.
- **Nunca `prisma.company.findFirst()`** como origem de empresa.
- **Validar env em escopo de módulo derruba o `next build`.** Toda leitura de `WHATSAPP_QUEUE_SECRET` e `IP_CABECALHO_CONFIAVEL` é **preguiçosa**, dentro da função que usa.
- **`DATABASE_URL` na 6543, `DIRECT_URL` na 5432.** Trocar deixa `prisma migrate` PENDURADO sem imprimir nada.
- **Toda frase que afirme universal** — "todo", "sempre", "nenhum", "qualquer", "só" — precisa do caso de teste que a exercita, ou é reescrita.
- **Provar, não presumir.** O que este ambiente não provar sai como **🔍 NÃO VERIFICADO**, com o comando que um humano roda.
- **Não rodar `npm test`** (ele executa o seed e reescreve as senhas de `admin@exemplo.com` e `vendedor@exemplo.com`). Rodar arquivos focados com `npx vitest run <arquivo>`.
- **Nada de `vitest` em paralelo com outra execução de `vitest`.** O banco de teste não é separado do de desenvolvimento; duas execuções o envenenam.
- **Nunca ler nem imprimir o `.env`.** A Tarefa 3 acrescenta uma linha a ele **sem** exibir valor.
- **`docs/auditorias/*` NÃO é tocado**, nem spec/plano de ciclo já executado. A única exceção é o **adendo datado** da Tarefa 10, que não altera nenhuma palavra do texto original.
- Toda mensagem de commit termina com:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **Branch de trabalho: `ciclo-2d-fila-em-postgres`**, criada a partir de `ciclo-1a-tenancy` (HEAD `eb23ffb`).

## Linha de base medida em 2026-08-21 — conferir se mudou antes de fechar

| Medida | Valor | Como |
| --- | --- | --- |
| Modelos de tenant | **13** | `src/core/tenancy/escopo.ts:287` |
| Exceções do lint | **5 permanentes, 0 temporárias** | `eslint.config.mjs:428` |
| `PERDOADAS` de migração | **2** | `tests/unit/migracoes-seguras.test.ts:38` |
| Última migração | `20260821130000_derruba_user_papel_de_vez` | `ls prisma/migrations` |
| Arquivos de `src/` que citam `@vercel/queue` | **5**, dos quais **4 importam** (o quinto, `fila/tipos.ts`, só menciona em comentário) | `grep -rln "@vercel/queue" src/` |
| Arquivos de `tests/` que o citam | **5** | `grep -rln "@vercel/queue" tests/` |
| Arquivos de `src/` que citam a Vercel | **18** | `grep -rli vercel src/ \| wc -l` |
| Arquivos de `tests/` que a citam | **12** | `grep -rli vercel tests/ \| wc -l` |
| Importadores de `publicarTurno` | **3** | `grep -rn "publicarTurno" src/` |
| Consumidores de `obterIpDaRequisicao` | **3** | `grep -rn "obterIpDaRequisicao" src/` |
| Unitários | **1622 passando**, 13 pulados | `docs/ESTADO.md` |
| e2e | **54 passando** | `docs/ESTADO.md` |

## Ações do dono que travam a execução

**NENHUMA tarefa deste plano fica bloqueada por ação do dono.** Cada tarefa carrega a linha `DEPENDE DE AÇÃO DO DONO: não`.

As ações do dono são de **implantação**, depois do plano pronto, e a Tarefa 10 as escreve em `docs/ESTADO.md`:

1. **Escolher a hospedagem.**
2. **Ligar um gatilho de drenagem** — `npm run fila:worker` como serviço, ou `pg_cron`+`pg_net`, ou `cron`+`curl`. **Sem isto a fila enche e ninguém responde.**
3. **Definir `IP_CABECALHO_CONFIAVEL`** com o cabeçalho que a borda escolhida **sobrescreve**. Até lá não há limite por IP no login nem `AuditLog.ip`.
4. **Definir `SENTRY_ENVIRONMENT`** (o `VERCEL_ENV` deixa de existir) e **`SUPABASE_JWT_ISSUER`** com a origem real.
5. **Apagar o projeto da Vercel e as variáveis que estiverem lá.**

Herdada, não deste ciclo: rotacionar a senha do admin se alguém rodar `npm test`.

---

### Task 1: `TurnoJob` no schema, a migração, e o 14º modelo de tenant

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260821140000_fila_de_turnos_em_postgres/migration.sql`
- Modify: `src/core/tenancy/escopo.ts`
- Modify: `tests/unit/escopo-empresa.test.ts`

**Interfaces:**
- Consumes: `Company`, `Conversation` (`prisma/schema.prisma`); `MODELOS_DE_TENANT` (`src/core/tenancy/escopo.ts`).
- Produces:
  - `model TurnoJob` com `id`, `companyId`, `company`, `conversationId`, `conversation`, `seq`, `tentativaReagendamento`, `chaveIdempotencia`, `disponivelEm`, `leaseAte`, `tentativasEntrega`, `mortoEm`, `ultimoErro`, `criadoEm`, `@@unique([companyId, chaveIdempotencia])`, `@@index([mortoEm, disponivelEm])`, `@@index([companyId])`, `@@index([conversationId])`
  - `Company.turnoJobs TurnoJob[]`
  - `Conversation.turnoJobs TurnoJob[]`
  - `MODELOS_DE_TENANT` com **14** entradas
  - o delegate `prisma.turnoJob` gerado por `prisma generate`

- [ ] **Step 1: Criar a branch e medir o banco antes de tocar nele**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git checkout -b ciclo-2d-fila-em-postgres
npx prisma migrate status
```

Esperado: `Database schema is up to date!`. Se aparecer migração pendente, **pare e reporte** — aplicar migração alheia não é desta tarefa. Cole a saída.

- [ ] **Step 2: Escrever os casos que falham (RED)**

Em `tests/unit/escopo-empresa.test.ts`, o caso da linha 801 muda **só no título**:

```ts
    it("os 14 modelos de tenant nomeiam a relação `company` — a varredura depende do nome", () => {
```

E o caso da linha 831 (`"`WhatsappConnection` é modelo de tenant, e a lista tem exatamente 13"`) muda de título e de número, e ganha um irmão logo depois:

```ts
    it("`WhatsappConnection` é modelo de tenant, e a lista tem exatamente 14", () => {
      // Deriva: um modelo com `companyId` que ficasse FORA do Set passaria por
      // `escoparArgumentos` intacto — sem filtro, sem injeção, sem erro. É o
      // vazamento mais silencioso que este arquivo pode ter, e a única defesa
      // é esta igualdade exata.
      expect(MODELOS_DE_TENANT.has("WhatsappConnection")).toBe(true);
      expect(MODELOS_DE_TENANT.size).toBe(14);
    });

    it("`TurnoJob` é modelo de tenant — a FILA é dado de empresa, não infraestrutura", () => {
      // A alternativa considerada e recusada (spec §5.1): guardar a empresa
      // dentro de um Json, ou numa coluna com outro nome, faria a tabela PASSAR
      // na trava de deriva sem estar protegida. Passar na trava por escolher
      // outro nome é contornar a trava.
      //
      // Os três caminhos escopados que isto compra — publicar, concluir e
      // podar — estão em `src/modules/whatsapp/fila/postgres.ts`. O quarto (a
      // reivindicação) é cross-tenant por construção e tem exceção NOMEADA no
      // eslint, provada por `catraca-prisma-cru.test.ts`.
      expect(MODELOS_DE_TENANT.has("TurnoJob")).toBe(true);
    });

    it("`TurnoJob.chaveIdempotencia` é única POR EMPRESA, não global", () => {
      const bloco = blocoDoModelo("TurnoJob");

      // Ciclo 1e: unicidade global sobre valor derivado de dado de empresa é a
      // família de defeito que aquele ciclo fechou. A chave deriva de
      // `conversationId` (cuid, já global), então as duas formas seriam
      // corretas HOJE — a composta é a que continua correta se a chave passar a
      // derivar de algo por empresa, e a que não exige o leitor confiar num
      // raciocínio sobre cuid.
      expect(
        bloco.filter((l) => /^\s*@@unique\(\[companyId, chaveIdempotencia\]\)/.test(l))
      ).toHaveLength(1);
      expect(bloco.filter((l) => /^\s*chaveIdempotencia\s+String\s+@unique/.test(l))).toHaveLength(0);
    });
```

- [ ] **Step 3: Rodar para ver falhar**

```bash
npx vitest run tests/unit/escopo-empresa.test.ts
```

Esperado: FAIL. `MODELOS_DE_TENANT.size` é 13, `MODELOS_DE_TENANT.has("TurnoJob")` é `false`, e `blocoDoModelo("TurnoJob")` devolve lista vazia. **A trava de deriva ("MODELOS_DE_TENANT não pode derivar do schema") ainda passa neste ponto** — ela só vai reclamar depois do Step 4, e é isso que se espera.

- [ ] **Step 4: Acrescentar o modelo ao schema**

Em `prisma/schema.prisma`, **depois** do bloco `model Conversation`, acrescentar:

```prisma
/// A FILA de turnos de conversa — a tabela que substituiu o Vercel Queues no
/// Ciclo 2d.
///
/// ## Por que ela é modelo de TENANT, e não infraestrutura como `RateLimit`
///
/// `RateLimit` não tem `companyId`: é defesa global, consultada antes de
/// existir sessão. Esta tabela tem dono — cada linha pertence à empresa da
/// conversa —, e três dos quatro caminhos que a tocam JÁ têm o `companyId` na
/// mão antes de falar com o banco: publicar (vem do job, resolvido pela
/// conexão no webhook), concluir e podar (vêm do `RETURNING` da reivindicação).
/// Os três usam `prismaDaEmpresa(companyId)`.
///
/// O quarto — reivindicar — é cross-tenant POR CONSTRUÇÃO: o consumidor roda
/// sem sessão e a pergunta que ele faz é "qual o próximo job de QUALQUER
/// empresa". `prismaDaEmpresa` exigiria como parâmetro exatamente o valor que o
/// `UPDATE ... RETURNING "companyId"` devolve — a mesma circularidade que já
/// isenta `core/auth/session.ts` e `core/users/empresa.ts` na
/// `EXCECAO_PERMANENTE` do `eslint.config.mjs`.
///
/// ## Por que não há coluna de estado
///
/// `mortoEm IS NULL` = vivo. "Pendente" e "reivindicado" já são deduzidos de
/// `disponivelEm` e `leaseAte`; um enum diria a mesma coisa num segundo lugar,
/// que é onde a deriva nasce. E `mortoEm` precisa ser DATA de qualquer jeito,
/// porque é ela que a poda por retenção lê.
///
/// ## Por que a morte é GRAVADA e não recalculada
///
/// Se a condição de morte fosse `tentativasEntrega >= MAX_TENTATIVAS_ENTREGA`
/// lida a cada reivindicação, subir a constante RESSUSCITARIA jobs mortos
/// antigos sem ninguém pedir. `mortoEm` gravado é decisão tomada.
///
/// ## Job concluído é APAGADO
///
/// A fila é lista de trabalho, não livro-razão: o histórico que importa está em
/// `WhatsappMessage.processadoEm` e em `AuditLog`. Uma coluna `concluidoEm`
/// exigiria um SEGUNDO mecanismo para tirar a linha — e foi exatamente esse
/// segundo mecanismo que nunca existiu no caso do `RateLimit` ("nada nunca
/// apagava linha desta tabela"). Só o job MORTO fica, com `ultimoErro`, por 7
/// dias: apagá-lo em silêncio apagaria a única evidência de que uma conversa
/// nunca foi respondida.
model TurnoJob {
  id                     String       @id @default(cuid())
  companyId              String
  company                Company      @relation(fields: [companyId], references: [id])
  /// O job é um PONTEIRO para uma conversa, e o ponteiro não pode sobreviver ao
  /// alvo: sem a FK em cascata, apagar uma conversa deixaria jobs que
  /// reivindicam, falham no `claimLease`, reagendam até o teto e desistem —
  /// barulho por minutos, para nada.
  conversationId         String
  conversation           Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  seq                    Int
  tentativaReagendamento Int          @default(0)
  /// `conv:seq` na publicação original, `conv:seq:rN` no reagendamento — a
  /// mesma forma que a `idempotencyKey` do adaptador da Vercel usava, e pelo
  /// mesmo motivo (fix round 1/5, achado C2: sem o sufixo, o reagendamento
  /// colidia consigo mesmo).
  chaveIdempotencia      String
  /// Quando o job pode ser entregue. É o `delaySeconds` da interface
  /// `OpcoesPublicacao` virado data: 8s no caso comum, 5s no reagendamento.
  disponivelEm           DateTime
  /// O lease do JOB. NULL = livre. O valor devolvido pela reivindicação é o
  /// FENCING TOKEN — `concluirJob`/`falharJob` só agem quando ele ainda é este
  /// mesmo valor, igual a `liberarLease` em `modules/whatsapp/turno.ts`.
  leaseAte               DateTime?
  /// Incrementa na REIVINDICAÇÃO, não na conclusão. É o que faz um job que MATA
  /// o processo morrer também, em vez de girar para sempre.
  tentativasEntrega      Int          @default(0)
  mortoEm                DateTime?
  ultimoErro             String?
  criadoEm               DateTime     @default(now())

  @@unique([companyId, chaveIdempotencia])
  @@index([mortoEm, disponivelEm])
  @@index([companyId])
  @@index([conversationId])
}
```

Em `model Company`, acrescentar como **última** linha da lista de relações (depois de `whatsappConnections`):

```prisma
  turnoJobs           TurnoJob[]
```

Em `model Conversation`, acrescentar depois de `mensagens`:

```prisma
  turnoJobs             TurnoJob[]
```

- [ ] **Step 5: Acrescentar `TurnoJob` a `MODELOS_DE_TENANT`**

Em `src/core/tenancy/escopo.ts`, na lista da linha 287, acrescentar como **última** entrada:

```ts
  "WhatsappConnection",
  "TurnoJob",
]);
```

- [ ] **Step 6: Escrever a migração**

Criar `prisma/migrations/20260821140000_fila_de_turnos_em_postgres/migration.sql`:

```sql
-- Ciclo 2d, Task 1: TurnoJob -- a fila de turnos sai do Vercel Queues e passa a
-- viver no Postgres que este projeto ja tem.
--
-- Tabela NOVA e VAZIA. NOT NULL sem DEFAULT e seguro aqui porque nao ha linha
-- antiga nem codigo publicado inserindo nela --
-- tests/unit/migracoes-seguras.test.ts isenta coluna criada dentro do proprio
-- CREATE TABLE (a isencao esta no analisador, em `criadas.has`, e tem caso
-- proprio). A lista PERDOADAS daquele arquivo continua com 2 entradas: esta
-- migracao nao precisa de isencao nenhuma.
--
-- NENHUM backfill: nao ha o que migrar. Os jobs que estivessem no Vercel Queues
-- no momento da troca ficam la e nunca sao entregues -- e isso e inofensivo
-- neste projeto porque nao ha deploy publicado (docs/ESTADO.md: "nada
-- integrado, nada publicado"), entao nao existe fila viva em lugar nenhum.

-- CreateTable
CREATE TABLE "TurnoJob" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "tentativaReagendamento" INTEGER NOT NULL DEFAULT 0,
    "chaveIdempotencia" TEXT NOT NULL,
    "disponivelEm" TIMESTAMP(3) NOT NULL,
    "leaseAte" TIMESTAMP(3),
    "tentativasEntrega" INTEGER NOT NULL DEFAULT 0,
    "mortoEm" TIMESTAMP(3),
    "ultimoErro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TurnoJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TurnoJob_companyId_chaveIdempotencia_key" ON "TurnoJob"("companyId", "chaveIdempotencia");

-- CreateIndex
-- O indice que a REIVINDICACAO usa. A ordem das colunas segue o predicado dela:
-- filtra por "mortoEm" IS NULL primeiro, depois ordena/corta por
-- "disponivelEm". Indice parcial (WHERE "mortoEm" IS NULL) seria menor, e foi
-- recusado de proposito: o Prisma nao o representa em schema.prisma, e um
-- indice que existe no banco e nao existe no schema e deriva esperando
-- acontecer na proxima vez que alguem rodar `prisma migrate diff`.
CREATE INDEX "TurnoJob_mortoEm_disponivelEm_idx" ON "TurnoJob"("mortoEm", "disponivelEm");

-- CreateIndex
CREATE INDEX "TurnoJob_companyId_idx" ON "TurnoJob"("companyId");

-- CreateIndex
CREATE INDEX "TurnoJob_conversationId_idx" ON "TurnoJob"("conversationId");

-- AddForeignKey
-- RESTRICT para Company, igual a CompanyConfig e WhatsappConnection: apagar
-- empresa com trabalho pendente e o tipo de operacao que deve parar e ser
-- olhada.
ALTER TABLE "TurnoJob" ADD CONSTRAINT "TurnoJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- CASCADE para Conversation: o job e um ponteiro, e o ponteiro nao sobrevive ao
-- alvo.
ALTER TABLE "TurnoJob" ADD CONSTRAINT "TurnoJob_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A blindagem, e ela e obrigatoria em toda tabela nova deste projeto.
--
-- O Prisma nao emite RLS nem REVOKE. A migracao
-- 20260813180000_blindar_privilegios_padrao cobre os GRANTs automaticos de
-- objetos futuros (suspensorio), mas ALTER DEFAULT PRIVILEGES NAO liga RLS --
-- isso continua sendo por tabela, a mao (cinto).
--
-- Sem estas duas linhas, tests/e2e/banco-blindado.spec.ts fica vermelho: ele
-- varre pg_class.relrowsecurity e information_schema.role_table_grants SEM
-- lista fixa de tabelas, entao uma tabela nova desprotegida aparece sozinha.
--
-- RLS LIGADA e ZERO politicas = default-deny. Nenhuma politica e escrita aqui:
-- a excecao NOMEADA para o Realtime e Ciclo 3.
ALTER TABLE "TurnoJob" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "TurnoJob" FROM anon, authenticated;
```

- [ ] **Step 7: Aplicar e gerar o cliente**

```bash
npx prisma migrate deploy
npx prisma generate
```

Esperado: `1 migration found` / `Applying migration '20260821140000_fila_de_turnos_em_postgres'` e depois `Generated Prisma Client`. Cole as duas saídas.

Se `prisma migrate deploy` ficar **pendurado sem imprimir nada**, o problema é `DIRECT_URL` na porta errada (deve ser 5432). **Pare e reporte** — não é lentidão.

- [ ] **Step 8: Verde**

```bash
npx vitest run tests/unit/escopo-empresa.test.ts tests/unit/migracoes-seguras.test.ts tests/unit/catraca-prisma-cru.test.ts
npm run typecheck
```

Esperado: os três arquivos verdes (inclusive a trava de deriva, que agora vê `TurnoJob` nos dois lados), `PERDOADAS` continua com 2, e `typecheck` limpo.

- [ ] **Step 9: A tabela nova está blindada**

```bash
npx playwright test tests/e2e/banco-blindado.spec.ts
```

Esperado: verde. Se `TurnoJob` aparecer na lista de "tabela sem RLS" ou nos grants, o `ALTER TABLE`/`REVOKE` não foi aplicado — **pare e reporte**.

- [ ] **Step 10: Commit**

```
feat(fila): a fila de turnos ganha tabela propria no Postgres

O Vercel Queues sai no Ciclo 2d, e a fila precisa de onde morar antes
disso -- apagar o adaptador antes do substituto deixaria o WhatsApp mudo.

TurnoJob e o 14o modelo de TENANT, e nao infraestrutura como RateLimit.
A alternativa (empresa dentro de um Json, ou coluna com outro nome)
passaria na trava de deriva sem estar protegida -- passar na trava por
escolher outro nome e contornar a trava.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

### Task 2: O adaptador de Postgres — publicar, reivindicar, concluir, falhar, podar

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Create: `src/modules/whatsapp/fila/postgres.ts`
- Create: `tests/unit/fila-postgres.test.ts`
- Modify: `eslint.config.mjs`

**Interfaces:**
- Consumes: `FilaTurnos`, `OpcoesPublicacao`, `TurnoJob` (`./tipos`); `prismaDaEmpresa` (`@/core/tenancy/escopo`); `prisma` (`@/lib/prisma`); `prisma.turnoJob` (Tarefa 1).
- Produces:
  - `class FilaPostgres implements FilaTurnos`
  - `interface JobReivindicado { id, companyId, conversationId, seq, tentativaReagendamento, tentativasEntrega, leaseAte }`
  - `async function reivindicarJob(): Promise<JobReivindicado | null>`
  - `async function concluirJob(companyId, jobId, token: Date): Promise<boolean>`
  - `type DesfechoFalha = "reagendado" | "morto" | "lease-perdido"`
  - `async function falharJob(companyId, jobId, token: Date, erro: string): Promise<DesfechoFalha>`
  - `async function podarJobsMortos(companyId, retencaoMs?): Promise<number>`
  - constantes exportadas `DELAY_PADRAO_SEGUNDOS = 8`, `JOB_LEASE_MS = 90_000`, `RETRY_APOS_MS = 30_000`, `MAX_TENTATIVAS_ENTREGA = 5`, `RETENCAO_JOB_MORTO_MS`

- [ ] **Step 1: Escrever os casos que falham (RED)**

Criar `tests/unit/fila-postgres.test.ts`:

```ts
// Este arquivo usa o Prisma real contra o Postgres do Supabase (mesmo padrão de
// `rate-limit.test.ts` e `audit-log.test.ts`), e carrega DATABASE_URL aqui — não
// em vitest.config.ts — para não injetar credenciais em arquivos de teste que
// não tocam banco. Precisa ser o primeiro import.
import "dotenv/config";

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// "server-only" só resolve para no-op sob a condição de resolução
// "react-server" do Next; fora dela lança. Mesmo mock de `rate-limit.test.ts`.
import { vi } from "vitest";
vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import {
  FilaPostgres,
  reivindicarJob,
  concluirJob,
  falharJob,
  podarJobsMortos,
  MAX_TENTATIVAS_ENTREGA,
  RETRY_APOS_MS,
} from "../../src/modules/whatsapp/fila/postgres";

// Empresa e conversa próprias, criadas e apagadas por este arquivo. Não
// reutilizamos o seed: a reivindicação é CROSS-TENANT por construção, então um
// job de outra origem no banco entraria no `ORDER BY` e tornaria os casos
// dependentes do que mais estivesse na tabela.
let companyId = "";
let conversationId = "";

async function limpar() {
  if (companyId) await prisma.turnoJob.deleteMany({ where: { companyId } });
}

beforeEach(async () => {
  if (!companyId) {
    const empresa = await prisma.company.create({ data: { nome: "teste-fila-2d" } });
    companyId = empresa.id;
    const conversa = await prisma.conversation.create({
      data: { companyId, waId: `teste-fila-2d-${Date.now()}` },
    });
    conversationId = conversa.id;
  }
  await limpar();

  // NUNCA `deleteMany({})`. Esta suíte roda contra o Postgres REAL, compartilhado
  // entre desenvolvimento e produção — apagar a fila inteira apagaria trabalho de
  // verdade, e um teste que destrói dado alheio é pior que um teste ausente.
  //
  // Mas os casos abaixo SÃO cross-tenant por natureza (`reivindicarJob` não tem
  // empresa), então um job de outra origem entraria no `ORDER BY` e roubaria o
  // resultado. A saída é falhar ALTO em vez de limpar: quem vir esta mensagem
  // esvazia a fila de propósito, ou espera ela drenar.
  const alheios = await prisma.turnoJob.count({ where: { companyId: { not: companyId } } });
  if (alheios > 0) {
    throw new Error(
      `Há ${alheios} job(s) de outras empresas em TurnoJob. Este arquivo reivindica ` +
        `SEM escopo (é o que ele existe para exercitar) e não pode rodar sobre uma ` +
        `fila viva — ele pegaria trabalho real. Drene a fila antes de rodar.`
    );
  }
});

afterAll(async () => {
  await limpar();
  if (conversationId) await prisma.conversation.deleteMany({ where: { id: conversationId } });
  if (companyId) await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

function job(seq: number, tentativaReagendamento?: number) {
  return { companyId, conversationId, seq, tentativaReagendamento };
}

describe("FilaPostgres.publicar", () => {
  it("grava uma linha disponível em ~8s por padrão", async () => {
    const antes = Date.now();
    await new FilaPostgres().publicar(job(1));

    const linhas = await prisma.turnoJob.findMany({ where: { companyId } });
    expect(linhas).toHaveLength(1);
    expect(linhas[0].chaveIdempotencia).toBe(`${conversationId}:1`);
    expect(linhas[0].disponivelEm.getTime()).toBeGreaterThanOrEqual(antes + 7_000);
    expect(linhas[0].disponivelEm.getTime()).toBeLessThan(antes + 12_000);
    expect(linhas[0].leaseAte).toBeNull();
    expect(linhas[0].tentativasEntrega).toBe(0);
  });

  it("respeita o delay informado e sufixa a chave por tentativa de reagendamento", async () => {
    await new FilaPostgres().publicar(job(2, 3), { delaySeconds: 5 });

    const linha = await prisma.turnoJob.findFirst({ where: { companyId, seq: 2 } });
    expect(linha?.chaveIdempotencia).toBe(`${conversationId}:2:r3`);
    expect(linha?.tentativaReagendamento).toBe(3);
  });

  it("publicar duas vezes a MESMA chave deixa UMA linha, e não lança", async () => {
    // Substitui o `DuplicateMessageError` da Vercel: os dois chamadores
    // (`turno.ts` e a rota do webhook) já traduziam aquela exceção para "tudo
    // bem", então a tradução passa a acontecer aqui e o tipo do provedor some.
    const fila = new FilaPostgres();
    await fila.publicar(job(3));
    await expect(fila.publicar(job(3))).resolves.toBeUndefined();

    expect(await prisma.turnoJob.count({ where: { companyId, seq: 3 } })).toBe(1);
  });
});

describe("reivindicarJob", () => {
  it("não entrega job cujo `disponivelEm` ainda está no futuro", async () => {
    await new FilaPostgres().publicar(job(4)); // 8s à frente
    expect(await reivindicarJob()).toBeNull();
  });

  it("entrega o job disponível, incrementa a tentativa e devolve o fencing token", async () => {
    await new FilaPostgres().publicar(job(5), { delaySeconds: 0 });

    const reivindicado = await reivindicarJob();
    expect(reivindicado).not.toBeNull();
    expect(reivindicado!.companyId).toBe(companyId);
    expect(reivindicado!.conversationId).toBe(conversationId);
    expect(reivindicado!.seq).toBe(5);
    expect(reivindicado!.tentativasEntrega).toBe(1);

    const linha = await prisma.turnoJob.findFirst({ where: { id: reivindicado!.id } });
    expect(linha?.leaseAte?.getTime()).toBe(reivindicado!.leaseAte.getTime());
  });

  it("não entrega job com lease vivo, e entrega quando o lease expirou", async () => {
    await new FilaPostgres().publicar(job(6), { delaySeconds: 0 });
    const primeiro = await reivindicarJob();
    expect(primeiro).not.toBeNull();

    expect(await reivindicarJob()).toBeNull();

    await prisma.turnoJob.updateMany({
      where: { id: primeiro!.id },
      data: { leaseAte: new Date(Date.now() - 1_000) },
    });
    const segundo = await reivindicarJob();
    expect(segundo?.id).toBe(primeiro!.id);
    expect(segundo?.tentativasEntrega).toBe(2);
  });

  it("nunca entrega job morto", async () => {
    await new FilaPostgres().publicar(job(7), { delaySeconds: 0 });
    await prisma.turnoJob.updateMany({ where: { companyId }, data: { mortoEm: new Date() } });
    expect(await reivindicarJob()).toBeNull();
  });

  it("N reivindicações CONCORRENTES sobre M jobs devolvem ids DISTINTOS", async () => {
    // O caso que prova a exclusão mútua. Mesmo método de
    // `rate-limit.test.ts`: `Promise.all` contra o Postgres real, porque o
    // defeito só aparece com conexões de verdade disputando a mesma linha.
    const fila = new FilaPostgres();
    for (let i = 100; i < 103; i++) await fila.publicar(job(i), { delaySeconds: 0 });

    const resultados = await Promise.all([
      reivindicarJob(),
      reivindicarJob(),
      reivindicarJob(),
      reivindicarJob(),
      reivindicarJob(),
    ]);

    const ids = resultados.filter((r) => r !== null).map((r) => r!.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("concluirJob e falharJob — o fencing token", () => {
  it("concluir apaga a linha", async () => {
    await new FilaPostgres().publicar(job(8), { delaySeconds: 0 });
    const r = (await reivindicarJob())!;

    expect(await concluirJob(r.companyId, r.id, r.leaseAte)).toBe(true);
    expect(await prisma.turnoJob.count({ where: { id: r.id } })).toBe(0);
  });

  it("concluir com token ERRADO não apaga nada", async () => {
    // Sem o fencing, um processador lento que termina DEPOIS de outro ter
    // reivindicado o mesmo job apagaria o trabalho de quem está ativo — o
    // achado C1 que `turno.ts` já corrigiu no lease da CONVERSA.
    await new FilaPostgres().publicar(job(9), { delaySeconds: 0 });
    const r = (await reivindicarJob())!;

    expect(await concluirJob(r.companyId, r.id, new Date(r.leaseAte.getTime() + 1))).toBe(false);
    expect(await prisma.turnoJob.count({ where: { id: r.id } })).toBe(1);
  });

  it("falhar reagenda para daqui a RETRY_APOS_MS e libera o lease", async () => {
    await new FilaPostgres().publicar(job(10), { delaySeconds: 0 });
    const r = (await reivindicarJob())!;

    const antes = Date.now();
    expect(await falharJob(r.companyId, r.id, r.leaseAte, "explodiu")).toBe("reagendado");

    const linha = await prisma.turnoJob.findFirst({ where: { id: r.id } });
    expect(linha?.leaseAte).toBeNull();
    expect(linha?.mortoEm).toBeNull();
    expect(linha?.ultimoErro).toBe("explodiu");
    expect(linha!.disponivelEm.getTime()).toBeGreaterThanOrEqual(antes + RETRY_APOS_MS - 1_000);
  });

  it("falhar na última tentativa MATA o job em vez de reagendar", async () => {
    await new FilaPostgres().publicar(job(11), { delaySeconds: 0 });
    let desfecho = "";
    for (let i = 0; i < MAX_TENTATIVAS_ENTREGA; i++) {
      const r = (await reivindicarJob())!;
      desfecho = await falharJob(r.companyId, r.id, r.leaseAte, `falha ${i}`);
      // Reagendou para daqui a 30s; o teste não espera — puxa a data para trás.
      await prisma.turnoJob.updateMany({
        where: { id: r.id },
        data: { disponivelEm: new Date(Date.now() - 1_000) },
      });
    }

    expect(desfecho).toBe("morto");
    const linha = await prisma.turnoJob.findFirst({ where: { companyId, seq: 11 } });
    expect(linha?.mortoEm).not.toBeNull();
    expect(await reivindicarJob()).toBeNull();
  });

  it("falhar com token errado devolve `lease-perdido` e não mexe na linha", async () => {
    await new FilaPostgres().publicar(job(12), { delaySeconds: 0 });
    const r = (await reivindicarJob())!;

    expect(await falharJob(r.companyId, r.id, new Date(0), "x")).toBe("lease-perdido");
    const linha = await prisma.turnoJob.findFirst({ where: { id: r.id } });
    expect(linha?.ultimoErro).toBeNull();
    expect(linha?.leaseAte?.getTime()).toBe(r.leaseAte.getTime());
  });
});

describe("podarJobsMortos", () => {
  it("apaga job morto além da retenção e preserva o recente", async () => {
    const fila = new FilaPostgres();
    await fila.publicar(job(13), { delaySeconds: 0 });
    await fila.publicar(job(14), { delaySeconds: 0 });
    await prisma.turnoJob.updateMany({
      where: { companyId, seq: 13 },
      data: { mortoEm: new Date(Date.now() - 8 * 24 * 60 * 60_000) },
    });
    await prisma.turnoJob.updateMany({
      where: { companyId, seq: 14 },
      data: { mortoEm: new Date() },
    });

    expect(await podarJobsMortos(companyId)).toBe(1);
    expect(await prisma.turnoJob.count({ where: { companyId, seq: 14 } })).toBe(1);
  });

  it("nunca apaga job VIVO, por mais velho que seja", async () => {
    await new FilaPostgres().publicar(job(15), { delaySeconds: 0 });
    await prisma.turnoJob.updateMany({
      where: { companyId, seq: 15 },
      data: { criadoEm: new Date(Date.now() - 365 * 24 * 60 * 60_000) },
    });

    expect(await podarJobsMortos(companyId, 0)).toBe(0);
    expect(await prisma.turnoJob.count({ where: { companyId, seq: 15 } })).toBe(1);
  });
});

describe("a forma do SQL cru deste módulo", () => {
  // Este arquivo está na EXCECAO_PERMANENTE do eslint, e por isso a Parte 2b de
  // `catraca-prisma-cru.test.ts` — que reprova `$queryRaw` citando tabela de
  // tenant sem `companyId` — NÃO o cobre. Estes três casos são a compensação, e
  // é isto que o spec §5.1 promete.
  const fonte = readFileSync(
    fileURLToPath(new URL("../../src/modules/whatsapp/fila/postgres.ts", import.meta.url)),
    "utf8"
  );

  it("tem EXATAMENTE um `$queryRaw` e nenhum `$executeRaw`", () => {
    expect(fonte.match(/\$queryRaw/g) ?? []).toHaveLength(1);
    expect(fonte.match(/\$executeRaw/g) ?? []).toHaveLength(0);
  });

  it("o `RETURNING` da reivindicação devolve `companyId`", () => {
    // Sem isto, um refator que parasse de devolver a empresa faria todo o resto
    // do fluxo (concluir, falhar, podar) cair em `undefined` em silêncio.
    expect(fonte).toMatch(/RETURNING[\s\S]{0,200}"companyId"/);
  });

  it("o único `$queryRaw` sai do cliente CRU, e não de um `prismaDaEmpresa`", () => {
    // Um `prismaDaEmpresa(x).$queryRaw` compilaria e passaria intacto (o escopo
    // não alcança SQL cru), dando a APARÊNCIA de escopo onde não há nenhum.
    expect(fonte).toMatch(/prisma\.\$queryRaw/);
    expect(fonte).not.toMatch(/prismaDaEmpresa\([^)]*\)\.\$queryRaw/);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
npx vitest run tests/unit/fila-postgres.test.ts
```

Esperado: FAIL na resolução do import — `src/modules/whatsapp/fila/postgres.ts` não existe.

- [ ] **Step 3: Escrever o adaptador**

Criar `src/modules/whatsapp/fila/postgres.ts`:

```ts
// Sem `import "server-only"` aqui, de propósito — a marcação fica em
// `./index.ts`, mesmo padrão de `gateway/evolution.ts` e do adaptador que este
// substituiu. `tests/unit/fila-postgres.test.ts` importa deste arquivo direto.
import { prismaDaEmpresa } from "@/core/tenancy/escopo";
import { prisma } from "@/lib/prisma";

import type { FilaTurnos, OpcoesPublicacao, TurnoJob } from "./tipos";

/**
 * A fila de turnos, em Postgres.
 *
 * ## Por que este arquivo importa o prisma CRU, e por que a exceção é PERMANENTE
 *
 * Três dos quatro caminhos daqui usam `prismaDaEmpresa(companyId)`: publicar
 * (a empresa vem do job, resolvida pela CONEXÃO no webhook), concluir e falhar
 * (vêm do `RETURNING` da reivindicação) e podar. O quarto — `reivindicarJob` —
 * é cross-tenant POR CONSTRUÇÃO: o consumidor roda fora de qualquer requisição,
 * sem sessão, e a pergunta que ele faz ao banco é "qual o próximo job de
 * QUALQUER empresa está pronto". `prismaDaEmpresa(companyId)` exigiria como
 * parâmetro exatamente o valor que o `UPDATE ... RETURNING "companyId"`
 * devolve.
 *
 * É a mesma circularidade que já isenta `core/auth/session.ts`,
 * `core/auth/credenciais.ts` e `core/users/empresa.ts` — e é verificável em uma
 * linha, do mesmo jeito que a delas.
 *
 * **O que se perde, dito em voz alta:** a Parte 2b de
 * `tests/unit/catraca-prisma-cru.test.ts` não cobre arquivo listado no eslint.
 * A compensação é o bloco "a forma do SQL cru deste módulo" em
 * `tests/unit/fila-postgres.test.ts`: um `$queryRaw` só, nenhum `$executeRaw`,
 * `companyId` no `RETURNING`, e a exigência de que ele saia do cliente CRU —
 * porque `prismaDaEmpresa(x).$queryRaw` compilaria e daria a APARÊNCIA de
 * escopo onde não há nenhum.
 */

/** Atraso padrão da publicação. É a janela de buffer de fragmentos. */
export const DELAY_PADRAO_SEGUNDOS = 8;

/**
 * Quanto tempo um job fica reservado para quem o reivindicou.
 *
 * Fica ACIMA do lease da CONVERSA (`LEASE_DURACAO_MS`, 75s em `turno.ts`), que
 * por sua vez fica acima do teto de processamento (`TEMPO_MAX_TURNO_MS`, 60s em
 * `./consumidor.ts`). A ordem 60 < 75 < 90 é invariante, e
 * `tests/unit/fila-consumidor.test.ts` a exercita: se o job fosse reentregue
 * ANTES de o turno anterior ter desistido, dois turnos disputariam a mesma
 * conversa e o segundo só descobriria isso no `claimLease`.
 */
export const JOB_LEASE_MS = 90_000;

/**
 * Espera antes de reentregar um job cujo handler lançou.
 *
 * 30s é o mesmo número que `retryAfterSeconds` em `vercel.json` usava. Manter o
 * valor é deliberado: a troca de fila não é hora de recalibrar tempo de
 * retentativa, porque uma mudança de comportamento escondida dentro de uma
 * migração de infraestrutura é a que ninguém consegue atribuir depois.
 */
export const RETRY_APOS_MS = 30_000;

/**
 * Quantas ENTREGAS um job aguenta antes de ser dado por morto.
 *
 * A contagem sobe na REIVINDICAÇÃO, não na conclusão. É essa escolha que faz um
 * job envenenado — o que derruba o processo antes de qualquer `catch` rodar —
 * morrer também, em vez de girar para sempre. Sem teto, o modo de falha é uma
 * conversa que consome o consumidor inteiro indefinidamente.
 */
export const MAX_TENTATIVAS_ENTREGA = 5;

/**
 * Por quanto tempo um job MORTO é mantido.
 *
 * Ele fica, e o job concluído não, porque as duas linhas contam coisas
 * diferentes: a concluída é trabalho feito, cujo registro já existe em
 * `WhatsappMessage.processadoEm` e em `AuditLog`; a morta é a única evidência
 * de que uma conversa NÃO foi respondida. Apagá-la em silêncio apagaria o
 * sintoma junto com o dado.
 */
export const RETENCAO_JOB_MORTO_MS = 7 * 24 * 60 * 60_000;

/** Teto do texto do erro guardado. A coluna é livre e o erro vem de fora. */
const MAX_CARACTERES_ULTIMO_ERRO = 1_000;

export interface JobReivindicado {
  id: string;
  companyId: string;
  conversationId: string;
  seq: number;
  tentativaReagendamento: number;
  tentativasEntrega: number;
  /** O fencing token: o `leaseAte` que ESTA reivindicação escreveu. */
  leaseAte: Date;
}

/**
 * A chave de deduplicação.
 *
 * Mesma forma que a `idempotencyKey` do adaptador da Vercel usava, e pelo mesmo
 * motivo (fix round 1/5, achado C2): sem o sufixo por tentativa, o job
 * reagendado colidia com a própria publicação original.
 */
function chaveIdempotencia(job: TurnoJob): string {
  const tentativa = job.tentativaReagendamento ?? 0;
  return tentativa > 0
    ? `${job.conversationId}:${job.seq}:r${tentativa}`
    : `${job.conversationId}:${job.seq}`;
}

export class FilaPostgres implements FilaTurnos {
  /**
   * `createMany` com `skipDuplicates`, e não `create`, porque duplicata aqui
   * NÃO é erro: os dois chamadores de `publicarTurno` (`turno.ts` e a rota do
   * webhook) já traduziam o `DuplicateMessageError` da Vercel para "tudo bem"
   * e seguiam. A tradução passa a acontecer aqui, e com ela o último tipo de
   * provedor some de fora do adaptador.
   *
   * `prismaDaEmpresa` e não o cliente cru: aqui a empresa EXISTE antes de tocar
   * o banco, então o escopo confere que o `companyId` do job bate com o do
   * cliente — e recusa, lançando, se não bater.
   */
  async publicar(job: TurnoJob, opcoes?: OpcoesPublicacao): Promise<void> {
    const atrasoS = opcoes?.delaySeconds ?? DELAY_PADRAO_SEGUNDOS;

    await prismaDaEmpresa(job.companyId).turnoJob.createMany({
      data: [
        {
          companyId: job.companyId,
          conversationId: job.conversationId,
          seq: job.seq,
          tentativaReagendamento: job.tentativaReagendamento ?? 0,
          chaveIdempotencia: chaveIdempotencia(job),
          disponivelEm: new Date(Date.now() + atrasoS * 1_000),
        },
      ],
      skipDuplicates: true,
    });
  }
}

/**
 * Reivindica o próximo job pronto, de qualquer empresa, e devolve o `leaseAte`
 * que esta chamada escreveu — o fencing token.
 *
 * ## Por que as condições aparecem DUAS vezes
 *
 * O subselect ESCOLHE a linha; o `WHERE` de fora é o que torna a escolha
 * atômica. Sob `READ COMMITTED`, dois consumidores podem avaliar o subselect no
 * mesmo instante e chegar ao mesmo `id`; o segundo bloqueia no lock de linha e,
 * ao destravar, reavalia a cláusula do PRÓPRIO `UPDATE` contra a versão nova.
 * Se a condição de lease só existisse no subselect (já avaliado), o `id = X` de
 * fora continuaria casando e o segundo reivindicaria o job que o primeiro
 * acabou de pegar. É o mesmo raciocínio do `AND ("processandoAte" IS NULL OR
 * ...)` de `claimLease` (`../turno.ts`), e é ele que faz a garantia.
 *
 * `FOR UPDATE SKIP LOCKED` é a OUTRA metade, e ela é de vazão, não de correção:
 * sem ele, N consumidores enfileiram no lock da MESMA linha e todos menos um
 * saem de mãos vazias depois de esperar.
 *
 * O caso "N reivindicações CONCORRENTES sobre M jobs devolvem ids DISTINTOS"
 * (`tests/unit/fila-postgres.test.ts`) prova as duas metades juntas, com
 * `Promise.all` contra o Postgres real — mesmo método de `rate-limit.test.ts`.
 */
export async function reivindicarJob(): Promise<JobReivindicado | null> {
  const agora = new Date();
  const ateLease = new Date(agora.getTime() + JOB_LEASE_MS);

  const linhas = await prisma.$queryRaw<JobReivindicado[]>`
    UPDATE "TurnoJob"
    SET "leaseAte" = ${ateLease}::timestamp(3),
        "tentativasEntrega" = "tentativasEntrega" + 1
    WHERE "id" = (
      SELECT "id" FROM "TurnoJob"
      WHERE "mortoEm" IS NULL
        AND "disponivelEm" <= ${agora}::timestamp(3)
        AND ("leaseAte" IS NULL OR "leaseAte" < ${agora}::timestamp(3))
      ORDER BY "disponivelEm" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
      AND "mortoEm" IS NULL
      AND "disponivelEm" <= ${agora}::timestamp(3)
      AND ("leaseAte" IS NULL OR "leaseAte" < ${agora}::timestamp(3))
    RETURNING "id", "companyId", "conversationId", "seq",
              "tentativaReagendamento", "tentativasEntrega", "leaseAte"
  `;

  return linhas[0] ?? null;
}

/**
 * Apaga o job concluído — mas SÓ se `leaseAte` ainda for o token desta
 * reivindicação.
 *
 * Sem o fencing (achado C1, que `turno.ts` já corrigiu no lease da CONVERSA),
 * um consumidor lento que termina DEPOIS de o lease dele ter expirado e de
 * outro ter reivindicado o mesmo job apagaria o trabalho de quem está ativo.
 *
 * Devolve `false` quando não apagou nada — o chamador registra, não relança:
 * perder o lease não é falha do turno, é o sistema se recuperando.
 */
export async function concluirJob(
  companyId: string,
  jobId: string,
  token: Date
): Promise<boolean> {
  const { count } = await prismaDaEmpresa(companyId).turnoJob.deleteMany({
    where: { id: jobId, leaseAte: token },
  });
  return count === 1;
}

export type DesfechoFalha = "reagendado" | "morto" | "lease-perdido";

/**
 * Trata um job cujo processamento falhou: reagenda, ou mata se já esgotou as
 * tentativas.
 *
 * Duas instruções, nesta ordem, e as duas carregam o fencing (`leaseAte:
 * token`). A primeira só casa quando ainda há tentativa sobrando; quando ela
 * não casa, a segunda decide entre "morreu agora" e "perdi o lease" — e essa
 * distinção importa, porque os dois desfechos merecem log diferente: morte é
 * conversa sem resposta, lease perdido é o sistema se recuperando sozinho.
 */
export async function falharJob(
  companyId: string,
  jobId: string,
  token: Date,
  erro: string
): Promise<DesfechoFalha> {
  const db = prismaDaEmpresa(companyId);
  const agora = new Date();
  const ultimoErro = erro.slice(0, MAX_CARACTERES_ULTIMO_ERRO);

  const reagendado = await db.turnoJob.updateMany({
    where: { id: jobId, leaseAte: token, tentativasEntrega: { lt: MAX_TENTATIVAS_ENTREGA } },
    data: {
      leaseAte: null,
      disponivelEm: new Date(agora.getTime() + RETRY_APOS_MS),
      ultimoErro,
    },
  });
  if (reagendado.count === 1) return "reagendado";

  const morto = await db.turnoJob.updateMany({
    where: { id: jobId, leaseAte: token },
    data: { leaseAte: null, mortoEm: agora, ultimoErro },
  });
  return morto.count === 1 ? "morto" : "lease-perdido";
}

/**
 * Apaga jobs MORTOS além da retenção. Devolve quantos saíram.
 *
 * Por empresa, igual a `podarNotificacoes` (`core/notifications/dispatch.ts`), e
 * herda a mesma limitação conhecida: empresa sem tráfego não tem quem pode a
 * tabela dela. Aqui isso é benigno — o que faz a tabela crescer é uso, e sem
 * uso não há job morto para acumular.
 *
 * Job VIVO nunca é alcançado, por mais velho que seja: o filtro é `mortoEm`, e
 * não `criadoEm`. Um caso de teste com um job de um ano exercita exatamente
 * isso, porque uma poda que apagasse job vivo apagaria mensagem não respondida.
 */
export async function podarJobsMortos(
  companyId: string,
  retencaoMs: number = RETENCAO_JOB_MORTO_MS
): Promise<number> {
  const corte = new Date(Date.now() - retencaoMs);
  const { count } = await prismaDaEmpresa(companyId).turnoJob.deleteMany({
    where: { mortoEm: { lt: corte } },
  });
  return count;
}
```

- [ ] **Step 4: Declarar a exceção permanente do lint**

Em `eslint.config.mjs`, no comentário que precede `const EXCECAO_PERMANENTE` (o bloco que hoje descreve cinco arquivos), acrescentar um sexto item ao final da lista em prosa:

```js
// - `modules/whatsapp/fila/postgres.ts` REIVINDICA o próximo job da fila, e a
//   empresa é o RESULTADO da reivindicação, não a entrada dela. O consumidor
//   roda fora de qualquer requisição, sem sessão, e a pergunta que ele faz ao
//   banco é "qual o próximo job de QUALQUER empresa está pronto".
//   `prismaDaEmpresa(companyId)` exigiria como parâmetro exatamente o valor que
//   o `UPDATE ... RETURNING "companyId"` devolve — a mesma circularidade de
//   `session.ts` e `empresa.ts`, e verificável do mesmo jeito, em uma linha.
//
//   É a PRIMEIRA exceção permanente fora de `src/core/**`, e isso está dito de
//   propósito: quem acrescentar a segunda deve conseguir dizer por que ela não
//   cabe em `core/`.
//
//   Os outros TRÊS caminhos daquele arquivo (publicar, concluir/falhar, podar)
//   usam `prismaDaEmpresa`, e o arquivo tem UM `$queryRaw` só — o que a Parte 2b
//   da catraca deixaria de cobrir está travado por
//   `tests/unit/fila-postgres.test.ts`, bloco "a forma do SQL cru deste módulo".
```

E acrescentar a entrada à lista:

```js
const EXCECAO_PERMANENTE = [
  "src/core/auth/credenciais.ts",
  "src/core/auth/session.ts",
  "src/core/users/empresa.ts",
  "src/core/rate-limit/limiter.ts",
  "src/core/tenancy/escopo.ts",
  "src/modules/whatsapp/fila/postgres.ts",
];
```

- [ ] **Step 5: Verde**

```bash
npx vitest run tests/unit/fila-postgres.test.ts
npx vitest run tests/unit/catraca-prisma-cru.test.ts
npm run lint
npm run typecheck
```

Esperado: todos verdes. A catraca passa porque o arquivo novo importa mesmo o prisma cru **e** está declarado — sobrando de um lado só, ela falha nomeando o arquivo. Cole a contagem de casos de `fila-postgres.test.ts`.

- [ ] **Step 6: Commit**

```
feat(fila): adaptador de Postgres com lease atomico e fencing token

Segundo adaptador de FilaTurnos, como o Ciclo 0 previu. A reivindicacao
e o mesmo UPDATE condicional de claimLease e checarRateLimit -- nao um
terceiro idioma -- com as condicoes repetidas fora do subselect, que e o
que torna a escolha atomica sob READ COMMITTED.

A excecao permanente do prisma cru cresce para 6, e e a primeira fora de
src/core/: a empresa e o RESULTADO da reivindicacao, nao a entrada dela.
O que a Parte 2b da catraca deixa de cobrir esta travado por tres casos
que leem o texto do proprio modulo.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

### Task 3: A comparação de segredo em tempo constante, sem oráculo de comprimento

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Create: `src/lib/segredo.ts`
- Create: `tests/unit/fila-segredo.test.ts`

**Interfaces:**
- Consumes: `node:crypto`.
- Produces: `export function segredoConfere(recebido: string, esperado: string): boolean`

- [ ] **Step 1: Escrever os casos que falham (RED)**

Criar `tests/unit/fila-segredo.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import { segredoConfere } from "../../src/lib/segredo";

describe("segredoConfere", () => {
  it("aceita o segredo idêntico", () => {
    expect(segredoConfere("abc123", "abc123")).toBe(true);
  });

  it("recusa segredo diferente do mesmo tamanho", () => {
    expect(segredoConfere("abc124", "abc123")).toBe(false);
  });

  it("recusa segredo MAIS CURTO sem lançar", () => {
    // `crypto.timingSafeEqual` LANÇA com buffers de tamanhos diferentes, e é
    // essa restrição que empurrava o consumidor antigo para um
    // `if (a.length !== b.length) return false` — um ramo cujo tempo depende do
    // comprimento. Com o digest, os dois lados têm sempre 32 bytes.
    expect(segredoConfere("abc", "abc123")).toBe(false);
  });

  it("recusa segredo MAIS LONGO sem lançar", () => {
    expect(segredoConfere("abc123456", "abc123")).toBe(false);
  });

  it("recusa quando o esperado é vazio — ausência de segredo não autoriza nada", () => {
    // Fecha FECHADO: sem a variável definida, ninguém entra. O modo de falha
    // oposto (vazio combina com vazio) transformaria "esqueci de configurar" em
    // "endpoint aberto".
    expect(segredoConfere("", "")).toBe(false);
    expect(segredoConfere("qualquer", "")).toBe(false);
  });

  it("não lança para nenhuma combinação de tamanhos", () => {
    for (const recebido of ["", "a", "ab".repeat(500)]) {
      for (const esperado of ["a", "abc", "x".repeat(64)]) {
        expect(() => segredoConfere(recebido, esperado)).not.toThrow();
      }
    }
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
npx vitest run tests/unit/fila-segredo.test.ts
```

Esperado: FAIL — `src/lib/segredo.ts` não existe.

- [ ] **Step 3: Escrever o módulo**

Criar `src/lib/segredo.ts`:

```ts
import crypto from "node:crypto";

/**
 * Compara dois segredos sem canal lateral de tempo — nem de conteúdo, nem de
 * COMPRIMENTO.
 *
 * ## Por que o digest, e não `timingSafeEqual` direto nas strings
 *
 * `crypto.timingSafeEqual` **lança** quando os buffers têm tamanhos
 * diferentes. Para não lançar, o consumidor da fila (até o Ciclo 2d) fazia
 * `if (bufferRecebido.length !== bufferEsperado.length) return false` ANTES de
 * comparar — um ramo cujo tempo depende só do comprimento. Dois SHA-256 têm
 * sempre 32 bytes, então a comparação é sempre a mesma e não sobra ramo.
 *
 * Como em `core/conexoes/webhook-token.ts`, a defesa REAL contra adivinhação é
 * a entropia do segredo (`openssl rand -hex 32`), não a forma da comparação —
 * quem não adivinha 256 bits também não tira proveito de um canal lateral sobre
 * eles. O que se ganha aqui é não deixar uma assimetria de graça.
 *
 * ## Esperado vazio devolve `false`, sempre
 *
 * Fecha FECHADO. Se a variável de ambiente não estiver definida, ninguém entra.
 * O modo de falha oposto — vazio combinando com vazio — transformaria "esqueci
 * de configurar" em "endpoint aberto", e é justamente o erro que ninguém
 * percebe até alguém de fora perceber. Caso de teste próprio.
 *
 * ## Um chamador só, e mesmo assim módulo próprio
 *
 * `obterIpDaRequisicao` só virou módulo compartilhado ao ganhar o SEGUNDO
 * chamador, e o critério continua o mesmo. Este arquivo existe por outro
 * motivo: um `route.ts` do App Router só pode exportar métodos HTTP e
 * configuração de segmento, então uma função exportável e testável **não cabe**
 * lá dentro — a mesma restrição que criou `core/rate-limit/export-leads.ts` e
 * `modules/whatsapp/agente-limites.ts`.
 */
export function segredoConfere(recebido: string, esperado: string): boolean {
  if (esperado.length === 0) return false;

  const digestRecebido = crypto.createHash("sha256").update(recebido, "utf8").digest();
  const digestEsperado = crypto.createHash("sha256").update(esperado, "utf8").digest();

  return crypto.timingSafeEqual(digestRecebido, digestEsperado);
}
```

- [ ] **Step 4: Verde**

```bash
npx vitest run tests/unit/fila-segredo.test.ts
npm run typecheck
```

Esperado: 6 casos passando, typecheck limpo.

- [ ] **Step 5: Commit**

```
feat(seguranca): comparacao de segredo sem oraculo de comprimento

Fora da Vercel a rota da fila perde o air-gapping e o segredo vira a
unica defesa. O `if (a.length !== b.length) return false` que existia
para nao fazer timingSafeEqual lancar era um ramo dependente do
comprimento; dois SHA-256 tem sempre 32 bytes e o ramo some.

Esperado vazio devolve false por caso de teste proprio: sem a variavel
definida, ninguem entra.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

### Task 4: O drenador — `drenarFila`, com teto de duração por turno

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Create: `src/modules/whatsapp/fila/consumidor.ts`
- Create: `tests/unit/fila-consumidor.test.ts`

**Interfaces:**
- Consumes: `reivindicarJob`, `concluirJob`, `falharJob`, `podarJobsMortos`, `JOB_LEASE_MS` (`./postgres`, Tarefa 2); `processarTurno` (`../turno`).
- Produces:
  - `export const TEMPO_MAX_TURNO_MS = 60_000`
  - `export const LOTE_MAX_PADRAO = 10`
  - `export const CHANCE_DE_PODA = 0.01`
  - `export interface ResultadoDrenagem { processados, falhados, mortos, esgotou }`
  - `export async function drenarFila(opcoes?: { loteMax?: number }): Promise<ResultadoDrenagem>`

- [ ] **Step 1: Escrever os casos que falham (RED)**

Criar `tests/unit/fila-consumidor.test.ts`:

```ts
// Sem banco: os limites externos (`./postgres` e `../turno`) são mockados. O
// que este arquivo prova é a MÁQUINA do drenador — quem é concluído, quem é
// falhado, e o teto de duração. O comportamento contra o Postgres real é de
// `fila-postgres.test.ts`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const reivindicarJobMock = vi.fn();
const concluirJobMock = vi.fn();
const falharJobMock = vi.fn();
const podarJobsMortosMock = vi.fn();

// Mock COMPLETO, sem `vi.importActual`: o módulo real importa `@/lib/prisma`,
// que INSTANCIA o PrismaClient no topo do arquivo — `importActual` exigiria
// `DATABASE_URL` e faria este arquivo, que não toca banco, passar a depender de
// um. Mesma razão pela qual `catraca-prisma-cru.test.ts` lê o schema em disco em
// vez de importar `MODELOS_DE_TENANT`.
//
// O caminho do mock é o alias; `consumidor.ts` importa `"./postgres"`, e as duas
// formas terminam no MESMO arquivo resolvido (`vite-tsconfig-paths` em
// `vitest.config.ts`), que é a chave que o Vitest usa.
vi.mock("@/modules/whatsapp/fila/postgres", () => ({
  reivindicarJob: () => reivindicarJobMock(),
  concluirJob: (...a: unknown[]) => concluirJobMock(...a),
  falharJob: (...a: unknown[]) => falharJobMock(...a),
  podarJobsMortos: (...a: unknown[]) => podarJobsMortosMock(...a),
}));

const processarTurnoMock = vi.fn();
vi.mock("@/modules/whatsapp/turno", () => ({
  processarTurno: (...a: unknown[]) => processarTurnoMock(...a),
}));

const { drenarFila, TEMPO_MAX_TURNO_MS } = await import(
  "../../src/modules/whatsapp/fila/consumidor"
);

/**
 * `JOB_LEASE_MS` e `LEASE_DURACAO_MS` são lidos do TEXTO dos arquivos, não
 * importados: os dois módulos que os declaram alcançam `@/lib/prisma`, e
 * importá-los faria este arquivo — que não toca banco — passar a exigir
 * `DATABASE_URL`.
 */
function constanteDoArquivo(caminhoRelativo: string, nome: string): number {
  const fs = require("node:fs") as typeof import("node:fs");
  const texto = fs.readFileSync(new URL(caminhoRelativo, import.meta.url), "utf8");
  const achado = new RegExp(`const ${nome} = ([\\d_]+);`).exec(texto);
  // Sem esta guarda, um `const` renomeado devolveria NaN e a comparação de
  // ordem passaria calada — o "teste que não exercita".
  if (!achado) throw new Error(`${nome} não foi encontrada em ${caminhoRelativo}`);
  return Number(achado[1].replace(/_/g, ""));
}

const TOKEN = new Date("2026-08-21T12:00:00.000Z");
function jobReivindicado(id: string) {
  return {
    id,
    companyId: "empresa-1",
    conversationId: "conv-1",
    seq: 7,
    tentativaReagendamento: 0,
    tentativasEntrega: 1,
    leaseAte: TOKEN,
  };
}

beforeEach(() => {
  reivindicarJobMock.mockReset().mockResolvedValue(null);
  concluirJobMock.mockReset().mockResolvedValue(true);
  falharJobMock.mockReset().mockResolvedValue("reagendado");
  podarJobsMortosMock.mockReset().mockResolvedValue(0);
  processarTurnoMock.mockReset().mockResolvedValue(undefined);
  // A poda é por sorteio; travar o sorteio em "não poda" mantém os casos
  // abaixo determinísticos — o caso da poda tem o sorteio próprio.
  vi.spyOn(Math, "random").mockReturnValue(0.99);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("as três durações têm ordem, e a ordem é invariante", () => {
  it("TEMPO_MAX_TURNO_MS < LEASE_DURACAO_MS < JOB_LEASE_MS", async () => {
    // `maxDuration = 60` na rota era o teto do plano Hobby da Vercel, e o
    // comentário de LEASE_DURACAO_MS diz que 75s foi escolhido para ficar ACIMA
    // dele. Fora da Vercel nada mata a função: sem este teto em código, um
    // `processarTurno` pendurado passaria dos 75s, o lease da conversa expiraria
    // embaixo dele, e o fencing token — que existe para o caso RARO — viraria o
    // caso comum.
    const leaseConversa = constanteDoArquivo(
      "../../src/modules/whatsapp/turno.ts",
      "LEASE_DURACAO_MS"
    );
    const leaseJob = constanteDoArquivo(
      "../../src/modules/whatsapp/fila/postgres.ts",
      "JOB_LEASE_MS"
    );

    expect(TEMPO_MAX_TURNO_MS).toBeLessThan(leaseConversa);
    expect(leaseConversa).toBeLessThan(leaseJob);
  });
});

describe("drenarFila", () => {
  it("sem job pronto, não chama processarTurno e reporta que esgotou", async () => {
    const r = await drenarFila();
    expect(processarTurnoMock).not.toHaveBeenCalled();
    expect(r).toMatchObject({ processados: 0, esgotou: true });
  });

  it("processa o job e o CONCLUI com o token da reivindicação", async () => {
    reivindicarJobMock.mockResolvedValueOnce(jobReivindicado("j1")).mockResolvedValue(null);

    const r = await drenarFila();

    expect(processarTurnoMock).toHaveBeenCalledWith({
      companyId: "empresa-1",
      conversationId: "conv-1",
      seq: 7,
      tentativaReagendamento: 0,
    });
    expect(concluirJobMock).toHaveBeenCalledWith("empresa-1", "j1", TOKEN);
    expect(falharJobMock).not.toHaveBeenCalled();
    expect(r.processados).toBe(1);
  });

  it("handler que lança vira falharJob, e o laço continua", async () => {
    reivindicarJobMock
      .mockResolvedValueOnce(jobReivindicado("j1"))
      .mockResolvedValueOnce(jobReivindicado("j2"))
      .mockResolvedValue(null);
    processarTurnoMock.mockRejectedValueOnce(new Error("openai caiu"));

    const r = await drenarFila();

    expect(falharJobMock).toHaveBeenCalledWith("empresa-1", "j1", TOKEN, expect.stringContaining("openai caiu"));
    expect(concluirJobMock).toHaveBeenCalledWith("empresa-1", "j2", TOKEN);
    expect(r).toMatchObject({ processados: 1, falhados: 1 });
  });

  it("turno que passa do teto vira FALHA, e não pendura o laço", async () => {
    vi.useFakeTimers();
    reivindicarJobMock.mockResolvedValueOnce(jobReivindicado("j1")).mockResolvedValue(null);
    processarTurnoMock.mockImplementation(() => new Promise(() => {})); // nunca resolve

    const promessa = drenarFila();
    await vi.advanceTimersByTimeAsync(TEMPO_MAX_TURNO_MS + 1_000);
    const r = await promessa;

    expect(falharJobMock).toHaveBeenCalledWith(
      "empresa-1",
      "j1",
      TOKEN,
      expect.stringContaining("teto")
    );
    expect(r.falhados).toBe(1);
    vi.useRealTimers();
  });

  it("job que morreu é contado e registrado", async () => {
    reivindicarJobMock.mockResolvedValueOnce(jobReivindicado("j1")).mockResolvedValue(null);
    processarTurnoMock.mockRejectedValueOnce(new Error("sempre falha"));
    falharJobMock.mockResolvedValueOnce("morto");
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await drenarFila();

    expect(r.mortos).toBe(1);
    expect(erro).toHaveBeenCalledWith(expect.stringContaining("conv-1"));
  });

  it("respeita o teto do lote e reporta que NÃO esgotou", async () => {
    reivindicarJobMock.mockResolvedValue(jobReivindicado("jN"));

    const r = await drenarFila({ loteMax: 3 });

    expect(processarTurnoMock).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ processados: 3, esgotou: false });
  });

  it("poda pela empresa do job, quando o sorteio manda", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.001);
    reivindicarJobMock.mockResolvedValueOnce(jobReivindicado("j1")).mockResolvedValue(null);

    await drenarFila();

    expect(podarJobsMortosMock).toHaveBeenCalledWith("empresa-1");
  });

  it("poda que falha não derruba a drenagem", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.001);
    reivindicarJobMock.mockResolvedValueOnce(jobReivindicado("j1")).mockResolvedValue(null);
    podarJobsMortosMock.mockRejectedValueOnce(new Error("banco tossiu"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await drenarFila();
    expect(r.processados).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
npx vitest run tests/unit/fila-consumidor.test.ts
```

Esperado: FAIL — `src/modules/whatsapp/fila/consumidor.ts` não existe.

- [ ] **Step 3: Escrever o drenador**

Criar `src/modules/whatsapp/fila/consumidor.ts`:

```ts
import "server-only";

import { processarTurno } from "../turno";
import {
  concluirJob,
  falharJob,
  podarJobsMortos,
  reivindicarJob,
} from "./postgres";

/**
 * O drenador da fila: reivindica, processa, conclui ou falha, e repete.
 *
 * ## Por que ele é uma FUNÇÃO, e não uma rota nem um laço
 *
 * A hospedagem deste projeto está em aberto (decisão do dono, 2026-08-21), e o
 * desenho não pode presumir nenhuma. Toda a lógica mora aqui, e os DOIS
 * gatilhos possíveis são cascas finas em volta desta função:
 *
 * - `src/app/api/queues/whatsapp-turn/route.ts` — HTTP, autenticado por
 *   cabeçalho. Serve a `pg_cron`+`pg_net`, a `cron`+`curl`, a um agendador de
 *   plataforma, ou a um workflow do n8n.
 * - `scripts/fila-worker.ts` — laço em processo, sem abrir porta nenhuma.
 *   Quem usar essa forma pode deixar a rota inacessível de fora.
 *
 * Nenhum dos dois é ligado por padrão. **Sem um deles rodando, a fila enche e
 * ninguém responde** — é a única regressão funcional da saída da Vercel, que
 * empurrava sozinha, e está escrita em `.env.example` e em `docs/ESTADO.md`.
 */

/**
 * Teto de duração de UM turno.
 *
 * Isto não é zelo: é a reposição de uma garantia que a plataforma dava.
 * `export const maxDuration = 60` na rota consumidora era o teto do plano Hobby
 * da Vercel, e o comentário de `LEASE_DURACAO_MS` (`../turno.ts`) diz
 * textualmente que os 75s do lease da CONVERSA foram escolhidos para ficar
 * ACIMA dele. Fora da Vercel nada mata a função. Sem este teto, um
 * `processarTurno` pendurado passaria dos 75s, o lease da conversa expiraria
 * embaixo dele, e o fencing token — que existe para o caso RARO — viraria o
 * caso comum.
 *
 * A ordem `TEMPO_MAX_TURNO_MS < LEASE_DURACAO_MS < JOB_LEASE_MS` (60 < 75 < 90)
 * é invariante, e `tests/unit/fila-consumidor.test.ts` a lê das três constantes
 * em vez de afirmá-la em prosa.
 */
export const TEMPO_MAX_TURNO_MS = 60_000;

/**
 * Quantos jobs uma drenagem trata antes de devolver o controle.
 *
 * Existe porque o gatilho HTTP é SÍNCRONO: quem chama espera. Sem teto, uma
 * fila com mil jobs seguraria a requisição por horas e estouraria qualquer
 * timeout de cliente. Com teto, a resposta diz `esgotou: false` e quem
 * agenda sabe que vale chamar de novo já.
 */
export const LOTE_MAX_PADRAO = 10;

/**
 * Mesma poda probabilística de `core/rate-limit/limiter.ts` e
 * `core/notifications/dispatch.ts`, e pelo mesmo motivo de fundo: limpeza que
 * depende de alguém configurar algo pode nunca entrar em vigor.
 *
 * Depois deste ciclo existe um laço nosso, então a justificativa original
 * ("cron exigiria configuração no painel da Vercel") enfraqueceu — mas a
 * decisão fica: esta poda vale sozinha, sem configuração nenhuma, e é isso que
 * a distingue de um agendamento que alguém precisa lembrar de ligar.
 */
export const CHANCE_DE_PODA = 0.01;

export interface ResultadoDrenagem {
  processados: number;
  falhados: number;
  mortos: number;
  /** `true` quando a fila acabou antes do lote — nada mais pronto agora. */
  esgotou: boolean;
}

export async function drenarFila(opcoes?: { loteMax?: number }): Promise<ResultadoDrenagem> {
  const loteMax = opcoes?.loteMax ?? LOTE_MAX_PADRAO;
  const resultado: ResultadoDrenagem = {
    processados: 0,
    falhados: 0,
    mortos: 0,
    esgotou: false,
  };

  for (let i = 0; i < loteMax; i++) {
    const job = await reivindicarJob();
    if (!job) {
      resultado.esgotou = true;
      return resultado;
    }

    try {
      await comTeto(
        processarTurno({
          companyId: job.companyId,
          conversationId: job.conversationId,
          seq: job.seq,
          tentativaReagendamento: job.tentativaReagendamento,
        }),
        TEMPO_MAX_TURNO_MS
      );

      const concluido = await concluirJob(job.companyId, job.id, job.leaseAte);
      if (!concluido) {
        // Lease perdido entre o início e o fim do turno. Não é falha do turno —
        // é o sistema se recuperando de um atraso. Vale log, não alarme: quem
        // reivindicou depois vai reprocessar, e `processarMensagensPendentes`
        // não tem o que fazer se o primeiro já respondeu.
        console.warn(
          `Turno da conversa ${job.conversationId} terminou com o lease do job já expirado ` +
            `(job ${job.id}) — outro consumidor pode ter reivindicado no meio.`
        );
      }
      resultado.processados++;
    } catch (erro) {
      const desfecho = await falharJob(
        job.companyId,
        job.id,
        job.leaseAte,
        erro instanceof Error ? erro.message : String(erro)
      );

      if (desfecho === "morto") {
        resultado.mortos++;
        // Barulhento de propósito: um job morto é uma conversa que NÃO foi
        // respondida. A linha fica em `TurnoJob` com `ultimoErro` por 7 dias,
        // mas quem lê log não vai ao banco por conta própria.
        console.error(
          `Job da conversa ${job.conversationId} (empresa ${job.companyId}, job ${job.id}) ` +
            `MORREU depois de esgotar as tentativas de entrega. A conversa ficou sem resposta.`
        );
      } else {
        resultado.falhados++;
      }
    }

    await podarDeVezEmQuando(job.companyId);
  }

  return resultado;
}

/**
 * `Promise.race` com um temporizador, e o `clearTimeout` no `finally`.
 *
 * A ressalva honesta: isto **não cancela** `processarTurno` — não há como, e
 * fingir que há seria pior. A promessa abandonada continua rodando até
 * terminar sozinha. O que o teto garante é que o LAÇO segue em frente e que o
 * job é liberado para retentativa. A segurança do que ficou para trás vem de
 * outro lugar, e ele já existe: o fencing token de `confirmarTitularidadeLease`
 * (`../turno.ts`), que faz o turno atrasado abortar ANTES de enviar qualquer
 * mensagem quando o lease da conversa já não é dele.
 */
async function comTeto<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promessa,
      new Promise<never>((_, rejeitar) => {
        temporizador = setTimeout(
          () => rejeitar(new Error(`Turno passou do teto de ${ms}ms sem terminar.`)),
          ms
        );
      }),
    ]);
  } finally {
    if (temporizador) clearTimeout(temporizador);
  }
}

async function podarDeVezEmQuando(companyId: string): Promise<void> {
  if (Math.random() >= CHANCE_DE_PODA) return;
  try {
    await podarJobsMortos(companyId);
  } catch (erro) {
    // Higiene, não decisão: falhar aqui nunca pode impedir a fila de andar.
    // E REGISTRA em vez de engolir — um `catch` vazio faria a poda sumir sem
    // ninguém notar, e a tabela voltaria a crescer em silêncio.
    console.error("Falha ao podar jobs mortos da fila:", erro);
  }
}
```

- [ ] **Step 4: Verde**

```bash
npx vitest run tests/unit/fila-consumidor.test.ts
npm run typecheck
```

Esperado: os 9 casos passando. **Se o caso do teto pendurar a suíte**, o `vi.useFakeTimers()` não está pegando o `setTimeout` de `comTeto` — reporte em vez de aumentar timeout.

- [ ] **Step 5: Commit**

```
feat(fila): drenador com teto de duracao por turno

`maxDuration = 60` era o teto do plano Hobby da Vercel, e o comentario de
LEASE_DURACAO_MS diz que os 75s do lease da conversa foram escolhidos
para ficar ACIMA dele. Fora da Vercel nada mata a funcao: sem teto em
codigo, o fencing token viraria o caso comum em vez do raro.

Toda a logica fica numa funcao para os dois gatilhos possiveis serem
cascas finas -- a hospedagem esta em aberto e o desenho nao pode presumir
nenhuma.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

### Task 5: O worker em processo — o gatilho que não precisa de rede

**DEPENDE DE AÇÃO DO DONO:** não para existir. **Sim para ser LIGADO** — ver "Ações do dono".

**Files:**
- Create: `scripts/fila-worker.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `drenarFila`, `LOTE_MAX_PADRAO` (`src/modules/whatsapp/fila/consumidor`, Tarefa 4).
- Produces: script `npm run fila:worker`.

- [ ] **Step 1: Escrever o worker**

Criar `scripts/fila-worker.ts`:

```ts
import "dotenv/config";

import { drenarFila } from "../src/modules/whatsapp/fila/consumidor";

/**
 * O gatilho da fila que NÃO depende de rede.
 *
 * ## Por que ele existe ao lado do endpoint HTTP
 *
 * A hospedagem deste projeto está em aberto. O endpoint
 * (`src/app/api/queues/whatsapp-turn/route.ts`) serve a quem for acionar de
 * fora — `pg_cron`+`pg_net`, `cron`+`curl`, um agendador de plataforma. Este
 * script serve a quem tiver um Node sempre ligado, e é a opção com **menor
 * superfície**: não abre porta nenhuma, então quem o usar pode deixar a rota
 * inacessível de fora e a fila continua funcionando.
 *
 * É também a opção com **menor latência**. A janela de buffer é de 8s; com este
 * laço a 2s a resposta sai em ~8-10s, praticamente igual ao que a Vercel
 * entregava. Um `cron` de um minuto entregaria a mesma resposta em até ~68s.
 *
 * ## Sem `while (true) { await sleep }` cego
 *
 * Quando `drenarFila` devolve `esgotou: false`, ainda há trabalho pronto: o
 * laço volta IMEDIATAMENTE, sem dormir. Dormir depois de um lote cheio
 * introduziria atraso proporcional ao tamanho da fila justamente quando ela
 * está grande.
 *
 * ## `dotenv/config` como primeiro import
 *
 * Este processo roda fora do Next, que carrega `.env` sozinho. Sem isto,
 * `src/lib/env.ts` — que lê `DATABASE_URL` no escopo do módulo — derruba o
 * processo na importação. Mesmo padrão de `tests/unit/rate-limit.test.ts`.
 *
 * ## Um processo por vez não é exigido
 *
 * Dois workers em máquinas diferentes são CORRETOS por construção: a
 * reivindicação é um `UPDATE` condicional atômico e o caso "N reivindicações
 * concorrentes devolvem ids distintos" (`tests/unit/fila-postgres.test.ts`) o
 * prova contra o Postgres real. 🔍 NÃO VERIFICADO: dois PROCESSOS Node
 * simultâneos, medidos. Um humano roda `npm run fila:worker` em dois terminais
 * e confere que nenhuma conversa recebe resposta duplicada.
 */

const INTERVALO_OCIOSO_MS = 2_000;

let parando = false;

for (const sinal of ["SIGINT", "SIGTERM"] as const) {
  // Encerramento limpo: para de pegar job novo e deixa o que está em curso
  // terminar. Matar no meio não corrompe nada — o lease do job expira e ele é
  // reentregue —, mas custa até 90s de espera para aquela conversa.
  process.on(sinal, () => {
    if (parando) process.exit(1);
    parando = true;
    console.log(`\n${sinal} recebido: terminando o turno em curso e saindo.`);
  });
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

async function principal(): Promise<void> {
  console.log("Worker da fila de turnos iniciado. Ctrl+C para sair.");

  while (!parando) {
    try {
      const resultado = await drenarFila();
      if (resultado.processados || resultado.falhados || resultado.mortos) {
        console.log(
          `drenagem: ${resultado.processados} processados, ${resultado.falhados} falhados, ` +
            `${resultado.mortos} mortos`
        );
      }
      if (resultado.esgotou) await dormir(INTERVALO_OCIOSO_MS);
    } catch (erro) {
      // O laço NÃO morre por erro de uma volta. `drenarFila` já trata falha de
      // turno; o que chega aqui é falha de infraestrutura (banco fora do ar),
      // e nesse caso a resposta certa é esperar e tentar de novo, não sair —
      // um worker que morre no primeiro soluço de rede é um worker que exige
      // supervisor para tudo.
      console.error("Falha na drenagem da fila:", erro);
      await dormir(INTERVALO_OCIOSO_MS);
    }
  }

  console.log("Worker da fila encerrado.");
  process.exit(0);
}

void principal();
```

- [ ] **Step 2: Registrar o script**

Em `package.json`, na seção `scripts`, acrescentar depois de `"seed:demo:limpar"`:

```json
    "fila:worker": "tsx scripts/fila-worker.ts",
```

- [ ] **Step 3: Provar que ele sobe e sai limpo**

```bash
npm run typecheck
```

Esperado: limpo.

🔍 **NÃO VERIFICADO neste passo:** que o worker drena um job de verdade. Ele só teria o que drenar depois da Tarefa 6, quando `publicarTurno` passa a gravar em `TurnoJob`. A verificação de ponta a ponta é a Tarefa 11, Step 4.

- [ ] **Step 4: Commit**

```
feat(fila): worker em processo, o gatilho que nao precisa de rede

A hospedagem esta em aberto, entao o ciclo entrega DOIS gatilhos e nenhum
presume plataforma. Este e o de menor superficie -- nao abre porta -- e o
de menor latencia: laco de 2s mantem a resposta em ~8-10s, contra ate
~68s de um cron de um minuto.

Volta imediatamente quando `esgotou` e falso: dormir depois de um lote
cheio atrasaria justamente quando a fila esta grande.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

### Task 6: MIGRA — as duas pontas da costura viram juntas

**DEPENDE DE AÇÃO DO DONO:** não.

> **Esta é a tarefa em que a fila troca de dono.** O publicador (`fila/index.ts`) e o consumidor (a rota) são as duas pontas da MESMA costura: trocar uma sem a outra deixa jobs indo para um lugar que ninguém lê. Por isso elas viram no mesmo passo. `@vercel/queue` continua instalado e `fila/vercel.ts` continua no disco — a contração é a Tarefa 7.

**Files:**
- Modify: `src/modules/whatsapp/fila/index.ts`
- Modify: `src/app/api/queues/whatsapp-turn/route.ts`
- Modify: `src/proxy.ts`
- Delete: `tests/unit/whatsapp-queue-consumer-route.test.ts`
- Create: `tests/unit/fila-tick-route.test.ts`
- Modify: `tests/unit/whatsapp-fila.test.ts`

**Interfaces:**
- Consumes: `FilaPostgres` (`./postgres`, Tarefa 2); `drenarFila` (`./consumidor`, Tarefa 4); `segredoConfere` (`@/lib/segredo`, Tarefa 3).
- Produces: `publicarTurno` gravando em `TurnoJob`; `POST /api/queues/whatsapp-turn` como **tick autenticado**, respondendo `404` a segredo inválido e `{ ok: true, ...ResultadoDrenagem }` a segredo válido.

- [ ] **Step 1: Escrever o caso da rota nova (RED)**

Criar `tests/unit/fila-tick-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const drenarFilaMock = vi.fn();
vi.mock("@/modules/whatsapp/fila/consumidor", () => ({
  drenarFila: (...a: unknown[]) => drenarFilaMock(...a),
}));

const SEGREDO = "segredo-de-tick-abc123";

function requisicao(cabecalhos: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/queues/whatsapp-turn", {
    method: "POST",
    headers: cabecalhos,
  });
}

describe("POST /api/queues/whatsapp-turn (tick da fila)", () => {
  beforeEach(() => {
    process.env.WHATSAPP_QUEUE_SECRET = SEGREDO;
    drenarFilaMock
      .mockReset()
      .mockResolvedValue({ processados: 2, falhados: 0, mortos: 0, esgotou: true });
  });

  it("drena quando o segredo confere", async () => {
    const { POST } = await import("../../src/app/api/queues/whatsapp-turn/route");
    const resposta = await POST(requisicao({ "x-fila-segredo": SEGREDO }));

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toMatchObject({ ok: true, processados: 2, esgotou: true });
    expect(drenarFilaMock).toHaveBeenCalledTimes(1);
  });

  it("responde 404 sem o cabeçalho, e NÃO drena", async () => {
    // 404 e não 401: mesma decisão já tomada na rota do webhook — não confirma
    // a quem está adivinhando que este path sequer existe. Fora da Vercel esta
    // rota deixou de ser air-gapped, então o que ela responde a um desconhecido
    // passou a importar.
    const { POST } = await import("../../src/app/api/queues/whatsapp-turn/route");
    const resposta = await POST(requisicao());

    expect(resposta.status).toBe(404);
    expect(drenarFilaMock).not.toHaveBeenCalled();
  });

  it("responde 404 com segredo errado, e NÃO drena", async () => {
    const { POST } = await import("../../src/app/api/queues/whatsapp-turn/route");
    const resposta = await POST(requisicao({ "x-fila-segredo": "chute" }));

    expect(resposta.status).toBe(404);
    expect(drenarFilaMock).not.toHaveBeenCalled();
  });

  it("responde 404 quando a variável NÃO está definida — fecha fechado", async () => {
    delete process.env.WHATSAPP_QUEUE_SECRET;
    const { POST } = await import("../../src/app/api/queues/whatsapp-turn/route");
    const resposta = await POST(requisicao({ "x-fila-segredo": "qualquer" }));

    expect(resposta.status).toBe(404);
    expect(drenarFilaMock).not.toHaveBeenCalled();
  });

  it("o segredo NÃO é lido no escopo do módulo", async () => {
    // Validação em escopo de módulo já derrubou o build deste projeto uma vez
    // (`gateway/index.ts`): `next build` avalia módulos alcançáveis para
    // coletar configuração de rota, e a variável não existe nesse momento.
    delete process.env.WHATSAPP_QUEUE_SECRET;
    await expect(
      import("../../src/app/api/queues/whatsapp-turn/route")
    ).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
npx vitest run tests/unit/fila-tick-route.test.ts
```

Esperado: FAIL — a rota ainda exporta `POST = handleCallback(...)`, que não aceita um `Request` com esta forma e não devolve 404.

- [ ] **Step 3: Trocar o publicador**

Em `src/modules/whatsapp/fila/index.ts`, trocar o import e a linha da instância, e reescrever o comentário que previa este dia:

```ts
import "server-only";

import { FilaPostgres } from "./postgres";
import type { FilaTurnos, OpcoesPublicacao, TurnoJob } from "./tipos";

export type { FilaTurnos, OpcoesPublicacao, TurnoJob } from "./tipos";

let instancia: FilaTurnos | null = null;

/**
 * Construção preguiçosa, mesmo raciocínio de `gateway/index.ts`: importar não
 * pode custar nada além do import.
 *
 * A troca de provedor que este comentário previa em 2026-08-19 — "pg-boss na
 * VPS, BullMQ" — ACONTECEU em 2026-08-21, e foi mesmo trocar esta linha: os
 * três importadores de `publicarTurno` (a rota do webhook e `turno.ts`, em duas
 * linhas) não mudaram. O que sobrou de acoplamento era o
 * `DuplicateMessageError` importado FORA daqui, e ele morreu junto — hoje
 * duplicata é no-op dentro do adaptador (`./postgres.ts`).
 *
 * O provedor escolhido não foi nenhum dos dois nomeados: é o Postgres que o
 * projeto já tem, sem infra nova. O motivo está no spec do Ciclo 2d, §1.
 */
function obterFila(): FilaTurnos {
  if (instancia) return instancia;
  instancia = new FilaPostgres();
  return instancia;
}

/**
 * Mesma assinatura de sempre, e é esse o ponto: `"./fila"` e
 * `"@/modules/whatsapp/fila"` continuam resolvendo para este arquivo.
 */
export async function publicarTurno(job: TurnoJob, opcoes?: OpcoesPublicacao): Promise<void> {
  return obterFila().publicar(job, opcoes);
}
```

- [ ] **Step 4: Trocar o consumidor**

Substituir o conteúdo inteiro de `src/app/api/queues/whatsapp-turn/route.ts` por:

```ts
import { NextResponse } from "next/server";

import { segredoConfere } from "@/lib/segredo";
import { drenarFila } from "@/modules/whatsapp/fila/consumidor";

/**
 * O TICK da fila de turnos.
 *
 * ## O que mudou, e por que a mudança é de segurança e não de encanamento
 *
 * Até o Ciclo 2d esta rota era um consumidor de push do Vercel Queues, e a
 * documentação da Vercel garantia que ela ficava "completamente air-gapped da
 * internet… só pode ser invocada pela infraestrutura interna de fila da
 * Vercel". A inspeção do código-fonte de `@vercel/queue` mostrava que o SDK
 * **não fazia nenhuma verificação de assinatura nem OIDC**: confiava
 * inteiramente naquela garantia de rede. O segredo compartilhado ia no PAYLOAD
 * do job como segunda camada.
 *
 * Fora da Vercel a primeira camada **deixa de existir**. Três consequências, e
 * as três estão tratadas aqui:
 *
 * 1. **A rota é alcançável da internet**, e o segredo passa a ser a única
 *    defesa. Ele sai do payload — que agora nem existe, porque o job é uma
 *    linha do nosso Postgres e não atravessa rede nenhuma — e vira o cabeçalho
 *    `x-fila-segredo` de quem ACIONA. O que precisa ser autenticado mudou de
 *    "esta mensagem" para "esta chamada", e cabeçalho é onde credencial de
 *    chamada mora.
 * 2. **A comparação** é `segredoConfere` (`@/lib/segredo`), sem o oráculo de
 *    comprimento que o `if (a.length !== b.length) return false` desta rota
 *    tinha. A defesa real continua sendo os 256 bits de entropia.
 * 3. **A resposta a segredo inválido é 404**, não 401 — mesma decisão da rota
 *    do webhook: não confirma a quem está adivinhando que este path sequer
 *    existe.
 *
 * ## O caminho não mudou de nome, de propósito
 *
 * `/api/queues/whatsapp-turn` continua igual porque `src/proxy.ts` já tem a
 * exceção daquele prefixo, com caso em `tests/unit/proxy-matcher.test.ts`.
 * Renomear custaria mexer nos dois por zero ganho.
 *
 * ## Quem chama isto
 *
 * Qualquer agendador: `pg_cron`+`pg_net` do Supabase, `cron`+`curl` numa VPS,
 * um workflow do n8n. **Nada chama por padrão** — quem tiver um Node sempre
 * ligado deve preferir `npm run fila:worker`, que faz o mesmo trabalho sem
 * abrir porta.
 *
 * ## `esgotou: false` é um pedido
 *
 * O corpo devolve o resultado da drenagem. `esgotou: false` significa que
 * sobrou trabalho pronto e que vale chamar de novo agora, sem esperar o próximo
 * agendamento.
 *
 * ## O segredo é lido DENTRO da função
 *
 * Validar em escopo de módulo já derrubou o build deste projeto uma vez
 * (`modules/whatsapp/gateway/index.ts`): `next build` avalia módulos
 * alcançáveis para coletar configuração de rota, e a variável não existe nesse
 * momento. Há caso de teste para isso.
 */
export async function POST(request: Request): Promise<Response> {
  const esperado = process.env.WHATSAPP_QUEUE_SECRET ?? "";
  const recebido = request.headers.get("x-fila-segredo") ?? "";

  if (!segredoConfere(recebido, esperado)) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const resultado = await drenarFila();
  return NextResponse.json({ ok: true, ...resultado });
}
```

**Não** reintroduza `export const maxDuration`: ele era o teto do plano Hobby da Vercel, e o teto agora é `TEMPO_MAX_TURNO_MS`, em código (Tarefa 4).

- [ ] **Step 5: Corrigir o que o proxy afirma sobre este caminho**

Em `src/proxy.ts`, no bloco de exceções do matcher, substituir o item `api/queues` (hoje: *"invocado pela infraestrutura de fila da Vercel… Seguro mesmo sem token próprio… só a própria Vercel invoca"*) por:

```
   * - api/queues: o TICK da fila (`/api/queues/whatsapp-turn/route.ts`), que
   *   drena os turnos pendentes. Não tem sessão de usuário. Até o Ciclo 2d ele
   *   era um consumidor de push do Vercel Queues e a garantia era de REDE — a
   *   plataforma mantinha a rota air-gapped da internet. Fora da Vercel essa
   *   garantia não existe mais, e o comentário que a citava aqui teria virado
   *   mentira no mesmo commit. Hoje a rota **se autentica sozinha**, com um
   *   segredo em cabeçalho comparado em tempo constante, e responde 404 a quem
   *   não tem — mesma resposta que o webhook dá, pelo mesmo motivo.
   *
   *   **Invariante que este subdiretório passa a carregar**, igual ao de
   *   `/api/whatsapp/*`: tudo sob `/api/queues/*` é público por definição, e
   *   toda rota nova criada ali precisa se autenticar sozinha.
```

- [ ] **Step 6: Apagar o teste do consumidor antigo e ajustar o da fila**

```bash
git rm tests/unit/whatsapp-queue-consumer-route.test.ts
```

Ele testava a validação do segredo **no payload** através de `handleCallback` mockado — um mecanismo que deixou de existir. O substituto é `tests/unit/fila-tick-route.test.ts`, criado no Step 1, e **nenhum caso se perde**: "segredo válido processa", "segredo inválido não processa" e "sem segredo não processa" têm equivalente lá.

Em `tests/unit/whatsapp-fila.test.ts`, trocar o mock de `@vercel/queue` por um mock do adaptador. O arquivo existe para provar que `publicarTurno` **de verdade** (não mockado) chega ao adaptador; o que muda é qual limite externo é simulado. Substituir o cabeçalho e o mock por:

```ts
// Este arquivo testa `publicarTurno` DE VERDADE (não mockado) — só o limite
// externo é simulado. Até o Ciclo 2d esse limite era `send` de `@vercel/queue`,
// com uma simulação fiel da dedupe por `idempotencyKey`; hoje é o adaptador de
// Postgres, e a dedupe virou `@@unique([companyId, chaveIdempotencia])` +
// `skipDuplicates` — que NÃO lança. O caso "publicar duas vezes não lança"
// continua existindo, agora afirmando o desfecho novo.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const publicarMock = vi.fn(async () => {});
vi.mock("@/modules/whatsapp/fila/postgres", () => ({
  FilaPostgres: class {
    publicar = publicarMock;
  },
}));

const { publicarTurno } = await import("../../src/modules/whatsapp/fila");
```

E os casos passam a afirmar o que chega ao adaptador (`job` e `opcoes`), em vez do que chegava a `send`. **Não remova caso nenhum**: para cada caso que hoje afirma `idempotencyKey`/`delaySeconds` em `send`, escreva o equivalente sobre os argumentos de `publicar` — a forma da chave passou a ser responsabilidade de `postgres.ts` e já tem cobertura própria em `fila-postgres.test.ts`.

- [ ] **Step 7: Verde**

```bash
npx vitest run tests/unit/fila-tick-route.test.ts tests/unit/whatsapp-fila.test.ts tests/unit/proxy-matcher.test.ts
npm run typecheck
npm run build
```

Esperado: verdes. `npm run build` continua funcionando **apesar de `vercel.json` ainda existir** — ele só declara um gatilho de plataforma, e nada no build o lê.

- [ ] **Step 8: Commit**

```
feat(fila): as duas pontas da costura viram juntas

publicarTurno passa a gravar em TurnoJob e a rota /api/queues/whatsapp-turn
deixa de ser consumidor de push e vira TICK autenticado. Um passo so
porque sao as duas pontas da mesma costura: trocar uma sem a outra deixa
job indo para um lugar que ninguem le.

O segredo sai do PAYLOAD e vira cabecalho. Ele estava no payload porque a
entrega era feita pela plataforma; agora o job nao atravessa rede nenhuma.
A garantia de rede que o comentario do proxy citava morreu neste commit, e
o comentario morreu junto.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

### Task 7: CONTRAI — a Vercel sai

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Delete: `src/modules/whatsapp/fila/vercel.ts`
- Delete: `tests/unit/whatsapp-fila-vercel.test.ts`
- Delete: `vercel.json`
- Modify: `package.json`
- Modify: `src/modules/whatsapp/turno.ts`
- Modify: `src/app/api/whatsapp/evolution/[companyId]/[token]/route.ts`
- Modify: `src/modules/whatsapp/fila/tipos.ts`
- Modify: `tests/unit/whatsapp-turno.test.ts`, `tests/unit/whatsapp-webhook-route.test.ts`

**Interfaces:**
- Consumes: `FilaPostgres` já em uso (Tarefa 6).
- Produces: **zero** ocorrências de `@vercel/queue` em `src/` e `tests/`; `vercel.json` inexistente.

- [ ] **Step 1: Medir antes**

```bash
grep -rn "@vercel/queue" src/ tests/ package.json
```

Esperado: as ocorrências em `fila/vercel.ts`, `turno.ts`, a rota do webhook, `tipos.ts` (só em comentário), os dois testes, e a dependência. Cole a saída — ela é a lista de trabalho deste passo.

- [ ] **Step 2: Tirar `DuplicateMessageError` de `turno.ts`**

Remover o import da linha 3 e o `catch` que o usava. O bloco de `processarTurno` que hoje é:

```ts
    try {
      await publicarTurno({ ...job, tentativaReagendamento: tentativa }, { delaySeconds: 5 });
    } catch (erro) {
      // … comentário longo sobre DuplicateMessageError …
      if (erro instanceof DuplicateMessageError) return;
      throw erro;
    }
    return;
```

vira:

```ts
    // Sem `try/catch` de duplicata desde o Ciclo 2d, e a razão está em
    // `fila/postgres.ts`: republicar a MESMA chave é `INSERT ... skipDuplicates`,
    // ou seja, no-op — não lança mais. O motivo por que ela lançava antes fica
    // registrado aqui porque o CASO continua acontecendo: entrega "pelo menos
    // uma vez" significa que a fila pode reentregar o mesmo job (mesmo `seq`,
    // mesma `tentativaReagendamento`) quando a confirmação de um handler que já
    // rodou se perde. O reagendamento daquela tentativa já está gravado, e
    // "já existe" é exatamente o resultado desejado — não uma falha. O que
    // mudou é que agora isso é silêncio em vez de exceção traduzida.
    await publicarTurno({ ...job, tentativaReagendamento: tentativa }, { delaySeconds: 5 });
    return;
```

Também atualizar o comentário de `MAX_TENTATIVAS_REAGENDAMENTO` (hoje cita "a janela de dedupe do Vercel Queues (até 24h)"): a janela passou a ser "enquanto a linha existir", e a `chaveIdempotencia` própria por tentativa continua sendo necessária **pelo mesmo motivo** — sem ela, o job reagendado colidiria consigo mesmo enquanto o original ainda estivesse na tabela.

- [ ] **Step 3: Tirar `DuplicateMessageError` da rota do webhook**

Em `src/app/api/whatsapp/evolution/[companyId]/[token]/route.ts`, remover o import da linha 2 e achatar o `try/catch` interno:

```ts
      const resultado = await ingerirMensagem(evento, {
        companyId: conexao.companyId,
        connectionId: conexao.id,
      });
      // Sem `catch` de duplicata desde o Ciclo 2d: `publicarTurno` deixou de
      // lançar em republicação da mesma chave (ver `fila/postgres.ts`). O
      // caminho de redelivery continua existindo e continua sendo inofensivo —
      // ele só deixou de precisar de tradução aqui.
      await publicarTurno({
        companyId: resultado.companyId,
        conversationId: resultado.conversationId,
        seq: resultado.bufferSeq,
      });
```

O `catch (erro)` **externo** (o que marca `algumEventoFalhou`) **fica**: ele existe para falha de verdade, não para duplicata.

E no comentário de cabeçalho da rota, a frase *"`publicarTurno` (idempotencyKey) são idempotentes"* passa a citar a chave nova: *"`publicarTurno` (`@@unique([companyId, chaveIdempotencia])`) são idempotentes"*.

- [ ] **Step 4: Atualizar o comentário de `tipos.ts`**

O arquivo cita `@vercel/queue` e "a decisão 6 do spec (2026-08-19) mantém a Vercel como runtime". Substituir esse parágrafo por:

```ts
/**
 * Abstração sobre o provedor de fila — mesmo padrão de `WhatsappGateway`.
 *
 * A decisão 6 do spec fundador (2026-08-19) exigiu esta costura para que mover
 * o CRM para fora da Vercel fosse escrever um SEGUNDO adaptador, não reescrever
 * o módulo de WhatsApp. Ela foi reaberta em 2026-08-21 — o dono decidiu não
 * usar a Vercel — e a costura pagou: `FilaPostgres` (`./postgres.ts`) entrou no
 * lugar de `FilaVercel` trocando uma linha de `./index.ts`, e os três
 * importadores de `publicarTurno` não mudaram.
 */
```

E o parágrafo de topo que diz "sem importar `@vercel/queue`" passa a dizer "sem importar o SDK de nenhum provedor".

- [ ] **Step 5: Apagar o que sobrou**

```bash
git rm src/modules/whatsapp/fila/vercel.ts
git rm tests/unit/whatsapp-fila-vercel.test.ts
git rm vercel.json
npm uninstall @vercel/queue
```

`whatsapp-fila-vercel.test.ts` existia para provar que `FilaVercel` era **uma** implementação de `FilaTurnos`, substituível. Essa afirmação foi provada da forma mais forte possível: pela substituição real. O papel dele passa para `tests/unit/fila-postgres.test.ts`.

- [ ] **Step 6: Ajustar os mocks que restaram nos testes**

Em `tests/unit/whatsapp-turno.test.ts` e `tests/unit/whatsapp-webhook-route.test.ts`, remover qualquer `vi.mock("@vercel/queue", …)` e o `DuplicateMessageErrorFake` que os acompanhava. **Não remova caso nenhum** — os casos que hoje afirmam "duplicata não derruba o fluxo" continuam válidos e passam a afirmar que `publicarTurno` resolvendo normalmente não interrompe nada.

- [ ] **Step 7: Verde, e a varredura que fecha**

```bash
grep -rn "@vercel/queue" src/ tests/ package.json ; echo "saida acima deve ser VAZIA"
ls vercel.json 2>&1 | head -1
npx vitest run tests/unit/whatsapp-turno.test.ts tests/unit/whatsapp-webhook-route.test.ts tests/unit/whatsapp-fila.test.ts
npm run typecheck
npm run build
```

Esperado: o `grep` sem saída; `ls` respondendo que o arquivo não existe; testes verdes; typecheck limpo; build verde.

- [ ] **Step 8: Commit**

```
refactor(fila): a Vercel sai -- adaptador, consumidor, vercel.json e o SDK

CONTRAI. O substituto ja estava no ar desde o commit anterior, entao
apagar aqui nao deixa o WhatsApp mudo em momento nenhum.

DuplicateMessageError era o unico tipo do provedor importado FORA do
adaptador -- o furo da costura do Ciclo 0. Ele morre porque duplicata
virou no-op: os dois chamadores ja traduziam a excecao para "tudo bem".

whatsapp-fila-vercel.test.ts existia para provar que FilaVercel era UMA
implementacao substituivel. Isso acabou de ser provado por substituicao.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

### Task 8: O IP real sem o cabeçalho da Vercel

**DEPENDE DE AÇÃO DO DONO:** não para o código. **Sim para o COMPORTAMENTO em produção** — `IP_CABECALHO_CONFIAVEL` só o dono define, e sem ela não há limite por IP no login nem `AuditLog.ip`.

**Files:**
- Modify: `src/lib/ip.ts`
- Modify: `src/core/rate-limit/login.ts`
- Modify: `src/app/api/whatsapp/evolution/[companyId]/[token]/route.ts`
- Modify: `tests/unit/auditoria-login.test.ts`, `tests/unit/login-seguranca.test.ts`, `tests/unit/export-leads.test.ts`, `tests/unit/whatsapp-webhook-route.test.ts`

**Interfaces:**
- Consumes: `checarRateLimit` (`./limiter`).
- Produces:
  - `export const IP_DESCONHECIDO = "desconhecido"` (`src/lib/ip.ts`)
  - `obterIpDaRequisicao(request)` lendo **só** o cabeçalho nomeado por `IP_CABECALHO_CONFIAVEL`
  - `ipDaRequisicaoAtual()` com a mesma regra
  - `checarLimiteLogin` pulando a dimensão de IP quando `IP_DESCONHECIDO`

- [ ] **Step 1: Escrever os casos que falham (RED)**

Em `tests/unit/auditoria-login.test.ts`, substituir os três casos de precedência de cabeçalho (linhas ~275-300) por:

```ts
  it("sem IP_CABECALHO_CONFIAVEL, NENHUM cabeçalho vira IP", async () => {
    // `x-vercel-forwarded-for` funcionava por uma propriedade da plataforma: ela
    // SOBRESCREVIA o que viesse de fora com aquele nome. Fora da Vercel sobram
    // `x-real-ip` e `x-forwarded-for`, e os dois são escolhidos pelo cliente
    // quando não há proxy confiável na frente. Continuar lendo-os seria trocar
    // um cabeçalho não forjável por um forjável SEM mudar uma linha de
    // comentário — o pior desfecho, porque o código seguiria afirmando uma
    // garantia que perdeu.
    delete process.env.IP_CABECALHO_CONFIAVEL;
    expect(
      await comCabecalhos({
        "x-forwarded-for": "198.51.100.9",
        "x-real-ip": "203.0.113.60",
        "x-vercel-forwarded-for": "203.0.113.55",
      })
    ).toBeUndefined();
  });

  it("com IP_CABECALHO_CONFIAVEL definida, SÓ o cabeçalho nomeado é lido", async () => {
    process.env.IP_CABECALHO_CONFIAVEL = "x-real-ip";
    expect(
      await comCabecalhos({
        "x-real-ip": "203.0.113.60",
        "x-forwarded-for": "198.51.100.9",
      })
    ).toBe("203.0.113.60");
  });

  it("o cabeçalho nomeado que chega ausente NÃO cai para outro", async () => {
    process.env.IP_CABECALHO_CONFIAVEL = "cf-connecting-ip";
    expect(await comCabecalhos({ "x-forwarded-for": "198.51.100.9" })).toBeUndefined();
  });

  it("pega o primeiro da lista quando a borda manda vários", async () => {
    process.env.IP_CABECALHO_CONFIAVEL = "x-vercel-forwarded-for";
    expect(
      await comCabecalhos({ "x-vercel-forwarded-for": "203.0.113.70, 10.0.0.1, 10.0.0.2" })
    ).toBe("203.0.113.70");
  });
```

Em `tests/unit/login-seguranca.test.ts`, o caso da linha 153 (`"usa o IP não forjável (x-vercel-forwarded-for) como chave, não o x-forwarded-for do cliente"`) vira:

```ts
  it("usa SÓ o cabeçalho nomeado por IP_CABECALHO_CONFIAVEL como chave", async () => {
    process.env.IP_CABECALHO_CONFIAVEL = "x-vercel-forwarded-for";
    // … o corpo continua igual: `x-forwarded-for` presente deve ser ignorado.
  });

  it("sem cabeçalho confiável, a dimensão de IP é PULADA — e a de conta continua", async () => {
    // Colapsar tudo em `login:ip:desconhecido` seria pior que não ter limite:
    // 20 tentativas erradas de um atacante trancariam o login de TODO MUNDO por
    // 10 minutos (`checarLimiteLogin` consulta o IP PRIMEIRO e retorna sem tocar
    // na cota da conta). Uma defesa contra força bruta que vira negação de
    // serviço global é o modo de falha errado.
    delete process.env.IP_CABECALHO_CONFIAVEL;

    for (let i = 0; i < LIMITE_LOGIN_POR_IP + 5; i++) {
      const r = await checarLimiteLogin(IP_DESCONHECIDO, `pessoa${i}@exemplo.com`);
      expect(r.permitido).toBe(true);
    }

    // A dimensão que sobra continua mordendo:
    for (let i = 0; i < LIMITE_LOGIN_POR_CONTA; i++) {
      await checarLimiteLogin(IP_DESCONHECIDO, "alvo@exemplo.com");
    }
    const bloqueado = await checarLimiteLogin(IP_DESCONHECIDO, "alvo@exemplo.com");
    expect(bloqueado).toEqual({ permitido: false, dimensao: "conta" });
  });
```

Em `tests/unit/whatsapp-webhook-route.test.ts`, o caso da linha ~278 vira dois:

```ts
  it("com cabeçalho confiável, a chave do rate limit é o IP", async () => {
    process.env.IP_CABECALHO_CONFIAVEL = "x-vercel-forwarded-for";
    // … afirma `whatsapp:webhook:<ip>` como antes.
  });

  it("sem cabeçalho confiável, a chave passa a ser a EMPRESA do path", async () => {
    // Colapsar tudo num balde só derrubaria mensagens legítimas de todas as
    // empresas juntas — e o limite existe para conter flood, não para virar um.
    // Limite conhecido: quem souber o `companyId` (ele está na URL do webhook)
    // pode queimar o balde daquela empresa. Um cabeçalho confiável fecha isso;
    // nada mais fecha.
    delete process.env.IP_CABECALHO_CONFIAVEL;
    // … afirma `whatsapp:webhook:empresa:<companyId>`.
  });
```

Em `tests/unit/export-leads.test.ts`, o helper da linha ~63 usa `x-vercel-forwarded-for` para montar a requisição. A cota daquela rota é **por conta** (`export:leads:<userId>`), então o teste não muda de desfecho — só passe a definir `process.env.IP_CABECALHO_CONFIAVEL = "x-vercel-forwarded-for"` no `beforeEach` e atualize o comentário da linha 58, que hoje explica a precedência antiga.

- [ ] **Step 2: Rodar para ver falhar**

```bash
npx vitest run tests/unit/auditoria-login.test.ts tests/unit/login-seguranca.test.ts tests/unit/whatsapp-webhook-route.test.ts tests/unit/export-leads.test.ts
```

Esperado: FAIL nos casos novos.

- [ ] **Step 3: Reescrever `src/lib/ip.ts`**

```ts
/**
 * IP de origem de uma requisição — quando existe uma borda em que confiar.
 *
 * ## O que quebrou, e por que a resposta é uma variável e não um fallback
 *
 * Até o Ciclo 2d a ordem era `x-vercel-forwarded-for`, `x-real-ip`,
 * `x-forwarded-for`, e o primeiro era o único não forjável — por uma
 * propriedade da PLATAFORMA: ela sobrescrevia, não concatenava, o que viesse de
 * fora com aquele nome. O dono decidiu não usar a Vercel, e esse cabeçalho
 * some.
 *
 * O que sobra é escolhido pelo CLIENTE quando não há um proxy confiável na
 * frente reescrevendo. Manter a mesma precedência fora da Vercel seria trocar
 * um cabeçalho não forjável por um forjável **sem mudar uma linha de
 * comentário**: o pior desfecho possível, porque o código continuaria afirmando
 * uma garantia que perdeu.
 *
 * Então: **nenhum cabeçalho é confiável até alguém dizer qual é.**
 * `IP_CABECALHO_CONFIAVEL` nomeia o cabeçalho que a borda escolhida
 * SOBRESCREVE. Exemplos que valem: `x-vercel-forwarded-for` na Vercel,
 * `x-real-ip` atrás de nginx com `proxy_set_header X-Real-IP $remote_addr`,
 * `cf-connecting-ip` atrás da Cloudflare.
 *
 * **O aviso que anda junto:** o cabeçalho precisa ser um que a borda
 * SOBRESCREVA, não um que ela ACRESCENTE. `x-forwarded-for` atrás de um nginx
 * com `proxy_add_x_forwarded_for` continua tendo o valor do cliente na primeira
 * posição — apontar a variável para ele é escolher a aparência de segurança.
 *
 * ## Ausente é o estado seguro, e o que ele custa
 *
 * Sem a variável, não existe IP: `IP_DESCONHECIDO` aqui, `undefined` em
 * `ipDaRequisicaoAtual`. Isso custa duas coisas, e as duas estão escritas onde
 * doem:
 *
 * - `core/rate-limit/login.ts` PULA a dimensão por IP (colapsar todo mundo numa
 *   chave só transformaria a defesa contra força bruta em negação de serviço
 *   global).
 * - `AuditLog.ip` volta a ser nulo. A canalização que a Fase 2 da auditoria de
 *   2026-08-21 construiu — levar o `ip` aos 22 pontos que não o tinham — fica
 *   inteira; o que desaparece é um valor em que se possa confiar. E IP forjado
 *   num log de auditoria é pior que campo vazio: vazio é ausência de
 *   informação, forjado é informação falsa que pode apontar para a pessoa
 *   errada.
 *
 * Uma linha no ambiente devolve as duas.
 *
 * ## Leitura preguiçosa
 *
 * `process.env` é lido DENTRO da função. Validar em escopo de módulo já
 * derrubou o build deste projeto uma vez.
 */

/** Sentinela de "não há borda em que confiar". Um valor só, em um lugar só. */
export const IP_DESCONHECIDO = "desconhecido";

function nomeDoCabecalhoConfiavel(): string | null {
  const nome = process.env.IP_CABECALHO_CONFIAVEL?.trim().toLowerCase();
  return nome ? nome : null;
}

function primeiroDaLista(valor: string | null): string | null {
  const primeiro = valor?.split(",")[0]?.trim();
  return primeiro ? primeiro : null;
}

export function obterIpDaRequisicao(request: Request): string {
  const nome = nomeDoCabecalhoConfiavel();
  if (!nome) return IP_DESCONHECIDO;
  return primeiroDaLista(request.headers.get(nome)) ?? IP_DESCONHECIDO;
}

/**
 * O IP da requisição EM CURSO, quando não há um `Request` em mãos.
 *
 * (O bloco "Por que isto precisa existir" continua valendo inteiro: Server
 * Action não recebe `Request`, `headers()` de `next/headers` é a única porta, e
 * a auditoria de 2026-08-21 mediu que `AuditLog.ip` era preenchido em 1 dos 23
 * pontos por causa disso. Mantenha aqui o texto que já existe, e só a
 * PRECEDÊNCIA muda — pelo mesmo motivo de sempre: as duas funções precisam
 * seguir a mesma regra, senão um dia alguém corrige só uma.)
 *
 * `undefined` e não `IP_DESCONHECIDO`: a coluna é anulável, e uma string de
 * sentinela gravada 22 vezes ficaria indistinguível de um IP que a borda não
 * mandou. Aqui o valor ausente precisa ser ausente.
 */
export async function ipDaRequisicaoAtual(): Promise<string | undefined> {
  const nome = nomeDoCabecalhoConfiavel();
  if (!nome) return undefined;

  try {
    const { headers } = await import("next/headers");
    const cabecalhos = await headers();
    return primeiroDaLista(cabecalhos.get(nome)) ?? undefined;
  } catch {
    return undefined;
  }
}
```

> **Ao subagente:** o bloco de comentário de `ipDaRequisicaoAtual` já existente no arquivo (as seções "Por que isto precisa existir", "O que isto NÃO é", "Por que import dinâmico e por que engolir a falha") **é preservado**. Só o texto sobre precedência de cabeçalhos muda. Não reescreva o que continua verdadeiro.

- [ ] **Step 4: `login.ts` pula a dimensão de IP quando não há IP**

Em `src/core/rate-limit/login.ts`, acrescentar o import e o guarda:

```ts
import { IP_DESCONHECIDO } from "@/lib/ip";
```

```ts
export async function checarLimiteLogin(
  ip: string,
  email: string
): Promise<ResultadoLimiteLogin> {
  // Sem borda confiável (`IP_CABECALHO_CONFIAVEL` ausente — ver `lib/ip.ts`),
  // TODA requisição chegaria aqui com a mesma chave. Como esta função consulta o
  // IP PRIMEIRO e retorna sem tocar na cota da conta quando ele estoura, um
  // balde compartilhado significaria: 20 tentativas erradas de um atacante
  // trancam o login de todo mundo por 10 minutos. Pular é estritamente melhor
  // que isso — e o que sustenta o login nesse estado é a dimensão por CONTA,
  // que é justamente a que protege uma conta específica de adivinhação dirigida.
  //
  // O que se perde é a defesa contra varredura de MUITAS contas a partir de uma
  // origem, e essa perda é consequência da hospedagem indefinida, não escolha de
  // código: ela some no dia em que a variável for definida.
  if (ip !== IP_DESCONHECIDO) {
    const ipPermitido = await checarRateLimit(
      `login:ip:${ip}`,
      LIMITE_LOGIN_POR_IP,
      JANELA_LOGIN_MS
    );
    if (!ipPermitido) return { permitido: false, dimensao: "ip" };
  }

  const contaPermitida = await checarRateLimit(
    `login:conta:${chaveDaConta(email)}`,
    LIMITE_LOGIN_POR_CONTA,
    JANELA_LOGIN_MS
  );
  if (!contaPermitida) return { permitido: false, dimensao: "conta" };

  return { permitido: true };
}
```

E acrescentar ao bloco de documentação da função, logo depois da seção "O IP é checado primeiro, de propósito", a seção "Quando não há IP nenhum" com o mesmo argumento.

- [ ] **Step 5: O webhook cai para a chave por empresa**

Em `src/app/api/whatsapp/evolution/[companyId]/[token]/route.ts`:

```ts
  const ip = obterIpDaRequisicao(request);
  // Sem borda confiável, o IP é o mesmo para todo mundo — e um balde único
  // derrubaria mensagens legítimas de todas as empresas juntas, transformando um
  // limite que existe para conter flood no próprio flood. A empresa do path está
  // disponível antes de qualquer consulta e dá um balde por empresa.
  //
  // Limite conhecido, dito em voz alta: o `companyId` está na URL de webhook que
  // o dono cola no painel da Evolution, então quem a conhecer pode queimar o
  // balde daquela empresa. Um cabeçalho confiável (`IP_CABECALHO_CONFIAVEL`)
  // fecha isso; nada mais fecha.
  const chaveDeTaxa =
    ip === IP_DESCONHECIDO
      ? `whatsapp:webhook:empresa:${companyId}`
      : `whatsapp:webhook:${ip}`;
  const permitido = await checarRateLimit(chaveDeTaxa, 600, 60_000);
```

com `import { IP_DESCONHECIDO, obterIpDaRequisicao } from "@/lib/ip";`.

- [ ] **Step 6: Verde**

```bash
npx vitest run tests/unit/auditoria-login.test.ts tests/unit/login-seguranca.test.ts tests/unit/whatsapp-webhook-route.test.ts tests/unit/export-leads.test.ts tests/unit/audit-log.test.ts
npm run typecheck
```

Esperado: verdes. Se `audit-log.test.ts` quebrar por esperar um `ip` gravado, **é o comportamento novo** — ajuste o caso para afirmar `undefined` sem a variável e o valor com ela, e escreva o porquê no comentário.

- [ ] **Step 7: Commit**

```
fix(seguranca): nenhum cabecalho de IP e confiavel ate alguem dizer qual

x-vercel-forwarded-for nao era forjavel por uma propriedade da PLATAFORMA:
ela sobrescrevia o que viesse de fora com aquele nome. Fora da Vercel
sobram cabecalhos que o cliente escolhe. Manter a mesma precedencia seria
trocar um cabecalho nao forjavel por um forjavel sem mudar uma linha de
comentario -- o codigo seguiria afirmando a garantia que perdeu.

IP_CABECALHO_CONFIAVEL nomeia o cabecalho que a borda SOBRESCREVE.
Ausente = nao existe IP. E ausente, o login PULA a dimensao por IP em vez
de colapsar todo mundo numa chave: 20 tentativas erradas trancariam o
login de todo mundo por 10 minutos, porque o IP e checado primeiro.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

### Task 9: Os resíduos de plataforma no código e no ambiente

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Modify: `src/instrumentation.ts`
- Modify: `src/core/rate-limit/limiter.ts`
- Modify: `src/core/notifications/dispatch.ts`
- Modify: `src/core/rate-limit/export-leads.ts`
- Modify: `config/client.ts`
- Modify: `.env.example`

**Interfaces:** nenhuma nova. Esta tarefa só faz comentário e configuração pararem de mentir.

- [ ] **Step 1: Medir o que sobrou**

```bash
grep -rni "vercel" src/ config/ .env.example
```

Cole a saída. Ela é a lista de trabalho, e o Step 6 a repete para conferir que só sobrou história datada.

- [ ] **Step 2: `instrumentation.ts` — o rótulo do Sentry**

Trocar a linha do `environment` e o parágrafo que a explica:

```ts
    // `SENTRY_ENVIRONMENT` e depois `"local"`. `VERCEL_ENV` saiu no Ciclo 2d
    // junto com a plataforma: uma variável que nunca vai existir no meio de uma
    // cadeia de fallback é ruído que faz o leitor procurar onde ela é definida.
    //
    // NUNCA `?? process.env.NODE_ENV`, e este parágrafo continua valendo
    // inteiro: `next start` roda com NODE_ENV=production, então uma execução na
    // máquina de quem desenvolve — ou a suíte e2e, que sobe o build de produção
    // — chegava ao Sentry carimbada como `production`. Não é hipótese: o painel
    // mostrou `Não autenticado` em `GET /leads` vindo do e2e local.
    //
    // Consequência da saída da Vercel: sem `SENTRY_ENVIRONMENT` definida no
    // deploy, TODO evento de produção chega rotulado `local`. Está na lista de
    // ações do dono (`docs/ESTADO.md`).
    environment: process.env.SENTRY_ENVIRONMENT ?? "local",
```

- [ ] **Step 3: As duas podas probabilísticas**

Em `src/core/rate-limit/limiter.ts` (bloco de `CHANCE_DE_PODA`) e `src/core/notifications/dispatch.ts` (mesmo bloco), a frase *"um cron exigiria rota nova… e configuração no painel da Vercel"* passa a:

```
 * Poda probabilística (o padrão que sessões de PHP e a limpeza do Django usam)
 * em vez de cron agendado. O argumento original citava "configuração no painel
 * da Vercel"; a Vercel saiu no Ciclo 2d e o argumento sobrevive à troca, porque
 * ele nunca foi sobre AQUELA plataforma: correção que só entra em vigor depois
 * de alguém configurar algo é correção que pode nunca entrar em vigor. Depois
 * do Ciclo 2d existe um laço nosso (`npm run fila:worker`) que PODERIA hospedar
 * esta limpeza — e a decisão fica como está de propósito: esta poda vale
 * sozinha, sem ninguém ligar nada, e é isso que a distingue.
```

- [ ] **Step 4: `export-leads.ts` e `config/client.ts`**

Em `src/core/rate-limit/export-leads.ts`, a frase *"a suíte e2e não toca esta rota e `vercel.json` não declara nenhum cron que a chame"* cita um arquivo que deixou de existir. Vira: *"a suíte e2e não toca esta rota e não há agendador nenhum apontado para ela — o único gatilho automático deste projeto é o da fila de turnos (`/api/queues/whatsapp-turn`), e ele não exporta lead nenhum"*.

Em `config/client.ts:36`, a menção à Vercel está dentro do relato do build que caiu por validação em escopo de módulo. **Isso é história datada e fica** — só acrescente a data para deixar claro que é registro: *"…e `next build` fazia a validação rodar sem elas na Vercel (o deploy de 2026-08, quando o projeto ainda era hospedado lá)."*

- [ ] **Step 5: `.env.example`**

Substituir o bloco de `WHATSAPP_QUEUE_SECRET` por:

```
# Segredo que autentica QUEM ACIONA o consumidor da fila de turnos.
#
# `openssl rand -hex 32`. Vai no cabeçalho `x-fila-segredo` de cada POST para
# /api/queues/whatsapp-turn. Segredo errado ou ausente responde 404 -- a mesma
# resposta que o webhook dá a token errado, e pelo mesmo motivo: não confirma a
# quem está adivinhando que o path existe.
#
# O PAPEL DELA MUDOU no Ciclo 2d, e o nome não. Até lá ela ia embutida no
# PAYLOAD de cada job publicado no Vercel Queues, como segunda camada atrás do
# air-gapping que a plataforma garantia. Fora da Vercel não há air-gapping, o
# job não atravessa rede nenhuma (é uma linha de TurnoJob no nosso Postgres), e
# o que precisa ser autenticado passou a ser a CHAMADA de tick.
WHATSAPP_QUEUE_SECRET="gerar-com-openssl-rand-hex-32"

# --- A FILA PRECISA DE ALGUEM QUE A DRENE ------------------------------------
#
# LEIA ISTO. Sem um gatilho ligado, mensagem de WhatsApp entra, vira linha em
# TurnoJob, e NUNCA e respondida -- sem erro nenhum aparecer. O Vercel Queues
# empurrava sozinho; depois do Ciclo 2d alguem tem que puxar.
#
# Duas formas, e as duas chamam a MESMA funcao:
#
#   1. Node sempre ligado (RECOMENDADO): `npm run fila:worker`, como servico.
#      Nao abre porta nenhuma, e o laco de 2s mantem a resposta em ~8-10s --
#      praticamente o que a Vercel entregava.
#   2. Agendador externo batendo no endpoint:
#      curl -fsS -X POST -H "x-fila-segredo: $WHATSAPP_QUEUE_SECRET" \
#        https://<sua-origem>/api/queues/whatsapp-turn
#      Serve para pg_cron+pg_net do Supabase, cron de VPS, ou um workflow do
#      n8n. Um cron de UM MINUTO faz a resposta ao cliente sair em ate ~68s.

# Nome do cabecalho HTTP que a sua borda SOBRESCREVE com o IP real do cliente.
#
# Exemplos que valem: "x-vercel-forwarded-for" na Vercel, "x-real-ip" atras de
# nginx com `proxy_set_header X-Real-IP $remote_addr`, "cf-connecting-ip" atras
# da Cloudflare.
#
# CUIDADO: tem que ser um cabecalho que a borda SOBRESCREVE, nao um que ela
# ACRESCENTE. `x-forwarded-for` atras de nginx com `proxy_add_x_forwarded_for`
# continua tendo o valor do CLIENTE na primeira posicao -- apontar esta variavel
# para ele e escolher a aparencia de seguranca.
#
# AUSENTE E O ESTADO SEGURO, e ele custa duas coisas concretas:
#   - o login PULA o limite por IP (a dimensao por CONTA continua valendo). Nao
#     e descuido: colapsar todo mundo em `login:ip:desconhecido` faria 20
#     tentativas erradas trancarem o login de TODO MUNDO por 10 minutos, porque
#     `checarLimiteLogin` consulta o IP primeiro.
#   - AuditLog.ip fica nulo. IP forjado num log de auditoria e pior que campo
#     vazio: vazio e ausencia de informacao, forjado e informacao falsa que pode
#     apontar para a pessoa errada.
#
# Defina no dia em que a hospedagem for escolhida.
IP_CABECALHO_CONFIAVEL=""
```

E no bloco de `SENTRY_ENVIRONMENT`, trocar *"OPCIONAL, só para deploy fora da Vercel. Lá, `VERCEL_ENV` já responde"* por *"Defina no deploy. Até o Ciclo 2d, `VERCEL_ENV` respondia sozinha dentro da Vercel; fora dela, sem esta variável o rótulo de TODO evento é `local`"*.

Nos blocos de `DATABASE_URL`/`DIRECT_URL`, as menções à Vercel são o relato de por que aquelas portas foram escolhidas (o `ENETUNREACH` do primeiro deploy). **É história datada e fica**, com a data acrescentada.

- [ ] **Step 6: Verificar e fechar**

```bash
grep -rni "vercel" src/ config/ .env.example
npm run typecheck
npm run build
npx vitest run tests/unit/sentry-scrub.test.ts tests/unit/rate-limit.test.ts tests/unit/notificacoes-poda.test.ts
```

Esperado: no `grep`, **só** ocorrências que sejam história datada — nomeie cada uma no relatório e diga por que ela fica. Nenhuma pode afirmar comportamento presente.

- [ ] **Step 7: Commit**

```
docs(codigo): os comentarios param de afirmar uma plataforma que saiu

VERCEL_ENV sai da cadeia do Sentry: variavel que nunca vai existir no meio
de um fallback faz o leitor procurar onde ela e definida. O argumento da
poda probabilistica sobrevive a troca e o texto diz por que -- ele nunca
foi sobre AQUELA plataforma.

.env.example ganha o aviso que faltava: sem gatilho ligado, mensagem entra,
vira linha em TurnoJob e nunca e respondida, sem erro nenhum aparecer.

Historia datada FICA (o ENETUNREACH das portas do pooler, o build que caiu
por validacao em escopo de modulo): apagar registro de incidente para a
arvore ficar limpa e o oposto do que ele serve.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

### Task 10: Os documentos vivos, e a decisão reaberta

**DEPENDE DE AÇÃO DO DONO:** não para escrever. Os itens que a tarefa REGISTRA são todos ações do dono.

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/ESTADO.md`
- Modify: `docs/superpowers/specs/2026-08-19-n8necrm-fundacao-design.md` (**apenas adendo**)

**Interfaces:** nenhuma.

> **PROIBIÇÃO DESTA TAREFA:** `docs/auditorias/*` **não é tocado**, nem nenhum spec ou plano de ciclo já executado. Eles dizem o que era verdade na data deles, e falsificá-los é pior que deixá-los desatualizados. A ÚNICA exceção é o adendo do Step 3, que **não altera nenhuma palavra** do texto original.

- [ ] **Step 1: `CLAUDE.md`, decisão 6**

Substituir o item 6 da lista "Decisões travadas" por:

```markdown
6. **Hospedagem: EM ABERTO. A fila é Postgres.** *(Reaberta em 2026-08-21 —
   ver `docs/superpowers/specs/2026-08-21-ciclo-2d-fila-em-postgres-design.md`.)*
   Até essa data a decisão era "Vercel agora, com Vercel Queues atrás de um
   adaptador". O dono decidiu **não usar a Vercel**. O que passou a valer:
   a fila de turnos vive numa tabela do Postgres do Supabase que já existe
   (`TurnoJob`, lease atômico, zero infra nova — pg-boss numa VPS e o próprio
   n8n foram recusados), e **o app é agnóstico de hospedagem**: roda em
   qualquer Node. Onde publicar é decisão adiada, e nada pode passar a
   depender dela.
   **Consequência que não pode ser esquecida:** a fila **não drena sozinha**.
   Alguém tem de ligar `npm run fila:worker` ou um agendador batendo em
   `POST /api/queues/whatsapp-turn`. Sem isso, mensagem entra e nunca é
   respondida, sem erro nenhum aparecer.
   *(O histórico fica escrito aqui de propósito: decisão travada sem histórico
   é decisão que alguém reabre de novo sem saber que já foi discutida.)*
```

E, na seção **Armadilhas conhecidas**, acrescentar:

```markdown
- **Não existe IP confiável sem `IP_CABECALHO_CONFIAVEL`.** Desde o Ciclo 2d
  nenhum cabeçalho é lido até alguém nomear o que a borda SOBRESCREVE (não o
  que ela ACRESCENTE — `x-forwarded-for` atrás de `proxy_add_x_forwarded_for`
  ainda tem o valor do cliente na frente). Ausente: o login pula o limite por
  IP e `AuditLog.ip` fica nulo. É o estado seguro, e é reversível com uma
  linha.
- **`TurnoJob` é modelo de tenant, mas a REIVINDICAÇÃO é cross-tenant.** É a
  única exceção permanente de prisma cru fora de `src/core/`, e o motivo é
  circularidade: a empresa é o resultado da reivindicação, não a entrada dela.
```

- [ ] **Step 2: `docs/ESTADO.md`**

Três mudanças:

1. Substituir o item **"4. Na Vercel"** da lista "O que só você pode desbloquear" por:

```markdown
### 4. Escolher a hospedagem, e ligar o gatilho da fila

A Vercel saiu (Ciclo 2d). O app roda em qualquer Node, e **onde** é decisão
sua. Duas coisas dependem dela:

**Ligue um gatilho da fila — sem isso o WhatsApp fica mudo.** Mensagem entra,
vira linha em `TurnoJob`, e ninguém responde. Nenhum erro aparece.
- Node sempre ligado (recomendado): `npm run fila:worker` como serviço.
- Ou um agendador batendo em `POST /api/queues/whatsapp-turn` com o cabeçalho
  `x-fila-segredo`. Um cron de um minuto faz a resposta sair em até ~68s; o
  worker mantém em ~8-10s.

**Defina três variáveis no ambiente do deploy:**
- `IP_CABECALHO_CONFIAVEL` — sem ela não há limite por IP no login e
  `AuditLog.ip` fica nulo.
- `SENTRY_ENVIRONMENT` — `VERCEL_ENV` não existe mais; sem ela todo evento
  chega rotulado `local`.
- `SUPABASE_JWT_ISSUER` — a origem pública real (Ciclo 1b).

E gere `COFRE_CHAVE_MESTRA` (`openssl rand -base64 32`) onde for publicar.

Se existir projeto na Vercel, **apague-o e as variáveis que estiverem lá** —
apikey esquecida em painel é credencial viva sem dono.
```

2. Na tabela **"Pendências técnicas que sobram"**, acrescentar:

```markdown
| **A fila não drena sozinha** | Nenhum gatilho é ligado por padrão. É a única regressão funcional da saída da Vercel, que empurrava. **Bloqueio antes de publicar.** |
| **Sem IP confiável** | Enquanto `IP_CABECALHO_CONFIAVEL` não for definida: login sem limite por IP (o por conta continua), `AuditLog.ip` nulo, e o balde do webhook é por empresa. |
```

3. Atualizar o cabeçalho da tabela de verificação para dizer que os números são de **2026-08-21, antes do Ciclo 2d**, e que a Tarefa 11 os remede. **Não invente números** — quem os substitui é a Tarefa 11, com as saídas coladas.

- [ ] **Step 3: O adendo no spec fundador**

Em `docs/superpowers/specs/2026-08-19-n8necrm-fundacao-design.md`, **logo depois** do item 6 da lista de decisões (a linha que termina em "Nada de comportamento muda."), inserir:

```markdown
> **Adendo de 2026-08-21 — a decisão 6 foi REABERTA.** O dono decidiu não usar
> a Vercel. A fila passou a ser uma tabela do Postgres (`TurnoJob`) e a
> hospedagem voltou a ficar em aberto, com o app agnóstico. **Nenhuma palavra
> do texto acima foi alterada** — ele registra o que foi decidido em
> 2026-08-19, e continua sendo o registro correto daquela data. O que passou a
> valer está em
> `docs/superpowers/specs/2026-08-21-ciclo-2d-fila-em-postgres-design.md`.
> Este adendo existe porque um leitor que encontrasse a decisão original sem
> descobrir que ela foi revertida agiria com base nela — que é o mesmo dano que
> a proibição de reescrever documento histórico tenta evitar, só que pelo outro
> lado.
```

- [ ] **Step 4: Provar que nada histórico foi tocado**

```bash
git status --short docs/
git diff --stat docs/
```

Esperado: **só** `docs/ESTADO.md`, `docs/superpowers/specs/2026-08-19-n8necrm-fundacao-design.md` (com `1 insertion` de bloco, `0 deletions`) e os dois documentos deste ciclo. **Nenhum arquivo de `docs/auditorias/` na lista.** Se aparecer, **pare e reverta**.

- [ ] **Step 5: Commit**

```
docs: a decisao 6 foi reaberta, e o registro diz por que

O CLAUDE.md avisa que reabrir decisao travada invalida os ciclos que
dependem dela. Foram procurados um a um: nenhum precisa ser refeito. O
Ciclo 0 foi VINDICADO -- a costura da fila existia para este dia e a troca
foi uma linha. Ciclo 4 e 1b continuam bloqueados, com outro dono: a origem
publica passou a depender da hospedagem.

docs/auditorias/* nao foi tocado. O spec fundador recebe ADENDO datado, sem
uma palavra alterada: um leitor que encontrasse a decisao 6 original sem
saber que ela caiu agiria com base nela.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

### Task 11: Verificação final e preparo da auditoria

**DEPENDE DE AÇÃO DO DONO:** não. A APROVAÇÃO do relatório, sim — e o `AGENTS.md` proíbe merge sem ela.

**Files:**
- Modify: `docs/ESTADO.md` (só os números da tabela de verificação)

- [ ] **Step 1: A suíte inteira, em série**

```bash
npm run typecheck
npm run lint
npm run build
npx vitest run tests/unit
```

⚠️ **Não rode `npm test`** — ele executa o seed e reescreve as senhas do `admin@exemplo.com` e do `vendedor@exemplo.com`. ⚠️ **Nenhuma outra execução de `vitest` em paralelo.**

Cole as quatro saídas. A contagem de unitários tem de ser **maior** que 1622 (arquivos novos entraram) e **as falhas têm de ser zero**.

- [ ] **Step 2: e2e**

```bash
npm run test:e2e
```

Esperado: 54 ou mais, zero falhas. `banco-blindado.spec.ts` agora inclui `TurnoJob` na varredura sem lista fixa.

- [ ] **Step 3: As varreduras que fecham o ciclo**

```bash
grep -rn "@vercel/queue" src/ tests/ package.json ; echo "--- deve estar vazio"
ls vercel.json 2>&1 | head -1
grep -rni "vercel" src/ config/
node -e "console.log(require('./package.json').dependencies['@vercel/queue'] ?? 'AUSENTE')"
grep -c '"' eslint.config.mjs > /dev/null; node -e "const t=require('fs').readFileSync('eslint.config.mjs','utf8');const m=/const EXCECAO_PERMANENTE = \[([^\]]*)\]/s.exec(t);console.log('permanentes:', (m[1].match(/\"/g).length)/2)"
```

Esperado: `@vercel/queue` sem nenhuma ocorrência; `vercel.json` inexistente; `AUSENTE`; `permanentes: 6`; e o `grep -rni vercel` devolvendo **só** história datada — nomeie cada linha no relatório.

- [ ] **Step 4: O percurso completo, sem a Vercel em lugar nenhum**

Este é o critério de aceite nº 10, e ele é rodado à mão porque atravessa três módulos.

```bash
npm run dev
```

Noutro terminal, publique um turno diretamente e drene:

```bash
npx tsx -e "
import 'dotenv/config';
import { publicarTurno } from './src/modules/whatsapp/fila';
import { drenarFila } from './src/modules/whatsapp/fila/consumidor';
import { prisma } from './src/lib/prisma';
const c = await prisma.conversation.findFirst({ select: { id: true, companyId: true, bufferSeq: true } });
if (!c) { console.log('SEM CONVERSA no banco de desenvolvimento — pule este passo e reporte'); process.exit(0); }
await publicarTurno({ companyId: c.companyId, conversationId: c.id, seq: c.bufferSeq }, { delaySeconds: 0 });
console.log('publicado:', await prisma.turnoJob.count({ where: { companyId: c.companyId } }));
console.log('drenagem:', await drenarFila());
console.log('restante:', await prisma.turnoJob.count({ where: { companyId: c.companyId } }));
await prisma.\$disconnect();
"
```

Esperado: `publicado: 1`, uma drenagem com `processados: 1`, `restante: 0`.

Se o banco de desenvolvimento tiver **zero conversas** (era o estado em 2026-08-21, ver `docs/ESTADO.md`), este passo sai como 🔍 **NÃO VERIFICADO** com esta mesma instrução para um humano rodar depois de cadastrar uma conexão — **não** crie conversa sintética no banco compartilhado.

E o tick por HTTP:

```bash
curl -i -s -X POST http://localhost:3000/api/queues/whatsapp-turn | head -3
curl -i -s -X POST -H "x-fila-segredo: <valor do .env>" http://localhost:3000/api/queues/whatsapp-turn | head -3
```

Esperado: `404` no primeiro, `200` com `{"ok":true,...}` no segundo. **Não imprima o valor do segredo** — leia-o do `.env` sem exibi-lo.

- [ ] **Step 5: Atualizar os números de `docs/ESTADO.md`**

Só a tabela de verificação, com as saídas medidas no Step 1 e 2. Nada de estimativa.

- [ ] **Step 6: O relatório e a PARADA**

Escrever o relatório do ciclo cobrindo, item a item:

- Os 12 critérios de aceite da §12 do spec, cada um com o comando e a saída.
- As 25 provas P1–P25, com o arquivo de teste e o nome do caso.
- Todo item 🔍 **NÃO VERIFICADO**, com o comando que um humano roda: o
  `pg_cron` sub-minuto, dois workers simultâneos, a acessibilidade do endpoint
  na internet, a latência ponta a ponta, e o Step 4 se o banco não tiver
  conversa.
- As ações do dono, na ordem da §9 do spec.

Depois disso, **PARE**. O `AGENTS.md` é explícito: nenhuma branch é integrada sem a **Fase 1** da skill `auditoria-seguranca` sobre a superfície que a branch mexeu — e a superfície aqui é grande: uma rota pública que perdeu o air-gapping, a origem do IP de todo rate limit, uma exceção nova de prisma cru, e uma tabela nova. Rode a Fase 1, entregue o relatório, e **não corrija nada** antes da aprovação do dono.

**Nenhum push. Nenhum PR. Nenhum merge. Nenhum deploy.**

---

## Auto-revisão deste plano

Feita depois de escrever as onze tarefas, comparando com o spec com olhos frescos. O que foi encontrado está **corrigido acima**, não listado como pendência.

### 1. Cobertura do spec

| Seção do spec | Tarefa que entrega |
| --- | --- |
| §4 O achado de segurança (air-gapping perdido) | 3 (a comparação) + 6 (o cabeçalho, o 404, o comentário do proxy) |
| §5.1 A forma da tabela, `TurnoJob` como 14º tenant | 1 (schema, migração, Set) + 2 (os três caminhos escopados e o único cru) |
| §5.2 A reivindicação atômica | 2 |
| §5.3 O que a fila reproduz (delay, retry, teto, uma-por-vez) | 2 (delay, retry, teto de tentativas, lease) + 4 (`TEMPO_MAX_TURNO_MS` e a ordem das três durações) |
| §5.4 Quem aciona, sem presumir plataforma | 4 (a função) + 5 (worker) + 6 (endpoint) |
| §5.5 Como o consumidor se autentica | 3 + 6 |
| §5.6 O furo `DuplicateMessageError` | 2 (`skipDuplicates`) + 7 (os dois `catch` e o import) |
| §5.7 O IP sem o cabeçalho da Vercel | 8 |
| §5.8 A limpeza da tabela | 2 (`podarJobsMortos`) + 4 (o gancho por sorteio) |
| §6 expande → migra → contrai | ordem das Tarefas 1–7 |
| §8 Documentos vivos, e o que não muda | 9 (código e `.env.example`) + 10 (docs) |
| §8.2 Ciclos que dependiam da decisão 6 | 10 (`CLAUDE.md` e o adendo) |
| §9 Ações do dono | 10 (registradas) + 11 (repetidas no relatório) |
| §12 Critérios de aceite | 11 |

**Provas do spec sem tarefa: nenhuma.** P3 (tabela blindada) e P24/P25 (catraca) são exercitadas por testes **que já existem**, rodados nas Tarefas 1, 2 e 11.

### 2. Varredura de placeholders

Nenhum "TBD", "implementar depois" ou "similar à Tarefa N". Quatro pontos mandam **ler o que já existe** em vez de repetir código, e os quatro são deliberados — copiar seria inventar o conteúdo de um arquivo que este plano não transcreveu por inteiro:

- Tarefa 6, Step 6: os casos de `whatsapp-fila.test.ts` são **adaptados**, com a instrução explícita de não remover caso nenhum e de escrever o equivalente para cada um.
- Tarefa 7, Step 6: os mocks de `@vercel/queue` em dois arquivos de teste, com a mesma proibição.
- Tarefa 8, Step 3: o bloco de comentário de `ipDaRequisicaoAtual` é **preservado**, com um aviso nomeando as três seções que continuam verdadeiras.
- Tarefa 8, Step 1: os testes existentes são reescritos por caso nomeado (linha e título), não "ajuste conforme necessário".

### 3. Consistência de tipos e nomes

Conferido de ponta a ponta. Os que atravessam tarefas:

- `FilaPostgres` (T2) → consumida por `fila/index.ts` (T6) e mockada em `whatsapp-fila.test.ts` (T6).
- `reivindicarJob` / `concluirJob` / `falharJob` / `podarJobsMortos` (T2) → consumidas por `consumidor.ts` (T4) e mockadas em `fila-consumidor.test.ts` (T4).
- `JobReivindicado.leaseAte` é **o fencing token** e é `Date` — o mesmo tipo que `claimLease` devolve em `turno.ts`, de propósito.
- `DesfechoFalha = "reagendado" | "morto" | "lease-perdido"` (T2) → o `if (desfecho === "morto")` de T4.
- `drenarFila` / `ResultadoDrenagem` (T4) → consumidas pela rota (T6) e pelo worker (T5); o corpo da resposta HTTP é `{ ok: true, ...ResultadoDrenagem }`.
- `segredoConfere` (T3) → consumida pela rota (T6).
- `IP_DESCONHECIDO` (T8) → consumida por `login.ts` e pela rota do webhook (T8).
- `TEMPO_MAX_TURNO_MS` (T4), `JOB_LEASE_MS` (T2) e `LEASE_DURACAO_MS` (já existente, `turno.ts`) — a ordem entre as três é lida das constantes pelo teste, não afirmada em prosa.
- `x-fila-segredo` — o nome do cabeçalho aparece em T6 (rota), T9 (`.env.example`) e T11 (o `curl`), e é o mesmo nos três.
- `WHATSAPP_QUEUE_SECRET` — nome mantido, papel novo; T6 lê, T9 documenta.

**Sete problemas foram encontrados e corrigidos nesta revisão:**

1. **A migração e o worker estavam na ordem errada em relação ao publicador.** Uma primeira redação punha o worker DEPOIS da migra; ele teria sido escrito contra uma fila que ainda não recebia nada, e o subagente da tarefa seguinte não teria como saber disso. Worker virou T5, antes da migra.
2. **A rota e o `fila/index.ts` estavam em tarefas separadas.** Isso deixaria uma janela em que o publicador grava em `TurnoJob` e o consumidor ainda espera push da Vercel — jobs indo para um lugar que ninguém lê, com a árvore verde. Foram fundidos na T6, e o motivo está escrito na tarefa.
3. **`concluirJob` devolvia `void` na primeira redação.** Sem o booleano, o caso "lease perdido no meio do turno" seria indistinguível de sucesso e o `drenarFila` não teria o que registrar. Virou `Promise<boolean>`, com caso de teste do token errado.
4. **O teste de `fila-postgres` ia apagar a fila inteira.** A reivindicação é cross-tenant, então um job de outra origem entraria no `ORDER BY` — e a primeira correção foi `deleteMany({})`, que contra o Postgres compartilhado deste projeto apagaria trabalho REAL. Um teste que destrói dado alheio é pior que um teste ausente. Virou uma guarda que **falha alto** contando os jobs de outras empresas, com a mensagem dizendo o que fazer. (A mesma regra que `rate-limit.test.ts` já escreve: "nunca usamos `deleteMany()` sem esse filtro".)
5. **`fila-consumidor.test.ts` usava `vi.importActual` do módulo de Postgres.** Aquele módulo importa `@/lib/prisma`, que instancia o `PrismaClient` no topo — o arquivo que se anuncia como "sem banco" passaria a exigir `DATABASE_URL`. O mock virou completo, e as duas constantes de que ele precisa (`JOB_LEASE_MS`, `LEASE_DURACAO_MS`) são lidas do TEXTO dos arquivos, com guarda que lança se o `const` for renomeado — sem ela, um regex quebrado devolveria `NaN` e a comparação de ordem passaria calada.
6. **A primeira redação da T8 removia o caso de precedência de `export-leads.test.ts`.** Aquela rota tem cota **por conta**, então o desfecho não muda — o caso fica, só ganhando a variável no `beforeEach`. Remover teria sido perder cobertura por um motivo errado.
7. **`concluirJob` sem retorno deixaria o "lease perdido no meio do turno" invisível** — está detalhado no item 3 acima, e a consequência no drenador (o `console.warn` em vez de silêncio) foi acrescentada junto.

### 4. Ordem — nenhuma tarefa usa algo que uma posterior cria

| Tarefa | Depende de | Cria para |
| --- | --- | --- |
| 1 Schema e migração | — | 2 |
| 2 Adaptador de Postgres | 1 | 4, 6 |
| 3 Comparação de segredo | — | 6 |
| 4 Drenador | 2 | 5, 6 |
| 5 Worker | 4 | — |
| 6 MIGRA (índice + rota + proxy) | 2, 3, 4 | 7 |
| 7 CONTRAI (Vercel sai) | 6 | 9 |
| 8 IP | — (independente da fila) | 9 (o `.env.example` cita a variável) |
| 9 Resíduos de código e ambiente | 7 (o `vercel.json` já não existe), 8 | 10 |
| 10 Documentos | 7, 8, 9 | 11 |
| 11 Verificação | todas | — |

**Duas ordens foram corrigidas na revisão:**

1. A Tarefa 9 (que apaga a citação de `vercel.json` em `export-leads.ts`) estava **antes** da contração numa primeira ordenação — ela teria descrito como inexistente um arquivo ainda presente na árvore. Desceu para depois da 7.
2. A Tarefa 8 (IP) estava **depois** da 9, e a 9 escreve o bloco de `IP_CABECALHO_CONFIAVEL` no `.env.example`. Documentar uma variável que o código ainda não lê é o tipo de descompasso que um subagente isolado não tem como perceber. A 8 subiu.

**A regra de ouro deste plano** — *expande → migra → contrai* — existe porque cada tarefa é executada por um subagente que só vê a própria. Apagar `fila/vercel.ts` junto com a troca deixaria a árvore num estado em que "voltar atrás" exigiria reinstalar uma dependência, e o subagente seguinte herdaria isso sem saber por quê.

### 5. Tarefas que dependem de ação do dono

**Zero bloqueiam a execução.** Cada tarefa carrega a linha `DEPENDE DE AÇÃO DO DONO`, e três a qualificam:

- **Tarefa 5** — o worker existe e compila sem o dono; **ligá-lo** é dele.
- **Tarefa 8** — o código está completo e testado nos dois estados; **definir `IP_CABECALHO_CONFIAVEL`** é dele, e até lá o comportamento é o seguro-por-padrão descrito na §5.7 do spec.
- **Tarefa 11** — a verificação roda inteira; a **aprovação do relatório de auditoria** é dele, e sem ela o `AGENTS.md` proíbe integrar.

O que o dono terá de ligar quando escolher a hospedagem está na §9 do spec, na Tarefa 10 (`docs/ESTADO.md`) e no `.env.example` da Tarefa 9 — três lugares, de propósito, porque a consequência de esquecer é um WhatsApp mudo sem nenhum erro aparecendo.

### 6. Itens 🔍 NÃO VERIFICADOS que o plano produz

Nenhum deles bloqueia uma tarefa; todos entram no relatório da Tarefa 11 com o comando que um humano roda:

| | O que não dá para provar aqui | Comando do humano |
| --- | --- | --- |
| NV1 | `pg_cron`/`pg_net` existem neste projeto e aceitam agendamento abaixo de um minuto | `select extname from pg_extension where extname in ('pg_cron','pg_net');` |
| NV2 | Dois processos `fila:worker` simultâneos não duplicam resposta | `npm run fila:worker` em dois terminais, com tráfego real |
| NV3 | O endpoint de tick está (in)acessível na internet | `curl -i -X POST https://<origem>/api/queues/whatsapp-turn` sem cabeçalho, depois do deploy |
| NV4 | Latência ponta a ponta com o gatilho escolhido | medir do `criadoEm` da mensagem ao `criadoEm` da resposta |
| NV5 | O percurso completo webhook → `TurnoJob` → resposta, se o banco de desenvolvimento tiver zero conversas | Tarefa 11, Step 4, depois de cadastrar uma conexão |
