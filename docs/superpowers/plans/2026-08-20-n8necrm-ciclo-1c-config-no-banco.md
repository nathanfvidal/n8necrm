# n8necrm — Ciclo 1c (Configuração de cliente no banco) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A marca e os módulos saem de `config/client.ts` e passam a viver numa tabela por empresa (`CompanyConfig`), com o arquivo virando o **padrão** e a linha do banco a **sobreposição**. O painel passa a servir a marca da empresa da sessão. Sem tela nova, sem permissão nova, sem campo removido do arquivo, sem ação do dono.

**Architecture:** Uma tabela nova, opcional, uma linha por empresa (`@@unique([companyId])`, mesma forma de `BotConfig`), com colunas escalares tipadas — não `Json`, porque a varredura de escopo do Ciclo 1d recusa `companyId` dentro de coluna `Json`. A leitura é uma função escopada por `prismaDaEmpresa(companyId)`, memoizada por requisição com `cache()` do React (chave no argumento explícito, nunca canal ambiente), que mescla banco sobre arquivo e valida o resultado com o **mesmo** `marcaSchema` que valida `config/client.ts`. O layout raiz continua síncrono com o padrão do arquivo — ele envolve `/login`, onde não existe empresa; o layout do painel, que já é `force-dynamic` e já tem `companyId`, aplica a marca da empresa por cima.

**Tech Stack:** Next.js 16.3 (App Router), React 19.2, Prisma 7.9 + `@prisma/adapter-pg`, Postgres 17.6 (Supabase `uzumzfxjcxrbxaucvfsr`), Zod 4, Tailwind 4, Vitest 4, Playwright 1.62.

**Spec:** `docs/superpowers/specs/2026-08-20-ciclo-1c-config-no-banco-design.md`

## Global Constraints

- **Idioma do código é português.** Comentário explica **por que**, com evidência.
- **Antes de qualquer trabalho que toque o banco, invocar as três skills juntas:** `supabase`, `supabase-postgres-best-practices`, `auditing-supabase-security`. Vale para as Tarefas 1, 3 (o arquivo de isolamento), 6, 7 e 8.
- **Este projeto usa migrations do Prisma, não o CLI do Supabase.** `supabase db pull`, schema declarativo e `supabase migration new` **não se aplicam**: as migrations são arquivos SQL escritos à mão em `prisma/migrations/`, aplicados por `npx prisma migrate deploy`.
- **Nenhuma política RLS e nenhum grant neste ciclo.** A tabela nova nasce com RLS **ligada e zero políticas** (default-deny), igual às outras. Se uma tarefa parecer precisar de política, ela saiu do escopo — pare e reporte.
- **Nenhum arquivo novo pode importar `@/lib/prisma`.** As três listas `VIOLADORES_TEMPORARIOS_*` de `eslint.config.mjs` estão **vazias** e há catraca (`tests/unit/catraca-prisma-cru.test.ts`, `LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS = 0`) que só permite diminuir. O esperado neste ciclo é **zero exceção nova**. Se alguma tarefa criar arquivo que precise do prisma cru, ele vira **exceção PERMANENTE** com justificativa verificável — e antes de acrescentar a linha, **pare e reporte**.
- **`companyId` viaja como parâmetro explícito.** `AsyncLocalStorage` e estado global continuam proibidos. `cache()` do React é permitido **porque a chave é o argumento**, não um canal ambiente — e porque fora de requisição ele degrada em custo, nunca em resposta (há dois casos de teste que exercitam isso, Tarefa 3).
- **Nunca `prisma.company.findFirst()`** como origem de empresa. Ler `Company` **pelo id que veio da sessão** é lookup, não origem, e é o que a Tarefa 3 faz.
- **Toda frase que afirme universal** — "todo", "sempre", "nenhum", "qualquer", "só" — precisa do caso de teste que a exercita, ou é reescrita.
- **Provar, não presumir.** O que este ambiente não provar sai como **NÃO VERIFICADO**, com o comando que um humano roda.
- **Não rodar `npm test` inteiro** salvo quando um passo pedir (Tarefa 8): ele executa o seed contra o banco de desenvolvimento real e reescreve a senha do admin (⚠️ R1 e 🔍 NV5 da auditoria do Ciclo 1a). Rodar os arquivos focados.
- **Nada de `vitest` em paralelo com outra execução de `vitest`.** O banco de teste não é separado do de desenvolvimento; duas execuções o envenenam.
- **Nunca ler nem imprimir o `.env`.**
- Toda mensagem de commit termina com:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **Branch de trabalho: `ciclo-1c-config-no-banco`**, criada a partir de `ciclo-1a-tenancy` (HEAD `6b90518`).

## Linha de base medida em 2026-08-20 — conferir se mudou antes de fechar

| Medida | Valor | Como |
| --- | --- | --- |
| Rotas estáticas | **1** (`/_not-found`); as outras 21 são dinâmicas | `npm run build` |
| Modelos de tenant | **11**, e `BotConfig` é o único com `companyId` único | `src/core/tenancy/escopo.ts:250`; `tests/unit/escopo-empresa.test.ts:811` |
| Exceções do lint | **5 permanentes, 0 temporárias** | `eslint.config.mjs:161,278,383,428` |
| Catraca de importadores temporários | `LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS = 0` | `tests/unit/catraca-prisma-cru.test.ts:108` |
| Advisor de segurança (Ciclo 1a) | 15 × `rls_enabled_no_policy` (INFO) + 2 × WARN de `rls_auto_enable` | `get_advisors(security)` |
| Consumidores de `config/client` | **14** arquivos | `grep -rn "config/client" src/ tests/ prisma/` |
| Chamadas de `moduloAtivo`/`exigirModulo` em produção | **8** (6 páginas + 2 em `painel-nav.tsx`) | `grep -rn "moduloAtivo\|exigirModulo" src/` |

## Ações do dono que travam a execução

**Nenhuma.** Este ciclo não toca painel do Supabase, não precisa de PAT, não pede segredo novo no `.env` e não registra provider. A migração roda com a `DIRECT_URL` que já está no ambiente.

Continua valendo, herdada: **depois de rodar `npm test` (Tarefa 8), rotacionar a senha do admin** — `tests/unit/seed.test.ts` grava um literal versionado no `senhaHash` (⚠️ R1 / 🔍 NV5 da auditoria do Ciclo 1a). Não é deste ciclo e não bloqueia nenhuma tarefa.

---

### Task 1: `CompanyConfig` no schema, a migração, e o 12º modelo de tenant

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260820180000_company_config/migration.sql`
- Modify: `src/core/tenancy/escopo.ts`
- Modify: `tests/unit/escopo-empresa.test.ts`

**Interfaces:**
- Consumes: `Company` e `User` (`prisma/schema.prisma`); `MODELOS_DE_TENANT` (`src/core/tenancy/escopo.ts`).
- Produces:
  - `model CompanyConfig` com os campos `id`, `companyId`, `corPrimaria String?`, `fonte String?`, `logoClaro String?`, `logoEscuro String?`, `modulos String[]`, `atualizadoEm`, `atualizadoPorId String?`, e `@@unique([companyId])`
  - `Company.config CompanyConfig?` e `User.configsEditadas CompanyConfig[]` (relação nomeada `"ConfigsEditadas"`)
  - `MODELOS_DE_TENANT` com **12** entradas
  - o delegate `prisma.companyConfig` gerado por `prisma generate`

- [ ] **Step 1: Medir o estado do banco antes de tocar nele**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx prisma migrate status
```

Esperado: `Database schema is up to date!`. Se aparecer migração pendente, **pare e reporte** — aplicar migração alheia não é desta tarefa.

Cole a saída.

- [ ] **Step 2: Escrever os casos que falham (RED)**

Duas asserções de `tests/unit/escopo-empresa.test.ts` mudam. Elas **não são afrouxadas** — a de deriva continua exigindo igualdade exata, e a de unicidade continua exigindo a lista completa.

Em `tests/unit/escopo-empresa.test.ts`, trocar o caso da linha 801 (`os 11 modelos de tenant nomeiam a relação company`) apenas no título:

```ts
    it("os 12 modelos de tenant nomeiam a relação `company` — a varredura depende do nome", () => {
```

E substituir o caso inteiro que hoje começa na linha 811 por:

```ts
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
```

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/escopo-empresa.test.ts
```

Esperado **agora**: vermelho em pelo menos dois casos —
`expect(comCompanyIdUnico).toEqual(["BotConfig", "CompanyConfig"])` recebendo `["BotConfig"]`, e o caso de deriva **ainda verde** (o modelo não existe no schema, então ninguém sobra). Cole a saída.

- [ ] **Step 3: Acrescentar o modelo ao schema**

Em `prisma/schema.prisma`, dentro do bloco `model Company`, na lista de relações inversas (depois de `whatsappMessages WhatsappMessage[]`), acrescentar:

```prisma
  config           CompanyConfig?
```

Em `model User`, depois de `memberships Membership[]`, acrescentar:

```prisma
  configsEditadas    CompanyConfig[] @relation("ConfigsEditadas")
```

E, logo depois do bloco `model BotConfig` (para os dois "uma linha por empresa" ficarem vizinhos), acrescentar:

```prisma
/// A metade de `config/client.ts` que NÃO pode ser a mesma para duas empresas
/// no mesmo banco: a marca e os módulos. Ciclo 1c.
///
/// **A linha é OPCIONAL.** Empresa sem linha usa os padrões de
/// `config/client.ts`, e isso é estado suportado, não estado quebrado — é o
/// que resolve o ovo-e-galinha do layout raiz, que envolve `/login`, onde
/// ainda não existe sessão e portanto não existe empresa.
///
/// **Colunas TIPADAS e não uma coluna `Json`.** A varredura de escopo do Ciclo
/// 1d recusa `companyId` divergente em qualquer profundidade de `data`,
/// inclusive dentro de coluna `Json` — falso positivo DECLARADO em
/// `src/core/tenancy/escopo.ts` ("Falsos positivos conhecidos", nº 1), com
/// caso de teste vivo. Um documento de configuração que um dia ganhasse uma
/// chave `companyId` (ou `company`, nº 3 do mesmo bloco) seria recusado na
/// escrita com uma mensagem sobre tenancy que não tem relação com o defeito.
///
/// **Nulo significa "não decidi, usa o arquivo"** em `corPrimaria`, `fonte`,
/// `logoClaro` e `logoEscuro`. `modulos` não tem esse estado: lista escalar no
/// Prisma nunca é nula, ela é `[]`. Então a regra dela é outra e está escrita
/// em `src/core/config/schema.ts`: se a linha existe, `modulos` manda —
/// inclusive vazia. Empresa que não decidiu módulos é empresa SEM LINHA.
///
/// `logoClaro` e `logoEscuro` são os dois ou nenhum (`marcaSchema.logo` é um
/// objeto com os dois campos obrigatórios, e o comentário dele explica por
/// quê: logo monocromático some no fundo da mesma cor). A regra é cobrada na
/// LEITURA, não por `CHECK` no Postgres — o Prisma não modela `CHECK`, e se
/// `prisma migrate dev` tratar isso como deriva ele propõe reset do banco.
/// Não foi medido neste ambiente (NV2 do spec), e desenhar migração sobre
/// comportamento não medido é o oposto do que este programa faz.
model CompanyConfig {
  id              String   @id @default(cuid())
  companyId       String
  company         Company  @relation(fields: [companyId], references: [id])
  corPrimaria     String?
  fonte           String?
  logoClaro       String?
  logoEscuro      String?
  modulos         String[]
  atualizadoEm    DateTime @updatedAt
  atualizadoPorId String?
  atualizadoPor   User?    @relation("ConfigsEditadas", fields: [atualizadoPorId], references: [id])

  @@unique([companyId])
}
```

- [ ] **Step 4: Escrever a migração à mão**

Criar `prisma/migrations/20260820180000_company_config/migration.sql`:

```sql
-- Ciclo 1c, Task 1: CompanyConfig -- a metade por empresa de config/client.ts.
--
-- Tabela NOVA e VAZIA. `NOT NULL` sem `DEFAULT` e seguro aqui pelo mesmo
-- motivo registrado na migracao do Ciclo 1a: nao ha linha antiga, e nao ha
-- codigo publicado inserindo nela.
-- `tests/unit/migracoes-seguras.test.ts` isenta explicitamente coluna criada
-- dentro do proprio CREATE TABLE ("tabela criada na propria migracao pode ter
-- NOT NULL sem DEFAULT").
--
-- NENHUM backfill, de proposito. Empresa sem linha e estado SUPORTADO: a
-- leitura (src/core/config/leitura.ts) cai nos padroes de config/client.ts, que
-- e exatamente o comportamento de hoje. Backfillar congelaria no banco os
-- valores atuais do arquivo -- inclusive a identidade do produto, que a decisao
-- 8 do spec do programa ainda NAO tomou -- e a partir dai editar o arquivo
-- deixaria de ter efeito, em silencio.

-- CreateTable
CREATE TABLE "CompanyConfig" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "corPrimaria" TEXT,
    "fonte" TEXT,
    "logoClaro" TEXT,
    "logoEscuro" TEXT,
    "modulos" TEXT[],
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "atualizadoPorId" TEXT,

    CONSTRAINT "CompanyConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyConfig_companyId_key" ON "CompanyConfig"("companyId");

-- AddForeignKey
ALTER TABLE "CompanyConfig" ADD CONSTRAINT "CompanyConfig_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyConfig" ADD CONSTRAINT "CompanyConfig_atualizadoPorId_fkey" FOREIGN KEY ("atualizadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A blindagem, e ela e obrigatoria em toda tabela nova deste projeto.
--
-- O Prisma nao emite RLS nem REVOKE. A migracao
-- 20260802000000_revoke_default_privileges_future_tables cobre os GRANTs
-- automaticos de objetos futuros (suspensorio), mas ALTER DEFAULT PRIVILEGES
-- NAO liga RLS -- isso continua sendo por tabela, a mao (cinto). Mesmo par de
-- linhas que 20260806155117_whatsapp_fatia_2_bot_config escreveu.
--
-- Sem estas duas linhas, tests/e2e/banco-blindado.spec.ts fica vermelho: ele
-- varre pg_class.relrowsecurity e information_schema.role_table_grants SEM
-- lista fixa de tabelas, entao uma tabela nova desprotegida aparece sozinha.
--
-- RLS LIGADA e ZERO politicas = default-deny. Nenhuma politica e escrita aqui:
-- a excecao NOMEADA para o Realtime e Ciclo 3.
ALTER TABLE "CompanyConfig" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CompanyConfig" FROM anon, authenticated;
```

- [ ] **Step 5: Aplicar a migração e regenerar o client**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx prisma migrate deploy
npx prisma generate
```

Esperado: `1 migration found` / `Applying migration '20260820180000_company_config'` / `The following migration(s) have been applied` e, do generate, `Generated Prisma Client`. Cole as duas.

- [ ] **Step 6: Provar no banco que a tabela nasceu blindada**

```bash
cd "d:/Projetos Programação/N8n + Crm"
node -e "
require('dotenv/config');
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();
  const rls = await c.query(\"select relrowsecurity from pg_class where relname='CompanyConfig'\");
  const pol = await c.query(\"select count(*)::int as n from pg_policies where tablename='CompanyConfig'\");
  const gr  = await c.query(\"select count(*)::int as n from information_schema.role_table_grants where table_name='CompanyConfig' and grantee in ('anon','authenticated')\");
  console.log('rls:', rls.rows[0], 'politicas:', pol.rows[0].n, 'grants anon/authenticated:', gr.rows[0].n);
  await c.end();
})();
"
```

Saída esperada: `rls: { relrowsecurity: true } politicas: 0 grants anon/authenticated: 0`. Cole a saída exata.

- [ ] **Step 7: Acrescentar o 12º modelo e corrigir as frases de `escopo.ts`**

Em `src/core/tenancy/escopo.ts`, no `Set` da linha 250, acrescentar `"CompanyConfig"` **depois de** `"BotConfig"`:

```ts
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
  "CompanyConfig",
  "WhatsappMessage",
]);
```

A ordem importa: o caso do Step 2 compara com `["BotConfig", "CompanyConfig"]` e o `filter` preserva a ordem de inserção do `Set`.

No JSDoc do mesmo arquivo, quatro correções — **cada uma é um número medido virando outro número medido, não maquiagem**:

1. Linha 53, o título: `## Os 11 modelos de tenant` → `## Os 12 modelos de tenant`
2. O parágrafo logo abaixo, a lista: acrescentar `CompanyConfig` e trocar a data da medição:

```
 * Medido em `prisma/schema.prisma` em 2026-08-20 (`awk` sobre os blocos
 * `model`, campo `companyId`): `Membership`, `Contact`, `PipelineStage`,
 * `Lead`, `LeadNote`, `Task`, `Notification`, `AuditLog`, `Conversation`,
 * `BotConfig`, `CompanyConfig`, `WhatsappMessage`. O 12º entrou no Ciclo 1c.
```

3. Linha 90: `Em 10 dos 11 modelos de tenant` → `Em 10 dos 12 modelos de tenant`
4. O bloco que começa em `**`BotConfig` é a exceção**` passa a ser:

```
 * **`BotConfig` e `CompanyConfig` são as exceções, e a lista já esteve errada
 * duas vezes.** Ela dizia "nenhum dos 11" enquanto `BotConfig` tinha
 * `@@unique([companyId])`; corrigida para "só `BotConfig`", ficou errada de
 * novo quando o Ciclo 1c criou `CompanyConfig` — também uma linha por empresa,
 * também com `@@unique([companyId])`. Nos dois, `XWhereUniqueInput` ACEITA
 * `companyId` (`node_modules/.prisma/client/index.d.ts`), então ali
 * `findUnique` seria escopável de verdade. O escopo recusa mesmo assim, por
 * uniformidade: uma regra "lança em `findUnique`, menos em dois modelos" é
 * regra que ninguém lembra na hora de ler o código, e `findFirst` resolve o
 * caso com a mesma consulta. O que muda é a MENSAGEM: para esses dois ela
 * seria enganosa se repetisse "o Prisma recusa o campo ali". O teste de deriva
 * de uniques (`tests/unit/escopo-empresa.test.ts`) quebra se um TERCEIRO
 * modelo ganhar `@@unique([companyId])`, e então esta frase precisa ser
 * reescrita de novo.
```

5. Linha 141 (o bloco de escrita aninhada): `coluna `NOT NULL` nos 11 modelos` → `coluna `NOT NULL` nos 11 modelos originais, e nasceu `NOT NULL` no 12º`

E a mensagem de `escoparArgumentos` (o `throw` de `OPERACOES_POR_CHAVE_UNICA`) passa a nomear os dois:

```ts
  const equivalente = OPERACOES_POR_CHAVE_UNICA[operation];
  if (equivalente) {
    throw new EscopoDeEmpresaError(
      `${onde} não é escopável por empresa no escopo ${JSON.stringify(companyId)}: o \`where\` ` +
        `dela só aceita campo único, e \`companyId\` não é único em ${model} — o Prisma recusa ` +
        `o campo ali. (Exceções conhecidas: \`BotConfig\` e \`CompanyConfig\` têm ` +
        `\`@@unique([companyId])\`, então lá o campo seria aceito; o escopo recusa mesmo assim, ` +
        `por uniformidade — ver o bloco "Recusa, lançando" em core/tenancy/escopo.ts.) ` +
        `Use \`${equivalente}\` no cliente escopado. ` +
        `Devolver a linha sem filtro entregaria dado de outra empresa a quem soubesse o id.`
    );
  }
```

- [ ] **Step 8: Rodar (GREEN) e fechar**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/escopo-empresa.test.ts tests/unit/migracoes-seguras.test.ts
npm run typecheck
npm run lint
```

Esperado: os dois arquivos verdes (o de escopo inclui o caso de deriva, que agora precisa de `CompanyConfig` nos DOIS lados para passar), `tsc` sem saída, lint com no máximo os avisos pré-existentes e **zero erros**. Cole as três saídas.

- [ ] **Step 9: Commit**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git add prisma/schema.prisma prisma/migrations/20260820180000_company_config src/core/tenancy/escopo.ts tests/unit/escopo-empresa.test.ts
git commit -m "feat(config): CompanyConfig, a metade por empresa do config de cliente

A linha e OPCIONAL de proposito: empresa sem linha usa os padroes de
config/client.ts, e isso resolve o ovo-e-galinha do layout raiz, que envolve
/login -- onde nao ha sessao e portanto nao ha empresa. Por isso a migracao
tambem nao faz backfill: congelar os valores do arquivo no banco antes de
alguem decidir a identidade do produto faria editar o arquivo parar de ter
efeito, em silencio.

Colunas tipadas e nao uma coluna Json porque a varredura de escopo do Ciclo 1d
recusa companyId em qualquer profundidade do data, dentro de Json inclusive --
falso positivo ja declarado em escopo.ts. Config com uma chave companyId seria
recusada com uma mensagem sobre tenancy que nao tem relacao com o defeito.

RLS ligada e REVOKE na propria migracao: o Prisma nao emite nenhum dos dois, e
o banco-blindado varre sem lista fixa de tabelas.

E o 12o modelo de tenant. Com ele, a frase de escopo.ts sobre companyId unico
fica errada pela segunda vez -- era 'nenhum dos 11', virou 'so BotConfig', e
agora sao dois. O caso que a cobra passa a exigir a lista completa.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: A forma da configuração por empresa, derivada do schema que já existe

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Create: `src/core/config/schema.ts`
- Test: `tests/unit/config-schema.test.ts` (novo)

**Interfaces:**
- Consumes: `marcaSchema`, `clientConfigSchema`, `FONTES`, `ClientConfig` (`config/client.schema.ts`); `client` (`config/client.ts`); `CROMA_MINIMO` (`src/lib/tema/paleta.ts`, indiretamente, via o `refine` do `marcaSchema`). Nada do banco, nada do Prisma.
- Produces:
  - `marcaDaEmpresaSchema` = `marcaSchema.omit({ nome: true })`
  - `type MarcaDaEmpresa = z.infer<typeof marcaDaEmpresaSchema>` → `{ corPrimaria: string; fonte: "Geist" | "Inter" | "Manrope" | "IBM Plex Sans"; logo?: { claro: string; escuro: string } }`
  - `configDaEmpresaSchema` → `{ nome: string; marca: MarcaDaEmpresa; modulos: ModuloNome[] }`
  - `type ConfigDaEmpresa = z.infer<typeof configDaEmpresaSchema>`
  - `type ModuloNome = ClientConfig["modulos"][number]`
  - `type LinhaDeConfig = { corPrimaria: string | null; fonte: string | null; logoClaro: string | null; logoEscuro: string | null; modulos: string[] }`
  - `padraoDoArquivo(): { marca: MarcaDaEmpresa; modulos: ModuloNome[] }`
  - `mesclarConfig(companyId: string, nome: string, linha: LinhaDeConfig | null): ConfigDaEmpresa`
  - `class ConfigDaEmpresaInvalidaError extends Error`

- [ ] **Step 1: Escrever o teste que falha (RED)**

Criar `tests/unit/config-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";

import { client } from "../../config/client";
import { CROMA_MINIMO } from "../../src/lib/tema/paleta";
import {
  ConfigDaEmpresaInvalidaError,
  marcaDaEmpresaSchema,
  mesclarConfig,
  padraoDoArquivo,
  type LinhaDeConfig,
} from "../../src/core/config/schema";

/**
 * A forma da configuração por empresa é DERIVADA de `config/client.schema.ts`,
 * não redigitada — e é isso que estes casos travam.
 *
 * Se `marcaDaEmpresaSchema` fosse escrito à mão, o piso de croma, o enum
 * fechado de fontes e o regex de caminho de asset existiriam em duas cópias, e
 * a segunda envelheceria em silêncio. O modo de falha é exatamente o que o
 * comentário de `client.schema.ts` descreve para o croma: "abaixo desse piso as
 * superfícies derivadas ficam indistinguíveis de neutro e o white-label para de
 * funcionar em silêncio". Um schema derivado não tem como divergir.
 *
 * Nada aqui toca banco nem Prisma: `mesclarConfig` é função pura, e é de
 * propósito — a decisão "banco vence arquivo, campo a campo" fica exercitável
 * sem nenhuma infraestrutura.
 */

const EMPRESA = "empresa-teste-1c";

/** Linha "não decidi nada" — todas as sobreposições nulas, módulos vazios. */
function linhaVazia(): LinhaDeConfig {
  return {
    corPrimaria: null,
    fonte: null,
    logoClaro: null,
    logoEscuro: null,
    modulos: [],
  };
}

describe("marcaDaEmpresaSchema", () => {
  it("é o marcaSchema SEM o campo `nome` — o nome da empresa é `Company.nome`", () => {
    const analisado = marcaDaEmpresaSchema.parse({
      nome: "NomeQueDeveSerDescartado",
      corPrimaria: "#6D4AFF",
      fonte: "Geist",
    });

    // Zod descarta chave desconhecida por padrão. O caso afirma o conjunto
    // EXATO de chaves, e não só a ausência de `nome`: uma asserção "não tem
    // nome" passaria mesmo se o schema tivesse ganhado um campo novo por
    // engano.
    expect(Object.keys(analisado).sort()).toEqual(["corPrimaria", "fonte"]);
  });

  it("herda o piso de croma — cinza continua recusado", () => {
    // `#808080` tem croma 0 em OKLCH. O piso é `CROMA_MINIMO`.
    expect(CROMA_MINIMO).toBeGreaterThan(0);
    const r = marcaDaEmpresaSchema.safeParse({ corPrimaria: "#808080", fonte: "Geist" });
    expect(r.success).toBe(false);
  });

  it("herda o enum fechado de fontes", () => {
    const r = marcaDaEmpresaSchema.safeParse({ corPrimaria: "#6D4AFF", fonte: "Comic Sans" });
    expect(r.success).toBe(false);
  });

  it("herda o regex de caminho de asset — `//outro-dominio` continua recusado", () => {
    const r = marcaDaEmpresaSchema.safeParse({
      corPrimaria: "#6D4AFF",
      fonte: "Geist",
      logo: { claro: "//outro-dominio/logo.svg", escuro: "/logo-branco.svg" },
    });
    expect(r.success).toBe(false);
  });
});

describe("padraoDoArquivo", () => {
  it("devolve a marca e os módulos de `config/client.ts`, sem o `nome` da marca", () => {
    const padrao = padraoDoArquivo();
    expect(padrao.marca.corPrimaria).toBe(client.marca.corPrimaria);
    expect(padrao.marca.fonte).toBe(client.marca.fonte);
    expect(padrao.modulos).toEqual([...client.modulos]);
    expect(Object.keys(padrao.marca)).not.toContain("nome");
  });

  it("não devolve a MESMA referência de `client.modulos` — mutar a saída não muda o arquivo", () => {
    // O padrão é lido em toda requisição do painel. Se ele devolvesse a
    // referência do módulo, um chamador que fizesse `padrao.modulos.push(...)`
    // envenenaria o config do processo inteiro, e o sintoma apareceria numa
    // requisição depois.
    expect(padraoDoArquivo().modulos).not.toBe(client.modulos);
  });
});

describe("mesclarConfig — o banco sobrepõe o arquivo, campo a campo", () => {
  it("SEM linha, devolve exatamente o padrão do arquivo", () => {
    const config = mesclarConfig(EMPRESA, "Empresa Um", null);
    expect(config).toEqual({
      nome: "Empresa Um",
      marca: padraoDoArquivo().marca,
      modulos: padraoDoArquivo().modulos,
    });
  });

  it("campo nulo cai no padrão; campo preenchido vence", () => {
    const config = mesclarConfig(EMPRESA, "Empresa Um", {
      ...linhaVazia(),
      corPrimaria: "#0F62FE",
      modulos: ["whatsapp"],
    });

    expect(config.marca.corPrimaria).toBe("#0F62FE");
    // `fonte` ficou nula na linha: continua vindo do arquivo.
    expect(config.marca.fonte).toBe(client.marca.fonte);
  });

  it("a fonte do banco vence a do arquivo", () => {
    const config = mesclarConfig(EMPRESA, "Empresa Um", { ...linhaVazia(), fonte: "Manrope" });
    expect(config.marca.fonte).toBe("Manrope");
  });

  it("os dois logos preenchidos viram o par; nenhum preenchido cai no padrão", () => {
    const comLogo = mesclarConfig(EMPRESA, "Empresa Um", {
      ...linhaVazia(),
      logoClaro: "/logo-preto.svg",
      logoEscuro: "/logo-branco.svg",
    });
    expect(comLogo.marca.logo).toEqual({ claro: "/logo-preto.svg", escuro: "/logo-branco.svg" });

    const semLogo = mesclarConfig(EMPRESA, "Empresa Um", linhaVazia());
    expect(semLogo.marca.logo).toBe(padraoDoArquivo().marca.logo);
  });

  it("linha com `modulos: []` desliga TODOS os módulos e NÃO cai no padrão do arquivo", () => {
    // Esta é a assimetria declarada em 4.2 do spec, e é o caso que a exercita.
    // `String[]` no Prisma nunca é nulo, então não existe "não decidi" dentro
    // da linha: se a linha existe, `modulos` dela manda. Sem este caso, a
    // frase "inclusive quando está vazia" seria prosa.
    expect(padraoDoArquivo().modulos.length).toBeGreaterThan(0);
    expect(mesclarConfig(EMPRESA, "Empresa Um", linhaVazia()).modulos).toEqual([]);
  });

  it("`modulos` do banco vence a lista do arquivo", () => {
    const config = mesclarConfig(EMPRESA, "Empresa Um", { ...linhaVazia(), modulos: ["whatsapp"] });
    expect(config.modulos).toEqual(["whatsapp"]);
  });
});

describe("mesclarConfig — linha inválida RECUSA, não degrada", () => {
  // A escolha é a mesma que `CROMA_MINIMO` encarna: white-label quebrado em
  // SILÊNCIO é o defeito; painel que quebra alto é o diagnóstico. Toda mensagem
  // carrega o companyId, mesmo padrão de `EscopoDeEmpresaError`.
  const casos: [string, Partial<LinhaDeConfig>][] = [
    ["cor de croma abaixo do piso (cinza)", { corPrimaria: "#808080" }],
    ["cor malformada", { corPrimaria: "roxo" }],
    ["fonte fora do enum", { fonte: "Comic Sans" }],
    ["módulo desconhecido", { modulos: ["modulo-que-nao-existe"] }],
    ["logo só claro", { logoClaro: "/logo-preto.svg" }],
    ["logo só escuro", { logoEscuro: "/logo-branco.svg" }],
    ["caminho de logo que sai do domínio", { logoClaro: "//fora/a.svg", logoEscuro: "/b.svg" }],
  ];

  for (const [rotulo, sobreposicao] of casos) {
    it(`recusa: ${rotulo}`, () => {
      const chamada = () => mesclarConfig(EMPRESA, "Empresa Um", { ...linhaVazia(), ...sobreposicao });
      expect(chamada).toThrow(ConfigDaEmpresaInvalidaError);
      expect(chamada).toThrow(EMPRESA);
    });
  }

  it("nome de empresa vazio é recusado — `Company.nome` é o que a barra mostra", () => {
    expect(() => mesclarConfig(EMPRESA, "", null)).toThrow(ConfigDaEmpresaInvalidaError);
  });
});
```

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/config-schema.test.ts
```

Esperado: falha na resolução de `../../src/core/config/schema` (arquivo não existe). Cole a saída.

- [ ] **Step 2: Escrever `src/core/config/schema.ts`**

```ts
import { z } from "zod";

import { client } from "../../../config/client";
import { clientConfigSchema, marcaSchema, type ClientConfig } from "../../../config/client.schema";

/**
 * A forma da configuração POR EMPRESA — a metade de `config/client.ts` que não
 * pode ser a mesma para duas empresas no mesmo banco.
 *
 * ## Derivado, nunca redigitado
 *
 * `marcaDaEmpresaSchema` é `marcaSchema.omit({ nome: true })`, e `modulos` é
 * `clientConfigSchema.shape.modulos`. Com isso, o piso de croma
 * (`CROMA_MINIMO`), o enum fechado de `FONTES` e o regex de `caminhoDeAsset` —
 * os três com o porquê escrito em `config/client.schema.ts` — valem para o
 * valor que vem do BANCO exatamente como valem para o do arquivo. Duas cópias
 * do mesmo schema divergiriam em silêncio, e o sintoma seria o que aquele
 * arquivo descreve: "o white-label para de funcionar em silêncio".
 *
 * `nome` sai da marca porque o nome exibido é `Company.nome` (Ciclo 1a).
 * `marca.nome` do arquivo tem ZERO leituras em `src/` — medido em 2026-08-20,
 * `grep -rn "client.marca"` — e criar uma coluna para ele seria uma segunda
 * fonte de verdade sobre o nome da empresa.
 *
 * ## Este arquivo NÃO toca o banco
 *
 * `mesclarConfig` é pura. A decisão "banco sobrepõe arquivo, campo a campo" é a
 * regra mais fácil de errar deste ciclo, e ela fica exercitável sem Postgres,
 * sem Prisma e sem mock — ver `tests/unit/config-schema.test.ts`.
 */

/** Os nomes de módulo, derivados do enum do Zod — nunca uma segunda lista. */
export type ModuloNome = ClientConfig["modulos"][number];

/**
 * A marca de uma empresa. `nome` não entra: quem carrega o nome é
 * `Company.nome`.
 */
export const marcaDaEmpresaSchema = marcaSchema.omit({ nome: true });
export type MarcaDaEmpresa = z.infer<typeof marcaDaEmpresaSchema>;

export const configDaEmpresaSchema = z.object({
  /** `Company.nome`. `min(1)` porque é o texto que a barra lateral mostra. */
  nome: z.string().min(1),
  marca: marcaDaEmpresaSchema,
  modulos: clientConfigSchema.shape.modulos,
});
export type ConfigDaEmpresa = z.infer<typeof configDaEmpresaSchema>;

/**
 * A linha de `CompanyConfig`, como o Prisma a devolve.
 *
 * Escrita à mão e não `Prisma.CompanyConfigGetPayload<...>` de propósito: assim
 * `mesclarConfig` não importa nada de `@prisma/client`, e o teste dela não
 * precisa do client gerado. Se o schema mudar, o `select` de
 * `src/core/config/leitura.ts` deixa de casar com este tipo e o `tsc` acusa —
 * a checagem continua existindo, um arquivo adiante.
 */
export type LinhaDeConfig = {
  corPrimaria: string | null;
  fonte: string | null;
  logoClaro: string | null;
  logoEscuro: string | null;
  modulos: string[];
};

/**
 * Configuração inválida recusa a leitura inteira, em vez de cair no padrão.
 *
 * Cair no padrão em silêncio é o defeito que `CROMA_MINIMO` existe para
 * impedir: o painel abriria neutro e ninguém saberia por quê. A mensagem
 * carrega o `companyId` pelo mesmo motivo que `EscopoDeEmpresaError` carrega —
 * sem ele, o erro não diz de qual empresa é a linha ruim.
 */
export class ConfigDaEmpresaInvalidaError extends Error {
  constructor(companyId: string, causa: z.ZodError | string) {
    const detalhe =
      typeof causa === "string"
        ? causa
        : causa.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`).join(" · ");

    super(
      `A configuração da empresa ${JSON.stringify(companyId)} é inválida, e a leitura RECUSA em ` +
        `vez de cair no padrão de config/client.ts (cair no padrão deixaria o white-label quebrado ` +
        `em silêncio — ver CROMA_MINIMO em config/client.schema.ts): ${detalhe}`
    );
    this.name = "ConfigDaEmpresaInvalidaError";
  }
}

/**
 * O padrão que vem do arquivo versionado.
 *
 * Função e não constante de módulo: uma constante seria um objeto único
 * compartilhado por todas as requisições do processo, e um chamador que
 * mutasse a lista de módulos envenenaria as requisições seguintes. O `parse`
 * também descarta `marca.nome` sem que este arquivo precise saber que ele
 * existe.
 */
export function padraoDoArquivo(): { marca: MarcaDaEmpresa; modulos: ModuloNome[] } {
  return {
    marca: marcaDaEmpresaSchema.parse(client.marca),
    modulos: [...client.modulos],
  };
}

/**
 * Mescla a linha do banco sobre o padrão do arquivo e VALIDA o resultado.
 *
 * Regras, e cada uma tem caso em `tests/unit/config-schema.test.ts`:
 *
 * - `linha === null` → o padrão do arquivo, inteiro.
 * - coluna NULA → o padrão daquele campo.
 * - coluna preenchida → o banco vence.
 * - `modulos` NÃO tem estado "nulo" (lista escalar no Prisma nunca é nula):
 *   **se a linha existe, `modulos` dela manda, inclusive vazia.** Empresa que
 *   não decidiu módulos é empresa SEM LINHA.
 * - os dois logos ou nenhum.
 */
export function mesclarConfig(
  companyId: string,
  nome: string,
  linha: LinhaDeConfig | null
): ConfigDaEmpresa {
  const padrao = padraoDoArquivo();

  if (linha === null) {
    return validar(companyId, { nome, marca: padrao.marca, modulos: padrao.modulos });
  }

  const temClaro = linha.logoClaro !== null;
  const temEscuro = linha.logoEscuro !== null;
  if (temClaro !== temEscuro) {
    throw new ConfigDaEmpresaInvalidaError(
      companyId,
      `logoClaro e logoEscuro são os dois ou nenhum, e esta linha tem só ` +
        `${temClaro ? "logoClaro" : "logoEscuro"}. Logo monocromático some no fundo da mesma cor, ` +
        `e o painel abre no escuro por padrão — ver o comentário de \`logo\` em ` +
        `config/client.schema.ts.`
    );
  }

  const logo =
    temClaro && temEscuro
      ? { claro: linha.logoClaro as string, escuro: linha.logoEscuro as string }
      : padrao.marca.logo;

  return validar(companyId, {
    nome,
    marca: {
      corPrimaria: linha.corPrimaria ?? padrao.marca.corPrimaria,
      fonte: linha.fonte ?? padrao.marca.fonte,
      // Espalhado condicionalmente: `logo: undefined` explícito faria o Zod
      // ver a chave presente com valor indefinido, o que é o mesmo que ausente
      // para `.optional()` — mas deixaria a chave no objeto de saída, e o caso
      // que compara conjuntos de chaves ficaria mentindo.
      ...(logo ? { logo } : {}),
    },
    modulos: linha.modulos,
  });
}

function validar(companyId: string, bruto: unknown): ConfigDaEmpresa {
  const resultado = configDaEmpresaSchema.safeParse(bruto);
  if (!resultado.success) {
    throw new ConfigDaEmpresaInvalidaError(companyId, resultado.error);
  }
  return resultado.data;
}
```

- [ ] **Step 3: Rodar (GREEN) e fechar**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/config-schema.test.ts
npm run typecheck
npm run lint
```

Esperado: 20 casos passando, `tsc` sem saída, lint sem erro novo. Cole as três saídas.

- [ ] **Step 4: Commit**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git add src/core/config/schema.ts tests/unit/config-schema.test.ts
git commit -m "feat(config): forma da config por empresa, derivada do schema que ja existe

marcaDaEmpresaSchema e marcaSchema.omit({nome}), e modulos vem de
clientConfigSchema.shape -- nao ha segunda copia. Com isso o piso de croma, o
enum fechado de fontes e o regex de caminho de asset valem para o valor que vem
do BANCO exatamente como valem para o do arquivo. Duas copias divergiriam em
silencio, e o sintoma seria o que client.schema.ts descreve: white-label que
para de funcionar sem avisar.

nome sai da marca porque quem carrega o nome e Company.nome. client.marca.nome
tem zero leituras em src/ (medido), e uma coluna para ele seria segunda fonte de
verdade sobre o nome da empresa.

mesclarConfig e PURA: a regra 'banco sobrepoe arquivo, campo a campo' e a mais
facil de errar deste ciclo e fica exercitavel sem Postgres, sem Prisma e sem
mock. A assimetria de modulos -- lista escalar no Prisma nunca e nula, entao
linha vazia significa 'nenhum modulo', nao 'usa o arquivo' -- tem caso proprio.

Linha invalida RECUSA em vez de cair no padrao, pelo mesmo motivo do
CROMA_MINIMO: painel neutro em silencio e o defeito, erro alto e o diagnostico.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `configDaEmpresa` — a leitura escopada, memoizada por requisição

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Create: `src/core/config/leitura.ts`
- Test: `tests/unit/config-leitura.test.ts` (novo, banco falso)
- Test: `tests/unit/config-isolamento.test.ts` (novo, Postgres real)

**Interfaces:**
- Consumes: `prismaDaEmpresa` (`@/core/tenancy/escopo`, Task 1 acrescentou `CompanyConfig` ao `MODELOS_DE_TENANT`); `mesclarConfig`, `ConfigDaEmpresa`, `LinhaDeConfig` (Task 2); `cache` de `react`.
- Produces:
  - `configDaEmpresa(companyId: string): Promise<ConfigDaEmpresa>` — memoizada por requisição
  - reexporta `type ConfigDaEmpresa` e `ConfigDaEmpresaInvalidaError` para quem consome só a leitura

- [ ] **Step 1: Escrever o teste do banco falso (RED)**

Criar `tests/unit/config-leitura.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { prismaFalsoEscopavel } from "./helpers/prisma-falso-escopavel";
import { semComentarios } from "./helpers/codigo-fonte";

vi.mock("server-only", () => ({}));

const { companyFindUniqueOrThrowMock } = vi.hoisted(() => ({
  companyFindUniqueOrThrowMock: vi.fn(),
}));

// O `$extends` de VERDADE (ver `tests/unit/helpers/prisma-falso-escopavel.ts`):
// `leitura.ts` alcança o banco por `prismaDaEmpresa(companyId)`, e um mock sem
// `$extends` quebra com `TypeError`. Um `$extends: () => cru` seria pior: faria
// o escopo virar no-op silencioso e as asserções abaixo passariam mesmo se a
// leitura tivesse perdido o escopo inteiro.
vi.mock("@/lib/prisma", () => ({
  prisma: prismaFalsoEscopavel({
    company: { findUniqueOrThrow: companyFindUniqueOrThrowMock },
  }),
}));

const { configDaEmpresa } = await import("../../src/core/config/leitura");
const { padraoDoArquivo, ConfigDaEmpresaInvalidaError } = await import(
  "../../src/core/config/schema"
);

const EMPRESA_A = "cmp_a";
const EMPRESA_B = "cmp_b";

beforeEach(() => {
  companyFindUniqueOrThrowMock.mockReset();
});

describe("configDaEmpresa — a consulta", () => {
  it("lê `Company` PELO ID que recebeu, e carrega a config junto numa consulta só", async () => {
    companyFindUniqueOrThrowMock.mockResolvedValue({ nome: "Empresa A", config: null });

    await configDaEmpresa(EMPRESA_A);

    expect(companyFindUniqueOrThrowMock).toHaveBeenCalledTimes(1);
    const args = companyFindUniqueOrThrowMock.mock.calls[0][0];

    // PELO ID, e não `findFirst()`: `prisma.company.findFirst()` como origem de
    // empresa é proibido no programa inteiro — ele devolve "alguma" empresa.
    // Aqui o id VEIO da sessão; isto é lookup, não origem.
    expect(args.where).toEqual({ id: EMPRESA_A });

    // Uma consulta só. Buscar a config à parte seria uma segunda ida ao banco
    // em TODA navegação do painel, e a relação `CompanyConfig -> Company` fica
    // DENTRO do tenant (ver a regra "relação que fica dentro de `Company` é
    // segura" no topo de core/tenancy/escopo.ts).
    expect(Object.keys(args.select).sort()).toEqual(["config", "nome"]);
    expect(Object.keys(args.select.config.select).sort()).toEqual([
      "corPrimaria",
      "fonte",
      "logoClaro",
      "logoEscuro",
      "modulos",
    ]);
  });

  it("`Company` passa INTACTA pelo escopo — nenhum `companyId` é injetado nela", async () => {
    companyFindUniqueOrThrowMock.mockResolvedValue({ nome: "Empresa A", config: null });

    await configDaEmpresa(EMPRESA_A);

    // `Company` está FORA de MODELOS_DE_TENANT: `escoparArgumentos` devolve os
    // argumentos sem tocar. Injetar `where.companyId` aqui quebraria a consulta
    // com erro de coluna inexistente. O caso existe porque a Task 1 mexeu
    // naquele Set, e mexer nele errado é como este caminho quebra.
    const args = companyFindUniqueOrThrowMock.mock.calls[0][0];
    expect(args.where).not.toHaveProperty("companyId");
  });
});

describe("configDaEmpresa — a mescla chega inteira", () => {
  it("sem linha, devolve o padrão do arquivo", async () => {
    companyFindUniqueOrThrowMock.mockResolvedValue({ nome: "Empresa A", config: null });

    await expect(configDaEmpresa(EMPRESA_A)).resolves.toEqual({
      nome: "Empresa A",
      marca: padraoDoArquivo().marca,
      modulos: padraoDoArquivo().modulos,
    });
  });

  it("com linha, o banco vence campo a campo", async () => {
    companyFindUniqueOrThrowMock.mockResolvedValue({
      nome: "Empresa A",
      config: {
        corPrimaria: "#0F62FE",
        fonte: null,
        logoClaro: null,
        logoEscuro: null,
        modulos: ["whatsapp"],
      },
    });

    const config = await configDaEmpresa(EMPRESA_A);
    expect(config.marca.corPrimaria).toBe("#0F62FE");
    expect(config.marca.fonte).toBe(padraoDoArquivo().marca.fonte);
    expect(config.modulos).toEqual(["whatsapp"]);
  });

  it("linha inválida RECUSA, com o companyId na mensagem", async () => {
    companyFindUniqueOrThrowMock.mockResolvedValue({
      nome: "Empresa A",
      config: {
        corPrimaria: "#808080",
        fonte: null,
        logoClaro: null,
        logoEscuro: null,
        modulos: [],
      },
    });

    await expect(configDaEmpresa(EMPRESA_A)).rejects.toThrow(ConfigDaEmpresaInvalidaError);
    await expect(configDaEmpresa(EMPRESA_A)).rejects.toThrow(EMPRESA_A);
  });
});

describe("configDaEmpresa — a corretude NÃO depende do cache", () => {
  it("duas chamadas fora de requisição fazem DUAS consultas e devolvem o mesmo resultado", async () => {
    // `cache()` do React memoiza dentro de UM render de requisição e nada além
    // disso. Fora de contexto de requisição — job de fila, seed, Vitest — ele
    // não memoiza: a função consulta de novo. `src/core/auth/session.ts` já
    // depende exatamente disso, e o comentário dele registra
    // `tests/unit/session.test.ts` como o canário.
    //
    // Este caso é a versão executável de "degrada em custo, nunca em resposta":
    // é o que separa memoização com chave no ARGUMENTO de estado global, que o
    // plano do programa proíbe.
    companyFindUniqueOrThrowMock.mockResolvedValue({ nome: "Empresa A", config: null });

    const primeira = await configDaEmpresa(EMPRESA_A);
    const segunda = await configDaEmpresa(EMPRESA_A);

    expect(companyFindUniqueOrThrowMock).toHaveBeenCalledTimes(2);
    expect(segunda).toEqual(primeira);
  });

  it("empresas diferentes recebem respostas diferentes na mesma execução", async () => {
    companyFindUniqueOrThrowMock
      .mockResolvedValueOnce({
        nome: "Empresa A",
        config: { corPrimaria: null, fonte: null, logoClaro: null, logoEscuro: null, modulos: ["whatsapp"] },
      })
      .mockResolvedValueOnce({
        nome: "Empresa B",
        config: { corPrimaria: null, fonte: null, logoClaro: null, logoEscuro: null, modulos: [] },
      });

    expect((await configDaEmpresa(EMPRESA_A)).modulos).toEqual(["whatsapp"]);
    expect((await configDaEmpresa(EMPRESA_B)).modulos).toEqual([]);
  });
});

describe("configDaEmpresa — nenhum estado de módulo", () => {
  it("`leitura.ts` não tem binding mutável nem coleção em escopo de módulo", () => {
    // A versão executável de "sem estado global". Sem este caso, a frase é
    // prosa: um `const cachePorEmpresa = new Map()` no topo do arquivo passaria
    // por todos os outros casos deste arquivo, porque eles não repetem
    // `companyId` numa mesma execução com resultados diferentes... e depois
    // serviria a marca da empresa A para a B, entre requisições, num processo
    // de longa duração.
    //
    // `semComentarios` é obrigatório: este projeto documenta a própria regra em
    // comentário longo, e a prosa cita o padrão proibido literalmente.
    const caminho = fileURLToPath(new URL("../../src/core/config/leitura.ts", import.meta.url));
    const codigo = semComentarios(readFileSync(caminho, "utf8"));

    const linhasDeModulo = codigo
      .split("\n")
      .filter((l) => l.length > 0 && !/^\s/.test(l));

    const proibidos = linhasDeModulo.filter((l) =>
      /^\s*(let|var)\s|new Map\(|new Set\(|new WeakMap\(|globalThis/.test(l)
    );

    expect(proibidos).toEqual([]);
  });
});
```

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/config-leitura.test.ts
```

Esperado: falha na resolução de `../../src/core/config/leitura`. Cole a saída.

- [ ] **Step 2: Escrever `src/core/config/leitura.ts`**

```ts
import { cache } from "react";

import { prismaDaEmpresa } from "@/core/tenancy/escopo";

import { mesclarConfig, type ConfigDaEmpresa } from "./schema";

export { ConfigDaEmpresaInvalidaError, type ConfigDaEmpresa } from "./schema";

/**
 * A configuração de UMA empresa: nome, marca e módulos, com o banco sobrepondo
 * `config/client.ts`.
 *
 * ## `companyId` é parâmetro, e é a única forma de chegar aqui
 *
 * Não existe versão sem argumento, e não há canal ambiente: `AsyncLocalStorage`
 * e estado global são proibidos no programa porque funcionam até o primeiro
 * caminho fora do ciclo de requisição (job de fila, seed, script). A origem do
 * `companyId` é sempre `UsuarioAtivo.companyId` — **nunca**
 * `prisma.company.findFirst()`.
 *
 * ## Por que `cache()`, e por que ele não é aquele estado global
 *
 * O layout do painel precisa desta configuração três vezes na mesma
 * requisição: em `generateMetadata` (o título), no tema/fonte, e nos módulos
 * que vão por prop para `PainelNav`. Sem memoização seriam três consultas por
 * navegação.
 *
 * `cache()` memoiza **por argumento**, dentro de um render de requisição, e
 * nada além disso: sem TTL, sem estado entre requisições, sem canal implícito.
 * `companyId` continua entrando pela assinatura, então duas empresas nunca
 * compartilham entrada. Fora de contexto de requisição — Vitest, seed, job de
 * fila — ele simplesmente **não memoiza** e a função consulta de novo: degrada
 * em custo, nunca em resposta. Não é dedução sobre o React:
 * `src/core/auth/session.ts` já depende disso e registra
 * `tests/unit/session.test.ts` como canário. Aqui, os dois casos de
 * `tests/unit/config-leitura.test.ts` ("duas chamadas fora de requisição fazem
 * DUAS consultas" e "empresas diferentes recebem respostas diferentes") são a
 * versão executável da frase.
 *
 * ## Uma consulta, e por que ela pode ler `Company`
 *
 * `Company` está FORA de `MODELOS_DE_TENANT`, então `escoparArgumentos` devolve
 * os argumentos INTACTOS — comportamento com caso de teste que compara por
 * IDENTIDADE de referência (`tests/unit/escopo-empresa.test.ts`). O filtro aqui
 * é escrito à mão e é o próprio escopo: `where: { id: companyId }`. Ler
 * `Company` pelo id que veio da sessão é LOOKUP, não origem de empresa.
 *
 * A relação `config` desce no mesmo `select`. Leitura aninhada não é escopada
 * (ver a seção correspondente em `core/tenancy/escopo.ts`), e aqui isso não é
 * buraco: a regra que aquele arquivo dá é "relação que fica dentro de `Company`
 * é segura; relação que passa por `User` não é", e `CompanyConfig` é o primeiro
 * caso. A prova contra Postgres real está em
 * `tests/unit/config-isolamento.test.ts`.
 *
 * `findUniqueOrThrow` e não `findFirst`: o escopo só recusa operações por chave
 * única em modelo de TENANT, e `Company` não é. Empresa que não existe é erro,
 * não lista vazia — o `companyId` veio de um `Membership` válido.
 */
export const configDaEmpresa = cache(async function configDaEmpresa(
  companyId: string
): Promise<ConfigDaEmpresa> {
  const empresa = await prismaDaEmpresa(companyId).company.findUniqueOrThrow({
    where: { id: companyId },
    select: {
      nome: true,
      config: {
        select: {
          corPrimaria: true,
          fonte: true,
          logoClaro: true,
          logoEscuro: true,
          modulos: true,
        },
      },
    },
  });

  return mesclarConfig(companyId, empresa.nome, empresa.config);
});
```

- [ ] **Step 3: Escrever o teste de isolamento contra Postgres real (RED → GREEN no mesmo passo)**

Criar `tests/unit/config-isolamento.test.ts`:

```ts
// Toca o Postgres real, então carrega DATABASE_URL do .env aqui — não em
// vitest.config.ts — para não injetar credenciais em testes que não tocam
// banco. Precisa ser o primeiro import.
import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import { configDaEmpresa } from "../../src/core/config/leitura";
import { padraoDoArquivo } from "../../src/core/config/schema";

/**
 * As duas metades, no formato dos `*-isolamento.test.ts` do Ciclo 1d: a
 * consulta ESCOPADA não atravessa a fronteira, e uma SONDA afirma que a
 * consulta sem escopo atravessaria. Sem a sonda, "não vazou" poderia ser
 * coincidência do dado.
 *
 * Prefixo exclusivo deste arquivo, e a limpeza apaga POR ELE: o banco é o mesmo
 * de desenvolvimento (⚠️ R1 da auditoria do Ciclo 1a), e fixture que não limpa
 * envenena a execução seguinte — foi medido acontecendo.
 */
const MARCA = "ZZTesteConfig1c";

let empresaA: string;
let empresaB: string;

async function limpar() {
  const empresas = await prisma.company.findMany({
    where: { nome: { startsWith: MARCA } },
    select: { id: true },
  });
  const ids = empresas.map((e) => e.id);
  if (ids.length === 0) return;
  await prisma.companyConfig.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.company.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  await limpar();

  const a = await prisma.company.create({ data: { nome: `${MARCA}-A` } });
  const b = await prisma.company.create({ data: { nome: `${MARCA}-B` } });
  empresaA = a.id;
  empresaB = b.id;

  await prisma.companyConfig.create({
    data: { companyId: empresaA, corPrimaria: "#0F62FE", fonte: "Inter", modulos: ["whatsapp"] },
  });
  await prisma.companyConfig.create({
    data: { companyId: empresaB, corPrimaria: "#E11D48", fonte: "Manrope", modulos: [] },
  });
});

afterAll(async () => {
  await limpar();
});

describe("configDaEmpresa contra Postgres real", () => {
  it("a empresa A recebe a config DELA", async () => {
    const config = await configDaEmpresa(empresaA);
    expect(config.nome).toBe(`${MARCA}-A`);
    expect(config.marca.corPrimaria).toBe("#0F62FE");
    expect(config.marca.fonte).toBe("Inter");
    expect(config.modulos).toEqual(["whatsapp"]);
  });

  it("a empresa B recebe a config DELA — e nunca a da A", async () => {
    const config = await configDaEmpresa(empresaB);
    expect(config.nome).toBe(`${MARCA}-B`);
    expect(config.marca.corPrimaria).toBe("#E11D48");
    expect(config.modulos).toEqual([]);
  });

  it("SONDA: a consulta sem escopo alcança as duas empresas — é isso que o escopo evita", async () => {
    // Sem esta sonda, os dois casos acima poderiam estar verdes por o banco não
    // ter dado suficiente para vazar. Ela prova que o dado da OUTRA empresa
    // está lá, alcançável, e que o caminho escopado não o alcança.
    const todas = await prisma.companyConfig.findMany({
      where: { companyId: { in: [empresaA, empresaB] } },
      select: { companyId: true, corPrimaria: true },
    });
    expect(todas).toHaveLength(2);
  });

  it("empresa SEM linha cai no padrão do arquivo, contra o banco real", async () => {
    const semConfig = await prisma.company.create({ data: { nome: `${MARCA}-C` } });
    const config = await configDaEmpresa(semConfig.id);

    expect(config.nome).toBe(`${MARCA}-C`);
    expect(config.marca).toEqual(padraoDoArquivo().marca);
    expect(config.modulos).toEqual(padraoDoArquivo().modulos);
  });
});
```

- [ ] **Step 4: Rodar (GREEN) e fechar**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/config-leitura.test.ts tests/unit/config-isolamento.test.ts
npm run typecheck
npm run lint
```

Esperado: 8 casos no primeiro arquivo e 4 no segundo, todos passando; `tsc` sem saída; lint sem erro novo. **Se o lint apontar `no-restricted-imports` em `src/core/config/leitura.ts`, PARE e reporte** — significa que o arquivo alcançou `@/lib/prisma`, o que este ciclo não autoriza. Cole as três saídas.

- [ ] **Step 5: Confirmar que a fixture limpou**

```bash
cd "d:/Projetos Programação/N8n + Crm"
node -e "
require('dotenv/config');
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();
  const r = await c.query(\`select count(*)::int as n from \\\"Company\\\" where nome like 'ZZTesteConfig1c%'\`);
  console.log('residuo de fixture:', r.rows[0].n);
  await c.end();
})();
"
```

Saída esperada: `residuo de fixture: 0`. Se for diferente de zero, a limpeza falhou — **pare e reporte**, é a classe do ⚠️ R1.

- [ ] **Step 6: Commit**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git add src/core/config/leitura.ts tests/unit/config-leitura.test.ts tests/unit/config-isolamento.test.ts
git commit -m "feat(config): leitura escopada da config por empresa, memoizada por requisicao

companyId e parametro e e a unica forma de chegar na funcao: nao ha versao sem
argumento e nao ha canal ambiente. cache() do React memoiza POR ARGUMENTO
dentro de um render, e fora de requisicao nao memoiza nada -- degrada em custo,
nunca em resposta. E o que separa memoizacao de estado global, e tem dois casos
que exercitam a frase em vez de afirma-la.

Uma consulta so: Company pelo id da sessao, com a config descendo no mesmo
select. Company esta fora de MODELOS_DE_TENANT, entao o escopo devolve os
argumentos intactos e o filtro e o proprio where.id -- lookup, nao origem de
empresa. A relacao config fica DENTRO de Company, que e o lado seguro da regra
de leitura aninhada de escopo.ts.

Isolamento provado contra Postgres real com duas empresas, e com sonda: sem
ela, 'nao vazou' poderia ser coincidencia do dado.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: O portão de módulos lê do banco, e `src/lib/module-gate.ts` morre

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Create: `src/core/config/modulos.ts`
- Delete: `src/lib/module-gate.ts`
- Modify: `src/components/painel-nav.tsx`
- Modify: `src/app/(painel)/layout.tsx` (só a prop nova — a marca é a Tarefa 5)
- Modify: `src/app/(painel)/conversas/page.tsx`, `src/app/(painel)/conversas/[id]/page.tsx`, `src/app/(painel)/conversas/agente/page.tsx`, `src/app/(painel)/fluxos/page.tsx`, `src/app/(painel)/fluxos/[id]/page.tsx`, `src/app/(painel)/contatos/[id]/page.tsx`
- Modify: `tests/unit/modules.test.ts`, `tests/unit/painel-nav.test.tsx`, `tests/unit/fluxos-pages-gate.test.tsx`
- Test: `tests/unit/config-modulos.test.ts` (novo)

**Interfaces:**
- Consumes: `configDaEmpresa` (Task 3); `ModuloNome` (Task 2); `notFound` de `next/navigation`; `UsuarioAtivo.companyId` (`src/core/auth/usuario-ativo.ts`).
- Produces:
  - `moduloAtivo(companyId: string, nome: ModuloNome): Promise<boolean>`
  - `exigirModulo(companyId: string, nome: ModuloNome): Promise<void>`
  - reexporta `type ModuloNome`
  - `PainelNav` com duas props novas **obrigatórias**: `modulosAtivos: ModuloNome[]` e `nomeMarca: string`; e uma opcional: `logo?: { claro: string; escuro: string }` (consumida pela Tarefa 5)

- [ ] **Step 1: Escrever o teste que falha (RED)**

Criar `tests/unit/config-modulos.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const { configDaEmpresaMock, notFoundMock } = vi.hoisted(() => ({
  configDaEmpresaMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/core/config/leitura", () => ({ configDaEmpresa: configDaEmpresaMock }));

// `notFound()` de verdade lança um erro de controle de fluxo e nunca retorna —
// o mock reproduz isso, para que um bug que engula o erro dentro de um
// try/catch apareça como o notFound "não acontecendo". Mesma armadilha que
// `login-page-guard.test.tsx` documenta para `redirect()`.
vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));

const { moduloAtivo, exigirModulo } = await import("../../src/core/config/modulos");

const EMPRESA_A = "cmp_a";
const EMPRESA_B = "cmp_b";

function config(modulos: string[]) {
  return { nome: "Empresa", marca: { corPrimaria: "#6D4AFF", fonte: "Geist" }, modulos };
}

beforeEach(() => {
  configDaEmpresaMock.mockReset();
  notFoundMock.mockClear();
});

describe("moduloAtivo", () => {
  it("pergunta pela empresa que RECEBEU", async () => {
    configDaEmpresaMock.mockResolvedValue(config(["whatsapp"]));
    await moduloAtivo(EMPRESA_A, "whatsapp");
    expect(configDaEmpresaMock).toHaveBeenCalledWith(EMPRESA_A);
  });

  it("devolve true para módulo na lista da empresa", async () => {
    configDaEmpresaMock.mockResolvedValue(config(["whatsapp", "automation"]));
    await expect(moduloAtivo(EMPRESA_A, "automation")).resolves.toBe(true);
  });

  it("devolve false para módulo fora da lista", async () => {
    configDaEmpresaMock.mockResolvedValue(config(["whatsapp"]));
    await expect(moduloAtivo(EMPRESA_A, "automation")).resolves.toBe(false);
  });

  it("duas empresas recebem respostas DIFERENTES na mesma execução", async () => {
    // É o caso que separa "lê do banco por empresa" de "lê um arquivo global".
    // Com o config em arquivo, este teste era impossível de escrever: a
    // resposta não dependia de quem perguntava.
    configDaEmpresaMock.mockImplementation(async (id: string) =>
      id === EMPRESA_A ? config(["whatsapp"]) : config([])
    );

    await expect(moduloAtivo(EMPRESA_A, "whatsapp")).resolves.toBe(true);
    await expect(moduloAtivo(EMPRESA_B, "whatsapp")).resolves.toBe(false);
  });
});

describe("exigirModulo", () => {
  it("passa quando o módulo está ligado — e não chama notFound", async () => {
    configDaEmpresaMock.mockResolvedValue(config(["whatsapp"]));
    await expect(exigirModulo(EMPRESA_A, "whatsapp")).resolves.toBeUndefined();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("chama notFound quando o módulo está desligado", async () => {
    // 404, e não redirecionamento: o link some do menu, mas digitar a URL
    // direto não pode contornar o portão (spec 3.4 do Ciclo original).
    configDaEmpresaMock.mockResolvedValue(config([]));
    await expect(exigirModulo(EMPRESA_A, "whatsapp")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });
});
```

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/config-modulos.test.ts
```

Esperado: falha na resolução de `../../src/core/config/modulos`. Cole a saída.

- [ ] **Step 2: Escrever `src/core/config/modulos.ts` e apagar o antigo**

```ts
import { notFound } from "next/navigation";

import { configDaEmpresa } from "./leitura";

export type { ModuloNome } from "./schema";
import type { ModuloNome } from "./schema";

/**
 * O portão de módulos, agora POR EMPRESA.
 *
 * ## Por que este arquivo saiu de `src/lib/` para `src/core/`
 *
 * Ele passou a ler o banco, e `src/lib/**` **não** é coberto pelo bloco
 * `no-restricted-imports` que proíbe o prisma cru — a regra vale para
 * `src/core/**`, `src/modules/**` e `src/app/**` (`eslint.config.mjs`). Um
 * leitor de modelo de tenant em `src/lib/` seria o único caminho de leitura do
 * projeto que o lint não olha. Aqui ele fica debaixo da regra, e é a regra que
 * garante que a leitura passe por `prismaDaEmpresa`.
 *
 * ## Por que o nome é `modulos`, com `o`
 *
 * O arquivo antigo chamava-se `module-gate` e não `modules` porque
 * `no-restricted-imports` usa os padrões `**/modules` e `**/modules/*` para a
 * fronteira core↛modules, e um `src/lib/modules.ts` colidiria com eles por
 * coincidência de nome — bloqueando código legítimo com um erro que aponta
 * para a regra errada. `modulos` é português e não casa com `modules`, então a
 * colisão não volta. Isso não é presumido: a tarefa que criou este arquivo
 * rodou `npm run lint` com ele em disco e colou a saída.
 *
 * ## `companyId` como PRIMEIRO parâmetro
 *
 * Mesma forma das nove funções de `modules/whatsapp` e das sete de
 * `core/tasks` desde o Ciclo 1d. A origem é sempre `usuarioAtual().companyId`,
 * e as seis páginas que chamam o portão já resolvem a sessão no mesmo corpo.
 * O custo da consulta é zero na prática: `configDaEmpresa` é memoizada por
 * requisição e o layout do painel já a pediu antes da página renderizar.
 */
export async function moduloAtivo(companyId: string, nome: ModuloNome): Promise<boolean> {
  const config = await configDaEmpresa(companyId);
  return config.modulos.includes(nome);
}

/**
 * Chamar no topo de uma `page.tsx` de módulo opcional, DEPOIS de resolver a
 * sessão. Módulo desligado não some só do menu — a rota devolve 404, então
 * digitar a URL diretamente não contorna o portão.
 *
 * A ordem mudou junto com este arquivo: antes o portão rodava ANTES de
 * `usuarioAtualOuLogin()`, e um visitante sem sessão recebia 404 num módulo
 * desligado. Agora recebe redirecionamento para `/login` — o estado dos
 * módulos de uma empresa deixa de ser observável por quem não está
 * autenticado, e é o que `(painel)/layout.tsx` já faria de qualquer forma.
 */
export async function exigirModulo(companyId: string, nome: ModuloNome): Promise<void> {
  if (!(await moduloAtivo(companyId, nome))) notFound();
}
```

```bash
cd "d:/Projetos Programação/N8n + Crm"
git rm src/lib/module-gate.ts
```

- [ ] **Step 3: Converter os 6 pontos de chamada nas páginas**

Em **`src/app/(painel)/conversas/page.tsx`**: trocar o import

```ts
import { exigirModulo } from "@/lib/module-gate";
```

por

```ts
import { exigirModulo } from "@/core/config/modulos";
```

e trocar o corpo (linhas 46-50) por:

```ts
export default async function ConversasPage() {
  const usuario = await usuarioAtualOuLogin();
  await exigirModulo(usuario.companyId, "whatsapp");

  const conversas = await listarConversas(usuario.companyId);
```

No JSDoc do mesmo arquivo, a frase que hoje diz *"faz esta rota devolver 404 se algum fork desligar o módulo em `config/client.ts`"* passa a ser:

```
 * `exigirModulo(usuario.companyId, "whatsapp")` faz esta rota devolver 404 se
 * a EMPRESA desta sessão não tiver o módulo ligado (`CompanyConfig.modulos`,
 * com `config/client.ts` como padrão quando não há linha) — mesma defesa em
 * profundidade de `modulosAtivos` em `painel-nav.tsx` (o link some do menu, mas
 * digitar a URL direto não pode contornar o portão). Roda DEPOIS de
 * `usuarioAtualOuLogin()` porque agora precisa saber de qual empresa é a
 * pergunta.
```

Em **`src/app/(painel)/conversas/[id]/page.tsx`**: mesmo import, e o corpo passa de `exigirModulo("whatsapp"); ... const usuario = await usuarioAtualOuLogin();` para a sessão primeiro:

```ts
  const usuario = await usuarioAtualOuLogin();
  await exigirModulo(usuario.companyId, "whatsapp");
```

Em **`src/app/(painel)/conversas/agente/page.tsx`**:

```ts
export default async function AgentePage() {
  const usuario = await usuarioAtualOuLogin();
  await exigirModulo(usuario.companyId, "whatsapp");

  const config = await lerConfigBot(usuario.companyId);
```

Em **`src/app/(painel)/fluxos/page.tsx`**:

```ts
export default async function FluxosPage() {
  const usuario = await usuarioAtualOuLogin();
  await exigirModulo(usuario.companyId, "automation");
```

Em **`src/app/(painel)/fluxos/[id]/page.tsx`**:

```ts
  const usuario = await usuarioAtualOuLogin();
  await exigirModulo(usuario.companyId, "automation");
```

Em **`src/app/(painel)/contatos/[id]/page.tsx`**: trocar o import de `moduloAtivo` para `@/core/config/modulos` e a linha 49 por:

```ts
  const mostrarConversas = await moduloAtivo(usuario.companyId, "whatsapp");
```

Em todos: manter a ordem relativa das demais chamadas, e mover **apenas** a linha do portão. Se em algum arquivo `usuarioAtualOuLogin()` já vier antes, não mexer na ordem.

- [ ] **Step 4: `PainelNav` recebe os módulos por prop**

Em `src/components/painel-nav.tsx`:

- remover `import { moduloAtivo } from "@/lib/module-gate";`
- acrescentar `import type { ModuloNome } from "@/core/config/modulos";`
- trocar a assinatura e o cálculo de `grupoExtra`:

```tsx
/**
 * `PainelNav` continua SÍNCRONA e sem Prisma — é o que a deixa testável com
 * `render(<PainelNav ... />)` sem nenhum mock de banco. Quem busca notificação
 * é `(painel)/layout.tsx`, e o valor chega por prop.
 *
 * `modulosAtivos` e `nomeMarca` chegam pela mesma porta desde o Ciclo 1c, e
 * pelo mesmo motivo: os dois passaram a vir do BANCO, por empresa, e uma
 * leitura assíncrona aqui dentro tornaria este componente impossível de
 * renderizar sem mock de Postgres. São OBRIGATÓRIAS — um padrão silencioso
 * (`= []`, `= "CRM"`) esconderia o dia em que o layout esquecesse de passá-las,
 * e o sintoma seria a barra sem nome ou o menu sem módulo, sem erro nenhum.
 */
export function PainelNav({
  notificacoesNaoLidas = [],
  nomeUsuario,
  papelUsuario,
  modulosAtivos,
  nomeMarca,
  logo,
}: {
  notificacoesNaoLidas?: NotificacaoApresentada[];
  nomeUsuario?: string;
  papelUsuario?: Role;
  modulosAtivos: ModuloNome[];
  nomeMarca: string;
  logo?: { claro: string; escuro: string };
}) {
  // Segundo grupo: módulo e administração. Pode ficar VAZIO — vendedor numa
  // empresa sem whatsapp. `NavLinks` é quem trata a régua nesse caso.
  const grupoExtra: LinkDoPainel[] = [
    ...(modulosAtivos.includes("whatsapp")
      ? [{ href: "/conversas", label: "Conversas", icone: "conversas" as const }]
      : []),
    ...(papelUsuario && hasPermission(papelUsuario, "gerenciar_usuarios")
      ? [{ href: "/usuarios", label: "Equipe", icone: "equipe" as const }]
      : []),
    ...(papelUsuario && hasPermission(papelUsuario, "gerenciar_funil")
      ? [{ href: "/etapas", label: "Etapas", icone: "etapas" as const }]
      : []),
    // Módulo E permissão — as duas, não uma ou outra. `modulosAtivos` sozinho
    // mostraria o link para VENDEDOR (a página faz `notFound()`, mas exibir
    // um link que sempre dá 404 é ruído); `hasPermission` sozinho mostraria
    // o link numa empresa sem o módulo `automation` ligado. `ver_fluxos`
    // (ADMIN e GESTOR), não `gerenciar_fluxos` — esconder o link nunca é o
    // gate de verdade (a página e as actions são), só evita ruído no menu.
    ...(modulosAtivos.includes("automation") && papelUsuario && hasPermission(papelUsuario, "ver_fluxos")
      ? [{ href: "/fluxos", label: "Fluxos", icone: "fluxos" as const }]
      : []),
  ];
```

E as duas chamadas de `<Marca />` no corpo de `conteudo()` e da barra do celular passam a ser `<Marca nome={nomeMarca} logo={logo} />` — o componente `Marca` ainda importa o config nesta tarefa, então a Tarefa 5 é quem faz as props chegarem de verdade. Para não deixar a árvore quebrada no meio, **nesta tarefa `Marca` já muda junto**: ver o Step 5.

- [ ] **Step 5: `Marca` por props**

Substituir `src/components/marca.tsx` inteiro por:

```tsx
/**
 * A marca do cliente no topo da barra lateral.
 *
 * Dois caminhos, e o de texto é o NORMAL enquanto não houver arquivo de logo
 * — não é remendo. `marca.logo` é opcional no schema justamente por isso.
 *
 * Recebe `nome` e `logo` por PROP desde o Ciclo 1c: os dois passaram a vir do
 * banco, por empresa (`Company.nome` e `CompanyConfig.logoClaro/logoEscuro`,
 * com `config/client.ts` como padrão). Importar o config aqui dentro voltaria a
 * amarrar a barra lateral a um arquivo de build e faria este componente
 * impossível de renderizar com a marca de uma empresa que não seja a do
 * arquivo.
 *
 * Sem `next/image`: SVG não se beneficia do otimizador. Sem `onError`: exigiria
 * componente de cliente, e o comportamento nativo do navegador com `alt` de
 * imagem quebrada já entrega a mesma degradação de graça.
 */
export function Marca({ nome, logo }: { nome: string; logo?: { claro: string; escuro: string } }) {
  if (!logo) {
    return <span className="text-sm font-semibold">{nome}</span>;
  }

  return (
    <span className="flex items-center gap-2">
      {/*
        As duas artes vão para o DOM e o CSS esconde uma. Parece desperdício
        de 3 KB e não é: a alternativa — ler o tema em JavaScript e trocar o
        `src` — exigiria componente de cliente e mostraria o logo errado no
        primeiro quadro, porque no servidor não há como saber o tema guardado.
        É o mesmo defeito que o `aria-label` do alternador teve, e ali levou
        um e2e para achar. Aqui o CSS troca junto com o resto do tema, antes
        do primeiro pixel.

        O `alt` carrega o nome porque a arte está SOZINHA: sem texto ao lado,
        ela é a única identificação da marca, e `alt=""` deixaria a barra sem
        nome nenhum para quem usa leitor de tela. Nas duas, porque a escondida
        não é anunciada — só a visível chega na árvore de acessibilidade.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo.claro} alt={nome} className="h-8 w-auto dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo.escuro} alt={nome} className="hidden h-8 w-auto dark:block" />
    </span>
  );
}
```

- [ ] **Step 6: O layout do painel passa as props novas**

Em `src/app/(painel)/layout.tsx`, acrescentar o import e a leitura, e passar as três props. **Só isto nesta tarefa** — tema, fonte e `generateMetadata` são a Tarefa 5.

Import novo, junto dos outros:

```ts
import { configDaEmpresa } from "@/core/config/leitura";
```

Depois de `const notificacoesNaoLidas = ...`:

```ts
  // Uma consulta, memoizada por requisição (`cache()` em
  // `core/config/leitura.ts`): as páginas abaixo deste layout chamam
  // `exigirModulo(usuario.companyId, ...)` e caem na MESMA entrada, então o
  // portão de módulo delas não custa ida nova ao banco.
  const config = await configDaEmpresa(usuario.companyId);
```

E o `<PainelNav>`:

```tsx
        <PainelNav
          notificacoesNaoLidas={notificacoesNaoLidas}
          nomeUsuario={usuario.nome}
          papelUsuario={usuario.papel}
          modulosAtivos={config.modulos}
          nomeMarca={config.nome}
          logo={config.marca.logo}
        />
```

- [ ] **Step 7: Atualizar os três testes que dependiam do config em arquivo**

**`tests/unit/modules.test.ts`** deixa de existir na forma atual — ele testava `moduloAtivo` lendo o arquivo, e essa função agora tem cobertura própria em `config-modulos.test.ts`. Apagar:

```bash
cd "d:/Projetos Programação/N8n + Crm"
git rm tests/unit/modules.test.ts
```

**`tests/unit/painel-nav.test.tsx`**: remover o bloco `mocks`/`vi.mock("../../config/client")` (linhas 17-32 do arquivo atual, do comentário `// \`nome\`/\`marca\` entraram junto...` até o fecho do `vi.mock`) e substituí-lo por:

```tsx
// `config/client` NÃO é mais mockado aqui: desde o Ciclo 1c os módulos e o
// nome da marca chegam por PROP, vindos do banco por empresa. O mock existia
// para o teste não depender do que o fork tivesse ligado; a prop faz melhor,
// porque cada caso declara na própria linha o que está ligado.
```

Acrescentar, logo depois de `const { PainelNav } = await import(...)`:

```tsx
/**
 * As duas props obrigatórias do Ciclo 1c em um lugar só. Cada caso sobrepõe o
 * que interessa a ele — antes isso era um objeto `mocks` mutável compartilhado
 * por todo o arquivo, com `afterEach` restaurando o padrão; um caso que
 * esquecesse de restaurar vazava para o seguinte.
 */
function montar(props: Partial<React.ComponentProps<typeof PainelNav>> = {}) {
  return render(<PainelNav modulosAtivos={["whatsapp"]} nomeMarca="AutoCenter" {...props} />);
}
```

E aplicar estas substituições, uma a uma (o `afterEach` perde a linha `mocks.modulos = ["whatsapp"];`, ficando só com `cleanup();`):

| Antes | Depois |
| --- | --- |
| `render(<PainelNav />);` (caso "mostra o link de um módulo ativo") | `montar();` |
| `mocks.modulos = [];` + `render(<PainelNav />);` (caso "não mostra o link de um módulo desligado") | `montar({ modulosAtivos: [] });` |
| `mocks.modulos = ["catalog", "analytics", "whatsapp"];` + `render(<PainelNav />);` | `montar({ modulosAtivos: ["catalog", "analytics", "whatsapp"] });` |
| `render(<PainelNav papelUsuario="ADMIN" />);` | `montar({ papelUsuario: "ADMIN" });` |
| `render(<PainelNav papelUsuario="GESTOR" />);` | `montar({ papelUsuario: "GESTOR" });` |
| `render(<PainelNav papelUsuario="VENDEDOR" />);` | `montar({ papelUsuario: "VENDEDOR" });` |
| `render(<PainelNav />);` (caso "omite Equipe quando o papel não é informado") | `montar();` |
| `render(<PainelNav />);` (caso "sempre mostra os links fixos") | `montar();` |
| `render(<PainelNav />);` (caso "mostra o botão de sair") | `montar();` |
| `render(<PainelNav nomeUsuario="Maria Vendedora" />);` | `montar({ nomeUsuario: "Maria Vendedora" });` |
| `render(<PainelNav />);` (caso "não quebra quando o nome não é informado") | `montar();` |
| `render(<PainelNav nomeUsuario="Rodrigo" papelUsuario="ADMIN" />);` | `montar({ nomeUsuario: "Rodrigo", papelUsuario: "ADMIN" });` |
| `const { container } = render(<PainelNav nomeUsuario="Rodrigo" papelUsuario="ADMIN" />);` | `const { container } = montar({ nomeUsuario: "Rodrigo", papelUsuario: "ADMIN" });` |
| `render(<PainelNav nomeUsuario="Rodrigo" />);` (gaveta) | `montar({ nomeUsuario: "Rodrigo" });` |
| `mocks.modulos = [];` + `const { container } = render(<PainelNav nomeUsuario="Ana" papelUsuario="VENDEDOR" />);` | `const { container } = montar({ modulosAtivos: [], nomeUsuario: "Ana", papelUsuario: "VENDEDOR" });` |

E acrescentar um caso novo ao final do `describe`, porque a marca por prop é comportamento novo e sem ele ninguém cobre:

```tsx
  it("mostra o nome da marca que RECEBEU, não um valor de arquivo", () => {
    // Duas ocorrências: o `<aside>` do desktop e a barra do celular renderizam
    // `<Marca />` cada um (ver o comentário de `conteudo` em painel-nav.tsx).
    montar({ nomeMarca: "Empresa da Sessao" });
    expect(screen.getAllByText("Empresa da Sessao")).toHaveLength(2);
  });
```

**`tests/unit/fluxos-pages-gate.test.tsx`**: as duas páginas passaram a chamar `exigirModulo(companyId, "automation")`, que agora lê o banco. Acrescentar o mock, logo depois do `vi.mock("next/navigation", ...)` existente:

```tsx
// `exigirModulo` passou a ler o banco no Ciclo 1c (`CompanyConfig.modulos`).
// Este arquivo testa o gate de PERMISSÃO, não o de módulo — o de módulo tem
// arquivo próprio (`config-modulos.test.ts`). Mockar aqui mantém os dois
// separados: sem isto, um módulo desligado faria estes casos falharem com
// `notFound` pelo motivo errado.
vi.mock("@/core/config/modulos", () => ({ exigirModulo: vi.fn(async () => {}) }));
```

- [ ] **Step 8: Rodar (GREEN) e fechar**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/config-modulos.test.ts tests/unit/painel-nav.test.tsx tests/unit/fluxos-pages-gate.test.tsx tests/unit/marca.test.tsx tests/unit/nav-links.test.tsx
npm run typecheck
npm run lint
```

`tests/unit/marca.test.tsx` vai falhar neste ponto: ele ainda mocka `config/client` e renderiza `<Marca />` sem props. Corrigi-lo é parte desta tarefa — remover o `vi.mock("../../config/client", ...)` e o `mocks` hoisted, e trocar os três `render(<Marca />)` por:

```tsx
    render(<Marca nome="AutoCenter" />);
```

no primeiro caso, e

```tsx
    const { container } = render(
      <Marca nome="AutoCenter" logo={{ claro: "/logo-preto.svg", escuro: "/logo-branco.svg" }} />
    );
```

nos dois casos com logo (o `afterEach` fica só com `cleanup();`).

Rodar de novo o mesmo comando. Esperado: os cinco arquivos verdes, `tsc` sem saída, lint com **zero erros** — em especial nenhuma menção a `module-gate`. Cole as três saídas.

```bash
cd "d:/Projetos Programação/N8n + Crm"
grep -rn "module-gate" src/ tests/ ; echo "saida vazia = nenhuma referencia sobrou"
```

Esperado: nenhuma linha antes da mensagem.

- [ ] **Step 9: Commit**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git add -A src/core/config/modulos.ts src/lib src/components/painel-nav.tsx src/components/marca.tsx "src/app/(painel)" tests/unit
git commit -m "feat(config): portao de modulos por empresa, e o module-gate sai de src/lib

O arquivo mudou de arvore porque passou a ler banco: src/lib/** nao e coberto
pelo no-restricted-imports que proibe o prisma cru (a regra vale para core,
modules e app), entao um leitor de modelo de tenant ali seria o unico caminho de
leitura do projeto que o lint nao olha.

O nome novo e modulos, com o: o nome antigo existia para nao colidir com os
padroes **/modules do lint, e modulos em portugues nao casa com modules. Rodado
npm run lint com o arquivo em disco, nao deduzido.

PainelNav continua SINCRONA e sem Prisma -- os modulos e o nome da marca chegam
por prop, obrigatorias. Padrao silencioso esconderia o dia em que o layout
esquecesse de passa-las, e o sintoma seria barra sem nome ou menu sem modulo,
sem erro nenhum.

O portao passou a rodar DEPOIS de usuarioAtualOuLogin() em quatro paginas, e o
efeito e desejado: visitante sem sessao deixa de conseguir observar quais
modulos a empresa tem por 404-vs-redirect.

tests/unit/modules.test.ts sai: ele provava moduloAtivo lendo o arquivo, e a
funcao agora tem arquivo proprio com duas empresas na mesma execucao -- caso que
era impossivel escrever enquanto a resposta nao dependia de quem perguntava.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: A marca da empresa aplicada no layout do painel

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Modify: `src/app/(painel)/layout.tsx`
- Modify: `src/app/layout.tsx` (só o JSDoc)
- Modify: `config/client.ts` (só comentário)
- Test: `tests/unit/painel-layout-marca.test.tsx` (novo)

**Interfaces:**
- Consumes: `configDaEmpresa` (Task 3, já importada no layout pela Task 4); `derivarTema` (`@/lib/tema`); `fonteDaMarca` (`@/lib/tema/fontes`); `client` (`config/client.ts`); `usuarioAtual` (`@/core/auth/session`).
- Produces:
  - `generateMetadata()` exportada de `src/app/(painel)/layout.tsx`
  - um segundo `<style>` com `:root:root` no corpo do painel
  - um elemento de conteúdo com `` `${fonte.variable} font-sans` ``

- [ ] **Step 1: Escrever o teste que falha (RED)**

Criar `tests/unit/painel-layout-marca.test.tsx`:

```tsx
// @vitest-environment jsdom
//
// O layout do painel é um Server Component assíncrono: chamado direto como
// função, sem framework de rota, o retorno é um elemento React que dá para
// `render()` no jsdom. Mesmo padrão de `fluxos-pages-gate.test.tsx` e
// `login-page-guard.test.tsx`.
//
// O que este arquivo trava é a COMPOSIÇÃO da marca por empresa, que é onde ela
// falha em silêncio:
//
// 1. O segundo `<style>` precisa carregar a cor da EMPRESA. Se alguém trocar
//    `configDaEmpresa` por `client.marca` de novo, a tela continua bonita e o
//    white-label some.
// 2. O elemento de conteúdo precisa das DUAS classes de fonte. A `.variable`
//    redefine `--font-marca` naquele elemento; sem `font-sans`, o
//    `font-family` computado herdado do `<html>` (globals.css:120-129)
//    continua valendo e a redefinição não tem efeito NENHUM. Nada na tela
//    denuncia isso: a fonte do arquivo simplesmente continua.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("server-only", () => ({}));

const { usuarioAtualMock, configDaEmpresaMock, listarNotificacoesMock } = vi.hoisted(() => ({
  usuarioAtualMock: vi.fn(),
  configDaEmpresaMock: vi.fn(),
  listarNotificacoesMock: vi.fn(async () => []),
}));

vi.mock("@/core/auth/session", () => ({ usuarioAtual: () => usuarioAtualMock() }));
vi.mock("@/core/config/leitura", () => ({ configDaEmpresa: (id: string) => configDaEmpresaMock(id) }));
vi.mock("@/core/notifications/dispatch", () => ({
  listarNotificacoesNaoLidas: () => listarNotificacoesMock(),
}));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/core/notifications/actions", () => ({ marcarNotificacaoComoLidaAction: vi.fn() }));
vi.mock("@/core/auth/actions", () => ({ sairAction: vi.fn() }));
// `next/font/google` NÃO funciona sob Vitest: `Geist({...})` lança
// `TypeError: Geist is not a function`, porque as funções de fonte são
// substituídas por um plugin do bundler do Next e, fora dele, o módulo não
// exporta função nenhuma. Medido em 2026-08-20 com um teste-sonda descartável,
// não deduzido.
//
// Consequência honesta: este arquivo prova a COMPOSIÇÃO — qual classe vai em
// qual elemento, junto de qual outra classe — e NÃO o mapeamento nome→fonte.
// O mapeamento real só é observável num navegador, e por isso o caso da fonte
// em `tests/e2e/marca-por-empresa.spec.ts` é load-bearing, não decoração.
vi.mock("@/lib/tema/fontes", () => ({
  fonteDaMarca: (nome: string) => ({ variable: `fonte-${nome.replace(/\s+/g, "-")}` }),
}));
// `next-themes` monta um provider que depende de `window.matchMedia`; o
// componente real não acrescenta nada ao que este arquivo mede.
vi.mock("next-themes", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const PainelLayout = (await import("../../src/app/(painel)/layout")).default;
const { generateMetadata } = await import("../../src/app/(painel)/layout");
const { client } = await import("../../config/client");

const EMPRESA = "cmp_a";

const USUARIO = { id: "u1", nome: "Rodrigo", email: "r@x.test", ativo: true, companyId: EMPRESA, papel: "ADMIN" };

function configComCor(corPrimaria: string, fonte: "Geist" | "Inter" | "Manrope" | "IBM Plex Sans") {
  return { nome: "Empresa da Sessao", marca: { corPrimaria, fonte }, modulos: ["whatsapp"] };
}

beforeEach(() => {
  usuarioAtualMock.mockReset();
  configDaEmpresaMock.mockReset();
  usuarioAtualMock.mockResolvedValue(USUARIO);
});

afterEach(() => cleanup());

describe("(painel)/layout — a marca da empresa", () => {
  it("emite um `<style>` com a cor da EMPRESA, e não a do arquivo", async () => {
    // `#0F62FE` é azul; o arquivo é `#6D4AFF`, roxo. Os dois passam no piso de
    // croma, então o que separa um do outro na saída é só a origem do valor.
    configDaEmpresaMock.mockResolvedValue(configComCor("#0F62FE", "Geist"));

    const { container } = render(await PainelLayout({ children: <div /> }));
    const estilo = container.querySelector("style");

    expect(estilo, "o painel não emitiu nenhum <style>").toBeTruthy();
    const css = estilo!.innerHTML;

    expect(css).toContain(":root:root{");
    expect(css).toContain(":root:root.dark{");

    // A comparação é contra o CSS que `derivarTema` produz para CADA cor, e
    // não contra uma string literal: literal envelheceria junto com a paleta.
    const { derivarTema } = await import("../../src/lib/tema");
    expect(css).toBe(derivarTema({ corPrimaria: "#0F62FE" }));
    expect(css).not.toBe(derivarTema({ corPrimaria: client.marca.corPrimaria }));
  });

  it("o texto do `<style>` não contém `<` — nenhum texto do config chega ali", async () => {
    // O layout raiz apoiava a segurança do `dangerouslySetInnerHTML` no fato de
    // `tema` ser constante de build de arquivo versionado. Aqui o valor vem do
    // BANCO, e o que fecha não é a origem: `derivarTema` só emite números
    // (`hexParaOklch` lança fora de #RRGGBB, `formatarOklch` produz numerais), e
    // o valor ainda atravessa `marcaSchema` na leitura. Este caso é a segunda
    // trava, executável.
    configDaEmpresaMock.mockResolvedValue(configComCor("#0F62FE", "Geist"));

    const { container } = render(await PainelLayout({ children: <div /> }));
    expect(container.querySelector("style")!.innerHTML).not.toContain("<");
  });

  it("o elemento de conteúdo tem AS DUAS classes de fonte", async () => {
    configDaEmpresaMock.mockResolvedValue(configComCor("#0F62FE", "Manrope"));

    const { container } = render(await PainelLayout({ children: <div /> }));

    // `fonte-Manrope` é o que o mock de `fonteDaMarca` devolve (topo do
    // arquivo). A classe REAL do `next/font` é opaca (`__variable_xxxxx`) e não
    // existe fora do bundler do Next.
    const alvo = container.querySelector(".fonte-Manrope");
    expect(alvo, "nenhum elemento recebeu a classe da fonte da empresa").toBeTruthy();

    // `font-sans` é a metade que ninguém lembra: sem ela, `--font-marca` é
    // redefinida naquele elemento e o `font-family` computado, herdado do
    // `<html>`, continua o do arquivo. A fonte da empresa não aparece, e nada
    // na tela diz por quê.
    expect(alvo!.className.split(/\s+/)).toContain("font-sans");
  });

  it("a fonte muda quando a empresa muda", async () => {
    configDaEmpresaMock.mockResolvedValue(configComCor("#0F62FE", "Inter"));
    const { container } = render(await PainelLayout({ children: <div /> }));

    expect(container.querySelector(".fonte-Inter")).toBeTruthy();
    expect(container.querySelector(".fonte-Manrope")).toBeNull();
  });
});

describe("(painel)/layout — generateMetadata", () => {
  it("usa o nome da EMPRESA quando há sessão", async () => {
    configDaEmpresaMock.mockResolvedValue(configComCor("#0F62FE", "Geist"));
    await expect(generateMetadata()).resolves.toEqual({
      title: "Empresa da Sessao",
      description: "Painel de gestão — Empresa da Sessao",
    });
  });

  it("cai no nome do PRODUTO quando não há sessão — e não lança", async () => {
    // `generateMetadata` roda em paralelo ao render. Uma sessão que morre no
    // meio faria `usuarioAtual()` rejeitar aqui, e uma rejeição não tratada em
    // metadata vira tela de erro genérica com digest em vez de ida para o
    // login. Mesmo raciocínio do `try/catch` de `usuarioAtualOuLogin`.
    usuarioAtualMock.mockRejectedValue(new Error("Não autenticado"));
    await expect(generateMetadata()).resolves.toEqual({
      title: client.nome,
      description: `Painel de gestão — ${client.nome}`,
    });
    expect(configDaEmpresaMock).not.toHaveBeenCalled();
  });
});
```

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/painel-layout-marca.test.tsx
```

Esperado: vermelho — `generateMetadata` não é exportada e nenhum `<style>` é emitido pelo painel. Cole a saída.

- [ ] **Step 2: Aplicar a marca no layout do painel**

Em `src/app/(painel)/layout.tsx`, acrescentar aos imports:

```ts
import type { Metadata } from "next";

import { client } from "../../../config/client";
import { derivarTema } from "@/lib/tema";
import { fonteDaMarca } from "@/lib/tema/fontes";
```

Logo depois de `export const dynamic = "force-dynamic";`, acrescentar:

```ts
/**
 * O título da aba passa a ser o nome da EMPRESA nas rotas do painel.
 *
 * Metadata de layout filho substitui a do raiz nas rotas dele, então `/login`
 * — que fica FORA de `(painel)` — continua com o nome do produto, vindo de
 * `config/client.ts`. É o desenho inteiro do Ciclo 1c em uma linha: fora da
 * sessão não existe empresa, logo não existe marca de empresa.
 *
 * Custo: zero consulta nova. `usuarioAtual()` e `configDaEmpresa()` são as duas
 * memoizadas por requisição (`cache()` do React), e `generateMetadata` roda na
 * mesma requisição do render.
 *
 * `try/catch` porque `generateMetadata` roda em PARALELO ao render: uma sessão
 * que morre no meio faz `usuarioAtual()` rejeitar aqui, e rejeição não tratada
 * em metadata vira tela de erro genérica com digest — em vez do
 * redirecionamento para `/login` que o componente abaixo faz. Mesmo raciocínio
 * que pôs o `try/catch` em `usuarioAtualOuLogin`, e o Sentry já registrou a
 * versão sem ele como erro NÃO TRATADO em `GET /leads`.
 */
export async function generateMetadata(): Promise<Metadata> {
  try {
    const usuario = await usuarioAtual();
    const config = await configDaEmpresa(usuario.companyId);
    return { title: config.nome, description: `Painel de gestão — ${config.nome}` };
  } catch {
    return { title: client.nome, description: `Painel de gestão — ${client.nome}` };
  }
}
```

E no corpo do componente, depois de `const config = await configDaEmpresa(usuario.companyId);` (que a Tarefa 4 já colocou), acrescentar:

```ts
  const fonte = fonteDaMarca(config.marca.fonte);
  const tema = derivarTema(config.marca);
```

Substituir o `return` inteiro por:

```tsx
  return (
    <ThemeProvider
      attribute="class"
      themes={["light", "dark"]}
      enableSystem={false}
      defaultTheme="dark"
      nonce={nonce}
    >
      {/*
        O SEGUNDO bloco de tema do documento. O layout raiz já emitiu um, com o
        padrão de `config/client.ts`; este sobrepõe com a marca da EMPRESA da
        sessão.

        Ele vence por ORDEM, não por especificidade: os dois usam `:root:root`
        — (0,2,0), escolhido em `src/lib/tema/index.ts` para vencer
        `globals.css` sem depender de ordem de inserção —, e entre blocos de
        especificidade igual o CSS aplica o que vem depois no documento. Este
        está no `<body>`, o do raiz no `<head>`. Sem flash: os dois chegam no
        mesmo HTML da mesma resposta.

        A raiz NÃO faz isto, e não é por custo de renderização dinâmica: medido
        em 2026-08-20, `npm run build` mostra UMA rota estática no projeto
        inteiro (`/_not-found`). É porque a raiz envolve `/login`, onde não há
        sessão e portanto não há empresa — dinamizá-la não faria aparecer um
        `companyId` que não existe, só acrescentaria uma consulta sem resposta a
        toda requisição fora do painel.

        `dangerouslySetInnerHTML` com valor que agora vem do BANCO: o que fecha
        não é a origem. `derivarTema` só emite números — `hexParaOklch` LANÇA
        para qualquer coisa fora de `#RRGGBB` e `formatarOklch` produz
        exclusivamente numerais —, e o valor já atravessou `marcaSchema` na
        leitura. Duas travas, e a segunda tem caso em
        `tests/unit/painel-layout-marca.test.tsx`, que afirma que o texto
        emitido não contém `<`.

        O CSP não muda: `style-src` já tem `'unsafe-inline'` por causa do
        atributo `style` das cores de etapa no kanban (ver `lib/tema/index.ts`),
        e este `<style>` é do mesmo tipo do que já existe na raiz.
      */}
      <style dangerouslySetInnerHTML={{ __html: tema }} />
      {/*
        AS DUAS classes, e a segunda é a que ninguém lembra.

        `fonte.variable` redefine `--font-marca` NESTE elemento. Só isso não
        muda nada: `globals.css` aplica `font-sans` no `<html>`, o `font-family`
        computado ali já resolveu `var(--font-marca)` com o valor do arquivo, e
        descendentes herdam o VALOR COMPUTADO — não a variável. `font-sans` aqui
        força a reavaliação neste subárvore.

        É falha silenciosa: sem `font-sans` a tela continua bonita, com a fonte
        do arquivo, e nada denuncia que a fonte da empresa foi ignorada. Por
        isso o caso de teste afirma as DUAS classes no mesmo elemento.
      */}
      <div className={`${fonte.variable} font-sans flex min-h-screen flex-col lg:flex-row`}>
        {/* `papelUsuario` alimenta o link de "Equipe", que só ADMIN vê.
            `PainelNav` é síncrona e não tem acesso à sessão nem ao banco — o
            papel, os módulos e a marca vêm daqui, do que este layout já
            resolveu, sem consulta nova. */}
        <PainelNav
          notificacoesNaoLidas={notificacoesNaoLidas}
          nomeUsuario={usuario.nome}
          papelUsuario={usuario.papel}
          modulosAtivos={config.modulos}
          nomeMarca={config.nome}
          logo={config.marca.logo}
        />
        <main className="flex-1">{children}</main>
      </div>
    </ThemeProvider>
  );
```

- [ ] **Step 3: Corrigir a frase medida do layout raiz**

Em `src/app/layout.tsx`, o parágrafo final do JSDoc do `RootLayout` passa a ser:

```
 * O layout raiz continua SÍNCRONO: `client` é importação estática, não há
 * `headers()` aqui. Ler o nonce na raiz tornaria dinâmica a única rota que
 * ainda é estática — medido em 2026-08-20 com `npm run build`: `/_not-found`,
 * e nada mais (as outras 21 já são dinâmicas, `/login` inclusive, porque ela
 * chama `usuarioAtual()`). Esta frase dizia "toda rota dinâmica"; o número
 * medido é 1.
 *
 * O motivo de a raiz não ler a marca da empresa NÃO é esse custo, e sim que
 * ela envolve `/login`, onde não existe sessão e portanto não existe empresa.
 * Quem aplica a marca por empresa é `(painel)/layout.tsx`, que já é
 * `force-dynamic` e já tem `companyId` em mãos — Ciclo 1c, decisão 4.3.
```

E o comentário dentro do `<head>`, sobre o `dangerouslySetInnerHTML`, ganha uma frase final:

```
          entrada de usuário — e todo valor passa por `formatarOklch`, que
          emite exclusivamente números. Nenhum texto do config chega a este
          string. O painel emite um SEGUNDO bloco, com a marca da empresa
          (`(painel)/layout.tsx`), e lá a origem é o banco — o que fecha o caso
          lá é `formatarOklch` mais a validação de `marcaSchema` na leitura,
          não a origem.
```

- [ ] **Step 4: O comentário de `config/client.ts` passa a dizer o que o arquivo é agora**

Em `config/client.ts`, substituir o JSDoc do topo por:

```ts
/**
 * O PADRÃO do produto. Desde o Ciclo 1c, não mais "a configuração".
 *
 * `marca` e `modulos` daqui são o valor usado quando a empresa não decidiu:
 * `CompanyConfig` sobrepõe campo a campo, e empresa SEM LINHA usa isto inteiro
 * (`src/core/config/schema.ts`). Os outros blocos continuam morando só aqui, e
 * cada um por um motivo medido — ver a seção 4.1 do spec
 * `docs/superpowers/specs/2026-08-20-ciclo-1c-config-no-banco-design.md`:
 * `vertical`, `entidade` e `whatsapp` não têm consumidor nenhum, e `funil` já
 * vive em `PipelineStage` com CRUD próprio desde o Ciclo de etapas.
 *
 * **Consequência que morde:** depois que existe uma linha de `CompanyConfig`
 * para uma empresa, editar `marca` ou `modulos` aqui deixa de ter efeito para
 * ela. É o mesmo contrato que `funil` já tem com `PipelineStage` (ver
 * `prisma/seed.ts`): arquivo é semente, banco é o estado. O seed cria a linha
 * só com `modulos`, então a marca continua vindo daqui até alguém decidir a
 * identidade do produto (decisão 8 do spec do programa, ainda EM ABERTO).
 *
 * `parse` e não anotação de tipo: até 2026-08-09 este arquivo só DECLARAVA
 * `: ClientConfig`, então o schema Zod existia e nunca rodava — `marca` e
 * `entidade` podiam conter qualquer coisa sem ninguém notar.
 *
 * Validar em escopo de módulo já derrubou o deploy deste projeto uma vez: o
 * módulo `whatsapp` validava VARIÁVEIS DE AMBIENTE na importação, e
 * `next build` fazia a validação rodar sem elas na Vercel. Aqui é seguro pelo
 * motivo oposto — os valores estão neste arquivo versionado, não no ambiente,
 * e não há como faltarem no build. É essa propriedade que faz o arquivo ser o
 * padrão e o banco a sobreposição, e não o contrário.
 */
```

- [ ] **Step 5: Rodar (GREEN) e fechar**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/painel-layout-marca.test.tsx tests/unit/client-config.test.ts
npm run typecheck
npm run lint
npm run build
```

Esperado: 6 casos no arquivo novo e o `client-config` verde sem alteração; `tsc` sem saída; lint sem erro; e a tabela de rotas do build **ainda com uma única `○`, `/_not-found`**. Cole as quatro saídas, a tabela de rotas inteira.

- [ ] **Step 6: Commit**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git add "src/app/(painel)/layout.tsx" src/app/layout.tsx config/client.ts tests/unit/painel-layout-marca.test.tsx
git commit -m "feat(marca): o painel aplica a marca da empresa, a raiz mantem o padrao

A raiz nao le a marca por empresa porque ela envolve /login, onde nao ha sessao
e portanto nao ha empresa -- dinamiza-la nao faria aparecer um companyId que nao
existe. O custo de dinamizar tambem foi MEDIDO e nao e o argumento: npm run
build mostra UMA rota estatica no projeto (/_not-found). A frase do JSDoc dizia
'toda rota dinamica'; o numero e 1, e a frase foi corrigida.

O painel emite um SEGUNDO bloco de tema e vence por ORDEM, nao por
especificidade: os dois usam :root:root e o do painel esta no body, depois do
head. Mesma resposta HTTP, sem flash.

O elemento de conteudo leva AS DUAS classes de fonte. So a .variable nao muda
nada -- globals.css aplica font-sans no html, o font-family computado la ja
resolveu var(--font-marca), e descendentes herdam o VALOR, nao a variavel. E
falha silenciosa: a tela continua bonita com a fonte do arquivo. O caso de teste
afirma as duas classes no mesmo elemento.

generateMetadata poe o nome da empresa na aba, com try/catch caindo no nome do
produto: metadata roda em paralelo ao render, e rejeicao nao tratada la vira
tela de erro com digest em vez de ida para o login -- o Sentry ja registrou essa
forma exata em GET /leads.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: O seed garante a linha da empresa — com os módulos, e só

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Modify: `prisma/seed.ts`
- Modify: `tests/unit/seed.test.ts`

**Interfaces:**
- Consumes: `client.modulos` (`config/client.ts`); `prisma` (`../src/lib/prisma`, já importado pelo seed); `empresa.id` (a `Company` que o seed já resolve na linha 87).
- Produces: uma linha de `CompanyConfig` por empresa semeada, com `modulos` preenchido e **todas as colunas de marca nulas**.

- [ ] **Step 1: Escrever o caso que falha (RED)**

Em `tests/unit/seed.test.ts`, acrescentar ao final do `describe("prisma/seed.ts", ...)` — antes do `describe("SEED_PASSWORD ...")`:

```ts
  it("cria UMA linha de CompanyConfig com os módulos, e nenhuma coluna de marca", async () => {
    await seed();

    const empresa = await prisma.company.findFirstOrThrow({ orderBy: { criadoEm: "asc" } });
    const configs = await prisma.companyConfig.findMany({ where: { companyId: empresa.id } });

    expect(configs).toHaveLength(1);
    expect(configs[0].modulos).toEqual([...client.modulos]);

    // As colunas de marca nascem NULAS de propósito: nulo significa "não
    // decidi, usa o padrão do arquivo". A decisão 8 do spec do programa mantém
    // a identidade do produto EM ABERTO, e gravar a cor atual do arquivo aqui
    // congelaria essa não-decisão no banco — a partir daí, editar
    // `config/client.ts` deixaria de ter efeito, em silêncio.
    expect(configs[0].corPrimaria).toBeNull();
    expect(configs[0].fonte).toBeNull();
    expect(configs[0].logoClaro).toBeNull();
    expect(configs[0].logoEscuro).toBeNull();
  });

  it("é idempotente na config: rodar de novo não cria uma segunda linha nem sobrescreve a existente", async () => {
    await seed();
    const empresa = await prisma.company.findFirstOrThrow({ orderBy: { criadoEm: "asc" } });

    // Alguém "decidiu" a cor depois da instalação — é o que uma tela futura
    // faria, e é o que um UPDATE à mão faz hoje.
    await prisma.companyConfig.updateMany({
      where: { companyId: empresa.id },
      data: { corPrimaria: "#0F62FE" },
    });

    await seed();

    const configs = await prisma.companyConfig.findMany({ where: { companyId: empresa.id } });
    expect(configs).toHaveLength(1);
    // O seed é SEMENTE de instalação, não reconciliador. `client.funil` já
    // aprendeu isso do jeito caro: o `upsert` por `ordem` que morava no seed
    // renomeava etapa criada pela tela (ver o comentário em prisma/seed.ts).
    expect(configs[0].corPrimaria).toBe("#0F62FE");

    // Devolve o banco ao estado que o seed cria, para não deixar uma cor de
    // teste pendurada no banco de desenvolvimento (⚠️ R1 do Ciclo 1a).
    await prisma.companyConfig.updateMany({
      where: { companyId: empresa.id },
      data: { corPrimaria: null },
    });
  });
```

E acrescentar o import de `client` no topo do arquivo, junto dos outros:

```ts
import { client } from "../../config/client";
```

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/seed.test.ts
```

**Este comando roda o seed contra o banco de desenvolvimento e reescreve o `senhaHash` do admin com um literal versionado** — ⚠️ R1 / 🔍 NV5 da auditoria do Ciclo 1a. Não é custo novo desta tarefa (a Tarefa 8 roda `npm test`, que executa este mesmo arquivo), mas precisa ser dito antes de apertar o enter.

Esperado: vermelho nos dois casos novos — `configs` vem com `toHaveLength(0)`. Cole a saída.

- [ ] **Step 2: Acrescentar a criação da linha ao seed**

Em `prisma/seed.ts`, logo depois do bloco que resolve `empresa` (a linha
`const empresa = empresaExistente ?? (await prisma.company.create(...))`), acrescentar:

```ts
  // A configuração por empresa nasce com os MÓDULOS e SÓ com eles.
  //
  // Mesma regra de instalação do funil, dez linhas abaixo: existe? deixa como
  // está. Não existe? cria UMA. O seed é SEMENTE, não reconciliador — o
  // `upsert` por `ordem` que morava aqui para as etapas virou destrutivo no dia
  // em que `/etapas` existiu, renomeando etapa criada pela tela.
  //
  // As colunas de MARCA ficam NULAS de propósito, e nulo significa "não decidi,
  // usa o padrão de config/client.ts" (src/core/config/schema.ts). A decisão 8
  // do spec do programa mantém a identidade do produto EM ABERTO; gravar a cor
  // atual do arquivo aqui congelaria essa não-decisão no banco, e a partir daí
  // editar o arquivo deixaria de ter efeito para esta empresa, em silêncio.
  //
  // `modulos` é diferente porque não TEM estado nulo: lista escalar no Prisma
  // nunca é nula, e por isso a regra dela é "se a linha existe, ela manda".
  // Semear com `client.modulos` mantém o comportamento idêntico ao de antes
  // deste ciclo e é o que põe o caminho de banco em uso de verdade na aplicação
  // — em vez de deixar uma tabela criada e nunca lida.
  const configExistente = await prisma.companyConfig.findFirst({
    where: { companyId: empresa.id },
    select: { id: true },
  });
  if (!configExistente) {
    await prisma.companyConfig.create({
      data: { companyId: empresa.id, modulos: [...client.modulos] },
    });
  }
```

E, no JSDoc de `seed()`, acrescentar um item à lista de "por isso":

```
 * - CompanyConfig: uma linha por empresa, criada só quando não existe
 *   (`Company` não tem chave natural, então também não há `upsert` aqui). Nasce
 *   com `modulos` e com as colunas de marca NULAS — ver o comentário no corpo.
```

- [ ] **Step 3: Rodar (GREEN) e fechar**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/seed.test.ts tests/unit/seed-demo.test.ts
npm run typecheck
npm run lint
```

Esperado: os dois arquivos verdes, `tsc` sem saída, lint sem erro. Cole as três saídas.

- [ ] **Step 4: Confirmar no banco que existe exatamente uma linha por empresa semeada**

```bash
cd "d:/Projetos Programação/N8n + Crm"
node -e "
require('dotenv/config');
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();
  const r = await c.query(\`
    select co.nome, cc.modulos, cc.\\\"corPrimaria\\\", cc.fonte
    from \\\"Company\\\" co left join \\\"CompanyConfig\\\" cc on cc.\\\"companyId\\\" = co.id
    order by co.\\\"criadoEm\\\"\`);
  console.table(r.rows);
  const total = await c.query('select count(*)::int as n from \"Company\"');
  console.log('Company total:', total.rows[0].n);
  await c.end();
})();
"
```

Esperado: a empresa do seed com `modulos = {whatsapp,automation}` e `corPrimaria`/`fonte` nulos. **Colar a tabela inteira e a contagem** — a contagem fecha o 🔍 NV1 do spec (a auditoria do Ciclo 1a mediu 7 `Company`, sendo 6 órfãs de fixture; se o número for outro, registrar).

- [ ] **Step 5: Commit**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git add prisma/seed.ts tests/unit/seed.test.ts
git commit -m "feat(seed): a linha de config nasce com os modulos, e a marca fica nula

Nulo significa 'nao decidi, usa o padrao do arquivo'. Gravar a cor atual de
config/client.ts aqui congelaria no banco uma nao-decisao -- a identidade do
produto esta EM ABERTO pela decisao 8 do spec do programa -- e a partir dai
editar o arquivo deixaria de ter efeito para esta empresa, em silencio.

modulos e diferente porque nao TEM estado nulo: lista escalar no Prisma nunca e
nula. Semear com client.modulos mantem o comportamento identico ao de antes
deste ciclo e poe o caminho de banco em uso de verdade, em vez de deixar uma
tabela criada e nunca lida.

Cria se nao existe, nunca reconcilia -- mesma regra do funil, que aprendeu isso
do jeito caro: o upsert por ordem virou destrutivo no dia em que /etapas
existiu, renomeando etapa criada pela tela. O caso de idempotencia grava uma cor
antes do segundo seed e afirma que ela sobreviveu.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Provar no navegador que a marca da empresa vence

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Create: `tests/e2e/marca-por-empresa.spec.ts`

**Interfaces:**
- Consumes: `SESSAO_ADMIN` (`tests/e2e/credenciais.ts`); a linha de `CompanyConfig` que a Tarefa 6 garante; `DATABASE_URL` do `.env`.
- Produces: nada de código de aplicação. Só a prova.

- [ ] **Step 1: Escrever o spec**

Criar `tests/e2e/marca-por-empresa.spec.ts`:

```ts
// Este arquivo toca o MESMO Postgres real que o app usa em dev (não há banco de
// teste isolado — ⚠️ R1 da auditoria do Ciclo 1a) e por isso cria seu próprio
// PrismaClient. NÃO importamos `@/lib/prisma`: esse módulo tem
// `import "server-only"`, que lança fora da condição de resolução
// "react-server" do Next — e o runner do Playwright é um processo Node comum.
// Mesmo padrão, e mesmo motivo, de `tests/e2e/lead-to-won.spec.ts`.
//
// O que este arquivo prova, e nenhum teste de unidade pode: que os DOIS blocos
// `:root:root` do documento — o do layout raiz, com o padrão do arquivo, e o do
// layout do painel, com a marca da empresa — resolvem na cascata do navegador
// com o segundo vencendo. A regra usada é do CSS (mesma especificidade, vence o
// último no documento), mas a medição é de UM navegador: o Chromium do
// Playwright. Está registrado como NV4 do spec.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { test, expect } from "@playwright/test";
import { SESSAO_ADMIN } from "./credenciais";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

test.use({ storageState: SESSAO_ADMIN });

// Azul, bem longe do roxo `#6D4AFF` do arquivo, e com croma acima do piso —
// `marcaSchema` recusaria cinza, e a recusa apareceria como painel quebrado em
// vez de asserção falhando.
const COR_DA_EMPRESA = "#0F62FE";

/** O estado da linha antes deste arquivo mexer, para restaurar no fim. */
let empresaId: string;
let anterior: { corPrimaria: string | null; fonte: string | null } | null = null;
let linhaCriadaAqui = false;

test.beforeAll(async () => {
  const empresa = await prisma.company.findFirstOrThrow({ orderBy: { criadoEm: "asc" } });
  empresaId = empresa.id;

  const existente = await prisma.companyConfig.findFirst({
    where: { companyId: empresaId },
    select: { corPrimaria: true, fonte: true },
  });

  if (existente) {
    anterior = existente;
    await prisma.companyConfig.updateMany({
      where: { companyId: empresaId },
      data: { corPrimaria: COR_DA_EMPRESA, fonte: "Manrope" },
    });
  } else {
    linhaCriadaAqui = true;
    await prisma.companyConfig.create({
      data: { companyId: empresaId, corPrimaria: COR_DA_EMPRESA, fonte: "Manrope", modulos: [] },
    });
  }
});

test.afterAll(async () => {
  // Restaura EXATAMENTE o estado anterior. Deixar uma cor de teste no banco de
  // desenvolvimento é a mesma classe de resíduo que a auditoria do Ciclo 1a
  // mediu com as seis `Company` órfãs de fixture.
  if (linhaCriadaAqui) {
    await prisma.companyConfig.deleteMany({ where: { companyId: empresaId } });
  } else if (anterior) {
    await prisma.companyConfig.updateMany({
      where: { companyId: empresaId },
      data: { corPrimaria: anterior.corPrimaria, fonte: anterior.fonte },
    });
  }
  await prisma.$disconnect();
});

test.describe("marca por empresa", () => {
  test("a cor da empresa vence o padrão do arquivo no `<html>`", async ({ page }) => {
    await page.goto("/");

    // `--primary` é derivada da cor da marca por `derivarPaleta`. Medir o valor
    // COMPUTADO no `<html>` é o que prova a cascata: a variável do painel só
    // vence ali se o segundo bloco `:root:root` tiver sido aplicado.
    const primaria = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--primary").trim()
    );

    expect(primaria.length, "--primary não foi definida no <html>").toBeGreaterThan(0);
    expect(primaria).toMatch(/^oklch\(/);

    // O matiz do azul `#0F62FE` fica na casa dos 260-270 graus; o do roxo
    // `#6D4AFF` do arquivo, acima de 285. A asserção é sobre a FAIXA e não sobre
    // o número exato, porque o número exato é resultado de `derivarPaleta` e
    // mudaria com qualquer ajuste de paleta — o que este caso mede é de qual
    // das duas cores a paleta saiu.
    const matiz = Number(primaria.match(/oklch\([^ ]+ [^ ]+ ([\d.]+)/)?.[1]);
    expect(Number.isFinite(matiz), `matiz não pôde ser lido de ${primaria}`).toBe(true);
    expect(matiz).toBeGreaterThan(240);
    expect(matiz).toBeLessThan(285);
  });

  test("o documento tem DOIS blocos `:root:root` — o do arquivo e o da empresa", async ({ page }) => {
    await page.goto("/");

    const blocos = await page.evaluate(() =>
      [...document.querySelectorAll("style")]
        .map((s) => s.textContent ?? "")
        .filter((t) => t.includes(":root:root{")).length
    );

    // Um só significaria que o painel não emitiu o dele — e a asserção de cor
    // acima poderia estar verde por coincidência num dia em que o arquivo e o
    // banco tivessem a mesma cor.
    expect(blocos).toBe(2);
  });

  test("a fonte da empresa chega ao conteúdo do painel", async ({ page }) => {
    await page.goto("/");

    const familia = await page.evaluate(() => {
      const main = document.querySelector("main");
      if (!main) return "";
      return getComputedStyle(main).fontFamily;
    });

    // `Manrope` foi gravada na linha do `beforeAll`; o arquivo tem `Geist`.
    // Sem a classe `font-sans` no elemento de conteúdo, o `font-family`
    // computado aqui seria o herdado do `<html>` e traria Geist — a falha
    // silenciosa que o teste de unidade do layout também cobre, medida agora
    // num navegador de verdade.
    expect(familia).toContain("Manrope");
    expect(familia).not.toContain("Geist");
  });

  test("a tela de login NÃO usa a marca da empresa", async ({ browser }) => {
    // Contexto sem sessão: `/login` fica fora de `(painel)`, então o layout do
    // painel não roda e não há empresa para consultar. É o ovo-e-galinha do
    // desenho, e este caso é o que impede alguém de "consertar" isso movendo a
    // leitura para a raiz.
    const contexto = await browser.newContext();
    const pagina = await contexto.newPage();
    await pagina.goto("/login");

    const blocos = await pagina.evaluate(() =>
      [...document.querySelectorAll("style")]
        .map((s) => s.textContent ?? "")
        .filter((t) => t.includes(":root:root{")).length
    );
    expect(blocos).toBe(1);

    await contexto.close();
  });
});
```

- [ ] **Step 2: Rodar**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx playwright test tests/e2e/marca-por-empresa.spec.ts
```

Esperado: 4 casos passando. Cole a saída.

Se o caso da fonte falhar com `familia` contendo `Geist`, a causa é a classe `font-sans` ausente no elemento de conteúdo do painel (Tarefa 5, Step 2) — **é o modo de falha silencioso que este caso existe para pegar**, não instabilidade de teste. Corrigir lá e rodar de novo.

- [ ] **Step 3: Confirmar que o estado do banco voltou**

```bash
cd "d:/Projetos Programação/N8n + Crm"
node -e "
require('dotenv/config');
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();
  const r = await c.query('select \"companyId\", \"corPrimaria\", fonte, modulos from \"CompanyConfig\"');
  console.table(r.rows);
  await c.end();
})();
"
```

Esperado: `corPrimaria` e `fonte` **nulos** de novo (o estado que o seed cria). Se vierem com o azul e `Manrope`, o `afterAll` não rodou — **restaurar à mão e reportar**:

```bash
cd "d:/Projetos Programação/N8n + Crm"
node -e "
require('dotenv/config');
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();
  await c.query('update \"CompanyConfig\" set \"corPrimaria\" = null, fonte = null');
  console.log('restaurado');
  await c.end();
})();
"
```

- [ ] **Step 4: Commit**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git add tests/e2e/marca-por-empresa.spec.ts
git commit -m "test(marca): prova no navegador que a marca da empresa vence a do arquivo

Mede --primary COMPUTADA no html, que e onde a cascata se resolve: os dois
blocos :root:root tem a mesma especificidade e quem decide e a ordem no
documento -- o do raiz no head, o do painel no body. O caso que conta os blocos
existe para o de cor nao ficar verde por coincidencia num dia em que arquivo e
banco tenham a mesma cor.

O caso da fonte mede font-family no main. Sem a classe font-sans no elemento de
conteudo, o valor computado seria o herdado do html e traria a fonte do arquivo
-- falha que nao aparece na tela, so na medicao.

O caso de /login afirma UM bloco so: fora da sessao nao ha empresa, e este caso
e o que impede alguem de 'consertar' isso movendo a leitura para a raiz.

beforeAll guarda o estado anterior e afterAll restaura exatamente: o banco e o
mesmo de desenvolvimento, e residuo de fixture ja foi medido acontecendo.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Verificação final e preparo da auditoria

**DEPENDE DE AÇÃO DO DONO:** não. (A rotação da senha do admin depois do `npm test` continua sendo do dono, herdada do Ciclo 1a — não trava nada aqui.)

**Files:** nenhum de código. Só medições coladas e, se algo estiver vermelho, a correção.

**Interfaces:**
- Consumes: tudo que as Tarefas 1-7 produziram.
- Produces: as medições que fecham os critérios de aceite da seção 10 do spec, e a lista dos 🔍 NÃO VERIFICADOS que sobrarem.

- [ ] **Step 1: A catraca e o lint, primeiro — é o critério que mais barato quebra**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx vitest run tests/unit/catraca-prisma-cru.test.ts
npm run lint
grep -n "LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS" tests/unit/catraca-prisma-cru.test.ts
grep -c '"src/' eslint.config.mjs
```

Esperado: catraca verde; lint com **zero erros**; `LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS = 0` **inalterada**; e a contagem de caminhos declarados em `eslint.config.mjs` igual à de antes do ciclo (5, todos em `EXCECAO_PERMANENTE`). **Se apareceu exceção nova, PARE e reporte** — o spec diz que este ciclo não deve precisar de nenhuma.

Cole as quatro saídas.

- [ ] **Step 2: Typecheck e build**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npm run typecheck
npm run build
```

Esperado: `tsc` sem saída; build com a tabela de rotas **ainda com uma única `○`, `/_not-found`**. Cole a tabela inteira e compare com a da linha de base — qualquer rota que tenha saído de `○` é achado, não ruído.

- [ ] **Step 3: A suíte inteira**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npm test
```

**Este comando executa o seed contra o banco de desenvolvimento e reescreve o `senhaHash` do admin com um literal versionado** (⚠️ R1 / 🔍 NV5 do Ciclo 1a). É esperado, está registrado, e a rotação continua sendo ação do dono.

Rodar **sozinho**, nada de `vitest` em paralelo. Esperado: `Test Files` e `Tests` todos verdes, exit 0. Cole a linha de resumo.

- [ ] **Step 4: A blindagem, no navegador e no banco**

```bash
cd "d:/Projetos Programação/N8n + Crm"
npx playwright test tests/e2e/banco-blindado.spec.ts tests/e2e/tema.spec.ts tests/e2e/marca-por-empresa.spec.ts tests/e2e/seguranca-headers.spec.ts
```

Esperado: todos verdes. `banco-blindado` é quem prova que `CompanyConfig` nasceu com RLS e sem grants, sem precisar de lista fixa de tabelas; `tema` e `seguranca-headers` são quem prova que o segundo `<style>` **não** quebrou o CSP nem o script anti-flash. Cole a saída.

- [ ] **Step 5: O advisor de segurança**

Invocar as três skills de banco (`supabase`, `supabase-postgres-best-practices`, `auditing-supabase-security`) e rodar `get_advisors` de segurança no projeto `uzumzfxjcxrbxaucvfsr`.

Esperado, comparado com a linha de base do Ciclo 1a (15 × `rls_enabled_no_policy` INFO + 2 × WARN de `rls_auto_enable`): **16 × INFO** — a tabela nova tem RLS ligada e zero políticas, que é o default-deny desejado — e os **mesmos 2 WARN**. Qualquer coisa além disso é achado.

Cole a saída resumida (categoria e contagem, não o JSON inteiro).

- [ ] **Step 6: Conferir o estado final do banco e fechar o NV1**

```bash
cd "d:/Projetos Programação/N8n + Crm"
node -e "
require('dotenv/config');
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();
  const empresas = await c.query('select count(*)::int as n from \"Company\"');
  const configs  = await c.query('select count(*)::int as n from \"CompanyConfig\"');
  const orfas    = await c.query(\`select nome, id from \\\"Company\\\" where nome like 'teste-%' or nome like 'ZZTeste%' order by \\\"criadoEm\\\"\`);
  console.log('Company:', empresas.rows[0].n, '| CompanyConfig:', configs.rows[0].n);
  console.table(orfas.rows);
  await c.end();
})();
"
```

Cole a saída. Ela fecha o 🔍 NV1 do spec (quantas `Company` existem, e quantas ficam sem linha de config). **Empresas órfãs de fixture não são defeito deste ciclo** — são o ⚠️ R1 do Ciclo 1a aparecendo por outro sintoma —, mas o número precisa ficar registrado.

- [ ] **Step 7: Escrever o resumo de fechamento**

Reportar, em prosa curta:

1. Cada critério da seção 10 do spec, com **✅ OK + comando e saída** ou **🔍 NÃO VERIFICADO + o comando que um humano roda**.
2. Os itens de NÃO VERIFICADO do spec que continuam abertos: **NV2** (deriva de `CHECK` no `prisma migrate dev`), **NV3** (se `generateMetadata` compartilha a memoização de `cache()` com o render), **NV4** (cascata em navegador fora do Chromium), **NV5** (senha do admin). O **NV1** deve ter fechado no Step 6.
3. As dívidas declaradas que continuam de pé: **D1** (não existe escrita validada), **D2** (o arquivo deixa de ter efeito depois que a linha existe), **D3** (`modulos` só editável por SQL), **D4** (linha inválida derruba o painel daquela empresa), **D5** (a marca de `/login` é a do arquivo), **D6** (as herdadas do Ciclo 1a).
4. **Não abrir PR e não fazer merge.** O `AGENTS.md` deste repositório exige a **Fase 1 da skill `auditoria-seguranca`** sobre a superfície que a branch mexeu — aqui: tabela nova, leitura escopada nova, portão de módulos convertido, e um segundo `<style>` com valor vindo do banco — com o relatório entregue e **parada** até o dono aprovar. Correção só começa depois disso.

- [ ] **Step 8: Commit final (só se algum passo acima exigiu correção)**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git status --short
```

Se a árvore estiver limpa, não há o que commitar — a tarefa é de verificação. Se houve correção, commitar com mensagem que diga **qual medição** pediu a mudança, no estilo dos commits anteriores, terminando com:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

## Auto-revisão deste plano

Feita antes de entregar, como a `writing-plans` exige.

**Cobertura do spec.** As sete decisões da seção 4 viram tarefas: 4.1 e 4.2 → Task 2 (é `mesclarConfig` quem encarna "o que vai e o que fica" e "arquivo é padrão, banco é sobreposição"); 4.3 → Task 5; 4.4 → Task 1; 4.5 → Tasks 3 e 4; 4.6 → Task 6; 4.7 → distribuída, com a tabela de arquivos batendo uma a uma com os blocos **Files**. As onze provas da seção 5 mapeiam assim: P1 → Task 8 Step 4 (o e2e já existente, sem alteração) e Task 1 Step 6; P2 → Task 1; P3, P4 e P6 → Tasks 2 e 3; P5 → Task 3 (`config-isolamento`); P7 → Task 4; P8 → Task 5; P9 → Task 7; P10 → Task 8 Step 1; P11 → Task 5 Step 5 e Task 8 Step 2. Os cinco 🔍 NV do spec estão nomeados no Step 7 da Task 8, e o NV1 tem comando que o fecha (Task 6 Step 4 e Task 8 Step 6).

**Ordem — nenhuma tarefa usa algo que uma posterior cria.** Task 2 não consome nada deste ciclo (só `config/client.schema.ts`, que já existe). Task 3 consome o `CompanyConfig` do Prisma (Task 1) e `mesclarConfig` (Task 2). Task 4 consome `configDaEmpresa` (3) e `ModuloNome` (2). Task 5 consome `configDaEmpresa` (3) e a variável `config` que a Task 4 já pôs no layout. Task 6 consome o delegate `prisma.companyConfig` (1). Task 7 consome a linha que a Task 6 garante e a composição da Task 5. Task 8 consome tudo.
**A Task 1 vem primeiro por uma razão dura:** `prisma generate` precisa rodar antes de qualquer arquivo mencionar `prisma.companyConfig`, ou o `tsc` das tarefas seguintes reprova por um motivo que não é o delas.
**A Task 4 mexe em `Marca` e no layout na mesma tarefa** de propósito: `PainelNav` passa a renderizar `<Marca nome={...} />` e deixar isso para a Task 5 quebraria o `tsc` no meio. Cada tarefa fecha com typecheck e lint verdes.

**Tipos e nomes consistentes entre tarefas.** `ConfigDaEmpresa { nome, marca, modulos }` é produzido pela Task 2, devolvido pela Task 3, consumido pelas Tasks 4 e 5 com os mesmos três nomes. `MarcaDaEmpresa { corPrimaria, fonte, logo? }` idem. `LinhaDeConfig` tem exatamente os cinco campos do `select` de `leitura.ts`, e as cinco colunas do `model CompanyConfig` da Task 1. `ModuloNome` nasce em `schema.ts` (Task 2), é reexportado por `modulos.ts` (Task 4) e é o tipo da prop `modulosAtivos` de `PainelNav`. `configDaEmpresa(companyId)`, `moduloAtivo(companyId, nome)` e `exigirModulo(companyId, nome)` aparecem com a mesma aridade e a mesma ordem de parâmetros em todos os usos. `ConfigDaEmpresaInvalidaError` é lançada na Task 2 e afirmada nas Tasks 2 e 3. `usuario.companyId` e `usuario.papel` batem com `UsuarioAtivo` (`src/core/auth/usuario-ativo.ts`).

**Varredura de placeholder.** Nenhum "TBD", nenhum "similar à Task N", nenhum "tratamento de erro apropriado". Todo bloco de código está inteiro — inclusive as 15 substituições de `painel-nav.test.tsx`, listadas uma a uma em tabela em vez de descritas. Todo comando tem saída esperada; onde a saída depende do ambiente (contagem de `Company`, tabela de rotas, advisor), o plano manda **colar a medida** em vez de afirmar um número inventado.

**Afirmações universais com o caso que as exercita.** "Se a linha existe, `modulos` manda, inclusive vazia" → caso `modulos: []` na Task 2. "Linha inválida recusa, não degrada" → sete casos parametrizados na Task 2. "A corretude não depende do cache" → dois casos na Task 3 (duas consultas fora de requisição; duas empresas na mesma execução). "Sem estado global" → varredura do fonte de `leitura.ts` na Task 3. "Nenhum texto do config chega ao `<style>`" → caso do `<` na Task 5. "A empresa A não lê a linha da B" → `config-isolamento.test.ts` com sonda. "Nenhum arquivo novo alcança o prisma cru" → catraca na Task 8, e lint em cada tarefa. "A colisão de glob não voltou" → `npm run lint` com `src/core/config/modulos.ts` em disco, Task 4 Step 8. "`/login` não usa a marca da empresa" → caso próprio na Task 7.

**Tarefas que dependem de ação do dono: ZERO.** Nenhuma tarefa para. Os dois pontos onde o dono aparece são (a) rotacionar a senha do admin depois do `npm test` da Task 8 — herdado do Ciclo 1a, não bloqueia nada — e (b) aprovar o relatório da Fase 1 da `auditoria-seguranca` antes de qualquer merge, que é regra do `AGENTS.md` e vale para toda branch.
