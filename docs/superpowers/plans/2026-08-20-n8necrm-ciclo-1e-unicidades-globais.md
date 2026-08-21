# n8necrm — Ciclo 1e (As quatro unicidades globais) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quatro `@unique` GLOBAIS viram `@@unique` compostas com `companyId` —
`Contact.telefone`, `PipelineStage.ordem`, `Conversation.waId` e
`WhatsappMessage.idExterno`. É o que impede a segunda empresa de existir, e duas
delas já cobram preço real: o `waId` produz `P2002` → 500 → reentrega em laço da
Evolution desde o Ciclo 2a, e o `telefone` já quebrou `seguranca-headers.spec.ts`
em paralelo.

**Architecture:** Quatro migrações independentes, cada uma um `DROP INDEX` mais
um `CREATE UNIQUE INDEX` com `companyId` na frente. Nenhuma coluna nova, nenhum
backfill, nenhuma política de RLS, nenhuma assinatura de função alterada. O que
muda no código é: dois ramos de erro que ficam inalcançáveis e são **reescritos,
não apagados** (`core/leads/dedupe.ts`, `core/contacts/service.ts`), quatro
chamadas dos seeds que deixam de compilar ou de estar corretas, e uma dúzia de
blocos de comentário que passariam a mentir. A prova final é um arquivo novo
contra o Postgres real: duas empresas coexistindo com o mesmo telefone, a mesma
ordem, o mesmo `waId` e o mesmo `idExterno`.

**Tech Stack:** Next.js 16.3 (App Router), React 19.2, Prisma 7.9 +
`@prisma/adapter-pg`, Postgres 17.6 (Supabase `uzumzfxjcxrbxaucvfsr`), Node
22.21, Zod 4, Tailwind 4, shadcn, Vitest 4, Playwright 1.62.

**Spec:** `docs/superpowers/specs/2026-08-20-ciclo-1e-unicidades-globais-design.md`

## Global Constraints

- **Idioma do código é português.** Comentário explica **por que**, com evidência. Nunca "o quê".
- **Antes de qualquer trabalho que toque o banco, invocar as três skills juntas:** `supabase`, `supabase-postgres-best-practices`, `auditing-supabase-security`. Vale para as Tarefas 1, 2, 3, 4, 6 e 7.
- **Este projeto usa migrations do Prisma, não o CLI do Supabase.** As migrations são arquivos SQL escritos à mão em `prisma/migrations/`, aplicados por `npx prisma migrate deploy`. `supabase db pull`, schema declarativo e `supabase migration new` **não se aplicam**.
- **`DATABASE_URL` na porta 6543, `DIRECT_URL` na 5432.** Trocar as duas faz `prisma migrate` ficar **PENDURADO sem imprimir nada** — parece lentidão, é falha. Se um comando de migração passar de dois minutos sem saída, **pare e reporte**; não mexa no `.env`.
- **Nunca ler nem imprimir o `.env`.** Nenhuma tarefa deste plano precisa dele.
- **Não afrouxe `tests/unit/migracoes-seguras.test.ts`.** O esperado é **ZERO** entradas novas em `PERDOADAS` — as quatro migrações só trocam índice. Se alguma tarefa se vir precisando de uma entrada, o desenho está errado: **pare e reporte**.
- **Nenhuma política RLS e nenhum grant neste ciclo.** As quatro tabelas já existem com RLS ligada e zero políticas. `DROP INDEX`/`CREATE UNIQUE INDEX` não tocam `relrowsecurity` nem grants, então `tests/e2e/banco-blindado.spec.ts` não muda. Se uma tarefa parecer precisar de política, ela saiu do escopo — **pare e reporte**.
- **Nenhum arquivo pode importar `@/lib/prisma` a partir de `src/`.** A catraca `tests/unit/catraca-prisma-cru.test.ts` está com `LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS = 0` e **só permite diminuir**. `prisma/seed*.ts` e `tests/` estão fora do alcance dela por decisão escrita (`catraca-prisma-cru.test.ts:71`) — as mudanças de seed deste plano são legítimas.
- **`MODELOS_DE_TENANT` continua com 13.** Nenhum modelo nasce ou morre aqui. A trava de deriva (`escopo-empresa.test.ts`, "MODELOS_DE_TENANT não pode derivar do schema") e o leitor de schema de `catraca-prisma-cru.test.ts:146` casam `^\s*companyId\s+\w+`; uma linha `@@unique([companyId, telefone])` **não** casa. Se `MODELOS_DE_TENANT.size` mudar em alguma tarefa, algo saiu errado — **pare e reporte**.
- **`companyId` viaja como parâmetro explícito.** `AsyncLocalStorage` e estado global PROIBIDOS.
- **Nunca `prisma.company.findFirst()`** como origem de empresa em `src/`.
- **Toda frase que afirme universal** — "todo", "sempre", "nenhum", "qualquer", "só" — precisa do caso de teste que a exercita, ou é reescrita.
- **Provar, não presumir.** O que este ambiente não provar sai como **NÃO VERIFICADO**, com o comando que um humano roda.
- **Não rodar `npm test` inteiro em nenhuma tarefa.** Ele executa o seed contra o banco de desenvolvimento real e reescreve o `senhaHash` de `admin@exemplo.com` e `vendedor@exemplo.com` (⚠️ R1 do Ciclo 1a, 🔍 NV6 do Ciclo 2a). Rodar sempre os arquivos focados.
- **Nada de `vitest` em paralelo com outra execução de `vitest`.** O banco de teste não é separado do de desenvolvimento; duas execuções o envenenam. Um comando por vez, em série.
- Toda mensagem de commit termina com:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **Branch de trabalho: `ciclo-1e-unicidades-globais`**, criada a partir de `ciclo-1a-tenancy` (HEAD `60607fa`).

## Linha de base medida em 2026-08-20 — conferir se mudou antes de fechar

| Medida | Valor | Como |
| --- | --- | --- |
| `Company` | **1** | `SELECT count(*) FROM "Company"` |
| `Contact` | **4** | idem |
| `PipelineStage` | **4** | idem |
| `Lead` | **4** | idem |
| `Conversation` | **0** (0 com `connectionId` nulo) | idem |
| `WhatsappMessage` | **0** | idem |
| `WhatsappConnection` | **0** | idem |
| Índices únicos a trocar | `Contact_telefone_key`, `PipelineStage_ordem_key`, `Conversation_waId_key`, `WhatsappMessage_idExterno_key` | `pg_index` + `pg_get_indexdef` — ver §2 do spec |
| Migrações aplicadas | **19**, a última `20260820210000_cofre_conexoes_whatsapp` | `ls prisma/migrations/` |
| Modelos de tenant | **13** | `src/core/tenancy/escopo.ts`, `MODELOS_DE_TENANT` |
| Modelos com `companyId` único sozinho | **2** (`BotConfig`, `CompanyConfig`) | `tests/unit/escopo-empresa.test.ts` |
| Catraca de prisma cru | `LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS = 0` | `tests/unit/catraca-prisma-cru.test.ts:108` |
| Entradas em `PERDOADAS` | **2** | `tests/unit/migracoes-seguras.test.ts` |

## Ações do dono que travam a execução

**NENHUMA.** Nenhuma tarefa deste plano fica bloqueada por ação do dono.

Herdada, não deste ciclo: 🔍 NV6 do Ciclo 2a — a senha de `admin@exemplo.com` e
`vendedor@exemplo.com` continua com o literal versionado, à espera de rotação.
Este plano **não roda `npm test`** e portanto não piora nem melhora isso.

---

### Task 1: `Contact.telefone` vira `@@unique([companyId, telefone])`

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260820220000_contato_telefone_por_empresa/migration.sql`
- Modify: `src/core/leads/dedupe.ts`
- Modify: `src/core/contacts/service.ts`
- Modify: `prisma/seed.ts`
- Modify: `prisma/seed-demo.ts`
- Modify: `tests/unit/contact-isolamento.test.ts`
- Modify: `tests/e2e/seguranca-headers.spec.ts` (só comentário)

**Interfaces:**
- Consumes: `model Contact` (`prisma/schema.prisma`); `prismaDaEmpresa` (`src/core/tenancy/escopo.ts`); `ContatoInvalidoError` (`src/core/contacts/service.ts`).
- Produces:
  - `Contact.telefone String` (sem `@unique`) + `@@unique([companyId, telefone])`
  - o índice `Contact_companyId_telefone_key` no Postgres, no lugar de `Contact_telefone_key`
  - `ContactWhereUniqueInput` passa a aceitar `companyId_telefone` (usado **só** pelos seeds; `src/` continua com `findFirst`)
  - `encontrarOuCriarContact` com a mesma assinatura e o ramo de `P2002` reescrito
  - `erroDeTelefoneOcupado` com a mesma assinatura e o segundo ramo reescrito

- [ ] **Step 1: Criar a branch e medir antes de tocar**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git checkout -b ciclo-1e-unicidades-globais
npx prisma migrate status
```

Esperado: `19 migrations found` e `Database schema is up to date!`. Se aparecer
migração pendente, **pare e reporte**. Cole a saída.

- [ ] **Step 2: Provar que não há duplicata sob a chave nova**

```bash
npx tsx --conditions=react-server -e "import 'dotenv/config'; import { PrismaClient } from '@prisma/client'; import { PrismaPg } from '@prisma/adapter-pg'; const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) }); const r = await p.\$queryRaw\`SELECT \"companyId\", telefone, count(*) FROM \"Contact\" GROUP BY 1,2 HAVING count(*) > 1\`; console.log(JSON.stringify(r)); await p.\$disconnect();"
```

Esperado: `[]`. Qualquer outra coisa significa que o banco mudou desde a linha de
base e que existe deduplicação a decidir — **pare e reporte**, não invente
critério de fusão.

- [ ] **Step 3: Escrever os casos que falham (RED)**

Em `tests/unit/contact-isolamento.test.ts`, **substituir** o caso
`"telefone ocupado por contato de OUTRA empresa não revela o nome do dono"` por:

```ts
  it("o telefone da OUTRA empresa deixa de ser recusado — e o nome do dono de fora continua invisível", async () => {
    // Antes do Ciclo 1e isto lançava `ContatoInvalidoError`: `Contact.telefone`
    // era `@unique` GLOBAL, e o mesmo número não podia existir em duas
    // empresas. Agora a chave é `[companyId, telefone]` e o caso normal de um
    // CRM multi-empresa — duas empresas atendendo o mesmo cliente — passa a ser
    // expressável.
    const criado = await criarContato(
      EMPRESA_A,
      { nome: "Novo da A", telefone: TELEFONE_B },
      USUARIO_A
    );

    expect(criado.telefone).toBe(TELEFONE_B);
    expect((await lerContatoCru(criado.id)).companyId).toBe(EMPRESA_A);

    // A metade que SOBREVIVE do caso antigo, e que é a que importa: o cadastro
    // da B fica intacto e o nome dele não aparece em nada que a A tenha visto.
    // O oráculo de "quem é o cliente do concorrente neste número" continua
    // fechado — o que o fechou foi a busca ESCOPADA (Ciclo 1a), não a
    // constraint.
    const daB = await lerContatoCru(CONTATO_B);
    expect(daB.nome).toBe("Alvo da B");
    expect(daB.companyId).toBe(EMPRESA_B);
    expect(criado.nome).toBe("Novo da A");
  });
```

E **substituir** o caso `"trocar o telefone para um de OUTRA empresa não revela o nome do dono"` por:

```ts
  it("trocar o telefone para um de OUTRA empresa passa a ser permitido — e não revela o dono de lá", async () => {
    await atualizarContato(
      EMPRESA_A,
      { id: CONTATO_A, nome: "Alvo da A", telefone: TELEFONE_B },
      USUARIO_A
    );

    const daA = await lerContatoCru(CONTATO_A);
    expect(daA.telefone).toBe(TELEFONE_B);
    expect(daA.companyId).toBe(EMPRESA_A);

    // Segunda metade: a linha da B não foi tocada nem lida para dentro da A.
    const daB = await lerContatoCru(CONTATO_B);
    expect(daB.nome).toBe("Alvo da B");
    expect(daB.telefone).toBe(TELEFONE_B);
    expect(daB.companyId).toBe(EMPRESA_B);
  });
```

O caso `"telefone ocupado DENTRO da empresa continua nomeando o dono — a segunda
metade"` **não muda**: ele é o que prova que a dedup dentro da empresa não
afrouxou.

- [ ] **Step 4: Rodar para ver falhar**

```bash
npx vitest run tests/unit/contact-isolamento.test.ts
```

Esperado: FAIL nos dois casos novos, com
`Unique constraint failed on the fields: (telefone)` (ou o
`ContatoInvalidoError` que o serviço traduz). Cole a saída.

- [ ] **Step 5: Trocar a constraint no schema**

Em `prisma/schema.prisma`, no `model Contact`, trocar:

```prisma
  telefone  String  @unique
```

por:

```prisma
  telefone  String
```

E, **imediatamente antes** do bloco de comentário que termina em
`@@index([criadoEm])`, acrescentar:

```prisma
  /// Unicidade POR EMPRESA, não global (Ciclo 1e).
  ///
  /// Era `telefone String @unique`. Duas empresas atenderem o mesmo cliente é o
  /// caso NORMAL de um CRM multi-empresa, e o único global tornava isso um
  /// `P2002` — a segunda empresa a cadastrar o número era recusada, e
  /// `core/leads/dedupe.ts` carregava um ramo inteiro só para explicar a
  /// recusa. `Contact` tem exatamente uma coluna de posse (`companyId`), então
  /// não há nível intermediário plausível para compor.
  ///
  /// Esta chave é a que o escopo já usa sem saber: `dedupe.ts` e
  /// `contacts/service.ts` buscam por `telefone` num cliente escopado, ou seja
  /// `WHERE "companyId" = $1 AND telefone = $2` — as duas colunas, nesta
  /// ordem. É por isso que, depois desta linha, um `P2002` aqui SEMPRE tem dono
  /// encontrável pela busca escopada (caso em
  /// `tests/unit/contact-isolamento.test.ts`, "telefone ocupado DENTRO da
  /// empresa continua nomeando o dono").
  ///
  /// NÃO deduz que `findUnique` por `companyId_telefone` virou legítimo em
  /// `src/`: o escopo continua recusando operação por chave única em modelo de
  /// tenant, e o motivo está em "Recusa, lançando" (`core/tenancy/escopo.ts`).
  /// Só os seeds usam a chave composta diretamente, e eles rodam fora do escopo
  /// por decisão registrada.
  @@unique([companyId, telefone])
```

- [ ] **Step 6: Escrever a migração**

Criar `prisma/migrations/20260820220000_contato_telefone_por_empresa/migration.sql`:

```sql
-- Ciclo 1e, Task 1: Contact.telefone deixa de ser unico GLOBAL.
--
-- POR QUE: duas empresas atendendo o mesmo cliente e o caso NORMAL de um CRM
-- multi-empresa. Com o unico global, a segunda empresa a cadastrar o numero
-- levava P2002, e o codigo carregava um ramo inteiro so para explicar isso
-- (src/core/leads/dedupe.ts) alem de um segundo ramo de mensagem em
-- src/core/contacts/service.ts. Os dois viram defesa contra corrida.
--
-- POR QUE SEM DEDUPLICACAO: a chave nova e a antiga MAIS uma coluna, entao
-- nenhuma linha que ja passava na antiga pode colidir na nova. Medido em
-- 2026-08-20 antes desta migracao: Contact = 4 linhas, Company = 1, e
-- GROUP BY ("companyId", telefone) HAVING count(*) > 1 devolveu vazio.
--
-- POR QUE NAO ACIONA tests/unit/migracoes-seguras.test.ts: aquela guarda pega
-- ADD COLUMN ... NOT NULL sem DEFAULT e ALTER COLUMN ... SET NOT NULL sem
-- DEFAULT na mesma migracao. Aqui nao ha coluna nova nem coluna virando NOT
-- NULL -- so troca de indice. PERDOADAS nao recebe entrada nenhuma.
--
-- POR QUE SEM CONCURRENTLY: 4 linhas. CONCURRENTLY nao roda dentro da
-- transacao que o prisma migrate abre, e o ganho aqui seria zero.

-- DropIndex
DROP INDEX "Contact_telefone_key";

-- CreateIndex
CREATE UNIQUE INDEX "Contact_companyId_telefone_key" ON "Contact"("companyId", "telefone");
```

- [ ] **Step 7: Aplicar a migração e regenerar o client**

```bash
npx prisma migrate deploy
npx prisma generate
```

Esperado: `Applying migration \`20260820220000_contato_telefone_por_empresa\`` e
`1 migration applied`. Se ficar pendurado por mais de dois minutos sem imprimir
nada, é o sintoma de `DATABASE_URL`/`DIRECT_URL` trocadas — **pare e reporte**,
não edite o `.env`.

- [ ] **Step 8: Confirmar que a guarda de migrações continua verde, sem `PERDOADAS` nova**

```bash
npx vitest run tests/unit/migracoes-seguras.test.ts
```

Esperado: todos os casos passam. Confirmar por leitura que `PERDOADAS` continua
com **duas** entradas.

- [ ] **Step 9: Reescrever o ramo inalcançável de `dedupe.ts`**

Em `src/core/leads/dedupe.ts`, no `catch`, substituir o bloco que começa em
`// Chegou aqui: o \`P2002\` veio de \`Contact.telefone\`` e o `throw new Error`
inteiro por:

```ts
      // Chegou aqui, e desde o Ciclo 1e isto NÃO significa mais "o telefone
      // está em outra empresa". A chave é `@@unique([companyId, telefone])`, e
      // as duas colunas dela são exatamente as que o `findFirst` acima filtra
      // (o escopo injeta `where.companyId`). Se o banco disse "já existe", a
      // busca escopada encontra — o caso está exercitado em
      // `tests/unit/contact-isolamento.test.ts` ("telefone ocupado DENTRO da
      // empresa continua nomeando o dono").
      //
      // O que sobra é uma janela estreita e real: quem venceu a corrida APAGOU
      // o contato entre a colisão e esta releitura. Continua lançando de
      // propósito — devolver `undefined` daqui faria a criação de lead seguir
      // apontando para um contato que não existe, que é o tipo de falha que só
      // aparece três telas adiante.
      throw new Error(
        `Colisão em Contact sem dono encontrável: o banco recusou o telefone ` +
          `${JSON.stringify(telefone)} na empresa ${JSON.stringify(dados.companyId)} por violação de ` +
          `\`Contact_companyId_telefone_key\`, mas a busca escopada não achou a linha. O caso esperado ` +
          `é o contato ter sido APAGADO entre a colisão e esta leitura. Tente de novo.`
      );
```

E, no bloco de doc de `normalizarTelefone`, trocar a frase
``e `Contact.telefone` é UNIQUE no schema`` por
``e `Contact` tem `@@unique([companyId, telefone])` no schema (Ciclo 1e)``.

E, no bloco `## Concorrência` de `encontrarOuCriarContact`, trocar
``a segunda colide na constraint UNIQUE de `Contact.telefone` `` por
``a segunda colide em `Contact_companyId_telefone_key` ``.

- [ ] **Step 10: Reescrever o segundo ramo de `erroDeTelefoneOcupado`**

Em `src/core/contacts/service.ts`, substituir a função e o parágrafo do bloco de
doc dela que fala da unicidade global.

O bloco de doc: substituir os dois parágrafos que começam em
`* A versão anterior fazia \`findUnique\`` e em `* Escopada, a busca não acha o
dono de fora` por:

```
 * A versão anterior fazia `findUnique({ where: { telefone } })` no prisma cru,
 * quando `Contact.telefone` era `@unique` GLOBAL: digitar um número qualquer no
 * cadastro devolvia na tela o NOME do contato de outra empresa — um oráculo de
 * "quem é o cliente do concorrente neste número", alcançável por qualquer
 * sessão e sem precisar de id nenhum. Quem fechou isso foi a busca ESCOPADA
 * (Ciclo 1a), e ela continua escopada.
 *
 * Desde o Ciclo 1e a chave é `@@unique([companyId, telefone])`, e as duas
 * colunas dela são as mesmas que esta busca filtra. Consequência: quando o
 * banco devolve `P2002`, o dono ESTÁ dentro do escopo e é encontrado — o
 * primeiro ramo. O segundo ramo deixou de descrever "existe fora desta
 * empresa" (que agora é estado legítimo e não gera erro nenhum) e passou a ser
 * defesa contra uma janela real: o cadastro colidiu e foi APAGADO antes desta
 * leitura. Os dois ramos continuam sem citar nome de contato de fora, e há caso
 * de teste para o ramo alcançável (`tests/unit/contact-isolamento.test.ts`,
 * "telefone ocupado DENTRO da empresa continua nomeando o dono").
```

E a função:

```ts
async function erroDeTelefoneOcupado(
  db: ClienteDaEmpresa,
  telefone: string
): Promise<ContatoInvalidoError> {
  const dono = await db.contact.findFirst({ where: { telefone }, select: { nome: true } });
  return new ContatoInvalidoError(
    dono
      ? `Este telefone já está cadastrado para ${dono.nome}.`
      : "Este telefone acabou de ser cadastrado e removido por outra operação. Atualize a página e tente de novo."
  );
}
```

- [ ] **Step 11: Corrigir os dois seeds que usam a chave única**

Em `prisma/seed.ts`, o `upsert` de contato:

```ts
    const contact = await prisma.contact.upsert({
      // `companyId_telefone`, e não `telefone`: desde o Ciclo 1e a chave única
      // é composta (`@@unique([companyId, telefone])`), e o `telefone` sozinho
      // deixou de existir em `ContactWhereUniqueInput`. Prisma cru aqui é
      // legítimo — `prisma/seed*.ts` está fora do alcance da catraca por
      // decisão escrita (`tests/unit/catraca-prisma-cru.test.ts:71`).
      where: { companyId_telefone: { companyId: empresa.id, telefone: `1199999000${i}` } },
      update: {},
      create: { companyId: empresa.id, nome: nomes[i], telefone: `1199999000${i}` },
    });
```

E, no bloco de comentário do topo do arquivo, trocar a linha
`- Contact: upsert por \`telefone\` (único no schema).` por
`- Contact: upsert por \`[companyId, telefone]\` (a chave composta do Ciclo 1e).`

Em `prisma/seed-demo.ts`, `encontrarOuCriarContactDemo`:

```ts
async function encontrarOuCriarContactDemo(
  companyId: string,
  nome: string,
  telefone: string
): Promise<Contact> {
  // `findFirst` com as duas colunas, e não `findUnique({ where: { telefone } })`:
  // desde o Ciclo 1e a unicidade é `[companyId, telefone]`, e buscar só pelo
  // telefone devolveria o contato de outra empresa se um dia existir uma
  // segunda — que é exatamente o estado que aquele ciclo tornou possível.
  const existente = await prisma.contact.findFirst({ where: { companyId, telefone } });
  if (existente) return existente;
  return prisma.contact.create({ data: { companyId, nome, telefone } });
}
```

E, no bloco do topo de `seed-demo.ts`, trocar a frase que diz
`` `Contact.telefone` `` ser único global pela versão composta — a frase exata
está por volta da linha 66 e cita a convenção de famílias de telefone; **manter a
convenção**, corrigindo só a razão.

- [ ] **Step 12: Corrigir o comentário do e2e que culpa a razão errada**

Em `tests/e2e/seguranca-headers.spec.ts`, substituir o parágrafo
`## Por que não pode ser um literal` por:

```
 * ## Por que não pode ser um literal
 *
 * `test.beforeAll` roda uma vez por WORKER, não por arquivo, e
 * `playwright.config.ts` tem `fullyParallel: true` com `workers: 3`. Com
 * telefone fixo, o segundo worker a chegar recebia:
 *
 *     Invalid `prisma.contact.create()` invocation
 *     Unique constraint failed on the fields: (`telefone`)
 *
 * Não era instabilidade: `--workers=1` dava 22 verdes SEMPRE, e qualquer
 * execução focada deste arquivo dava vermelho SEMPRE. Na suíte inteira o
 * defeito ficava invisível porque a distribuição costumava concentrar os seis
 * casos num worker só.
 *
 * ## E o Ciclo 1e NÃO tornou isto desnecessário
 *
 * O comentário anterior culpava `Contact.telefone` ser `@unique` GLOBAL. Desde
 * o Ciclo 1e a chave é `@@unique([companyId, telefone])` — e os três workers
 * gravam na MESMA empresa (a do seed). Um telefone literal colidiria
 * exatamente igual. Reverter esta montagem para um literal reabre a quebra;
 * esta seção existe para que ninguém "limpe" isso achando que a composição
 * resolveu.
```

- [ ] **Step 13: Rodar os testes desta tarefa (GREEN)**

Um comando por vez, em série:

```bash
npx vitest run tests/unit/contact-isolamento.test.ts
npx vitest run tests/unit/dedupe.test.ts
npx vitest run tests/unit/contacts-service.test.ts
npx vitest run tests/unit/seed.test.ts tests/unit/seed-demo.test.ts
npm run typecheck
```

Esperado: todos verdes; `typecheck` sem saída. `dedupe.test.ts` e
`contacts-service.test.ts` **não deviam precisar de edição** — se algum deles
falhar, a mudança alcançou mais do que o desenho previa: **pare e reporte** antes
de editar o teste.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(tenancy): telefone de contato passa a ser unico POR EMPRESA

Duas empresas atendendo o mesmo cliente e o caso normal de um CRM
multi-empresa, e o unico global fazia disso um P2002. O preco ja foi
cobrado: seguranca-headers.spec.ts quebrava com tres workers do
Playwright, e dedupe.ts carregava um ramo inteiro so para explicar a
recusa.

Os dois ramos que existiam para a colisao entre empresas ficam
inalcancaveis e sao REESCRITOS, nao apagados: a janela que sobra e o
contato ser apagado entre a colisao e a releitura, e devolver undefined
ali faria a criacao de lead seguir com um contato inexistente.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `PipelineStage.ordem` vira `@@unique([companyId, ordem])`

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260820230000_etapa_ordem_por_empresa/migration.sql`
- Modify: `src/core/pipeline/service.ts` (só comentário)
- Modify: `src/core/leads/service.ts` (só comentário)
- Modify: `prisma/seed.ts`
- Modify: `prisma/seed-demo.ts`
- Modify: `tests/unit/pipeline-isolamento.test.ts`
- Modify: `tests/unit/contact-isolamento.test.ts` (só comentário)

**Interfaces:**
- Consumes: `model PipelineStage` (`prisma/schema.prisma`); `criarEtapa`, `ORDEM_ESTACIONAMENTO` (`src/core/pipeline/service.ts`); `listarEtapas` (`src/core/pipeline/stages.ts`).
- Produces:
  - `@@unique([companyId, ordem])` no lugar de `@@unique([ordem])`
  - o índice `PipelineStage_companyId_ordem_key` no lugar de `PipelineStage_ordem_key`
  - `prisma/seed.ts` e `prisma/seed-demo.ts` lendo etapa **com** `where: { companyId }`
  - nenhuma assinatura de função nova

**A auditoria que o comentário do schema exigia** já está feita e está na §4.2.1
do spec. As nove consultas que tocam `ordem`, e o veredito de cada uma:

| # | Onde | Muda? |
| --- | --- | --- |
| 1 | `src/core/pipeline/stages.ts:29` | não — já escopada |
| 2 | `src/core/leads/queries.ts:91` | não — já escopada |
| 3 | `src/core/leads/service.ts:108` | **só o comentário**, que hoje diz "inofensivo por acidente" |
| 4 | `src/core/pipeline/service.ts:195` (`aggregate _max`) | não — e **passa a estar certa de fato**: hoje `max(A)+1` pode colidir com uma `ordem` da B |
| 5 | `src/core/pipeline/service.ts:310` (vizinha) | não — já escopada |
| 6 | `src/core/pipeline/service.ts:337-345` (`ORDEM_ESTACIONAMENTO`) | **só o comentário** — o estacionamento continua necessário |
| 7 | `prisma/seed.ts:139` (`count()` global) | **não** — dívida declarada (⚠️ D2-a do spec) |
| 8 | `prisma/seed.ts:209` | **sim** — ganha `where: { companyId }` |
| 9 | `prisma/seed-demo.ts:285` | **sim** — ganha `where: { companyId }` |

- [ ] **Step 1: Provar que não há duplicata sob a chave nova**

```bash
npx tsx --conditions=react-server -e "import 'dotenv/config'; import { PrismaClient } from '@prisma/client'; import { PrismaPg } from '@prisma/adapter-pg'; const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) }); const r = await p.\$queryRaw\`SELECT \"companyId\", ordem, count(*) FROM \"PipelineStage\" GROUP BY 1,2 HAVING count(*) > 1\`; console.log(JSON.stringify(r)); await p.\$disconnect();"
```

Esperado: `[]`.

- [ ] **Step 2: Escrever o caso que falha (RED)**

Em `tests/unit/pipeline-isolamento.test.ts`, acrescentar um `describe` novo
**depois** do `describe("criarEtapa", ...)`:

```ts
describe("a mesma `ordem` em duas empresas — o que o Ciclo 1e destravou", () => {
  it("duas empresas podem ter etapas na MESMA posição do funil", async () => {
    // Até o Ciclo 1e isto era `P2002` em `PipelineStage_ordem_key`: a posição
    // "1" do funil era um recurso do BANCO INTEIRO, não da empresa. É a razão
    // pela qual as faixas de `ordem` deste arquivo tiveram de ser disjuntas.
    const nova = await prisma.pipelineStage.create({
      data: {
        id: `${P}-stage-a-na-ordem-da-b`,
        companyId: EMPRESA_A,
        nome: "A na mesma posição da B",
        ordem: ORDEM_B1,
        cor: "#777777",
      },
    });

    expect(nova.companyId).toBe(EMPRESA_A);
    expect(nova.ordem).toBe(ORDEM_B1);

    // Segunda metade: a etapa da B na mesma posição continua lá, intocada.
    expect((await lerEtapaCrua(ETAPA_B1))?.ordem).toBe(ORDEM_B1);
    expect((await lerEtapaCrua(ETAPA_B1))?.companyId).toBe(EMPRESA_B);
  });

  it("`criarEtapa` na B cai em `max(ordem da B) + 1` mesmo com a A já ocupando esse número", async () => {
    // O defeito VIVO que a composição corrige (§4.2.4 do spec): `criarEtapa` já
    // computa `max` DA EMPRESA desde o Ciclo 1d — corretamente. Com a unicidade
    // global, esse valor podia estar ocupado por outra empresa, e a pessoa via
    // um `P2002` apontando para uma etapa que ela não pode enxergar.
    const esperada = ORDEM_B2 + 1;

    // Ocupa, na empresa A, exatamente a posição em que a próxima etapa da B vai
    // nascer. Antes do Ciclo 1e, o `create` abaixo morreria aqui.
    await prisma.pipelineStage.create({
      data: {
        id: `${P}-stage-a-bloqueadora`,
        companyId: EMPRESA_A,
        nome: "Bloqueadora da A",
        ordem: esperada,
        cor: "#888888",
      },
    });

    const nova = await criarEtapa({
      nome: "Nova da B",
      cor: "#999999",
      autorId: USUARIO_B,
      companyId: EMPRESA_B,
    });

    expect(nova.ordem).toBe(esperada);
    expect(nova.companyId).toBe(EMPRESA_B);
  });
});
```

`semear` (que roda em `beforeEach`) já apaga toda `PipelineStage` das três
empresas, então as duas etapas criadas aqui não vazam para o caso seguinte —
confirmar isso lendo `semear` antes de rodar.

- [ ] **Step 3: Rodar para ver falhar**

```bash
npx vitest run tests/unit/pipeline-isolamento.test.ts
```

Esperado: FAIL nos dois casos novos, com
`Unique constraint failed on the fields: (ordem)`. Cole a saída.

- [ ] **Step 4: Trocar a constraint no schema**

Em `prisma/schema.prisma`, no `model PipelineStage`, substituir o bloco de
comentário que começa em `// \`@@unique([ordem])\` continua GLOBAL` e a linha
`@@unique([ordem])` por:

```prisma
  /// Unicidade POR EMPRESA (Ciclo 1e). Era `@@unique([ordem])`, GLOBAL.
  ///
  /// A auditoria que o comentário anterior exigia está feita, e está na §4.2.1
  /// do spec do Ciclo 1e: as nove consultas que tocam `ordem`, uma a uma. Ela
  /// ficou barata porque o Ciclo 1d converteu `pipeline/` inteiro para
  /// `prismaDaEmpresa` — as seis consultas de `src/` já carregavam `companyId`,
  /// e as três que não carregavam são de seed.
  ///
  /// A composição CORRIGE um defeito vivo, e não só destrava a segunda empresa:
  /// `criarEtapa` calcula `max(ordem DA EMPRESA) + 1` (correto desde o Ciclo
  /// 1d), e com a unicidade global esse valor podia já estar ocupado por outra
  /// empresa — `P2002` na tela `/etapas`, apontando para uma etapa que a pessoa
  /// não pode ver. Caso em `tests/unit/pipeline-isolamento.test.ts`
  /// ("`criarEtapa` na B cai em `max(ordem da B) + 1` mesmo com a A já ocupando
  /// esse número").
  ///
  /// `ORDEM_ESTACIONAMENTO = -1` (`core/pipeline/service.ts`) CONTINUA
  /// necessário: o Postgres verifica índice único a cada `UPDATE`, e a colisão
  /// que o estacionamento evita é entre duas etapas da MESMA empresa. O que
  /// mudou é que `-1` deixou de ser disputado ENTRE empresas.
  @@unique([companyId, ordem])
```

- [ ] **Step 5: Escrever a migração**

Criar `prisma/migrations/20260820230000_etapa_ordem_por_empresa/migration.sql`:

```sql
-- Ciclo 1e, Task 2: PipelineStage.ordem deixa de ser unica GLOBAL.
--
-- POR QUE: a posicao "1" do funil era um recurso do BANCO INTEIRO. Duas
-- empresas nao podiam ter uma primeira etapa cada, e nem os testes podiam --
-- pipeline-isolamento.test.ts e contact-isolamento.test.ts reservam faixas
-- disjuntas de `ordem` so por causa disto.
--
-- E CORRIGE UM DEFEITO VIVO, nao so destrava a segunda empresa: criarEtapa
-- calcula max(ordem DA EMPRESA) + 1 desde o Ciclo 1d, e esse valor podia estar
-- ocupado por outra empresa -- P2002 na tela /etapas apontando para uma etapa
-- invisivel para quem clicou.
--
-- POR QUE SEM DEDUPLICACAO: a chave nova e a antiga MAIS uma coluna. Medido em
-- 2026-08-20: PipelineStage = 4 linhas, Company = 1, e
-- GROUP BY ("companyId", ordem) HAVING count(*) > 1 devolveu vazio.
--
-- POR QUE NAO ACIONA tests/unit/migracoes-seguras.test.ts: nao ha ADD COLUMN
-- nem SET NOT NULL, so troca de indice. PERDOADAS nao recebe entrada.
--
-- O indice novo tambem serve melhor as consultas que existem: toda leitura de
-- funil em src/ tem a forma WHERE "companyId" = $1 ORDER BY "ordem", e um
-- btree ("companyId","ordem") atende igualdade no prefixo e ordenacao no
-- sufixo. Com 4 linhas isso nao e mensuravel aqui (NV3 do spec) -- e o
-- raciocinio de ordem de colunas ja esta registrado em prisma/schema.prisma.

-- DropIndex
DROP INDEX "PipelineStage_ordem_key";

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStage_companyId_ordem_key" ON "PipelineStage"("companyId", "ordem");
```

- [ ] **Step 6: Aplicar e regenerar**

```bash
npx prisma migrate deploy
npx prisma generate
npx vitest run tests/unit/migracoes-seguras.test.ts
```

Esperado: `1 migration applied`; guarda verde; `PERDOADAS` continua com duas
entradas.

- [ ] **Step 7: Corrigir os dois comentários que passariam a mentir**

Em `src/core/leads/service.ts`, substituir o bloco de doc de
`primeiraEtapaDoFunil` por:

```ts
/**
 * A primeira etapa do funil DESTA empresa.
 *
 * Era `prisma.pipelineStage.findFirstOrThrow({ orderBy: { ordem: "asc" } })`,
 * sem empresa nenhuma: o lead nascia na etapa de menor `ordem` do banco
 * INTEIRO. Enquanto `PipelineStage` teve `@@unique([ordem])` GLOBAL isso era
 * inofensivo por acidente — duas empresas não podiam ter uma etapa "1" cada,
 * então "a menor do banco" e "a menor da empresa" coincidiam.
 *
 * O Ciclo 1e desfez o acidente: a chave é `@@unique([companyId, ordem])`, duas
 * empresas ocupam a mesma posição, e uma consulta sem escopo passaria a
 * devolver a etapa de outra empresa sem nenhum erro. O escopo, que o Ciclo 1a
 * já tinha posto aqui, é o que continua segurando isso — e agora ele é a única
 * coisa que segura.
 */
```

Em `src/core/pipeline/service.ts`, no bloco de doc de `ORDEM_ESTACIONAMENTO`,
substituir o último parágrafo (`A unicidade de \`ordem\` é GLOBAL hoje …`) por:

```
 * A unicidade de `ordem` virou `@@unique([companyId, ordem])` no Ciclo 1e, e o
 * estacionamento CONTINUA necessário: a colisão que ele evita é entre duas
 * etapas da MESMA empresa, e essa continua existindo. O que mudou é que `-1`
 * deixou de ser disputado ENTRE empresas — antes, duas empresas reordenando
 * funis diferentes ao mesmo tempo colidiam neste valor.
```

- [ ] **Step 8: Escopar as duas leituras de etapa nos seeds**

Em `prisma/seed.ts`:

```ts
  // `where: { companyId }`, e não a etapa de menor `ordem` do banco inteiro:
  // desde o Ciclo 1e a `ordem` é única POR EMPRESA, então "a menor do banco"
  // deixou de coincidir com "a menor desta empresa". Sem o filtro, os leads de
  // demonstração nasceriam na etapa de outra empresa no dia em que existir uma.
  const primeiraEtapa = await prisma.pipelineStage.findFirstOrThrow({
    where: { companyId: empresa.id },
    orderBy: { ordem: "asc" },
  });
```

Em `prisma/seed-demo.ts`:

```ts
  // `where: { companyId }` pelo mesmo motivo de `seed.ts` (Ciclo 1e): sem ele,
  // a checagem `etapas.length !== 5` abaixo contaria o funil de todas as
  // empresas e lançaria uma mensagem que culpa a tela `/etapas` por um problema
  // que ela não causou.
  const etapas = await prisma.pipelineStage.findMany({
    where: { companyId: empresa.id },
    orderBy: { ordem: "asc" },
  });
```

**Não** escopar `prisma.pipelineStage.count()` em `seed.ts` — é ⚠️ D2-a,
declarada e não corrigida neste ciclo (o seed cria/encontra uma empresa só).

- [ ] **Step 9: Corrigir os comentários de faixa de `ordem` nos dois testes**

Em `tests/unit/pipeline-isolamento.test.ts`, substituir o primeiro parágrafo do
bloco que documenta as faixas (o que começa em
`` `PipelineStage.@@unique([ordem])` ainda é GLOBAL ``) por:

```
 * Desde o Ciclo 1e, `PipelineStage` tem `@@unique([companyId, ordem])`, então o
 * banco NÃO exige mais faixas disjuntas entre empresas — há caso neste arquivo
 * provando isso ("duas empresas podem ter etapas na MESMA posição do funil").
 * As faixas continuam disjuntas por outro motivo, que segue valendo: elas são
 * altas de propósito para não colidir com as do seed (medidas em 2026-08-20 na
 * empresa `company-migracao-1a`: 0, 1, 2 e 3) — se a fixture usasse a mesma
 * faixa, um caso passaria por acidente.
```

Em `tests/unit/contact-isolamento.test.ts`, substituir o bloco de doc de
`ORDEM_A`/`ORDEM_B` por:

```ts
/**
 * Faixa própria deste arquivo. Desde o Ciclo 1e a `ordem` é única POR EMPRESA
 * (`@@unique([companyId, ordem])`), então o banco não exige mais faixas
 * disjuntas — a exigência que sobra é não colidir com o funil do SEED (0..3),
 * que vive na mesma tabela e não é apagado pela limpeza deste arquivo.
 */
```

E o bloco de doc de `TELEFONE_A`/`TELEFONE_B` do mesmo arquivo:

```ts
/**
 * Família própria deste arquivo ("11922"). Desde o Ciclo 1e a unicidade de
 * telefone é `[companyId, telefone]`, então famílias distintas deixaram de ser
 * exigência do banco — continuam porque o banco de teste é o de
 * desenvolvimento (⚠️ R1 do Ciclo 1a) e um resíduo de execução interrompida de
 * outro arquivo, na MESMA empresa do seed, ainda derruba um caso por um motivo
 * que não é o testado.
 */
```

- [ ] **Step 10: Rodar os testes desta tarefa (GREEN)**

Um comando por vez:

```bash
npx vitest run tests/unit/pipeline-isolamento.test.ts
npx vitest run tests/unit/pipeline-service.test.ts tests/unit/pipeline-stages.test.ts tests/unit/pipeline-transacoes.test.ts
npx vitest run tests/unit/contact-isolamento.test.ts
npx vitest run tests/unit/lead-isolamento.test.ts
npx vitest run tests/unit/seed.test.ts tests/unit/seed-demo.test.ts
npm run typecheck
```

Todos verdes.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(tenancy): ordem de etapa passa a ser unica POR EMPRESA

A posicao "1" do funil era um recurso do banco inteiro. O comentario do
schema exigia auditar cada consulta que confiava em ordem ser unica
sozinha antes de mexer -- a auditoria esta na 4.2.1 do spec, e ficou
barata porque o Ciclo 1d ja tinha escopado pipeline/ inteiro.

Corrige tambem um defeito vivo: criarEtapa calcula max(ordem DA EMPRESA)
+ 1 desde o Ciclo 1d, e esse valor podia estar ocupado por outra empresa
-- P2002 na tela apontando para uma etapa que quem clicou nao pode ver.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `Conversation.waId` vira `@@unique([companyId, waId])`

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260820240000_conversa_waid_por_empresa/migration.sql`
- Modify: `src/modules/whatsapp/ingest.ts` (só comentário)
- Modify: `tests/unit/whatsapp-isolamento.test.ts`

**A decisão de produto está tomada e é a §4.3 do spec: `connectionId` fica FORA
da chave.** Duas conexões da mesma empresa recebendo o mesmo cliente produzem
**uma** conversa, não duas. Os três motivos, resumidos para quem executa esta
tarefa sem ler o spec inteiro:

1. `Conversation` carrega ESTADO (`iaAtiva`, `iaPausadaPor`,
   `aguardandoHumanoDesde`, `contactId`, `leadId`). Duplicá-la duplica a pausa da
   IA: a atendente assume o atendimento numa linha e o bot continua respondendo a
   mesma pessoa na outra, ao mesmo tempo.
2. `connectionId` é `String?`. No Postgres `NULL` é distinto de `NULL` num índice
   único — armadilha já registrada neste projeto em
   `@@unique([companyId, canal, instancia])`. Com ele na chave, duas linhas com
   `connectionId IS NULL` e o mesmo `waId` **ambas passam**, e a chave para de
   deduplicar exatamente onde a dedup é necessária.
3. Torná-lo `NOT NULL` mataria o caminho de reserva do Ciclo 2a
   (`ConexaoNaoConfiguradaError` / `ConexaoAmbiguaError`) e acionaria
   `migracoes-seguras`. Índice parcial e `UNIQUE NULLS NOT DISTINCT` resolveriam
   o NULL, e são recusados pelo precedente literal de `ORDEM_ESTACIONAMENTO`: o
   Prisma não os representa e viraria deriva no próximo `migrate diff`.

**Se durante a execução esta decisão parecer errada, pare e reporte — não a
reabra sozinho.**

**Interfaces:**
- Consumes: `model Conversation` (`prisma/schema.prisma`); `ingerirMensagem`, `ContextoDeIngestao` (`src/modules/whatsapp/ingest.ts`).
- Produces:
  - `Conversation.waId String` (sem `@unique`) + `@@unique([companyId, waId])`
  - o índice `Conversation_companyId_waId_key` no lugar de `Conversation_waId_key`
  - `ingerirMensagem` com a mesma assinatura e o mesmo fluxo; **só comentários mudam**

- [ ] **Step 1: Provar que não há duplicata (e medir de novo o volume)**

```bash
npx tsx --conditions=react-server -e "import 'dotenv/config'; import { PrismaClient } from '@prisma/client'; import { PrismaPg } from '@prisma/adapter-pg'; const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) }); const dup = await p.\$queryRaw\`SELECT \"companyId\", \"waId\", count(*) FROM \"Conversation\" GROUP BY 1,2 HAVING count(*) > 1\`; const tot = await p.conversation.count(); const nulos = await p.conversation.count({ where: { connectionId: null } }); console.log(JSON.stringify({ dup, tot, nulos })); await p.\$disconnect();"
```

Esperado: `{"dup":[],"tot":0,"nulos":0}`. Se `tot > 0`, **pare e reporte**: a
linha de base do spec mudou e a §4.3.2 (a armadilha do NULL) passa a ter dado
real por trás, o que é assunto do dono.

- [ ] **Step 2: Escrever o caso que falha (RED)**

Em `tests/unit/whatsapp-isolamento.test.ts`, acrescentar ao final do arquivo:

```ts
describe("o mesmo número em duas empresas — o que o Ciclo 1e destravou", () => {
  it("duas empresas podem ter conversas com o MESMO `waId`", async () => {
    // Até o Ciclo 1e isto era `P2002` em `Conversation_waId_key`, e o alcance
    // do defeito cresceu no Ciclo 2a: com `EVOLUTION_COMPANY_ID` morto, duas
    // empresas passaram a poder ter conexões, e o mesmo número atendido pelas
    // duas colidia → 500 → a Evolution reentregava para sempre (§6 da auditoria
    // do Ciclo 2a).
    const daB = await prisma.conversation.create({
      data: {
        id: `${P}-conv-b-mesmo-waid`,
        companyId: EMPRESA_B,
        // `WA_A` já pertence a uma conversa da empresa A, criada por `semear`.
        waId: WA_A,
      },
    });

    expect(daB.companyId).toBe(EMPRESA_B);
    expect(daB.waId).toBe(WA_A);

    // Segunda metade: a conversa da A com o mesmo número continua lá, e é outra
    // linha — o histórico das duas empresas não se fundiu.
    const daA = await prisma.conversation.findUniqueOrThrow({ where: { id: CONVERSA_A } });
    expect(daA.companyId).toBe(EMPRESA_A);
    expect(daA.waId).toBe(WA_A);
    expect(daA.id).not.toBe(daB.id);
  });
});
```

`limparTudo` já apaga `Conversation` por `companyId in [A, B]`, então a linha
nova não sobrevive ao arquivo — confirmar lendo `limparTudo` antes de rodar.

- [ ] **Step 3: Rodar para ver falhar**

```bash
npx vitest run tests/unit/whatsapp-isolamento.test.ts
```

Esperado: FAIL com `Unique constraint failed on the fields: (waId)`.

- [ ] **Step 4: Trocar a constraint no schema**

Em `prisma/schema.prisma`, no `model Conversation`, trocar:

```prisma
  waId                  String            @unique
```

por:

```prisma
  waId                  String
```

E, **imediatamente antes** de `@@index([processandoAte])`, acrescentar:

```prisma
  /// Uma conversa por número, POR EMPRESA (Ciclo 1e). Era `waId @unique`,
  /// GLOBAL.
  ///
  /// ## O que a global custava
  ///
  /// Enquanto `EVOLUTION_COMPANY_ID` era constante de deploy, a segunda empresa
  /// era inalcançável e o defeito era teoria. O Ciclo 2a matou a variável: o
  /// webhook passou a resolver a empresa pela CONEXÃO, e o mesmo número
  /// atendido por duas empresas colidia em `P2002` → 500 → a Evolution
  /// reentregava para sempre. O `catch` de `ingest.ts` diz "o retry acerta,
  /// porque na segunda vez o `findFirst` encontra a conversa" — verdade para a
  /// corrida dentro da mesma empresa, falso entre empresas, porque aquele
  /// `findFirst` é escopado. Com esta chave, só sobra o caso em que a frase é
  /// verdadeira.
  ///
  /// ## Por que `connectionId` NÃO entra na chave — é decisão de PRODUTO
  ///
  /// Uma empresa com dois números recebendo o mesmo cliente tem UMA conversa,
  /// não duas. `Conversation` carrega estado (`iaAtiva`, `iaPausadaPor`,
  /// `aguardandoHumanoDesde`, `contactId`, `leadId`), e duplicá-la duplica a
  /// pausa da IA: a atendente assume o atendimento numa linha e o bot continua
  /// respondendo a mesma pessoa na outra, ao mesmo tempo, na mesma tela do
  /// WhatsApp dela.
  ///
  /// Há um segundo motivo, mecânico: `connectionId` é `String?`, e no Postgres
  /// NULL é distinto de NULL num índice único — a mesma armadilha que
  /// `@@unique([companyId, canal, instancia])` documenta logo abaixo, mas ali
  /// ela é o comportamento desejado e aqui seria o contrário. Com
  /// `connectionId` na chave, duas linhas com o mesmo `waId` e `connectionId`
  /// nulo ambas passariam.
  ///
  /// ## O que a escolha custa, e está declarado
  ///
  /// A resposta sai por `Conversation.connectionId` — a conexão que ABRIU a
  /// conversa, não necessariamente aquela para a qual o cliente escreveu por
  /// último. É ⚠️ D3-a do spec do Ciclo 1e, com o conserto já nomeado
  /// (atualizar `connectionId` a cada mensagem de ENTRADA, como já se faz com
  /// `nomeExibicao`) e deixado para o dono decidir.
  @@unique([companyId, waId])
```

- [ ] **Step 5: Escrever a migração**

Criar `prisma/migrations/20260820240000_conversa_waid_por_empresa/migration.sql`:

```sql
-- Ciclo 1e, Task 3: Conversation.waId deixa de ser unico GLOBAL.
--
-- POR QUE, E POR QUE AGORA: enquanto EVOLUTION_COMPANY_ID era constante do
-- deploy, a segunda empresa era inalcancavel e o defeito era teoria. O Ciclo 2a
-- matou a variavel -- o webhook resolve a empresa pela CONEXAO -- e o mesmo
-- numero atendido por duas empresas passou a colidir em P2002, virar 500, e
-- fazer a Evolution reentregar para sempre. O laco nao tem saida por si: o
-- findFirst de ingest.ts e escopado e nunca acha a conversa da outra empresa.
--
-- POR QUE connectionId NAO ENTRA NA CHAVE (decisao de produto, 4.3 do spec):
-- uma empresa com dois numeros recebendo o mesmo cliente tem UMA conversa.
-- Conversation carrega estado (iaAtiva, iaPausadaPor, aguardandoHumanoDesde,
-- contactId, leadId) e duplica-la duplicaria a pausa da IA -- humano assume de
-- um lado, bot continua respondendo do outro. Alem disso connectionId e
-- anulavel, e NULL e distinto de NULL num indice unico do Postgres: com ele na
-- chave, duas linhas com o mesmo waId e connectionId nulo passariam as duas.
--
-- POR QUE SEM DEDUPLICACAO E SEM BACKFILL: medido em 2026-08-20,
-- Conversation = 0 linhas (e 0 com connectionId nulo). Nao ha o que fundir. E
-- por isso que este ciclo e agora: depois de existir historico de conversa, a
-- mesma mudanca vira migracao com decisao de fusao de historico.
--
-- POR QUE NAO ACIONA tests/unit/migracoes-seguras.test.ts: nao ha ADD COLUMN
-- nem SET NOT NULL. Em particular NAO tornamos connectionId NOT NULL -- isso
-- acionaria a guarda, e um DEFAULT numa FK de conexao penduraria conversas numa
-- conexao arbitraria, exatamente o argumento que a entrada
-- 20260819140000_restaura_user_papel_temporariamente ja usa. PERDOADAS nao
-- recebe entrada.

-- DropIndex
DROP INDEX "Conversation_waId_key";

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_companyId_waId_key" ON "Conversation"("companyId", "waId");
```

- [ ] **Step 6: Aplicar e regenerar**

```bash
npx prisma migrate deploy
npx prisma generate
npx vitest run tests/unit/migracoes-seguras.test.ts
```

- [ ] **Step 7: Reescrever os comentários de `ingest.ts` que descrevem a dívida**

Em `src/modules/whatsapp/ingest.ts`, substituir a seção
`## \`waId\` é \`@unique\` GLOBAL, e isso é pendência de SCHEMA` (do
`// ## \`waId\`` até o fim do parágrafo que termina em
`para ninguém gastar um dia diagnosticando.`) por:

```ts
      // ## `waId` é único POR EMPRESA desde o Ciclo 1e
      //
      // O `findFirst` escopado NÃO encontra a conversa de outra empresa com o
      // mesmo `waId` — e é isso que se quer: são conversas diferentes, de
      // empresas diferentes, com a mesma pessoa. A chave
      // `@@unique([companyId, waId])` é a mesma dupla de colunas que este
      // `findFirst` filtra (o escopo injeta `where.companyId`), então o `create`
      // abaixo só pode colidir com uma conversa DESTA empresa.
      //
      // O QUE ISSO FECHOU: até o Ciclo 1e, o `create` colidia com a conversa de
      // OUTRA empresa, o `catch` não achava mensagem por `idExterno` (ela não
      // chegou a ser gravada), o erro subia, a rota devolvia 500 e a Evolution
      // reentregava — para sempre, porque a segunda tentativa repetia tudo. Era
      // a §6 da auditoria do Ciclo 2a. Caso que trava isso:
      // `tests/unit/unicidades-por-empresa.test.ts`.
```

E, no `catch`, substituir o parágrafo sobre `Conversation.waId` por:

```ts
      // - `Conversation.waId` — a corrida que o `upsert` resolvia no banco e
      //   que `findFirst` + `create` reabriu (ver o comentário lá em cima).
      //   Aqui a conversa acabou de nascer pela mão do concorrente, e ESTA
      //   chamada não gravou a mensagem: ela precisa ser reprocessada, não
      //   confirmada. Deixar o erro subir faz a rota do webhook devolver 500 e
      //   a Evolution reentregar — e desde o Ciclo 1e o retry ACERTA sem
      //   qualificação, porque a chave (`[companyId, waId]`) e o `findFirst`
      //   (escopado pela mesma empresa) enxergam o mesmo conjunto de linhas.
      //   Antes disso, a frase valia só para a corrida intra-empresa.
```

- [ ] **Step 8: Rodar os testes desta tarefa (GREEN)**

```bash
npx vitest run tests/unit/whatsapp-isolamento.test.ts
npx vitest run tests/unit/whatsapp-ingest.test.ts
npx vitest run tests/unit/whatsapp-webhook-route.test.ts
npm run typecheck
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(tenancy): waId de conversa passa a ser unico POR EMPRESA

Esta era teoria ate o Ciclo 2a. Com EVOLUTION_COMPANY_ID morto, duas
empresas podem ter conexoes, e o mesmo numero atendido pelas duas
colidia em P2002 -> 500 -> reentrega para sempre. O laco nao tinha saida
por si, porque o findFirst de ingest.ts e escopado e nunca acha a
conversa da outra empresa.

connectionId fica FORA da chave, e e decisao de produto: duas conexoes
da mesma empresa recebendo o mesmo cliente sao UMA conversa. Duplica-la
duplicaria a pausa da IA -- humano assume de um lado, bot continua
respondendo do outro. E connectionId e anulavel, e NULL e distinto de
NULL num indice unico.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `WhatsappMessage.idExterno` vira `@@unique([companyId, idExterno])`

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260820250000_mensagem_idexterno_por_empresa/migration.sql`
- Modify: `src/modules/whatsapp/ingest.ts` (só comentário)
- Modify: `tests/unit/whatsapp-isolamento.test.ts`

**A decisão está tomada e é a §4.4 do spec: composta com `companyId`, NÃO com
`conversationId`.** O motivo que decide: a chave tem de casar com a consulta que
a lê. O `catch` de `ingest.ts` faz
`db.whatsappMessage.findFirst({ where: { idExterno } })` num cliente **escopado
por empresa** — isto é, `WHERE "companyId" = $1 AND "idExterno" = $2`. Uma chave
por `conversationId` permitiria o mesmo `idExterno` duas vezes dentro da mesma
empresa, esse `findFirst` devolveria uma linha arbitrária entre as duas, e o
`findFirstOrThrow` seguinte devolveria a conversa ERRADA para o job de fila.
Dedup "funcionando" com roteamento quebrado é pior que dedup falhando alto.

**Interfaces:**
- Consumes: `model WhatsappMessage` (`prisma/schema.prisma`); o `catch` de `ingerirMensagem` (`src/modules/whatsapp/ingest.ts`).
- Produces:
  - `WhatsappMessage.idExterno String` (sem `@unique`) + `@@unique([companyId, idExterno])`
  - o índice `WhatsappMessage_companyId_idExterno_key` no lugar de `WhatsappMessage_idExterno_key`
  - `ingerirMensagem` com o mesmo fluxo e a mesma garantia de idempotência; **só comentários mudam**

- [ ] **Step 1: Provar que não há duplicata**

```bash
npx tsx --conditions=react-server -e "import 'dotenv/config'; import { PrismaClient } from '@prisma/client'; import { PrismaPg } from '@prisma/adapter-pg'; const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) }); const dup = await p.\$queryRaw\`SELECT \"companyId\", \"idExterno\", count(*) FROM \"WhatsappMessage\" GROUP BY 1,2 HAVING count(*) > 1\`; const tot = await p.whatsappMessage.count(); console.log(JSON.stringify({ dup, tot })); await p.\$disconnect();"
```

Esperado: `{"dup":[],"tot":0}`.

- [ ] **Step 2: Escrever o caso que falha (RED)**

Em `tests/unit/whatsapp-isolamento.test.ts`, dentro do `describe` criado na
Tarefa 3, acrescentar:

```ts
  it("duas empresas podem ter mensagens com o MESMO `idExterno`", async () => {
    // `idExterno` é `data.key.id` da Evolution — a chave de idempotência que
    // faz a reentrega do mesmo webhook não virar duas linhas. Enquanto foi
    // única GLOBAL, o id de uma mensagem da empresa B bloqueava a gravação de
    // uma mensagem da A com o mesmo id.
    const idExternoCompartilhado = `${P}-ext-compartilhado`;

    const naA = await prisma.whatsappMessage.create({
      data: {
        id: `${P}-msg-a-compartilhada`,
        companyId: EMPRESA_A,
        conversationId: CONVERSA_A,
        idExterno: idExternoCompartilhado,
        direcao: "ENTRADA",
        autor: "CLIENTE",
        tipo: "TEXTO",
        texto: "da A",
      },
    });

    const naB = await prisma.whatsappMessage.create({
      data: {
        id: `${P}-msg-b-compartilhada`,
        companyId: EMPRESA_B,
        conversationId: CONVERSA_B,
        idExterno: idExternoCompartilhado,
        direcao: "ENTRADA",
        autor: "CLIENTE",
        tipo: "TEXTO",
        texto: "da B",
      },
    });

    expect(naA.companyId).toBe(EMPRESA_A);
    expect(naB.companyId).toBe(EMPRESA_B);
    expect(naA.id).not.toBe(naB.id);

    // Segunda metade, e é ela que impede "resolver" isto apagando a constraint:
    // a dedup DENTRO da empresa continua valendo.
    await expect(
      prisma.whatsappMessage.create({
        data: {
          id: `${P}-msg-a-duplicada`,
          companyId: EMPRESA_A,
          conversationId: CONVERSA_A,
          idExterno: idExternoCompartilhado,
          direcao: "ENTRADA",
          autor: "CLIENTE",
          tipo: "TEXTO",
          texto: "reentrega da A",
        },
      })
    ).rejects.toThrow();
  });
```

- [ ] **Step 3: Rodar para ver falhar**

```bash
npx vitest run tests/unit/whatsapp-isolamento.test.ts
```

Esperado: FAIL com `Unique constraint failed on the fields: (idExterno)` no
segundo `create`.

- [ ] **Step 4: Trocar a constraint no schema**

Em `prisma/schema.prisma`, no `model WhatsappMessage`, trocar:

```prisma
  idExterno      String          @unique
```

por:

```prisma
  idExterno      String
```

E, **imediatamente antes** do bloco de comentário de
`@@index([conversationId, direcao, processadoEm])`, acrescentar:

```prisma
  /// Idempotência POR EMPRESA (Ciclo 1e). Era `idExterno @unique`, GLOBAL.
  ///
  /// ## Por que `companyId`, e não `conversationId`
  ///
  /// A chave tem de casar com a consulta que a lê. O `catch` de `P2002` em
  /// `ingest.ts` faz `whatsappMessage.findFirst({ where: { idExterno } })` num
  /// cliente ESCOPADO — ou seja, `WHERE "companyId" = $1 AND "idExterno" = $2`,
  /// que é exatamente esta chave. Uma chave por `conversationId` deixaria o
  /// mesmo `idExterno` existir duas vezes dentro da mesma empresa, aquele
  /// `findFirst` devolveria uma linha ARBITRÁRIA entre as duas, e o
  /// `findFirstOrThrow` seguinte devolveria a conversa errada para o job de
  /// fila. Dedup "funcionando" com roteamento quebrado é pior que dedup
  /// falhando alto.
  ///
  /// ## Por que não continuar global
  ///
  /// A unidade de reentrega é a ENTREGA, e a entrega se resolve em empresa: o
  /// webhook chega por uma `WhatsappConnection`, que tem `companyId`. Global
  /// significava que o id de uma mensagem da empresa B bloqueava a gravação de
  /// uma mensagem da A — e `evolution.ts` chega a inventar
  /// `evolution-sem-id-<uuid>` quando o payload não traz `key.id`, então
  /// confiar em unicidade global de um id de terceiro é a suposição que este
  /// ciclo existe para desfazer.
  ///
  /// As duas metades estão travadas em
  /// `tests/unit/unicidades-por-empresa.test.ts`: duas empresas com o mesmo
  /// `idExterno` coexistem, E a reentrega dentro da MESMA empresa continua
  /// devolvendo `duplicada: true` sem criar linha nova.
  @@unique([companyId, idExterno])
```

- [ ] **Step 5: Escrever a migração**

Criar `prisma/migrations/20260820250000_mensagem_idexterno_por_empresa/migration.sql`:

```sql
-- Ciclo 1e, Task 4: WhatsappMessage.idExterno deixa de ser unico GLOBAL.
--
-- A FUNCAO DA CHAVE NAO MUDA: deduplicar reentrega. A Evolution reentrega em
-- caso de erro, e idExterno (data.key.id) e o que faz a mesma mensagem,
-- entregue duas vezes, nao virar duas linhas.
--
-- POR QUE companyId E NAO conversationId: a chave tem de casar com a consulta
-- que a le. O catch de P2002 em ingest.ts faz findFirst({ where: { idExterno } })
-- num cliente ESCOPADO -- WHERE "companyId" = $1 AND "idExterno" = $2. Uma
-- chave por conversationId permitiria o mesmo idExterno duas vezes na mesma
-- empresa, aquele findFirst devolveria uma linha arbitraria, e o
-- findFirstOrThrow seguinte devolveria a conversa ERRADA para o job de fila.
--
-- POR QUE NAO CONTINUAR GLOBAL: a unidade de reentrega e a ENTREGA, e a entrega
-- se resolve em empresa (o webhook chega por uma WhatsappConnection, que tem
-- companyId). Global fazia o id de uma mensagem da empresa B bloquear a
-- gravacao de uma mensagem da A.
--
-- POR QUE SEM DEDUPLICACAO: medido em 2026-08-20, WhatsappMessage = 0 linhas.
--
-- POR QUE NAO ACIONA tests/unit/migracoes-seguras.test.ts: nao ha ADD COLUMN
-- nem SET NOT NULL. PERDOADAS nao recebe entrada.

-- DropIndex
DROP INDEX "WhatsappMessage_idExterno_key";

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappMessage_companyId_idExterno_key" ON "WhatsappMessage"("companyId", "idExterno");
```

- [ ] **Step 6: Aplicar e regenerar**

```bash
npx prisma migrate deploy
npx prisma generate
npx vitest run tests/unit/migracoes-seguras.test.ts
```

- [ ] **Step 7: Corrigir os comentários que dizem "`@unique`" sem empresa**

Em `src/modules/whatsapp/ingest.ts`, na seção `## Idempotência (redelivery do
webhook)` do bloco de doc de `ingerirMensagem`, trocar a frase

``\`WhatsappMessage.idExterno\` é \`@unique\` — é a chave de idempotência``

por

``\`WhatsappMessage\` tem \`@@unique([companyId, idExterno])\` (Ciclo 1e) — é a chave de idempotência DENTRO DA EMPRESA, que é a unidade em que a Evolution reentrega: o webhook chega por uma conexão, e a conexão tem empresa``

E, no `catch`, na linha que descreve o ramo de `idExterno`, acrescentar ao final:

```ts
      //   A busca abaixo é escopada por empresa, o que é exatamente o par de
      //   colunas da chave — por isso ela nunca devolve mensagem de outra
      //   empresa nem mensagem ambígua dentro desta.
```

Em `prisma/schema.prisma`, no bloco de doc do `model WhatsappMessage` (o
`/** ... */` acima do modelo), trocar ``\`idExterno\` […] é \`@unique\` —`` por
``\`idExterno\` […] compõe \`@@unique([companyId, idExterno])\` —`` e a frase
``a corrida em \`Contact.telefone\``` por
``a corrida em \`Contact\` (`[companyId, telefone]`)``.

Em `tests/unit/whatsapp-isolamento.test.ts`, no bloco de doc do topo, substituir

```
 * duas empresas de verdade, com FK e `@unique` GLOBAL de verdade — `waId` e
 * `idExterno` são `@unique` sem empresa (`prisma/schema.prisma`), e é
 * exatamente esse tipo de coluna que faz um filtro por id parecer suficiente.
```

por

```
 * duas empresas de verdade, com FK e índice único de verdade. Desde o Ciclo 1e
 * `waId` e `idExterno` são únicos POR EMPRESA
 * (`@@unique([companyId, waId])` e `@@unique([companyId, idExterno])`) — e é
 * justamente por isso que o arquivo precisa do banco real: com a unicidade
 * composta, o BANCO deixou de ser a coisa que impede o vazamento, e quem impede
 * passou a ser só o escopo. Os dois casos do `describe` "o mesmo número em duas
 * empresas" travam essa transição.
```

- [ ] **Step 8: Rodar os testes desta tarefa (GREEN)**

```bash
npx vitest run tests/unit/whatsapp-isolamento.test.ts
npx vitest run tests/unit/whatsapp-ingest.test.ts
npx vitest run tests/unit/whatsapp-turno.test.ts
npx vitest run tests/unit/whatsapp-agente.test.ts
npm run typecheck
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(tenancy): idExterno de mensagem passa a ser unico POR EMPRESA

A funcao da chave nao muda: deduplicar reentrega da Evolution. O que
muda e o escopo dela, e a escolha e companyId, nao conversationId --
porque a chave precisa casar com a consulta que a le. O catch de P2002
busca por idExterno num cliente escopado por empresa; uma chave por
conversa permitiria o mesmo idExterno duas vezes na mesma empresa, e
essa busca devolveria uma linha arbitraria e a conversa errada para o
job de fila.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: A trava de deriva das quatro compostas e a prosa de `escopo.ts`

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Modify: `tests/unit/escopo-empresa.test.ts`
- Modify: `src/core/tenancy/escopo.ts` (só comentário)

**Por que esta tarefa existe.** Três vezes seguidas `escopo.ts` afirmou
fechamento em prosa sem exercitar a afirmação — o próprio arquivo de teste
registra isso, e por causa disso toda frase universal de lá tem, aqui, o caso que
a prova. As quatro compostas criam duas frases novas que precisam de trava:
"`companyId` é a primeira coluna das quatro" e "o escopo continua recusando
`findUnique` nelas". Sem as travas, um `prisma format` distraído ou uma
"simplificação" desfaz o ciclo inteiro sem nenhum teste ficar vermelho.

**Interfaces:**
- Consumes: `MODELOS_DE_TENANT`, `escoparArgumentos`, `prismaDaEmpresa` (`src/core/tenancy/escopo.ts`); `blocoDoModelo` (helper já existente em `tests/unit/escopo-empresa.test.ts`).
- Produces: dois casos novos em `escopo-empresa.test.ts` e um parágrafo novo no bloco "Recusa, lançando" de `escopo.ts`. Nenhum símbolo exportado novo.

- [ ] **Step 1: Escrever os casos que falham (RED)**

Em `tests/unit/escopo-empresa.test.ts`, dentro do `describe("afirmações
universais de escopo.ts", ...)`, **logo depois** do caso
`` "`WhatsappConnection.webhookTokenHash` é `@unique` GLOBAL — e isso é deliberado" ``,
acrescentar:

```ts
    it("as quatro unicidades do Ciclo 1e são COMPOSTAS e começam por `companyId`", () => {
      // A trava do ciclo inteiro. Cada uma destas quatro linhas foi, um dia, um
      // `@unique` global que impedia a segunda empresa de existir — e duas
      // delas cobraram preço real (o laço de 500 da Evolution, e
      // `seguranca-headers.spec.ts` quebrando em paralelo). `companyId` PRIMEIRO
      // não é gosto: é o que faz o índice servir `WHERE "companyId" = $1`, a
      // forma de toda consulta escopada.
      const esperado: [string, RegExp][] = [
        ["Contact", /^\s*@@unique\(\[companyId, telefone\]\)/],
        ["PipelineStage", /^\s*@@unique\(\[companyId, ordem\]\)/],
        ["Conversation", /^\s*@@unique\(\[companyId, waId\]\)/],
        ["WhatsappMessage", /^\s*@@unique\(\[companyId, idExterno\]\)/],
      ];

      const faltando = esperado
        .filter(([modelo, padrao]) => !blocoDoModelo(modelo).some((l) => padrao.test(l)))
        .map(([modelo]) => modelo);
      expect(faltando).toEqual([]);

      // E a metade que impede a volta: nenhum dos quatro campos pode ter
      // recuperado o `@unique` de coluna. Sem esta asserção, acrescentar a
      // composta SEM tirar a global passaria como correção — e a global é o
      // defeito.
      const aindaGlobais = (
        [
          ["Contact", /^\s*telefone\s+String\s+@unique/],
          ["PipelineStage", /^\s*@@unique\(\[ordem\]\)/],
          ["Conversation", /^\s*waId\s+String\s+@unique/],
          ["WhatsappMessage", /^\s*idExterno\s+String\s+@unique/],
        ] as [string, RegExp][]
      )
        .filter(([modelo, padrao]) => blocoDoModelo(modelo).some((l) => padrao.test(l)))
        .map(([modelo]) => modelo);
      expect(aindaGlobais).toEqual([]);
    });

    it("uma `@@unique` que CONTÉM companyId não reabre `findUnique` em modelo de tenant", async () => {
      // Depois do Ciclo 1e, `ContactWhereUniqueInput` aceita
      // `companyId_telefone` — o Prisma passou a ter onde pendurar o filtro nos
      // quatro. A recusa CONTINUA, e por uniformidade, pelo mesmo motivo que já
      // vale para `BotConfig` e `CompanyConfig`.
      //
      // A razão de fundo: o `companyId` de um `where` composto vem de QUEM
      // CHAMA. Um `findUnique` por `companyId_telefone` seria escopável pelo
      // TIPO e não pela EMPRESA — o caminho exato que a Tarefa 7 do Ciclo 2a
      // fechou para `webhookTokenHash`.
      const a = escopadoPara(EMPRESA_A);
      const cliente = a as any;

      const recusadas: [string, () => unknown][] = [
        [
          "Contact.findUnique por companyId_telefone",
          () =>
            cliente.contact.findUnique({
              where: { companyId_telefone: { companyId: EMPRESA_A, telefone: "11900000000" } },
            }),
        ],
        [
          "PipelineStage.update por companyId_ordem",
          () =>
            cliente.pipelineStage.update({
              where: { companyId_ordem: { companyId: EMPRESA_A, ordem: 1 } },
              data: { nome: "x" },
            }),
        ],
        [
          "Conversation.upsert por companyId_waId",
          () =>
            cliente.conversation.upsert({
              where: { companyId_waId: { companyId: EMPRESA_A, waId: "w" } },
              create: {},
              update: {},
            }),
        ],
        [
          "WhatsappMessage.delete por companyId_idExterno",
          () =>
            cliente.whatsappMessage.delete({
              where: { companyId_idExterno: { companyId: EMPRESA_A, idExterno: "e" } },
            }),
        ],
      ];

      // Mesmo idioma do caso "TODA mensagem lançada com escopo ativo carrega o
      // companyId", logo acima: `Promise.resolve().then(...)` porque parte
      // destes caminhos lança de forma síncrona e parte rejeita, e o teste não
      // deve depender de qual é qual.
      for (const [nome, disparar] of recusadas) {
        const erro = await Promise.resolve()
          .then(disparar)
          .then(
            () => new Error(`${nome} NAO lancou`),
            (e: Error) => e
          );

        expect(erro, nome).toBeInstanceOf(EscopoDeEmpresaError);
        expect((erro as Error).message, nome).toContain(EMPRESA_A);
      }
    });
```

Os três símbolos usados aí já existem no arquivo e **não precisam de import
novo**: `blocoDoModelo` (declaração de função no topo do módulo, hoistada),
`escopadoPara` (definida dentro do mesmo `describe` pai) e
`EscopoDeEmpresaError` (já importado, e usado pelo caso "TODA mensagem lançada
com escopo ativo carrega o companyId"). Se algum tiver nome diferente, usar o
nome real — **não criar helper novo**.

- [ ] **Step 2: Rodar**

```bash
npx vitest run tests/unit/escopo-empresa.test.ts
```

Esperado: os dois casos novos **passam de primeira** — as Tarefas 1 a 4 já
puseram as compostas no schema, e a recusa de `findUnique` já é o comportamento
em vigor. Este é o caso legítimo de teste que nasce verde: ele é **trava de
deriva**, não RED de funcionalidade. Se algum deles falhar, alguma das quatro
tarefas anteriores não fez o que diz que fez — **pare e reporte**.

Confirmar também, na mesma execução, que continuam verdes:
- `` "`BotConfig` e `CompanyConfig` são os ÚNICOS modelos de tenant onde companyId é único" `` (o regex dele é `@@unique\(\[companyId\]\)` exato, então as compostas não casam);
- `` "`WhatsappConnection` é modelo de tenant, e a lista tem exatamente 13" ``.

- [ ] **Step 3: Acrescentar o parágrafo à prosa de `escopo.ts`**

Em `src/core/tenancy/escopo.ts`, **logo depois** do parágrafo que começa em
`` * `WhatsappConnection` (Ciclo 2a) NÃO entra nessa lista ``, acrescentar:

```
 * **As quatro compostas do Ciclo 1e mudam o TIPO e não a regra.**
 * `Contact` (`[companyId, telefone]`), `PipelineStage` (`[companyId, ordem]`),
 * `Conversation` (`[companyId, waId]`) e `WhatsappMessage`
 * (`[companyId, idExterno]`) passaram a ter `@@unique` que CONTÉM `companyId`.
 * A frase acima — "em 11 dos 13 modelos de tenant `companyId` não é único" —
 * continua literalmente verdadeira, porque ela fala de `companyId` SOZINHO; o
 * que deixou de ser verdade é a conclusão fácil que se tira dela, "não existe
 * onde pendurar o filtro". Agora existe: `ContactWhereUniqueInput` aceita
 * `companyId_telefone`.
 *
 * A recusa continua, e passa a ser por uniformidade nesses quatro também — o
 * mesmo motivo de `BotConfig`/`CompanyConfig`. A razão de fundo é a que vale
 * para `webhookTokenHash`: o `companyId` de um `where` composto vem de QUEM
 * CHAMA, então `findUnique({ where: { companyId_telefone: { companyId, … } } })`
 * seria escopável pelo TIPO e não pela EMPRESA — o parâmetro é a defesa, e
 * parâmetro não é defesa. `findFirst` no cliente escopado resolve o mesmo caso
 * com a mesma consulta e com o `companyId` vindo do escopo. Há caso amarrando
 * isto (`tests/unit/escopo-empresa.test.ts`, "uma `@@unique` que CONTÉM
 * companyId não reabre `findUnique` em modelo de tenant"), para que a decisão
 * não se desfaça no dia em que o tipo parar de reclamar.
```

- [ ] **Step 4: Rodar de novo e fechar**

```bash
npx vitest run tests/unit/escopo-empresa.test.ts
npx vitest run tests/unit/catraca-prisma-cru.test.ts
npm run typecheck
npm run lint
```

Todos verdes. `catraca-prisma-cru` precisa continuar com
`LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS = 0` e o leitor de schema dele
precisa continuar achando **13** modelos de tenant.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
test(tenancy): trava as quatro compostas e diz por que findUnique segue recusado

As quatro @@unique novas contem companyId, entao o Prisma passou a
aceitar findUnique por chave composta nos quatro modelos. A recusa do
escopo continua, e o motivo precisa estar escrito: o companyId de um
where composto vem de quem chama -- seria escopavel pelo TIPO e nao pela
EMPRESA, o mesmo caminho que o Ciclo 2a fechou para webhookTokenHash.

A trava tem as duas metades: as compostas existem e comecam por
companyId, E nenhum dos quatro campos recuperou o @unique de coluna.
Acrescentar a composta sem tirar a global passaria como correcao, e a
global e o defeito.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: A prova — duas empresas coexistindo com as quatro colisões

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Create: `tests/unit/unicidades-por-empresa.test.ts`

**Por que este arquivo, e por que aqui.** Sem ele o ciclo é só schema. Ele
responde uma pergunta que nenhum arquivo existente responde: **"o BANCO aceita
as duas linhas?"** — e ela atravessa quatro módulos.

- Não pode ser `tests/unit/escopo-empresa.test.ts`: aquele usa um banco FALSO que
  nunca chama `query()`. Prova o mecanismo de injeção, não o que o índice faz.
- Não pode ser um dos `*-isolamento.test.ts`: cada um prova "o escopo da A não
  alcança o dado da B" para UM módulo.
- Não pode ser e2e: a afirmação é sobre constraint de banco, e um e2e provaria a
  mesma coisa mais devagar e com mais coisas capazes de falhar no caminho.

**Interfaces:**
- Consumes: `prisma` (`src/lib/prisma.ts`, prisma cru — legítimo em `tests/`, ver `catraca-prisma-cru.test.ts:71`); `encontrarOuCriarContact` (`src/core/leads/dedupe.ts`); `criarEtapa` (`src/core/pipeline/service.ts`); `listarEtapas` (`src/core/pipeline/stages.ts`); `ingerirMensagem`, `ContextoDeIngestao` (`src/modules/whatsapp/ingest.ts`); `prismaDaEmpresa` (`src/core/tenancy/escopo.ts`); `EventoWhatsapp` (`src/modules/whatsapp/gateway/tipos.ts`).
- Produces: `tests/unit/unicidades-por-empresa.test.ts`, com **seis** casos em tres pares (um por constraint composta, mais a metade que prova que a dedup nao afrouxou onde ela existia). Nenhum simbolo exportado.

- [ ] **Step 1: Escrever o arquivo**

Criar `tests/unit/unicidades-por-empresa.test.ts`:

```ts
// Este arquivo usa o Prisma REAL contra o Postgres do Supabase, então carrega
// DATABASE_URL do .env aqui — não em vitest.config.ts — para não injetar
// credenciais em testes que não tocam banco. Precisa ser o primeiro import:
// os módulos abaixo (via src/lib/prisma.ts → src/lib/env.ts) leem
// process.env.DATABASE_URL no top-level. Mesmo padrão de
// `tests/unit/pipeline-isolamento.test.ts`.
import "dotenv/config";

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

// "server-only" só resolve para um no-op sob a condição de resolução
// "react-server" que o Next.js aplica no build — fora desse pipeline (aqui,
// sob Vitest) ele sempre lança.
vi.mock("server-only", () => ({}));

import { prisma } from "../../src/lib/prisma";
import { prismaDaEmpresa } from "../../src/core/tenancy/escopo";
import { encontrarOuCriarContact } from "../../src/core/leads/dedupe";
import { criarEtapa } from "../../src/core/pipeline/service";
import { ingerirMensagem } from "../../src/modules/whatsapp/ingest";
import type { EventoWhatsapp } from "../../src/modules/whatsapp/gateway/tipos";

/**
 * A prova que dá sentido ao Ciclo 1e: **duas empresas coexistem** com o mesmo
 * telefone de contato, a mesma ordem de etapa, o mesmo `waId` de conversa e o
 * mesmo `idExterno` de mensagem — cada uma vendo só o seu.
 *
 * ## Por que este arquivo existe separado dos `*-isolamento`
 *
 * Cada `*-isolamento.test.ts` responde "o escopo da empresa A alcança dado da
 * B?" para um módulo. Este responde outra pergunta, que nenhum deles faz: "o
 * BANCO aceita as duas linhas?". Enquanto as quatro unicidades foram globais, a
 * resposta era não — e a resposta do banco era o que impedia a segunda empresa
 * de existir, independente de qualquer escopo estar certo.
 *
 * ## As DUAS metades, sempre
 *
 * Todo par de casos tem a segunda metade. Sem ela, apagar as quatro constraints
 * passaria em todos os casos de coexistência — e a dedup é justamente o que as
 * constraints compram. Os casos 2 e 6 são essas metades: a dedup de contato
 * DENTRO da empresa e a dedup de reentrega de webhook DENTRO da empresa
 * continuam valendo.
 *
 * ## Nada é medido com a MESMA consulta que o código faz
 *
 * As expectativas são conferidas com o `prisma` CRU, fora do escopo, nunca com
 * uma segunda chamada à função sob teste — lição do reparo de 2026-08-20
 * (commit 63cecd2).
 */

// ─── Ids fixos ────────────────────────────────────────────────────────────
//
// Prefixo próprio deste arquivo, para que a limpeza apague por prefixo sem
// tocar em nada do seed nem de outro arquivo de teste.
const P = "uni-emp";
const EMPRESA_A = `${P}-company-a`;
const EMPRESA_B = `${P}-company-b`;
const USUARIO_A = `${P}-user-a`;
const USUARIO_B = `${P}-user-b`;
const ETAPA_A = `${P}-stage-a`;
const ETAPA_B = `${P}-stage-b`;
const CONEXAO_A = `${P}-conn-a`;
const CONEXAO_B = `${P}-conn-b`;

/**
 * **O valor COMPARTILHADO pelas duas empresas** — é o ponto do arquivo inteiro.
 *
 * Família de telefone própria ("11955"), sem colisão com o seed
 * (`1199999000{0..3}`), `dedupe.test.ts` ("119977"), `lead-notes.test.ts`
 * ("119555"), `stage-transition.test.ts` ("119888"), `lead-isolamento.test.ts`
 * ("119333"), `pipeline-isolamento.test.ts` ("11944"),
 * `whatsapp-isolamento.test.ts` ("11966") nem `contact-isolamento.test.ts`
 * ("11922"). A separação por família continua valendo mesmo depois do Ciclo 1e
 * porque o banco de teste é o de desenvolvimento (⚠️ R1 do Ciclo 1a) e um
 * resíduo de execução interrompida derruba um caso por um motivo que não é o
 * testado.
 */
const TELEFONE_COMPARTILHADO = "11955550001";
/** Mesma posição do funil nas duas empresas. Faixa alta, longe do seed (0..3). */
const ORDEM_COMPARTILHADA = 9901;
const WAID_COMPARTILHADO = `${P}-wa-compartilhado`;
const ID_EXTERNO_COMPARTILHADO = `${P}-ext-compartilhado`;

const SENHA_FALSA = "$2b$10$naoUsadaPorNenhumTesteDesteArquivo000000000000000000";

/**
 * Ordem ditada pelas FKs, e ela não é negociável.
 *
 * `Notification` PRIMEIRO: `Notification_userId_fkey` aponta para `User`, e
 * `registrarAuditoria` → `avaliarAtividadeSuspeita` (que `criarEtapa` dispara)
 * grava notificação para os ADMINs da empresa. Sem esta linha o `deleteMany` de
 * `User` é barrado, o arquivo deixa usuários para trás, e a execução SEGUINTE
 * falha no `beforeAll` por e-mail duplicado — foi o bug do commit 63cecd2.
 *
 * `WhatsappMessage` antes de `Conversation`; `Conversation` antes de
 * `WhatsappConnection` (`Conversation.connectionId`) e antes de `Contact`
 * (`Conversation.contactId`); `Membership` antes de `User`.
 */
async function limparTudo() {
  const usuarios = [USUARIO_A, USUARIO_B];
  const empresas = [EMPRESA_A, EMPRESA_B];

  await prisma.notification.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.notification.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.auditLog.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.whatsappMessage.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.conversation.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.conversation.deleteMany({ where: { waId: WAID_COMPARTILHADO } });
  await prisma.whatsappConnection.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.lead.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.contact.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.contact.deleteMany({ where: { telefone: TELEFONE_COMPARTILHADO } });
  await prisma.pipelineStage.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.membership.deleteMany({ where: { userId: { in: usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.company.deleteMany({ where: { id: { in: empresas } } });
}

/** Recria TODO o estado mutável antes de cada caso — quase todo caso GRAVA. */
async function semear() {
  const empresas = [EMPRESA_A, EMPRESA_B];
  await prisma.notification.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.auditLog.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.whatsappMessage.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.conversation.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.conversation.deleteMany({ where: { waId: WAID_COMPARTILHADO } });
  await prisma.lead.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.contact.deleteMany({ where: { companyId: { in: empresas } } });
  await prisma.contact.deleteMany({ where: { telefone: TELEFONE_COMPARTILHADO } });
  await prisma.pipelineStage.deleteMany({ where: { companyId: { in: empresas } } });

  await prisma.pipelineStage.createMany({
    data: [
      {
        id: ETAPA_A,
        companyId: EMPRESA_A,
        nome: "Primeira da A",
        ordem: ORDEM_COMPARTILHADA,
        cor: "#111111",
      },
      {
        id: ETAPA_B,
        companyId: EMPRESA_B,
        nome: "Primeira da B",
        ordem: ORDEM_COMPARTILHADA,
        cor: "#222222",
      },
    ],
  });
}

/** O contexto que `ingerirMensagem` exige desde o Ciclo 2a. */
function contextoDe(companyId: string, connectionId: string) {
  return { companyId, connectionId };
}

/**
 * Um evento de entrada normalizado, com o `waId`/`idExterno` compartilhados.
 *
 * Os seis campos são os que `EventoWhatsapp`
 * (`src/modules/whatsapp/gateway/tipos.ts`) exige — `nomeExibicao` e `texto`
 * são `string | null` (não opcionais), e `timestamp` é `Date` obrigatório.
 * Instante fixo de propósito: nada neste arquivo depende de "agora", e um
 * `new Date()` faria a fixture variar entre execuções sem ganhar nada.
 */
function eventoCompartilhado(): EventoWhatsapp {
  return {
    idExterno: ID_EXTERNO_COMPARTILHADO,
    waId: WAID_COMPARTILHADO,
    nomeExibicao: "Cliente compartilhado",
    tipo: "TEXTO",
    texto: "oi",
    timestamp: new Date("2026-08-20T12:00:00.000Z"),
  };
}

beforeAll(async () => {
  await limparTudo();

  await prisma.company.createMany({
    data: [
      { id: EMPRESA_A, nome: "Empresa A das unicidades" },
      { id: EMPRESA_B, nome: "Empresa B das unicidades" },
    ],
  });

  await prisma.user.createMany({
    data: [
      {
        id: USUARIO_A,
        nome: "Ana da A",
        email: `${USUARIO_A}@exemplo.invalido`,
        senhaHash: SENHA_FALSA,
        papel: "ADMIN",
      },
      {
        id: USUARIO_B,
        nome: "Bruno da B",
        email: `${USUARIO_B}@exemplo.invalido`,
        senhaHash: SENHA_FALSA,
        papel: "ADMIN",
      },
    ],
  });

  // O vínculo, e não `User.papel`, é o que define "pessoa desta empresa" — é
  // dele que `registrarAuditoria` (chamado por `criarEtapa`) tira o escopo.
  // Fixture que cria `User` sem `Membership` produz usuário sem empresa
  // nenhuma: foi o bug latente do commit e67e1e6.
  await prisma.membership.createMany({
    data: [
      { userId: USUARIO_A, companyId: EMPRESA_A, papel: "ADMIN" },
      { userId: USUARIO_B, companyId: EMPRESA_B, papel: "ADMIN" },
    ],
  });

  // Uma conexão por empresa: `ingerirMensagem` recebe `{ companyId,
  // connectionId }` desde o Ciclo 2a, e `Conversation.connectionId` é FK.
  // `webhookTokenHash` é `@unique` GLOBAL de propósito (segredo de 256 bits;
  // duas empresas com o mesmo token é estado que deve ser impossível) — por
  // isso os dois valores aqui são distintos, e isso NÃO contradiz este ciclo.
  await prisma.whatsappConnection.createMany({
    data: [
      {
        id: CONEXAO_A,
        companyId: EMPRESA_A,
        canal: "EVOLUTION",
        nome: "Conexão da A",
        dominio: "https://exemplo.invalido",
        instancia: `${P}-inst-a`,
        segredoCifrado: `${P}-cifrado-a`,
        segredoUltimos4: "aaaa",
        segredoAtualizadoEm: new Date("2026-08-20T00:00:00.000Z"),
        webhookTokenHash: `${P}-hash-a`,
      },
      {
        id: CONEXAO_B,
        companyId: EMPRESA_B,
        canal: "EVOLUTION",
        nome: "Conexão da B",
        dominio: "https://exemplo.invalido",
        instancia: `${P}-inst-b`,
        segredoCifrado: `${P}-cifrado-b`,
        segredoUltimos4: "bbbb",
        segredoAtualizadoEm: new Date("2026-08-20T00:00:00.000Z"),
        webhookTokenHash: `${P}-hash-b`,
      },
    ],
  });
}, 60_000);

beforeEach(semear);

afterAll(limparTudo);

describe("Contact.telefone — `@@unique([companyId, telefone])`", () => {
  it("o MESMO telefone existe nas duas empresas, e cada escopo vê só o seu", async () => {
    const naA = await encontrarOuCriarContact({
      nome: "Cliente visto pela A",
      telefone: TELEFONE_COMPARTILHADO,
      companyId: EMPRESA_A,
    });

    // Antes do Ciclo 1e esta chamada lançava "Telefone já cadastrado em outra
    // empresa" — o ramo que `dedupe.ts` carregava só para explicar a recusa.
    const naB = await encontrarOuCriarContact({
      nome: "Cliente visto pela B",
      telefone: TELEFONE_COMPARTILHADO,
      companyId: EMPRESA_B,
    });

    expect(naA.id).not.toBe(naB.id);

    // Oráculo cru, fora do escopo: são DUAS linhas.
    const cruas = await prisma.contact.findMany({
      where: { telefone: TELEFONE_COMPARTILHADO },
      orderBy: { companyId: "asc" },
      select: { id: true, companyId: true, nome: true },
    });
    expect(cruas).toHaveLength(2);
    expect(cruas.map((c) => c.companyId).sort()).toEqual([EMPRESA_A, EMPRESA_B].sort());

    // E cada empresa enxerga só a sua.
    const vistosPelaA = await prismaDaEmpresa(EMPRESA_A).contact.findMany({
      where: { telefone: TELEFONE_COMPARTILHADO },
    });
    expect(vistosPelaA.map((c) => c.id)).toEqual([naA.id]);

    const vistosPelaB = await prismaDaEmpresa(EMPRESA_B).contact.findMany({
      where: { telefone: TELEFONE_COMPARTILHADO },
    });
    expect(vistosPelaB.map((c) => c.id)).toEqual([naB.id]);
  });

  it("a dedup DENTRO da empresa continua valendo — a segunda metade", async () => {
    // Sem este caso, apagar a constraint passaria no caso acima. A dedup é o
    // que a constraint compra, e ela não pode ter sido afrouxada.
    const primeiro = await encontrarOuCriarContact({
      nome: "Cliente da A",
      telefone: TELEFONE_COMPARTILHADO,
      companyId: EMPRESA_A,
    });
    const segundo = await encontrarOuCriarContact({
      nome: "Nome diferente, mesma pessoa",
      telefone: TELEFONE_COMPARTILHADO,
      companyId: EMPRESA_A,
    });

    expect(segundo.id).toBe(primeiro.id);
    // Nunca sobrescreve o nome de quem já existe — regra de `dedupe.ts`.
    expect(segundo.nome).toBe("Cliente da A");

    const total = await prisma.contact.count({
      where: { companyId: EMPRESA_A, telefone: TELEFONE_COMPARTILHADO },
    });
    expect(total).toBe(1);
  });
});

describe("PipelineStage.ordem — `@@unique([companyId, ordem])`", () => {
  it("a MESMA posição do funil existe nas duas empresas, e cada escopo vê só a sua", async () => {
    // As duas etapas em `ORDEM_COMPARTILHADA` foram criadas por `semear`: antes
    // do Ciclo 1e o próprio `createMany` da fixture morreria em `P2002`.
    const cruas = await prisma.pipelineStage.findMany({
      where: { ordem: ORDEM_COMPARTILHADA },
      select: { id: true, companyId: true },
    });
    expect(cruas).toHaveLength(2);

    const daA = await prismaDaEmpresa(EMPRESA_A).pipelineStage.findMany({
      where: { ordem: ORDEM_COMPARTILHADA },
    });
    expect(daA.map((e) => e.id)).toEqual([ETAPA_A]);

    const daB = await prismaDaEmpresa(EMPRESA_B).pipelineStage.findMany({
      where: { ordem: ORDEM_COMPARTILHADA },
    });
    expect(daB.map((e) => e.id)).toEqual([ETAPA_B]);
  });

  it("`criarEtapa` na B não colide com a posição que a A já ocupa", async () => {
    // O defeito VIVO que a composição corrige: `criarEtapa` calcula
    // `max(ordem DA EMPRESA) + 1` desde o Ciclo 1d — e com a unicidade global
    // esse número podia estar ocupado por outra empresa, produzindo `P2002` na
    // tela `/etapas` apontando para uma etapa invisível para quem clicou.
    const esperada = ORDEM_COMPARTILHADA + 1;

    await prisma.pipelineStage.create({
      data: {
        id: `${P}-stage-a-bloqueadora`,
        companyId: EMPRESA_A,
        nome: "Bloqueadora da A",
        ordem: esperada,
        cor: "#333333",
      },
    });

    const nova = await criarEtapa({
      nome: "Nova da B",
      cor: "#444444",
      autorId: USUARIO_B,
      companyId: EMPRESA_B,
    });

    expect(nova.ordem).toBe(esperada);
    expect(nova.companyId).toBe(EMPRESA_B);

    const crua = await prisma.pipelineStage.findUnique({ where: { id: nova.id } });
    expect(crua?.companyId).toBe(EMPRESA_B);
  });
});

describe("Conversation.waId e WhatsappMessage.idExterno — o caminho do webhook", () => {
  it("o MESMO número e o MESMO id de mensagem entram nas duas empresas", async () => {
    // É o laço de 500 da §6 da auditoria do Ciclo 2a: antes desta mudança, a
    // segunda chamada colidia em `Conversation_waId_key`, o `catch` não achava
    // mensagem por `idExterno` (ela não chegou a ser gravada), o erro subia, a
    // rota devolvia 500 e a Evolution reentregava — para sempre, porque a
    // segunda tentativa repetia tudo.
    const naA = await ingerirMensagem(
      eventoCompartilhado(),
      contextoDe(EMPRESA_A, CONEXAO_A)
    );
    const naB = await ingerirMensagem(
      eventoCompartilhado(),
      contextoDe(EMPRESA_B, CONEXAO_B)
    );

    expect(naA.duplicada).toBe(false);
    expect(naB.duplicada).toBe(false);
    expect(naA.conversationId).not.toBe(naB.conversationId);
    expect(naA.companyId).toBe(EMPRESA_A);
    expect(naB.companyId).toBe(EMPRESA_B);

    // Oráculo cru: duas conversas e duas mensagens, uma de cada empresa.
    const conversas = await prisma.conversation.findMany({
      where: { waId: WAID_COMPARTILHADO },
      select: { id: true, companyId: true, connectionId: true },
    });
    expect(conversas).toHaveLength(2);
    expect(conversas.map((c) => c.companyId).sort()).toEqual([EMPRESA_A, EMPRESA_B].sort());
    // A conexão de entrada é gravada em cada uma — é por ela que a resposta sai.
    expect(conversas.map((c) => c.connectionId).sort()).toEqual([CONEXAO_A, CONEXAO_B].sort());

    const mensagens = await prisma.whatsappMessage.findMany({
      where: { idExterno: ID_EXTERNO_COMPARTILHADO },
      select: { companyId: true },
    });
    expect(mensagens).toHaveLength(2);

    // E cada escopo vê só a sua conversa.
    const daA = await prismaDaEmpresa(EMPRESA_A).conversation.findMany({
      where: { waId: WAID_COMPARTILHADO },
    });
    expect(daA.map((c) => c.id)).toEqual([naA.conversationId]);
  });

  it("a reentrega DENTRO da mesma empresa continua deduplicando — a segunda metade", async () => {
    // A metade que impede "resolver" o ciclo quebrando a idempotência: sem
    // ela, apagar `@@unique([companyId, idExterno])` passaria no caso acima.
    const primeira = await ingerirMensagem(
      eventoCompartilhado(),
      contextoDe(EMPRESA_A, CONEXAO_A)
    );
    expect(primeira.duplicada).toBe(false);

    const reentrega = await ingerirMensagem(
      eventoCompartilhado(),
      contextoDe(EMPRESA_A, CONEXAO_A)
    );

    expect(reentrega.duplicada).toBe(true);
    expect(reentrega.conversationId).toBe(primeira.conversationId);
    // `bufferSeq` NÃO foi incrementado de novo — é o que faz o job de turno não
    // reprocessar a mesma mensagem.
    expect(reentrega.bufferSeq).toBe(primeira.bufferSeq);

    const mensagens = await prisma.whatsappMessage.count({
      where: { companyId: EMPRESA_A, idExterno: ID_EXTERNO_COMPARTILHADO },
    });
    expect(mensagens).toBe(1);

    const conversas = await prisma.conversation.count({
      where: { companyId: EMPRESA_A, waId: WAID_COMPARTILHADO },
    });
    expect(conversas).toBe(1);
  });
});
```

**Antes de rodar, conferir dois contratos contra os arquivos reais** (e ajustar
o teste, nunca o código de produção, se divergirem):

1. `EventoWhatsapp` (`src/modules/whatsapp/gateway/tipos.ts`). Lido em
   2026-08-20, seis campos, **nenhum opcional**: `idExterno: string`,
   `waId: string`, `nomeExibicao: string | null`, `tipo: TipoMensagemWhatsapp`,
   `texto: string | null`, `timestamp: Date`. `eventoCompartilhado()` acima
   monta exatamente esses seis. Se o tipo tiver mudado, o `typecheck` acusa.
2. As colunas obrigatórias de `WhatsappConnection` em `prisma/schema.prisma` —
   se alguma faltar no `createMany` do `beforeAll`, o TypeScript acusa.

- [ ] **Step 2: Rodar**

```bash
npx vitest run tests/unit/unicidades-por-empresa.test.ts
```

Esperado: **6 casos, todos verdes**. Cole a saída inteira — é a evidência que
fecha o ⚠️ R2 do Ciclo 1a.

- [ ] **Step 3: Provar que o arquivo DISCRIMINA, e não decora**

Este passo é o que impede o arquivo de ser decorativo. Reverter **uma** das
quatro constraints no banco, ver o arquivo ficar vermelho, e repor:

```bash
npx tsx --conditions=react-server -e "import 'dotenv/config'; import { PrismaClient } from '@prisma/client'; import { PrismaPg } from '@prisma/adapter-pg'; const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) }); await p.\$executeRawUnsafe('DROP INDEX \"Contact_companyId_telefone_key\"'); await p.\$executeRawUnsafe('CREATE UNIQUE INDEX \"Contact_telefone_key\" ON \"Contact\"(telefone)'); await p.\$disconnect();"
npx vitest run tests/unit/unicidades-por-empresa.test.ts
```

Esperado: **FAIL** no caso "o MESMO telefone existe nas duas empresas". Repor
imediatamente:

```bash
npx tsx --conditions=react-server -e "import 'dotenv/config'; import { PrismaClient } from '@prisma/client'; import { PrismaPg } from '@prisma/adapter-pg'; const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) }); await p.\$executeRawUnsafe('DROP INDEX \"Contact_telefone_key\"'); await p.\$executeRawUnsafe('CREATE UNIQUE INDEX \"Contact_companyId_telefone_key\" ON \"Contact\"(\"companyId\", telefone)'); await p.\$disconnect();"
npx prisma migrate status
npx vitest run tests/unit/unicidades-por-empresa.test.ts
```

Esperado: `Database schema is up to date!` e os 6 casos verdes de novo. **Se o
segundo comando falhar por qualquer motivo, PARE E REPORTE imediatamente** — o
banco ficou com o índice errado, e nenhuma tarefa seguinte deve rodar até isso
ser desfeito.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
test(tenancy): a prova de que duas empresas coexistem

Sem este arquivo o Ciclo 1e e so schema. Ele responde a pergunta que
nenhum *-isolamento faz -- "o BANCO aceita as duas linhas?" -- e ela
atravessa quatro modulos: mesmo telefone, mesma ordem de etapa, mesmo
waId e mesmo idExterno, cada empresa vendo so o seu.

Dois dos seis casos sao a segunda metade, e sao eles que impedem
"resolver" o ciclo apagando as constraints: a dedup de contato dentro da
empresa e a dedup de reentrega de webhook dentro da empresa continuam
valendo.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Verificação final e preparo da auditoria

**DEPENDE DE AÇÃO DO DONO:** não.

**Files:**
- Modify: nenhum, salvo o que os passos abaixo apontarem como divergência.

**Interfaces:**
- Consumes: tudo que as Tarefas 1 a 6 produziram.
- Produces: o relatório de fechamento (na resposta do agente, **não** num arquivo `.md`) com as saídas coladas, e a lista do que ficou NÃO VERIFICADO.

- [ ] **Step 1: Estado do banco e das migrações**

```bash
npx prisma migrate status
ls prisma/migrations/
```

Esperado: `23 migrations found` (19 da linha de base + 4 deste ciclo) e
`Database schema is up to date!`.

- [ ] **Step 2: Os quatro índices, conferidos no Postgres**

```bash
npx tsx --conditions=react-server -e "import 'dotenv/config'; import { PrismaClient } from '@prisma/client'; import { PrismaPg } from '@prisma/adapter-pg'; const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) }); const r = await p.\$queryRaw\`SELECT c.relname tabela, i.relname indice, pg_get_indexdef(x.indexrelid) def FROM pg_index x JOIN pg_class c ON c.oid = x.indrelid JOIN pg_class i ON i.oid = x.indexrelid WHERE x.indisunique AND c.relname IN ('Contact','PipelineStage','Conversation','WhatsappMessage') ORDER BY 1,2\`; console.log(JSON.stringify(r, null, 2)); await p.\$disconnect();"
```

Esperado, exatamente: `Contact_companyId_telefone_key`,
`PipelineStage_companyId_ordem_key`, `Conversation_companyId_waId_key`,
`WhatsappMessage_companyId_idExterno_key` (mais as quatro PKs). **Nenhum** dos
quatro nomes antigos pode aparecer. Cole a saída.

- [ ] **Step 3: Nenhuma prosa sobrevivente afirmando unicidade global das quatro**

```bash
grep -rn "unique. GLOBAL" src/ prisma/ tests/ docs/superpowers/specs/2026-08-20-ciclo-1e-unicidades-globais-design.md
```

Esperado: as únicas ocorrências que sobram falam de
`WhatsappConnection.webhookTokenHash` (que é global **de propósito**, com caso de
teste próprio) ou de `User.email`, ou são prosa histórica dizendo "era global até
o Ciclo 1e". Qualquer linha afirmando, no presente, que uma das quatro é global,
está errada — corrigir e recomeçar este passo.

```bash
grep -rn "PipelineStage.@@unique(\[ordem\])\|Contact.telefone. é .@unique. GLOBAL\|waId. é .@unique. GLOBAL" src/ prisma/ tests/
```

Esperado: nada, ou só prosa no passado.

- [ ] **Step 4: A guarda de migrações e a catraca**

```bash
npx vitest run tests/unit/migracoes-seguras.test.ts
npx vitest run tests/unit/catraca-prisma-cru.test.ts
```

Esperado: verdes. Conferir por leitura que `PERDOADAS` continua com **duas**
entradas e que `LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS` continua **0**.

- [ ] **Step 5: A suíte que este ciclo tocou, em série**

Um comando por vez. **Não rodar `npm test`.**

```bash
npx vitest run tests/unit/unicidades-por-empresa.test.ts
npx vitest run tests/unit/escopo-empresa.test.ts
npx vitest run tests/unit/contact-isolamento.test.ts
npx vitest run tests/unit/pipeline-isolamento.test.ts
npx vitest run tests/unit/whatsapp-isolamento.test.ts
npx vitest run tests/unit/lead-isolamento.test.ts
npx vitest run tests/unit/dedupe.test.ts tests/unit/contacts-service.test.ts
npx vitest run tests/unit/pipeline-service.test.ts tests/unit/pipeline-stages.test.ts tests/unit/pipeline-transacoes.test.ts
npx vitest run tests/unit/whatsapp-ingest.test.ts tests/unit/whatsapp-turno.test.ts tests/unit/whatsapp-agente.test.ts
npx vitest run tests/unit/whatsapp-webhook-route.test.ts tests/unit/whatsapp-envio-por-conexao.test.ts
npx vitest run tests/unit/seed.test.ts tests/unit/seed-demo.test.ts
npm run typecheck
npm run lint
```

Todos verdes; `typecheck` e `lint` sem saída. Cole os totais de cada execução.

- [ ] **Step 6: Confirmar que o volume medido no spec continua valendo**

```bash
npx tsx --conditions=react-server -e "import 'dotenv/config'; import { PrismaClient } from '@prisma/client'; import { PrismaPg } from '@prisma/adapter-pg'; const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) }); console.log(JSON.stringify({ Company: await p.company.count(), Contact: await p.contact.count(), PipelineStage: await p.pipelineStage.count(), Lead: await p.lead.count(), Conversation: await p.conversation.count(), WhatsappMessage: await p.whatsappMessage.count(), WhatsappConnection: await p.whatsappConnection.count() })); await p.\$disconnect();"
```

Esperado: os mesmos números da linha de base (`Company 1 · Contact 4 ·
PipelineStage 4 · Lead 4 · Conversation 0 · WhatsappMessage 0 ·
WhatsappConnection 0`). Números diferentes significam resíduo de teste não
limpo — investigar **antes** de fechar, porque resíduo no banco de
desenvolvimento é ⚠️ R1 do Ciclo 1a se manifestando.

- [ ] **Step 7: Escrever o relatório de fechamento**

**Na resposta do agente, não num arquivo.** Deve conter:

1. As saídas coladas dos passos 1, 2 e 6.
2. Os quatro nomes de migração criados.
3. A confirmação de que `PERDOADAS` tem 2 entradas,
   `LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS` é 0 e `MODELOS_DE_TENANT.size` é 13.
4. A lista dos ⚠️ que o ciclo **declara e não corrige**: D3-a (a resposta sai
   pela conexão que abriu a conversa), D2-a (`seed.ts:139` conta etapa sem
   empresa), D5 (os quatro `@@index([companyId])` redundantes).
5. A lista de 🔍 **NÃO VERIFICADO**, copiada da §13 do spec e atualizada com o
   que a execução conseguiu ou não medir:
   - NV1 — `prisma migrate dev` sem deriva (exige shadow database);
   - NV2 — `idExterno` não se repetir entre contas da Evolution;
   - NV3 — o índice composto servir melhor que o antigo (4 linhas: `Seq Scan`);
   - NV4 — o laço de reentrega da Evolution parar de fato (exige instância viva);
   - NV5 — os quatro `@@index([companyId])` serem redundantes na prática.
6. **A auditoria de segurança ainda NÃO foi feita.** `AGENTS.md` exige a Fase 1
   da skill `auditoria-seguranca` sobre a superfície tocada, **antes** de
   qualquer merge ou PR, com o relatório entregue e a execução **parada** até o
   dono aprovar. Dizer isso explicitamente no relatório e **não abrir PR**.

- [ ] **Step 8: Commit final, se algum passo tiver corrigido algo**

Se os passos 1 a 6 não pediram nenhuma correção, não há o que commitar — dizer
isso no relatório. Se pediram:

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(tenancy): fecha o Ciclo 1e medindo o que ele mudou

<descrever o que a verificacao final corrigiu, com a saida que apontou>

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Não fazer push. Não abrir PR.**

---

## Auto-revisão deste plano

### 1. Cobertura do spec

| Item do spec | Tarefa que entrega | Verificação |
| --- | --- | --- |
| §4.1 D1 — `Contact.telefone` composta | Task 1, Steps 5-6 | Task 7, Step 2 |
| §4.1 — `dedupe.ts` reescrito, não apagado | Task 1, Step 9 | Task 1, Step 13 |
| §4.1 — `erroDeTelefoneOcupado` reescrito | Task 1, Step 10 | Task 1, Step 13 |
| §4.1 — seeds que usam a chave única | Task 1, Step 11 | Task 1, Step 13 |
| §4.2 D2 — `PipelineStage.ordem` composta | Task 2, Steps 4-5 | Task 7, Step 2 |
| §4.2.1 — auditoria das nove consultas de `ordem` | Task 2, tabela do cabeçalho + Steps 7-8 | Task 2, Step 10 |
| §4.2.4 — o defeito vivo de `criarEtapa` | Task 2, Step 2 (2º caso) e Task 6 (caso 4) | Task 6, Step 2 |
| §4.3 D3 — `Conversation.waId` composta, `connectionId` fora | Task 3, Steps 4-5 | Task 7, Step 2 |
| §4.3.5 — o laço de 500 fecha | Task 3, Step 7 (comentário) e Task 6 (caso 5) | Task 6, Step 2 |
| §4.4 D4 — `WhatsappMessage.idExterno` composta com `companyId` | Task 4, Steps 4-5 | Task 7, Step 2 |
| §4.4 — a dedup não afrouxa | Task 4, Step 2 (2ª metade) e Task 6 (caso 7) | Task 6, Step 2 |
| §6 — guarda de migrações não acionada, `PERDOADAS` intacta | Tasks 1-4, Steps de aplicação | Task 7, Step 4 |
| §7.3 — o e2e do telefone por worker NÃO volta atrás | Task 1, Step 12 | Task 7, Step 3 |
| §7.4 — prosa de `escopo.ts` e a recusa de `findUnique` | Task 5, Steps 1 e 3 | Task 5, Step 4 |
| §8 — a prova de coexistência | Task 6 inteira | Task 6, Steps 2 e 3 |
| §12 — critérios de aceite (7 itens) | Task 7, Steps 1-6 | — |
| §13 — NÃO VERIFICADO | Task 7, Step 7 item 5 | — |

**Itens do spec deliberadamente NÃO cobertos por tarefa nenhuma**, e é correto
que não sejam: §9 inteira (o que o ciclo não faz) — `connectionId NOT NULL`,
`connectionId` da última mensagem, derrubar os `@@index([companyId])`, escopar
`seed.ts:139`, mexer em `webhookTokenHash`. Cada um está declarado como ⚠️ e
reaparece no relatório da Task 7.

### 2. Varredura de placeholders

Nenhum `TODO`, `FIXME`, `...`, `<preencher>` ou `// implementar` sobrevive nos
blocos de código deste plano. Os únicos marcadores de substituição humana são:

- Task 7, Step 8: `<descrever o que a verificacao final corrigiu…>` — dentro de
  uma mensagem de commit que só existe se houver correção, e o próprio passo
  manda dizer "não há o que commitar" no caso contrário.
- Task 1, Step 11: a instrução diz "a frase exata está por volta da linha 66" em
  `seed-demo.ts` em vez de citar o texto. É deliberado: aquele bloco descreve a
  convenção de famílias de telefone de vários arquivos e o comprimento dele torna
  a citação literal mais frágil que a localização. A instrução diz o que mudar
  ("só a razão") e o que preservar ("a convenção").

Os quatro comandos `npx tsx -e` são longos e usam escape de `$` e de aspas para
sobreviver ao shell. Se algum falhar por escape no ambiente real, o passo é
**equivalente** a rodar o mesmo SQL por qualquer caminho — o que importa é a
saída esperada, que está escrita em cada passo.

### 3. Consistência de tipos e nomes

- **Nomes de índice.** `Contact_companyId_telefone_key`,
  `PipelineStage_companyId_ordem_key`, `Conversation_companyId_waId_key`,
  `WhatsappMessage_companyId_idExterno_key` — o padrão `<Model>_<campos>_key` que
  o Prisma gera para `@@unique`. Os mesmos nomes aparecem na migração, no `throw`
  de `dedupe.ts`, nos comentários e no Step 2 da Task 7. Conferidos um a um.
- **Nomes de chave composta no `where`.** `companyId_telefone`,
  `companyId_ordem`, `companyId_waId`, `companyId_idExterno` — o padrão que o
  Prisma gera. Usados em `prisma/seed.ts` (Task 1) e nos casos de recusa da Task
  5. Coerentes.
- **`ClienteDaEmpresa`** é o tipo já usado por `erroDeTelefoneOcupado` e por
  `primeiraEtapaDoFunil`; a Task 1 não o altera.
- **`ContextoDeIngestao`** é `{ companyId: string; connectionId: string }` — a
  Task 6 monta exatamente isso em `contextoDe()`.
- **`ResultadoIngestao`** tem `companyId`, `connectionId`, `conversationId`,
  `bufferSeq`, `duplicada` — a Task 6 só lê campos dessa lista.
- **`EventoWhatsapp`** tem seis campos obrigatórios (`idExterno`, `waId`,
  `nomeExibicao: string | null`, `tipo`, `texto: string | null`,
  `timestamp: Date`), lidos em 2026-08-20 de
  `src/modules/whatsapp/gateway/tipos.ts`. `eventoCompartilhado()` monta os seis;
  a Task 6, Step 1, manda reconferir antes de rodar, porque o teste é o único
  lugar deste plano que constrói esse tipo do zero.
- **`EscopoDeEmpresaError`** e os helpers `blocoDoModelo` / `escopadoPara` já
  existem em `escopo-empresa.test.ts`; a Task 5 não importa nem declara nada
  novo.
- **Constantes de teste.** `TELEFONE_COMPARTILHADO = "11955550001"` usa a família
  "11955", checada contra as sete famílias já reservadas nos comentários de
  `contact-isolamento`, `pipeline-isolamento` e `whatsapp-isolamento`.
  `ORDEM_COMPARTILHADA = 9901` fica acima de todas as faixas já usadas
  (92xx-96xx, 97xx, 98xx).
- **`MODELOS_DE_TENANT` = 13** em todas as tarefas; nenhuma mexe nele.

### 4. Ordem — nenhuma tarefa usa algo que uma posterior cria

- **Task 1** só depende do estado de `60607fa`. Cria a branch.
- **Task 2** depende da branch (Task 1, Step 1). Não usa nada de Contact.
- **Task 3** depende da branch. Não usa nada de Task 1 nem 2.
- **Task 4** depende da Task 3 **só por conveniência de arquivo**: o `describe`
  que ela estende em `whatsapp-isolamento.test.ts` nasce na Task 3. Se a Task 3
  não tiver rodado, a Task 4 cria o `describe` ela mesma — a instrução do Step 2
  diz "dentro do `describe` criado na Tarefa 3", então a ordem é obrigatória e
  está declarada.
- **Task 5** depende das quatro compostas estarem no schema (Tasks 1-4). Declarado
  no Step 2 ("os dois casos novos passam de primeira").
- **Task 6** depende das quatro migrações aplicadas (Tasks 1-4). Não depende da
  Task 5.
- **Task 7** depende de tudo.

Nenhuma tarefa referencia arquivo, símbolo ou migração que uma tarefa **posterior**
cria. Conferido percorrendo os blocos **Interfaces** na ordem: cada `Consumes` só
cita coisa que já existia em `60607fa` ou que foi produzida por uma tarefa
anterior.

### 5. Tarefas que dependem de ação do dono

**ZERO.** As sete tarefas trazem `DEPENDE DE AÇÃO DO DONO: não`. O que existe
depois do plano, e não durante:

1. A **auditoria de segurança** (Fase 1 da skill `auditoria-seguranca`), exigida
   por `AGENTS.md` antes de qualquer merge ou PR — o relatório é entregue e a
   execução **para** até o dono aprovar. A Task 7, Step 7, item 6, obriga a dizer
   isso.
2. A rotação da senha do admin — 🔍 NV6 do Ciclo 2a, herdada, e este plano não a
   piora porque não roda `npm test`.
3. As decisões que o ciclo **declara e não toma**: ⚠️ D3-a, D2-a e D5.

### 6. Riscos de execução, e o que os contém

| Risco | Contenção |
| --- | --- |
| `prisma migrate deploy` pendurado sem imprimir nada | Constraint global + o aviso em cada Step de aplicação: é `DATABASE_URL`/`DIRECT_URL` trocadas, **pare e reporte**, não edite `.env` |
| Duplicata no banco impedindo `CREATE UNIQUE INDEX` | Um `GROUP BY … HAVING count(*) > 1` **antes** de cada migração (Tasks 1, 2, 3, 4 — Step 1 ou 2). Esperado `[]`; qualquer outra coisa **para** |
| O Step 3 da Task 6 deixar o banco com o índice errado | O passo manda repor imediatamente e conferir `migrate status`; se a reposição falhar, **PARE E REPORTE** e nenhuma tarefa seguinte roda |
| Duas execuções de `vitest` ao mesmo tempo envenenarem o banco | Constraint global + "um comando por vez, em série" repetido em todo Step que roda mais de um arquivo |
| Um teste existente quebrar por a mudança alcançar mais do que o desenho previu | Task 1, Step 13 e Task 2, Step 10 mandam **parar e reportar** antes de editar teste que "não devia precisar de edição" |
| Alguém acrescentar a composta sem tirar a global | Task 5, Step 1, segundo bloco do caso ("a metade que impede a volta") |
