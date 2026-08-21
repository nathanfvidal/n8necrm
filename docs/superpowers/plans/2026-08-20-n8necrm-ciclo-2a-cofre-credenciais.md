# n8necrm — Ciclo 2a (Cofre de credenciais e conexões da Evolution) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A credencial da Evolution sai da variável de ambiente e passa a viver cifrada numa tabela por empresa, cadastrada por uma aba de administração em Configurações. As quatro variáveis `EVOLUTION_*` morrem, incluindo a ponte `EVOLUTION_COMPANY_ID`.

**Architecture:** Um cofre genérico (`src/core/cofre/`) que cifra com `aes-256-gcm` de `node:crypto`, formato versionado `v1.<keyId>.<iv>.<ct>.<tag>`, chave mestra vinda de `COFRE_CHAVE_MESTRA` (lista, a primeira cifra, qualquer uma decifra pelo `keyId`). Uma tabela `WhatsappConnection` com colunas tipadas, o segredo cifrado, os últimos 4 caracteres em claro para a máscara e o **hash** do token do webhook. O webhook passa a receber `companyId` e token no path — o `companyId` só escolhe onde procurar, o token é a autoridade —, e a resolução é uma consulta ESCOPADA, sem exceção nova de lint. O envio resolve o gateway pela conexão da conversa. A troca é **expande → migra → contrai**: a fábrica nova nasce ao lado do singleton antigo (Tarefa 6), os dois caminhos migram (7 e 8), a tela nasce (9), e só então o antigo morre (10).

**Tech Stack:** Next.js 16.3 (App Router), React 19.2, Prisma 7.9 + `@prisma/adapter-pg`, Postgres 17.6 (Supabase `uzumzfxjcxrbxaucvfsr`), Node 22.21, Zod 4, Tailwind 4, shadcn, Vitest 4, Playwright 1.62.

**Spec:** `docs/superpowers/specs/2026-08-20-ciclo-2a-cofre-credenciais-design.md`

## Global Constraints

- **Idioma do código é português.** Comentário explica **por que**, com evidência. Nunca "o quê".
- **Antes de qualquer trabalho que toque o banco, invocar as três skills juntas:** `supabase`, `supabase-postgres-best-practices`, `auditing-supabase-security`. Vale para as Tarefas 1, 5, 7, 9 e 11.
- **Este projeto usa migrations do Prisma, não o CLI do Supabase.** As migrations são arquivos SQL escritos à mão em `prisma/migrations/`, aplicados por `npx prisma migrate deploy`. `supabase db pull`, schema declarativo e `supabase migration new` **não se aplicam**.
- **Nenhuma política RLS e nenhum grant neste ciclo.** A tabela nova nasce com RLS **ligada e zero políticas** (default-deny). Se uma tarefa parecer precisar de política, ela saiu do escopo — **pare e reporte**.
- **Nenhum arquivo novo pode importar `@/lib/prisma`.** As três listas `VIOLADORES_TEMPORARIOS_*` de `eslint.config.mjs` estão **vazias** e há catraca (`tests/unit/catraca-prisma-cru.test.ts`, `LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS = 0`) que só permite diminuir. O esperado neste ciclo é **zero exceção nova** — o desenho da §5.5 do spec existe justamente para isso. Se alguma tarefa parecer precisar do prisma cru, **pare e reporte antes** de acrescentar linha nenhuma.
- **`companyId` viaja como parâmetro explícito.** `AsyncLocalStorage` e estado global PROIBIDOS. Nenhum `Map`/`let` de credencial em escopo de módulo — o modo de falha é servir a credencial da empresa A para a B.
- **Nunca `prisma.company.findFirst()`** como origem de empresa.
- **Em Server Action a empresa vem de `usuarioAtual().companyId`, nunca de parâmetro.** Server Action é endpoint HTTP público. (O webhook é outra coisa: não tem sessão — ver Tarefa 7.)
- **Validar env em escopo de módulo derruba o `next build`.** Toda leitura de `COFRE_CHAVE_MESTRA` é **preguiçosa**, dentro da função que usa. Isto derrubou o deploy por três dias (`src/modules/whatsapp/gateway/index.ts:53-80`).
- **O segredo nunca volta para o navegador, nunca entra em `AuditLog`, nunca chega ao Sentry.** Decisões travadas do dono (§4.2, §4.3, §4.4 do spec).
- **Toda frase que afirme universal** — "todo", "sempre", "nenhum", "qualquer", "só" — precisa do caso de teste que a exercita, ou é reescrita.
- **Provar, não presumir.** O que este ambiente não provar sai como **NÃO VERIFICADO**, com o comando que um humano roda.
- **Não rodar `npm test` inteiro** salvo quando um passo pedir (Tarefa 11): ele executa o seed contra o banco de desenvolvimento real e reescreve a senha de `admin@exemplo.com` e `vendedor@exemplo.com` (⚠️ R1 e 🔍 NV5 do Ciclo 1a). Rodar os arquivos focados.
- **Nada de `vitest` em paralelo com outra execução de `vitest`.** O banco de teste não é separado do de desenvolvimento; duas execuções o envenenam.
- **Nunca ler nem imprimir o `.env`.** A Tarefa 2 acrescenta uma linha a ele **sem** exibir o valor.
- Toda mensagem de commit termina com:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **Branch de trabalho: `ciclo-2a-cofre-credenciais`**, criada a partir de `ciclo-1a-tenancy` (HEAD `8912941`).

## Linha de base medida em 2026-08-20 — conferir se mudou antes de fechar

| Medida | Valor | Como |
| --- | --- | --- |
| Criptografia simétrica em `src/` | **zero** | `grep -rn "createCipheriv\|createDecipheriv\|webcrypto\|subtle\." src/` |
| Telas em `src/app/(painel)/` | `contatos, conversas, etapas, export, fluxos, leads, tasks, usuarios` | `ls "src/app/(painel)/"` |
| Modelos de tenant | **12** | `src/core/tenancy/escopo.ts`, `MODELOS_DE_TENANT` |
| Modelos de tenant com `companyId` único | **2** (`BotConfig`, `CompanyConfig`) | `tests/unit/escopo-empresa.test.ts` |
| Relações inversas de `User` | **9** | `prisma/schema.prisma:89-97` e a prosa de `escopo.ts` |
| Exceções do lint | **5 permanentes, 0 temporárias** | `eslint.config.mjs:428` |
| Catraca de importadores temporários | `LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS = 0` | `tests/unit/catraca-prisma-cru.test.ts` |
| Advisor de segurança | 16 × `rls_enabled_no_policy` (INFO) + 2 × WARN de `rls_auto_enable` | `get_advisors(security)` |
| AEADs no runtime | `aes-256-gcm` **e** `chacha20-poly1305` | `node -e "require('node:crypto').getCiphers()"`, Node v22.21.0 |
| Consumidores de `whatsappGateway` | **4** (rota do webhook ×2, `turno.ts:370`, `agente.ts:254`) | `grep -rn "whatsappGateway" src/` |

## Ações do dono que travam a execução

**NENHUMA tarefa deste plano fica bloqueada por ação do dono.** A chave mestra do ambiente **local** é gerada pela própria Tarefa 2, sem ser impressa.

Duas ações do dono existem, e são de **implantação**, depois do plano pronto:

1. **Gerar a chave mestra da Vercel** — `openssl rand -base64 32` — e colá-la em `COFRE_CHAVE_MESTRA` (Vercel → Settings → Environment Variables, nos três ambientes).
2. **Cadastrar a conexão pela tela e recolar a URL do webhook** no painel da Evolution; só depois apagar `EVOLUTION_DOMAIN`, `EVOLUTION_INSTANCE`, `EVOLUTION_APIKEY` e `EVOLUTION_COMPANY_ID` da Vercel.

Herdada, não deste ciclo: **depois da Tarefa 11 (que roda `npm test`), rotacionar a senha do admin** — 🔍 NV5 do Ciclo 1a.

---

### Task 1: `WhatsappConnection` no schema, a migração, e o 13º modelo de tenant

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260820210000_cofre_conexoes_whatsapp/migration.sql`
- Modify: `src/core/tenancy/escopo.ts`
- Modify: `tests/unit/escopo-empresa.test.ts`

**Interfaces:**
- Consumes: `Company`, `User`, `Conversation` (`prisma/schema.prisma`); `MODELOS_DE_TENANT` (`src/core/tenancy/escopo.ts`).
- Produces:
  - `enum CanalConexao { EVOLUTION, META_CLOUD }`
  - `model WhatsappConnection` com `id`, `companyId`, `canal`, `nome`, `ativa`, `dominio String?`, `instancia String?`, `segredoCifrado String`, `segredoUltimos4 String`, `segredoAtualizadoEm DateTime`, `segredoAtualizadoPorId String?`, `webhookTokenHash String @unique`, `criadoEm`, `atualizadoEm`, `@@unique([companyId, canal, instancia])`, `@@index([companyId])`
  - `Conversation.connectionId String?` + relação `connection` + `@@index([connectionId])`
  - `Company.whatsappConnections WhatsappConnection[]`
  - `User.segredosDeConexao WhatsappConnection[]` (relação nomeada `"SegredosDeConexao"`) — a **10ª** relação inversa de `User`
  - `MODELOS_DE_TENANT` com **13** entradas
  - o delegate `prisma.whatsappConnection` gerado por `prisma generate`

- [ ] **Step 1: Criar a branch e medir o banco antes de tocar nele**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git checkout -b ciclo-2a-cofre-credenciais
npx prisma migrate status
```

Esperado: `Database schema is up to date!`. Se aparecer migração pendente, **pare e reporte** — aplicar migração alheia não é desta tarefa. Cole a saída.

- [ ] **Step 2: Escrever os casos que falham (RED)**

Em `tests/unit/escopo-empresa.test.ts`, o caso hoje chamado `"os 12 modelos de tenant nomeiam a relação \`company\` — a varredura depende do nome"` muda **só no título**:

```ts
    it("os 13 modelos de tenant nomeiam a relação `company` — a varredura depende do nome", () => {
```

E, **logo depois** do caso `"`BotConfig` e `CompanyConfig` são os ÚNICOS modelos de tenant onde companyId é único"` (que **não muda** — a `@@unique` composta de `WhatsappConnection` não torna `companyId` sozinho único), acrescentar dois casos novos:

```ts
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

      // Diferente de `Conversation.waId` (⚠️ R2 do Ciclo 1a): `waId` é
      // global-único sobre um identificador COMPARTILHÁVEL — o mesmo número
      // pode ser atendido por duas empresas, e por isso aquilo é defeito. Um
      // token de webhook é segredo de 256 bits: duas empresas com o mesmo
      // token é estado que DEVE ser impossível. Se esta linha cair, a
      // resolução do webhook (Tarefa 7) perde a garantia de que um token
      // aponta uma conexão só.
      expect(bloco.filter((l) => /^\s*webhookTokenHash\s+String\s+@unique/.test(l))).toHaveLength(1);
    });
```

- [ ] **Step 3: Rodar para ver falhar**

```bash
npx vitest run tests/unit/escopo-empresa.test.ts
```

Esperado: FAIL nos dois casos novos — `MODELOS_DE_TENANT.has("WhatsappConnection")` devolve `false`, e `blocoDoModelo("WhatsappConnection")` não acha bloco nenhum.

- [ ] **Step 4: Acrescentar o enum e o modelo ao schema**

Em `prisma/schema.prisma`, **depois** do bloco `enum WhatsappTipo`, acrescentar:

```prisma
/// Qual tecnologia atende o WhatsApp desta conexão.
///
/// `META_CLOUD` nasce declarado SEM nenhum código que o aceite — a fábrica de
/// gateway o recusa com erro nomeado, e há caso de teste para essa recusa. O
/// precedente é literal nesta mesma base: `WhatsappAutor.HUMANO`, cujo
/// comentário diz "o valor já existe no enum agora para não exigir uma
/// migração de enum quando essa fatia chegar". Aqui é a mesma coisa: o Ciclo
/// 2b (Meta Cloud API) troca uma recusa por uma implementação em vez de
/// acrescentar um valor e uma migração.
enum CanalConexao {
  EVOLUTION
  META_CLOUD
}
```

E, **depois** do bloco `model CompanyConfig`, acrescentar:

```prisma
/// Uma conexão de canal de WhatsApp, POR EMPRESA, com a credencial CIFRADA.
///
/// ## Por que a credencial é cifrada aqui e nenhuma outra coluna deste banco é
///
/// O Prisma conecta como DONO da tabela e ignora RLS — `CLAUDE.md` registra a
/// armadilha, e a migração `20260730212500_enable_rls_and_revoke_anon_grants`
/// diz por escrito que `FORCE ROW LEVEL SECURITY` não está ligada, de
/// propósito. Três caminhos entregam esta coluna a quem não deveria vê-la:
/// `pg_dump`/backup, vazamento da `service_role`, e qualquer consulta pelo
/// caminho do Prisma. A cifra é a ÚNICA defesa que sobrevive aos três, e a
/// chave mestra é a única peça que continua fora do banco.
///
/// ## Colunas TIPADAS, nunca `Json`
///
/// `dominio`/`instancia` são da Evolution e ficam nulas em outros canais. A
/// varredura de escopo do Ciclo 1d recusa `companyId` dentro de coluna `Json`
/// (ver "Falsos positivos conhecidos" em `core/tenancy/escopo.ts`), e um
/// `Json` de configuração é exatamente onde `companyId` acaba parando. O Ciclo
/// 2b acrescenta as colunas nulas da Meta (`phoneNumberId`, `wabaId`) e uma
/// SEGUNDA coluna cifrada (a Meta tem dois segredos: access token e app
/// secret) — nenhuma delas nasce aqui, porque coluna sem escritor é dado morto
/// com aparência de recurso.
///
/// ## `segredoUltimos4` é texto puro, e é escolha
///
/// A tela mostra `••••••••1a2b` para a pessoa reconhecer qual chave está lá. A
/// alternativa — decifrar a cada renderização da lista — poria texto claro na
/// memória do processo a cada carregamento de tela sem ganhar nada. É o mesmo
/// trade de `sk_live_…abcd`. O que se revela são 4 caracteres; ver D3 do spec.
///
/// ## `webhookTokenHash`, não o token
///
/// Cofre para o que precisa ser LIDO de volta; hash para o que só precisa ser
/// CONFERIDO. O token do webhook nunca é usado, só comparado — então um dump
/// do banco não entrega uma URL de webhook funcional. O `@unique` é GLOBAL de
/// propósito, e isso NÃO é a mesma coisa que `Conversation.waId` (⚠️ R2): ali
/// o valor é compartilhável entre empresas e a unicidade global é o defeito;
/// aqui o valor é um segredo de 256 bits e duas empresas com o mesmo token é
/// estado que deve ser impossível.
model WhatsappConnection {
  id        String       @id @default(cuid())
  companyId String
  company   Company      @relation(fields: [companyId], references: [id])
  canal     CanalConexao
  /// Rótulo humano ("Comercial", "Suporte") — é como a pessoa distingue duas
  /// conexões da mesma empresa numa lista.
  nome      String
  /// Interruptor do OPERADOR. NÃO é o estado de pareamento do WhatsApp — esse
  /// depende do evento `connection.update`, que a rota descarta hoje, e é o
  /// Ciclo 2c (QR Code). Mostrar "conectado" a partir daqui seria inventar um
  /// estado que ninguém mede.
  ativa     Boolean      @default(true)

  dominio   String?
  instancia String?

  segredoCifrado         String
  segredoUltimos4        String
  segredoAtualizadoEm    DateTime
  segredoAtualizadoPorId String?
  segredoAtualizadoPor   User?    @relation("SegredosDeConexao", fields: [segredoAtualizadoPorId], references: [id])

  webhookTokenHash String @unique

  criadoEm     DateTime @default(now())
  atualizadoEm DateTime @updatedAt

  conversas Conversation[]

  /// A mesma instância cadastrada duas vezes na mesma empresa não significa
  /// nada. `instancia` nula não colide, porque o Postgres trata NULL como
  /// distinto — que é o comportamento desejado para canal sem instância.
  @@unique([companyId, canal, instancia])
  @@index([companyId])
}
```

Em `model Company`, acrescentar à lista de relações, depois de `config`:

```prisma
  whatsappConnections WhatsappConnection[]
```

Em `model User`, acrescentar depois de `configsEditadas`:

```prisma
  segredosDeConexao  WhatsappConnection[] @relation("SegredosDeConexao")
```

Em `model Conversation`, acrescentar depois de `aguardandoHumanoDesde`:

```prisma
  /// Por qual conexão esta conversa entrou — e, portanto, por qual ela é
  /// respondida. NULA para conversa criada antes do Ciclo 2a; o envio trata a
  /// nula caindo na única conexão ativa da empresa e RECUSA se houver mais de
  /// uma (`ConexaoAmbiguaError`). Sem esta coluna, "multi-instância" seria
  /// mentira: com duas conexões na mesma empresa, "por qual respondo?" não tem
  /// resposta, e o erro seria responder o cliente pelo número errado.
  connectionId String?
  connection   WhatsappConnection? @relation(fields: [connectionId], references: [id])
```

E, junto aos outros `@@index` de `Conversation`:

```prisma
  @@index([connectionId])
```

- [ ] **Step 5: Escrever a migração à mão**

Criar `prisma/migrations/20260820210000_cofre_conexoes_whatsapp/migration.sql`:

```sql
-- Ciclo 2a, Task 1: a tabela de conexoes de canal, com a credencial CIFRADA.
--
-- Tabela NOVA e VAZIA. `NOT NULL` sem `DEFAULT` e seguro aqui porque nao ha
-- linha antiga e nao ha codigo publicado inserindo nela.
-- `tests/unit/migracoes-seguras.test.ts` isenta explicitamente coluna criada
-- dentro do proprio CREATE TABLE -- a isencao esta no analisador (`criadas.has`)
-- e tem caso proprio.
--
-- `Conversation`.`connectionId` e ADD COLUMN numa tabela que JA EXISTE -- por
-- isso ela e NULLABLE, sem NOT NULL e sem DEFAULT. E o unico jeito de nao
-- cair na regra que `migracoes-seguras` existe para travar: o codigo antigo
-- continua inserindo em "Conversation" sem essa coluna durante a janela de
-- deploy, e um NOT NULL ali quebraria toda ingestao de mensagem com 23502.
--
-- NENHUM backfill, de proposito. Conversa anterior a este ciclo fica com
-- connectionId NULO, e o envio resolve isso caindo na unica conexao ativa da
-- empresa (ou RECUSANDO, se houver mais de uma). Backfillar exigiria escolher
-- uma conexao para conversas que nasceram antes de existir conexao nenhuma --
-- chute com aparencia de dado.

-- CreateEnum
CREATE TYPE "CanalConexao" AS ENUM ('EVOLUTION', 'META_CLOUD');

-- CreateTable
CREATE TABLE "WhatsappConnection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "canal" "CanalConexao" NOT NULL,
    "nome" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "dominio" TEXT,
    "instancia" TEXT,
    "segredoCifrado" TEXT NOT NULL,
    "segredoUltimos4" TEXT NOT NULL,
    "segredoAtualizadoEm" TIMESTAMP(3) NOT NULL,
    "segredoAtualizadoPorId" TEXT,
    "webhookTokenHash" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappConnection_webhookTokenHash_key" ON "WhatsappConnection"("webhookTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappConnection_companyId_canal_instancia_key" ON "WhatsappConnection"("companyId", "canal", "instancia");

-- CreateIndex
CREATE INDEX "WhatsappConnection_companyId_idx" ON "WhatsappConnection"("companyId");

-- AddForeignKey
ALTER TABLE "WhatsappConnection" ADD CONSTRAINT "WhatsappConnection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappConnection" ADD CONSTRAINT "WhatsappConnection_segredoAtualizadoPorId_fkey" FOREIGN KEY ("segredoAtualizadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "connectionId" TEXT;

-- CreateIndex
CREATE INDEX "Conversation_connectionId_idx" ON "Conversation"("connectionId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "WhatsappConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A blindagem, e ela e obrigatoria em toda tabela nova deste projeto.
--
-- O Prisma nao emite RLS nem REVOKE. A migracao
-- 20260802000000_revoke_default_privileges_future_tables cobre os GRANTs
-- automaticos de objetos futuros (suspensorio), mas ALTER DEFAULT PRIVILEGES
-- NAO liga RLS -- isso continua sendo por tabela, a mao (cinto).
--
-- Sem estas duas linhas, tests/e2e/banco-blindado.spec.ts fica vermelho: ele
-- varre pg_class.relrowsecurity e information_schema.role_table_grants SEM
-- lista fixa de tabelas, entao uma tabela nova desprotegida aparece sozinha.
--
-- RLS LIGADA e ZERO politicas = default-deny. Nenhuma politica aqui: a
-- excecao NOMEADA para o Realtime e Ciclo 3. E esta tabela guarda credencial
-- cifrada -- e a ULTIMA que algum dia deveria ganhar politica de leitura.
ALTER TABLE "WhatsappConnection" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "WhatsappConnection" FROM anon, authenticated;
```

- [ ] **Step 6: Aplicar a migração e gerar o client**

```bash
npx prisma migrate deploy
npx prisma generate
```

Esperado: `1 migration found` / `Applied migration` e `Generated Prisma Client`. Cole as duas saídas.

- [ ] **Step 7: Acrescentar `WhatsappConnection` ao escopo e corrigir a prosa**

Em `src/core/tenancy/escopo.ts`, dentro de `MODELOS_DE_TENANT`, acrescentar `"WhatsappConnection"` **no fim** da lista (a ordem importa: o caso de `companyId` único usa `filter`, que preserva a ordem de inserção do Set):

```ts
  "CompanyConfig",
  "WhatsappMessage",
  "WhatsappConnection",
]);
```

E **três** trechos de prosa do mesmo arquivo mudam. Sem isso, a documentação passa a mentir — e o histórico deste arquivo registra duas frases que já ficaram erradas exatamente assim.

1. O cabeçalho `## Os 12 modelos de tenant` vira:

```
 * ## Os 13 modelos de tenant
 *
 * Medido em `prisma/schema.prisma` em 2026-08-20 (`awk` sobre os blocos
 * `model`, campo `companyId`): `Membership`, `Contact`, `PipelineStage`,
 * `Lead`, `LeadNote`, `Task`, `Notification`, `AuditLog`, `Conversation`,
 * `BotConfig`, `CompanyConfig`, `WhatsappMessage`, `WhatsappConnection`. O 12º
 * entrou no Ciclo 1c; o 13º no Ciclo 2a.
```

2. Na seção `## Leitura ANINHADA`, o parágrafo das relações inversas vira:

```
 * relação que passa por `User` não é.** `User` não é modelo de tenant (não tem
 * `companyId`, e o motivo está logo acima) e tem DEZ relações inversas —
 * `leadsAtribuidos`, `tasks`, `notes`, `notifications`, `auditLogs`,
 * `conversasPausadas`, `botConfigsEditadas`, `memberships`, `configsEditadas`,
 * `segredosDeConexao` (`prisma/schema.prisma`). Eram oito até o Ciclo 1c
 * pendurar `CompanyConfig` em `User` por `atualizadoPorId`, e nove até o Ciclo
 * 2a pendurar `WhatsappConnection` por `segredoAtualizadoPorId` — o número
 * aqui não é decorativo, ele conta as portas de saída do tenant e envelhece a
 * cada relação nova.
```

3. No bloco `**`BotConfig` e `CompanyConfig` são as exceções**`, acrescentar ao fim do parágrafo:

```
 * `WhatsappConnection` (Ciclo 2a) NÃO entra nessa lista: a `@@unique` dela é
 * COMPOSTA (`[companyId, canal, instancia]`), então `companyId` sozinho
 * continua não sendo único ali e `findUnique` continua recusado pelo motivo
 * geral. É deliberado: um `findUnique` por `webhookTokenHash` seria escopável
 * pelo tipo e NÃO pela empresa, que é exatamente o caminho que a Tarefa 7 do
 * Ciclo 2a fecha usando `findFirst` no cliente escopado.
```

- [ ] **Step 8: Rodar para ver passar**

```bash
npx vitest run tests/unit/escopo-empresa.test.ts tests/unit/migracoes-seguras.test.ts
npm run typecheck
```

Esperado: os dois arquivos verdes (incluindo os dois casos novos e o de deriva com 13), e `typecheck` sem erro.

- [ ] **Step 9: Confirmar que a tabela nasceu blindada**

```bash
npx playwright test tests/e2e/banco-blindado.spec.ts --workers=1
```

Esperado: verde. Ele varre `pg_class`/`role_table_grants` **sem lista fixa** — se o `ENABLE ROW LEVEL SECURITY` ou o `REVOKE` tivessem ficado de fora, a tabela nova apareceria sozinha. Cole a saída.

- [ ] **Step 10: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260820210000_cofre_conexoes_whatsapp src/core/tenancy/escopo.ts tests/unit/escopo-empresa.test.ts
git commit -m "$(cat <<'EOF'
feat(conexoes): abre lugar para a credencial da Evolution viver por empresa

A apikey mora numa variavel de ambiente por DEPLOY, e credencial e por
EMPRESA -- a segunda empresa nao cabe, e trocar a chave e um redeploy.
Esta tabela e onde ela passa a caber, com o segredo cifrado porque o
Prisma conecta como dono da tabela e ignora RLS: dump, backup e vazamento
da service_role entregam texto puro, e so a cifra sobrevive aos tres.

`Conversation.connectionId` entra junto porque multi-instancia sem ela
seria mentira: com duas conexoes na mesma empresa, "por qual respondo?"
nao tem resposta, e o erro seria responder o cliente pelo numero errado.

`META_CLOUD` nasce declarado sem codigo que o aceite, pelo mesmo motivo
que `WhatsappAutor.HUMANO` nasceu: evita migracao de enum no Ciclo 2b.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: O cofre — chave mestra e cifra autenticada

**DEPENDE DE AÇÃO DO DONO:** não. A chave local é gerada aqui, **sem ser impressa**.

**Files:**
- Create: `src/core/cofre/chave.ts`
- Create: `src/core/cofre/segredo.ts`
- Create: `src/core/cofre/index.ts`
- Create: `tests/unit/cofre-chave.test.ts`
- Create: `tests/unit/cofre-segredo.test.ts`
- Modify: `.env.example`
- Modify: `.env` (só APPEND de uma linha, sem leitura e sem impressão)

**Interfaces:**
- Consumes: nada além de `node:crypto`. **Não** toca banco, **não** toca Prisma.
- Produces:
  - `class CofreError extends Error` e as cinco filhas: `CofreSemChaveError`, `CofreChaveInvalidaError`, `CofreChaveDesconhecidaError`, `CofreFormatoInvalidoError`, `CofreDecifragemError`
  - `type ChaveMestra = { id: string; bytes: Buffer }`
  - `function chavesDoAmbiente(): ChaveMestra[]`
  - `function chaveAtiva(): ChaveMestra`
  - `function chavePorId(id: string): ChaveMestra`
  - `type ContextoDoSegredo = { companyId: string; proposito: string }`
  - `function cifrar(texto: string, contexto: ContextoDoSegredo): string`
  - `function decifrar(blob: string, contexto: ContextoDoSegredo): string`
  - `const PROPOSITO_APIKEY_CONEXAO = "whatsapp-connection:apiKey"`
  - a variável de ambiente `COFRE_CHAVE_MESTRA`

- [ ] **Step 1: Gerar a chave local sem imprimi-la**

```bash
cd "d:/Projetos Programação/N8n + Crm"
grep -q '^COFRE_CHAVE_MESTRA=' .env || printf 'COFRE_CHAVE_MESTRA="%s"\n' "$(openssl rand -base64 32)" >> .env
grep -c '^COFRE_CHAVE_MESTRA=' .env
```

Esperado: `1`. **O valor nunca é impresso** — o `grep -c` conta a linha e mais nada. `.env` está no `.gitignore`; confirme com `git status --short` que ele **não** aparece.

- [ ] **Step 2: Escrever os casos que falham (RED) — a chave**

Criar `tests/unit/cofre-chave.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  chavesDoAmbiente,
  chaveAtiva,
  chavePorId,
  CofreSemChaveError,
  CofreChaveInvalidaError,
  CofreChaveDesconhecidaError,
} from "../../src/core/cofre/chave";

/**
 * Chaves de teste: 32 bytes cada, determinísticas, NUNCA usadas em ambiente
 * nenhum. São literais de propósito — uma chave aleatória por execução
 * tornaria impossível afirmar o `keyId` esperado, e é justamente o `keyId`
 * que prende o formato à rotação.
 */
const CHAVE_A = Buffer.alloc(32, 1).toString("base64");
const CHAVE_B = Buffer.alloc(32, 2).toString("base64");

const original = process.env.COFRE_CHAVE_MESTRA;

beforeEach(() => {
  process.env.COFRE_CHAVE_MESTRA = CHAVE_A;
});

afterEach(() => {
  if (original === undefined) delete process.env.COFRE_CHAVE_MESTRA;
  else process.env.COFRE_CHAVE_MESTRA = original;
});

describe("carregamento da chave mestra", () => {
  it("lê `process.env` a CADA chamada — rotação vale sem reiniciar o processo", () => {
    // Sem memoização de propósito. Um cache em escopo de módulo seria estado
    // de processo — o mesmo gênero que o programa proíbe — e o sintoma seria
    // uma chave rotacionada que só passa a valer no próximo deploy.
    expect(chavesDoAmbiente()).toHaveLength(1);
    process.env.COFRE_CHAVE_MESTRA = `${CHAVE_B},${CHAVE_A}`;
    expect(chavesDoAmbiente()).toHaveLength(2);
  });

  it("a PRIMEIRA da lista é a ativa — rotacionar é acrescentar na frente", () => {
    process.env.COFRE_CHAVE_MESTRA = `${CHAVE_B},${CHAVE_A}`;
    expect(chaveAtiva().id).toBe(chavesDoAmbiente()[1 - 1].id);
    expect(chaveAtiva().id).not.toBe(chavePorId(chavesDoAmbiente()[1].id).id);
  });

  it("o `keyId` é derivado da chave, não digitado — mesma chave, mesmo id", () => {
    const primeiro = chaveAtiva().id;
    process.env.COFRE_CHAVE_MESTRA = `${CHAVE_B},${CHAVE_A}`;
    // A chave A mudou de posição, e o id dela não mudou: é `sha256` dos bytes,
    // não a posição na lista. Um id digitado poderia ser repetido ou errado.
    expect(chavePorId(primeiro).bytes.equals(Buffer.from(CHAVE_A, "base64"))).toBe(true);
  });

  it("o `keyId` tem 8 caracteres hex", () => {
    expect(chaveAtiva().id).toMatch(/^[0-9a-f]{8}$/);
  });

  it("variável ausente lança `CofreSemChaveError`", () => {
    delete process.env.COFRE_CHAVE_MESTRA;
    expect(() => chaveAtiva()).toThrow(CofreSemChaveError);
  });

  it("variável presente e VAZIA não é o mesmo que ausente, e também lança", () => {
    // String vazia definida é armadilha conhecida deste repositório — o
    // comentário de SEED_PASSWORD em `.env.example` registra o mesmo modo de
    // falha. Aqui ela precisa falhar igual.
    process.env.COFRE_CHAVE_MESTRA = "";
    expect(() => chaveAtiva()).toThrow(CofreSemChaveError);
  });

  it("chave que não decodifica para 32 bytes lança `CofreChaveInvalidaError`", () => {
    process.env.COFRE_CHAVE_MESTRA = Buffer.alloc(16, 9).toString("base64");
    expect(() => chaveAtiva()).toThrow(CofreChaveInvalidaError);
  });

  it("duas chaves com o MESMO id lançam — id ambíguo escolheria a errada em silêncio", () => {
    process.env.COFRE_CHAVE_MESTRA = `${CHAVE_A},${CHAVE_A}`;
    expect(() => chavesDoAmbiente()).toThrow(CofreChaveInvalidaError);
  });

  it("`keyId` fora da lista lança `CofreChaveDesconhecidaError` CITANDO o id", () => {
    // Sem o id na mensagem, quem opera não sabe qual chave restaurar.
    expect(() => chavePorId("deadbeef")).toThrow(/deadbeef/);
    expect(() => chavePorId("deadbeef")).toThrow(CofreChaveDesconhecidaError);
  });

  it("NENHUMA mensagem de erro carrega material de chave", () => {
    process.env.COFRE_CHAVE_MESTRA = `${CHAVE_A},${CHAVE_A}`;
    const mensagens: string[] = [];
    try {
      chavesDoAmbiente();
    } catch (erro) {
      mensagens.push((erro as Error).message);
    }
    process.env.COFRE_CHAVE_MESTRA = Buffer.alloc(16, 9).toString("base64");
    try {
      chaveAtiva();
    } catch (erro) {
      mensagens.push((erro as Error).message);
    }
    expect(mensagens).toHaveLength(2);
    for (const m of mensagens) {
      expect(m).not.toContain(CHAVE_A);
      expect(m).not.toContain(Buffer.alloc(16, 9).toString("base64"));
    }
  });
});
```

- [ ] **Step 3: Rodar para ver falhar**

```bash
npx vitest run tests/unit/cofre-chave.test.ts
```

Esperado: FAIL — `Cannot find module '../../src/core/cofre/chave'`.

- [ ] **Step 4: Escrever `chave.ts`**

Criar `src/core/cofre/chave.ts`:

```ts
import "server-only";

import crypto from "node:crypto";

/**
 * O carregador da chave mestra do cofre.
 *
 * ## Por que a chave fica no AMBIENTE e o segredo no BANCO
 *
 * O Prisma conecta como dono da tabela e ignora RLS (`CLAUDE.md`, e a migração
 * `20260730212500_enable_rls_and_revoke_anon_grants` diz que `FORCE ROW LEVEL
 * SECURITY` está desligada de propósito). Dump, backup automático e vazamento
 * da `service_role` entregam a coluna inteira. Cifrar só ajuda enquanto a
 * chave NÃO estiver no mesmo lugar que o texto cifrado — por isso ela é a
 * única peça que continua fora do banco.
 *
 * ## Por que NADA aqui é memoizado
 *
 * `process.env` é lido a cada chamada. Custo: dois `Buffer.from` e um `sha256`
 * de 32 bytes — irrelevante ao lado da ida ao banco que sempre acompanha.
 * Ganhos, e os dois importam: rotação passa a valer sem reiniciar processo, e
 * o módulo não tem binding mutável para envenenar entre testes. O caso "lê
 * `process.env` a CADA chamada" é o que prende isso.
 *
 * ## Por que NADA aqui roda no escopo do módulo
 *
 * `next build` avalia todo módulo alcançável para coletar a configuração das
 * rotas. Validar env no topo derrubou o deploy deste projeto por três dias —
 * o relato inteiro está em `src/modules/whatsapp/gateway/index.ts`. Aqui vale
 * igual: importar este arquivo num ambiente sem `COFRE_CHAVE_MESTRA` não pode
 * lançar; USAR sem ela tem de lançar.
 */
export class CofreError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = new.target.name;
  }
}

export class CofreSemChaveError extends CofreError {}
export class CofreChaveInvalidaError extends CofreError {}
export class CofreChaveDesconhecidaError extends CofreError {}

export type ChaveMestra = {
  /** 8 primeiros caracteres hex de `sha256(bytes)`. Derivado, nunca digitado. */
  id: string;
  bytes: Buffer;
};

/** AES-256 exige 32 bytes. Chave mais curta é erro de configuração, não "chave fraca". */
const TAMANHO_DA_CHAVE = 32;

const COMO_GERAR =
  "Gere com `openssl rand -base64 32` e defina COFRE_CHAVE_MESTRA " +
  "(lista separada por vírgula; a PRIMEIRA cifra, qualquer uma decifra).";

/**
 * O `id` é `sha256` dos BYTES, não do texto base64 — reencodar a mesma chave
 * (com ou sem padding, com quebra de linha) não pode mudar o id, senão os
 * blobs antigos deixariam de encontrar a chave que os cifrou.
 *
 * Expor 32 bits do `sha256` de uma chave de 256 bits não é caminho para a
 * chave; o que ele compra é rotação sem reescrever blob nenhum.
 */
function idDaChave(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 8);
}

/**
 * Todas as chaves configuradas, na ordem em que aparecem. A primeira é a que
 * cifra; qualquer uma pode decifrar, escolhida pelo `keyId` do próprio blob.
 *
 * Rotacionar é acrescentar a nova NA FRENTE: nada é reescrito, e os blobs
 * antigos continuam abrindo. A chave antiga sai da lista quando todos os
 * blobs tiverem passado por uma substituição normal pela tela.
 */
export function chavesDoAmbiente(): ChaveMestra[] {
  const bruto = process.env.COFRE_CHAVE_MESTRA;

  // String vazia DEFINIDA não é o mesmo que ausente para `process.env`, e
  // tratá-las diferente já mordeu este repositório antes (ver o comentário de
  // SEED_PASSWORD em `.env.example`). As duas são "não configurado".
  if (!bruto || bruto.trim().length === 0) {
    throw new CofreSemChaveError(
      `COFRE_CHAVE_MESTRA ausente ou vazia — o cofre de credenciais não abre sem ela. ${COMO_GERAR}`
    );
  }

  const chaves = bruto
    .split(",")
    .map((entrada) => entrada.trim())
    .filter((entrada) => entrada.length > 0)
    .map((entrada, indice) => {
      const bytes = Buffer.from(entrada, "base64");
      if (bytes.length !== TAMANHO_DA_CHAVE) {
        // A mensagem carrega a POSIÇÃO e o TAMANHO, nunca o valor. Quem opera
        // precisa saber qual entrada consertar; ninguém precisa ver a chave —
        // e uma mensagem de erro pode acabar num log de terceiros.
        throw new CofreChaveInvalidaError(
          `A ${indice + 1}ª entrada de COFRE_CHAVE_MESTRA decodifica para ${bytes.length} bytes, ` +
            `e AES-256 exige ${TAMANHO_DA_CHAVE}. ${COMO_GERAR}`
        );
      }
      return { id: idDaChave(bytes), bytes };
    });

  if (chaves.length === 0) {
    throw new CofreSemChaveError(
      `COFRE_CHAVE_MESTRA não tem nenhuma entrada utilizável. ${COMO_GERAR}`
    );
  }

  // Dois ids iguais fariam `chavePorId` devolver "alguma" das duas. Como ids
  // iguais só acontecem com chaves iguais, isto é sempre erro de configuração
  // (a mesma chave repetida na lista) — e falhar alto é melhor que escolher
  // em silêncio, mesmo quando a escolha daria certo por acaso.
  const ids = new Set(chaves.map((c) => c.id));
  if (ids.size !== chaves.length) {
    throw new CofreChaveInvalidaError(
      `COFRE_CHAVE_MESTRA tem ${chaves.length} entradas e apenas ${ids.size} identificadores ` +
        `distintos — há chave repetida na lista. Remova a duplicata.`
    );
  }

  return chaves;
}

export function chaveAtiva(): ChaveMestra {
  return chavesDoAmbiente()[0]!;
}

export function chavePorId(id: string): ChaveMestra {
  const encontrada = chavesDoAmbiente().find((chave) => chave.id === id);
  if (!encontrada) {
    // As DUAS saídas ditas em voz alta, de propósito. Degradar isto para
    // "credencial não configurada" convidaria alguém a recadastrar por cima de
    // um segredo que continua lá, quando o problema era só a chave fora do
    // ambiente.
    throw new CofreChaveDesconhecidaError(
      `O segredo foi cifrado com a chave ${id}, que não está em COFRE_CHAVE_MESTRA. ` +
        `Ou a chave voltou para a lista (acrescente-a, mesmo que não seja a primeira), ` +
        `ou a credencial é substituída pela tela de Configurações. ` +
        `Não há terceira saída: sem a chave, o segredo não abre.`
    );
  }
  return encontrada;
}
```

- [ ] **Step 5: Rodar para ver passar**

```bash
npx vitest run tests/unit/cofre-chave.test.ts
```

Esperado: PASS, 10 casos.

- [ ] **Step 6: Escrever os casos que falham (RED) — a cifra**

Criar `tests/unit/cofre-segredo.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  cifrar,
  decifrar,
  PROPOSITO_APIKEY_CONEXAO,
  CofreFormatoInvalidoError,
  CofreDecifragemError,
} from "../../src/core/cofre/segredo";
import { chaveAtiva, CofreChaveDesconhecidaError } from "../../src/core/cofre/chave";

const CHAVE_A = Buffer.alloc(32, 1).toString("base64");
const CHAVE_B = Buffer.alloc(32, 2).toString("base64");

const EMPRESA_A = "cmp_a";
const EMPRESA_B = "cmp_b";
const CTX_A = { companyId: EMPRESA_A, proposito: PROPOSITO_APIKEY_CONEXAO };

const SEGREDO = "apikey-da-evolution-com-acento-ção-e-emoji-🔐";

const original = process.env.COFRE_CHAVE_MESTRA;

beforeEach(() => {
  process.env.COFRE_CHAVE_MESTRA = CHAVE_A;
});

afterEach(() => {
  if (original === undefined) delete process.env.COFRE_CHAVE_MESTRA;
  else process.env.COFRE_CHAVE_MESTRA = original;
});

/** Vira um bit do campo indicado do blob, mantendo o formato intacto. */
function adulterar(blob: string, campo: 2 | 3 | 4): string {
  const partes = blob.split(".");
  const bytes = Buffer.from(partes[campo]!, "base64url");
  bytes[0] = bytes[0]! ^ 0x01;
  partes[campo] = bytes.toString("base64url");
  return partes.join(".");
}

describe("cofre — ida e volta", () => {
  it("decifrar desfaz cifrar, inclusive com acento e emoji", () => {
    expect(decifrar(cifrar(SEGREDO, CTX_A), CTX_A)).toBe(SEGREDO);
  });

  it("o blob NÃO contém o texto claro", () => {
    const blob = cifrar(SEGREDO, CTX_A);
    expect(blob).not.toContain(SEGREDO);
    expect(blob).not.toContain("apikey");
    expect(Buffer.from(blob, "utf8").includes(Buffer.from(SEGREDO, "utf8"))).toBe(false);
  });

  it("o formato é `v1.<keyId>.<iv>.<ct>.<tag>`, com o keyId da chave ativa", () => {
    const partes = cifrar(SEGREDO, CTX_A).split(".");
    expect(partes).toHaveLength(5);
    expect(partes[0]).toBe("v1");
    expect(partes[1]).toBe(chaveAtiva().id);
    // base64url, sem padding — é o que garante que `.` nunca apareça dentro
    // de um campo e o `split` continue confiável.
    for (const campo of partes.slice(2)) expect(campo).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("cifrar o MESMO texto duas vezes dá blobs DIFERENTES", () => {
    // Prova que o nonce é por operação. Nonce fixo com AES-GCM é catastrófico:
    // dois textos cifrados com o mesmo par (chave, nonce) vazam o XOR deles e
    // permitem forjar tag.
    expect(cifrar(SEGREDO, CTX_A)).not.toBe(cifrar(SEGREDO, CTX_A));
  });
});

describe("cofre — a AEAD recusa em vez de decifrar pela metade", () => {
  it("bit virado no ciphertext lança `CofreDecifragemError`", () => {
    expect(() => decifrar(adulterar(cifrar(SEGREDO, CTX_A), 3), CTX_A)).toThrow(CofreDecifragemError);
  });

  it("bit virado na tag lança", () => {
    expect(() => decifrar(adulterar(cifrar(SEGREDO, CTX_A), 4), CTX_A)).toThrow(CofreDecifragemError);
  });

  it("bit virado no iv lança", () => {
    expect(() => decifrar(adulterar(cifrar(SEGREDO, CTX_A), 2), CTX_A)).toThrow(CofreDecifragemError);
  });

  it("blob da empresa A NÃO abre com o companyId da B", () => {
    // Este é o caso que a AAD existe para fechar: quem tem `service_role` pode
    // COPIAR o blob de uma linha para outra. Sem AAD isso passaria, e a
    // empresa B responderia clientes pela instância da A.
    const blob = cifrar(SEGREDO, CTX_A);
    expect(() => decifrar(blob, { companyId: EMPRESA_B, proposito: PROPOSITO_APIKEY_CONEXAO })).toThrow(
      CofreDecifragemError
    );
  });

  it("blob de um propósito NÃO abre com outro", () => {
    const blob = cifrar(SEGREDO, CTX_A);
    expect(() => decifrar(blob, { companyId: EMPRESA_A, proposito: "outro:proposito" })).toThrow(
      CofreDecifragemError
    );
  });

  it("cabeçalho adulterado (keyId trocado) NÃO abre, mesmo com a chave certa na lista", () => {
    process.env.COFRE_CHAVE_MESTRA = `${CHAVE_A},${CHAVE_B}`;
    const blob = cifrar(SEGREDO, CTX_A);
    const partes = blob.split(".");
    const outroId = require("node:crypto")
      .createHash("sha256")
      .update(Buffer.from(CHAVE_B, "base64"))
      .digest("hex")
      .slice(0, 8);
    partes[1] = outroId;
    // O keyId entra na AAD, então trocá-lo quebra a tag antes mesmo de a chave
    // errada ter chance de produzir lixo.
    expect(() => decifrar(partes.join("."), CTX_A)).toThrow(CofreDecifragemError);
  });
});

describe("cofre — formato e rotação", () => {
  it("string fora do formato lança `CofreFormatoInvalidoError`", () => {
    for (const ruim of ["", "texto-puro", "v1.só.tres.partes", "v9.aaaaaaaa.a.b.c"]) {
      expect(() => decifrar(ruim, CTX_A)).toThrow(CofreFormatoInvalidoError);
    }
  });

  it("chave nova NA FRENTE: o blob antigo continua abrindo e o novo usa a chave nova", () => {
    const blobAntigo = cifrar(SEGREDO, CTX_A);
    const idAntigo = blobAntigo.split(".")[1];

    process.env.COFRE_CHAVE_MESTRA = `${CHAVE_B},${CHAVE_A}`;

    expect(decifrar(blobAntigo, CTX_A)).toBe(SEGREDO);

    const blobNovo = cifrar(SEGREDO, CTX_A);
    expect(blobNovo.split(".")[1]).not.toBe(idAntigo);
    expect(decifrar(blobNovo, CTX_A)).toBe(SEGREDO);
  });

  it("chave RETIRADA da lista lança `CofreChaveDesconhecidaError`, não `CofreDecifragemError`", () => {
    // A distinção é o que diz a quem opera o que fazer: chave sumida tem
    // conserto (repor a chave), tag quebrada não.
    const blob = cifrar(SEGREDO, CTX_A);
    process.env.COFRE_CHAVE_MESTRA = CHAVE_B;
    expect(() => decifrar(blob, CTX_A)).toThrow(CofreChaveDesconhecidaError);
  });

  it("NENHUMA mensagem de erro da cifra carrega o texto claro", () => {
    const blob = cifrar(SEGREDO, CTX_A);
    const mensagens: string[] = [];
    for (const chamada of [
      () => decifrar(adulterar(blob, 3), CTX_A),
      () => decifrar("texto-puro", CTX_A),
      () => decifrar(blob, { companyId: EMPRESA_B, proposito: PROPOSITO_APIKEY_CONEXAO }),
    ]) {
      try {
        chamada();
      } catch (erro) {
        mensagens.push((erro as Error).message);
      }
    }
    expect(mensagens).toHaveLength(3);
    for (const m of mensagens) {
      expect(m).not.toContain(SEGREDO);
      expect(m).not.toContain(CHAVE_A);
    }
  });
});
```

- [ ] **Step 7: Rodar para ver falhar**

```bash
npx vitest run tests/unit/cofre-segredo.test.ts
```

Esperado: FAIL — `Cannot find module '../../src/core/cofre/segredo'`.

- [ ] **Step 8: Escrever `segredo.ts`**

Criar `src/core/cofre/segredo.ts`:

```ts
import crypto from "node:crypto";

import { chaveAtiva, chavePorId, CofreError } from "./chave";

/**
 * A cifra do cofre. Não sabe o que é WhatsApp, o que é Evolution nem o que é
 * uma conexão — recebe texto, um `companyId` e um rótulo de propósito.
 *
 * ## `aes-256-gcm`, e por que um AEAD
 *
 * O segredo mora numa coluna que quem tem `service_role` pode REESCREVER.
 * Cifra sem autenticação aceita em silêncio o blob de outra linha; um AEAD
 * recusa. Autenticar aqui não é luxo — é a defesa contra exatamente o mesmo
 * atacante que a cifra pressupõe.
 *
 * GCM e não `chacha20-poly1305`, embora os dois existam no runtime (medido em
 * 2026-08-20, Node v22.21.0, `crypto.getCiphers()`): AES-GCM tem aceleração de
 * hardware no host, é o AEAD que mais gente sabe revisar, e o volume aqui é
 * ridículo (uma cifragem por troca de credencial). Trocar é mudar uma
 * constante — o `v1` do formato existe para isso.
 *
 * `node:crypto` e não dependência nova: uma biblioteca de cofre traria
 * superfície de supply-chain para as ~40 linhas que `createCipheriv` resolve.
 * Se um dia for preciso KMS/HSM, o ponto de troca é `./chave.ts`, não o
 * formato.
 *
 * ## Nonce de 96 bits, aleatório, um por cifragem
 *
 * O limite de aniversário para nonce aleatório de 96 bits fica na casa de 2^32
 * cifragens COM A MESMA CHAVE. Este sistema cifra na ordem de dezenas por ano.
 * O caso "cifrar o MESMO texto duas vezes dá blobs DIFERENTES" é o que impede
 * alguém de "otimizar" isto para um nonce fixo, que com GCM é catastrófico.
 *
 * ## O que a AAD prende, e o que ela NÃO prende
 *
 * A AAD é `v1|<keyId>|<companyId>|<proposito>` — autenticada, não cifrada.
 * Com ela, três movimentos falham na tag, e cada um tem caso de teste: mover o
 * blob da empresa A para a linha da B, mover o blob de uma coluna (propósito)
 * para outra, e editar o cabeçalho.
 *
 * O que ela **não** cobre: trocar o blob entre DUAS CONEXÕES DA MESMA EMPRESA,
 * do mesmo propósito. Isso passa. Cobrir exigiria pôr o `id` da linha na AAD,
 * e o `id` não existe antes de o Prisma criar a linha. Está registrado como
 * D2 do spec — dizer que está fechado quando não está desliga a desconfiança
 * de quem lê depois, que é pior que a lacuna.
 */
export class CofreFormatoInvalidoError extends CofreError {}
export class CofreDecifragemError extends CofreError {}

/**
 * O rótulo que separa este segredo de qualquer outro que o cofre venha a
 * guardar. Ele entra na AAD, então mudá-lo torna ilegíveis os blobs antigos —
 * é identificador de formato, não texto de interface.
 */
export const PROPOSITO_APIKEY_CONEXAO = "whatsapp-connection:apiKey";

export type ContextoDoSegredo = {
  companyId: string;
  proposito: string;
};

const VERSAO = "v1";
const ALGORITMO = "aes-256-gcm";
/** 96 bits — o tamanho para o qual o GCM foi especificado e otimizado. */
const TAMANHO_DO_NONCE = 12;

function montarAad(keyId: string, contexto: ContextoDoSegredo): Buffer {
  return Buffer.from(`${VERSAO}|${keyId}|${contexto.companyId}|${contexto.proposito}`, "utf8");
}

export function cifrar(texto: string, contexto: ContextoDoSegredo): string {
  const chave = chaveAtiva();
  const nonce = crypto.randomBytes(TAMANHO_DO_NONCE);

  const cifrador = crypto.createCipheriv(ALGORITMO, chave.bytes, nonce);
  cifrador.setAAD(montarAad(chave.id, contexto));

  const conteudo = Buffer.concat([cifrador.update(texto, "utf8"), cifrador.final()]);
  const tag = cifrador.getAuthTag();

  return [
    VERSAO,
    chave.id,
    nonce.toString("base64url"),
    conteudo.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

export function decifrar(blob: string, contexto: ContextoDoSegredo): string {
  const partes = blob.split(".");
  if (partes.length !== 5 || partes[0] !== VERSAO) {
    // A mensagem NÃO ecoa o blob. Ele não é texto claro, mas também não tem
    // por que sair daqui — `src/lib/sentry-scrub.ts` o redige justamente
    // porque uma mensagem de erro pode acabar num serviço de terceiros.
    throw new CofreFormatoInvalidoError(
      `Valor cifrado fora do formato esperado \`${VERSAO}.<keyId>.<iv>.<ct>.<tag>\` ` +
        `(recebido: ${partes.length} campos, versão ${JSON.stringify(partes[0] ?? "")}). ` +
        `Ou a coluna foi editada à mão, ou este valor nunca passou pelo cofre.`
    );
  }

  const [, keyId, nonceB64, conteudoB64, tagB64] = partes as [string, string, string, string, string];

  // `chavePorId` lança `CofreChaveDesconhecidaError`, e o erro sobe INTACTO.
  // Convertê-lo em `CofreDecifragemError` apagaria a única distinção que
  // importa para quem opera: chave sumida tem conserto, tag quebrada não.
  const chave = chavePorId(keyId);

  try {
    const decifrador = crypto.createDecipheriv(ALGORITMO, chave.bytes, Buffer.from(nonceB64, "base64url"));
    decifrador.setAAD(montarAad(keyId, contexto));
    decifrador.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      decifrador.update(Buffer.from(conteudoB64, "base64url")),
      decifrador.final(),
    ]).toString("utf8");
  } catch {
    // O erro original é engolido de propósito: ele é do OpenSSL, não diz nada
    // acionável, e repassá-lo só aumenta a chance de material sensível chegar
    // a um log. O que a mensagem precisa dizer é o que aconteceu e o que
    // fazer.
    throw new CofreDecifragemError(
      `A verificação de integridade do segredo falhou (chave ${keyId}). ` +
        `Isso acontece quando o valor cifrado foi alterado, quando ele pertence a OUTRA empresa ` +
        `ou a outro propósito, ou quando a chave mestra não é a que o cifrou. ` +
        `O cofre RECUSA em vez de devolver conteúdo parcial.`
    );
  }
}
```

- [ ] **Step 9: Escrever `index.ts` e rodar**

Criar `src/core/cofre/index.ts`:

```ts
/**
 * A porta única do cofre. Quem consome importa daqui e nunca dos arquivos
 * internos — assim trocar o carregador de chave por um KMS, ou o formato por
 * um `v2`, não obriga a mexer em nenhum chamador.
 */
export {
  CofreError,
  CofreSemChaveError,
  CofreChaveInvalidaError,
  CofreChaveDesconhecidaError,
  type ChaveMestra,
} from "./chave";

export {
  cifrar,
  decifrar,
  PROPOSITO_APIKEY_CONEXAO,
  CofreFormatoInvalidoError,
  CofreDecifragemError,
  type ContextoDoSegredo,
} from "./segredo";
```

```bash
npx vitest run tests/unit/cofre-chave.test.ts tests/unit/cofre-segredo.test.ts
npm run typecheck
npm run lint
```

Esperado: os dois arquivos verdes (10 + 14 casos), `typecheck` e `lint` sem erro.

- [ ] **Step 10: Documentar a variável em `.env.example`**

Acrescentar ao fim de `.env.example`:

```
# --- Cofre de credenciais (Ciclo 2a) -- ver src/core/cofre/ ---------------

# Chave mestra que cifra as credenciais de API guardadas no banco
# (hoje: a apikey da Evolution, em WhatsappConnection.segredoCifrado).
#
# Formato: lista separada por virgula de chaves em base64 de 32 bytes. A
# PRIMEIRA cifra; QUALQUER uma decifra, escolhida pelo identificador que viaja
# dentro do proprio valor cifrado. Rotacionar = acrescentar a nova NA FRENTE;
# nada precisa ser reescrito e os segredos antigos continuam abrindo. A chave
# antiga sai da lista quando todos os segredos ja tiverem sido substituidos
# pela tela.
#
#   openssl rand -base64 32
#
# POR QUE ELA FICA AQUI E NAO NO BANCO: o Prisma conecta como dono da tabela e
# ignora RLS -- dump, backup automatico e vazamento da service_role entregam a
# coluna inteira. Cifrar so ajuda enquanto a chave NAO estiver no mesmo lugar
# que o texto cifrado.
#
# SEM ELA O WHATSAPP NAO SOBE, e e assim que tem de ser: nao existe fallback
# para texto puro. Perder a chave torna os segredos irrecuperaveis -- guarde-a
# num gerenciador de segredos, nao so na Vercel.
COFRE_CHAVE_MESTRA="gerar-com-openssl-rand-base64-32"
```

- [ ] **Step 11: Commit**

```bash
git add src/core/cofre tests/unit/cofre-chave.test.ts tests/unit/cofre-segredo.test.ts .env.example
git commit -m "$(cat <<'EOF'
feat(cofre): cifra autenticada para o que nao pode sair em texto num dump

RLS nao protege o caminho do Prisma -- ele conecta como dono da tabela --,
entao dump, backup e vazamento da service_role entregam credencial em
texto puro. A cifra e a unica defesa que sobrevive aos tres, e a chave
mestra e a unica peca que continua fora do banco.

AEAD (aes-256-gcm) e nao cifra simples porque quem tem service_role pode
REESCREVER a coluna: sem autenticacao, o blob de outra linha passaria em
silencio. A AAD prende o blob a empresa e ao proposito, entao copiar o
segredo da empresa A para a linha da B falha na tag.

Formato `v1.<keyId>.<iv>.<ct>.<tag>`: o keyId permite trocar a chave sem
reescrever nada, e o `v1` permite trocar o algoritmo depois.

Nada e memoizado e nada roda no escopo do modulo -- validar env no topo
derrubou o deploy deste projeto por tres dias.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: O segredo não chega ao Sentry

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Modify: `src/lib/sentry-scrub.ts`
- Modify: `tests/unit/sentry-scrub.test.ts`
- Modify: `src/modules/whatsapp/gateway/evolution.ts`
- Modify: `tests/unit/whatsapp-evolution-gateway.test.ts`

**Interfaces:**
- Consumes: `redigirPii` e `redigirPiiProfundo` (`src/lib/sentry-scrub.ts`), já existentes e já ligadas ao Sentry; `EvolutionGatewayConfig` (`src/modules/whatsapp/gateway/evolution.ts`).
- Produces: `redigirPii` passa a remover **blob do cofre** e **chave base64 de 32 bytes**, além do que já removia. `EvolutionGateway.enviarTexto` passa a substituir a própria apikey por `[apikey]` no corpo de erro. Nenhuma assinatura muda.

- [ ] **Step 1: Escrever os casos que falham (RED) — o scrub**

Acrescentar a `tests/unit/sentry-scrub.test.ts`, no fim do arquivo:

```ts
describe("segredos do cofre (Ciclo 2a)", () => {
  // Blob real de formato: v1, keyId de 8 hex, três campos base64url.
  const BLOB =
    "v1.9f3c1a2b.qMKmZ0lRb3RhbmE.c2VncmVkby1jaWZyYWRvLWFxdWk.ZmFrZS10YWctZGUtMTZi";

  it("blob do cofre é redigido", () => {
    expect(redigirPii(`Falha ao decifrar ${BLOB} da conexão cmp_1`)).toContain("[segredo cifrado]");
    expect(redigirPii(`Falha ao decifrar ${BLOB}`)).not.toContain("qMKmZ0lRb3RhbmE");
  });

  it("chave mestra em base64 (32 bytes) é redigida", () => {
    const chave = Buffer.alloc(32, 7).toString("base64");
    const saida = redigirPii(`COFRE_CHAVE_MESTRA=${chave} não decodifica`);
    expect(saida).toContain("[chave]");
    expect(saida).not.toContain(chave);
  });

  it("um sha256 de 64 hex NÃO é redigido — a fronteira não pegou geral", () => {
    // Sem esta prova, "redige base64 de 32 bytes" poderia estar apagando todo
    // identificador longo do sistema, e o diagnóstico de qualquer erro ficaria
    // cego. O critério do arquivo é redigir agressivamente, não redigir tudo.
    const sha = "a".repeat(64);
    expect(redigirPii(`hash do token: ${sha}`)).toContain(sha);
  });

  it("um cuid NÃO é redigido", () => {
    const cuid = "cmeq0a1b2c3d4e5f6g7h8i9j";
    expect(redigirPii(`conexão ${cuid} não encontrada`)).toContain(cuid);
  });

  it("redige em profundidade, dentro de um evento aninhado", () => {
    const evento = { exception: { values: [{ value: `erro com ${BLOB}` }] } };
    expect(JSON.stringify(redigirPiiProfundo(evento))).toContain("[segredo cifrado]");
  });
});
```

> Se `tests/unit/sentry-scrub.test.ts` ainda não importar `redigirPiiProfundo`, acrescente-o ao `import` existente do arquivo.

- [ ] **Step 2: Rodar para ver falhar**

```bash
npx vitest run tests/unit/sentry-scrub.test.ts
```

Esperado: FAIL nos dois primeiros casos novos (o blob e a chave saem inteiros); os três últimos já passam e ficam como trava.

- [ ] **Step 3: Acrescentar os dois padrões**

Em `src/lib/sentry-scrub.ts`, **depois** da constante `TELEFONE`, acrescentar:

```ts
/**
 * Um valor cifrado pelo cofre (`src/core/cofre/segredo.ts`):
 * `v1.<8 hex>.<base64url>.<base64url>.<base64url>`.
 *
 * O blob não é texto claro — sem a chave mestra ele não abre. Ele é redigido
 * mesmo assim por dois motivos: uma mensagem de erro que carrega o blob dá a
 * um atacante offline o material sobre o qual trabalhar, e o Sentry guarda o
 * evento fora do controle de quem opera o CRM, para sempre. É o mesmo
 * raciocínio que já vale para o hash bcrypt logo acima — "não deveria" já
 * falhou neste projeto antes.
 */
const SEGREDO_CIFRADO = /\bv1\.[0-9a-f]{8}(?:\.[A-Za-z0-9_-]{8,}){3}\b/g;

/**
 * Uma chave de 32 bytes em base64 — o formato de `COFRE_CHAVE_MESTRA` e, por
 * coincidência útil, o de `AUTH_SECRET`.
 *
 * `{43}` EXATOS, com padding opcional, e ancorado por fronteiras de caractere
 * base64 nos dois lados. A precisão não é estética: sem ela, um `sha256` de 64
 * hex (que também é feito de caracteres do alfabeto base64) casaria com um
 * prefixo de 43, e todo hash do sistema sumiria dos relatórios de erro. Há
 * caso de teste para as duas metades — a chave é redigida, o sha256 não.
 *
 * O critério continua sendo o do topo deste arquivo: redigir agressivamente e
 * aceitar falso positivo. Perder um identificador longo atrapalha um
 * diagnóstico; publicar a chave que abre TODAS as credenciais do banco é outra
 * categoria de problema.
 */
const CHAVE_BASE64 = /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{43}={0,2}(?![A-Za-z0-9+/=])/g;
```

E `redigirPii` passa a ser:

```ts
export function redigirPii(texto: string): string {
  return texto
    .replace(SEGREDO_CIFRADO, "[segredo cifrado]")
    .replace(BCRYPT, "[hash]")
    .replace(CHAVE_BASE64, "[chave]")
    .replace(EMAIL, "[e-mail]")
    .replace(TELEFONE, "[telefone]");
}
```

E o comentário de `redigirPii` ganha a ordem nova:

```ts
/**
 * Redige dado pessoal e material de segredo de um texto livre.
 *
 * A ordem importa, e agora por dois motivos:
 *
 * - O **blob do cofre** sai PRIMEIRO. Ele contém campos base64url longos que
 *   `CHAVE_BASE64` recortaria pelo meio, deixando o resto do blob visível — o
 *   mesmo modo de falha que já justificava o bcrypt vir antes do telefone.
 * - O **hash bcrypt** continua antes de `CHAVE_BASE64` e de `TELEFONE`, pela
 *   razão original: os dois padrões recortariam pedaços dele.
 */
```

- [ ] **Step 4: Rodar para ver passar**

```bash
npx vitest run tests/unit/sentry-scrub.test.ts
```

Esperado: PASS, incluindo os cinco casos novos.

- [ ] **Step 5: Escrever o caso que falha (RED) — a apikey ecoada**

Acrescentar a `tests/unit/whatsapp-evolution-gateway.test.ts`, no fim:

```ts
describe("a apikey nunca entra na mensagem de erro (Ciclo 2a)", () => {
  const APIKEY = "chave-secreta-da-instancia-9f3c1a2b";

  it("corpo de erro que ECOA a apikey sai redigido", async () => {
    // Isto não é hipótese: uma API que recusa autenticação frequentemente
    // devolve a credencial recebida no corpo do erro, e `enviarTexto` põe os
    // primeiros 500 caracteres do corpo dentro da mensagem lançada. Daí a
    // mensagem vai para `console.error` e para o Sentry.
    //
    // A defesa é EXATA e não heurística: o adaptador conhece a própria
    // apikey. Uma expressão regular não conseguiria — o formato da apikey da
    // Evolution não é fixo, e por isso `sentry-scrub.ts` não tem padrão para
    // ela.
    const gateway = new EvolutionGateway({
      domain: "https://evo.exemplo.com",
      instance: "instancia-teste",
      apiKey: APIKEY,
    });

    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ erro: "unauthorized", apikey: APIKEY }), {
        status: 401,
      })) as typeof fetch;

    try {
      await expect(gateway.enviarTexto("5511999998888", "oi")).rejects.toThrow(/\[apikey\]/);
      await expect(gateway.enviarTexto("5511999998888", "oi")).rejects.not.toThrow(
        new RegExp(APIKEY)
      );
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  });
});
```

> Se o arquivo ainda não importar `EvolutionGateway`, acrescente-o ao `import` existente.

- [ ] **Step 6: Rodar para ver falhar**

```bash
npx vitest run tests/unit/whatsapp-evolution-gateway.test.ts
```

Esperado: FAIL — a mensagem lançada contém a apikey em vez de `[apikey]`.

- [ ] **Step 7: Redigir a apikey na origem**

Em `src/modules/whatsapp/gateway/evolution.ts`, dentro de `enviarTexto`, trocar o bloco de erro por:

```ts
    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => "");
      // A apikey sai do corpo ANTES de virar mensagem. Uma API que recusa
      // autenticação costuma devolver a credencial recebida, e esta mensagem
      // vai para `console.error` e para o Sentry — onde fica fora do controle
      // de quem opera o CRM, para sempre.
      //
      // A redação é aqui e não em `src/lib/sentry-scrub.ts` porque só ESTE
      // objeto sabe qual é a apikey: o formato dela não é fixo, então nenhuma
      // expressão regular a reconheceria sem redigir meio mundo junto. Isto é
      // substituição exata; aquele arquivo cuida do que dá para reconhecer por
      // forma (blob do cofre, chave base64, e-mail, telefone).
      throw new Error(
        `Falha ao enviar mensagem via Evolution (HTTP ${resposta.status}): ${redigirApiKey(
          corpo.slice(0, 500),
          this.config.apiKey
        )}`
      );
    }
```

E acrescentar, **antes** da classe `EvolutionGateway`:

```ts
/**
 * Substitui a apikey por `[apikey]` num texto vindo da Evolution.
 *
 * `split`/`join` em vez de `replace` com expressão regular: a apikey é dado de
 * configuração e pode conter `.`, `+`, `$` ou `\` — caracteres que uma regex
 * montada a partir dela interpretaria, produzindo uma redação que falha
 * justamente nas chaves mais incomuns. Substituição literal não tem esse
 * problema.
 *
 * `apiKey` vazia devolve o texto intacto: sem isso, `split("")` estilhaçaria
 * a string caractere a caractere e o corpo do erro sairia como uma fileira de
 * `[apikey]`.
 */
function redigirApiKey(texto: string, apiKey: string): string {
  if (apiKey.length === 0) return texto;
  return texto.split(apiKey).join("[apikey]");
}
```

- [ ] **Step 8: Rodar para ver passar**

```bash
npx vitest run tests/unit/whatsapp-evolution-gateway.test.ts tests/unit/sentry-scrub.test.ts
npm run typecheck
npm run lint
```

Esperado: os dois arquivos verdes, `typecheck` e `lint` sem erro.

- [ ] **Step 9: Commit**

```bash
git add src/lib/sentry-scrub.ts src/modules/whatsapp/gateway/evolution.ts tests/unit/sentry-scrub.test.ts tests/unit/whatsapp-evolution-gateway.test.ts
git commit -m "$(cat <<'EOF'
fix(sentry): fecha os tres caminhos por onde credencial chegaria ao Sentry

O evento do Sentry sai da maquina e fica fora do controle de quem opera o
CRM, para sempre -- e as mensagens deste sistema carregam segredo por
construcao. Tres buracos, tres defesas de natureza diferente:

- blob do cofre e chave base64 de 32 bytes tem FORMA reconhecivel, entao
  saem por padrao em sentry-scrub, na frente do bcrypt para que os
  recortes nao se atrapalhem;
- a apikey da Evolution NAO tem forma fixa -- nenhuma regex a pegaria sem
  redigir meio mundo junto --, entao ela e redigida na origem, pelo unico
  objeto que sabe qual e: o proprio adaptador.

O caso do sha256 de 64 hex prova que a fronteira de 43 caracteres nao
pegou geral: sem ele, "redige base64" apagaria todo hash do sistema e o
diagnostico de qualquer erro ficaria cego.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: A permissão `gerenciar_conexoes`

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Modify: `src/core/auth/permissions.ts`
- Modify: `tests/unit/permissions.test.ts`

**Interfaces:**
- Consumes: `type Acao` e `const matriz` (`src/core/auth/permissions.ts`); `hasPermission(papel: Role, acao: Acao): boolean`, assinatura inalterada.
- Produces: `"gerenciar_conexoes"` como membro de `Acao`, presente **apenas** em `ADMIN`. Consumida pela Tarefa 9 (página e Server Actions) e pela Tarefa 10 (item de menu).

- [ ] **Step 1: Escrever os casos que falham (RED)**

Acrescentar ao fim de `tests/unit/permissions.test.ts`:

```ts
describe("gerenciar_conexoes (Ciclo 2a)", () => {
  it("ADMIN pode", () => {
    expect(hasPermission("ADMIN", "gerenciar_conexoes")).toBe(true);
  });

  it("GESTOR não pode", () => {
    // Mesmo argumento de `gerenciar_fluxos`: o erro aqui derruba o
    // atendimento da empresa inteira, e credencial substituída em silêncio é
    // tomada de canal.
    expect(hasPermission("GESTOR", "gerenciar_conexoes")).toBe(false);
  });

  it("VENDEDOR não pode", () => {
    expect(hasPermission("VENDEDOR", "gerenciar_conexoes")).toBe(false);
  });

  it("não existe `ver_conexoes` — a separação foi RECUSADA, não esquecida", () => {
    // A matriz registra, no comentário de `ver_fluxos`, que separar sem motivo
    // cria "uma permissão órfã de um lado e uma tela morta do outro". Aqui não
    // há NADA para ver: o segredo não renderiza, e nome/domínio/instância só
    // interessam a quem pode mudar.
    //
    // `as never` porque `ver_conexoes` NÃO é membro de `Acao` — é essa a
    // afirmação. Se alguém a acrescentar ao tipo, este `as never` deixa de
    // compilar e obriga a revisitar a decisão em vez de deslizar para ela.
    for (const papel of ["ADMIN", "GESTOR", "VENDEDOR"] as const) {
      expect(hasPermission(papel, "ver_conexoes" as never)).toBe(false);
    }
  });
});
```

> Se `tests/unit/permissions.test.ts` ainda não importar `hasPermission`, ele já importa — o arquivo existe e testa a matriz. Não acrescente import novo sem conferir.

- [ ] **Step 2: Rodar para ver falhar**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/permissions.test.ts
```

Esperado: FAIL — `"gerenciar_conexoes"` não é membro de `Acao` (erro de tipo no arquivo de teste) e `hasPermission("ADMIN", ...)` devolve `false`.

- [ ] **Step 3: Acrescentar a ação à união e à matriz**

Em `src/core/auth/permissions.ts`, a última linha da união hoje é `| "ver_fluxos";`. Ela passa a `| "ver_fluxos"` e, logo depois, entra:

```ts
  /**
   * Cadastrar, editar, substituir a credencial, ativar/desativar e apagar as
   * conexões de canal de WhatsApp da empresa (`WhatsappConnection`), e gerar a
   * URL de webhook delas.
   *
   * ADMIN apenas, pelo mesmo motivo de `gerenciar_fluxos` e com o mesmo custo
   * de erro: desativar ou apagar a conexão derruba o atendimento da empresa
   * inteira, e substituir a credencial é TOMADA DE CANAL — quem trocar a
   * apikey passa a responder os clientes daquela empresa pela instância que
   * ele controlar. É a mesma família de `redefinir_senha`.
   *
   * ## Por que NÃO reaproveita nenhuma permissão existente
   *
   * - `gerenciar_fluxos` é sobre a instância n8n. Fundir daria a quem religa
   *   um workflow o poder de substituir a credencial do WhatsApp, e o inverso
   *   — dois sistemas externos diferentes, com donos operacionais diferentes.
   * - `configurar_agente` é o CONTEÚDO do bot (persona, regras, FAQ). Quem
   *   ajusta o tom de voz não precisa poder trocar o número de onde a empresa
   *   responde. E ela vive atrás do portão do módulo `whatsapp`, numa tela
   *   dentro de `/conversas`; esta vive em Configurações, que não é módulo.
   * - `gerenciar_usuarios` é sobre pessoas.
   *
   * ## Por que UMA permissão, e não o par `ver_`/`gerenciar_`
   *
   * `ver_fluxos` (logo acima) existe porque a tela de fluxos responde uma
   * pergunta — "isso ainda quebra?" — que um leitor resolve sem escrever nada.
   * Aqui não há pergunta equivalente: o segredo NUNCA renderiza (decisão do
   * dono), e o que sobra na tela — nome, domínio, instância, data da última
   * troca — só interessa a quem pode mudar. Um `ver_conexoes` seria a
   * permissão órfã com a tela morta do lado, exatamente o que o comentário de
   * `ver_fluxos` registra como pior que não separar. Há caso de teste
   * afirmando que `ver_conexoes` não existe.
   */
  | "gerenciar_conexoes";
```

Na `matriz`, `"gerenciar_conexoes"` entra **só** em `ADMIN`, no fim da lista:

```ts
  ADMIN: [
    "gerenciar_usuarios",
    "criar_lead",
    "mover_lead",
    "ver_dashboard_geral",
    "exportar_leads",
    "configurar_agente",
    "ver_documento_contato",
    "gerenciar_funil",
    "gerenciar_fluxos",
    "ver_fluxos",
    "gerenciar_conexoes",
  ],
```

`GESTOR` e `VENDEDOR` ficam **como estão**.

- [ ] **Step 4: Rodar para ver passar**

```bash
npx vitest run tests/unit/permissions.test.ts
npm run typecheck
```

Esperado: PASS nos quatro casos novos; `typecheck` sem erro.

- [ ] **Step 5: Commit**

```bash
git add src/core/auth/permissions.ts tests/unit/permissions.test.ts
git commit -m "$(cat <<'EOF'
feat(auth): gerenciar_conexoes, de ADMIN, separada das tres vizinhas

Nenhuma permissao existente serve: gerenciar_fluxos e a instancia n8n,
configurar_agente e o TEXTO do bot, gerenciar_usuarios e sobre pessoas.
Fundir com qualquer uma daria a quem faz uma coisa o poder de trocar a
credencial que responde os clientes da empresa.

Uma so, sem o par ver_/gerenciar_: o segredo nunca renderiza, entao nao
sobra nada nessa tela para um leitor fazer. A matriz ja registra, em
ver_fluxos, que separar sem motivo produz permissao orfa de um lado e
tela morta do outro -- e ha caso de teste afirmando que ver_conexoes nao
existe, para que reabrir a decisao exija justificar.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: O serviço de conexões — escopado, auditado, sem devolver segredo

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Create: `src/core/conexoes/webhook-token.ts`
- Create: `src/core/conexoes/leitura.ts`
- Create: `src/core/conexoes/service.ts`
- Modify: `src/core/audit/alerta.ts`
- Create: `tests/unit/conexoes-service.test.ts`
- Create: `tests/unit/conexoes-auditoria.test.ts`
- Create: `tests/unit/conexoes-isolamento.test.ts`
- Modify: `tests/unit/consultas-estreitas.test.ts`
- Rodar (sem modificar): `tests/unit/alerta-atividade.test.ts` — é o único arquivo que importa `ACOES_SENSIVEIS`, medido em 2026-08-20 com `grep -rln "ACOES_SENSIVEIS" tests/`, e ele **não** afirma o tamanho da lista (usa `ACOES_SENSIVEIS[0]` e `LIMITE_ALERTA`). Acrescentar entradas não o quebra; ele entra na bateria só como canário.

**Interfaces:**
- Consumes: `prismaDaEmpresa` (`@/core/tenancy/escopo`); `cifrar`, `decifrar`, `PROPOSITO_APIKEY_CONEXAO` (`@/core/cofre`, Tarefa 2); `registrarAuditoria` (`@/core/audit/log`); `ACOES_SENSIVEIS` (`@/core/audit/alerta`); o delegate `whatsappConnection` e o enum `CanalConexao` (Tarefa 1).
- Produces:
  - `webhook-token.ts`: `gerarWebhookToken(): string` (64 hex), `hashWebhookToken(token: string): string` (64 hex)
  - `leitura.ts`: `type CredencialDeConexao = { id: string; companyId: string; canal: CanalConexao; dominio: string | null; instancia: string | null; apiKey: string }`; `resolverConexaoPorWebhook(companyId: string, token: string): Promise<CredencialDeConexao | null>`; `credencialDaConexao(companyId: string, connectionId: string): Promise<CredencialDeConexao>`; `credencialAtivaUnica(companyId: string, contexto: string): Promise<CredencialDeConexao>`; `class ConexaoNaoConfiguradaError extends Error`; `class ConexaoAmbiguaError extends Error`
  - `service.ts`: `type ConexaoApresentada = { id, canal, nome, ativa, dominio, instancia, mascara, segredoAtualizadoEm, segredoAtualizadoPor }`; `listarConexoes(companyId): Promise<ConexaoApresentada[]>`; `criarConexao(companyId, dados, autorId): Promise<{ id: string; webhookToken: string }>`; `substituirSegredo(companyId, id, segredo, autorId): Promise<void>`; `atualizarConexao(companyId, id, dados, autorId): Promise<void>`; `definirAtiva(companyId, id, ativa, autorId): Promise<void>`; `regenerarWebhookToken(companyId, id, autorId): Promise<{ webhookToken: string }>`; `apagarConexao(companyId, id, autorId): Promise<void>`; `class ConexaoInvalidaError extends Error`
  - `ACOES_SENSIVEIS` passa de **10** para **14** entradas

- [ ] **Step 1: Escrever `webhook-token.ts`**

Criar `src/core/conexoes/webhook-token.ts`:

```ts
import crypto from "node:crypto";

/**
 * O token que compõe o path público do webhook, e o hash que vai para o banco.
 *
 * ## Cofre para o que precisa ser LIDO de volta; hash para o que só precisa ser CONFERIDO
 *
 * A apikey da Evolution vai para o cofre porque é USADA — viaja no header de
 * toda chamada à API dela. O token do webhook nunca é usado, só comparado;
 * guardá-lo cifrado seria dar a ele uma capacidade de que ele não precisa. Com
 * o hash, um dump do banco não entrega uma URL de webhook funcional. O desenho
 * anterior — token em texto puro no `.env` — entregava.
 *
 * ## O que se perde, dito em voz alta
 *
 * A comparação deixa de ser de tempo constante: vira busca por índice, sem
 * `timingSafeEqual` no caminho. A defesa contra adivinhação NUNCA foi a
 * comparação e sim os 256 bits de entropia — quem não adivinha o token em
 * tempo nenhum também não tira proveito de um canal lateral sobre ele. Trocar
 * "dump inútil" por isso é ganho, e está registrado como D5 do spec.
 */

/**
 * 32 bytes em hex. Hex e não base64url porque o valor vai num PATH de URL e
 * precisa sobreviver a cópia, colagem e log sem nenhuma pergunta sobre
 * codificação — `.env.example` já pedia `openssl rand -hex 32` para o token
 * atual pelo mesmo motivo.
 */
export function gerarWebhookToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * `sha256` puro, sem sal e sem custo, e as duas ausências são deliberadas.
 *
 * Sem KDF caro (bcrypt/scrypt): esses existem para segredo de BAIXA entropia,
 * onde o custo por tentativa é a defesa. Um token de 256 bits aleatórios não é
 * adivinhável em tempo nenhum, e um KDF aqui só tornaria CADA webhook recebido
 * mais lento — a Evolution manda todo tipo de evento nesta rota, não só
 * mensagem.
 *
 * Sem sal: o hash precisa ser DETERMINÍSTICO para virar busca por índice. Sal
 * exigiria varrer a tabela comparando linha a linha, que é o oposto do que uma
 * rota de webhook pode pagar.
 */
export function hashWebhookToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}
```

- [ ] **Step 2: Escrever os casos que falham (RED)**

Criar `tests/unit/conexoes-service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

const registrarAuditoriaMock = vi.fn();
vi.mock("@/core/audit/log", () => ({
  registrarAuditoria: (...a: unknown[]) => registrarAuditoriaMock(...a),
}));

/**
 * Banco falso: guarda linhas num array e implementa só o que o serviço usa —
 * mesmo espírito do banco falso de `tests/unit/escopo-empresa.test.ts`. O que
 * está sob teste aqui é a LÓGICA do serviço; o isolamento por empresa contra
 * Postgres real é `tests/unit/conexoes-isolamento.test.ts`, à parte, porque
 * são duas afirmações diferentes e uma não substitui a outra.
 *
 * O falso INJETA `companyId` no `where` e no `data`, que é exatamente o
 * contrato de `prismaDaEmpresa` — sem isso o teste estaria exercitando um
 * serviço que roda sem escopo nenhum.
 */
type Linha = Record<string, unknown>;
const linhas: Linha[] = [];

function casa(linha: Linha, where: Linha): boolean {
  return Object.entries(where).every(([chave, valor]) => linha[chave] === valor);
}

vi.mock("@/core/tenancy/escopo", () => ({
  prismaDaEmpresa: (companyId: string) => ({
    whatsappConnection: {
      findMany: async (a: { where?: Linha } = {}) =>
        linhas
          .filter((l) => casa(l, { ...(a.where ?? {}), companyId }))
          .map((l) => ({ ...l, segredoAtualizadoPor: null })),
      findFirst: async (a: { where?: Linha } = {}) =>
        linhas.find((l) => casa(l, { ...(a.where ?? {}), companyId })) ?? null,
      create: async (a: { data: Linha }) => {
        const linha = { id: `conn_${linhas.length + 1}`, ...a.data, companyId };
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
  listarConexoes,
  criarConexao,
  substituirSegredo,
  atualizarConexao,
  definirAtiva,
  regenerarWebhookToken,
  apagarConexao,
  ConexaoInvalidaError,
} from "../../src/core/conexoes/service";
import {
  resolverConexaoPorWebhook,
  credencialDaConexao,
  credencialAtivaUnica,
  ConexaoNaoConfiguradaError,
  ConexaoAmbiguaError,
} from "../../src/core/conexoes/leitura";

const EMPRESA_A = "cmp_a";
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

function criarPadrao() {
  return criarConexao(
    EMPRESA_A,
    {
      canal: "EVOLUTION",
      nome: "Comercial",
      dominio: "https://evo.exemplo.com",
      instancia: "inst-1",
      segredo: APIKEY,
    },
    AUTOR
  );
}

describe("criar conexão", () => {
  it("grava o segredo CIFRADO — a coluna não contém a apikey", async () => {
    await criarPadrao();
    expect(String(linhas[0]!.segredoCifrado)).not.toContain(APIKEY);
    expect(String(linhas[0]!.segredoCifrado)).toMatch(/^v1\./);
  });

  it("grava só os últimos 4 caracteres em claro, para a máscara", async () => {
    await criarPadrao();
    expect(linhas[0]!.segredoUltimos4).toBe("1a2b");
  });

  it("grava o HASH do token do webhook, nunca o token", async () => {
    const { webhookToken } = await criarPadrao();
    expect(linhas[0]!.webhookTokenHash).not.toBe(webhookToken);
    expect(String(linhas[0]!.webhookTokenHash)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("devolve o token do webhook UMA vez, e ele nunca volta por uma leitura", async () => {
    const { webhookToken } = await criarPadrao();
    expect(webhookToken).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(await listarConexoes(EMPRESA_A))).not.toContain(webhookToken);
  });

  it("normaliza a barra final do domínio na GRAVAÇÃO", async () => {
    // O adapter já faz `replace(/\/$/, "")` no envio; normalizar aqui evita
    // que a tela mostre uma coisa e o gateway use outra.
    await criarConexao(
      EMPRESA_A,
      { canal: "EVOLUTION", nome: "X", dominio: "https://evo.exemplo.com/", instancia: "i", segredo: APIKEY },
      AUTOR
    );
    expect(linhas[0]!.dominio).toBe("https://evo.exemplo.com");
  });

  it("recusa `META_CLOUD` com erro nomeado — Ciclo 2b, não este", async () => {
    await expect(
      criarConexao(
        EMPRESA_A,
        { canal: "META_CLOUD", nome: "Meta", dominio: null, instancia: null, segredo: APIKEY },
        AUTOR
      )
    ).rejects.toThrow(ConexaoInvalidaError);
    expect(linhas).toHaveLength(0);
  });

  it("recusa segredo curto demais para ter máscara", async () => {
    await expect(
      criarConexao(
        EMPRESA_A,
        { canal: "EVOLUTION", nome: "X", dominio: "https://e.com", instancia: "i", segredo: "abc" },
        AUTOR
      )
    ).rejects.toThrow(ConexaoInvalidaError);
  });

  it("recusa domínio que não é URL, e instância vazia", async () => {
    for (const parcial of [
      { dominio: "evo.exemplo.com", instancia: "i" },
      { dominio: "https://evo.exemplo.com", instancia: "  " },
    ]) {
      await expect(
        criarConexao(EMPRESA_A, { canal: "EVOLUTION", nome: "X", segredo: APIKEY, ...parcial }, AUTOR)
      ).rejects.toThrow(ConexaoInvalidaError);
    }
  });
});

describe("listar conexões", () => {
  it("NÃO devolve nenhuma chave que carregue segredo", async () => {
    await criarPadrao();
    const serializado = JSON.stringify(await listarConexoes(EMPRESA_A));

    // Varredura por NOME de chave E por CONTEÚDO. Só uma das duas deixaria
    // passar o caso oposto: uma chave renomeada com o blob dentro, ou uma
    // chave certa com o valor errado.
    for (const chave of ["segredoCifrado", "webhookTokenHash", "apiKey", "segredo"]) {
      expect(serializado).not.toContain(chave);
    }
    expect(serializado).not.toContain(APIKEY);
    expect(serializado).not.toContain("v1.");
  });

  it("devolve a máscara PRONTA, montada no servidor", async () => {
    await criarPadrao();
    const [conexao] = await listarConexoes(EMPRESA_A);
    // O cliente nunca deriva máscara de valor real: ela chega pronta, e os 4
    // caracteres vêm da coluna própria — nada foi decifrado para renderizar.
    expect(conexao!.mascara).toBe("••••••••1a2b");
  });
});

describe("substituir segredo", () => {
  it("troca o cifrado e a máscara, e MANTÉM o token do webhook", async () => {
    await criarPadrao();
    const hashAntes = linhas[0]!.webhookTokenHash;
    const cifradoAntes = linhas[0]!.segredoCifrado;

    await substituirSegredo(EMPRESA_A, String(linhas[0]!.id), "apikey-nova-9z8y", AUTOR);

    expect(linhas[0]!.segredoCifrado).not.toBe(cifradoAntes);
    expect(linhas[0]!.segredoUltimos4).toBe("9z8y");
    // Dois segredos, dois ciclos de vida. Invalidar os dois juntos obrigaria
    // a recolar a URL no painel da Evolution a cada rotação de chave, e o
    // custo dessa fricção é gente deixando de rotacionar.
    expect(linhas[0]!.webhookTokenHash).toBe(hashAntes);
  });

  it("conexão de outra empresa é `ConexaoInvalidaError`, não erro de banco", async () => {
    await criarPadrao();
    await expect(substituirSegredo("cmp_b", String(linhas[0]!.id), APIKEY, AUTOR)).rejects.toThrow(
      ConexaoInvalidaError
    );
  });
});

describe("regenerar o token do webhook", () => {
  it("troca o hash e devolve o token novo uma vez", async () => {
    await criarPadrao();
    const hashAntes = linhas[0]!.webhookTokenHash;
    const { webhookToken } = await regenerarWebhookToken(EMPRESA_A, String(linhas[0]!.id), AUTOR);
    expect(linhas[0]!.webhookTokenHash).not.toBe(hashAntes);
    expect(webhookToken).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("atualizar campos não secretos", () => {
  it("muda nome, domínio e instância sem tocar no segredo", async () => {
    await criarPadrao();
    const cifradoAntes = linhas[0]!.segredoCifrado;
    await atualizarConexao(
      EMPRESA_A,
      String(linhas[0]!.id),
      { nome: "Comercial 2", dominio: "https://evo2.exemplo.com", instancia: "inst-9" },
      AUTOR
    );
    expect(linhas[0]!.nome).toBe("Comercial 2");
    expect(linhas[0]!.instancia).toBe("inst-9");
    expect(linhas[0]!.segredoCifrado).toBe(cifradoAntes);
  });
});

describe("apagar", () => {
  it("apaga a linha da própria empresa", async () => {
    await criarPadrao();
    await apagarConexao(EMPRESA_A, String(linhas[0]!.id), AUTOR);
    expect(linhas).toHaveLength(0);
  });

  it("apagar conexão de outra empresa é recusado e NÃO apaga nada", async () => {
    await criarPadrao();
    await expect(apagarConexao("cmp_b", String(linhas[0]!.id), AUTOR)).rejects.toThrow(
      ConexaoInvalidaError
    );
    expect(linhas).toHaveLength(1);
  });
});

describe("leitura para o webhook e para o envio", () => {
  it("resolve a conexão pelo token e devolve a apikey DECIFRADA", async () => {
    const { webhookToken } = await criarPadrao();
    const cred = await resolverConexaoPorWebhook(EMPRESA_A, webhookToken);
    expect(cred?.apiKey).toBe(APIKEY);
    expect(cred?.instancia).toBe("inst-1");
  });

  it("token certo na empresa ERRADA devolve null", async () => {
    const { webhookToken } = await criarPadrao();
    expect(await resolverConexaoPorWebhook("cmp_b", webhookToken)).toBeNull();
  });

  it("token errado devolve null", async () => {
    await criarPadrao();
    expect(await resolverConexaoPorWebhook(EMPRESA_A, "f".repeat(64))).toBeNull();
  });

  it("conexão INATIVA não resolve o webhook — desativar cala a entrada também", async () => {
    const { webhookToken } = await criarPadrao();
    await definirAtiva(EMPRESA_A, String(linhas[0]!.id), false, AUTOR);
    expect(await resolverConexaoPorWebhook(EMPRESA_A, webhookToken)).toBeNull();
  });

  it("empresa sem conexão ativa lança `ConexaoNaoConfiguradaError` — nunca fallback", async () => {
    await expect(credencialAtivaUnica(EMPRESA_A, "a conversa cnv_9")).rejects.toThrow(
      ConexaoNaoConfiguradaError
    );
  });

  it("DUAS conexões ativas lançam `ConexaoAmbiguaError` com o contexto na mensagem", async () => {
    await criarPadrao();
    await criarConexao(
      EMPRESA_A,
      { canal: "EVOLUTION", nome: "Suporte", dominio: "https://evo.exemplo.com", instancia: "inst-2", segredo: APIKEY },
      AUTOR
    );
    // Escolher "a primeira" seria escolher em silêncio — o mesmo vazamento que
    // `Company.findFirst()` produz e que a regra do programa proíbe. Responder
    // pelo número errado é pior que não responder.
    await expect(credencialAtivaUnica(EMPRESA_A, "a conversa cnv_9")).rejects.toThrow(/cnv_9/);
    await expect(credencialAtivaUnica(EMPRESA_A, "a conversa cnv_9")).rejects.toThrow(
      ConexaoAmbiguaError
    );
  });

  it("`credencialDaConexao` de id inexistente lança `ConexaoNaoConfiguradaError`", async () => {
    await expect(credencialDaConexao(EMPRESA_A, "conn_inexistente")).rejects.toThrow(
      ConexaoNaoConfiguradaError
    );
  });
});
```

- [ ] **Step 3: Rodar para ver falhar**

```bash
npx vitest run tests/unit/conexoes-service.test.ts
```

Esperado: FAIL — `Cannot find module '../../src/core/conexoes/service'`.

- [ ] **Step 4: Escrever `leitura.ts`**

Criar `src/core/conexoes/leitura.ts`:

```ts
import "server-only";

import type { CanalConexao } from "@prisma/client";

import { prismaDaEmpresa } from "@/core/tenancy/escopo";
import { decifrar, PROPOSITO_APIKEY_CONEXAO } from "@/core/cofre";

import { hashWebhookToken } from "./webhook-token";

/**
 * As leituras que DECIFRAM — as únicas do sistema.
 *
 * Separadas de `./service.ts` de propósito: aquele arquivo serve a TELA e
 * jamais decifra; este serve o webhook e o envio, que precisam da credencial
 * de verdade para falar com a Evolution. A fronteira entre os dois é a
 * resposta a "isso pode voltar para o navegador?", e ela fica visível no
 * import em vez de depender de alguém lembrar de uma convenção.
 *
 * Nenhuma função aqui consulta o banco fora de `prismaDaEmpresa` — é o que
 * mantém a lista de exceções do lint em ZERO mesmo servindo o webhook, que
 * chega sem sessão.
 */

export class ConexaoNaoConfiguradaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ConexaoNaoConfiguradaError";
  }
}

export class ConexaoAmbiguaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ConexaoAmbiguaError";
  }
}

/**
 * Uma conexão com a credencial JÁ DECIFRADA. Este tipo nunca atravessa a
 * fronteira servidor→navegador: quem serve a tela é `ConexaoApresentada`
 * (`./service.ts`), que não tem `apiKey` nenhuma.
 */
export type CredencialDeConexao = {
  id: string;
  companyId: string;
  canal: CanalConexao;
  dominio: string | null;
  instancia: string | null;
  apiKey: string;
};

const CAMPOS = {
  id: true,
  companyId: true,
  canal: true,
  dominio: true,
  instancia: true,
  segredoCifrado: true,
} as const;

type LinhaCrua = {
  id: string;
  companyId: string;
  canal: CanalConexao;
  dominio: string | null;
  instancia: string | null;
  segredoCifrado: string;
};

function decifrarLinha(linha: LinhaCrua): CredencialDeConexao {
  const { segredoCifrado, ...resto } = linha;
  return {
    ...resto,
    // O erro do cofre sobe INTACTO. Capturá-lo aqui transformaria "a chave
    // mestra sumiu do ambiente" em "conexão não configurada", e esse sintoma
    // mandaria alguém recadastrar por cima de um segredo que continua lá.
    apiKey: decifrar(segredoCifrado, {
      companyId: linha.companyId,
      proposito: PROPOSITO_APIKEY_CONEXAO,
    }),
  };
}

/**
 * A resolução do WEBHOOK, e ela é o coração do ciclo.
 *
 * ## Como isto substitui `EVOLUTION_COMPANY_ID`
 *
 * O webhook chega sem sessão: não há de onde derivar empresa. A ponte antiga
 * (`ingest.ts`) lia uma variável de ambiente única do deploy — uma segunda
 * fonte de verdade sobre a conversa, ⚠️ R5 da auditoria do Ciclo 1a.
 *
 * Agora o `companyId` vem no PATH da rota, e ele é **hipótese, não
 * autoridade**: quem manda no resultado é o token, porque a busca é ESCOPADA.
 * O desenho é fecha-fechado, e cada linha tem caso de teste:
 *
 * - `companyId` de A + token de A → encontra. É a única combinação que passa.
 * - `companyId` de B + token de A → a busca escopada em B não acha o hash de
 *   A → `null`. **Saber o token da empresa A não dá nada na empresa B.**
 * - `companyId` inventado + token qualquer → `null`.
 *
 * Por isso um `companyId` de parâmetro aqui não viola a regra do programa. A
 * regra — "em Server Action a empresa vem de `usuarioAtual()`, nunca de
 * parâmetro" — existe porque Server Action TEM sessão, e aceitar a empresa por
 * parâmetro deixaria alguém autenticado agir na empresa alheia. Aqui não há
 * sessão nenhuma para contradizer, e o segredo é que decide.
 *
 * `findFirst` e não `findUnique`: o escopo RECUSA operação por chave única em
 * modelo de tenant (`core/tenancy/escopo.ts`, "Recusa, lançando"), e é bom que
 * recuse — um `findUnique({ where: { webhookTokenHash } })` seria escopável
 * pelo TIPO e não pela EMPRESA, devolvendo a linha de outra empresa a quem
 * soubesse o token.
 *
 * `ativa: true` faz parte do filtro: desativar uma conexão pela tela precisa
 * calar a ENTRADA também, não só a saída. Tem caso de teste.
 */
export async function resolverConexaoPorWebhook(
  companyId: string,
  token: string
): Promise<CredencialDeConexao | null> {
  const linha = await prismaDaEmpresa(companyId).whatsappConnection.findFirst({
    where: { webhookTokenHash: hashWebhookToken(token), ativa: true },
    select: CAMPOS,
  });

  return linha ? decifrarLinha(linha) : null;
}

/** A conexão de uma conversa que já sabe por onde entrou. */
export async function credencialDaConexao(
  companyId: string,
  connectionId: string
): Promise<CredencialDeConexao> {
  const linha = await prismaDaEmpresa(companyId).whatsappConnection.findFirst({
    where: { id: connectionId },
    select: CAMPOS,
  });

  if (!linha) {
    throw new ConexaoNaoConfiguradaError(
      `A conexão ${JSON.stringify(connectionId)} não existe na empresa ${JSON.stringify(companyId)}. ` +
        `Ou ela foi apagada em Configurações → Conexões, ou este id é de outra empresa.`
    );
  }

  return decifrarLinha(linha);
}

/**
 * A ÚNICA conexão ativa da empresa — para conversa criada antes do Ciclo 2a,
 * que não tem `connectionId`.
 *
 * "Nenhuma ativa" e "mais de uma ativa" são erros DIFERENTES de propósito: o
 * primeiro se resolve cadastrando, o segundo se resolve dizendo qual. Fundir
 * os dois numa mensagem obrigaria quem lesse a adivinhar qual dos dois
 * aconteceu.
 *
 * Mais de uma NUNCA escolhe "a primeira". Escolher em silêncio faria a empresa
 * responder o cliente pelo número errado — o mesmo gênero de vazamento
 * silencioso que `Company.findFirst()` produz, e que a regra do programa
 * proíbe por isso.
 */
export async function credencialAtivaUnica(
  companyId: string,
  contexto: string
): Promise<CredencialDeConexao> {
  const linhas = await prismaDaEmpresa(companyId).whatsappConnection.findMany({
    where: { ativa: true },
    select: CAMPOS,
  });

  if (linhas.length === 0) {
    throw new ConexaoNaoConfiguradaError(
      `A empresa ${JSON.stringify(companyId)} não tem nenhuma conexão de WhatsApp ativa (${contexto}). ` +
        `Cadastre uma em Configurações → Conexões. NÃO existe credencial padrão de ambiente: um ` +
        `padrão por deploy responderia clientes de uma empresa pela instância de outra, que é o ` +
        `vazamento silencioso que EVOLUTION_COMPANY_ID existia para evitar.`
    );
  }

  if (linhas.length > 1) {
    throw new ConexaoAmbiguaError(
      `A empresa ${JSON.stringify(companyId)} tem ${linhas.length} conexões ativas, e ${contexto} ` +
        `não registra por qual entrou (\`Conversation.connectionId\` nulo — conversa anterior ao ` +
        `Ciclo 2a). O envio RECUSA em vez de escolher: responder pelo número errado é pior que ` +
        `não responder. Saída: desative as conexões extras, ou defina o \`connectionId\` desta ` +
        `conversa.`
    );
  }

  return decifrarLinha(linhas[0]!);
}
```

- [ ] **Step 5: Escrever `service.ts`**

Criar `src/core/conexoes/service.ts`:

```ts
import "server-only";

import type { CanalConexao } from "@prisma/client";

import { prismaDaEmpresa } from "@/core/tenancy/escopo";
import { cifrar, PROPOSITO_APIKEY_CONEXAO } from "@/core/cofre";
import { registrarAuditoria } from "@/core/audit/log";

import { gerarWebhookToken, hashWebhookToken } from "./webhook-token";

/**
 * As escritas de conexão, e a leitura que serve a TELA.
 *
 * ## Este arquivo NUNCA decifra
 *
 * Quem decifra é `./leitura.ts`, que serve o webhook e o envio. A fronteira é
 * a resposta a "isso pode voltar para o navegador?", e ela fica visível no
 * import. Há caso de teste varrendo o retorno de `listarConexoes` por NOME de
 * chave e por CONTEÚDO — as duas metades, porque só uma deixaria passar o caso
 * oposto.
 *
 * ## Auditoria SEM `antes` e SEM `depois` — em TODA ação, sem exceção
 *
 * Precedente literal: `redefinirSenha` (`core/users/service.ts`) audita
 * `acao`/`entidade`/`entidadeId` e mais nada.
 *
 * A regra vale inclusive para `criar` e `editar`, que só mexem em campo não
 * secreto, e vale por DERIVA: um `depois` legítimo hoje vira `{ ...conexao }`
 * amanhã, e aí o blob cifrado entra junto. A regra que ninguém erra é a que
 * não tem exceção.
 *
 * Há uma segunda razão, mecânica: a varredura de escopo recusa `companyId`
 * dentro de coluna `Json`, e `AuditLog.antes`/`depois` são exatamente as
 * colunas que "Falsos positivos conhecidos" (`core/tenancy/escopo.ts`) nomeia.
 * Um instantâneo de conexão carregaria `companyId` e seria recusado pelo
 * próprio escopo.
 */

export class ConexaoInvalidaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ConexaoInvalidaError";
  }
}

/** O que a TELA recebe. Note o que NÃO está aqui: nenhum segredo, nenhum hash. */
export type ConexaoApresentada = {
  id: string;
  canal: CanalConexao;
  nome: string;
  ativa: boolean;
  dominio: string | null;
  instancia: string | null;
  /** Já pronta, montada NO SERVIDOR — o cliente nunca deriva máscara de valor real. */
  mascara: string;
  segredoAtualizadoEm: Date;
  segredoAtualizadoPor: string | null;
};

const MAX_NOME = 80;

/**
 * Mínimo do segredo. Oito, não um: abaixo disso a máscara de 4 caracteres
 * revelaria metade do valor, e uma apikey de 3 caracteres é erro de digitação
 * (colou só um pedaço), não escolha de ninguém.
 */
const MIN_SEGREDO = 8;

/**
 * Oito pontos fixos + os 4 últimos. Fixo e não proporcional: o COMPRIMENTO da
 * apikey não é informação a publicar numa tela, e uma máscara proporcional o
 * publicaria a cada renderização.
 */
function montarMascara(ultimos4: string): string {
  return `${"•".repeat(8)}${ultimos4}`;
}

function validarNome(bruto: string): string {
  const nome = bruto.trim();
  if (nome.length === 0) throw new ConexaoInvalidaError("O nome da conexão é obrigatório.");
  if (nome.length > MAX_NOME) {
    throw new ConexaoInvalidaError(`O nome pode ter no máximo ${MAX_NOME} caracteres.`);
  }
  return nome;
}

function validarSegredo(bruto: string): string {
  // Só espaço nas PONTAS é removido — é o que sobra de uma colagem e o que um
  // header HTTP não aceita. Nada no miolo é tocado: apagar caractere de dentro
  // mudaria em silêncio o segredo que a pessoa acredita ter gravado, e o
  // sintoma seria "a chave está certa e não funciona".
  const segredo = bruto.replace(/^\s+|\s+$/g, "");
  if (segredo.length < MIN_SEGREDO) {
    throw new ConexaoInvalidaError(
      `A chave precisa ter pelo menos ${MIN_SEGREDO} caracteres — a que veio tem ${segredo.length}.`
    );
  }
  return segredo;
}

/**
 * Evolution exige domínio (URL) e instância. `META_CLOUD` é RECUSADO aqui: o
 * valor existe no enum para o Ciclo 2b não precisar de migração de enum
 * (mesmo motivo de `WhatsappAutor.HUMANO`), e recusar na escrita é o que
 * impede uma linha nascer com campos que nenhum gateway sabe usar.
 */
function validarCampos(
  canal: CanalConexao,
  dominio: string | null,
  instancia: string | null
): { dominio: string; instancia: string } {
  if (canal !== "EVOLUTION") {
    throw new ConexaoInvalidaError(
      `O canal ${canal} ainda não é atendido por este CRM — a Meta Cloud API é o Ciclo 2b.`
    );
  }

  const url = (dominio ?? "").trim();
  if (!/^https?:\/\/[^\s/]+/.test(url)) {
    throw new ConexaoInvalidaError(
      `O domínio precisa ser uma URL começando com http:// ou https:// (recebido: ${JSON.stringify(url)}).`
    );
  }

  const inst = (instancia ?? "").trim();
  if (inst.length === 0) {
    throw new ConexaoInvalidaError(
      "O nome da instância é obrigatório — é ele que o webhook confere contra o campo `instance` " +
        "de cada evento recebido."
    );
  }

  // Barra no fim produziria `//message/sendText` no envio. O adapter já apara
  // (`replace(/\/$/, "")`), mas aparar na GRAVAÇÃO evita que a tela mostre uma
  // coisa e o gateway use outra.
  return { dominio: url.replace(/\/$/, ""), instancia: inst };
}

/** Todo caminho de escrita passa por aqui: a linha existe E é desta empresa. */
async function exigirConexaoDaEmpresa(companyId: string, id: string): Promise<string> {
  const linha = await prismaDaEmpresa(companyId).whatsappConnection.findFirst({
    where: { id },
    select: { id: true },
  });
  if (!linha) {
    // Mesma mensagem para "não existe" e "é de outra empresa", de propósito:
    // distinguir confirmaria, a quem sonda ids, que aquele cuid pertence a
    // alguém. É a política de `redefinirSenha`, palavra por palavra.
    throw new ConexaoInvalidaError("Conexão não encontrada.");
  }
  return linha.id;
}

export async function listarConexoes(companyId: string): Promise<ConexaoApresentada[]> {
  const linhas = await prismaDaEmpresa(companyId).whatsappConnection.findMany({
    // `select` explícito, nunca a linha inteira: o padrão do Prisma é devolver
    // TUDO, e um campo novo no schema entraria neste retorno sem ninguém pedir
    // — inclusive `segredoCifrado`.
    select: {
      id: true,
      canal: true,
      nome: true,
      ativa: true,
      dominio: true,
      instancia: true,
      segredoUltimos4: true,
      segredoAtualizadoEm: true,
      segredoAtualizadoPor: { select: { nome: true } },
    },
    orderBy: { criadoEm: "asc" },
  });

  return linhas.map((l) => ({
    id: l.id,
    canal: l.canal,
    nome: l.nome,
    ativa: l.ativa,
    dominio: l.dominio,
    instancia: l.instancia,
    mascara: montarMascara(l.segredoUltimos4),
    segredoAtualizadoEm: l.segredoAtualizadoEm,
    segredoAtualizadoPor: l.segredoAtualizadoPor?.nome ?? null,
  }));
}

export async function criarConexao(
  companyId: string,
  dados: {
    canal: CanalConexao;
    nome: string;
    dominio: string | null;
    instancia: string | null;
    segredo: string;
  },
  autorId: string
): Promise<{ id: string; webhookToken: string }> {
  const nome = validarNome(dados.nome);
  const segredo = validarSegredo(dados.segredo);
  const campos = validarCampos(dados.canal, dados.dominio, dados.instancia);

  // Gerado AQUI, no servidor, e devolvido UMA vez. É a única exceção nomeada à
  // regra "o segredo nunca volta para o navegador", e ela não é brecha: este
  // caminho não DECIFRA nada — entrega um valor que o servidor acabou de
  // sortear e guarda só o hash dele. Sem isso não haveria como a pessoa colar
  // a URL no painel da Evolution.
  const webhookToken = gerarWebhookToken();

  const linha = await prismaDaEmpresa(companyId).whatsappConnection.create({
    data: {
      companyId,
      canal: dados.canal,
      nome,
      dominio: campos.dominio,
      instancia: campos.instancia,
      segredoCifrado: cifrar(segredo, { companyId, proposito: PROPOSITO_APIKEY_CONEXAO }),
      segredoUltimos4: segredo.slice(-4),
      segredoAtualizadoEm: new Date(),
      segredoAtualizadoPorId: autorId,
      webhookTokenHash: hashWebhookToken(webhookToken),
    },
    select: { id: true },
  });

  await auditar(companyId, autorId, "criar_conexao", linha.id);

  return { id: linha.id, webhookToken };
}

export async function substituirSegredo(
  companyId: string,
  id: string,
  segredoBruto: string,
  autorId: string
): Promise<void> {
  const alvo = await exigirConexaoDaEmpresa(companyId, id);
  const segredo = validarSegredo(segredoBruto);

  await prismaDaEmpresa(companyId).whatsappConnection.updateMany({
    where: { id: alvo },
    data: {
      segredoCifrado: cifrar(segredo, { companyId, proposito: PROPOSITO_APIKEY_CONEXAO }),
      segredoUltimos4: segredo.slice(-4),
      segredoAtualizadoEm: new Date(),
      segredoAtualizadoPorId: autorId,
    },
  });

  // O token do webhook NÃO é tocado, e há caso de teste para isso. São dois
  // segredos com ciclos de vida independentes: invalidar os dois juntos
  // obrigaria a recolar a URL no painel da Evolution a cada rotação de chave,
  // e o custo dessa fricção é gente deixando de rotacionar.
  await auditar(companyId, autorId, "substituir_segredo_conexao", alvo);
}

export async function atualizarConexao(
  companyId: string,
  id: string,
  dados: { nome: string; dominio: string | null; instancia: string | null },
  autorId: string
): Promise<void> {
  const alvo = await exigirConexaoDaEmpresa(companyId, id);
  const nome = validarNome(dados.nome);
  const campos = validarCampos("EVOLUTION", dados.dominio, dados.instancia);

  await prismaDaEmpresa(companyId).whatsappConnection.updateMany({
    where: { id: alvo },
    data: { nome, dominio: campos.dominio, instancia: campos.instancia },
  });

  await auditar(companyId, autorId, "editar_conexao", alvo);
}

export async function definirAtiva(
  companyId: string,
  id: string,
  ativa: boolean,
  autorId: string
): Promise<void> {
  const alvo = await exigirConexaoDaEmpresa(companyId, id);

  await prismaDaEmpresa(companyId).whatsappConnection.updateMany({
    where: { id: alvo },
    data: { ativa },
  });

  await auditar(companyId, autorId, ativa ? "ativar_conexao" : "desativar_conexao", alvo);
}

export async function regenerarWebhookToken(
  companyId: string,
  id: string,
  autorId: string
): Promise<{ webhookToken: string }> {
  const alvo = await exigirConexaoDaEmpresa(companyId, id);
  const webhookToken = gerarWebhookToken();

  await prismaDaEmpresa(companyId).whatsappConnection.updateMany({
    where: { id: alvo },
    data: { webhookTokenHash: hashWebhookToken(webhookToken) },
  });

  await auditar(companyId, autorId, "regenerar_webhook_conexao", alvo);

  return { webhookToken };
}

export async function apagarConexao(
  companyId: string,
  id: string,
  autorId: string
): Promise<void> {
  const alvo = await exigirConexaoDaEmpresa(companyId, id);

  await prismaDaEmpresa(companyId).whatsappConnection.deleteMany({ where: { id: alvo } });

  // `Conversation.connectionId` tem `ON DELETE SET NULL` (Tarefa 1): apagar a
  // conexão não apaga histórico de conversa, só desliga o vínculo. A conversa
  // órfã cai no caminho de `credencialAtivaUnica`, que RECUSA se houver mais
  // de uma ativa em vez de escolher.
  await auditar(companyId, autorId, "apagar_conexao", alvo);
}

/**
 * Um ponto só de auditoria, e ele NÃO aceita `antes`/`depois`. Não é
 * conveniência: é a forma de a regra não ter como ser burlada por descuido —
 * quem quisesse gravar um instantâneo teria de mudar esta assinatura, e a
 * mudança apareceria na revisão em vez de escorregar num spread.
 */
async function auditar(
  companyId: string,
  userId: string,
  acao: string,
  entidadeId: string
): Promise<void> {
  await registrarAuditoria({
    companyId,
    userId,
    acao,
    entidade: "WhatsappConnection",
    entidadeId,
  });
}
```

- [ ] **Step 6: Rodar para ver passar**

```bash
npx vitest run tests/unit/conexoes-service.test.ts
```

Esperado: PASS, 21 casos.

- [ ] **Step 7: Escrever o caso da auditoria (RED)**

Criar `tests/unit/conexoes-auditoria.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

const registrarAuditoriaMock = vi.fn();
vi.mock("@/core/audit/log", () => ({
  registrarAuditoria: (...a: unknown[]) => registrarAuditoriaMock(...a),
}));

type Linha = Record<string, unknown>;
const linhas: Linha[] = [];
function casa(l: Linha, w: Linha) {
  return Object.entries(w).every(([k, v]) => l[k] === v);
}

vi.mock("@/core/tenancy/escopo", () => ({
  prismaDaEmpresa: (companyId: string) => ({
    whatsappConnection: {
      findMany: async (a: { where?: Linha } = {}) =>
        linhas.filter((l) => casa(l, { ...(a.where ?? {}), companyId })),
      findFirst: async (a: { where?: Linha } = {}) =>
        linhas.find((l) => casa(l, { ...(a.where ?? {}), companyId })) ?? null,
      create: async (a: { data: Linha }) => {
        const linha = { id: `conn_${linhas.length + 1}`, ...a.data, companyId };
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
    await atualizarConexao(EMPRESA, id, { nome: "C2", dominio: "https://e2.com", instancia: "i2" }, AUTOR);
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
```

- [ ] **Step 8: Rodar para ver falhar**

```bash
npx vitest run tests/unit/conexoes-auditoria.test.ts
```

Esperado: FAIL no penúltimo caso — `ACOES_SENSIVEIS` ainda não tem as quatro. Os demais já passam e ficam como trava.

- [ ] **Step 9: Acrescentar as quatro ações sensíveis**

Em `src/core/audit/alerta.ts`, dentro de `ACOES_SENSIVEIS`, acrescentar antes do `] as const;`:

```ts
  "substituir_segredo_conexao",
  "desativar_conexao",
  "apagar_conexao",
  "regenerar_webhook_conexao",
```

E, ao fim do bloco de comentário de `ACOES_SENSIVEIS`, acrescentar:

```
 * As quatro de CONEXÃO (Ciclo 2a) entram pelo mesmo critério das de fluxo, e
 * cada uma por um motivo próprio:
 *
 * - `apagar_conexao` e `desativar_conexao` derrubam o atendimento de WhatsApp
 *   da empresa inteira — é o par de `apagar_fluxo`/`desativar_fluxo`.
 * - `regenerar_webhook_conexao` corta a ENTRADA de mensagens até alguém
 *   recolar a URL no painel da Evolution. O efeito é o de desativar, com o
 *   agravante de a tela continuar dizendo "Ativa" — o que torna a detecção
 *   mais valiosa aqui, não menos.
 * - `substituir_segredo_conexao` é tomada de canal: quem troca a apikey passa
 *   a responder os clientes daquela empresa pela instância que ele controlar.
 *   Mesma família de `redefinir_senha`, e por isso está ao lado dela.
 *
 * `criar_conexao` e `editar_conexao` ficam de fora, junto com o trabalho
 * normal. `ativar_conexao` fica de fora pelo mesmo motivo de `ativar_fluxo`:
 * religar é reparo, não estrago.
```

```bash
npx vitest run tests/unit/conexoes-auditoria.test.ts tests/unit/alerta-atividade.test.ts
```

Esperado: os dois verdes, e `tests/unit/alerta-atividade.test.ts` **sem
alteração nenhuma** — ele usa `ACOES_SENSIVEIS[0]` e `LIMITE_ALERTA`, nunca o
tamanho da lista (medido em 2026-08-20). Se ele ficar vermelho, algo além do
acréscimo mudou: **pare e reporte**.

- [ ] **Step 10: Registrar a relação nova no inventário de consultas estreitas**

`tests/unit/consultas-estreitas.test.ts` mantém `RELACOES_SENSIVEIS`, um mapa
de "campo de relação → tabela com dado sensível do outro lado", e o comentário
dele diz, textualmente, que **uma relação que falta é um buraco silencioso na
regra** porque o teste não tem como descobri-la sozinho.

`WhatsappConnection.segredoAtualizadoPor` é uma relação para `User` — a tabela
que carrega `senhaHash`. `listarConexoes` (Step 5) já a consome do jeito certo
(`{ select: { nome: true } }`, nunca `: true`), então **este passo não conserta
bug nenhum hoje**: ele registra a relação para que o dia em que alguém escrever
`segredoAtualizadoPor: true` seja vermelho em vez de silencioso.

Em `tests/unit/consultas-estreitas.test.ts`, dentro de `RELACOES_SENSIVEIS`,
acrescentar:

```ts
  segredoAtualizadoPor: "User (senhaHash)",
```

```bash
npx vitest run tests/unit/consultas-estreitas.test.ts
```

Esperado: verde. Se ficar vermelho, algum `select` do Ciclo 2a está puxando a
relação inteira — conserte o `select`, **não** a entrada do mapa.

- [ ] **Step 11: Escrever o isolamento contra Postgres real**

Criar `tests/unit/conexoes-isolamento.test.ts`:

```ts
// Toca o Postgres real, então carrega DATABASE_URL do .env aqui — não em
// vitest.config.ts — para não injetar credenciais em testes que não tocam
// banco. Precisa ser o primeiro import.
import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import { cifrar, PROPOSITO_APIKEY_CONEXAO } from "../../src/core/cofre";
import { hashWebhookToken } from "../../src/core/conexoes/webhook-token";
import { resolverConexaoPorWebhook } from "../../src/core/conexoes/leitura";

/**
 * As duas metades, no formato dos `*-isolamento.test.ts` do Ciclo 1d: a
 * consulta ESCOPADA não atravessa a fronteira, e uma SONDA afirma que a
 * consulta sem escopo atravessaria. Sem a sonda, "não vazou" poderia ser
 * coincidência do dado.
 *
 * Prefixo exclusivo deste arquivo, e a limpeza apaga POR ELE: o banco é o
 * mesmo de desenvolvimento (⚠️ R1 da auditoria do Ciclo 1a), e fixture que não
 * limpa envenena a execução seguinte — já foi medido acontecendo.
 */
const MARCA = "ZZTesteConexao2a";
const TOKEN_A = "a".repeat(64);
const APIKEY_A = "apikey-da-empresa-a-1a2b";

let empresaA: string;
let empresaB: string;

const chaveOriginal = process.env.COFRE_CHAVE_MESTRA;

async function limpar() {
  const empresas = await prisma.company.findMany({
    where: { nome: { startsWith: MARCA } },
    select: { id: true },
  });
  const ids = empresas.map((e) => e.id);
  if (ids.length === 0) return;
  await prisma.whatsappConnection.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.company.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  process.env.COFRE_CHAVE_MESTRA = Buffer.alloc(32, 3).toString("base64");
  await limpar();

  const a = await prisma.company.create({ data: { nome: `${MARCA}-A` } });
  const b = await prisma.company.create({ data: { nome: `${MARCA}-B` } });
  empresaA = a.id;
  empresaB = b.id;

  await prisma.whatsappConnection.create({
    data: {
      companyId: a.id,
      canal: "EVOLUTION",
      nome: "A",
      dominio: "https://evo-a.exemplo.com",
      instancia: `${MARCA}-inst-a`,
      segredoCifrado: cifrar(APIKEY_A, { companyId: a.id, proposito: PROPOSITO_APIKEY_CONEXAO }),
      segredoUltimos4: APIKEY_A.slice(-4),
      segredoAtualizadoEm: new Date(),
      webhookTokenHash: hashWebhookToken(TOKEN_A),
    },
  });
});

afterAll(async () => {
  await limpar();
  if (chaveOriginal === undefined) delete process.env.COFRE_CHAVE_MESTRA;
  else process.env.COFRE_CHAVE_MESTRA = chaveOriginal;
});

describe("resolução do webhook contra Postgres real", () => {
  it("a empresa A resolve o próprio token e recebe a apikey decifrada", async () => {
    const cred = await resolverConexaoPorWebhook(empresaA, TOKEN_A);
    expect(cred?.companyId).toBe(empresaA);
    expect(cred?.apiKey).toBe(APIKEY_A);
  });

  it("o MESMO token na empresa B devolve null — saber o token de A não dá nada em B", async () => {
    expect(await resolverConexaoPorWebhook(empresaB, TOKEN_A)).toBeNull();
  });

  it("SONDA: a mesma busca SEM escopo acharia a linha de A a partir de B", async () => {
    // Sem esta sonda, o caso acima poderia estar verde por não haver linha
    // nenhuma. Ela prova que o dado ESTÁ lá e que é o escopo que o esconde.
    const semEscopo = await prisma.whatsappConnection.findFirst({
      where: { webhookTokenHash: hashWebhookToken(TOKEN_A) },
      select: { companyId: true },
    });
    expect(semEscopo?.companyId).toBe(empresaA);
    expect(semEscopo?.companyId).not.toBe(empresaB);
  });

  it("a coluna gravada no Postgres NÃO contém a apikey em texto", async () => {
    const linha = await prisma.whatsappConnection.findFirst({
      where: { companyId: empresaA },
      select: { segredoCifrado: true },
    });
    expect(linha?.segredoCifrado).not.toContain(APIKEY_A);
    expect(linha?.segredoCifrado).toMatch(/^v1\./);
  });
});
```

- [ ] **Step 12: Rodar tudo e commitar**

```bash
npx vitest run tests/unit/conexoes-service.test.ts tests/unit/conexoes-auditoria.test.ts tests/unit/conexoes-isolamento.test.ts tests/unit/alerta-atividade.test.ts tests/unit/consultas-estreitas.test.ts tests/unit/catraca-prisma-cru.test.ts
npm run typecheck
npm run lint
```

Esperado: todos verdes, e a catraca ainda em `LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS = 0`. Se ela reclamar de `src/core/conexoes/*`, algum arquivo importou `@/lib/prisma` — isso é **bug desta tarefa**, não exceção a acrescentar: **pare e reporte**. Cole as saídas.

```bash
git add src/core/conexoes src/core/audit/alerta.ts tests/unit/conexoes-service.test.ts tests/unit/conexoes-auditoria.test.ts tests/unit/conexoes-isolamento.test.ts tests/unit/consultas-estreitas.test.ts
git commit -m "$(cat <<'EOF'
feat(conexoes): CRUD escopado que cifra ao gravar e nunca devolve o segredo

Dois arquivos e nao um, e a fronteira entre eles e a pergunta "isso pode
voltar para o navegador?": service.ts serve a TELA e jamais decifra;
leitura.ts serve o webhook e o envio, e e o unico lugar do sistema que
decifra. A separacao fica visivel no import, nao numa convencao.

resolverConexaoPorWebhook e o que vai matar EVOLUTION_COMPANY_ID: o
companyId chega pelo path e e HIPOTESE, nao autoridade -- quem decide e o
token, porque a busca e escopada. Token de A com companyId de B nao acha
nada, e por isso a resolucao do webhook nao precisou de excecao no lint.

Auditoria sem antes/depois em TODA acao, inclusive nas que so mexem em
campo nao secreto: um `depois` legitimo hoje vira `{ ...conexao }`
amanha, e ai o blob entra junto. Precedente literal: redefinirSenha.

Nenhuma resolucao escolhe "a primeira" conexao: duas ativas RECUSAM, com
o contexto na mensagem. Responder pelo numero errado e pior que nao
responder.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: A fábrica de gateway por conexão (EXPANDE — o singleton continua intacto)

**DEPENDE DE AÇÃO DO DONO:** não.

> **Esta tarefa não remove nada.** A troca é *expande → migra → contrai*: a
> fábrica nasce ao lado do `whatsappGateway` antigo (Tarefa 6), os dois
> caminhos migram (7 e 8), a tela nasce (9), e só então o antigo morre (10).
> Fazer tudo de uma vez deixaria pelo menos uma tarefa com `typecheck`
> vermelho, e cada tarefa deste plano é executada por um subagente que só vê a
> própria tarefa.

**Files:**
- Create: `src/modules/whatsapp/gateway/fabrica.ts`
- Create: `tests/unit/whatsapp-gateway-fabrica.test.ts`

**Interfaces:**
- Consumes: `WhatsappGateway` (`./tipos`); `EvolutionGateway` e `EvolutionGatewayConfig` (`./evolution`, **sem alteração** — ele já recebe `{ domain, instance, apiKey }` pelo construtor); `CredencialDeConexao`, `credencialDaConexao`, `credencialAtivaUnica` (`@/core/conexoes/leitura`, Tarefa 5).
- Produces:
  - `class CanalNaoImplementadoError extends Error`
  - `function gatewayDaCredencial(credencial: CredencialDeConexao): WhatsappGateway`
  - `async function gatewayDaEmpresa(companyId: string, contexto: string): Promise<WhatsappGateway>`
  - `async function gatewayDaConversa(companyId: string, conversa: { id: string; connectionId: string | null }): Promise<WhatsappGateway>`
- Consumida por: Tarefa 7 (`gatewayDaCredencial`, na rota do webhook) e Tarefa 8 (`gatewayDaConversa`, em `turno.ts` e `agente.ts`).

- [ ] **Step 1: Escrever os casos que falham (RED)**

Criar `tests/unit/whatsapp-gateway-fabrica.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

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
} from "../../src/modules/whatsapp/gateway/fabrica";
import { EvolutionGateway } from "../../src/modules/whatsapp/gateway/evolution";

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
});

describe("gatewayDaEmpresa", () => {
  it("resolve pela única conexão ativa da empresa", async () => {
    credencialAtivaUnicaMock.mockResolvedValue(CRED);
    const gateway = await gatewayDaEmpresa("cmp_a", "um teste");
    expect(credencialAtivaUnicaMock).toHaveBeenCalledWith("cmp_a", "um teste");
    expect(gateway).toBeInstanceOf(EvolutionGateway);
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

  it("o módulo não tem binding mutável nem coleção em escopo de módulo", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync("src/modules/whatsapp/gateway/fabrica.ts", "utf8").replace(
      /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
      ""
    );
    // Mesma varredura de `tests/unit/config-leitura.test.ts`: sem ela, a frase
    // acima seria prosa, e um `Map` por empresa passaria em todos os outros
    // casos deste arquivo.
    for (const proibido of [/^let\s/m, /^var\s/m, /new Map\(/, /new Set\(/, /globalThis/]) {
      expect(fonte).not.toMatch(proibido);
    }
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/whatsapp-gateway-fabrica.test.ts
```

Esperado: FAIL — `Cannot find module '../../src/modules/whatsapp/gateway/fabrica'`.

- [ ] **Step 3: Escrever `fabrica.ts`**

Criar `src/modules/whatsapp/gateway/fabrica.ts`:

```ts
import "server-only";

import {
  credencialDaConexao,
  credencialAtivaUnica,
  type CredencialDeConexao,
} from "@/core/conexoes/leitura";

import { EvolutionGateway } from "./evolution";
import type { WhatsappGateway } from "./tipos";

/**
 * De onde sai um gateway agora que a credencial vive no BANCO, por empresa.
 *
 * ## Por que o singleton não serve mais
 *
 * `whatsappGateway` (`./index.ts`) é um objeto por PROCESSO com uma credencial
 * só, lida de `EVOLUTION_*`. Um processo serve várias empresas — e uma empresa
 * pode ter mais de uma conexão (multi-instância é decisão travada do
 * programa). Um singleton nesse mundo é a credencial da empresa A respondendo
 * pelo cliente da B.
 *
 * ## Nada aqui é memoizado, e isso é a decisão, não o esquecimento
 *
 * Um `Map<companyId, WhatsappGateway>` em escopo de módulo economizaria uma
 * consulta e reintroduziria exatamente o estado global que o programa proíbe:
 * ele sobrevive entre requisições e o modo de falha é servir a credencial
 * errada depois de a conexão ter sido substituída pela tela. O custo de não
 * memoizar é uma consulta e uma decifragem AES-GCM sobre ~40 bytes por
 * mensagem enviada. Há dois casos de teste travando isso — um conta as
 * consultas, outro varre o FONTE deste arquivo atrás de `let`/`Map`/`Set`/
 * `globalThis`, porque sem ele a frase seria só prosa.
 *
 * ## Este arquivo mora em `modules/`, e importa de `core/`
 *
 * Direção permitida pela fronteira do `eslint.config.mjs` (`modules` → `core`,
 * nunca o contrário). O cofre e a tabela de conexões são de `core` porque a
 * tela de Configurações não é um módulo opcional; o adaptador de protocolo é
 * de `modules` porque WhatsApp é.
 */
export class CanalNaoImplementadoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "CanalNaoImplementadoError";
  }
}

/**
 * O único ponto do sistema que decide QUAL adaptador atende um canal.
 *
 * `EvolutionGateway` não mudou nem uma linha por causa deste ciclo: ele já
 * recebia `{ domain, instance, apiKey }` pelo construtor e nunca leu
 * `process.env` — o comentário dele registra isso desde a Fatia 1 ("recebe a
 * configuração já validada pelo construtor"). O que mudou foi de ONDE esses
 * três valores vêm.
 */
export function gatewayDaCredencial(credencial: CredencialDeConexao): WhatsappGateway {
  if (credencial.canal !== "EVOLUTION") {
    // Recusa NOMEADA, e ela existe para que o Ciclo 2b troque este ramo por
    // uma implementação em vez de acrescentar um `else` a um `if` que cairia
    // silenciosamente no Evolution. Tem caso de teste.
    throw new CanalNaoImplementadoError(
      `A conexão ${JSON.stringify(credencial.id)} é do canal ${credencial.canal}, que este CRM ` +
        `ainda não atende — a Meta Cloud API é o Ciclo 2b. O valor existe no enum para que aquele ` +
        `ciclo não precise de uma migração de enum.`
    );
  }

  // O serviço valida os dois na escrita (`core/conexoes/service.ts`), mas uma
  // linha editada por SQL à mão chega aqui. Sem esta guarda, `null` viraria a
  // string "null" dentro da URL de envio e a falha apareceria como um HTTP 404
  // da Evolution, que não aponta para a causa.
  if (!credencial.dominio || !credencial.instancia) {
    throw new CanalNaoImplementadoError(
      `A conexão ${JSON.stringify(credencial.id)} é Evolution mas está sem ` +
        `${!credencial.dominio ? "domínio" : "instância"}. Corrija em Configurações → Conexões.`
    );
  }

  return new EvolutionGateway({
    domain: credencial.dominio,
    instance: credencial.instancia,
    apiKey: credencial.apiKey,
  });
}

/**
 * O gateway de uma CONVERSA — é este que o envio usa.
 *
 * `connectionId` preenchido é o caso de toda conversa criada a partir do Ciclo
 * 2a: a ingestão grava por qual conexão a mensagem entrou, e a resposta sai
 * pela mesma. Sem isso, "multi-instância" seria mentira — com duas conexões na
 * mesma empresa, responder pela "primeira" é responder pelo número errado.
 *
 * `connectionId` nulo é conversa anterior ao ciclo. Ela cai em
 * `credencialAtivaUnica`, que RECUSA quando há mais de uma ativa. O
 * `conversationId` viaja no contexto porque é ele que transforma o erro em
 * algo acionável: sem ele, o log diria "conexão ambígua" e ninguém saberia
 * qual conversa ficou sem resposta.
 */
export async function gatewayDaConversa(
  companyId: string,
  conversa: { id: string; connectionId: string | null }
): Promise<WhatsappGateway> {
  const credencial = conversa.connectionId
    ? await credencialDaConexao(companyId, conversa.connectionId)
    : await credencialAtivaUnica(companyId, `a conversa ${conversa.id}`);

  return gatewayDaCredencial(credencial);
}

/**
 * O gateway de uma EMPRESA, quando não há conversa envolvida.
 *
 * `contexto` é obrigatório e não tem padrão: ele é o que entra na mensagem de
 * `ConexaoNaoConfiguradaError`/`ConexaoAmbiguaError`, e um padrão genérico
 * ("uso desconhecido") produziria exatamente o erro que não ajuda ninguém.
 */
export async function gatewayDaEmpresa(
  companyId: string,
  contexto: string
): Promise<WhatsappGateway> {
  return gatewayDaCredencial(await credencialAtivaUnica(companyId, contexto));
}
```

- [ ] **Step 4: Rodar para ver passar**

```bash
npx vitest run tests/unit/whatsapp-gateway-fabrica.test.ts
npm run typecheck
npm run lint
```

Esperado: PASS nos 9 casos; `typecheck` e `lint` sem erro. O `whatsappGateway` antigo continua existindo e nada quebrou.

- [ ] **Step 5: Commit**

```bash
git add src/modules/whatsapp/gateway/fabrica.ts tests/unit/whatsapp-gateway-fabrica.test.ts
git commit -m "$(cat <<'EOF'
feat(gateway): fabrica por conexao, ao lado do singleton que ainda vive

Um singleton por processo carrega UMA credencial, e um processo serve
varias empresas -- e uma empresa pode ter mais de uma conexao. Nesse
mundo o singleton e a credencial da empresa A respondendo o cliente da B.

Nada e memoizado: um Map por empresa seria o estado global que o programa
proibe, e o modo de falha e servir credencial velha depois de a conexao
ter sido substituida pela tela. Dois casos travam isso -- um conta as
consultas, outro varre o FONTE atras de let/Map/Set/globalThis, porque
sem ele a frase seria so prosa.

EvolutionGateway nao mudou uma linha: ele ja recebia dominio, instancia e
apikey pelo construtor desde a Fatia 1. Mudou de onde os tres vem.

Adiciona sem remover, de proposito: as Tarefas 7 e 8 migram os dois
caminhos e a 10 contrai. Tudo de uma vez deixaria alguma tarefa com o
typecheck vermelho, e cada tarefa e executada por um subagente que so ve
a propria.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: O webhook resolve a empresa pela CONEXÃO — `EVOLUTION_COMPANY_ID` morre

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Create: `src/app/api/whatsapp/evolution/[companyId]/[token]/route.ts`
- Delete: `src/app/api/whatsapp/evolution/[token]/route.ts`
- Modify: `src/modules/whatsapp/ingest.ts`
- Modify: `tests/unit/whatsapp-webhook-route.test.ts`
- Modify: `tests/unit/whatsapp-ingest.test.ts`

**Interfaces:**
- Consumes: `resolverConexaoPorWebhook` e `CredencialDeConexao` (`@/core/conexoes/leitura`, Tarefa 5); `gatewayDaCredencial` (`@/modules/whatsapp/gateway/fabrica`, Tarefa 6); `Conversation.connectionId` (Tarefa 1); `checarRateLimit`, `obterIpDaRequisicao`, `publicarTurno` — inalterados.
- Produces:
  - a rota `POST /api/whatsapp/evolution/[companyId]/[token]`
  - `ingerirMensagem(evento: EventoWhatsapp, contexto: { companyId: string; connectionId: string }): Promise<ResultadoIngestao>` — **a assinatura muda**, e `ResultadoIngestao` ganha `connectionId: string`
  - `obterEvolutionCompanyId` **deixa de existir**, e com ela a leitura de `EVOLUTION_COMPANY_ID`
- Consumida por: Tarefa 8 (que lê `Conversation.connectionId` gravado aqui).

- [ ] **Step 1: Escrever o caso de ingestão que falha (RED)**

Em `tests/unit/whatsapp-ingest.test.ts`, todas as chamadas de `ingerirMensagem(evento)` passam a `ingerirMensagem(evento, { companyId: EMPRESA, connectionId: "conn_1" })` — troque o `EMPRESA` pelo identificador que o arquivo já usa. E acrescentar, no fim:

```ts
describe("a conversa registra por qual conexão entrou (Ciclo 2a)", () => {
  it("`Conversation.connectionId` é gravado com a conexão que resolveu o webhook", async () => {
    // Sem isto, multi-instância seria mentira: a resposta sairia por "alguma"
    // conexão da empresa, e com duas cadastradas o cliente receberia resposta
    // de um número que nunca falou com ele.
    const resultado = await ingerirMensagem(eventoBase(), {
      companyId: EMPRESA,
      connectionId: "conn_1",
    });
    expect(resultado.connectionId).toBe("conn_1");

    const conversa = await prisma.conversation.findFirst({
      where: { waId: eventoBase().waId },
      select: { connectionId: true, companyId: true },
    });
    expect(conversa?.connectionId).toBe("conn_1");
    expect(conversa?.companyId).toBe(EMPRESA);
  });

  it("`ingest.ts` não menciona `EVOLUTION_COMPANY_ID` em lugar nenhum", async () => {
    const { readFileSync } = await import("node:fs");
    // A ponte que o Ciclo 1a criou dizendo "o Ciclo 2 remove" — ⚠️ R5 da
    // auditoria daquele ciclo. Este caso é o que impede ela de voltar por um
    // "só enquanto isso".
    expect(readFileSync("src/modules/whatsapp/ingest.ts", "utf8")).not.toContain(
      "EVOLUTION_COMPANY_ID"
    );
  });
});
```

> `eventoBase()` e `EMPRESA` são os nomes que o arquivo já usa para a fixture de evento e o id de empresa. Se ele usar outros, use os dele — **não crie fixture nova**.

- [ ] **Step 2: Rodar para ver falhar**

```bash
npx vitest run tests/unit/whatsapp-ingest.test.ts
```

Esperado: FAIL — `ingerirMensagem` aceita um argumento só, e `resultado.connectionId` não existe.

- [ ] **Step 3: Reescrever a resolução de empresa em `ingest.ts`**

Em `src/modules/whatsapp/ingest.ts`:

**a)** Apagar a função `obterEvolutionCompanyId` **inteira**, com o JSDoc dela.

**b)** `ResultadoIngestao` passa a:

```ts
export interface ResultadoIngestao {
  /**
   * A empresa dona da conversa. Desde o Ciclo 2a ela vem da CONEXÃO que
   * resolveu o webhook, não de uma variável de ambiente do deploy.
   *
   * Devolvido porque o job de turno precisa dele: `turno.ts` alcança o banco só
   * por `prismaDaEmpresa(companyId)`, e a primeira coisa que ele faz é um
   * `$queryRaw` (o lease), que o escopo NÃO alcança e que portanto precisa do
   * `companyId` escrito à mão no `WHERE`.
   */
  companyId: string;
  /** A conexão por onde a mensagem entrou — é por ela que a resposta sai. */
  connectionId: string;
  conversationId: string;
  /** `bufferSeq` DEPOIS desta mensagem — o `seq` que o job de fila deve carregar. */
  bufferSeq: number;
  /** `true` quando `evento.idExterno` já tinha sido gravado antes (redelivery do webhook) — nada foi criado/incrementado. */
  duplicada: boolean;
}
```

**c)** A assinatura e o começo do corpo:

```ts
/**
 * O CONTEXTO da ingestão: quem é a empresa e por qual conexão a mensagem
 * entrou. Os dois vêm da MESMA linha de `WhatsappConnection`, resolvida pela
 * rota do webhook a partir do token do path.
 *
 * ## O que morreu aqui, e por quê
 *
 * Até o Ciclo 2a a empresa saía de `EVOLUTION_COMPANY_ID` — uma constante do
 * DEPLOY. Ela existia porque o payload da Evolution não carrega sinal nenhum
 * de empresa, e o comentário dela dizia, textualmente, "no Ciclo 2 cada
 * conexão da Evolution vira linha de tabela com `companyId` próprio, e o
 * webhook passa a resolver a empresa pela CONEXÃO". É o que aconteceu.
 *
 * O ganho não é estético: com a variável, duas instâncias apontando para o
 * mesmo deploy escreviam as duas na mesma empresa, sem erro nenhum. Era ⚠️ R5
 * da auditoria do Ciclo 1a — "segunda fonte de verdade sobre a conversa".
 */
export interface ContextoDeIngestao {
  companyId: string;
  connectionId: string;
}

export async function ingerirMensagem(
  evento: EventoWhatsapp,
  contexto: ContextoDeIngestao
): Promise<ResultadoIngestao> {
  const { companyId, connectionId } = contexto;
  const db = prismaDaEmpresa(companyId);
```

**d)** No `create` da `Conversation`, acrescentar `connectionId`:

```ts
        conversation = await tx.conversation.create({
          data: {
            companyId,
            connectionId,
            waId: evento.waId,
            telefone: normalizado.ok ? normalizado.telefone : null,
            nomeExibicao: evento.nomeExibicao,
          },
        });
```

**e)** Os três `return` ganham `connectionId`:

```ts
      return { companyId, connectionId, conversationId: conversation.id, bufferSeq, duplicada: false };
```

e, no ramo do `catch` de `P2002`:

```ts
        return {
          companyId,
          connectionId,
          conversationId: conversation.id,
          bufferSeq: conversation.bufferSeq,
          duplicada: true,
        };
```

**f)** O comentário do bloco `waId` `@unique` GLOBAL ganha o parágrafo que registra o que MUDOU:

```
      // ## `waId` é `@unique` GLOBAL, e isso é pendência de SCHEMA
      //
      // O `findFirst` escopado NÃO encontra a conversa de outra empresa com o
      // mesmo `waId` — e é justamente por isso que ele tentaria criar uma
      // segunda, batendo no `@unique` global. É a mesma família de
      // `Contact.telefone` e `PipelineStage.ordem`, registrada à parte (⚠️ R2
      // da auditoria do Ciclo 1a).
      //
      // O QUE MUDOU NO CICLO 2a: até aqui, `EVOLUTION_COMPANY_ID` (uma
      // instância por deploy) tornava a segunda empresa INALCANÇÁVEL, e o
      // defeito era teórico. Agora duas empresas podem ter conexões, e o mesmo
      // número atendido pelas duas colide em `P2002` → 500 → a Evolution
      // reentrega para sempre. A dívida é a mesma; o ALCANCE dela cresceu. Não
      // é este ciclo que a resolve (decisão do dono), e o sintoma está escrito
      // aqui para ninguém gastar um dia diagnosticando.
```

**g)** O comentário de escopo de módulo que dizia "Lida dentro da função, não em escopo de módulo — o mesmo raciocínio de `gateway/index.ts`" pode sair junto com `obterEvolutionCompanyId`: não há mais leitura de `process.env` neste arquivo.

- [ ] **Step 4: Rodar para ver passar**

```bash
npx vitest run tests/unit/whatsapp-ingest.test.ts
```

Esperado: PASS, incluindo os dois casos novos.

- [ ] **Step 5: Escrever os casos da rota nova (RED)**

Reescrever `tests/unit/whatsapp-webhook-route.test.ts`. As mudanças estruturais, em relação ao que está lá:

1. O `vi.mock("@/modules/whatsapp/gateway", ...)` sai e entra
   `vi.mock("@/modules/whatsapp/gateway/fabrica", ...)`.
2. Entra `vi.mock("@/core/conexoes/leitura", ...)`.
3. O import da rota passa a
   `../../src/app/api/whatsapp/evolution/[companyId]/[token]/route`.
4. `chamar()` passa `{ companyId, token }`.
5. `WHATSAPP_WEBHOOK_TOKEN` **some** do `beforeEach` e o caso "devolve 500
   quando `WHATSAPP_WEBHOOK_TOKEN` não está configurado" é **substituído**
   pelos casos de resolução abaixo — não removido sem substituto.

O cabeçalho e as fixtures:

```ts
// Teste de unidade puro (sem Prisma real, sem rede): mocka a resolução de
// conexão, a fábrica de gateway, o ingest, a fila e o rate limit para isolar a
// ROTA — mesmo padrão de tests/unit/export-leads.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest";

const EMPRESA = "cmp_a";
const TOKEN = "a".repeat(64);

const checarRateLimitMock = vi.fn();
vi.mock("@/core/rate-limit/limiter", () => ({
  checarRateLimit: (...a: unknown[]) => checarRateLimitMock(...a),
}));

const resolverConexaoPorWebhookMock = vi.fn();
vi.mock("@/core/conexoes/leitura", () => ({
  resolverConexaoPorWebhook: (...a: unknown[]) => resolverConexaoPorWebhookMock(...a),
}));

const verificarOrigemMock = vi.fn();
const normalizarEventosMock = vi.fn();
const gatewayDaCredencialMock = vi.fn();
vi.mock("@/modules/whatsapp/gateway/fabrica", () => ({
  gatewayDaCredencial: (...a: unknown[]) => gatewayDaCredencialMock(...a),
}));

const ingerirMensagemMock = vi.fn();
vi.mock("@/modules/whatsapp/ingest", () => ({
  ingerirMensagem: (...a: unknown[]) => ingerirMensagemMock(...a),
}));

const publicarTurnoMock = vi.fn();
vi.mock("@/modules/whatsapp/fila", () => ({
  publicarTurno: (...a: unknown[]) => publicarTurnoMock(...a),
}));

const { DuplicateMessageError } = await import("@vercel/queue");
const { POST } = await import(
  "../../src/app/api/whatsapp/evolution/[companyId]/[token]/route"
);

const CRED = {
  id: "conn_1",
  companyId: EMPRESA,
  canal: "EVOLUTION" as const,
  dominio: "https://evo.exemplo.com",
  instancia: "inst-1",
  apiKey: "apikey-1a2b",
};

function requestComCorpo(corpo: unknown, ip = "203.0.113.10") {
  return new Request("https://crm.exemplo.com/api/whatsapp/evolution/x/y", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(corpo),
  });
}

function chamar(request: Request, companyId = EMPRESA, token = TOKEN) {
  return POST(request, { params: Promise.resolve({ companyId, token }) });
}

beforeEach(() => {
  checarRateLimitMock.mockReset().mockResolvedValue(true);
  resolverConexaoPorWebhookMock.mockReset().mockResolvedValue(CRED);
  verificarOrigemMock.mockReset().mockReturnValue(true);
  normalizarEventosMock.mockReset().mockReturnValue([]);
  gatewayDaCredencialMock.mockReset().mockReturnValue({
    verificarOrigem: (...a: unknown[]) => verificarOrigemMock(...a),
    normalizarEventos: (...a: unknown[]) => normalizarEventosMock(...a),
  });
  ingerirMensagemMock.mockReset();
  publicarTurnoMock.mockReset().mockResolvedValue(undefined);
});
```

Os casos NOVOS, que substituem os de token de ambiente:

```ts
describe("resolução da conexão — é ela que substitui EVOLUTION_COMPANY_ID", () => {
  it("resolve pela empresa do path E pelo token, nessa ordem de argumentos", async () => {
    await chamar(requestComCorpo({ instance: "inst-1" }));
    expect(resolverConexaoPorWebhookMock).toHaveBeenCalledWith(EMPRESA, TOKEN);
  });

  it("token desconhecido devolve 404 — e o gateway NUNCA é construído", async () => {
    resolverConexaoPorWebhookMock.mockResolvedValue(null);
    const resposta = await chamar(requestComCorpo({ instance: "inst-1" }));
    // 404 e não 401/403: não confirma, a quem tenta adivinhar, que este path
    // sequer existe. Mesma política do token do Ciclo 1.
    expect(resposta.status).toBe(404);
    expect(gatewayDaCredencialMock).not.toHaveBeenCalled();
    expect(ingerirMensagemMock).not.toHaveBeenCalled();
  });

  it("token de A com companyId de B devolve 404, porque a busca é ESCOPADA", async () => {
    // O `companyId` do path é HIPÓTESE, não autoridade: quem manda é o token.
    // Este caso prova a metade que importa na rota; a metade contra Postgres
    // real é `tests/unit/conexoes-isolamento.test.ts`.
    resolverConexaoPorWebhookMock.mockImplementation(async (companyId: string) =>
      companyId === EMPRESA ? CRED : null
    );
    expect((await chamar(requestComCorpo({ instance: "inst-1" }), "cmp_b")).status).toBe(404);
  });

  it("constrói o gateway a partir da CONEXÃO resolvida, não de variável de ambiente", async () => {
    await chamar(requestComCorpo({ instance: "inst-1" }));
    expect(gatewayDaCredencialMock).toHaveBeenCalledWith(CRED);
  });

  it("instância desconhecida devolve 403 e não escreve nada", async () => {
    verificarOrigemMock.mockReturnValue(false);
    const resposta = await chamar(requestComCorpo({ instance: "instancia-de-outro" }));
    expect(resposta.status).toBe(403);
    expect(ingerirMensagemMock).not.toHaveBeenCalled();
  });

  it("passa companyId E connectionId da conexão para a ingestão", async () => {
    normalizarEventosMock.mockReturnValue([{ idExterno: "m1", waId: "5511999998888" }]);
    ingerirMensagemMock.mockResolvedValue({
      companyId: EMPRESA,
      connectionId: "conn_1",
      conversationId: "cnv_1",
      bufferSeq: 1,
      duplicada: false,
    });

    await chamar(requestComCorpo({ instance: "inst-1" }));

    expect(ingerirMensagemMock).toHaveBeenCalledWith(expect.objectContaining({ idExterno: "m1" }), {
      companyId: EMPRESA,
      connectionId: "conn_1",
    });
  });

  it("o rate limit é consultado ANTES de resolver a conexão", async () => {
    // Resolver a conexão é uma ida ao banco. Deixá-la antes do rate limit
    // daria a quem descobriu o path uma consulta por requisição de graça.
    checarRateLimitMock.mockResolvedValue(false);
    const resposta = await chamar(requestComCorpo({ instance: "inst-1" }));
    expect(resposta.status).toBe(429);
    expect(resolverConexaoPorWebhookMock).not.toHaveBeenCalled();
  });

  it("devolve 200 (ack) para JSON malformado, sem resolver conexão nenhuma", async () => {
    const request = new Request("https://crm.exemplo.com/api/whatsapp/evolution/x/y", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
      body: "{ nao é json",
    });
    expect((await chamar(request)).status).toBe(200);
  });
});
```

> Os casos que **já existem** no arquivo sobre publicação de turno, duplicidade
> (`DuplicateMessageError`), 500 em falha e 200 para zero eventos **continuam
> valendo**: adapte só as chamadas de `chamar()` e o formato do retorno de
> `ingerirMensagemMock` (que agora tem `connectionId`). **Não remova nenhum
> deles.**

- [ ] **Step 6: Rodar para ver falhar**

```bash
npx vitest run tests/unit/whatsapp-webhook-route.test.ts
```

Esperado: FAIL — a rota `[companyId]/[token]` não existe.

- [ ] **Step 7: Escrever a rota nova**

Criar `src/app/api/whatsapp/evolution/[companyId]/[token]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { DuplicateMessageError } from "@vercel/queue";

import { checarRateLimit } from "@/core/rate-limit/limiter";
import { obterIpDaRequisicao } from "@/lib/ip";
import { resolverConexaoPorWebhook } from "@/core/conexoes/leitura";
import { gatewayDaCredencial } from "@/modules/whatsapp/gateway/fabrica";
import { ingerirMensagem } from "@/modules/whatsapp/ingest";
import { publicarTurno } from "@/modules/whatsapp/fila";

/**
 * Webhook público que a Evolution chama a cada evento. Tudo sob
 * `/api/whatsapp/*` é público e autentica a si mesmo — ver o comentário em
 * `src/proxy.ts` sobre esse invariante.
 *
 * ## O que mudou no Ciclo 2a, e por quê
 *
 * O path ganhou um segmento: era `/<token>`, virou `/<companyId>/<token>`.
 *
 * O `companyId` é **hipótese, não autoridade** — ele só escolhe ONDE procurar.
 * Quem decide é o token, porque a busca é ESCOPADA naquela empresa:
 *
 * - `companyId` de A + token de A → encontra. É a única combinação que passa.
 * - `companyId` de B + token de A → a busca escopada em B não acha o hash de
 *   A → 404. **Saber o token da empresa A não dá nada na empresa B.**
 * - `companyId` inventado + token qualquer → 404.
 *
 * Isso é o que permitiu matar `EVOLUTION_COMPANY_ID` (⚠️ R5 da auditoria do
 * Ciclo 1a) **sem** uma consulta global e **sem** exceção nova no lint contra
 * `@/lib/prisma` — a lista está em zero e continua.
 *
 * E é por isso que um `companyId` de parâmetro aqui não contradiz a regra do
 * programa ("em Server Action a empresa vem de `usuarioAtual()`"): aquela
 * regra existe porque Server Action TEM sessão, e aceitar empresa por
 * parâmetro deixaria alguém autenticado agir na empresa alheia. Um webhook não
 * tem sessão nenhuma para contradizer.
 *
 * ## Camadas de defesa, nesta ordem
 *
 * 1. **Rate limit por IP** — primeiro de todos, e a ordem importa mais agora
 *    que antes: resolver a conexão é uma ida ao BANCO, e deixá-la à frente
 *    daria a quem descobriu o path uma consulta por requisição de graça. Tem
 *    caso de teste. O limite alargado (600/min) continua sendo trava contra
 *    instância comprometida, não throttle por cliente — o raciocínio inteiro
 *    está no histórico desta rota.
 * 2. **Token do path**, resolvido como `sha256` contra `webhookTokenHash`.
 *    A comparação não é mais de tempo constante (era `timingSafeEqual`); a
 *    defesa nunca foi ela e sim os 256 bits de entropia, e o que se ganhou em
 *    troca é que um dump do banco não entrega mais uma URL funcional. Ver
 *    `core/conexoes/webhook-token.ts`.
 * 3. **Verificação do adapter** (`verificarOrigem`) — o campo `instance` do
 *    corpo contra a instância DAQUELA conexão, não mais contra
 *    `EVOLUTION_INSTANCE` do ambiente.
 *
 * ## Resposta
 *
 * 200 para autenticação/formato ok e todo evento processado (ou duplicado);
 * 500 quando pelo menos um evento falhou de ponta a ponta, deixando o retry
 * NATIVO da Evolution recuperar — seguro porque `ingerirMensagem` (idExterno)
 * e `publicarTurno` (idempotencyKey) são idempotentes.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ companyId: string; token: string }> }
) {
  const { companyId, token } = await params;

  const ip = obterIpDaRequisicao(request);
  const permitido = await checarRateLimit(`whatsapp:webhook:${ip}`, 600, 60_000);
  if (!permitido) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    // JSON malformado — confirma sem processar, e sem gastar uma consulta:
    // não deixa a Evolution reentregar um payload que nunca vai parsear.
    return NextResponse.json({ ok: true });
  }

  const conexao = await resolverConexaoPorWebhook(companyId, token);
  if (!conexao) {
    // 404, e não 401/403: não confirma a quem está adivinhando que este path
    // sequer existe. Mesma resposta para "token errado", "empresa errada" e
    // "conexão desativada" — distinguir seria dizer qual metade acertou.
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const gateway = gatewayDaCredencial(conexao);

  if (!gateway.verificarOrigem(corpo)) {
    // Instância desconhecida: a Evolution mandou um evento de uma instância
    // que não é a desta conexão. Nada é escrito.
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const eventos = gateway.normalizarEventos(corpo);

  let algumEventoFalhou = false;
  for (const evento of eventos) {
    try {
      const resultado = await ingerirMensagem(evento, {
        companyId: conexao.companyId,
        connectionId: conexao.id,
      });
      try {
        await publicarTurno({
          companyId: resultado.companyId,
          conversationId: resultado.conversationId,
          seq: resultado.bufferSeq,
        });
      } catch (erroPublicacao) {
        if (erroPublicacao instanceof DuplicateMessageError) {
          // Esperado no caminho de redelivery: a fila já deduplicou por
          // `idempotencyKey`, não é falha.
          continue;
        }
        throw erroPublicacao;
      }
    } catch (erro) {
      // Uma falha de verdade não impede os DEMAIS eventos do mesmo payload de
      // serem tentados — mas marca a resposta como falha, para a Evolution
      // reentregar o payload inteiro depois. Reentregar é seguro: as duas
      // pontas são idempotentes.
      //
      // O `companyId` NÃO entra neste log de propósito: ele já está no path
      // que o log de acesso registra, e repeti-lo aqui só aumentaria a
      // superfície. O erro do cofre, quando é ele, já se explica sozinho.
      console.error("Falha ao ingerir/publicar mensagem do WhatsApp:", erro);
      algumEventoFalhou = true;
    }
  }

  return NextResponse.json({ ok: !algumEventoFalhou }, { status: algumEventoFalhou ? 500 : 200 });
}
```

- [ ] **Step 8: Apagar a rota antiga**

```bash
git rm -r "src/app/api/whatsapp/evolution/[token]"
```

A antiga **não pode** ficar: ela importa `ingerirMensagem` com a assinatura de
um argumento, que deixou de existir, e o `typecheck` acusaria. Manter as duas
também significaria manter dois caminhos de autenticação para a mesma coisa —
um deles com o token do deploy inteiro.

- [ ] **Step 9: Rodar para ver passar**

```bash
npx vitest run tests/unit/whatsapp-webhook-route.test.ts tests/unit/whatsapp-ingest.test.ts
npm run typecheck
npm run lint
```

Esperado: os dois arquivos verdes; `typecheck` e `lint` sem erro. Se o
`typecheck` reclamar de algum outro chamador de `ingerirMensagem`, **pare e
reporte** — o plano previu dois (a rota antiga, apagada, e o teste).

- [ ] **Step 10: Commit**

```bash
git add -A src/app/api/whatsapp src/modules/whatsapp/ingest.ts tests/unit/whatsapp-webhook-route.test.ts tests/unit/whatsapp-ingest.test.ts
git commit -m "$(cat <<'EOF'
feat(webhook): a empresa sai da conexao, e EVOLUTION_COMPANY_ID morre

Era uma constante do DEPLOY dizendo de quem e toda conversa que entra --
segunda fonte de verdade sobre a conversa, R5 da auditoria do Ciclo 1a. O
comentario dela ja dizia "no Ciclo 2 o webhook resolve a empresa pela
conexao". E o que este commit faz.

O path ganhou um segmento: /<companyId>/<token>. O companyId e HIPOTESE,
nao autoridade -- ele so escolhe onde procurar, e quem decide e o token,
porque a busca e escopada naquela empresa. Token de A com companyId de B
nao acha nada. Foi assim que a resolucao coube sem consulta global e sem
excecao nova no lint.

A conversa passa a registrar por qual conexao entrou. Sem isso
multi-instancia seria mentira: com duas conexoes na mesma empresa, a
resposta sairia por "alguma" delas e o cliente receberia mensagem de um
numero que nunca falou com ele.

O rate limit ficou na frente da resolucao de proposito: resolver e uma
ida ao banco, e a ordem inversa daria uma consulta de graca a quem
descobrisse o path.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: O envio sai pela conexão da CONVERSA

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Modify: `src/modules/whatsapp/turno.ts`
- Modify: `src/modules/whatsapp/agente.ts`
- Modify: `tests/unit/whatsapp-turno.test.ts`
- Modify: `tests/unit/whatsapp-agente.test.ts`
- Modify: `tests/unit/whatsapp-isolamento.test.ts`

**Interfaces:**
- Consumes: `gatewayDaConversa(companyId, { id, connectionId })` (`@/modules/whatsapp/gateway/fabrica`, Tarefa 6); `Conversation.connectionId` (Tarefa 1, gravado na Tarefa 7).
- Produces: nenhuma assinatura pública muda. `processarTurno` e `responderComoHumano` continuam com os mesmos parâmetros. O que muda é a ORIGEM do gateway: os dois pontos de `whatsappGateway.enviarTexto` viram `(await gatewayDaConversa(...)).enviarTexto`.

- [ ] **Step 1: Trocar os mocks dos três testes (RED)**

Nos três arquivos, o bloco

```ts
vi.mock("@/modules/whatsapp/gateway", () => ({
  whatsappGateway: { enviarTexto: (...args: unknown[]) => enviarTextoMock(...args) },
}));
```

(ou a grafia relativa equivalente) é **substituído** por:

```ts
const gatewayDaConversaMock = vi.fn();
vi.mock("@/modules/whatsapp/gateway/fabrica", () => ({
  gatewayDaConversa: (...a: unknown[]) => gatewayDaConversaMock(...a),
}));
```

e, no `beforeEach` de cada arquivo, junto dos outros resets:

```ts
  enviarTextoMock.mockReset().mockResolvedValue({ idExterno: "wamid-teste" });
  gatewayDaConversaMock
    .mockReset()
    .mockResolvedValue({ enviarTexto: (...a: unknown[]) => enviarTextoMock(...a) });
```

> Se o arquivo já configurava `enviarTextoMock` de outro jeito no `beforeEach`,
> **mantenha o dele** e acrescente só a linha de `gatewayDaConversaMock`.
> Nenhuma asserção existente sobre `enviarTextoMock` muda — ele continua sendo
> o espião do envio.

E acrescentar, em `tests/unit/whatsapp-turno.test.ts`:

```ts
describe("o envio sai pela conexão da conversa (Ciclo 2a)", () => {
  it("resolve o gateway com o `companyId` e o `connectionId` da conversa", async () => {
    // ... monte o cenário de turno que este arquivo já usa para "responde e
    // grava a saída", e depois:
    expect(gatewayDaConversaMock).toHaveBeenCalledWith(
      EMPRESA,
      expect.objectContaining({ connectionId: expect.anything() })
    );
  });

  it("resolve o gateway UMA vez por turno, não uma por mensagem", async () => {
    // Com o modelo devolvendo duas respostas, o gateway continua sendo
    // resolvido uma vez só: resolver dentro do laço faria uma consulta e uma
    // decifragem por mensagem enviada, sem nada em troca — a conexão não muda
    // no meio de um turno.
    expect(gatewayDaConversaMock).toHaveBeenCalledTimes(1);
  });
});
```

> Reaproveite as fixtures e os nomes (`EMPRESA`, o cenário de duas respostas)
> que o arquivo **já tem**. Não crie fixture nova.

- [ ] **Step 2: Rodar para ver falhar**

```bash
npx vitest run tests/unit/whatsapp-turno.test.ts tests/unit/whatsapp-agente.test.ts tests/unit/whatsapp-isolamento.test.ts
```

Esperado: FAIL — `turno.ts` e `agente.ts` ainda importam `whatsappGateway`, que agora não está mockado, e o gateway real tentaria ler `EVOLUTION_*`.

- [ ] **Step 3: `turno.ts` resolve o gateway pela conversa**

Em `src/modules/whatsapp/turno.ts`:

**a)** trocar o import:

```ts
import { gatewayDaConversa } from "./gateway/fabrica";
```

(o `import { whatsappGateway } from "./gateway";` sai)

**b)** **antes** do laço `for (const texto of respostas)`, e **depois** do
`findFirstOrThrow` que carrega `conversation`, acrescentar:

```ts
  // Resolvido UMA vez por turno, fora do laço: a conexão não muda no meio de
  // um turno, e resolver dentro faria uma consulta ao banco e uma decifragem
  // por mensagem enviada sem nada em troca. Tem caso de teste contando as
  // chamadas.
  //
  // `conversation` vem do `findFirstOrThrow` acima SEM `select`, então
  // `connectionId` está em mãos. Se ele for nulo (conversa anterior ao Ciclo
  // 2a), a fábrica cai na única conexão ativa da empresa e RECUSA se houver
  // mais de uma — responder pelo número errado é pior que não responder.
  const gateway = await gatewayDaConversa(companyId, conversation);
```

**c)** dentro do laço, a linha do envio:

```ts
    const envio = await gateway.enviarTexto(conversation.waId, texto);
```

- [ ] **Step 4: `agente.ts` resolve o gateway pela conversa**

Em `src/modules/whatsapp/agente.ts`:

**a)** trocar o import:

```ts
import { gatewayDaConversa } from "./gateway/fabrica";
```

**b)** em `responderComoHumano`, o `select` da conversa ganha `connectionId`:

```ts
  const conversa = await escopo.conversation.findFirstOrThrow({
    where: { id: conversationId },
    // `connectionId` entra no `select` desde o Ciclo 2a: é por ele que a
    // resposta sai. Sem ele aqui, o envio cairia sempre no caminho de "única
    // conexão ativa" e uma empresa com duas conexões receberia
    // `ConexaoAmbiguaError` numa conversa que sabe perfeitamente por onde
    // entrou.
    select: { waId: true, connectionId: true },
  });
```

**c)** o passo 2 (envio) passa a:

```ts
  // 2. Envia. Loga no `conversationId` (nunca o texto nem `conversa.waId` —
  // é o telefone do cliente, dado pessoal) para deixar rastro de quando o
  // humano precisou repetir o envio.
  //
  // O gateway é resolvido DEPOIS da pausa e ANTES do envio, dentro do mesmo
  // `try`: se a conexão estiver ausente ou ambígua, a IA já está calada
  // (passo 1) e nada foi mandado — que é exatamente a ordem que o resto
  // desta função protege.
  let envio: { idExterno: string };
  try {
    const gateway = await gatewayDaConversa(companyId, {
      id: conversationId,
      connectionId: conversa.connectionId,
    });
    envio = await gateway.enviarTexto(conversa.waId, conteudo);
  } catch (erro) {
    console.error(
      `Falha ao enviar resposta humana (conversationId=${conversationId}) — IA pausada, nada enviado.`,
      erro
    );
    throw erro;
  }
```

- [ ] **Step 5: Rodar para ver passar**

```bash
npx vitest run tests/unit/whatsapp-turno.test.ts tests/unit/whatsapp-agente.test.ts tests/unit/whatsapp-isolamento.test.ts
npm run typecheck
npm run lint
```

Esperado: os três verdes; `typecheck` e `lint` sem erro. Se sobrar algum
importador de `whatsappGateway` em `src/`, ele é da Tarefa 10 — confira com:

```bash
grep -rn "whatsappGateway" src/
```

Esperado neste ponto: **só** `src/modules/whatsapp/gateway/index.ts` (a
definição, que a Tarefa 10 remove). Cole a saída.

- [ ] **Step 6: Commit**

```bash
git add src/modules/whatsapp/turno.ts src/modules/whatsapp/agente.ts tests/unit/whatsapp-turno.test.ts tests/unit/whatsapp-agente.test.ts tests/unit/whatsapp-isolamento.test.ts
git commit -m "$(cat <<'EOF'
feat(whatsapp): a resposta sai pela conexao por onde a mensagem entrou

Os dois pontos de envio -- o turno da IA e a resposta do humano -- usavam
um singleton com a credencial do deploy. Com credencial por empresa isso
seria responder o cliente da empresa B pela instancia da A; com duas
conexoes na mesma empresa, seria responder por um numero que nunca falou
com aquele cliente.

Os dois ja tinham companyId em maos (o job da fila exige desde o Ciclo
1d, e responderComoHumano recebe como primeiro parametro), entao nao foi
preciso inventar canal nenhum: a conversa diz por onde entrou.

Resolvido uma vez por turno e nao uma por mensagem: a conexao nao muda no
meio de um turno, e resolver no laco custaria uma consulta e uma
decifragem por mensagem sem nada em troca.

Em agente.ts o gateway e resolvido DEPOIS da pausa e dentro do mesmo try
do envio: conexao ausente ou ambigua deixa a IA calada e nada enviado,
que e a ordem que aquela funcao inteira existe para proteger.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: A aba de administração em Configurações

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Create: `src/core/conexoes/actions.ts`
- Create: `src/app/(painel)/configuracoes/layout.tsx`
- Create: `src/app/(painel)/configuracoes/page.tsx`
- Create: `src/app/(painel)/configuracoes/conexoes/page.tsx`
- Create: `src/components/conexoes/conexao-form.tsx`
- Create: `src/components/conexoes/conexoes-table.tsx`
- Modify: `src/components/nav-links.tsx`
- Modify: `src/components/painel-nav.tsx`
- Modify: `tests/unit/painel-nav.test.tsx`
- Create: `tests/unit/conexoes-actions.test.ts`
- Create: `tests/e2e/configuracoes-conexoes.spec.ts`

**Interfaces:**
- Consumes: `usuarioAtual`, `usuarioAtualOuLogin` (`@/core/auth/session`); `hasPermission` e `"gerenciar_conexoes"` (`@/core/auth/permissions`, Tarefa 4); todas as funções de `@/core/conexoes/service` (Tarefa 5); `ResultadoAcao`, `ehSessaoInvalida`, `MENSAGEM_SESSAO_INVALIDA` (`@/lib/acao`); `ConfirmarDialogo` (`@/components/confirmar-dialogo`); `Button`, `Input`, `Label`, `Badge` (`@/components/ui/*`).
- Produces:
  - `type ResultadoComWebhook = { ok: true; webhookPath: string } | { ok: false; erro: string }`
  - `criarConexaoAction(dados): Promise<ResultadoComWebhook>`
  - `substituirSegredoAction({ id, segredo }): Promise<ResultadoAcao>`
  - `atualizarConexaoAction({ id, nome, dominio, instancia }): Promise<ResultadoAcao>`
  - `definirAtivaAction({ id, ativa }): Promise<ResultadoAcao>`
  - `regenerarWebhookAction({ id }): Promise<ResultadoComWebhook>`
  - `apagarConexaoAction({ id }): Promise<ResultadoAcao>`
  - as rotas `/configuracoes` e `/configuracoes/conexoes`
  - `IconeDoPainel` ganha `"configuracoes"`

- [ ] **Step 1: Escrever os casos que falham (RED) — as actions**

Criar `tests/unit/conexoes-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const usuarioAtualMock = vi.fn();
vi.mock("@/core/auth/session", () => ({ usuarioAtual: () => usuarioAtualMock() }));

const criarConexaoMock = vi.fn();
const substituirSegredoMock = vi.fn();
const apagarConexaoMock = vi.fn();
const regenerarWebhookTokenMock = vi.fn();
vi.mock("@/core/conexoes/service", async () => {
  const { ConexaoInvalidaError } = await vi.importActual<
    typeof import("../../src/core/conexoes/service")
  >("../../src/core/conexoes/service");
  return {
    ConexaoInvalidaError,
    criarConexao: (...a: unknown[]) => criarConexaoMock(...a),
    substituirSegredo: (...a: unknown[]) => substituirSegredoMock(...a),
    apagarConexao: (...a: unknown[]) => apagarConexaoMock(...a),
    regenerarWebhookToken: (...a: unknown[]) => regenerarWebhookTokenMock(...a),
    atualizarConexao: vi.fn(),
    definirAtiva: vi.fn(),
  };
});

import {
  criarConexaoAction,
  substituirSegredoAction,
  apagarConexaoAction,
  regenerarWebhookAction,
} from "../../src/core/conexoes/actions";

const ADMIN = { id: "usr_1", companyId: "cmp_a", papel: "ADMIN" as const, nome: "A", email: "a@a.com", ativo: true };
const VENDEDOR = { ...ADMIN, papel: "VENDEDOR" as const };

const DADOS = {
  canal: "EVOLUTION" as const,
  nome: "Comercial",
  dominio: "https://evo.exemplo.com",
  instancia: "inst-1",
  segredo: "apikey-da-evolution-1a2b",
};

beforeEach(() => {
  usuarioAtualMock.mockReset().mockResolvedValue(ADMIN);
  criarConexaoMock.mockReset().mockResolvedValue({ id: "conn_1", webhookToken: "t".repeat(64) });
  substituirSegredoMock.mockReset().mockResolvedValue(undefined);
  apagarConexaoMock.mockReset().mockResolvedValue(undefined);
  regenerarWebhookTokenMock.mockReset().mockResolvedValue({ webhookToken: "u".repeat(64) });
});

describe("a empresa NUNCA vem por parâmetro", () => {
  it("`criarConexaoAction` passa o `companyId` de `usuarioAtual()`", async () => {
    await criarConexaoAction(DADOS);
    // Server Action é endpoint HTTP público: um `companyId` de formulário
    // seria forjável, e quem tivesse sessão em qualquer empresa cadastraria
    // conexão na de outra.
    expect(criarConexaoMock).toHaveBeenCalledWith("cmp_a", expect.anything(), "usr_1");
  });

  it("nenhuma action aceita `companyId` no payload — ele é ignorado", async () => {
    await criarConexaoAction({ ...DADOS, companyId: "cmp_invasora" } as never);
    expect(criarConexaoMock).toHaveBeenCalledWith("cmp_a", expect.anything(), "usr_1");
  });
});

describe("permissão", () => {
  it("VENDEDOR é recusado em TODAS as actions, com mensagem segura de mostrar", async () => {
    usuarioAtualMock.mockResolvedValue(VENDEDOR);

    const resultados = await Promise.all([
      criarConexaoAction(DADOS),
      substituirSegredoAction({ id: "conn_1", segredo: "apikey-nova-9z8y" }),
      apagarConexaoAction({ id: "conn_1" }),
      regenerarWebhookAction({ id: "conn_1" }),
    ]);

    for (const r of resultados) expect(r).toEqual({ ok: false, erro: expect.stringContaining("permissão") });
    // O gate é a ACTION, não a tela: um POST direto nunca passa pela página.
    expect(criarConexaoMock).not.toHaveBeenCalled();
    expect(substituirSegredoMock).not.toHaveBeenCalled();
    expect(apagarConexaoMock).not.toHaveBeenCalled();
    expect(regenerarWebhookTokenMock).not.toHaveBeenCalled();
  });
});

describe("o que volta para o navegador", () => {
  it("`criarConexaoAction` devolve o PATH do webhook, e nada mais", async () => {
    const resultado = await criarConexaoAction(DADOS);
    expect(resultado).toEqual({ ok: true, webhookPath: `/api/whatsapp/evolution/cmp_a/${"t".repeat(64)}` });
  });

  it("`substituirSegredoAction` NÃO devolve nada além de `ok`", async () => {
    // O segredo que a pessoa acabou de digitar não volta — nem para
    // confirmação. Confirmar exigiria o servidor devolver o que recebeu, e é
    // exatamente esse retorno que um XSS leria.
    expect(await substituirSegredoAction({ id: "conn_1", segredo: "apikey-nova-9z8y" })).toEqual({
      ok: true,
    });
  });

  it("nenhum retorno de action contém a apikey enviada", async () => {
    const resultados = [
      await criarConexaoAction(DADOS),
      await substituirSegredoAction({ id: "conn_1", segredo: DADOS.segredo }),
    ];
    expect(JSON.stringify(resultados)).not.toContain(DADOS.segredo);
  });
});

describe("erros", () => {
  it("`ConexaoInvalidaError` chega à tela com o próprio texto", async () => {
    const { ConexaoInvalidaError } = await import("../../src/core/conexoes/service");
    criarConexaoMock.mockRejectedValue(new ConexaoInvalidaError("O domínio precisa ser uma URL."));
    expect(await criarConexaoAction(DADOS)).toEqual({
      ok: false,
      erro: "O domínio precisa ser uma URL.",
    });
  });

  it("qualquer OUTRO erro vira mensagem genérica — nunca o texto interno", async () => {
    // Um erro do cofre carrega o `keyId`; um do Prisma carrega nome de coluna.
    // Nenhum dos dois é para a tela. `console.error` guarda o detalhe onde ele
    // serve a alguém.
    criarConexaoMock.mockRejectedValue(new Error("chave 9f3c1a2b não está em COFRE_CHAVE_MESTRA"));
    const resultado = await criarConexaoAction(DADOS);
    expect(resultado).toEqual({ ok: false, erro: expect.any(String) });
    expect(JSON.stringify(resultado)).not.toContain("9f3c1a2b");
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/conexoes-actions.test.ts
```

Esperado: FAIL — `Cannot find module '../../src/core/conexoes/actions'`.

- [ ] **Step 3: Escrever as actions**

Criar `src/core/conexoes/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { usuarioAtual } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";
import { ehSessaoInvalida, MENSAGEM_SESSAO_INVALIDA, type ResultadoAcao } from "@/lib/acao";

import {
  criarConexao,
  substituirSegredo,
  atualizarConexao,
  definirAtiva,
  regenerarWebhookToken,
  apagarConexao,
  ConexaoInvalidaError,
} from "./service";

/**
 * As Server Actions da aba de Conexões.
 *
 * ## A empresa vem de `usuarioAtual()`, nunca do payload
 *
 * Server Action é endpoint HTTP público. Um `companyId` de formulário seria
 * forjável, e quem tivesse sessão em qualquer empresa cadastraria conexão na
 * de outra — que aqui significaria receber as mensagens dela. Há caso de teste
 * mandando `companyId` no payload e afirmando que ele é IGNORADO.
 *
 * ## As actions DEVOLVEM resultado, não lançam
 *
 * O Next redige erros não tratados de Server Action antes que cheguem ao
 * cliente — o raciocínio inteiro está em `src/lib/acao.ts`. Sem isto, "domínio
 * inválido" e "banco fora do ar" chegariam com a mesma mensagem opaca.
 *
 * ## O que volta, e o que nunca volta
 *
 * Volta: `ok`, uma mensagem de erro SEGURA, e — só em `criar` e em
 * `regenerarWebhook` — o **path** do webhook, uma vez.
 *
 * Nunca volta: a apikey, o blob cifrado, o token de um webhook já criado. Nem
 * como confirmação do que a pessoa acabou de digitar: confirmar exigiria o
 * servidor devolver o que recebeu, e é exatamente esse retorno que um XSS
 * leria.
 *
 * O PATH e não a URL inteira: quem sabe a origem com certeza é o navegador
 * (`window.location.origin`). Montá-la no servidor exigiria uma variável de
 * ambiente nova ou confiar no header `Host`, que é do cliente.
 */

export type ResultadoComWebhook = { ok: true; webhookPath: string } | { ok: false; erro: string };

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão para gerenciar as conexões de WhatsApp.";

/**
 * `usuarioAtual()` roda DENTRO desta função, e esta função é sempre chamada
 * dentro do `try` de cada action — nunca fora. Fora do `try`, uma sessão
 * inválida rejeita a promise sem nunca produzir um `ResultadoAcao`, e a tela
 * não mostra nada, nem sucesso nem erro. É o ponto que derrubou uma rodada de
 * revisão na Fatia 2 do WhatsApp.
 */
async function exigirAdmin() {
  const usuario = await usuarioAtual();
  if (!hasPermission(usuario.papel, "gerenciar_conexoes")) {
    throw new ConexaoInvalidaError(MENSAGEM_SEM_PERMISSAO);
  }
  return usuario;
}

function paraResultadoErro(erro: unknown, mensagemGenerica: string): { ok: false; erro: string } {
  if (erro instanceof ConexaoInvalidaError) {
    return { ok: false, erro: erro.message };
  }
  if (ehSessaoInvalida(erro)) {
    console.error("Ação de conexão negada — sessão expirada ou usuário desativado.", erro);
    return { ok: false, erro: MENSAGEM_SESSAO_INVALIDA };
  }
  // Tudo o mais é genérico, e o detalhe fica no log do servidor: um erro do
  // cofre carrega o `keyId`, um do Prisma carrega nome de coluna. Nenhum dos
  // dois é para a tela. Tem caso de teste afirmando que o `keyId` não vaza.
  console.error(mensagemGenerica, erro);
  return { ok: false, erro: mensagemGenerica };
}

function caminhoDoWebhook(companyId: string, token: string): string {
  return `/api/whatsapp/evolution/${companyId}/${token}`;
}

export async function criarConexaoAction(dados: {
  canal: "EVOLUTION" | "META_CLOUD";
  nome: string;
  dominio: string;
  instancia: string;
  segredo: string;
}): Promise<ResultadoComWebhook> {
  let webhookPath: string;
  try {
    const usuario = await exigirAdmin();
    const { webhookToken } = await criarConexao(
      usuario.companyId,
      {
        canal: dados.canal,
        nome: dados.nome,
        dominio: dados.dominio,
        instancia: dados.instancia,
        segredo: dados.segredo,
      },
      usuario.id
    );
    webhookPath = caminhoDoWebhook(usuario.companyId, webhookToken);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao cadastrar a conexão. Tente novamente.");
  }
  revalidatePath("/configuracoes/conexoes");
  return { ok: true, webhookPath };
}

export async function substituirSegredoAction(entrada: {
  id: string;
  segredo: string;
}): Promise<ResultadoAcao> {
  try {
    const usuario = await exigirAdmin();
    await substituirSegredo(usuario.companyId, entrada.id, entrada.segredo, usuario.id);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao substituir a chave. Tente novamente.");
  }
  revalidatePath("/configuracoes/conexoes");
  return { ok: true };
}

export async function atualizarConexaoAction(entrada: {
  id: string;
  nome: string;
  dominio: string;
  instancia: string;
}): Promise<ResultadoAcao> {
  try {
    const usuario = await exigirAdmin();
    await atualizarConexao(
      usuario.companyId,
      entrada.id,
      { nome: entrada.nome, dominio: entrada.dominio, instancia: entrada.instancia },
      usuario.id
    );
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao salvar a conexão. Tente novamente.");
  }
  revalidatePath("/configuracoes/conexoes");
  return { ok: true };
}

export async function definirAtivaAction(entrada: {
  id: string;
  ativa: boolean;
}): Promise<ResultadoAcao> {
  try {
    const usuario = await exigirAdmin();
    await definirAtiva(usuario.companyId, entrada.id, entrada.ativa, usuario.id);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao mudar o estado da conexão. Tente novamente.");
  }
  revalidatePath("/configuracoes/conexoes");
  return { ok: true };
}

export async function regenerarWebhookAction(entrada: {
  id: string;
}): Promise<ResultadoComWebhook> {
  let webhookPath: string;
  try {
    const usuario = await exigirAdmin();
    const { webhookToken } = await regenerarWebhookToken(usuario.companyId, entrada.id, usuario.id);
    webhookPath = caminhoDoWebhook(usuario.companyId, webhookToken);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao gerar a URL nova. Tente novamente.");
  }
  revalidatePath("/configuracoes/conexoes");
  return { ok: true, webhookPath };
}

export async function apagarConexaoAction(entrada: { id: string }): Promise<ResultadoAcao> {
  try {
    const usuario = await exigirAdmin();
    await apagarConexao(usuario.companyId, entrada.id, usuario.id);
  } catch (erro) {
    return paraResultadoErro(erro, "Falha ao apagar a conexão. Tente novamente.");
  }
  revalidatePath("/configuracoes/conexoes");
  return { ok: true };
}
```

- [ ] **Step 4: Rodar para ver passar**

```bash
npx vitest run tests/unit/conexoes-actions.test.ts
```

Esperado: PASS, 7 casos.

- [ ] **Step 5: A régua de seções e o redirecionamento**

Criar `src/app/(painel)/configuracoes/layout.tsx`:

```tsx
import Link from "next/link";

import { usuarioAtualOuLogin } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";

/**
 * A régua de seções de Configurações.
 *
 * ## Uma seção só, e isso é andaime declarado
 *
 * Hoje existe "Conexões" e mais nada. A régua existe assim mesmo porque é onde
 * a marca por empresa (dívida D3 do Ciclo 1c — "`modulos` fica editável por
 * SQL e por mais nada") e a Meta Cloud API (Ciclo 2b) entram sem reescrever
 * rota. A alternativa — `/configuracoes` SER a tela de conexões — obrigaria a
 * mudar a URL no dia da segunda seção, e URL de tela de administração é coisa
 * que gente salva nos favoritos.
 *
 * ## Este layout NÃO é o portão
 *
 * Ele resolve a sessão (que `(painel)/layout.tsx` já garantiu) e monta os
 * links. Quem barra é cada `page.tsx` e, de verdade, cada Server Action — que
 * vale mesmo para um POST que nunca passou por tela nenhuma.
 */
export default async function ConfiguracoesLayout({ children }: { children: React.ReactNode }) {
  const usuario = await usuarioAtualOuLogin();

  const secoes = [
    ...(hasPermission(usuario.papel, "gerenciar_conexoes")
      ? [{ href: "/configuracoes/conexoes", label: "Conexões" }]
      : []),
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Ajustes de administração desta empresa.
        </p>
      </div>

      {secoes.length > 0 ? (
        <nav className="flex gap-1 border-b" aria-label="Seções de configuração">
          {secoes.map((secao) => (
            <Link
              key={secao.href}
              href={secao.href}
              className="rounded-t-md px-3 py-2 text-sm hover:bg-muted"
            >
              {secao.label}
            </Link>
          ))}
        </nav>
      ) : null}

      {children}
    </div>
  );
}
```

Criar `src/app/(painel)/configuracoes/page.tsx`:

```tsx
import { redirect } from "next/navigation";

import { usuarioAtualOuLogin } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";

/**
 * `/configuracoes` não é tela: manda para a primeira seção que a pessoa pode
 * ver. É o que permite o item de menu apontar para uma URL estável enquanto as
 * seções vão e vêm.
 *
 * Quem não pode ver nenhuma seção vai para o painel — `redirect` e não
 * `notFound()`, pelo mesmo motivo de `/usuarios`: quem clicou num link antigo
 * entende melhor voltar ao painel do que uma tela de "não existe".
 */
export default async function ConfiguracoesPage() {
  const usuario = await usuarioAtualOuLogin();

  if (hasPermission(usuario.papel, "gerenciar_conexoes")) {
    redirect("/configuracoes/conexoes");
  }

  redirect("/");
}
```

- [ ] **Step 6: A tela de conexões**

Criar `src/app/(painel)/configuracoes/conexoes/page.tsx`:

```tsx
import { redirect } from "next/navigation";

import { usuarioAtualOuLogin } from "@/core/auth/session";
import { hasPermission } from "@/core/auth/permissions";
import { listarConexoes } from "@/core/conexoes/service";
import { ConexaoForm } from "@/components/conexoes/conexao-form";
import { ConexoesTable } from "@/components/conexoes/conexoes-table";

/**
 * Conexões de WhatsApp da empresa — ADMIN apenas (`gerenciar_conexoes`).
 *
 * ## Uma LISTA, não um formulário único
 *
 * Multi-instância é decisão travada do programa (nº 4): uma empresa pode ter
 * mais de uma conexão, e a resposta sai pela conexão por onde a mensagem
 * entrou (`Conversation.connectionId`). Um formulário único esconderia a
 * segunda conexão e faria a segunda instância parecer impossível.
 *
 * ## NÃO há portão de módulo aqui, e isso é diferente de `/conversas/agente`
 *
 * Aquela tela é do módulo `whatsapp` e chama `exigirModulo` antes do gate de
 * permissão. Esta é de administração: uma empresa que ainda não tem o módulo
 * ligado precisa poder CADASTRAR a conexão antes — exigir o módulo aqui
 * criaria um ovo-e-galinha em que ninguém consegue configurar nada. O que
 * `modulos` decide é se as CONVERSAS aparecem, não se o ADMIN pode preparar o
 * canal.
 *
 * `(painel)/layout.tsx` já garante sessão válida; `usuarioAtualOuLogin()` aqui
 * lê o papel para o gate e o `companyId` para a listagem.
 */
export default async function ConexoesPage() {
  const usuario = await usuarioAtualOuLogin();

  if (!hasPermission(usuario.papel, "gerenciar_conexoes")) {
    redirect("/");
  }

  const conexoes = await listarConexoes(usuario.companyId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium">Conexões de WhatsApp</h2>
        <p className="text-sm text-muted-foreground">
          A chave de API fica guardada cifrada e não pode ser lida de volta — só substituída.
          Depois de cadastrar, cole a URL de webhook no painel da Evolution.
        </p>
      </div>

      <div className="rounded-md border p-4">
        <h3 className="mb-3 text-sm font-medium">Adicionar conexão</h3>
        <ConexaoForm />
      </div>

      <ConexoesTable conexoes={conexoes} />
    </div>
  );
}
```

- [ ] **Step 7: O formulário de criação**

Criar `src/components/conexoes/conexao-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { criarConexaoAction } from "@/core/conexoes/actions";
import { registrarFalhaDeRede } from "@/lib/acao";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { AvisoDeWebhook } from "./conexoes-table";

/**
 * Cadastro de conexão.
 *
 * ## O campo da chave é `type="password"` e nasce VAZIO
 *
 * Vazio porque não há valor anterior a exibir — a chave nunca volta do
 * servidor. `password` porque a tela de administração costuma ser aberta com
 * gente por perto, e o navegador não deve oferecer autocompletar para ela:
 * `autoComplete="off"` acompanha, pelo mesmo motivo.
 *
 * ## `META_CLOUD` aparece desabilitado, e o servidor recusa de qualquer forma
 *
 * O `disabled` é conveniência — diz que a opção existe e ainda não chegou. O
 * gate de verdade é `validarCampos` em `core/conexoes/service.ts`, que lança
 * `ConexaoInvalidaError`, e ele vale para um POST que nunca passou por aqui.
 */
export function ConexaoForm() {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [dominio, setDominio] = useState("");
  const [instancia, setInstancia] = useState("");
  const [segredo, setSegredo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [webhookPath, setWebhookPath] = useState<string | null>(null);
  const [processando, iniciar] = useTransition();

  function salvar() {
    setErro(null);
    setWebhookPath(null);
    iniciar(async () => {
      try {
        const resultado = await criarConexaoAction({
          canal: "EVOLUTION",
          nome,
          dominio,
          instancia,
          segredo,
        });
        if (!resultado.ok) {
          setErro(resultado.erro);
          return;
        }
        // O campo da chave é limpo assim que a action confirma: deixá-lo
        // preenchido manteria o segredo na memória do navegador e no DOM sem
        // nenhuma razão — ele já foi gravado.
        setSegredo("");
        setNome("");
        setDominio("");
        setInstancia("");
        setWebhookPath(resultado.webhookPath);
        router.refresh();
      } catch (erroDeRede) {
        // A action promete não lançar, e essa promessa é do CÓDIGO, não do
        // transporte: conexão que cai entre o clique e a resposta rejeita o
        // `await` sem nunca ter entrado no `try` da action.
        setErro(registrarFalhaDeRede("Falha ao cadastrar conexão", erroDeRede));
      }
    });
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(evento) => {
        evento.preventDefault();
        salvar();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="conexao-nome">Nome</Label>
          <Input
            id="conexao-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Comercial"
            required
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="conexao-canal">Canal</Label>
          <select
            id="conexao-canal"
            className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
            defaultValue="EVOLUTION"
          >
            <option value="EVOLUTION">Evolution API</option>
            <option value="META_CLOUD" disabled>
              Meta Cloud API (em breve)
            </option>
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="conexao-dominio">Domínio da instância</Label>
          <Input
            id="conexao-dominio"
            value={dominio}
            onChange={(e) => setDominio(e.target.value)}
            placeholder="https://evolution.seudominio.com"
            required
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="conexao-instancia">Nome da instância</Label>
          <Input
            id="conexao-instancia"
            value={instancia}
            onChange={(e) => setInstancia(e.target.value)}
            placeholder="minha-instancia"
            required
          />
        </div>

        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="conexao-segredo">Chave de API (apikey)</Label>
          <Input
            id="conexao-segredo"
            type="password"
            autoComplete="off"
            value={segredo}
            onChange={(e) => setSegredo(e.target.value)}
            placeholder="cole aqui a apikey do painel da Evolution"
            required
          />
          <p className="text-xs text-muted-foreground">
            Guardada cifrada. Depois de salvar ela não pode ser lida de volta, só substituída.
          </p>
        </div>
      </div>

      {erro ? <p className="text-sm text-destructive">{erro}</p> : null}

      <Button type="submit" disabled={processando}>
        {processando ? "Salvando..." : "Cadastrar conexão"}
      </Button>

      {webhookPath ? <AvisoDeWebhook caminho={webhookPath} /> : null}
    </form>
  );
}
```

- [ ] **Step 8: A tabela e o aviso de webhook**

Criar `src/components/conexoes/conexoes-table.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { ConexaoApresentada } from "@/core/conexoes/service";
import {
  substituirSegredoAction,
  definirAtivaAction,
  regenerarWebhookAction,
  apagarConexaoAction,
} from "@/core/conexoes/actions";
import { registrarFalhaDeRede } from "@/lib/acao";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmarDialogo } from "@/components/confirmar-dialogo";

/**
 * A URL do webhook, mostrada UMA vez.
 *
 * ## Por que isto não contradiz "o segredo nunca volta para o navegador"
 *
 * A regra é sobre DECIFRAR: nada que esteja guardado no cofre volta. Este
 * token não veio do cofre — o servidor acabou de sorteá-lo e guardou só o
 * `sha256` dele. Sem esta entrega única não haveria como a pessoa colar a URL
 * no painel da Evolution, e a alternativa (guardar o token legível para exibir
 * depois) seria trocar uma entrega controlada por um segredo permanentemente
 * legível.
 *
 * ## `window.location.origin` e não uma variável de ambiente
 *
 * Quem sabe a origem com certeza é o navegador. Montá-la no servidor exigiria
 * uma variável nova ou confiar no header `Host`, que é do cliente — e a
 * action, de propósito, devolve só o PATH.
 */
export function AvisoDeWebhook({ caminho }: { caminho: string }) {
  const origem = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
      <p className="font-medium">Cole esta URL no webhook da instância, no painel da Evolution:</p>
      <code className="mt-2 block overflow-x-auto rounded bg-background p-2 text-xs" data-testid="url-webhook">
        {origem}
        {caminho}
      </code>
      <p className="mt-2 text-xs text-muted-foreground">
        Ela não aparece de novo. Se perder, gere outra pelo botão &ldquo;Nova URL&rdquo; — a antiga
        deixa de funcionar na hora.
      </p>
    </div>
  );
}

export function ConexoesTable({ conexoes }: { conexoes: ConexaoApresentada[] }) {
  const router = useRouter();
  const [trocandoChave, setTrocandoChave] = useState<string | null>(null);
  const [chaveNova, setChaveNova] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [webhookPath, setWebhookPath] = useState<string | null>(null);
  const [processando, iniciar] = useTransition();

  async function executar(rotulo: string, acao: () => Promise<{ ok: boolean; erro?: string }>) {
    setErro(null);
    try {
      const resultado = await acao();
      if (!resultado.ok) {
        setErro(resultado.erro ?? rotulo);
        return false;
      }
      router.refresh();
      return true;
    } catch (erroDeRede) {
      setErro(registrarFalhaDeRede(rotulo, erroDeRede));
      return false;
    }
  }

  if (conexoes.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Nenhuma conexão cadastrada. Sem uma conexão ativa, esta empresa não recebe nem envia
        mensagem de WhatsApp — não existe credencial padrão de ambiente.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {erro ? <p className="text-sm text-destructive">{erro}</p> : null}
      {webhookPath ? <AvisoDeWebhook caminho={webhookPath} /> : null}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 font-medium">Nome</th>
            <th className="py-2 font-medium">Instância</th>
            <th className="py-2 font-medium">Chave</th>
            <th className="py-2 font-medium">Última troca</th>
            <th className="py-2 font-medium">Estado</th>
            <th className="py-2 font-medium">Ações</th>
          </tr>
        </thead>
        <tbody>
          {conexoes.map((conexao) => (
            <tr key={conexao.id} className="border-b align-top" data-testid={`conexao-${conexao.id}`}>
              <td className="py-2">
                {conexao.nome}
                <div className="text-xs text-muted-foreground">{conexao.dominio}</div>
              </td>
              <td className="py-2">{conexao.instancia}</td>
              <td className="py-2">
                {/* A máscara chega PRONTA do servidor. O cliente nunca recebeu
                    o valor real para poder derivá-la. */}
                <code data-testid={`mascara-${conexao.id}`}>{conexao.mascara}</code>
              </td>
              <td className="py-2 text-xs text-muted-foreground">
                {conexao.segredoAtualizadoEm.toLocaleDateString("pt-BR")}
                {conexao.segredoAtualizadoPor ? ` · ${conexao.segredoAtualizadoPor}` : ""}
              </td>
              <td className="py-2">{conexao.ativa ? "Ativa" : "Inativa"}</td>
              <td className="space-x-2 py-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={processando}
                  onClick={() => {
                    setChaveNova("");
                    setTrocandoChave(trocandoChave === conexao.id ? null : conexao.id);
                  }}
                >
                  Substituir chave
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={processando}
                  onClick={() =>
                    iniciar(async () => {
                      await executar("Falha ao mudar o estado da conexão", () =>
                        definirAtivaAction({ id: conexao.id, ativa: !conexao.ativa })
                      );
                    })
                  }
                >
                  {conexao.ativa ? "Desativar" : "Ativar"}
                </Button>

                {/* Confirmação em DOM (`ConfirmarDialogo`), nunca
                    `window.confirm`: o diálogo nativo bloqueia a thread e é
                    invisível ao DOM, então só existe num teste através de um
                    canal lateral que, se ninguém armar, faz o Playwright
                    descartá-lo sozinho — o clique "funciona", nada acontece, e
                    a falha aparece numa asserção adiante sem dizer por quê.
                    O raciocínio inteiro está em `components/confirmar-dialogo.tsx`. */}
                <ConfirmarDialogo
                  gatilho={(abrir) => (
                    <Button type="button" variant="outline" size="sm" onClick={abrir} disabled={processando}>
                      Nova URL
                    </Button>
                  )}
                  titulo="Gerar uma URL de webhook nova?"
                  descricao={
                    "A URL atual para de funcionar na hora, e as mensagens deixam de chegar até " +
                    "você colar a nova no painel da Evolution. A conexão continua marcada como " +
                    "Ativa — o CRM não tem como saber que o painel ainda aponta para a antiga."
                  }
                  rotuloConfirmar="Gerar nova URL"
                  rotuloConfirmando="Gerando..."
                  onConfirmar={async () => {
                    setErro(null);
                    try {
                      const resultado = await regenerarWebhookAction({ id: conexao.id });
                      if (!resultado.ok) {
                        setErro(resultado.erro);
                        return;
                      }
                      setWebhookPath(resultado.webhookPath);
                      router.refresh();
                    } catch (erroDeRede) {
                      setErro(registrarFalhaDeRede("Falha ao gerar URL nova", erroDeRede));
                    }
                  }}
                />

                <ConfirmarDialogo
                  gatilho={(abrir) => (
                    <Button type="button" variant="outline" size="sm" onClick={abrir} disabled={processando}>
                      Apagar
                    </Button>
                  )}
                  titulo={`Apagar a conexão "${conexao.nome}"?`}
                  descricao={
                    "As conversas ficam no histórico, mas deixam de saber por onde entraram — e " +
                    "voltam a ser respondidas pela única conexão ativa da empresa, ou por " +
                    "nenhuma, se houver mais de uma. A chave de API é apagada junto e não tem " +
                    "como ser recuperada."
                  }
                  rotuloConfirmar="Apagar conexão"
                  exigirDigitar={conexao.nome}
                  onConfirmar={async () => {
                    await executar("Falha ao apagar a conexão", () =>
                      apagarConexaoAction({ id: conexao.id })
                    );
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {trocandoChave ? (
        <form
          className="flex flex-wrap items-end gap-2 rounded-md border p-3"
          onSubmit={(evento) => {
            evento.preventDefault();
            const id = trocandoChave;
            iniciar(async () => {
              const ok = await executar("Falha ao substituir a chave", () =>
                substituirSegredoAction({ id, segredo: chaveNova })
              );
              if (ok) {
                // Limpo assim que a action confirma: manter o valor no estado
                // deixaria o segredo na memória do navegador sem razão.
                setChaveNova("");
                setTrocandoChave(null);
              }
            });
          }}
        >
          <div className="flex-1 space-y-1">
            <label className="text-sm" htmlFor="chave-nova">
              Chave nova
            </label>
            <Input
              id="chave-nova"
              type="password"
              autoComplete="off"
              value={chaveNova}
              onChange={(e) => setChaveNova(e.target.value)}
              placeholder="cole a apikey nova"
              required
            />
          </div>
          <Button type="submit" disabled={processando}>
            {processando ? "Substituindo..." : "Substituir"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setTrocandoChave(null)}>
            Cancelar
          </Button>
        </form>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 9: O item de menu — o caso primeiro (RED)**

Acrescentar a `tests/unit/painel-nav.test.tsx`, junto dos casos de "Equipe"
(que testam a mesma coisa: link filtrado por PAPEL, não por módulo):

```ts
  // "Configurações" (/configuracoes) é filtrado por PAPEL, como "Equipe":
  // administração é núcleo, existe em todo fork. Esconder o link não é a
  // defesa — a página redireciona e cada Server Action checa a permissão —
  // mas mostrar a um VENDEDOR um link que só leva a um redirecionamento é
  // ruído.
  it("mostra Configurações para ADMIN", () => {
    montar({ papelUsuario: "ADMIN" });
    expect(screen.getByRole("link", { name: "Configurações" })).toBeTruthy();
  });

  it("não mostra Configurações para GESTOR nem VENDEDOR", () => {
    montar({ papelUsuario: "GESTOR" });
    expect(screen.queryByRole("link", { name: "Configurações" })).toBeNull();
    cleanup();

    montar({ papelUsuario: "VENDEDOR" });
    expect(screen.queryByRole("link", { name: "Configurações" })).toBeNull();
  });

  it("aponta para `/configuracoes`, não para a seção — a URL do menu é estável", () => {
    // Direto em `/configuracoes/conexoes`, o item de menu teria de mudar no
    // dia da segunda seção. `/configuracoes` redireciona para a primeira que a
    // pessoa pode ver.
    montar({ papelUsuario: "ADMIN" });
    expect(
      screen.getByRole("link", { name: "Configurações" }).getAttribute("href")
    ).toBe("/configuracoes");
  });
```

> Use o helper `montar` e o `cleanup` que o arquivo **já tem** — não crie
> helper novo.

```bash
npx vitest run tests/unit/painel-nav.test.tsx
```

Esperado: FAIL nos três casos novos — o link ainda não existe.

- [ ] **Step 10: O item de menu**

Em `src/components/nav-links.tsx`, acrescentar `Settings` ao import de
`lucide-react`, acrescentar `"configuracoes"` à união `IconeDoPainel` e a
entrada ao mapa:

```ts
const ICONES: Record<IconeDoPainel, LucideIcon> = {
  dashboard: LayoutDashboard,
  leads: Target,
  funil: Columns3,
  contatos: Users,
  tarefas: ListChecks,
  conversas: MessageSquare,
  equipe: UserCog,
  etapas: SlidersHorizontal,
  fluxos: Workflow,
  configuracoes: Settings,
};
```

Em `src/components/painel-nav.tsx`, no fim de `grupoExtra`:

```tsx
    // Aponta para `/configuracoes` (que redireciona para a primeira seção), e
    // não direto para `/configuracoes/conexoes`: assim o item de menu não
    // precisa mudar quando houver uma segunda seção.
    //
    // A condição é `gerenciar_conexoes` porque hoje ela é a permissão da ÚNICA
    // seção. Quando a segunda existir com outra permissão, isto vira um OU —
    // está escrito para não parecer esquecimento. Esconder o link nunca é o
    // gate de verdade (a página e as actions são), só evita ruído no menu.
    ...(papelUsuario && hasPermission(papelUsuario, "gerenciar_conexoes")
      ? [{ href: "/configuracoes", label: "Configurações", icone: "configuracoes" as const }]
      : []),
```

- [ ] **Step 11: Provar no navegador**

Criar `tests/e2e/configuracoes-conexoes.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

/**
 * A tela de conexões, de ponta a ponta.
 *
 * O que só um navegador prova, e por isso está aqui e não num teste de
 * unidade: que o valor digitado na apikey **não aparece no HTML servido**
 * depois de salvo, e que quem não é ADMIN não alcança a rota.
 *
 * A conexão criada aqui é apagada no `afterEach`, **por nome com prefixo
 * exclusivo**: o banco é o mesmo de desenvolvimento (⚠️ R1 da auditoria do
 * Ciclo 1a), e a auditoria do Ciclo 1c mediu fixture órfã envenenando execução
 * seguinte (⚠️ N2). A limpeza é pela própria tela, não por SQL, para que ela
 * também exercite o caminho de apagar.
 */
const NOME = `ZZE2EConexao-${Date.now()}`;
const APIKEY = "apikey-de-teste-descartavel-9z8y";

test.describe("Configurações → Conexões", () => {
  test("ADMIN cadastra, vê a máscara, substitui a chave e a máscara muda", async ({ page }) => {
    await page.goto("/configuracoes/conexoes");

    await page.getByLabel("Nome").fill(NOME);
    await page.getByLabel("Domínio da instância").fill("https://evolution.exemplo.invalid");
    await page.getByLabel("Nome da instância").fill(NOME);
    await page.getByLabel("Chave de API (apikey)").fill(APIKEY);
    await page.getByRole("button", { name: "Cadastrar conexão" }).click();

    // A URL do webhook aparece UMA vez, com a origem do navegador na frente.
    const url = page.getByTestId("url-webhook");
    await expect(url).toBeVisible();
    await expect(url).toContainText("/api/whatsapp/evolution/");

    const linha = page.getByRole("row", { name: new RegExp(NOME) });
    await expect(linha).toContainText("••••••••9z8y");

    // O HTML servido NÃO contém a apikey. É a prova de que a máscara é montada
    // no servidor a partir da coluna de 4 caracteres, e não recortada de um
    // valor real que tivesse viajado até aqui.
    await page.reload();
    expect(await page.content()).not.toContain(APIKEY);

    await linha.getByRole("button", { name: "Substituir chave" }).click();
    await page.getByLabel("Chave nova").fill("apikey-substituida-4c3d");
    await page.getByRole("button", { name: "Substituir", exact: true }).click();

    await expect(page.getByRole("row", { name: new RegExp(NOME) })).toContainText("••••••••4c3d");
  });

  test.afterEach(async ({ page }) => {
    // Limpeza pela própria tela — exercita o caminho de apagar e não deixa
    // resíduo no banco compartilhado.
    await page.goto("/configuracoes/conexoes");
    const linha = page.getByRole("row", { name: new RegExp(NOME) });
    if ((await linha.count()) === 0) return;
    await linha.getByRole("button", { name: "Apagar" }).click();
    await page.getByLabel(/digite/i).fill(NOME);
    await page.getByRole("button", { name: "Apagar conexão" }).click();
    await expect(page.getByRole("row", { name: new RegExp(NOME) })).toHaveCount(0);
  });
});

test.describe("quem não é ADMIN", () => {
  test("VENDEDOR não alcança /configuracoes/conexoes", async ({ page }) => {
    await page.goto("/configuracoes/conexoes");
    // `redirect("/")`, não 404: quem clicou num link antigo entende melhor
    // voltar ao painel. A defesa de verdade são as Server Actions.
    await expect(page).toHaveURL(/\/$/);
  });
});
```

> **Sessão:** este arquivo precisa entrar como ADMIN no primeiro `describe` e
> como VENDEDOR no segundo. Use **exatamente** o mecanismo que os outros specs
> deste repositório já usam (`tests/e2e/whatsapp-agente.spec.ts` faz a mesma
> distinção de papel) — `storageState`, fixture ou helper. **Não invente
> autenticação nova**, e não use `admin@exemplo.com`: as contas da suíte são
> `e2e-admin@teste.invalid` e `e2e-vendedor@teste.invalid`, provisionadas por
> `tests/e2e/global-setup.ts` com `E2E_SENHA`.
>
> O seletor `page.getByLabel(/digite/i)` do `afterEach` depende do rótulo que
> `ConfirmarDialogo` dá ao campo de `exigirDigitar`. **Leia o componente** e use
> o seletor que ele realmente expõe.

- [ ] **Step 12: Rodar tudo**

```bash
npx vitest run tests/unit/conexoes-actions.test.ts tests/unit/painel-nav.test.tsx
npm run typecheck
npm run lint
npm run build
```

Esperado: verdes, e o `build` listando as rotas novas
`ƒ /configuracoes`, `ƒ /configuracoes/conexoes` e
`ƒ /api/whatsapp/evolution/[companyId]/[token]`. **Cole a tabela de rotas** —
o número de rotas ESTÁTICAS precisa continuar **1** (`/_not-found`).

```bash
npx playwright test tests/e2e/configuracoes-conexoes.spec.ts --workers=1
```

Esperado: verde. Se falhar por seletor, ajuste o seletor — **não** afrouxe a
asserção do HTML sem a apikey, que é a razão de o arquivo existir.

- [ ] **Step 13: Commit**

```bash
git add src/core/conexoes/actions.ts "src/app/(painel)/configuracoes" src/components/conexoes src/components/nav-links.tsx src/components/painel-nav.tsx tests/unit/conexoes-actions.test.ts tests/unit/painel-nav.test.tsx tests/e2e/configuracoes-conexoes.spec.ts
git commit -m "$(cat <<'EOF'
feat(configuracoes): a aba onde a credencial e cadastrada, e nunca lida

Decisao do dono: credencial de API se configura na interface, nao em
variavel de ambiente. Ate aqui trocar a apikey era um redeploy, ou seja,
precisava de um engenheiro.

Uma LISTA e nao um formulario unico porque multi-instancia e decisao
travada do programa -- um formulario esconderia a segunda conexao e
faria a segunda instancia parecer impossivel.

A mascara chega PRONTA do servidor, montada da coluna de 4 caracteres:
o cliente nunca recebeu valor real para poder recorta-la. O e2e prova
isso do jeito que so um navegador prova -- o HTML servido nao contem a
apikey digitada.

A URL do webhook aparece UMA vez. Nao contradiz "o segredo nunca volta":
a regra e sobre DECIFRAR, e este token nao veio do cofre -- o servidor
acabou de sortea-lo e guardou so o sha256. A alternativa seria guardar o
token legivel para exibir depois, trocando uma entrega controlada por um
segredo permanentemente legivel.

Sem portao de modulo nesta tela, ao contrario de /conversas/agente:
exigir o modulo whatsapp para cadastrar a conexao criaria um
ovo-e-galinha em que ninguem configura nada.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: CONTRAI — as quatro variáveis `EVOLUTION_*` morrem

**DEPENDE DE AÇÃO DO DONO:** não (a remoção da Vercel é ação de implantação, depois do ciclo — ver o topo deste plano).

**Files:**
- Modify: `src/modules/whatsapp/gateway/index.ts`
- Modify: `tests/unit/whatsapp-config-preguicosa.test.ts`
- Modify: `.env.example`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `gatewayDaCredencial`, `gatewayDaEmpresa`, `gatewayDaConversa`, `CanalNaoImplementadoError` (`./fabrica`, Tarefa 6).
- Produces: `gateway/index.ts` deixa de ler `process.env` e de exportar `whatsappGateway`; passa a ser a **porta única** do pacote, reexportando os tipos e a fábrica. Nenhum consumidor precisa mudar — a Tarefa 7 e a Tarefa 8 já importam de `./fabrica`.

- [ ] **Step 1: Escrever a varredura que falha (RED)**

Reescrever o `describe("gateway do WhatsApp", ...)` de
`tests/unit/whatsapp-config-preguicosa.test.ts`. O `describe("provedor de LLM")`
e o `vi.mock("server-only")` **ficam como estão** — `OPENAI_API_KEY` não é
deste ciclo. Remover `EVOLUTION_DOMAIN`, `EVOLUTION_INSTANCE` e
`EVOLUTION_APIKEY` do array `VARIAVEIS` e acrescentar `COFRE_CHAVE_MESTRA`.

O bloco novo:

```ts
describe("gateway do WhatsApp", () => {
  it("pode ser importado sem NENHUMA credencial — é isso que mantém o build de pé", async () => {
    // A metade 1 da razão deste arquivo existir, e ela não mudou: `next build`
    // avalia todo módulo alcançável para coletar a configuração das rotas, e a
    // cadeia `api/queues/whatsapp-turn` → `turno.ts` → `gateway` já derrubou o
    // deploy de produção por três dias.
    //
    // O que MUDOU no Ciclo 2a é que a credencial saiu do ambiente e foi para o
    // banco: agora importar sem lançar significa também não CONSULTAR nada.
    const modulo = await import("../../src/modules/whatsapp/gateway");
    expect(typeof modulo.gatewayDaConversa).toBe("function");
  });

  it("mas USAR sem a chave mestra do cofre ainda lança, dizendo o que falta", async () => {
    // A metade 2: adiar a validação não pode virar engolir a validação.
    const { gatewayDaCredencial } = await import("../../src/modules/whatsapp/gateway");
    // `gatewayDaCredencial` não decifra — quem decifra é `core/conexoes/leitura`.
    // O caminho que lança sem chave é o da leitura, e ele tem caso próprio em
    // `tests/unit/cofre-chave.test.ts` ("variável ausente lança
    // CofreSemChaveError"). Aqui provamos o que É deste módulo: canal não
    // implementado e conexão incompleta lançam com nome.
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

  it("NENHUM arquivo de `src/` menciona `EVOLUTION_` — a ponte morreu inteira", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");

    function varrer(dir: string): string[] {
      return readdirSync(dir).flatMap((nome) => {
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) return varrer(caminho);
        return /\.tsx?$/.test(nome) ? [caminho] : [];
      });
    }

    // `EVOLUTION_COMPANY_ID` era ⚠️ R5 da auditoria do Ciclo 1a, com a nota
    // "que o Ciclo 2 remove". Sem esta varredura, ela voltaria por um "só
    // enquanto isso" e ninguém veria — foi exatamente assim que `User.papel`
    // sobreviveu a três tentativas de remoção.
    const comMencao = varrer("src").filter((arquivo) =>
      readFileSync(arquivo, "utf8").includes("EVOLUTION_")
    );
    expect(comMencao).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
npx vitest run tests/unit/whatsapp-config-preguicosa.test.ts
```

Esperado: FAIL — `gateway/index.ts` ainda exporta `whatsappGateway`, ainda lê
`EVOLUTION_*`, e a varredura acha pelo menos esse arquivo.

- [ ] **Step 3: Reescrever `gateway/index.ts` inteiro**

Substituir **todo** o conteúdo de `src/modules/whatsapp/gateway/index.ts` por:

```ts
import "server-only";

/**
 * A porta única do pacote `gateway`.
 *
 * ## O que morreu aqui, no Ciclo 2a, e por quê
 *
 * Este arquivo tinha um schema Zod lendo `EVOLUTION_DOMAIN`,
 * `EVOLUTION_INSTANCE` e `EVOLUTION_APIKEY`, e um `Proxy` que construía UM
 * `EvolutionGateway` por processo, na primeira propriedade acessada.
 *
 * As duas coisas eram certas para um deploy de uma empresa só e são erradas
 * agora, por motivos diferentes:
 *
 * - **As variáveis** eram credencial por DEPLOY para um dado que é por
 *   EMPRESA. Não davam lugar para a segunda empresa, e trocar a chave era um
 *   redeploy.
 * - **O singleton** era uma credencial por processo, e um processo serve
 *   várias empresas. Com credencial por empresa, ele responderia o cliente de
 *   uma pela instância de outra.
 *
 * O que NÃO morreu é a lição que este arquivo carregava: **nada de validação
 * em escopo de módulo.** `next build` avalia cada módulo alcançável para
 * coletar a configuração das rotas, e a cadeia
 * `api/queues/whatsapp-turn` → `turno.ts` → `gateway/index.ts` fazia a
 * validação rodar em tempo de BUILD:
 *
 *     Failed to collect configuration for /api/queues/whatsapp-turn
 *     [cause]: Configuração do gateway de WhatsApp inválida: ...
 *
 * O build inteiro falhava — leads, funil e login inclusos, que não têm relação
 * nenhuma com WhatsApp. Ninguém percebeu por três dias porque o sintoma só
 * aparece na Vercel: numa máquina de desenvolvimento o `.env` tem tudo.
 *
 * A regra continua e agora é mais larga: importar este módulo não pode ler
 * ambiente **nem consultar o banco**. Quem resolve credencial é `./fabrica`,
 * e ela só toca o banco quando é CHAMADA. Há caso de teste para as duas
 * metades em `tests/unit/whatsapp-config-preguicosa.test.ts` — importar não
 * lança, usar sem configuração lança.
 *
 * ## Onde a credencial vive agora
 *
 * Em `WhatsappConnection`, por empresa, com a apikey cifrada
 * (`src/core/cofre/`). A resolução é `src/core/conexoes/leitura.ts`, e a
 * construção do adaptador é `./fabrica`.
 */

export type { WhatsappGateway, EventoWhatsapp, TipoMensagemWhatsapp } from "./tipos";

export {
  gatewayDaCredencial,
  gatewayDaConversa,
  gatewayDaEmpresa,
  CanalNaoImplementadoError,
} from "./fabrica";
```

- [ ] **Step 4: Rodar para ver passar**

```bash
npx vitest run tests/unit/whatsapp-config-preguicosa.test.ts
npm run typecheck
npm run lint
grep -rn "EVOLUTION_" src/ ; echo "saida acima deve estar VAZIA"
grep -rn "whatsappGateway" src/ ; echo "saida acima deve estar VAZIA"
```

Esperado: teste verde, `typecheck` e `lint` sem erro, e os **dois** greps sem
nenhuma linha. Cole as saídas.

- [ ] **Step 5: Limpar `.env.example`**

Remover **os quatro blocos inteiros** — comentário e linha — de
`EVOLUTION_DOMAIN`, `EVOLUTION_INSTANCE`, `EVOLUTION_APIKEY` e
`EVOLUTION_COMPANY_ID`, e o bloco de `WHATSAPP_WEBHOOK_TOKEN`. No lugar dos
cinco, dentro da seção `--- Atendente de WhatsApp ---`:

```
# A credencial da Evolution NAO mora mais aqui.
#
# Ate o Ciclo 2a este arquivo pedia EVOLUTION_DOMAIN, EVOLUTION_INSTANCE,
# EVOLUTION_APIKEY, EVOLUTION_COMPANY_ID e WHATSAPP_WEBHOOK_TOKEN. As cinco
# morreram juntas: dominio, instancia e apikey viraram colunas de
# WhatsappConnection (uma linha por conexao, POR EMPRESA, com a apikey
# cifrada pelo cofre); o token do webhook virou uma coluna de hash na mesma
# linha; e EVOLUTION_COMPANY_ID -- que era uma constante do DEPLOY dizendo de
# quem e toda conversa que entra -- deixou de ser necessaria porque o webhook
# resolve a empresa pela CONEXAO.
#
# Por que NAO viraram "padrao de arquivo, sobreposto pelo banco", como
# config/client.ts no Ciclo 1c: aquele padrao e certo para MARCA e errado para
# CREDENCIAL. Marca errada abre o painel com a cor generica e se ve na hora;
# credencial errada faz a empresa B responder clientes pelo numero da empresa
# A, e nao se ve nunca. Um padrao de credencial por deploy e literalmente
# Company.findFirst() com outro nome.
#
# Cadastre a conexao em Configuracoes -> Conexoes, como ADMIN, e cole no
# painel da Evolution a URL de webhook que a tela devolve UMA vez.
#
# Empresa sem conexao ativa = WhatsApp desligado para ela, com erro nomeado.
# Nao ha fallback, de proposito.
```

- [ ] **Step 6: Atualizar `CLAUDE.md`**

Em "Armadilhas conhecidas", acrescentar ao fim da lista:

```markdown
- **Credencial de canal não mora no ambiente.** `EVOLUTION_*` morreram no Ciclo
  2a. A apikey vive cifrada em `WhatsappConnection.segredoCifrado`, por empresa,
  e a chave mestra é `COFRE_CHAVE_MESTRA` — a única peça que continua fora do
  banco, e a razão de o dump valer nada sozinho. **Sem ela o WhatsApp não sobe**,
  e não existe fallback: um padrão por deploy responderia clientes de uma
  empresa pela instância de outra.
- **O webhook da Evolution carrega `companyId` E token no path.** O `companyId`
  é hipótese, não autoridade — quem decide é o token, porque a busca é escopada
  naquela empresa. Trocar a URL do webhook no painel da Evolution é parte de
  cadastrar uma conexão.
```

Em "Decisões travadas", ajustar a decisão 4:

```markdown
4. **Evolution: conexões com QR Code pelo CRM**, multi-instância. O Ciclo 2a
   entregou o cofre, a tabela por empresa e a aba de administração; **o QR Code
   e o estado de pareamento ficaram para o Ciclo 2c** — nada disso é provável
   sem uma instância Evolution acessível, e este ambiente não tem uma.
```

- [ ] **Step 7: Rodar a verificação e commitar**

```bash
npm run typecheck && npm run lint && npm run build
```

Esperado: os três verdes. Cole a tabela de rotas do `build`.

```bash
git add src/modules/whatsapp/gateway/index.ts tests/unit/whatsapp-config-preguicosa.test.ts .env.example CLAUDE.md
git commit -m "$(cat <<'EOF'
refactor(gateway): as quatro EVOLUTION_* morrem, e a varredura impede a volta

EVOLUTION_COMPANY_ID era a ponte que o Ciclo 1a criou dizendo, por
escrito, "que o Ciclo 2 remove" -- R5 da auditoria daquele ciclo. As
outras tres eram credencial por DEPLOY para um dado que e por EMPRESA.

O singleton do gateway morre junto: um objeto por processo carrega uma
credencial, e um processo serve varias empresas.

Nao viraram "padrao de arquivo sobreposto pelo banco" como o Ciclo 1c fez
com a marca, e a diferenca e o custo do padrao errado: marca errada abre
o painel na cor generica e se ve na hora; credencial errada faz a empresa
B responder pelo numero da A, e nao se ve nunca.

Ha varredura de fonte afirmando que NENHUM arquivo de src/ menciona
EVOLUTION_. Sem ela a variavel voltaria por um "so enquanto isso" -- foi
assim que User.papel sobreviveu a tres tentativas de remocao.

O que NAO morreu e a licao: importar este modulo continua nao podendo
ler ambiente, e agora tambem nao pode consultar o banco.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Verificação final e preparo da auditoria

**DEPENDE DE AÇÃO DO DONO:** não. (Depois desta tarefa, o dono precisa
**rotacionar a senha do admin** — 🔍 NV5 —, porque o Step 2 roda `npm test`.)

**Files:** nenhum de código. Só medições coladas e, se algo estiver vermelho, a correção.

**Interfaces:**
- Consumes: tudo o que as Tarefas 1-10 produziram.
- Produces: o relatório de medições que a **Fase 1 da skill `auditoria-seguranca`** vai consumir. `AGENTS.md` exige que a auditoria rode sobre a superfície que a branch mexeu, seja entregue, e que **a correção só comece depois da aprovação do dono**.

- [ ] **Step 1: Invocar as três skills de banco**

`supabase`, `supabase-postgres-best-practices`, `auditing-supabase-security` —
**as três juntas**, antes de qualquer medição que toque Postgres.

- [ ] **Step 2: A suíte inteira, em série**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npm run typecheck
npm run lint
npm test
npm run build
```

**Isto roda o seed** e reescreve o `senhaHash` de `admin@exemplo.com` e
`vendedor@exemplo.com` com literais versionados (⚠️ R1 / 🔍 NV5 do Ciclo 1a).
É o único passo do plano autorizado a fazer isso, e o item 1 de "Só um humano
pode fazer" do relatório precisa registrá-lo. Cole as quatro saídas.

- [ ] **Step 3: O e2e, com um worker**

```bash
npx playwright test --workers=1
```

Um worker, não o padrão: a auditoria do Ciclo 1c mediu `seguranca-headers.spec.ts`
falhando de forma **determinística** com `workers > 1` (⚠️ N1), por causa do
`@unique` global de `Contact.telefone` (⚠️ R2). Cole a saída, e cole também a
lista de falhas **se houver** — a mesma auditoria registrou que o conjunto de
falhas do e2e **não é estável entre execuções** (⚠️ N3), então uma falha aqui
precisa ser comparada com a linha de base daquele documento antes de virar
achado deste ciclo.

- [ ] **Step 4: A catraca do prisma cru**

```bash
npx vitest run tests/unit/catraca-prisma-cru.test.ts
grep -n "LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS" tests/unit/catraca-prisma-cru.test.ts
grep -n "EXCECAO_PERMANENTE" -A 8 eslint.config.mjs | head -20
```

Esperado: verde, `LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS = 0`, e
`EXCECAO_PERMANENTE` com as **mesmas 5** entradas de antes do ciclo
(`credenciais.ts`, `session.ts`, `users/empresa.ts`, `rate-limit/limiter.ts`,
`tenancy/escopo.ts`). **Uma sexta entrada é falha desta tarefa**, não achado a
registrar: o desenho da §5.5 do spec existe justamente para que a resolução do
webhook não precise de exceção. Cole as três saídas.

- [ ] **Step 5: A blindagem da tabela nova, e o advisor**

```bash
npx playwright test tests/e2e/banco-blindado.spec.ts --workers=1
```

Esperado: verde. Ele varre `pg_class`/`role_table_grants` sem lista fixa.

E, pela MCP do Supabase, `get_advisors(security)`. Linha de base antes deste
ciclo: **16 × `rls_enabled_no_policy` (INFO) + 2 × WARN de `rls_auto_enable`**.
Esperado agora: **17 × INFO** e os **mesmos 2** WARN. Qualquer coisa diferente
disso é **achado**, não ruído — cole a saída inteira.

- [ ] **Step 6: Sondar o banco**

Pela MCP do Supabase (`execute_sql`):

```sql
select count(*) as conexoes from "WhatsappConnection";
select count(*) as com_connection_id from "Conversation" where "connectionId" is not null;
select count(*) as sem_connection_id from "Conversation" where "connectionId" is null;
select count(*) as segredo_em_texto from "WhatsappConnection" where "segredoCifrado" not like 'v1.%';
```

Esperado: a quarta consulta devolve **0**. Uma linha que não começa com `v1.`
é segredo gravado sem passar pelo cofre — **pare e reporte**. As três primeiras
são contexto para o relatório: `sem_connection_id > 0` é o normal (conversas
anteriores ao ciclo) e é o que a dívida D-nova abaixo descreve.

- [ ] **Step 7: Fechar ou reafirmar os NÃO VERIFICADOS do spec**

Para cada item da §10.1 do spec, escrever **fechado** (com a medição colada) ou
**continua aberto** (com o comando que um humano roda). Os que este ambiente
**não** fecha, e a razão:

| # | Item | Estado esperado ao fim |
| --- | --- | --- |
| NV1 | Custo do `sha256` + índice com muitas conexões | **aberto** — o banco tem uma empresa; medir exige volume |
| NV2 | `pg_dump` não contém a apikey | **aberto** — exige rodar `pg_dump` contra o Supabase |
| NV3 | A Evolution aceita a apikey lida do banco | **aberto** — não há instância Evolution acessível neste ambiente |
| NV4 | O painel da Evolution aceita a URL com dois segmentos | **aberto** — depende de instância viva |
| NV5 | `prisma migrate dev` não acusa deriva com o enum novo | **aberto** — exige shadow database |
| NV6 | Senha do admin no banco de desenvolvimento | **aberto**, e agora URGENTE — o Step 2 rodou o seed |

- [ ] **Step 8: Escrever o relatório e PARAR**

Rodar a **Fase 1** da skill `auditoria-seguranca` sobre a superfície que esta
branch mexeu — cofre, conexões, webhook, tela e as quatro variáveis removidas —,
entregar o relatório em `docs/auditorias/2026-08-20-ciclo-2a-cofre-credenciais.md`
e **parar**.

Regra de `AGENTS.md`, literal: correção só começa depois que o dono aprova o
relatório. Todo item marcado `✅ OK` carrega o comando executado e a saída
obtida; o que este ambiente não prova sai como `🔍 NÃO VERIFICADO` com o comando
que um humano roda — **nunca** como "ok" presumido.

O relatório precisa registrar, no mínimo:

- **⚠️ D4 do spec, agora com dado:** `Conversation.waId` é `@unique` GLOBAL e
  passou a ser **alcançável**. Colar a contagem do Step 6.
- **⚠️ A vizinhança que o cofre NÃO protege:** a auditoria do Ciclo 1c lista,
  como herdado e não corrigido, que *"a chave global da Evolution é
  `nateksoft`"* e que `N8N_ENCRYPTION_KEY=nateksoft`. Cifrar bem a apikey da
  instância dentro do CRM enquanto existe uma chave global adivinhável **na
  Evolution** é meia defesa, e ela precisa ser dita inteira no mesmo documento.
- **⚠️ Dívida nova:** conversas com `connectionId` nulo respondem pela única
  conexão ativa e **recusam** se houver mais de uma. Colar quantas existem.
- **🔍 NV6 urgente:** `npm test` rodou no Step 2.

- [ ] **Step 9: Commit do relatório**

```bash
git add docs/auditorias/2026-08-20-ciclo-2a-cofre-credenciais.md
git commit -m "$(cat <<'EOF'
docs(auditoria): fecha o Ciclo 2a medindo, e diz o que a medicao nao alcanca

Fase 1 da auditoria-seguranca sobre a superficie que a branch mexeu:
cofre, conexoes, webhook, tela e as quatro variaveis removidas. Todo item
OK carrega comando e saida; o que este ambiente nao prova sai como NAO
VERIFICADO com o comando que um humano roda.

Registra o que ficou pior por consequencia: Conversation.waId global-unica
deixou de ser teorica agora que a segunda empresa e alcancavel.

E registra a vizinhanca que o cofre nao alcanca -- a chave global da
Evolution continua sendo o nome da empresa. Cifrar bem a apikey da
instancia dentro do CRM enquanto isso e verdade e meia defesa, e um
relatorio que nao diz isso deixa o leitor achando que fechou.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Auto-revisão deste plano

Feita depois de escrever as onze tarefas, comparando com o spec com olhos
frescos. O que foi encontrado está **corrigido acima**, não listado como
pendência.

### 1. Cobertura do spec

| Seção do spec | Tarefa que entrega |
| --- | --- |
| §4.1 Segredo cifrado em repouso | 1 (coluna) + 2 (cifra) |
| §4.2 O segredo nunca volta ao navegador | 5 (`listarConexoes`) + 9 (máscara, e2e) |
| §4.2 A exceção nomeada do token do webhook | 5 (`criarConexao` devolve uma vez) + 9 (`AvisoDeWebhook`) |
| §4.3 Nunca em `AuditLog` | 5 (`auditar` sem `antes`/`depois`, e o caso que varre as 6 ações) |
| §4.4 Nunca no Sentry | 3 (dois padrões + redação na origem) |
| §4.5 `gerenciar_conexoes` | 4 |
| §4.6 Credencial por empresa, via `prismaDaEmpresa` | 5 (leitura e escrita) + 11 (catraca em zero) |
| §5.1 Algoritmo, formato, AAD, rotação | 2 |
| §5.2 `EVOLUTION_*` morrem | 7 (`COMPANY_ID`) + 10 (as outras três + varredura) |
| §5.3 O modelo no Prisma | 1 |
| §5.4 Chave faltando/mudada | 2 (cinco erros nomeados, cada um com caso) |
| §5.5 Como o webhook resolve a empresa | 5 (`resolverConexaoPorWebhook`) + 7 (a rota) |
| §5.6 De onde o consumidor da fila tira a credencial | 6 (fábrica) + 8 (`turno.ts`, `agente.ts`) |
| §5.7 A tela | 9 |
| §6 Meta cabe sem reescrita | 1 (enum) + 6 (recusa nomeada com teste) |
| §7 QR fora do escopo | nenhuma tarefa — e o comentário de `ativa` em `prisma/schema.prisma` (Tarefa 1) registra por quê |
| §8 P1-P24 | todas têm tarefa; ver a tabela abaixo |

**Provas do spec sem tarefa: nenhuma.** P19 (tabela blindada) e P21 (catraca)
são exercitadas por testes **que já existem** e são rodadas nas Tarefas 1 e 11.

### 2. Varredura de placeholders

Nenhum "TBD", "implementar depois" ou "similar à Tarefa N". Três pontos onde o
plano manda **ler o que já existe** em vez de repetir código — e os três são
deliberados, porque copiar seria inventar um arquivo que não conheço:

- Tarefa 4, o último caso: o plano dá a versão que **não** depende de export
  novo, e diz para usar a enumeração que o arquivo já tiver.
- Tarefa 7 e 8: adaptar mocks e fixtures **existentes**, com o aviso explícito
  de **não criar fixture nova** e de **não remover caso nenhum**.
- Tarefa 9, o e2e: usar o mecanismo de sessão que os outros specs já usam, com
  os nomes das contas (`e2e-admin@teste.invalid`) e a proibição de usar
  `admin@exemplo.com`.

### 3. Consistência de tipos e nomes

Conferido de ponta a ponta. Os que atravessam tarefas:

- `cifrar(texto, { companyId, proposito })` / `decifrar(blob, { companyId, proposito })` — T2, usados em T5.
- `PROPOSITO_APIKEY_CONEXAO` — T2, usado em T5 e no isolamento.
- `CredencialDeConexao` com `apiKey` (não `segredo`, não `apikey`) — T5, consumido em T6.
- `gatewayDaCredencial` / `gatewayDaConversa` / `gatewayDaEmpresa` — T6, consumidos em T7, T8 e reexportados em T10.
- `ingerirMensagem(evento, { companyId, connectionId })` e `ResultadoIngestao.connectionId` — T7, consumidos pelo mock de teste na mesma tarefa.
- `ConexaoApresentada.mascara` (string pronta, não `ultimos4`) — T5, consumido em T9.
- `ResultadoComWebhook.webhookPath` (**path**, não `webhookUrl`) — T9, consumido por `AvisoDeWebhook`.
- `"gerenciar_conexoes"` — T4, consumida em T9 (página, layout, actions, menu).
- As **quatro** ações sensíveis (`substituir_segredo_conexao`, `desativar_conexao`, `apagar_conexao`, `regenerar_webhook_conexao`) batem entre T5 (o serviço que as emite) e T5 (o caso que as exige em `ACOES_SENSIVEIS`).

**Quatro inconsistências foram encontradas e corrigidas:**

1. A primeira redação da Tarefa 9 devolvia `webhookUrl` da action e montava a
   origem no servidor, o que exigiria uma variável de ambiente nova —
   contradizendo a §5.2 do spec, que **mata** variáveis em vez de criar. Virou
   `webhookPath`, com a origem vindo de `window.location.origin`.
2. A Tarefa 5 citava `tests/unit/audit-alerta.test.ts`, que **não existe**. O
   arquivo que importa `ACOES_SENSIVEIS` é `tests/unit/alerta-atividade.test.ts`
   (medido: `grep -rln "ACOES_SENSIVEIS" tests/`), e ele **não** afirma o
   tamanho da lista — a instrução condicional "atualize de 10 para 14" virou o
   fato medido: acrescentar entradas não o quebra.
3. A Tarefa 5 não registrava a relação nova em `RELACOES_SENSIVEIS`
   (`tests/unit/consultas-estreitas.test.ts`), cujo próprio comentário avisa que
   **uma relação que falta é buraco silencioso na regra**.
   `WhatsappConnection.segredoAtualizadoPor` aponta para `User`, a tabela do
   `senhaHash`. Virou um passo próprio, com a ressalva honesta de que **não
   conserta bug nenhum hoje** — registra a relação para que o dia do
   `segredoAtualizadoPor: true` seja vermelho.
4. A Tarefa 9 mudava `painel-nav.tsx` sem caso de teste. `tests/unit/painel-nav.test.tsx`
   já tem a família certa de casos (os de "Equipe": link filtrado por PAPEL, não
   por módulo) — o item de menu novo ganhou os três casos correspondentes,
   inclusive o que prende o `href` em `/configuracoes` e não na seção.

### 4. Ordem — nenhuma tarefa usa algo que uma posterior cria

| Tarefa | Depende de | Cria para |
| --- | --- | --- |
| 1 Schema | — | 5, 6, 7, 8 |
| 2 Cofre | — | 3 (o formato que o scrub redige), 5 |
| 3 Redação | 2 (só o FORMATO, que é literal no teste) | — |
| 4 Permissão | — | 9 |
| 5 Serviço | 1, 2 | 6, 7, 9 |
| 6 Fábrica | 5 | 7, 8, 10 |
| 7 Webhook | 1, 5, 6 | 8 (grava `connectionId`) |
| 8 Envio | 1, 6 | — |
| 9 Tela | 4, 5 | 10 (a tela existe antes de o ambiente morrer) |
| 10 Contração | 6, 7, 8, 9 | — |
| 11 Verificação | todas | — |

**Duas ordens foram corrigidas na revisão:**

1. A Tarefa 3 (scrub) estava depois da 5 numa primeira ordenação, e o padrão
   `SEGREDO_CIFRADO` precisa existir antes de haver blob circulando em log.
   Subiu para logo depois do cofre.
2. A **contração era a Tarefa 9 e a tela a 10**. Invertidas: apagar as
   variáveis antes de existir a tela deixaria o sistema num estado em que a
   única forma de cadastrar uma conexão seria SQL à mão. A tela vem primeiro.

**A regra de ouro deste plano** — *expande → migra → contrai* — existe porque
cada tarefa é executada por um subagente que só vê a própria. Fazer a troca de
gateway de uma vez deixaria a Tarefa 6 com `typecheck` vermelho, e o subagente
seguinte herdaria uma árvore quebrada sem saber por quê.

### 5. Tarefas que dependem de ação do dono

**Zero.** Cada tarefa carrega a linha `DEPENDE DE AÇÃO DO DONO: não`.

A chave mestra do ambiente **local** é gerada pela própria Tarefa 2, com o
valor **nunca impresso**:

```bash
grep -q '^COFRE_CHAVE_MESTRA=' .env || printf 'COFRE_CHAVE_MESTRA="%s"\n' "$(openssl rand -base64 32)" >> .env
```

As duas ações do dono são de **implantação**, depois do plano: gerar a chave da
Vercel (`openssl rand -base64 32`) e cadastrar a conexão pela tela, recolando a
URL de webhook no painel da Evolution. Estão no topo deste documento e na §10
do spec.
