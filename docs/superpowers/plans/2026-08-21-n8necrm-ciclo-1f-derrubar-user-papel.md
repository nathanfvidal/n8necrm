# n8necrm — Ciclo 1f (Derrubar `User.papel`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A coluna `User.papel` sai do banco e do schema. É a última dívida
aberta do Ciclo 1a (⚠️ R4 da auditoria `2026-08-19-ciclo-1a-tenancy.md:561`) e a
única fonte de verdade duplicada sobre AUTORIZAÇÃO que sobrou no projeto:
`Membership.papel` decide, `User.papel` é espelho escrito por dual-write.

**Architecture:** Expansão e contração, nesta ordem — `DROP NOT NULL` primeiro,
limpeza dos 53 pontos depois, `DROP COLUMN` por último. No meio, uma trava
TEXTUAL que não passa pelo compilador, porque o compilador tem um buraco medido
e nomeado (§ "Por que esta ordem", abaixo). Nenhuma coluna nova, nenhum
backfill, nenhuma política de RLS, nenhuma assinatura de função de produção
alterada. O que muda em produção são duas linhas (`src/core/users/service.ts:264`
e `:370`, o dual-write) e três no seed; todo o resto é teste.

**Tech Stack:** Next.js 16.3 (App Router), React 19.2, Prisma 7.9 +
`@prisma/adapter-pg`, Postgres 17.6 (Supabase `uzumzfxjcxrbxaucvfsr`), Node
22.21, Zod 4, Tailwind 4, shadcn, Vitest 4, Playwright 1.62.

**Medição (faz as vezes de spec):** `.superpowers/sdd/medicao-user-papel.md`,
feita em 2026-08-21 sobre `255076a` com worktree descartável, `prisma generate`
e `tsc` contra linha de base comprovadamente zerada. **Não existe spec separado
para este ciclo, de propósito: a medição já é o desenho.** Toda contagem deste
plano (11 leitores, 42 escritores, 32 arquivos, 62 erros de `tsc`) vem de lá e
cita a seção.

---

## Por que esta ordem, e não a que já falhou

Derrubar esta coluna foi tentado **três vezes no Ciclo 1a**, e as três falharam
pelo mesmo mecanismo: quem media encontrava um grupo de leitores, concluía que
aquele era o alcance total, e um grupo novo aparecia depois do ponto sem volta.
Os três grupos foram, em ordem: o JWT/sessão (`core/auth/credenciais.ts`
devolvia `role: user.papel`), a gestão de equipe (`core/users/service.ts` e
`queries.ts`, 26 referências) e o alerta de auditoria (`core/audit/alerta.ts`,
produção). O terceiro apareceu **depois** de a migração `20260819130000_derruba_user_papel`
já ter sido aplicada, e a saída foi uma segunda migração de restauração
(`20260819140000_restaura_user_papel_temporariamente`) que hoje é uma cicatriz
permanente: uma entrada em `PERDOADAS` de `tests/unit/migracoes-seguras.test.ts`
que não sai mais do histórico.

### Decisão 1 — o `DROP COLUMN` vem por ÚLTIMO

A tentativa que falhou fez o `DROP` cedo, e o client do Prisma regenerou sem
`papel` com a coluna **já fora do banco**: 26 lugares pararam de compilar de uma
vez, e voltar exigia SQL novo, não `git checkout`.

O argumento a favor do `DROP` cedo é real e precisa ser respondido, não ignorado:
com a coluna fora, o `tsc` NOMEIA cada ponto restante, e isso é um inventário que
nenhum grep produz. **A resposta é que esse experimento já foi feito, e o
resultado está no bolso.** A medição de 2026-08-21 rodou exatamente ele — worktree
descartável fora do repositório, `node_modules` por junção NTFS, linha de base
`npx tsc --noEmit` → EXIT=0 com zero erros ANTES de qualquer edição, campo
removido do schema, `prisma generate`, `tsc` de novo → EXIT=2 com 62 erros
(`medicao:151-167`). A linha de base zerada é o que torna cada um dos 62 erros
atribuível ao campo e a nada mais. O repositório nunca foi editado, nenhuma
migração rodou, o banco não foi tocado.

Ou seja: o valor de descoberta do "derrubar cedo" **já foi extraído, a custo
zero para a árvore**. Repetir a manobra dentro do repositório compra o mesmo
inventário e paga o mesmo preço da tentativa que falhou.

### Decisão 2 — mas limpar não é possível sem um passo de EXPANSÃO antes

Aqui está o detalhe que obriga a ordem a ter três tempos e não dois.

`User.papel` é `Role` **`NOT NULL` sem `DEFAULT`** — a migração `20260819140000`
a restaurou assim, e a entrada dela em `PERDOADAS` (`migracoes-seguras.test.ts:86-95`)
explica por que um `DEFAULT` seria pior que a janela que evitaria. Consequência
direta: tirar `papel` de `tx.user.create({ data: { ... } })` **antes** de a coluna
aceitar nulo produz `23502` em tempo de execução — que é literalmente o incidente
que `migracoes-seguras.test.ts` existe para prevenir, chegando pela porta oposta.

Por isso a ordem é:

| Tempo | O quê | Por quê |
| --- | --- | --- |
| **Expansão** (Task 2) | `ALTER COLUMN "papel" DROP NOT NULL` + `papel Role?` no schema | Torna legal parar de escrever. Nada mais muda; o `tsc` continua em zero e todo leitor e escritor existente continua funcionando |
| **Limpeza** (Tasks 3-10) | Os 53 pontos, em lotes pequenos | Cada tarefa deixa a árvore compilando e a suíte verde. Nenhum commit intermediário quebrado |
| **Contração** (Task 11) | `ALTER TABLE "User" DROP COLUMN "papel"` | Só chega aqui com a trava textual em zero e o `tsc` provado limpo |

### Decisão 3 — o passo que NÃO depende do `tsc`

A medição achou o buraco do próprio instrumento, e é isto que a distingue das
três tentativas anteriores:

> **`tests/unit/audit-isolamento.test.ts:163` escreve `papel` e PASSA no `tsc`.**
> ```ts
> await prisma.user.createMany({
>   data: [USUARIO_DUPLO, ADMIN_A, ADMIN_B].map((id) => ({
>     id, nome: `Pessoa ${id}`, email: ..., senhaHash: SENHA_FALSA,
>     papel: "ADMIN" as const,          // ← nenhum erro de tipo
>   })),
> });
> ```
> A checagem de propriedade excedente do TypeScript só vale para objeto literal
> **fresco** atribuído direto ao parâmetro. Passando por `.map()`, o tipo do
> elemento é inferido do retorno do callback e o excesso some
> (`medicao:186-200`).

Um plano que confiasse só nos 62 erros do compilador repetiria as três falhas
com uma ferramenta melhor. **O passo que não depende do `tsc` é a Task 3**: um
teste que lê o repositório como TEXTO — `tests/unit/user-papel-nao-volta.test.ts`
— e reprova a palavra `papel` dentro de qualquer chamada a `prisma.user.*`,
mascarando as sub-árvores `memberships` (que escrevem a coluna certa). Ele nasce
na Task 3 com uma lista explícita `EM_CONVERSAO` de 29 arquivos, e cada tarefa de
limpeza **tira o próprio arquivo da lista PRIMEIRO** (fica vermelho) e só então
conserta (fica verde). É o RED→GREEN de verdade destas tarefas, e é também a
trava permanente pedida pela Decisão 4.

Um segundo passo independente do compilador fecha o que nem o texto alcança:
Task 11, Step 8 roda **todos** os arquivos afetados contra o Postgres real com a
coluna já fora. Só o runtime prova que o Prisma não recebe `Unknown argument 'papel'`.

### Decisão 4 — a trava que impede a coluna de voltar

Precedente que morde, e o plano copia a forma: a trava de deriva de
`MODELOS_DE_TENANT` (`tests/unit/escopo-empresa.test.ts:1138-1165`) lê
`prisma/schema.prisma` como texto, compara com o `Set` do código e falha
**nomeando o modelo** que divergiu. `tests/unit/catraca-prisma-cru.test.ts:146-164`
usa o mesmo leitor de schema pelo mesmo motivo.

`tests/unit/user-papel-nao-volta.test.ts` tem, ao final do ciclo, três asserções:

1. **Schema** — `model User` não tem campo `papel` (nasce na Task 11, RED, e o
   `DROP` a torna verde).
2. **Texto** — nenhum `papel` dentro de chamada a `prisma.user.*` em todo o
   repositório (nasce na Task 3, com `EM_CONVERSAO` de 29 arquivos, esvaziada até
   a Task 10).
3. **Prova de que morde** — o analisador aplicado ao trecho EXATO de
   `audit-isolamento.test.ts:157-165` de antes do conserto precisa acusar, e o
   trecho de `session.test.ts:66-75` (que escreve `papel` no `Membership`
   aninhado, e deve continuar podendo) precisa NÃO acusar. Sem estas duas, um
   erro de regex deixaria a lista vazia para sempre e o teste verde sem ter lido
   nada — o "teste que não exercita" que `consultas-estreitas.test.ts:93-98` e
   `migracoes-seguras.test.ts:188-198` já documentam neste projeto.

---

## Global Constraints

- **Idioma do código é português.** Comentário explica **por que**, com evidência
  e citando a fonte. Nunca "o quê".
- **Antes de qualquer trabalho que toque o banco, invocar as três skills juntas:**
  `supabase`, `supabase-postgres-best-practices`, `auditing-supabase-security`.
  Vale para as Tasks 2 e 11.
- **Este projeto usa migrations do Prisma, não o CLI do Supabase.** As migrations
  são arquivos SQL escritos à mão em `prisma/migrations/`, aplicados por
  `npx prisma migrate deploy`. `supabase db pull`, schema declarativo e
  `supabase migration new` **não se aplicam**.
- **`DATABASE_URL` na porta 6543, `DIRECT_URL` na 5432.** Trocar as duas faz
  `prisma migrate` ficar **PENDURADO sem imprimir nada** — parece lentidão, é
  falha. Se um comando de migração passar de dois minutos sem saída, **pare e
  reporte**; não mexa no `.env`.
- **Nunca ler nem imprimir o `.env`.** Nenhuma tarefa deste plano precisa dele.
- **Não afrouxe `tests/unit/migracoes-seguras.test.ts`.** Ele tem hoje **2**
  entradas em `PERDOADAS` e o esperado é continuar com 2. As duas migrações deste
  plano (`DROP NOT NULL` e `DROP COLUMN`) **não deveriam** acioná-lo — o
  analisador só olha `ADD COLUMN ... NOT NULL` e `ALTER COLUMN ... SET NOT NULL`
  (`migracoes-seguras.test.ts:126-151`). **A Task 1 CONFIRMA isso com um caso de
  teste, em vez de presumir.** Se alguma tarefa se vir precisando de entrada nova
  em `PERDOADAS`, o desenho está errado: **pare e reporte**.
- **Nenhuma política RLS e nenhum grant neste ciclo.** `ALTER COLUMN` e
  `DROP COLUMN` não tocam `relrowsecurity` nem grants, então
  `tests/e2e/banco-blindado.spec.ts` não muda. Se uma tarefa parecer precisar de
  política, ela saiu do escopo — **pare e reporte**.
- **`MODELOS_DE_TENANT` continua com 13.** `User` não tem `companyId` e nunca
  teve; nenhum modelo nasce ou morre aqui. A trava de deriva
  (`escopo-empresa.test.ts:1138`) e o leitor de schema de
  `catraca-prisma-cru.test.ts:146-164` casam `^\s*companyId\s+\w+` — apagar a
  linha `papel Role` **não** casa com isso. Se `MODELOS_DE_TENANT.size` mudar em
  alguma tarefa, algo saiu errado — **pare e reporte**.
- **A catraca `tests/unit/catraca-prisma-cru.test.ts` está em ZERO**
  (`LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS = 0`, linha 108) e **só permite
  diminuir**. Nenhum arquivo de `src/` pode passar a importar `@/lib/prisma`.
  `prisma/seed*.ts`, `tests/` e o novo helper de teste estão fora do alcance dela
  por decisão escrita (`catraca-prisma-cru.test.ts:71`) — as mudanças de seed e de
  teste deste plano são legítimas.
- **Nunca rodar `npm test` inteiro em nenhuma tarefa.** Ele executa o seed contra
  o banco de desenvolvimento real e **reescreve o `senhaHash` de
  `admin@exemplo.com` e `vendedor@exemplo.com`** (⚠️ R1 do Ciclo 1a, 🔍 NV6 do
  Ciclo 2a). Rodar sempre os arquivos focados, nomeados em cada Step.
- **Nada de `vitest` em paralelo com outra execução de `vitest`.** O banco de
  teste não é separado do de desenvolvimento; duas execuções o envenenam. Um
  comando por vez, em série. (Dentro de UMA execução é seguro: `vitest.config.ts`
  tem `fileParallelism: false`.)
- **`companyId` viaja como parâmetro explícito.** `AsyncLocalStorage` e estado
  global PROIBIDOS.
- **Nunca `prisma.company.findFirst()`** como origem de empresa em `src/`.
- **Toda frase que afirme universal** — "todo", "sempre", "nenhum", "qualquer",
  "só" — precisa do caso de teste que a exercita, ou é reescrita.
- **A prosa que a mudança tornar falsa é reescrita junto** (Task 12). Nos ciclos
  1c e 1e, doze e depois oito blocos de documentação afirmavam no presente um
  estado que deixara de existir. A Task 12 tem a lista fechada, vinda de
  `medicao:244-280`.
- **Provar, não presumir.** O que este ambiente não provar sai como
  **🔍 NÃO VERIFICADO**, com o comando que um humano roda.
- Toda mensagem de commit termina com:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **Branch de trabalho: `ciclo-1f-derrubar-user-papel`**, criada a partir de
  `ciclo-1a-tenancy` (HEAD `255076a`).

## Linha de base medida em 2026-08-21 — conferir se mudou antes de fechar

| Medida | Valor | Como |
| --- | --- | --- |
| HEAD de partida | `255076a`, árvore limpa | `git rev-parse HEAD`, `git status --short` |
| `npx tsc --noEmit` | **zero erros** | `medicao:159` |
| `tsc` com o campo fora do schema | **62 erros** (10 leitura, 52 escrita/tipo) | `medicao:162` |
| Leitores de `User.papel` | **11**, em 8 arquivos, **todos em `tests/unit/`** | `medicao:23-35` |
| Leitores em `src/` | **ZERO** | `medicao:8-13`, `medicao:126-136` |
| Escritores de `User.papel` | **42**, em 23 arquivos | `medicao:71-105` |
| Escritores em `src/` | **2** (`core/users/service.ts:264` e `:370`) | `medicao:75-78` |
| Superfície total do DROP | **32 arquivos** (não os ~80 do schema) | `medicao:113-116` |
| Arquivos que o analisador da Task 3 alcança | **29** (32 menos os 3 que usam dublê sem `prisma.user.*`) | derivado — a Task 3, Step 3, CONFERE |
| Migrações aplicadas | **23**, a última `20260820250000_mensagem_idexterno_por_empresa` | `ls prisma/migrations/` |
| Entradas em `PERDOADAS` | **2** | `tests/unit/migracoes-seguras.test.ts:38-96` |
| Catraca de prisma cru | `LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS = 0` | `catraca-prisma-cru.test.ts:108` |
| Modelos de tenant | **13** | `src/core/tenancy/escopo.ts`, `MODELOS_DE_TENANT` |
| `Bots/` menciona `papel` ou `"User"` | **NÃO** — `grep -rl` nos dois padrões voltou vazio em 2026-08-21 | `grep -rl 'papel' Bots/` e `grep -rlE '"User"' Bots/` |

## Ações do dono que travam a execução

**NENHUMA.** Nenhuma tarefa deste plano fica bloqueada por ação do dono.

Herdada, não deste ciclo: 🔍 NV6 do Ciclo 2a — a senha de `admin@exemplo.com` e
`vendedor@exemplo.com` continua com o literal versionado, à espera de rotação.
**Este plano nunca roda `npm test` inteiro**, e portanto não roda `prisma/seed.ts`
por conta própria — exceto na Task 7, Step 6, que roda `tests/unit/seed.test.ts`
(o único arquivo que chama `seed()` e é obrigatório para provar que o seed parou
de gravar a coluna). **Aviso ao dono:** essa execução REESCREVE as duas senhas
para o valor de `SEED_PASSWORD` ou para `senha123`. Se as senhas dessas duas
contas tiverem sido rotacionadas, **rotacione de novo depois da Task 7** — o
passo repete este aviso na hora.

---

### Task 1: Provar que a guarda de migrações NÃO morde `DROP COLUMN`

**DEPENDE DE AÇÃO DO DONO:** não.

Esta tarefa não muda comportamento nenhum. Ela existe porque o plano não tem
licença para presumir: `tests/unit/migracoes-seguras.test.ts` é a guarda contra
`NOT NULL` em tabela viva, escrita a partir de um incidente real, e as duas
migrações deste ciclo mexem em nulidade de coluna numa tabela viva. Ler o
analisador e concluir "não vai acionar" é exatamente o tipo de presunção que a
skill proíbe. Aqui isso vira **caso de teste permanente**.

**Files:**
- Modify: `tests/unit/migracoes-seguras.test.ts`

**Interfaces:**
- Consumes: `analisar(migracao: string, sqlBruto: string): Violacao[]` — já
  exportada? **NÃO**: hoje ela é uma função de módulo, não exportada
  (`migracoes-seguras.test.ts:113`). Os casos novos ficam no MESMO arquivo, então
  nada precisa ser exportado.
- Produces: dois casos novos dentro do `describe("migrações")` existente. Nenhum
  símbolo novo, nenhuma entrada nova em `PERDOADAS`.

- [ ] **Step 1: Criar a branch e confirmar o ponto de partida**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git checkout -b ciclo-1f-derrubar-user-papel
git rev-parse --short HEAD
git status --short
npx prisma migrate status
```

Esperado: `255076a`, `git status` VAZIO, e `23 migrations found` com
`Database schema is up to date!`. Se aparecer migração pendente ou árvore suja,
**pare e reporte**. Cole a saída.

- [ ] **Step 2: Escrever os dois casos (RED por ausência, não por falha)**

Estes casos passam de primeira se o analisador for o que a leitura diz que é —
e é justamente essa afirmação que precisa virar prova executada. Se algum deles
**falhar**, o desenho deste ciclo está errado e a Task 2 não pode rodar: **pare e
reporte**.

Em `tests/unit/migracoes-seguras.test.ts`, **imediatamente antes** do caso
`it("prosa em comentário não conta como SQL", ...)` (linha 218), inserir:

```ts
  it("DROP COLUMN não é violação — é o oposto do que a regra vigia", () => {
    // O Ciclo 1f derruba `User.papel` em duas migrações, as duas mexendo na
    // nulidade de uma coluna de uma tabela VIVA — exatamente o vizinho do
    // incidente que originou esta regra. O plano do ciclo não tem licença para
    // LER o analisador e concluir que ele não morde; a conclusão vira este caso.
    //
    // Por que não morde, e por que isso é correto e não uma brecha: a regra
    // protege o INSERT do código antigo contra uma coluna que passou a exigir
    // valor. `DROP COLUMN` remove a exigência em vez de criá-la — o INSERT
    // antigo que informa a coluna quebra por outro motivo (coluna inexistente),
    // e é por isso que o Ciclo 1f limpa TODOS os escritores antes de derrubar,
    // em vez de confiar nesta guarda para pegá-los.
    const doCiclo1f = `
      ALTER TABLE "User" ALTER COLUMN "papel" DROP NOT NULL;
      ALTER TABLE "User" DROP COLUMN "papel";
    `;
    expect(analisar("teste", doCiclo1f)).toEqual([]);
  });

  it("SET NOT NULL continua sendo violação mesmo colado num DROP NOT NULL", () => {
    // A metade que impede o caso acima de virar brecha: se alguém escrever uma
    // migração que afrouxa uma coluna e endurece outra no mesmo arquivo, a
    // segunda ainda precisa do DEFAULT. Sem esta asserção, "DROP COLUMN não é
    // violação" poderia ser lido como "migração que mexe em nulidade passa".
    const misturado = `
      ALTER TABLE "User" ALTER COLUMN "papel" DROP NOT NULL;
      ALTER TABLE "User" ADD COLUMN "apelido" TEXT;
      UPDATE "User" SET "apelido" = nome;
      ALTER TABLE "User" ALTER COLUMN "apelido" SET NOT NULL;
    `;
    expect(analisar("teste", misturado)).toHaveLength(1);
  });
```

- [ ] **Step 3: Rodar**

```bash
npx vitest run tests/unit/migracoes-seguras.test.ts
```

Esperado: **7 casos, todos passando** (os 5 que já existiam mais os 2 novos).
Cole a saída. Se o primeiro caso novo falhar, o `DROP COLUMN` ACIONA a guarda e
todo o desenho do ciclo precisa ser revisto — **pare e reporte**, não acrescente
entrada em `PERDOADAS`.

- [ ] **Step 4: Confirmar que `PERDOADAS` continua com 2 entradas**

```bash
grep -c '^\s*"[0-9]\{14\}_' tests/unit/migracoes-seguras.test.ts
```

Esperado: `2`. Cole a saída.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/migracoes-seguras.test.ts
git commit -m "$(cat <<'EOF'
test(migracoes): prova que DROP COLUMN nao aciona a guarda de NOT NULL

O Ciclo 1f mexe na nulidade de User.papel duas vezes numa tabela viva, que e
o vizinho exato do incidente que originou a regra. Ler o analisador e concluir
que ele nao morde e presuncao; o segundo caso trava a leitura oposta, de que
migracao que mexe em nulidade passaria livre.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Expansão — `papel` passa a aceitar nulo

**DEPENDE DE AÇÃO DO DONO:** não.

O passo que torna a limpeza possível. Enquanto `papel` for `NOT NULL` sem
`DEFAULT`, tirar a coluna de qualquer `user.create` produz `23502` em runtime —
o incidente de `migracoes-seguras.test.ts` chegando pela porta oposta. Depois
desta tarefa, parar de escrever é legal, e **nada mais muda**: todo leitor e todo
escritor existente continua funcionando, e o `tsc` continua em zero.

**Files:**
- Create: `prisma/migrations/20260821120000_user_papel_aceita_nulo/migration.sql`
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Consumes: `model User` (`prisma/schema.prisma:84-115`), campo `papel Role`
  (linha 104).
- Produces:
  - Coluna `"User"."papel"` NULLABLE no Postgres.
  - `papel Role?` no schema → no client gerado, `User.papel: Role | null`,
    `UserCreateInput.papel?: Role | null`, `UserWhereInput.papel?: EnumRoleNullableFilter | Role | null`.
  - **Nenhuma quebra de tipo esperada**: leitura `where: { papel: "ADMIN" }`
    continua válida, escrita `data: { papel: "ADMIN" }` continua válida, e
    `usuarioFake(): User` com `papel: "VENDEDOR"` continua atribuível. O Step 5
    PROVA isso.

- [ ] **Step 1: Provar que toda linha viva tem papel no vínculo antes de afrouxar**

Não é obrigatório para o `DROP NOT NULL` (afrouxar nunca falha por dado), mas é
a última janela barata para descobrir divergência entre as duas colunas enquanto
as duas ainda existem — e divergência entre elas é o risco que a auditoria do
Ciclo 1a registrou como ⚠️ R4.

```bash
npx tsx --conditions=react-server -e "import 'dotenv/config'; import { PrismaClient } from '@prisma/client'; import { PrismaPg } from '@prisma/adapter-pg'; const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) }); const r = await p.\$queryRaw\`SELECT u.id, u.papel AS \"userPapel\", m.papel AS \"vinculoPapel\" FROM \"User\" u LEFT JOIN \"Membership\" m ON m.\"userId\" = u.id WHERE m.id IS NULL OR m.papel <> u.papel\`; console.log(JSON.stringify(r)); await p.\$disconnect();"
```

Esperado: `[]`. Qualquer linha devolvida significa que a coluna espelho e o
vínculo divergiram, ou que existe `User` sem `Membership` — nos dois casos
**pare e reporte** com a saída; não invente critério de reconciliação.

- [ ] **Step 2: Escrever a migração**

Criar `prisma/migrations/20260821120000_user_papel_aceita_nulo/migration.sql`:

```sql
-- Ciclo 1f, Task 2: "User"."papel" passa a aceitar NULO.
--
-- Metade da EXPANSÃO de um expand/contract. Sozinha, esta migração não muda
-- comportamento nenhum: nenhuma linha vira nula, nenhum leitor perde valor,
-- nenhum escritor precisa mudar. O que ela muda é o que passa a ser LEGAL.
--
-- Por que ela é obrigatória, e por que vem antes e não junto do DROP:
-- a coluna foi restaurada por 20260819140000_restaura_user_papel_temporariamente
-- como NOT NULL SEM DEFAULT (a entrada dela em PERDOADAS, em
-- tests/unit/migracoes-seguras.test.ts, explica por que um DEFAULT ali seria
-- pior que a janela que evitaria: atribuiria papel de AUTORIZAÇÃO em silêncio a
-- todo INSERT que esquecesse a coluna). Enquanto for NOT NULL sem DEFAULT,
-- tirar `papel` de qualquer `user.create` produz 23502 em tempo de execução --
-- que é exatamente o incidente de 20260813200000_contato_cadastro_completo,
-- chegando pela porta oposta. Com a coluna nula-aceita, os 42 escritores podem
-- sair um lote por vez, cada commit com a árvore compilando e a suíte verde.
--
-- Por que não derrubar de uma vez aqui: já foi tentado. O Ciclo 1a aplicou
-- 20260819130000_derruba_user_papel e teve de revertê-lo com uma segunda
-- migração no mesmo dia, porque o typecheck revelou um grupo de leitores DEPOIS
-- de a coluna já estar fora do banco. A medição de 2026-08-21
-- (.superpowers/sdd/medicao-user-papel.md) já rodou esse experimento num
-- worktree DESCARTÁVEL, com linha de base de `tsc` comprovadamente zerada: o
-- inventário dos 62 erros está no plano deste ciclo, e não custou nenhuma
-- cicatriz no histórico de migrações.
--
-- Esta migração NÃO aciona tests/unit/migracoes-seguras.test.ts: o analisador
-- de lá vigia `ADD COLUMN ... NOT NULL` e `ALTER COLUMN ... SET NOT NULL`, e
-- `DROP NOT NULL` é o oposto dos dois. Isso não é leitura de código, é caso de
-- teste executado -- ver "DROP COLUMN não é violação" naquele arquivo.

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "papel" DROP NOT NULL;
```

- [ ] **Step 3: Aplicar**

```bash
npx prisma migrate deploy
npx prisma migrate status
```

Esperado: `1 migration found` aplicada com sucesso e depois
`24 migrations found` / `Database schema is up to date!`. **Se o comando passar
de dois minutos sem imprimir nada, PARE E REPORTE** — é `DATABASE_URL`/`DIRECT_URL`
trocadas (6543 vs 5432), não lentidão. Não edite o `.env`. Cole a saída.

- [ ] **Step 4: Trocar `Role` por `Role?` no schema**

Em `prisma/schema.prisma`, na linha 104, trocar:

```prisma
  papel              Role
```

por:

```prisma
  papel              Role?
```

E, no bloco `///` logo acima (linhas 89-103), **substituir o parágrafo que
começa em `/// Por que ela ainda existe:`** (linhas 96-101) por:

```prisma
  /// Por que ela ainda existe, e por quanto tempo: o Ciclo 1f está
  /// derrubando-a. Esta linha é o meio do caminho — `Role?` em vez de `Role`
  /// é a metade EXPANSÃO de um expand/contract
  /// (`20260821120000_user_papel_aceita_nulo`), e existe para que os 42
  /// escritores possam sair um lote por vez sem `23502`. A medição que fechou
  /// o inventário está em `.superpowers/sdd/medicao-user-papel.md`: 11
  /// leitores e 42 escritores, em 32 arquivos, NENHUM leitor em `src/`. O
  /// número "~80 arquivos" que este comentário trazia antes contava prosa e
  /// `Membership.papel` junto.
```

Não mexer no resto do bloco: o parágrafo de abertura ("Espelho depreciado…") e
o fecho ("Código novo lê o papel de `Membership`, nunca daqui.") continuam
verdadeiros e saem inteiros na Task 11.

- [ ] **Step 5: Regenerar o client e provar que o `tsc` não se mexeu**

```bash
npx prisma generate
rm -f tsconfig.tsbuildinfo
npm run typecheck
```

Esperado: **zero erros**. Esta é a asserção que justifica a tarefa existir
separada: se `Role?` quebrar alguma coisa, quebrou um consumidor que exige a
coluna NÃO NULA, e esse consumidor é um leitor que a medição não viu.
**Pare e reporte com a lista de erros** — não conserte por conta própria; é
informação sobre o inventário estar incompleto, e o plano inteiro precisa ser
revisto antes de seguir.

Cole a saída. `rm -f tsconfig.tsbuildinfo` não é enfeite: sem ele o `tsc`
incremental reaproveita o resultado anterior e imprime "No errors found" sem ter
reconferido nada contra o client novo (`medicao:162` documenta essa pegadinha).

- [ ] **Step 6: Rodar os arquivos que mais dependem da coluna, para confirmar runtime intacto**

```bash
npx vitest run tests/unit/users-service.test.ts tests/unit/session.test.ts tests/unit/audit-isolamento.test.ts
```

Esperado: tudo verde. Um comando só, em série — nada de `vitest` em paralelo com
outra execução. Cole a saída.

- [ ] **Step 7: Commit**

```bash
git add prisma/migrations/20260821120000_user_papel_aceita_nulo prisma/schema.prisma
git commit -m "$(cat <<'EOF'
feat(tenancy): User.papel passa a aceitar nulo, a expansao antes da contracao

A coluna voltou como NOT NULL sem DEFAULT em 20260819140000, e enquanto for
assim tirar `papel` de qualquer user.create produz 23502 em runtime -- o
incidente de 20260813200000 chegando pela porta oposta. Afrouxar primeiro e o
que deixa os 42 escritores sairem um lote por vez, com a arvore compilando em
todo commit intermediario.

Derrubar de uma vez ja foi tentado e revertido no mesmo dia (20260819130000 e
20260819140000): o typecheck revelou leitores DEPOIS de a coluna sair do banco.
A medicao de 2026-08-21 refez esse experimento num worktree descartavel, entao
o inventario dos 62 erros esta no plano sem custar cicatriz no historico.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: A trava que não depende do `tsc`

**DEPENDE DE AÇÃO DO DONO:** não.

Esta é a tarefa que responde ao buraco do instrumento. O `tsc` deixa passar
`papel` escrito através de `.map()` (`medicao:186-207`), e foi um caso desses
que a medição achou — a razão principal para acreditar que o inventário está
fechado desta vez. A trava lê o repositório como TEXTO, não como programa.

Ela nasce **verde**, com uma lista explícita `EM_CONVERSAO` de 29 arquivos. Cada
tarefa de limpeza (4, 7, 8, 9, 10) tira os próprios arquivos da lista PRIMEIRO —
o teste fica **vermelho** — e só então conserta o arquivo. Esse é o RED→GREEN
real deste ciclo. A Task 10 esvazia a lista; a Task 11 acrescenta a asserção de
schema.

**Files:**
- Create: `tests/unit/user-papel-nao-volta.test.ts`

**Interfaces:**
- Consumes: `semComentarios(codigo: string): string`
  (`tests/unit/helpers/codigo-fonte.ts:30`) — já existe, preserva numeração de
  linha e resolve CRLF.
- Produces:
  - `export function analisar(arquivo: string, codigoBruto: string): Violacao[]`
  - `type Violacao = { arquivo: string; linha: number; chamada: string }`
  - `const EM_CONVERSAO: Record<string, string>` com **29** chaves — caminhos
    relativos à raiz, sempre com `/`, no formato que `relativoPosix` produz.
  - Nenhuma mudança em `src/`, em migração ou no schema.

- [ ] **Step 1: Escrever o analisador e as provas de que ele morde**

Criar `tests/unit/user-papel-nao-volta.test.ts`:

```ts
// `User.papel` não volta — a trava que não passa pelo compilador.
//
// ## Por que ela existe, e por que TEXTUAL
//
// Derrubar `User.papel` foi tentado três vezes no Ciclo 1a e falhou nas três,
// sempre igual: quem media achava um grupo de leitores, concluía que era o
// alcance total, e um grupo novo aparecia depois do ponto sem volta. Os três
// grupos foram o JWT/sessão, a gestão de equipe e o alerta de auditoria.
//
// A medição de 2026-08-21 (`.superpowers/sdd/medicao-user-papel.md`) fechou o
// inventário, e o que a distingue das três anteriores não é ter rodado o `tsc`
// contra uma linha de base zerada — é ter achado o BURACO do `tsc`:
//
//   tests/unit/audit-isolamento.test.ts:163 escrevia `papel` e PASSAVA no
//   typecheck, porque `data: [...].map((id) => ({ ..., papel: "ADMIN" }))`
//   derrota a checagem de propriedade excedente. Ela só vale para objeto
//   literal FRESCO atribuído direto ao parâmetro; passando por `.map()`, o
//   tipo do elemento é inferido do retorno do callback e o excesso some. Em
//   runtime o Prisma lançaria `Unknown argument 'papel'`.
//
// Uma trava baseada em `tsc` repetiria as três falhas com uma ferramenta
// melhor. Esta lê o repositório como texto.
//
// ## O que ela reprova, exatamente
//
// A palavra `papel` dentro de uma chamada a `prisma.user.*` / `tx.user.*` /
// `db.user.*` — escrita OU leitura, porque as duas somem junto com a coluna.
// A sub-árvore `memberships: { ... }` é MASCARADA antes da checagem: escrever
// `papel` no vínculo aninhado é o jeito CERTO, e continua permitido (é o que
// `tests/unit/session.test.ts` faz).
//
// ## O que ela NÃO alcança, declarado
//
// Não entende TypeScript. Dublê montado numa variável e espalhado depois
// escapa; `any` e `JSON.parse` escapam. Isso é aceito de propósito, pelo mesmo
// raciocínio de `consultas-estreitas.test.ts`: a regra fecha o padrão que de
// fato apareceu neste projeto — chamada direta ao Prisma — e um analisador de
// verdade custaria mais que o problema. O que fecha o resíduo é a Task 11 do
// Ciclo 1f: a suíte rodando contra o Postgres real COM a coluna já fora, que é
// a única prova de runtime.
//
// Um dublê sem `prisma.user.*` fica fora do alcance por construção. Existe um,
// e é deliberado: `tests/unit/usuario-ativo.test.ts` REINTRODUZ um `papel`
// divergente na linha falsa de `User`, de propósito, para que a regra de
// resolução pelo vínculo continue tendo o que contradizer. Ver o comentário
// de lá.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { semComentarios } from "./helpers/codigo-fonte";

const RAIZ = process.cwd();
const DIRETORIOS = ["src", "tests", "prisma", "scripts", "config"];
const ESTE_ARQUIVO = "tests/unit/user-papel-nao-volta.test.ts";

/**
 * Métodos do delegate `user` do Prisma Client 7.9 que aceitam `where`, `data`
 * ou `select` — ou seja, todos por onde `papel` poderia entrar ou sair.
 * Lista fechada de propósito: um método novo do Prisma que não esteja aqui
 * passa despercebido, e prefiro isso a um `\w+` que case com
 * `user.usuarioQualquerCoisa` de código nosso.
 */
const METODOS_DE_USER = [
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
];

/**
 * `\b(prisma|tx|db)\.user\.` e não `\w+\.user\.`: o segundo casaria
 * `prismaMock.user.findUniqueOrThrow` de `usuario-ativo.test.ts`, que é um
 * dublê e não uma consulta. Com o `\.` obrigatório logo depois do nome, o
 * `Mock` no meio impede a batida.
 */
const CHAMADA_DE_USER = new RegExp(
  `\\b(?:prisma|tx|db)\\.user\\.(?:${METODOS_DE_USER.join("|")})\\s*\\(`,
  "g"
);

/**
 * Arquivos que ainda mencionam `papel` numa chamada a `prisma.user.*`, com a
 * tarefa do Ciclo 1f que os limpa.
 *
 * A lista SÓ ENCOLHE — as duas asserções abaixo travam as duas direções:
 * arquivo que viola e não está listado reprova, e arquivo listado que já não
 * viola também reprova. A segunda é o que impede a lista de virar depósito.
 *
 * Mesmo desenho da fila de conversão de `catraca-prisma-cru.test.ts`
 * (`LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS`, hoje em zero) e de `PERDOADAS`
 * em `migracoes-seguras.test.ts`: registrar dívida por nome, com prazo, em vez
 * de dar passagem em silêncio.
 *
 * A contagem inicial é 29 e vem de `.superpowers/sdd/medicao-user-papel.md`:
 * 32 arquivos de superfície menos os 3 que usam dublê sem `prisma.user.*`
 * (`usuario-ativo`, `lead-actions`, `task-actions`).
 */
const EM_CONVERSAO: Record<string, string> = {
  // Ciclo 1f, Task 4 — leitores `where: { papel }`, migram para `Membership`.
  "tests/unit/lead-creation-resilience.test.ts": "Task 4",
  "tests/unit/lead-notes.test.ts": "Task 4",
  "tests/unit/notifications.test.ts": "Task 4",
  "tests/unit/pipeline-service.test.ts": "Task 4",
  "tests/unit/stage-transition.test.ts": "Task 4",
  "tests/unit/task-queries.test.ts": "Task 4",

  // Ciclo 1f, Task 7 — o dual-write de produção e o seed.
  "src/core/users/service.ts": "Task 7",
  "prisma/seed.ts": "Task 7",

  // Ciclo 1f, Task 8 — fixtures de e2e.
  "tests/e2e/global-setup.ts": "Task 8",
  "tests/e2e/sessao-e-cache.spec.ts": "Task 8",
  "tests/e2e/whatsapp-agente.spec.ts": "Task 8",

  // Ciclo 1f, Task 9 — fixtures da família "isolamento".
  "tests/unit/audit-isolamento.test.ts": "Task 9",
  "tests/unit/contact-isolamento.test.ts": "Task 9",
  "tests/unit/lead-isolamento.test.ts": "Task 9",
  "tests/unit/notificacoes-isolamento.test.ts": "Task 9",
  "tests/unit/pipeline-isolamento.test.ts": "Task 9",
  "tests/unit/task-isolamento.test.ts": "Task 9",
  "tests/unit/unicidades-por-empresa.test.ts": "Task 9",
  "tests/unit/whatsapp-isolamento.test.ts": "Task 9",

  // Ciclo 1f, Task 10 — o restante das fixtures de unidade.
  "tests/unit/alerta-atividade.test.ts": "Task 10",
  "tests/unit/audit-log.test.ts": "Task 10",
  "tests/unit/contacts-service.test.ts": "Task 10",
  "tests/unit/dono-integracao.test.ts": "Task 10",
  "tests/unit/notificacoes-poda.test.ts": "Task 10",
  "tests/unit/session.test.ts": "Task 10",
  "tests/unit/tasks.test.ts": "Task 10",
  "tests/unit/users-service.test.ts": "Task 10",
  "tests/unit/whatsapp-envio-por-conexao.test.ts": "Task 10",
  "tests/unit/whatsapp-notificacoes.test.ts": "Task 10",
};

// ─────────────────────────────────────────────────────────────────────────
// O analisador
// ─────────────────────────────────────────────────────────────────────────

type Violacao = { arquivo: string; linha: number; chamada: string };

/**
 * Apaga o MIOLO de toda string, preservando aspas, comprimento e quebras de
 * linha.
 *
 * Dois motivos, os dois medidos:
 *
 * 1. **Balanceamento.** O analisador conta `{`, `[` e `(` para achar o fim da
 *    chamada. Uma chave dentro de string (`"}"`, ou `${id}` num template)
 *    desalinharia a contagem e o bloco terminaria no lugar errado.
 * 2. **Autoconsistência.** ESTE arquivo cita, em template literal, o código
 *    exato que proíbe. Sem apagar o miolo das strings, a varredura se acusaria
 *    — e o caso "os próprios exemplos deste arquivo não se acusam", abaixo, é
 *    o que prova que não acontece.
 *
 * O comprimento é preservado porque os índices são usados para calcular
 * número de linha; a quebra de linha é preservada pelo mesmo motivo. É a
 * mesma disciplina de `semComentarios` em `helpers/codigo-fonte.ts`.
 */
function semTextoDeString(codigo: string): string {
  let fora = "";
  let aspa: string | null = null;

  for (let i = 0; i < codigo.length; i++) {
    const c = codigo[i];
    if (aspa === null) {
      if (c === '"' || c === "'" || c === "`") aspa = c;
      fora += c;
      continue;
    }
    if (c === "\\") {
      // Consome o par inteiro, devolvendo dois caracteres: um `\"` no meio da
      // string não pode fechar a aspa.
      fora += codigo[i + 1] === "\n" ? " \n" : "  ";
      i++;
      continue;
    }
    if (c === aspa) {
      aspa = null;
      fora += c;
      continue;
    }
    fora += c === "\n" ? "\n" : " ";
  }

  return fora;
}

/** Índice do fecho que casa com a abertura em `inicio` (`(`, `{` ou `[`). */
function fimDoBalanceamento(texto: string, inicio: number): number {
  const fecho: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const pilha: string[] = [];

  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];
    if (fecho[c] !== undefined) {
      pilha.push(fecho[c]);
      continue;
    }
    if (c === pilha[pilha.length - 1]) {
      pilha.pop();
      if (pilha.length === 0) return i;
    }
  }

  return texto.length - 1;
}

/**
 * Apaga `memberships: { ... }` e `memberships: [ ... ]` inteiros do bloco.
 *
 * Escrever `papel` no vínculo aninhado é o jeito CERTO e precisa continuar
 * possível — `tests/unit/session.test.ts` cria o `User` e o `Membership` numa
 * chamada só, de propósito. Sem esta máscara, a trava reprovaria justamente o
 * padrão que ela deveria empurrar as pessoas a usar.
 */
function semSubarvoreDeMemberships(bloco: string): string {
  let resultado = bloco;

  for (;;) {
    const achado = /\bmemberships\s*:\s*[{[]/.exec(resultado);
    if (achado === null) return resultado;

    const abertura = achado.index + achado[0].length - 1;
    const fim = fimDoBalanceamento(resultado, abertura);
    const miolo = resultado.slice(achado.index, fim + 1);

    resultado =
      resultado.slice(0, achado.index) +
      miolo.replace(/[^\n]/g, " ") +
      resultado.slice(fim + 1);
  }
}

export function analisar(arquivo: string, codigoBruto: string): Violacao[] {
  const codigo = semTextoDeString(semComentarios(codigoBruto));
  const violacoes: Violacao[] = [];

  for (const chamada of codigo.matchAll(CHAMADA_DE_USER)) {
    const abertura = chamada.index + chamada[0].length - 1;
    const fim = fimDoBalanceamento(codigo, abertura);
    const bloco = semSubarvoreDeMemberships(codigo.slice(abertura, fim + 1));

    for (const ocorrencia of bloco.matchAll(/\bpapel\b/g)) {
      const absoluto = abertura + ocorrencia.index;
      violacoes.push({
        arquivo,
        linha: codigo.slice(0, absoluto).split("\n").length,
        chamada: chamada[0],
      });
    }
  }

  return violacoes;
}

// ─────────────────────────────────────────────────────────────────────────
// A varredura
// ─────────────────────────────────────────────────────────────────────────

/** Caminho relativo à raiz, sempre com `/`, para bater com `EM_CONVERSAO`. */
function relativoPosix(caminho: string): string {
  return relative(RAIZ, caminho).replace(/\\/g, "/");
}

function arquivosDeCodigo(diretorio: string): string[] {
  const achados: string[] = [];
  for (const entrada of readdirSync(diretorio, { withFileTypes: true })) {
    const caminho = join(diretorio, entrada.name);
    if (entrada.isDirectory()) achados.push(...arquivosDeCodigo(caminho));
    else if (/\.tsx?$/.test(entrada.name)) achados.push(caminho);
  }
  return achados;
}

describe("User.papel não volta", () => {
  const arquivos = DIRETORIOS.flatMap((dir) =>
    arquivosDeCodigo(join(RAIZ, dir)).map(relativoPosix)
  );

  const violacoes = arquivos.flatMap((arquivo) =>
    analisar(arquivo, readFileSync(join(RAIZ, arquivo), "utf8"))
  );
  const sujos = [...new Set(violacoes.map((v) => v.arquivo))].sort();

  it("os cinco diretórios de código foram varridos", () => {
    // Sem isto, um caminho errado deixaria a lista de violações vazia para
    // sempre e as asserções abaixo verdes sem ter lido nada — o "teste que não
    // exercita" que `consultas-estreitas.test.ts` e `migracoes-seguras.test.ts`
    // já documentam neste projeto. Por diretório, e não só pelo total: um
    // `tests/` grande esconderia um `src/` que não foi lido.
    for (const dir of DIRETORIOS) {
      expect(arquivos.filter((a) => a.startsWith(`${dir}/`)).length, dir).toBeGreaterThan(0);
    }
  });

  it("nenhum arquivo fora de EM_CONVERSAO menciona papel numa chamada a prisma.user", () => {
    const naoListados = sujos.filter((a) => EM_CONVERSAO[a] === undefined);

    expect(
      naoListados,
      "`papel` dentro de uma chamada a `prisma.user.*`. A coluna `User.papel` " +
        "foi derrubada no Ciclo 1f; o papel mora em `Membership.papel`. Se for " +
        "escrita, mova para o vínculo (`memberships: { create: { papel } }` ou " +
        "`prisma.membership.create`); se for leitura, consulte `Membership`. " +
        "Não acrescente o arquivo a EM_CONVERSAO: aquela lista só encolhe."
    ).toEqual([]);
  });

  it("EM_CONVERSAO não guarda arquivo já limpo — a lista SÓ encolhe", () => {
    const jaLimpos = Object.keys(EM_CONVERSAO).filter((a) => !sujos.includes(a));

    expect(
      jaLimpos,
      "arquivo listado em EM_CONVERSAO que já não menciona `papel` em chamada " +
        "a `prisma.user.*`. Tire-o da lista. Sem esta asserção a lista viraria " +
        "depósito e a trava perderia o dente exatamente quando começasse a " +
        "funcionar."
    ).toEqual([]);
  });

  it("a regra pega o `.map()` que o tsc NÃO pega", () => {
    // O trecho EXATO de `tests/unit/audit-isolamento.test.ts:157-165` antes do
    // conserto do Ciclo 1f. Ele passava no `npm run typecheck` mesmo com a
    // coluna fora do schema, e é a razão de esta trava ser textual em vez de
    // apoiada no compilador. Sem esta asserção, um erro de regex deixaria a
    // varredura sempre vazia e ninguém saberia.
    const doBuraco = `
      await prisma.user.createMany({
        data: [USUARIO_DUPLO, ADMIN_A, ADMIN_B].map((id) => ({
          id,
          nome: "Pessoa",
          email: "pessoa@exemplo.invalido",
          senhaHash: SENHA_FALSA,
          papel: "ADMIN" as const,
        })),
      });
    `;
    expect(analisar("teste", doBuraco)).toHaveLength(1);
  });

  it("pega também a leitura, que some junto com a coluna", () => {
    const leitura = `
      const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN", ativo: true } });
    `;
    expect(analisar("teste", leitura)).toHaveLength(1);
  });

  it("papel escrito no Membership ANINHADO não é violação — é o jeito certo", () => {
    // A metade que impede a trava de empurrar as pessoas para longe do padrão
    // correto. É o que `tests/unit/session.test.ts` faz: `User` e `Membership`
    // numa chamada só, com o papel no vínculo.
    const certo = `
      await prisma.user.create({
        data: {
          nome: "Teste",
          email: "teste@exemplo.local",
          senhaHash: "hash",
          ativo: true,
          memberships: { create: { companyId: idEmpresa, papel: "VENDEDOR" } },
        },
      });
    `;
    expect(analisar("teste", certo)).toEqual([]);
  });

  it("papel fora de uma chamada a prisma.user não conta", () => {
    const legitimo = `
      await prisma.membership.updateMany({ where: { userId }, data: { papel: "ADMIN" } });
      const vinculo = await prisma.membership.findFirstOrThrow({ where: { papel: "ADMIN" } });
      const persona = config.personaPapel;
    `;
    expect(analisar("teste", legitimo)).toEqual([]);
  });

  it("prosa em comentário não conta como código", () => {
    // Este projeto documenta as próprias regras em comentário longo, e a prosa
    // que EXPLICA a regra cita o padrão proibido literalmente. É o tropeço que
    // `helpers/codigo-fonte.ts` registra ter acontecido nas duas primeiras
    // varreduras textuais do repositório.
    const soComentario = `
      // await prisma.user.create({ data: { papel: "ADMIN" } }) seria a volta da coluna
      await prisma.user.create({ data: { nome, email, senhaHash } });
    `;
    expect(analisar("teste", soComentario)).toEqual([]);
  });

  it("os próprios exemplos deste arquivo não se acusam", () => {
    // Este arquivo carrega, em template literal, o código exato que proíbe.
    // `semTextoDeString` apaga o miolo de toda string antes da análise, e é por
    // isso que ele não aparece na varredura de si mesmo. Sem esta asserção, a
    // primeira notícia de que a máscara quebrou seria a suíte ficando vermelha
    // ao acrescentar um exemplo novo — e o palpite errado seria "o exemplo está
    // mal escrito".
    expect(
      analisar(ESTE_ARQUIVO, readFileSync(join(RAIZ, ESTE_ARQUIVO), "utf8"))
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar**

```bash
npx vitest run tests/unit/user-papel-nao-volta.test.ts
```

Esperado: **9 casos, todos passando.**

- [ ] **Step 3: Conferir que a lista bate com a superfície real, e ajustar se divergir**

Os dois casos `nenhum arquivo fora de EM_CONVERSAO...` e `EM_CONVERSAO não
guarda arquivo já limpo` fazem essa conferência sozinhos: se a lista de 29
estiver errada em qualquer direção, um dos dois reprova nomeando o arquivo.

**Se algum dos dois falhar:**

- Arquivo **sujo e não listado** → a medição não o viu. **Pare e reporte com o
  nome**, porque isso significa que a superfície é maior que 32 arquivos e o
  resto do plano precisa ser revisto antes de seguir. Não acrescente à lista por
  conta própria.
- Arquivo **listado e já limpo** → tire da lista, anote qual, e siga. É
  divergência benigna (alguém já o consertou), mas precisa ser reportada.

Ao final, colar o número de chaves:

```bash
grep -c '^\s*"\(src\|tests\|prisma\|scripts\|config\)/' tests/unit/user-papel-nao-volta.test.ts
```

Esperado: `29`.

- [ ] **Step 4: Confirmar que a trava não mexeu em nada mais**

```bash
npm run typecheck
npx vitest run tests/unit/catraca-prisma-cru.test.ts tests/unit/escopo-empresa.test.ts tests/unit/consultas-estreitas.test.ts
```

Esperado: `tsc` em zero; as três suítes verdes; `MODELOS_DE_TENANT` continua com
13 e a catraca de prisma cru em zero. Esta tarefa não cria helper nenhum, só um
arquivo de teste — e `tests/` está fora do alcance da catraca por decisão escrita
(`catraca-prisma-cru.test.ts:71`). Cole a saída.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/user-papel-nao-volta.test.ts
git commit -m "$(cat <<'MSG'
test(tenancy): a trava de User.papel que nao passa pelo compilador

As tres tentativas do Ciclo 1a falharam medindo com um instrumento so. A
medicao de 2026-08-21 achou o buraco do proprio instrumento: `papel` escrito
via .map() PASSA no tsc, porque a checagem de propriedade excedente so vale
para literal fresco atribuido direto ao parametro. Uma trava apoiada no
compilador repetiria as tres falhas com uma ferramenta melhor.

Esta le o repositorio como texto, mascara a sub-arvore `memberships` (escrever
o papel no vinculo continua sendo o jeito certo) e prova que morde com o trecho
exato de audit-isolamento.test.ts:157-165 que passava no typecheck. EM_CONVERSAO
nasce com 29 arquivos e SO ENCOLHE -- a segunda assercao impede a lista de
virar deposito.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: Os 10 leitores que o `tsc` vê — passam a consultar `Membership`

**DEPENDE DE AÇÃO DO DONO:** não.

Dez dos onze leitores são `prisma.user.findFirstOrThrow({ where: { papel: ... } })`
em fixtures de teste, todos pedindo a mesma coisa: "o ADMIN (ou o VENDEDOR) do
seed". Seis arquivos saem limpos aqui; `tests/unit/tasks.test.ts` também é
LEITOR mas continua em `EM_CONVERSAO` porque ainda ESCREVE a coluna na linha
178 — ele sai da lista na Task 10.

**Files:**
- Create: `tests/unit/helpers/usuarios-do-seed.ts`
- Modify: `tests/unit/user-papel-nao-volta.test.ts` (só `EM_CONVERSAO`)
- Modify: `tests/unit/lead-creation-resilience.test.ts`
- Modify: `tests/unit/lead-notes.test.ts`
- Modify: `tests/unit/notifications.test.ts`
- Modify: `tests/unit/pipeline-service.test.ts`
- Modify: `tests/unit/stage-transition.test.ts`
- Modify: `tests/unit/task-queries.test.ts`
- Modify: `tests/unit/tasks.test.ts` (só os dois leitores; o escritor da 178 fica)

**Interfaces:**
- Consumes: `prisma` (`src/lib/prisma`), `Role` (`@prisma/client`), modelo
  `Membership` com `@@unique([userId, companyId])`, campos `papel` e `criadoEm`
  (`prisma/schema.prisma:160-173`); `EM_CONVERSAO` (Task 3).
- Produces:
  - `export type UsuarioDoSeed = { id: string; companyId: string }`
  - `export async function usuarioDoSeed(papel: Role): Promise<UsuarioDoSeed>`
  - `EM_CONVERSAO` cai de 29 para **23** chaves.

- [ ] **Step 1: RED — tirar os seis da lista ANTES de consertar**

Em `tests/unit/user-papel-nao-volta.test.ts`, **apagar** o bloco inteiro:

```ts
  // Ciclo 1f, Task 4 — leitores `where: { papel }`, migram para `Membership`.
  "tests/unit/lead-creation-resilience.test.ts": "Task 4",
  "tests/unit/lead-notes.test.ts": "Task 4",
  "tests/unit/notifications.test.ts": "Task 4",
  "tests/unit/pipeline-service.test.ts": "Task 4",
  "tests/unit/stage-transition.test.ts": "Task 4",
  "tests/unit/task-queries.test.ts": "Task 4",

```

```bash
npx vitest run tests/unit/user-papel-nao-volta.test.ts
```

Esperado: **FALHA** no caso
`nenhum arquivo fora de EM_CONVERSAO menciona papel numa chamada a prisma.user`,
nomeando os seis arquivos. Cole a saída — é o RED desta tarefa.

- [ ] **Step 2: Escrever o helper**

Criar `tests/unit/helpers/usuarios-do-seed.ts`:

```ts
// "O ADMIN do seed", "o VENDEDOR do seed" — sem passar por `User.papel`.
//
// Sete arquivos de teste faziam
// `prisma.user.findFirstOrThrow({ where: { papel: "ADMIN", ativo: true } })`
// para achar o autor das fixtures. A coluna `User.papel` sai no Ciclo 1f e o
// papel mora em `Membership.papel`, então a consulta parte do VÍNCULO — que é
// também de onde `usuarioAtual()` (`core/auth/session.ts:98-107`) tira o papel
// em produção. Os testes passam a perguntar da mesma forma que o sistema.
//
// ## Três decisões que o formato antigo tomava por acidente
//
// **`user: { ativo: true }` faz parte da chave.** O seed cria um "Atendente
// WhatsApp (sistema)" com papel ADMIN e `ativo: false`, e ele é o primeiro
// ADMIN que um `findFirst` sem filtro devolve. `stage-transition.test.ts:82-88`
// registra o estrago disso: leads nascendo com dono que não consegue entrar no
// sistema, e passando, porque nada recusava. Aqui o filtro é obrigatório, não
// lembrado.
//
// **`orderBy: { criadoEm: "asc" }`, que o formato antigo não tinha.** O banco
// de desenvolvimento é compartilhado e outros arquivos da suíte criam ADMINs
// com vínculo (`audit-isolamento`, `alerta-atividade`, ...). Sem ordem, "o
// ADMIN" era literalmente qualquer um que o Postgres devolvesse primeiro. O
// vínculo do seed é o mais antigo, então a ordem por `criadoEm` o escolhe.
// Isto é estritamente melhor que antes, não uma mudança de contrato — mas é
// uma MUDANÇA, e por isso cada arquivo convertido roda inteiro na tarefa que o
// converte.
//
// **`companyId` sai de graça.** Vários desses arquivos faziam uma SEGUNDA
// consulta só para descobrir a empresa do usuário. É a mesma linha.
import type { Role } from "@prisma/client";

import { prisma } from "../../../src/lib/prisma";

export type UsuarioDoSeed = { id: string; companyId: string };

/**
 * O usuário ATIVO com este papel, pelo vínculo mais antigo que o tenha.
 *
 * Lança se não houver nenhum — de propósito, e não devolve `null`: uma fixture
 * que não acha o autor precisa parar ali, com a mensagem do Prisma dizendo o
 * que faltou, em vez de seguir com `undefined` e falhar três asserções adiante
 * por outro motivo.
 */
export async function usuarioDoSeed(papel: Role): Promise<UsuarioDoSeed> {
  const vinculo = await prisma.membership.findFirstOrThrow({
    where: { papel, user: { ativo: true } },
    select: { userId: true, companyId: true },
    orderBy: { criadoEm: "asc" },
  });

  return { id: vinculo.userId, companyId: vinculo.companyId };
}
```

- [ ] **Step 3: `lead-creation-resilience.test.ts`**

Acrescentar, junto dos outros imports (o de `prisma` está na linha 34):

```ts
import { usuarioDoSeed } from "./helpers/usuarios-do-seed";
```

Trocar as duas linhas 94-95:

```ts
    const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN", ativo: true } });
    autorId = admin.id;
```

por:

```ts
    autorId = (await usuarioDoSeed("ADMIN")).id;
```

- [ ] **Step 4: `lead-notes.test.ts`**

Acrescentar `import { usuarioDoSeed } from "./helpers/usuarios-do-seed";`.

Trocar as linhas 86-92:

```ts
    const usuario = await prisma.user.findFirstOrThrow({
      where: { papel: "ADMIN", ativo: true },
      include: { memberships: true },
    });
    usuarioId = usuario.id;
    companyId = usuario.memberships[0]!.companyId;
```

por:

```ts
    // As duas informações numa consulta só, e as duas vindas do VÍNCULO: era
    // `include: { memberships: true }` sobre `User` filtrado por `User.papel`,
    // coluna que sai no Ciclo 1f. O `memberships[0]!` também some — ele pegava
    // um vínculo arbitrário de quem tivesse dois.
    ({ id: usuarioId, companyId } = await usuarioDoSeed("ADMIN"));
```

- [ ] **Step 5: `notifications.test.ts`**

Acrescentar `import { usuarioDoSeed } from "./helpers/usuarios-do-seed";`.

Trocar as linhas 95-98:

```ts
    const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN", ativo: true } });
    adminId = admin.id;
    const vendedor = await prisma.user.findFirstOrThrow({ where: { papel: "VENDEDOR", ativo: true } });
    vendedorId = vendedor.id;
```

por:

```ts
    adminId = (await usuarioDoSeed("ADMIN")).id;
    vendedorId = (await usuarioDoSeed("VENDEDOR")).id;
```

- [ ] **Step 6: `pipeline-service.test.ts`**

Acrescentar `import { usuarioDoSeed } from "./helpers/usuarios-do-seed";`.

Trocar `contextoDoAdmin()` (linhas 47-51):

```ts
async function contextoDoAdmin() {
  const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN" } });
  const vinculo = await prisma.membership.findFirstOrThrow({ where: { userId: admin.id } });
  return { admin, companyId: vinculo.companyId };
}
```

por:

```ts
async function contextoDoAdmin() {
  // Uma consulta onde eram duas, e o `ativo: true` que faltava: o formato
  // antigo (`User.papel`, sem filtro de ativo) podia devolver o "Atendente
  // WhatsApp (sistema)", que é ADMIN e `ativo: false`. Ver o helper.
  const admin = await usuarioDoSeed("ADMIN");
  return { admin, companyId: admin.companyId };
}
```

O restante do arquivo usa `admin.id` em dez lugares (54, 62, 94, 97, 102, 104,
121, 127, 142, 145, 151, 157, 171, 173, 191, 193, 203 e vizinhas) —
`UsuarioDoSeed` tem `id`, então **nenhuma delas muda**. Se alguma linha usar
outro campo de `admin`, **pare e reporte**: é um uso que este plano não previu.

- [ ] **Step 7: `stage-transition.test.ts`**

Acrescentar `import { usuarioDoSeed } from "./helpers/usuarios-do-seed";`.

Trocar as linhas 82-90 (o comentário longo e a consulta):

```ts
    // `ativo: true` não é enfeite: o seed cria um "Atendente WhatsApp
    // (sistema)" com papel ADMIN e `ativo: false`, e ele é o primeiro ADMIN
    // que `findFirstOrThrow` devolve. Sem o filtro, este teste criava leads
    // com dono que não consegue entrar no sistema — e passava, porque nada
    // recusava. `criarLead` passou a recusar (auditoria de segurança), e foi
    // assim que o problema apareceu. Mesmo filtro nos outros arquivos que
    // buscam usuário do seed.
    const usuario = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN", ativo: true } });
    autorId = usuario.id;
```

por:

```ts
    // O `ativo: true` que este arquivo trazia escrito à mão virou parte do
    // helper, e a história dele foi para lá inteira: o seed cria um "Atendente
    // WhatsApp (sistema)" ADMIN e `ativo: false`, e ele era o primeiro ADMIN
    // que a busca devolvia — leads nasciam com dono que não consegue entrar no
    // sistema, e passavam, porque nada recusava. `criarLead` passou a recusar
    // (auditoria de segurança), e foi assim que apareceu. Deixar a regra num
    // comentário de um arquivo era o que permitia os outros seis esquecerem.
    autorId = (await usuarioDoSeed("ADMIN")).id;
```

- [ ] **Step 8: `task-queries.test.ts`**

Acrescentar `import { usuarioDoSeed } from "./helpers/usuarios-do-seed";`.

Trocar as linhas 35-38:

```ts
    const admin = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN", ativo: true } });
    adminId = admin.id;
    const vendedor = await prisma.user.findFirstOrThrow({ where: { papel: "VENDEDOR", ativo: true } });
    vendedorId = vendedor.id;
```

por:

```ts
    adminId = (await usuarioDoSeed("ADMIN")).id;
    vendedorId = (await usuarioDoSeed("VENDEDOR")).id;
```

- [ ] **Step 9: `tasks.test.ts` — só os dois leitores**

Acrescentar `import { usuarioDoSeed } from "./helpers/usuarios-do-seed";`.

Trocar as linhas 45-53:

```ts
    const usuario = await prisma.user.findFirstOrThrow({ where: { papel: "ADMIN", ativo: true } });
    usuarioId = usuario.id;

    // Segundo usuário real (papel diferente) para o teste de checagem de
    // dono abaixo — precisa ser outro `id` de usuário existente, não um
    // valor forjado, para provar que a rejeição é sobre PROPRIEDADE da
    // tarefa, não sobre o usuário não existir.
    const outroUsuario = await prisma.user.findFirstOrThrow({ where: { papel: "VENDEDOR", ativo: true } });
    outroUsuarioId = outroUsuario.id;
```

por:

```ts
    usuarioId = (await usuarioDoSeed("ADMIN")).id;

    // Segundo usuário real (papel diferente) para o teste de checagem de
    // dono abaixo — precisa ser outro `id` de usuário existente, não um
    // valor forjado, para provar que a rejeição é sobre PROPRIEDADE da
    // tarefa, não sobre o usuário não existir.
    outroUsuarioId = (await usuarioDoSeed("VENDEDOR")).id;
```

**A linha 178 deste arquivo NÃO muda nesta tarefa** — é um ESCRITOR
(`papel: "VENDEDOR"` dentro de `prisma.user.create`), e ela sai na Task 10.
`tests/unit/tasks.test.ts` continua em `EM_CONVERSAO` até lá, e é por isso que
ele não estava no bloco apagado no Step 1.

- [ ] **Step 10: GREEN — rodar a trava e os sete arquivos**

```bash
npx vitest run tests/unit/user-papel-nao-volta.test.ts
```

Esperado: **9 casos verdes**, `EM_CONVERSAO` com 23 chaves.

Depois, os arquivos convertidos, num comando só (`fileParallelism: false` no
`vitest.config.ts` os roda em série dentro da execução; o proibido é duas
execuções de `vitest` ao mesmo tempo):

```bash
npx vitest run tests/unit/lead-creation-resilience.test.ts tests/unit/lead-notes.test.ts tests/unit/notifications.test.ts tests/unit/pipeline-service.test.ts tests/unit/stage-transition.test.ts tests/unit/task-queries.test.ts tests/unit/tasks.test.ts
```

Esperado: tudo verde. Se `pipeline-service.test.ts` falhar, o suspeito é o
`ativo: true` novo escolhendo outro usuário — **pare e reporte com a saída**,
não remova o filtro.

```bash
npm run typecheck
```

Esperado: zero erros. Cole as três saídas.

- [ ] **Step 11: Commit**

```bash
git add tests/unit/helpers/usuarios-do-seed.ts tests/unit/user-papel-nao-volta.test.ts tests/unit/lead-creation-resilience.test.ts tests/unit/lead-notes.test.ts tests/unit/notifications.test.ts tests/unit/pipeline-service.test.ts tests/unit/stage-transition.test.ts tests/unit/task-queries.test.ts tests/unit/tasks.test.ts
git commit -m "$(cat <<'MSG'
test(tenancy): as fixtures perguntam o papel ao vinculo, nao a User.papel

Dez dos onze leitores da coluna pediam a mesma coisa -- "o ADMIN do seed" --
por sete copias da mesma consulta. O helper faz a pergunta de onde producao a
faz (Membership, igual a usuarioAtual()) e recolhe duas regras que viviam em
comentario de um arquivo so: `ativo: true`, sem o qual o Atendente WhatsApp
(sistema) era o ADMIN devolvido e leads nasciam com dono que nao entra no
sistema; e ordem por criadoEm, sem a qual "o ADMIN" era qualquer um que outro
arquivo da suite tivesse criado no banco compartilhado.

tasks.test.ts perde os dois leitores e CONTINUA em EM_CONVERSAO: ele ainda
escreve a coluna na linha 178, e sai na Task 10.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: O 11º leitor — o que o `tsc` NÃO vê

**DEPENDE DE AÇÃO DO DONO:** não.

`tests/unit/usuario-ativo.test.ts:68` faz
`expect(usuario.papel).not.toBe(USUARIO_BASE.papel)` sobre um objeto literal
**sem tipo** devolvido por um mock. É o leitor mais importante do inventário e o
único que **nenhuma ferramenta automática deste plano alcança**: o `tsc` não o
vê (literal sem tipo), e a trava textual da Task 3 não o vê (é
`prismaMock.user.`, não `prisma.user.`). Foi achado por grep manual
(`medicao:35`).

E é justamente **a trava semântica** que existe para impedir a coluna de voltar
a ser lida: `usuario-ativo.test.ts:22-24` diz, literalmente, *"de propósito
diferente do papel usado nos vínculos abaixo, para que nenhum teste passe por
acidente caso `usuarioAtual()` volte a ler a coluna"*. Se ela for simplesmente
apagada junto com a coluna, **some em silêncio** — e o projeto perde a asserção
que separa "resolve pelo vínculo" de "resolve pela linha de `User`".

A decisão desta tarefa: **a trava não é apagada, é reancorada.** O `papel`
divergente sai do objeto base e volta num objeto HOSTIL, explicitamente
declarado como coluna que não existe mais. Ela deixa de descrever o presente e
passa a descrever o que aconteceria se alguém regredisse — que é exatamente o
que uma trava deve fazer.

**Files:**
- Modify: `tests/unit/usuario-ativo.test.ts`

**Interfaces:**
- Consumes: `usuarioAtual()` (`src/core/auth/session.ts:56-108`),
  `EmpresaAmbiguaError` (`src/core/auth/usuario-ativo.ts:39`).
- Produces: `const LINHA_HOSTIL` no arquivo de teste; `USUARIO_BASE` sem
  `papel`. Nenhuma mudança em `src/`, em `EM_CONVERSAO` (este arquivo nunca
  esteve na lista — a Task 3 explica por quê) nem em qualquer outro arquivo.

- [ ] **Step 1: Reancorar a trava**

Em `tests/unit/usuario-ativo.test.ts`, trocar as linhas 22-31:

```ts
// `papel: "ADMIN"` aqui é a coluna ANTIGA (`User.papel`) -- de propósito
// diferente do papel usado nos vínculos abaixo, para que nenhum teste passe
// por acidente caso `usuarioAtual()` volte a ler a coluna em vez do vínculo.
const USUARIO_BASE = {
  id: "user-1",
  nome: "Usuária Teste",
  email: "teste-usuario-ativo@exemplo.local",
  ativo: true,
  papel: "ADMIN",
};
```

por:

```ts
// A linha de `User` como ela é DEPOIS do Ciclo 1f: sem `papel`. A coluna foi
// derrubada, e o papel mora em `Membership`.
const USUARIO_BASE = {
  id: "user-1",
  nome: "Usuária Teste",
  email: "teste-usuario-ativo@exemplo.local",
  ativo: true,
};

// A linha HOSTIL: `USUARIO_BASE` com a coluna derrubada de volta, e com valor
// DIVERGENTE do vínculo (ADMIN aqui, VENDEDOR lá).
//
// Ela existe porque a trava que este arquivo carregava desde o Ciclo 1a --
// "nenhum teste passa por acidente caso `usuarioAtual()` volte a ler a coluna"
// -- perderia a premissa quando a coluna sumisse, e sumiria EM SILÊNCIO: o
// objeto é um literal sem tipo, então nem o `tsc` nem a varredura textual de
// `user-papel-nao-volta.test.ts` (que só olha chamadas a `prisma.user.*`, e
// aqui é `prismaMock`) acusariam a perda. Apagar a trava junto com a coluna
// custaria a única asserção do projeto que separa "resolveu pelo vínculo" de
// "resolveu pela linha de `User`".
//
// Reancorada, ela deixa de descrever o presente e passa a descrever a
// REGRESSÃO: se alguém voltar a resolver o papel pela linha, o caso abaixo
// devolve "ADMIN" e fica vermelho. É a forma que uma trava deve ter.
//
// Este é o único ponto do repositório onde `papel` numa linha de `User` é
// deliberado. Ver `.superpowers/sdd/medicao-user-papel.md` § 1, item 11.
const LINHA_HOSTIL = { ...USUARIO_BASE, papel: "ADMIN" };
```

- [ ] **Step 2: Apontar o caso da trava para a linha hostil**

No mesmo arquivo, trocar as linhas 55-70 (o segundo `it`):

```ts
  it(
    "o papel devolvido é o do vínculo, e NÃO o de User.papel -- os dois valores divergem de " +
      "propósito neste caso (vínculo VENDEDOR, coluna antiga ADMIN) para que o teste não passe " +
      "por acidente se alguém reintroduzir a leitura da coluna",
    async () => {
      prismaMock.user.findUniqueOrThrow.mockResolvedValue({
        ...USUARIO_BASE, // papel: "ADMIN" na coluna antiga
        memberships: [membership("VENDEDOR")], // papel: "VENDEDOR" no vínculo
      });

      const usuario = await usuarioAtual();

      expect(usuario.papel).toBe("VENDEDOR");
      expect(usuario.papel).not.toBe(USUARIO_BASE.papel);
    }
  );
```

por:

```ts
  it(
    "com a coluna derrubada REINTRODUZIDA na linha, o papel devolvido continua sendo o do " +
      "vínculo -- os dois valores divergem de propósito (vínculo VENDEDOR, coluna ADMIN) para " +
      "que este caso fique vermelho se alguém voltar a resolver o papel pela linha de User",
    async () => {
      prismaMock.user.findUniqueOrThrow.mockResolvedValue({
        ...LINHA_HOSTIL, // papel: "ADMIN" na coluna que não existe mais
        memberships: [membership("VENDEDOR")], // papel: "VENDEDOR" no vínculo
      });

      const usuario = await usuarioAtual();

      expect(usuario.papel).toBe("VENDEDOR");
      expect(usuario.papel).not.toBe(LINHA_HOSTIL.papel);
    }
  );
```

- [ ] **Step 3: Atualizar o cabeçalho do arquivo**

Trocar as linhas 1-2:

```ts
// Prova que `usuarioAtual()` resolve empresa e papel pelo VÍNCULO
// (`Membership`), não mais pela coluna `User.papel` (Ciclo 1a, Task 2).
```

por:

```ts
// Prova que `usuarioAtual()` resolve empresa e papel pelo VÍNCULO
// (`Membership`). A coluna `User.papel` que ele substituiu não existe mais
// desde o Ciclo 1f -- e a trava que impede a volta está em `LINHA_HOSTIL`,
// abaixo, porque nem o `tsc` nem a varredura textual alcançam este arquivo.
```

- [ ] **Step 4: Rodar**

```bash
npx vitest run tests/unit/usuario-ativo.test.ts
npm run typecheck
```

Esperado: **6 casos verdes** e `tsc` em zero. Os quatro casos que usam
`USUARIO_BASE` puro (zero vínculo, dois vínculos, desativado, sem sessão) não
foram tocados e continuam passando — se algum deles falhar, a remoção de `papel`
do objeto base alcançou mais do que o desenho previu: **pare e reporte**.

- [ ] **Step 5: Provar que a trava reancorada morde**

Não basta o caso ficar verde: ele precisa ficar VERMELHO quando a regressão
acontece. Faça a regressão à mão, rode, e desfaça.

Em `src/core/auth/session.ts`, na linha 106, trocar temporariamente:

```ts
    papel: vinculo.papel,
```

por:

```ts
    papel: (usuario as unknown as { papel: Role }).papel,
```

```bash
npx vitest run tests/unit/usuario-ativo.test.ts
```

Esperado: **FALHA** no caso da linha hostil, com `expected "ADMIN" to be
"VENDEDOR"`. Cole a saída — é a prova de que a trava morde.

**Desfazer imediatamente:**

```bash
git checkout -- src/core/auth/session.ts
git status --short
npx vitest run tests/unit/usuario-ativo.test.ts
npm run typecheck
```

Esperado: `git status` sem `src/core/auth/session.ts`, 6 casos verdes, `tsc` em
zero. **Se a reposição falhar, PARE E REPORTE** e nenhuma tarefa seguinte roda.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/usuario-ativo.test.ts
git commit -m "$(cat <<'MSG'
test(tenancy): a trava do 11o leitor e reancorada, nao apagada

usuario-ativo.test.ts:68 lia `papel` de um literal sem tipo -- nem o tsc nem a
varredura textual o alcancam, e foi grep manual que o achou. Ele nao e um
leitor descuidado: e a unica assercao do projeto que separa "resolveu pelo
vinculo" de "resolveu pela linha de User", escrita no Ciclo 1a exatamente para
que nenhum teste passasse por acidente se alguem voltasse a ler a coluna.

Apaga-la junto com a coluna a faria sumir EM SILENCIO. O `papel` divergente sai
do objeto base e volta em LINHA_HOSTIL, declarado como a coluna que nao existe
mais: a trava deixa de descrever o presente e passa a descrever a regressao.
Provado mordendo, com a regressao feita a mao em session.ts e desfeita.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: Os dois ambíguos — retipar para `UsuarioAtivo`

**DEPENDE DE AÇÃO DO DONO:** não.

`tests/unit/lead-actions.test.ts` e `tests/unit/task-actions.test.ts` tipam o
dublê de `usuarioAtual()` como **`User` do Prisma**. O `tsc` reprova 10 linhas
neles quando a coluna sai (`medicao:58-60`), o que os faz parecer leitores. Não
são: `usuarioAtual()` devolve `UsuarioAtivo`, não `User`, e o `papel` que a
produção lê vem de `Membership` (`session.ts:106`). **São dublês tipados com o
tipo errado, e o conserto é retipar, não migrar leitor.**

Este padrão já enganou três vezes nesta branch, sempre da mesma forma: o dublê
com o tipo errado fica VERDE repassando `companyId: undefined`, e ninguém vê,
porque `undefined` atravessa um mock sem reclamar. **É o que está acontecendo
agora em `task-actions.test.ts`**: `criarTask({ ...input, companyId: autor.companyId, ... })`
(`core/tasks/actions.ts:72`) recebe `undefined`, porque `User` não tem
`companyId`. O RED desta tarefa é esse defeito, e ele é real, não cerimonial.

`lead-actions.test.ts` não tem o defeito: `src/core/leads/actions.ts` não
menciona `companyId` em lugar nenhum (medido: `grep -c companyId` → `0`). Lá o
retipo é puro, com os testes existentes como rede.

**Files:**
- Modify: `tests/unit/task-actions.test.ts`
- Modify: `tests/unit/lead-actions.test.ts`

**Interfaces:**
- Consumes: `UsuarioAtivo` (`src/core/auth/usuario-ativo.ts:20-29`) — campos
  `id`, `nome`, `email`, `ativo`, `companyId`, `papel`. Sem `senhaHash`, sem
  `criadoEm`, e a ausência é o ganho: nada fora de `core/auth` tem por que ler
  hash de senha (docstring do próprio tipo, linhas 16-18).
- Produces:
  - `usuarioFake(overrides: Partial<UsuarioAtivo>): UsuarioAtivo` nos dois
    arquivos.
  - `const EMPRESA_FAKE = "empresa-fake-id"` em `task-actions.test.ts`, o mesmo
    literal que `taskFake()` já usa em `companyId` (linha 47).
  - Dois casos novos em `task-actions.test.ts`.
  - `EM_CONVERSAO` **não muda**: nenhum dos dois arquivos usa `prisma.user.*`.

- [ ] **Step 1: RED — os dois casos que provam o `companyId: undefined`**

Em `tests/unit/task-actions.test.ts`, **antes** do
`describe("nada da linha do banco atravessa a fronteira", ...)` (linha 76),
inserir:

```ts
// O `companyId` da SESSÃO, e o defeito que o dublê mal tipado escondia.
//
// `criarTask`/`concluirTask` recebem `companyId: autor.companyId`
// (`core/tasks/actions.ts:72` e `:113`), e o `autor` vem de `usuarioAtual()`,
// que devolve `UsuarioAtivo`. Enquanto o dublê deste arquivo foi tipado como
// `User` do Prisma -- que NÃO tem `companyId` --, esses dois pontos receberam
// `undefined` e nenhum teste reclamou: `undefined` atravessa um mock sem
// levantar nada.
//
// É a terceira vez que esse padrão exato aparece nesta branch (as duas
// anteriores estão em `e67e1e6` e `c06b1fe`), e as três ficaram verdes do
// mesmo jeito. Estes dois casos são o que impede a quarta.
describe("companyId vem da sessão, nunca do formulário", () => {
  it("criar manda o companyId de usuarioAtual() para o serviço", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake());
    criarTaskMock.mockResolvedValue(taskFake());

    await criarMinhaTaskAction({
      titulo: "Ligar",
      vencimento: new Date("2026-08-05T00:00:00.000Z"),
    });

    expect(criarTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: EMPRESA_FAKE, responsavelId: "usuario-fake-id" })
    );
  });

  it("concluir manda o companyId de usuarioAtual() para o serviço", async () => {
    usuarioAtualMock.mockResolvedValue(usuarioFake());
    concluirTaskMock.mockResolvedValue(taskFake());

    await concluirMinhaTaskAction("task-1");

    expect(concluirTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: EMPRESA_FAKE,
        taskId: "task-1",
        autorId: "usuario-fake-id",
      })
    );
  });
});
```

Ainda **não** declare `EMPRESA_FAKE` — o Step 2 faz isso junto com o retipo.
Para ver o RED agora, rode com o literal no lugar:

```bash
npx vitest run tests/unit/task-actions.test.ts
```

Esperado: **FALHA** — `EMPRESA_FAKE is not defined`, ou, se você já tiver
declarado a constante, `companyId: undefined` contra `"empresa-fake-id"`. Cole a
saída. Se algum dos dois casos PASSAR sem o retipo, o dublê já tem `companyId` e
o desenho desta tarefa está errado: **pare e reporte**.

- [ ] **Step 2: Retipar `task-actions.test.ts`**

Trocar a linha 8:

```ts
import type { User, Task } from "@prisma/client";
```

por:

```ts
import type { Task } from "@prisma/client";

import type { UsuarioAtivo } from "@/core/auth/usuario-ativo";
```

Trocar `usuarioFake` (linhas 31-42):

```ts
function usuarioFake(overrides: Partial<User> = {}): User {
  return {
    id: "usuario-fake-id",
    nome: "Usuário Fake",
    email: "fake@teste.local",
    senhaHash: "hash",
    papel: "VENDEDOR",
    ativo: true,
    criadoEm: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}
```

por:

```ts
// `UsuarioAtivo` e NÃO `User` do Prisma, que é o que este dublê fingia ser.
// `usuarioAtual()` devolve `UsuarioAtivo` (`core/auth/usuario-ativo.ts`), e a
// diferença não é cosmética: `UsuarioAtivo` tem `companyId` e `User` não tem.
// Com o tipo errado, `autor.companyId` chegava `undefined` no serviço e o
// teste ficava verde -- ver o describe "companyId vem da sessão".
//
// `senhaHash` e `criadoEm` somem, e a ausência é o ganho declarado no
// docstring do tipo: nada fora de `core/auth` tem por que ler hash de senha.
// `papel` continua, e continua vindo do VÍNCULO -- não é `User.papel`, coluna
// derrubada no Ciclo 1f.
const EMPRESA_FAKE = "empresa-fake-id";

function usuarioFake(overrides: Partial<UsuarioAtivo> = {}): UsuarioAtivo {
  return {
    id: "usuario-fake-id",
    nome: "Usuário Fake",
    email: "fake@teste.local",
    ativo: true,
    companyId: EMPRESA_FAKE,
    papel: "VENDEDOR",
    ...overrides,
  };
}
```

`EMPRESA_FAKE` é o **mesmo literal** que `taskFake()` já usa em `companyId`
(linha 47): a tarefa falsa e a sessão falsa passam a concordar sobre a empresa,
que é o estado que produção sempre teve.

- [ ] **Step 3: GREEN**

```bash
npx vitest run tests/unit/task-actions.test.ts
npm run typecheck
```

Esperado: todos os casos verdes (os que já existiam mais os 2 novos) e `tsc` em
zero. Cole as duas saídas.

- [ ] **Step 4: Retipar `lead-actions.test.ts`**

Aqui não há defeito a corrigir — `src/core/leads/actions.ts` não usa `companyId`
(medido em 2026-08-21: `grep -c "companyId" src/core/leads/actions.ts` → `0`).
É retipo puro, com os testes existentes como rede.

Trocar a linha 9:

```ts
import type { User, Lead } from "@prisma/client";
```

por:

```ts
import type { Lead } from "@prisma/client";

import type { UsuarioAtivo } from "@/core/auth/usuario-ativo";
```

Trocar `usuarioFake` (linhas 76-87):

```ts
function usuarioFake(overrides: Partial<User>): User {
  return {
    id: "usuario-fake-id",
    nome: "Usuário Fake",
    email: "fake@teste.local",
    senhaHash: "hash",
    papel: "VENDEDOR",
    ativo: true,
    criadoEm: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}
```

por:

```ts
// `UsuarioAtivo` e NÃO `User` do Prisma: é o que `usuarioAtual()` devolve, e é
// de onde saem os `autor.papel` que `actions.ts:53` e `:146` passam para
// `hasPermission`. O `papel` aqui sempre foi o do VÍNCULO na semântica --
// tipá-lo como `User.papel` era o erro, e ele custava um `tsc` vermelho em 9
// linhas deste arquivo no dia em que a coluna saísse.
//
// Diferente de `task-actions.test.ts`, aqui o tipo errado não escondia defeito
// nenhum: `core/leads/actions.ts` não menciona `companyId` em ponto algum
// (medido em 2026-08-21). `senhaHash` e `criadoEm` somem porque `UsuarioAtivo`
// não os tem, e nenhum caso deste arquivo os lia.
function usuarioFake(overrides: Partial<UsuarioAtivo>): UsuarioAtivo {
  return {
    id: "usuario-fake-id",
    nome: "Usuário Fake",
    email: "fake@teste.local",
    ativo: true,
    companyId: "empresa-fake-id",
    papel: "VENDEDOR",
    ...overrides,
  };
}
```

As nove chamadas de `usuarioFake({ papel: ... })` e `usuarioFake({ id, papel })`
(linhas 127, 223, 246, 276, 309, 368, 395, 433) **não mudam**: `papel` e `id`
existem nos dois tipos. Se alguma chamada passar `senhaHash` ou `criadoEm`,
**pare e reporte** — é um uso que este plano não previu.

- [ ] **Step 5: GREEN dos dois, e a trava intacta**

```bash
npx vitest run tests/unit/lead-actions.test.ts tests/unit/task-actions.test.ts tests/unit/user-papel-nao-volta.test.ts
npm run typecheck
```

Esperado: tudo verde, `EM_CONVERSAO` ainda com 23 chaves (nenhum destes dois
arquivos esteve na lista) e `tsc` em zero. Cole as saídas.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/lead-actions.test.ts tests/unit/task-actions.test.ts
git commit -m "$(cat <<'MSG'
test(tenancy): os dois dubles de usuarioAtual() param de fingir ser User

O tsc reprovava 10 linhas nestes dois arquivos ao tirar User.papel, o que os
fazia parecer leitores da coluna. Nao sao: usuarioAtual() devolve UsuarioAtivo,
e o papel dele vem do vinculo (session.ts:106). Estavam so tipados errado.

O tipo errado nao era inofensivo. UsuarioAtivo tem companyId e User nao, entao
task-actions.test.ts vinha passando `companyId: undefined` para criarTask e
concluirTask, verde, porque undefined atravessa mock sem reclamar. Terceira
ocorrencia do mesmo padrao nesta branch; os dois casos novos sao o que impede a
quarta. lead-actions nao tinha o defeito -- leads/actions.ts nao usa companyId.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: O dual-write morre — `src/core/users/service.ts` e `prisma/seed.ts`

**DEPENDE DE AÇÃO DO DONO:** não. **⚠️ ATENÇÃO: o Step 6 reescreve senhas de
desenvolvimento — ver o aviso lá.**

Os **dois únicos escritores de produção** (`medicao:75-78`) e os três do seed.
Depois desta tarefa, nada em `src/` nem em `prisma/` toca a coluna.

**Files:**
- Modify: `tests/unit/user-papel-nao-volta.test.ts` (só `EM_CONVERSAO`)
- Modify: `src/core/users/service.ts`
- Modify: `prisma/seed.ts`

**Interfaces:**
- Consumes: `prismaDaEmpresa` (`src/core/tenancy/escopo.ts`), `UsuarioListado`
  (`src/core/users/queries.ts:31-38`), `vincularAEmpresa` (`prisma/seed.ts`),
  `EM_CONVERSAO` (Task 3).
- Produces:
  - `criarUsuario` e `atualizarUsuario` com **a mesma assinatura e o mesmo
    retorno** — só param de gravar na coluna espelho. `UsuarioListado.papel`
    continua vindo do parâmetro validado, que é o mesmo valor gravado em
    `Membership`.
  - `EM_CONVERSAO` cai de 23 para **21** chaves.
  - Nenhuma migração, nenhuma mudança de schema.

- [ ] **Step 1: RED — tirar os dois da lista**

Em `tests/unit/user-papel-nao-volta.test.ts`, **apagar** o bloco:

```ts
  // Ciclo 1f, Task 7 — o dual-write de produção e o seed.
  "src/core/users/service.ts": "Task 7",
  "prisma/seed.ts": "Task 7",

```

```bash
npx vitest run tests/unit/user-papel-nao-volta.test.ts
```

Esperado: **FALHA** nomeando `src/core/users/service.ts` e `prisma/seed.ts`.
Cole a saída.

- [ ] **Step 2: `criarUsuario` para de gravar na coluna**

Em `src/core/users/service.ts`, trocar o parágrafo das linhas 244-253:

```ts
    // `papel` ainda vai para `User.create` também (dual-write): a coluna
    // `User.papel` foi derrubada e RESTAURADA nesta mesma tarefa — o DROP
    // provou seguro para os dados, mas revelou um terceiro grupo de leitores
    // (`core/audit/alerta.ts` em produção, mais ~20 arquivos de teste/e2e)
    // fora do escopo desta tarefa. Até esses leitores migrarem para
    // `Membership` numa tarefa dedicada, `User.papel` precisa continuar
    // correto também para gente criada DEPOIS da restauração — não só para
    // quem já existia quando ela rodou. `Membership.papel` é a fonte que
    // este módulo LÊ; `User.papel` é só o bridge escrito para não quebrar os
    // leitores antigos.
```

por:

```ts
    // `papel` vai SÓ para `Membership`. A coluna espelho `User.papel` existiu
    // entre 2026-08-19 e 2026-08-21 como ponte para leitores que o DROP do
    // Ciclo 1a revelou tarde demais; o Ciclo 1f migrou todos e a derrubou. O
    // parâmetro continua aqui porque o VÍNCULO precisa dele — papel é atributo
    // do vínculo, e é de lá que `usuarioAtual()` o lê (`core/auth/session.ts`).
    //
    // A volta é travada por `tests/unit/user-papel-nao-volta.test.ts`, que lê
    // este arquivo como texto e reprova `papel` dentro de qualquer chamada a
    // `prisma.user.*`. Textual, e não apoiada no `tsc`, porque o compilador
    // deixa passar o campo excedente quando ele atravessa um `.map()`.
```

E trocar a linha 264:

```ts
        data: { nome, email, senhaHash, papel },
```

por:

```ts
        data: { nome, email, senhaHash },
```

**Não mexer** na linha 267 (`tx.membership.create({ data: { userId: usuario.id, companyId, papel } })`)
nem na linha 271 (`const resultado: UsuarioListado = { ...criado, papel };`): as
duas continuam corretas, e a segunda é o que faz o retorno da função não mudar.

- [ ] **Step 3: `atualizarUsuario` para de gravar na coluna**

No mesmo arquivo, trocar o parágrafo das linhas 355-358:

```ts
  // `User.papel` também é regravado aqui — mesmo dual-write de `criarUsuario`
  // (ver o comentário lá): a coluna é um bridge temporário para os leitores
  // que o DROP desta tarefa revelou fora do escopo dela, e precisa continuar
  // correta quando o papel de alguém muda, não só na criação.
```

por:

```ts
  // O `papel` novo vai SÓ para `Membership`, mesma razão de `criarUsuario`
  // (ver o comentário lá): a coluna espelho `User.papel` foi derrubada no
  // Ciclo 1f e o vínculo é a única fonte. `tx.user.update` continua existindo
  // nesta transação porque `nome` É atributo da pessoa, não do vínculo.
```

E trocar a linha 370:

```ts
      data: { nome, papel },
```

por:

```ts
      data: { nome },
```

**Não mexer** no `tx.membership.updateMany` das linhas 373-376 nem em
`const depois: UsuarioListado = { ...usuarioAtualizado, papel };` (linha 380).

- [ ] **Step 4: `prisma/seed.ts` — os três escritores**

Trocar o comentário das linhas 190-196:

```ts
  // `papel` grava nas DUAS colunas (dual-write): `User.papel` foi derrubada e
  // RESTAURADA nesta mesma tarefa — o DROP provou seguro para os dados, mas
  // revelou leitores fora do escopo dela (`core/audit/alerta.ts` em produção,
  // mais ~20 arquivos de teste/e2e). Até esses leitores migrarem para
  // `Membership`, `User.papel` continua sendo escrito aqui — o literal
  // também vai para `vincularAEmpresa`, que grava a mesma informação no
  // `Membership` (a fonte que `core/users/service.ts` lê).
```

por:

```ts
  // O papel vai SÓ para `vincularAEmpresa`, que grava no `Membership`. A
  // coluna espelho `User.papel` existiu como ponte entre 2026-08-19 e
  // 2026-08-21 e foi derrubada no Ciclo 1f; o vínculo é a única fonte, e é de
  // lá que `core/users/service.ts` e `usuarioAtual()` leem.
```

Trocar a linha 201:

```ts
    create: { nome: "Admin Exemplo", email: "admin@exemplo.com", senhaHash, papel: "ADMIN" },
```

por:

```ts
    create: { nome: "Admin Exemplo", email: "admin@exemplo.com", senhaHash },
```

Trocar a linha 208:

```ts
    create: { nome: "Vendedor Exemplo", email: "vendedor@exemplo.com", senhaHash, papel: "VENDEDOR" },
```

por:

```ts
    create: { nome: "Vendedor Exemplo", email: "vendedor@exemplo.com", senhaHash },
```

E, em `semearUsuarioSistemaWhatsapp`, apagar a linha 356:

```ts
      papel: "ADMIN",
```

do `data` de `prisma.user.create` (linhas 350-358). **A linha 360
(`await vincularAEmpresa(sistema.id, companyId, "ADMIN")`) NÃO muda** — é ela
que dá o papel ADMIN a essa conta, e `tests/unit/seed.test.ts:147-150` já
verifica exatamente isso.

- [ ] **Step 5: GREEN da trava e do typecheck**

```bash
npx vitest run tests/unit/user-papel-nao-volta.test.ts
npm run typecheck
```

Esperado: **9 casos verdes** com `EM_CONVERSAO` em 21 chaves, e `tsc` em zero.
Cole as duas saídas.

- [ ] **Step 6: Provar em runtime — ⚠️ ESTE PASSO REESCREVE SENHAS**

**AVISO AO DONO, e ele precisa aparecer no relatório desta tarefa:**
`tests/unit/seed.test.ts` chama `seed()` contra o banco de desenvolvimento real
e **reescreve o `senhaHash` de `admin@exemplo.com` e `vendedor@exemplo.com`**
para `SEED_PASSWORD` ou, na ausência dela, para `senha123` (⚠️ R1 do Ciclo 1a,
🔍 NV6 do Ciclo 2a). É o único arquivo que roda o seed, e é obrigatório aqui: é
a única prova de que o seed criando `User` SEM `papel` funciona contra o
Postgres. **Se essas senhas tiverem sido rotacionadas, rotacione de novo depois
deste passo.**

```bash
npx vitest run tests/unit/seed.test.ts tests/unit/users-service.test.ts tests/unit/users-ultimo-admin.test.ts
```

Esperado: tudo verde. `seed.test.ts` prova que o `upsert` sem `papel` insere; os
outros dois, que a gestão de equipe continua criando, editando e contando ADMIN
pelo vínculo. Se `users-service.test.ts` falhar, **pare e reporte a saída** —
ele ainda escreve `papel` na linha 66 e sai só na Task 10, então a falha seria
por outro motivo.

- [ ] **Step 7: Commit**

```bash
git add tests/unit/user-papel-nao-volta.test.ts src/core/users/service.ts prisma/seed.ts
git commit -m "$(cat <<'MSG'
feat(tenancy): o dual-write de User.papel morre, o vinculo fica sozinho

Os dois unicos escritores de producao da coluna espelho (criarUsuario e
atualizarUsuario) e os tres do seed. A ponte existia desde 2026-08-19 para
leitores que o DROP do Ciclo 1a revelou tarde demais; o Ciclo 1f migrou todos,
entao ela nao tem mais o que sustentar.

Nenhuma assinatura muda e nenhum retorno muda: UsuarioListado.papel ja vinha do
parametro validado, o mesmo valor gravado em Membership. Duas fontes de verdade
para autorizacao nao sao rede de seguranca, sao a falha esperando alguem ler a
errada -- o argumento e do spec do Ciclo 1a, e so agora da para cumpri-lo.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: As fixtures de e2e

**DEPENDE DE AÇÃO DO DONO:** não.

Quatro escritores em três arquivos (`medicao:89-92`). Nenhum leitor: os três
arquivos de e2e que a auditoria do Ciclo 1a chamava de "leitores" são
escritores (`medicao:257`), e a correção dessa frase é da Task 12.

**Files:**
- Modify: `tests/unit/user-papel-nao-volta.test.ts` (só `EM_CONVERSAO`)
- Modify: `tests/e2e/global-setup.ts`
- Modify: `tests/e2e/sessao-e-cache.spec.ts`
- Modify: `tests/e2e/whatsapp-agente.spec.ts`

**Interfaces:**
- Consumes: `prisma` (`src/lib/prisma`), modelo `Membership` com
  `@@unique([userId, companyId])` — a chave `userId_companyId` que
  `global-setup.ts:83` já usa; `EM_CONVERSAO` (Task 3).
- Produces: `EM_CONVERSAO` cai de 21 para **18** chaves. Nenhuma mudança de
  comportamento: os três arquivos já criavam o `Membership` com o papel certo.

- [ ] **Step 1: RED — tirar os três da lista**

Em `tests/unit/user-papel-nao-volta.test.ts`, **apagar** o bloco:

```ts
  // Ciclo 1f, Task 8 — fixtures de e2e.
  "tests/e2e/global-setup.ts": "Task 8",
  "tests/e2e/sessao-e-cache.spec.ts": "Task 8",
  "tests/e2e/whatsapp-agente.spec.ts": "Task 8",

```

```bash
npx vitest run tests/unit/user-papel-nao-volta.test.ts
```

Esperado: **FALHA** nomeando os três. Cole a saída.

- [ ] **Step 2: `global-setup.ts`**

Trocar as linhas 57-62:

```ts
    const usuario = await prisma.user.upsert({
      where: { email },
      update: { senhaHash, ativo: true, papel },
      create: { nome, email, senhaHash, papel },
      select: { id: true },
    });
```

por:

```ts
    const usuario = await prisma.user.upsert({
      where: { email },
      update: { senhaHash, ativo: true },
      create: { nome, email, senhaHash },
      select: { id: true },
    });
```

A variável `papel` do `for...of` (linha 53) **continua sendo usada**, pelo
`membership.upsert` das linhas 82-86. Não a remova da desestruturação.

Trocar o comentário das linhas 79-81:

```ts
    // `update: { papel }` pelo mesmo motivo que o `upsert` do usuário regrava o
    // papel: um teste de permissão que troque o papel e falhe no meio deixaria
    // o vínculo com o papel errado para a execução seguinte.
```

por:

```ts
    // `update: { papel }` e não só `create`: um teste de permissão que troque o
    // papel e falhe no meio deixaria o vínculo com o papel errado para a
    // execução seguinte. Este é o ÚNICO lugar onde o papel destas contas é
    // gravado desde o Ciclo 1f — a coluna espelho `User.papel`, que o `upsert`
    // acima também regravava, não existe mais.
```

- [ ] **Step 3: `sessao-e-cache.spec.ts`**

Apagar a linha 241:

```ts
      papel: "VENDEDOR",
```

do `data` de `prisma.user.create` (linhas 233-244). **A linha 243
(`memberships: { create: { companyId: empresa.id, papel: "VENDEDOR" } }`) NÃO
muda** — é ela que dá o papel.

- [ ] **Step 4: `whatsapp-agente.spec.ts`**

Apagar a linha 333:

```ts
      papel: "VENDEDOR",
```

do `data` de `prisma.user.create` (linhas 327-347). **A linha 345
(`memberships: { create: { companyId: empresaId, papel: "VENDEDOR" } }`) NÃO
muda**, e o comentário das linhas 334-344 que a explica também não.

- [ ] **Step 5: GREEN da trava e do typecheck**

```bash
npx vitest run tests/unit/user-papel-nao-volta.test.ts
npm run typecheck
```

Esperado: **9 casos verdes** com `EM_CONVERSAO` em 18 chaves, e `tsc` em zero
(o `tsc` cobre `tests/e2e/` — é o mesmo `tsconfig.json`). Cole as duas saídas.

- [ ] **Step 6: NÃO rodar a suíte e2e aqui, e por quê**

`npm run test:e2e` sobe o Next, ocupa porta, roda com `workers: 3` contra o
mesmo banco e leva minutos. Rodá-la agora provaria pouco: a coluna ainda existe
e continua aceitando nulo, então uma fixture que parou de escrevê-la não tem
como falhar. **A prova de e2e é da Task 11, Step 9**, com a coluna já derrubada
— é lá que `Unknown argument 'papel'` apareceria se algo tivesse escapado.

Registrar isto no relatório da tarefa como decisão, não como esquecimento.

- [ ] **Step 7: Commit**

```bash
git add tests/unit/user-papel-nao-volta.test.ts tests/e2e/global-setup.ts tests/e2e/sessao-e-cache.spec.ts tests/e2e/whatsapp-agente.spec.ts
git commit -m "$(cat <<'MSG'
test(e2e): as fixtures param de escrever a coluna espelho

Quatro escritores em tres arquivos. Nenhum deles perde informacao: os tres ja
criavam o Membership com o papel certo, e era ele que valia. A auditoria do
Ciclo 1a chamava estes tres de "leitores" -- nao sao, e a correcao dessa frase
vai junto com o resto da prosa.

A suite e2e nao roda nesta tarefa de proposito: com a coluna ainda existindo e
aceitando nulo, uma fixture que parou de escreve-la nao tem como falhar. A
prova de e2e e depois do DROP, que e onde `Unknown argument 'papel'` apareceria.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: As fixtures da família "isolamento" — 8 arquivos, 16 escritores

**DEPENDE DE AÇÃO DO DONO:** não.

Oito arquivos com a mesma forma: `prisma.user.createMany` (ou `create`) montando
"Ana da A" e "Bruno da B", seguido de `prisma.membership.createMany` que dá o
papel de verdade. A coluna espelho sai; o vínculo fica. **Nenhum deles perde
informação** — sete já trazem escrito, em comentário, que é o vínculo que define
"pessoa desta empresa".

Um deles é especial e é a razão de esta trava ser textual:
`audit-isolamento.test.ts:158-164` monta os dados por `.map()`, e por isso
**passa no `tsc` mesmo com a coluna fora do schema** (`medicao:186-207`). Ele é
o primeiro a ser consertado neste lote.

**Files:**
- Modify: `tests/unit/user-papel-nao-volta.test.ts` (só `EM_CONVERSAO`)
- Modify: `tests/unit/audit-isolamento.test.ts`
- Modify: `tests/unit/contact-isolamento.test.ts`
- Modify: `tests/unit/lead-isolamento.test.ts`
- Modify: `tests/unit/notificacoes-isolamento.test.ts`
- Modify: `tests/unit/pipeline-isolamento.test.ts`
- Modify: `tests/unit/task-isolamento.test.ts`
- Modify: `tests/unit/unicidades-por-empresa.test.ts`
- Modify: `tests/unit/whatsapp-isolamento.test.ts`

**Interfaces:**
- Consumes: `prisma` (`src/lib/prisma`), `EM_CONVERSAO` (Task 3).
- Produces: `EM_CONVERSAO` cai de 18 para **10** chaves. Nenhuma assinatura,
  nenhum `describe`, nenhuma asserção muda — só as fixtures.

**Regra que vale para os oito, e que o subagente confere linha a linha:** apagar
`papel` **só** quando ele estiver no payload de `prisma.user.*`. Todo `papel`
que estiver dentro de `prisma.membership.*` ou de `memberships: { create: ... }`
**FICA** — é ele que carrega o papel de verdade. Na dúvida sobre uma linha,
**pare e reporte**; não apague por semelhança.

- [ ] **Step 1: RED — tirar os oito da lista**

Em `tests/unit/user-papel-nao-volta.test.ts`, **apagar** o bloco:

```ts
  // Ciclo 1f, Task 9 — fixtures da família "isolamento".
  "tests/unit/audit-isolamento.test.ts": "Task 9",
  "tests/unit/contact-isolamento.test.ts": "Task 9",
  "tests/unit/lead-isolamento.test.ts": "Task 9",
  "tests/unit/notificacoes-isolamento.test.ts": "Task 9",
  "tests/unit/pipeline-isolamento.test.ts": "Task 9",
  "tests/unit/task-isolamento.test.ts": "Task 9",
  "tests/unit/unicidades-por-empresa.test.ts": "Task 9",
  "tests/unit/whatsapp-isolamento.test.ts": "Task 9",

```

```bash
npx vitest run tests/unit/user-papel-nao-volta.test.ts
```

Esperado: **FALHA** nomeando os oito arquivos. Cole a saída — repare que
`audit-isolamento.test.ts` está entre eles, e que o `tsc` **não** o acusaria.

- [ ] **Step 2: `audit-isolamento.test.ts` — o caso que o compilador não pega**

Trocar as linhas 157-165:

```ts
  await prisma.user.createMany({
    data: [USUARIO_DUPLO, ADMIN_A, ADMIN_B].map((id) => ({
      id,
      nome: `Pessoa ${id}`,
      email: `${id}@exemplo.invalido`,
      senhaHash: SENHA_FALSA,
      papel: "ADMIN" as const,
    })),
  });
```

por:

```ts
  // Sem `papel`: a coluna espelho `User.papel` foi derrubada no Ciclo 1f, e o
  // papel das três pessoas vem do `membership.createMany` logo abaixo.
  //
  // Esta chamada é o motivo de a trava do ciclo ser TEXTUAL e não apoiada no
  // `tsc`. Com `papel` aqui dentro, ela passava no `npm run typecheck` mesmo
  // com o campo fora do schema: a checagem de propriedade excedente do
  // TypeScript só vale para objeto literal FRESCO atribuído direto ao
  // parâmetro, e passando por `.map()` o tipo do elemento é inferido do
  // retorno do callback — o excesso some. Em runtime o Prisma lançaria
  // `Unknown argument 'papel'`. Foi o único caso desse formato no repositório
  // (`.superpowers/sdd/medicao-user-papel.md` § 4, passo 3), e achá-lo é a
  // razão principal para acreditar que o inventário do ciclo fechou.
  await prisma.user.createMany({
    data: [USUARIO_DUPLO, ADMIN_A, ADMIN_B].map((id) => ({
      id,
      nome: `Pessoa ${id}`,
      email: `${id}@exemplo.invalido`,
      senhaHash: SENHA_FALSA,
    })),
  });
```

O `prisma.membership.createMany` das linhas 170-177 **não muda**.

- [ ] **Step 3: `contact-isolamento.test.ts`**

Apagar as linhas 264 e 271 — as duas são `papel: "ADMIN",` dentro dos dois
objetos de `prisma.user.createMany` (linhas 257-274). O
`prisma.membership.createMany` das linhas 276-280 **não muda**.

- [ ] **Step 4: `lead-isolamento.test.ts`**

Apagar as linhas 238 e 245, dentro de `prisma.user.createMany` (linhas 231-248).
O comentário das linhas 250-253 (*"O vínculo, e não `User.papel`, é o que define
'pessoa desta empresa'"*) **fica**: ele descreve exatamente o estado que passa a
valer.

- [ ] **Step 5: `notificacoes-isolamento.test.ts`**

Apagar a linha 134, dentro de `prisma.user.create` (linhas 128-136). O
`prisma.membership.createMany` das linhas 138-142 **não muda**.

- [ ] **Step 6: `pipeline-isolamento.test.ts`**

Apagar as linhas 270, 277 e 284 — as três dentro de `prisma.user.createMany`
(linhas 263-287). O comentário das linhas 289-292 **fica**.

- [ ] **Step 7: `task-isolamento.test.ts`**

Apagar as linhas 243, 250 e 257 — as três dentro de `prisma.user.createMany`
(linhas 236-260). O comentário das linhas 262-265 **fica**.

- [ ] **Step 8: `unicidades-por-empresa.test.ts`**

Apagar as linhas 209 e 216, dentro de `prisma.user.createMany` (linhas 202-219).
O comentário das linhas 221-224 **fica**.

- [ ] **Step 9: `whatsapp-isolamento.test.ts`**

Apagar as linhas 321 e 328, dentro de `prisma.user.createMany` (linhas 314-331).
O comentário das linhas 333-336 **fica**.

- [ ] **Step 10: GREEN — trava, typecheck e os oito arquivos**

```bash
npx vitest run tests/unit/user-papel-nao-volta.test.ts
npm run typecheck
```

Esperado: **9 casos verdes** com `EM_CONVERSAO` em 10 chaves, e `tsc` em zero.

Depois os oito, num comando só:

```bash
npx vitest run tests/unit/audit-isolamento.test.ts tests/unit/contact-isolamento.test.ts tests/unit/lead-isolamento.test.ts tests/unit/notificacoes-isolamento.test.ts tests/unit/pipeline-isolamento.test.ts tests/unit/task-isolamento.test.ts tests/unit/unicidades-por-empresa.test.ts tests/unit/whatsapp-isolamento.test.ts
```

Esperado: tudo verde. Se algum falhar por papel — algo do tipo "esperava ADMIN,
veio VENDEDOR" ou uma consulta de destinatários vazia — a linha apagada era do
`Membership` e não do `User`: **pare e reporte** com o arquivo e a linha, e
reponha antes de qualquer outra coisa. Cole as três saídas.

- [ ] **Step 11: Commit**

```bash
git add tests/unit/user-papel-nao-volta.test.ts tests/unit/audit-isolamento.test.ts tests/unit/contact-isolamento.test.ts tests/unit/lead-isolamento.test.ts tests/unit/notificacoes-isolamento.test.ts tests/unit/pipeline-isolamento.test.ts tests/unit/task-isolamento.test.ts tests/unit/unicidades-por-empresa.test.ts tests/unit/whatsapp-isolamento.test.ts
git commit -m "$(cat <<'MSG'
test(tenancy): as fixtures de isolamento param de escrever a coluna espelho

Dezesseis escritores em oito arquivos, todos com a mesma forma: cria "Ana da A"
e "Bruno da B" e loga o papel de verdade no membership.createMany logo abaixo.
Sete deles ja traziam escrito em comentario que e o vinculo que define "pessoa
desta empresa" -- so o codigo e que ainda nao acompanhava.

audit-isolamento vem primeiro de proposito: e o unico do repositorio que monta
os dados por .map(), e por isso passava no typecheck mesmo com o campo fora do
schema. A checagem de propriedade excedente so vale para literal fresco
atribuido direto ao parametro. E o caso que justifica a trava do ciclo ser
textual, e sem ele o inventario teria fechado com um buraco.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 10: As dez fixtures restantes — `EM_CONVERSAO` chega a zero

**DEPENDE DE AÇÃO DO DONO:** não.

O último lote de escritores: 17 pontos em 10 arquivos. Ao final, a lista está
**vazia** e nada no repositório menciona `papel` dentro de uma chamada a
`prisma.user.*`.

Dois deles não são apagar-uma-linha e precisam de atenção:

- **`alerta-atividade.test.ts:225` e `:248`** são STATEMENTS inteiros
  (`prisma.user.update(...)`), não campos dentro de um payload maior. Somem
  inteiros, junto com o comentário que os explica.
- **`users-service.test.ts:54-60`** tem um parágrafo de comentário que só existe
  por causa do dual-write, e que fica falso na hora em que a linha 66 sair.

**Files:**
- Modify: `tests/unit/user-papel-nao-volta.test.ts` (só `EM_CONVERSAO`)
- Modify: `tests/unit/alerta-atividade.test.ts`
- Modify: `tests/unit/audit-log.test.ts`
- Modify: `tests/unit/contacts-service.test.ts`
- Modify: `tests/unit/dono-integracao.test.ts`
- Modify: `tests/unit/notificacoes-poda.test.ts`
- Modify: `tests/unit/session.test.ts`
- Modify: `tests/unit/tasks.test.ts`
- Modify: `tests/unit/users-service.test.ts`
- Modify: `tests/unit/whatsapp-envio-por-conexao.test.ts`
- Modify: `tests/unit/whatsapp-notificacoes.test.ts`

**Interfaces:**
- Consumes: `prisma` (`src/lib/prisma`), `EM_CONVERSAO` (Task 3).
- Produces: `EM_CONVERSAO` **vazio** (`{}`), com o comentário do bloco reescrito
  para dizer que zero é o valor final e que a lista não aceita entrada nova.

**Mesma regra da Task 9:** `papel` dentro de `prisma.membership.*` ou de
`memberships: { create: ... }` **FICA**. Na dúvida, **pare e reporte**.

- [ ] **Step 1: RED — esvaziar a lista**

Em `tests/unit/user-papel-nao-volta.test.ts`, trocar o corpo inteiro de
`EM_CONVERSAO` (o bloco de dez entradas rotulado `// Ciclo 1f, Task 10 — ...`)
para deixar o objeto **vazio**, e reescrever o docstring dele. O resultado final
é:

```ts
/**
 * Arquivos que ainda mencionam `papel` numa chamada a `prisma.user.*`.
 *
 * **ZERO, e é o valor final.** A lista nasceu com 29 no início do Ciclo 1f e
 * foi esvaziada pelas Tasks 4, 7, 8, 9 e 10. Com ela vazia, "não cresceu" e
 * "está vazia" viraram a mesma afirmação — mesmo estado em que
 * `catraca-prisma-cru.test.ts` deixou `LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS`.
 *
 * **Entrada nova aqui não é conserto, é a coluna voltando.** As duas asserções
 * abaixo travam as duas direções: arquivo que viola e não está listado reprova,
 * e arquivo listado que já não viola também reprova. A segunda é o que impede a
 * lista de virar depósito.
 */
const EM_CONVERSAO: Record<string, string> = {};
```

```bash
npx vitest run tests/unit/user-papel-nao-volta.test.ts
```

Esperado: **FALHA** nomeando os dez arquivos restantes. Cole a saída.

- [ ] **Step 2: `alerta-atividade.test.ts` — quatro campos e dois statements**

Apagar as linhas 100, 118, 127 e 355 (`papel: "VENDEDOR",` e três
`papel: "ADMIN",`), cada uma dentro de um `prisma.user.create`. Os
`prisma.membership.create` das linhas 110-112 e 359-361 **não mudam**, e o
comentário das linhas 104-109 e o das 131-135 também não.

Trocar as linhas 222-229:

```ts
    // `Membership.papel`, não só `User.papel`: é de lá que a consulta de
    // destinatários lê hoje. Atualizar as duas colunas é o mesmo dual-write
    // que `core/users/service.ts` faz em produção.
    await prisma.user.update({ where: { id: idSuspeito }, data: { papel: "ADMIN" } });
    await prisma.membership.updateMany({
      where: { userId: idSuspeito, companyId },
      data: { papel: "ADMIN" },
    });
```

por:

```ts
    // Só `Membership.papel`: é de lá que a consulta de destinatários lê
    // (`core/audit/alerta.ts:210-217`, desde 3744e64), e a coluna espelho
    // `User.papel` que este bloco também atualizava foi derrubada no Ciclo 1f.
    await prisma.membership.updateMany({
      where: { userId: idSuspeito, companyId },
      data: { papel: "ADMIN" },
    });
```

E trocar as linhas 248-252 (dentro do `finally`):

```ts
      await prisma.user.update({ where: { id: idSuspeito }, data: { papel: "VENDEDOR" } });
      await prisma.membership.updateMany({
        where: { userId: idSuspeito, companyId },
        data: { papel: "VENDEDOR" },
      });
```

por:

```ts
      await prisma.membership.updateMany({
        where: { userId: idSuspeito, companyId },
        data: { papel: "VENDEDOR" },
      });
```

- [ ] **Step 3: `audit-log.test.ts`**

Apagar a linha 53 (`papel: "VENDEDOR",`), dentro de `prisma.user.create`
(linhas 48-56). **A linha 54
(`memberships: { create: { companyId, papel: "VENDEDOR" } }`) NÃO muda** — é ela
que dá o papel.

- [ ] **Step 4: `contacts-service.test.ts`**

Apagar a linha 49 (`papel: "ADMIN",`), dentro de `prisma.user.create`
(linhas 44-51). O comentário das linhas 54-58 e o `Membership` que ele explica
**não mudam**.

- [ ] **Step 5: `dono-integracao.test.ts`**

Apagar as linhas 75 e 84 (`papel: "VENDEDOR",`), dentro dos dois
`prisma.user.create` (linhas 70-78 e 79-87). O comentário das linhas 91-95
**fica**.

- [ ] **Step 6: `notificacoes-poda.test.ts`**

Apagar a linha 60 (`papel: "VENDEDOR",`), dentro de `prisma.user.create`
(linhas 55-63). **A linha 61 (`ativo: false,`) NÃO muda.**

- [ ] **Step 7: `session.test.ts`**

Apagar as linhas 71 e 83 (`papel: "ADMIN",` e `papel: "VENDEDOR",`), dentro dos
dois `prisma.user.create` (linhas 66-75 e 78-87). **As linhas 73 e 85
(`memberships: { create: { companyId: idEmpresa, papel: "VENDEDOR" } }`) NÃO
mudam** — são elas que dão o papel, e são o caso que a trava textual da Task 3
prova NÃO acusar.

Trocar o comentário das linhas 59-65:

```ts
    // VENDEDOR). `User.papel` foi derrubada e RESTAURADA nesta mesma tarefa
    // — o DROP revelou leitores fora do escopo dela (`core/audit/alerta.ts`
    // em produção, entre outros) e a coluna voltou como bridge temporário
    // (`core/users/service.ts` grava nas duas agora); este teste continua
    // valendo, e com a coluna de volta o "deliberadamente diferente" volta a
    // ser possível de escrever.
```

por:

```ts
    // VENDEDOR). A coluna espelho `User.papel`, que este bloco também gravava
    // com valor deliberadamente diferente, foi derrubada no Ciclo 1f — a
    // divergência que ela permitia expressar mudou de lugar e vive hoje em
    // `LINHA_HOSTIL`, em `tests/unit/usuario-ativo.test.ts`. Aqui o papel vem
    // do vínculo, e o vínculo é a única fonte.
```

**Antes de aplicar esta troca**, confira que as linhas 59-65 são de fato esse
texto: o trecho começa no meio de uma frase (a linha 58 e anteriores a
completam), e o subagente precisa preservar o começo dela. Se a frase anterior
mencionar o dual-write, ela entra na troca também. **Se o texto não bater, pare
e reporte.**

- [ ] **Step 8: `tasks.test.ts` — o escritor que sobrou da Task 4**

Apagar a linha 178 (`papel: "VENDEDOR",`), dentro de `prisma.user.create`
(linhas 173-181). **A linha 179 (`ativo: false,`) NÃO muda** — é o ponto do
teste. O comentário das linhas 182-188 também não.

Os dois LEITORES deste arquivo já saíram na Task 4; é este escritor que o
mantinha em `EM_CONVERSAO`.

- [ ] **Step 9: `users-service.test.ts`**

Apagar a linha 66 (`papel: "ADMIN",`), dentro de `prisma.user.create`
(linhas 61-68). **A linha 70
(`await prisma.membership.create({ data: { userId: autorId, companyId, papel: "ADMIN" } })`)
NÃO muda.**

E trocar o parágrafo das linhas 53-60:

```ts
    //
    // `papel: "ADMIN"` também vai para `User` (não só para o `Membership`
    // logo abaixo): a coluna `User.papel` foi derrubada e RESTAURADA nesta
    // mesma tarefa como bridge temporário para leitores fora do escopo dela
    // (`core/audit/alerta.ts` em produção, entre outros) — `criarUsuario`
    // grava nas duas enquanto o bridge existir, e este `create` direto
    // (fora do serviço) precisa fazer o mesmo para não ficar com a coluna
    // NOT NULL sem valor.
```

por:

```ts
    //
    // O papel vai SÓ para o `Membership` logo abaixo. A coluna espelho
    // `User.papel`, que este `create` direto também precisava preencher
    // enquanto ela fosse NOT NULL, foi derrubada no Ciclo 1f — e
    // `criarUsuario` parou de gravá-la na mesma leva.
```

O parágrafo das linhas 47-52 (sobre `AuditLog.userId` ser FK obrigatória e o
autor precisar de vínculo ADMIN) **fica inteiro**: continua verdadeiro.

- [ ] **Step 10: `whatsapp-envio-por-conexao.test.ts`**

Apagar a linha 163 (`papel: "ADMIN",`), dentro de `prisma.user.create`
(linhas 157-165).

Trocar o comentário das linhas 166-169:

```ts
  // O vínculo, e não `User.papel`, é o que define "pessoa desta empresa"
  // (`User.papel` é espelho depreciado desde a8dd76a). Fixture que cria `User`
  // sem `Membership` produz usuário sem empresa nenhuma — bug latente de
  // e67e1e6.
```

por:

```ts
  // O vínculo é o que define "pessoa desta empresa", e desde o Ciclo 1f é a
  // única coisa que define o papel: a coluna espelho `User.papel` não existe
  // mais. Fixture que cria `User` sem `Membership` produz usuário sem empresa
  // nenhuma — bug latente de e67e1e6.
```

- [ ] **Step 11: `whatsapp-notificacoes.test.ts`**

Apagar a linha 247 (`papel: "VENDEDOR",`), dentro de `prisma.user.create`
(linhas 242-250). **A linha 248 (`ativo: true,`) NÃO muda**, e o
`prisma.membership.create` das linhas 251-253 também não.

- [ ] **Step 12: GREEN — a lista chega a zero**

```bash
npx vitest run tests/unit/user-papel-nao-volta.test.ts
npm run typecheck
```

Esperado: **9 casos verdes**, `EM_CONVERSAO` vazio, `tsc` em zero. Este é o
momento em que a afirmação "nada no repositório escreve ou lê `User.papel`
por chamada ao Prisma" passa a ser executada, e não presumida. Cole as saídas.

- [ ] **Step 13: Rodar os dez arquivos**

```bash
npx vitest run tests/unit/alerta-atividade.test.ts tests/unit/audit-log.test.ts tests/unit/contacts-service.test.ts tests/unit/dono-integracao.test.ts tests/unit/notificacoes-poda.test.ts tests/unit/session.test.ts tests/unit/tasks.test.ts tests/unit/users-service.test.ts tests/unit/whatsapp-envio-por-conexao.test.ts tests/unit/whatsapp-notificacoes.test.ts
```

Esperado: tudo verde. `alerta-atividade.test.ts` é o mais exposto — ele mexe em
papel no meio de um teste e desfaz no `finally` —, então se algo falhar, comece
por ele. **Pare e reporte** com a saída. Cole a saída.

- [ ] **Step 14: Commit**

```bash
git add tests/unit/user-papel-nao-volta.test.ts tests/unit/alerta-atividade.test.ts tests/unit/audit-log.test.ts tests/unit/contacts-service.test.ts tests/unit/dono-integracao.test.ts tests/unit/notificacoes-poda.test.ts tests/unit/session.test.ts tests/unit/tasks.test.ts tests/unit/users-service.test.ts tests/unit/whatsapp-envio-por-conexao.test.ts tests/unit/whatsapp-notificacoes.test.ts
git commit -m "$(cat <<'MSG'
test(tenancy): EM_CONVERSAO chega a zero, nada mais toca a coluna espelho

Dezessete escritores em dez arquivos, o ultimo lote. Com a lista vazia, "nao
cresceu" e "esta vazia" viraram a mesma afirmacao -- mesmo estado em que a
catraca de prisma cru foi deixada no Ciclo 1d.

Dois nao eram apagar-uma-linha: alerta-atividade trocava o papel do suspeito nas
DUAS colunas no meio de um teste, e o statement do User some inteiro junto com o
comentario que o justificava; users-service carregava um paragrafo que so
existia para explicar por que um create direto precisava preencher a coluna
NOT NULL. A prosa que a mudanca tornou falsa sai junto com o codigo, nao depois.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 11: A trava de schema (RED) e o `DROP COLUMN` (GREEN)

**DEPENDE DE AÇÃO DO DONO:** não.

A contração. Chega aqui com `EM_CONVERSAO` vazio, o `tsc` em zero e 53 pontos
convertidos. Esta tarefa escreve a asserção que **falha enquanto a coluna
existir** e a derruba para deixá-la verde.

Aqui o `tsc` muda de papel: nas três tentativas do Ciclo 1a ele era o
instrumento de DESCOBERTA, e descobria tarde. Aqui ele é **confirmação** — o
esperado é zero erros no Step 7, e um erro sequer significa que o inventário
falhou, não que resta trabalho.

**Files:**
- Modify: `tests/unit/user-papel-nao-volta.test.ts`
- Create: `prisma/migrations/20260821130000_derruba_user_papel_de_vez/migration.sql`
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Consumes: `model User` e `model Membership` (`prisma/schema.prisma`);
  `analisar` e a varredura (Task 3); `EM_CONVERSAO` vazio (Task 10).
- Produces:
  - `export function blocoDoModelo(schema: string, modelo: string): string`
  - `export function camposDoModelo(bloco: string): string[]`
  - Três casos novos em `user-papel-nao-volta.test.ts` (total: **12**).
  - Coluna `"User"."papel"` **fora** do Postgres.
  - `User.papel` fora do client gerado: qualquer `where`/`data`/`select` com
    `papel` sobre `user` passa a ser erro de tipo E erro de runtime.

- [ ] **Step 1: RED — a asserção de schema**

Em `tests/unit/user-papel-nao-volta.test.ts`, acrescentar aos imports:

```ts
const SCHEMA = readFileSync(join(RAIZ, "prisma", "schema.prisma"), "utf8");
```

(logo depois de `const ESTE_ARQUIVO = ...`), e, **antes** do bloco
`// ─── O analisador ───`, acrescentar:

```ts
/**
 * O corpo de um `model` do schema, sem o cabeçalho e sem a chave de fecho.
 *
 * Lido do `prisma/schema.prisma` como TEXTO, e não do client gerado, pelo
 * mesmo motivo que `catraca-prisma-cru.test.ts:136-145` dá para não importar
 * `MODELOS_DE_TENANT`: o schema é a fonte, o client é derivado, e um client
 * desatualizado no disco faria este teste afirmar o passado.
 */
export function blocoDoModelo(schema: string, modelo: string): string {
  const linhas = schema.replace(/\r\n/g, "\n").split("\n");
  const inicio = linhas.findIndex((l) => new RegExp(`^model\\s+${modelo}\\s*\\{`).test(l));
  if (inicio === -1) return "";

  const fim = linhas.findIndex((l, i) => i > inicio && /^\}/.test(l));
  return linhas.slice(inicio + 1, fim === -1 ? linhas.length : fim).join("\n");
}

/**
 * Os nomes de campo declarados num bloco de `model`.
 *
 * `^\s*(\w+)\s+\w` casa `papel Role` e `id String`, e NÃO casa `/// prosa`,
 * `@@unique([...])` nem linha em branco — a prosa deste schema menciona
 * `papel` dezenas de vezes, e contá-la como declaração inverteria o
 * resultado.
 */
export function camposDoModelo(bloco: string): string[] {
  return bloco
    .split("\n")
    .map((linha) => /^\s*(\w+)\s+\w/.exec(linha)?.[1])
    .filter((nome): nome is string => nome !== undefined);
}
```

E, **dentro** do `describe("User.papel não volta", ...)`, ao final, acrescentar:

```ts
  it("`model User` não tem campo `papel`", () => {
    const bloco = blocoDoModelo(SCHEMA, "User");

    // Sem isto, um `model User` renomeado devolveria bloco vazio e a asserção
    // seguinte passaria por não ter lido nada.
    expect(bloco.length, "não achei `model User` em prisma/schema.prisma").toBeGreaterThan(0);

    expect(
      camposDoModelo(bloco),
      "`User.papel` voltou ao schema. Papel é atributo do VÍNCULO: a mesma " +
        "pessoa pode ser ADMIN numa empresa e VENDEDOR em outra, e uma coluna " +
        "em `User` só tem resposta certa enquanto cada pessoa tiver uma " +
        "empresa só. A coluna foi derrubada no Ciclo 1f depois de quatro " +
        "tentativas; ver `.superpowers/sdd/medicao-user-papel.md`."
    ).not.toContain("papel");
  });

  it("`model Membership` TEM o campo papel — a fonte de verdade continua de pé", () => {
    // A outra metade. Sem ela, apagar `Membership.papel` por engano deixaria a
    // asserção acima verde e o projeto sem nenhuma fonte de papel.
    expect(camposDoModelo(blocoDoModelo(SCHEMA, "Membership"))).toContain("papel");
  });

  it("o leitor de schema distingue os dois casos — prova de que morde", () => {
    // Prova de que o leitor não é decorativo: aplicado a um `model User` COM a
    // coluna, ele precisa encontrá-la. Sem isto, um regex quebrado devolveria
    // lista vazia e as duas asserções acima ficariam verdes para sempre.
    const comAColunaDeVolta = [
      "model User {",
      "  id                 String               @id @default(cuid())",
      "  nome               String",
      "  /// papel aqui em prosa NÃO conta como declaração",
      "  papel              Role",
      "  ativo              Boolean              @default(true)",
      "}",
    ].join("\n");

    expect(camposDoModelo(blocoDoModelo(comAColunaDeVolta, "User"))).toContain("papel");
    expect(camposDoModelo(blocoDoModelo(comAColunaDeVolta, "User"))).toContain("ativo");
  });
```

```bash
npx vitest run tests/unit/user-papel-nao-volta.test.ts
```

Esperado: **FALHA** em ``model User` não tem campo `papel``, com a lista de
campos incluindo `papel`. Os outros 11 casos passam. Cole a saída — é o RED
desta tarefa.

- [ ] **Step 2: Provar que nada FORA do repositório depende da coluna**

`medicao:229-234` deixou isto como 🔍 NÃO VERIFICADO, com o comando. Este é o
comando, e ele roda agora.

```bash
npx tsx --conditions=react-server -e "import 'dotenv/config'; import { PrismaClient } from '@prisma/client'; import { PrismaPg } from '@prisma/adapter-pg'; const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) }); const r = await p.\$queryRaw\`SELECT 'view' AS tipo, schemaname || '.' || viewname AS nome FROM pg_views WHERE schemaname NOT IN ('pg_catalog','information_schema') AND definition ILIKE '%papel%' UNION ALL SELECT 'matview', schemaname || '.' || matviewname FROM pg_matviews WHERE schemaname NOT IN ('pg_catalog','information_schema') AND definition ILIKE '%papel%' UNION ALL SELECT 'function', n.nspname || '.' || p2.proname FROM pg_proc p2 JOIN pg_namespace n ON n.oid = p2.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND p2.prokind = 'f' AND pg_get_functiondef(p2.oid) ILIKE '%papel%' UNION ALL SELECT 'policy', schemaname || '.' || tablename || '.' || policyname FROM pg_policies WHERE (coalesce(qual,'') || coalesce(with_check,'')) ILIKE '%papel%' UNION ALL SELECT 'index', 'public.' || indexname FROM pg_indexes WHERE tablename = 'User' AND indexdef ILIKE '%papel%'\`; console.log(JSON.stringify(r)); await p.\$disconnect();"
```

Esperado: `[]`. Qualquer linha devolvida é um objeto no banco que depende da
coluna — **pare e reporte**, não use `CASCADE`.

Registrar no relatório: **o `DROP COLUMN` sem `CASCADE` já é uma segunda
defesa.** O Postgres RECUSA derrubar coluna de que uma view, índice, constraint
ou coluna gerada dependa. Esta consulta existe para dar uma resposta legível
ANTES, em vez de um erro no meio da migração.

O que esta consulta **não** alcança, e continua 🔍 NÃO VERIFICADO: SQL que vive
fora do banco e fora do repositório — um nó Postgres num workflow de
`n8n.nateksoft.com`, ou uma consulta salva no Supabase Studio. O comando que um
humano roda para fechar isso está na § "NÃO VERIFICADO" da Task 13.

- [ ] **Step 3: Escrever a migração**

Criar `prisma/migrations/20260821130000_derruba_user_papel_de_vez/migration.sql`:

```sql
-- Ciclo 1f: derruba "User"."papel". De vez.
--
-- ## Por que "de vez"
--
-- A coluna já foi derrubada uma vez, por 20260819130000_derruba_user_papel, e
-- restaurada horas depois por 20260819140000_restaura_user_papel_temporariamente.
-- Aquela tentativa foi a terceira do Ciclo 1a, e as três falharam pelo mesmo
-- mecanismo: quem media achava um grupo de leitores, concluía que era o
-- alcance total, e um grupo novo aparecia DEPOIS do ponto sem volta.
--
-- O que mudou: a medição de 2026-08-21
-- (.superpowers/sdd/medicao-user-papel.md) mediu com DOIS instrumentos
-- independentes e achou o buraco do primeiro. O `tsc`, rodado num worktree
-- descartável contra uma linha de base comprovadamente zerada, apontou 62
-- erros -- todos atribuíveis ao campo, e a nada mais. A varredura textual
-- achou o que ele não pega: `papel` escrito através de `.map()`
-- (tests/unit/audit-isolamento.test.ts:163) passava no typecheck, porque a
-- checagem de propriedade excedente do TypeScript só vale para objeto literal
-- fresco atribuído direto ao parâmetro.
--
-- Superfície real: 32 arquivos, 11 leitores e 42 escritores, NENHUM leitor em
-- `src/`. Não os ~80 que o comentário do schema afirmava -- aquele número
-- contava prosa e `Membership.papel` junto.
--
-- ## Como este DROP é diferente do anterior
--
-- 1. Os 53 pontos foram convertidos ANTES, em commits separados, cada um com
--    a árvore compilando e a suíte verde. O DROP anterior veio primeiro e
--    quebrou 26 lugares de uma vez, com a coluna já fora do banco.
-- 2. A coluna passou por 20260821120000_user_papel_aceita_nulo antes, porque
--    ela era NOT NULL sem DEFAULT e parar de escrevê-la produziria 23502 --
--    o incidente de 20260813200000, pela porta oposta.
-- 3. Existe uma trava permanente contra a volta:
--    tests/unit/user-papel-nao-volta.test.ts. Ela lê ESTE schema como texto e
--    reprova um campo `papel` em `model User`, e varre o repositório
--    reprovando `papel` dentro de qualquer chamada a `prisma.user.*`. As duas
--    metades provam que mordem, com fixtures do código real.
--
-- ## A verificação abaixo
--
-- Roda dentro da transação da migração (o Prisma envolve cada migration.sql
-- numa transação em Postgres), que é o único momento em que ainda dá para
-- desfazer. A do DROP anterior comparava User.papel com Membership.papel;
-- esta não pode exigir igualdade para todo mundo, porque desde
-- 20260821120000 a coluna aceita nulo e quem nasceu depois dela a tem NULA.
-- Então são duas checagens: ninguém pode ficar SEM papel (todo User precisa de
-- ao menos um Membership), e quem ainda tem valor na coluna não pode divergir
-- do vínculo.
--
-- O DROP também é a última defesa por si só: sem CASCADE, o Postgres RECUSA
-- derrubar coluna de que uma view, índice, constraint ou coluna gerada
-- dependa. CASCADE não aparece aqui de propósito.

-- ============================================================================
-- Verificação ANTES do DROP
-- ============================================================================

DO $$
DECLARE
  sem_vinculo integer;
  divergentes integer;
BEGIN
  SELECT count(*) INTO sem_vinculo
  FROM "User" u
  WHERE NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."userId" = u.id);

  IF sem_vinculo > 0 THEN
    RAISE EXCEPTION
      'Abortando: % usuario(s) sem nenhum Membership. Derrubar a coluna faria o papel deles sumir sem destino. Nada foi apagado.',
      sem_vinculo;
  END IF;

  SELECT count(*) INTO divergentes
  FROM "User" u
  WHERE u.papel IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "Membership" m
      WHERE m."userId" = u.id AND m.papel = u.papel
    );

  IF divergentes > 0 THEN
    RAISE EXCEPTION
      'Abortando: % usuario(s) com User.papel divergente de todo Membership. Reconcilie antes -- e note que a divergencia era o risco declarado como R4 na auditoria do Ciclo 1a. Nada foi apagado.',
      divergentes;
  END IF;
END $$;

-- ============================================================================
-- Só chega aqui se as duas verificações passaram.
-- ============================================================================

-- AlterTable
ALTER TABLE "User" DROP COLUMN "papel";
```

- [ ] **Step 4: Aplicar**

```bash
npx prisma migrate deploy
npx prisma migrate status
```

Esperado: a migração aplicada e depois `25 migrations found` /
`Database schema is up to date!`. **Se passar de dois minutos sem imprimir
nada, PARE E REPORTE** — é `DATABASE_URL`/`DIRECT_URL` trocadas (6543 vs 5432).
Não edite o `.env`.

Se o `RAISE EXCEPTION` disparar, **nada foi apagado** (a transação desfaz) —
**pare e reporte** com a mensagem inteira. Cole a saída.

- [ ] **Step 5: Confirmar que a guarda de migrações continua com 2 perdoadas**

```bash
npx vitest run tests/unit/migracoes-seguras.test.ts
grep -c '^\s*"[0-9]\{14\}_' tests/unit/migracoes-seguras.test.ts
```

Esperado: 7 casos verdes e `2`. É a confirmação executada do que a Task 1
provou em fixture: `DROP COLUMN` não aciona a guarda. Cole as duas saídas.

- [ ] **Step 6: Tirar `papel` do schema**

Em `prisma/schema.prisma`, no `model User`, **apagar o bloco inteiro** que vai
do `/// Espelho depreciado.` até a linha `papel              Role?`,
inclusive — são o docstring de nove-e-poucas linhas (com o parágrafo que a Task
2 reescreveu) e a declaração do campo. Nada mais do `model User` muda.

E, **acima** de `model User`, trocar o parágrafo que hoje começa em
`// `papel` foi derrubada e RESTAURADA na mesma tarefa (Ciclo 1a, Task 2 parte`
e termina em `// `Membership.papel`) enquanto este bridge existir — ver comentário lá.`
por:

```prisma
// `papel` NÃO é coluna de `User`, e a ausência é o desenho: papel é atributo
// do VÍNCULO (`Membership.papel`), porque a mesma pessoa pode ser ADMIN numa
// empresa e VENDEDOR em outra. Uma coluna aqui só teria resposta certa
// enquanto cada pessoa tivesse uma empresa só.
//
// A coluna existiu, e a história importa porque custou quatro tentativas. O
// Ciclo 1a derrubou (`20260819130000_derruba_user_papel`) e RESTAUROU
// (`20260819140000_restaura_user_papel_temporariamente`) na mesma tarefa: o
// DROP passou na verificação de integridade dos dados, mas o typecheck do
// repositório revelou um terceiro grupo de leitores. As três tentativas
// mediram com um instrumento só, acharam um grupo e concluíram que era o
// alcance total.
//
// O Ciclo 1f fechou o inventário medindo com DOIS instrumentos independentes,
// e o que fechou de verdade foi o segundo: a varredura textual achou `papel`
// escrito através de `.map()`, que o `tsc` deixa passar porque a checagem de
// propriedade excedente só vale para literal fresco atribuído direto ao
// parâmetro. Superfície real: 32 arquivos, 11 leitores e 42 escritores,
// nenhum leitor em `src/` — não os ~80 que este comentário afirmava antes,
// número que contava prosa e `Membership.papel` junto. A medição inteira está
// em `.superpowers/sdd/medicao-user-papel.md`; a coluna saiu em
// `20260821130000_derruba_user_papel_de_vez`.
//
// O que impede a volta: `tests/unit/user-papel-nao-volta.test.ts` — lê ESTE
// arquivo e reprova um campo `papel` dentro de `model User`, e varre o
// repositório reprovando `papel` dentro de qualquer chamada a `prisma.user.*`.
// A varredura textual é a metade que não depende do `tsc`, e é deliberado que
// ela não dependa.
```

O parágrafo de abertura do bloco (`// NÃO recebe `companyId`. …`) **fica
inteiro**: continua verdadeiro e é sobre outra coisa.

- [ ] **Step 7: Regenerar o client e CONFIRMAR o `tsc` — esperado ZERO**

```bash
npx prisma generate
rm -f tsconfig.tsbuildinfo
npm run typecheck
```

Esperado: **zero erros.**

Este é o momento de leitura mais importante do ciclo, e ele se lê ao contrário
do habitual. Nas três tentativas do Ciclo 1a, o `tsc` aqui era o instrumento de
DESCOBERTA e descobria tarde: 26 lugares, com a coluna já fora do banco. Aqui
ele é CONFIRMAÇÃO — o inventário foi fechado antes, por dois instrumentos, e os
62 erros que a medição previu já foram todos consertados nas Tasks 4 a 10.

**Um erro sequer significa que o inventário FALHOU**, não que resta trabalho de
rotina: **pare e reporte com a lista completa**, e trate como achado, porque é
exatamente a forma que as três falhas anteriores tiveram.

`rm -f tsconfig.tsbuildinfo` é obrigatório: sem ele o `tsc` incremental
reaproveita o resultado anterior e imprime "No errors found" sem ter reconferido
nada contra o client novo.

- [ ] **Step 8: GREEN da trava, e a prova de RUNTIME que nenhum texto dá**

```bash
npx vitest run tests/unit/user-papel-nao-volta.test.ts
```

Esperado: **12 casos verdes**, incluindo os três de schema. Cole a saída.

Agora o passo que nem o `tsc` nem a varredura textual substituem: a suíte
inteira dos arquivos tocados, contra o Postgres real, **com a coluna já fora**.
É a única prova de que nenhum `Unknown argument 'papel'` sobrou — o caso do
`.map()` é a demonstração de por que ela ainda importa (`medicao:310-313`).

⚠️ Este comando inclui `seed.test.ts`, que **reescreve o `senhaHash` de
`admin@exemplo.com` e `vendedor@exemplo.com`** (mesmo aviso da Task 7, Step 6).
Se essas senhas tiverem sido rotacionadas, rotacione de novo depois.

```bash
npx vitest run tests/unit/alerta-atividade.test.ts tests/unit/audit-isolamento.test.ts tests/unit/audit-log.test.ts tests/unit/contact-isolamento.test.ts tests/unit/contacts-service.test.ts tests/unit/dono-integracao.test.ts tests/unit/lead-actions.test.ts tests/unit/lead-creation-resilience.test.ts tests/unit/lead-isolamento.test.ts tests/unit/lead-notes.test.ts tests/unit/notificacoes-isolamento.test.ts tests/unit/notificacoes-poda.test.ts tests/unit/notifications.test.ts tests/unit/pipeline-isolamento.test.ts tests/unit/pipeline-service.test.ts tests/unit/seed.test.ts tests/unit/session.test.ts tests/unit/stage-transition.test.ts tests/unit/task-actions.test.ts tests/unit/task-isolamento.test.ts tests/unit/task-queries.test.ts tests/unit/tasks.test.ts tests/unit/unicidades-por-empresa.test.ts tests/unit/users-service.test.ts tests/unit/users-ultimo-admin.test.ts tests/unit/usuario-ativo.test.ts tests/unit/whatsapp-envio-por-conexao.test.ts tests/unit/whatsapp-isolamento.test.ts tests/unit/whatsapp-notificacoes.test.ts
```

Esperado: **todos verdes**. Um comando só, em série — `fileParallelism: false`
no `vitest.config.ts` garante que os arquivos não disputem o banco entre si, e o
proibido é duas execuções de `vitest` ao mesmo tempo.

Se aparecer `Unknown argument 'papel'`, **pare e reporte com o arquivo e a
linha**: é um escritor que os dois instrumentos deixaram passar, e é o achado
mais valioso possível neste ponto. Cole a saída.

- [ ] **Step 9: A suíte e2e, adiada da Task 8**

```bash
npm run test:e2e
```

Esperado: verde. É aqui que as fixtures de e2e são de fato exercitadas contra a
coluna ausente. Se falhar por `papel`, **pare e reporte**; se falhar por porta
ocupada ou por timeout de worker, releia o rodapé de `vitest.config.ts` sobre
I/O do OneDrive e o `scripts/e2e-port-guard.ts` — são falhas de ambiente, não do
ciclo, e o relatório precisa distinguir as duas. Cole a saída.

- [ ] **Step 10: Commit**

```bash
git add tests/unit/user-papel-nao-volta.test.ts prisma/migrations/20260821130000_derruba_user_papel_de_vez prisma/schema.prisma
git commit -m "$(cat <<'MSG'
feat(tenancy): User.papel sai do banco -- a quarta tentativa, e a que fecha

Papel e atributo do VINCULO: a mesma pessoa pode ser ADMIN numa empresa e
VENDEDOR em outra, e uma coluna em User so tem resposta certa enquanto cada
pessoa tiver uma empresa so. Duas fontes de verdade para autorizacao nao sao
rede de seguranca, sao a falha esperando alguem ler a errada -- e era a ultima
divida aberta do Ciclo 1a (R4).

As tres tentativas anteriores mediram com um instrumento so, acharam um grupo
de leitores e concluiram que era o alcance total; a terceira derrubou a coluna
antes de descobrir o terceiro grupo, e precisou de uma migracao de restauracao
no mesmo dia. Esta mediu com dois instrumentos e o segundo achou o buraco do
primeiro: `papel` via .map() PASSA no tsc. Superficie real, 32 arquivos, nao os
~80 que o schema afirmava.

O DROP vem por ultimo de proposito, depois dos 53 pontos convertidos e da
coluna passar a aceitar nulo -- cada commit intermediario com a arvore
compilando. Aqui o tsc e confirmacao, nao descoberta, e a assercao de schema em
user-papel-nao-volta.test.ts e o que impede a quinta tentativa de existir.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 12: A prosa que a mudança tornou falsa

**DEPENDE DE AÇÃO DO DONO:** não.

Nos Ciclos 1c e 1e, doze e depois oito blocos de documentação afirmavam no
presente um estado que deixara de existir. A lista abaixo é fechada e vem de
`medicao:244-280`, que a levantou **sem corrigir**, de propósito, para que a
correção fosse deliberada.

Duas categorias, e a distinção importa:

- **Já era falso ANTES deste ciclo** — o comentário do schema e três outros
  nomeiam `core/audit/alerta.ts` como leitor vivo de produção. Ele consulta
  `db.membership.findMany` desde `3744e64` (`medicao:252`). Isso não é dano
  colateral do Ciclo 1f; é dívida herdada que este ciclo paga porque está com a
  mão nela.
- **Passou a ser falso agora.**

**Documento histórico não é reescrito.** Auditorias e planos de ciclos passados
descrevem o que era verdade no dia — o que ganham é uma NOTA de fechamento, não
uma edição do corpo. O que é reescrito de verdade é comentário de código e
prosa que se lê como estado atual.

**Files:**
- Modify: `prisma/seed.ts`
- Modify: `prisma/seed-demo.ts` (só se o Step 3 achar o que procura)
- Modify: `src/core/users/queries.ts`
- Modify: `tests/unit/seed.test.ts`
- Modify: `tests/unit/migracoes-seguras.test.ts`
- Modify: `docs/auditorias/2026-08-19-ciclo-1a-tenancy.md`
- Modify: `docs/superpowers/specs/2026-08-19-ciclo-1a-tenancy-design.md`
- Modify: `docs/superpowers/plans/2026-08-19-n8necrm-ciclo-1a-tenancy.md`

**Interfaces:**
- Consumes: nada de código. Só texto.
- Produces: nenhuma mudança de comportamento. `npm run typecheck` e todas as
  suítes precisam continuar exatamente como estavam no fim da Task 11 — é o
  Step 8 que confirma.

- [ ] **Step 1: `src/core/users/queries.ts` — dois comentários que estavam ERRADOS e passaram a estar certos**

`queries.ts:7` e `:43` já dizem que a coluna *"foi derrubada"* / *"não existe
mais"*. Estavam **errados** desde `20260819140000` (ela tinha voltado) e ficam
**certos** agora (`medicao:277-280`). Não precisam de correção de fato — precisam
de data, para que ninguém os leia de novo como afirmação sem procedência.

Na linha 7, trocar:

```ts
 * `Membership`, não em `User` (a coluna `User.papel` foi derrubada depois que
 * a gestão de equipe passou a gravar o vínculo).
```

por:

```ts
 * `Membership`, não em `User`. A coluna `User.papel` foi derrubada no Ciclo 1f
 * (`20260821130000_derruba_user_papel_de_vez`) — esta frase esteve ERRADA
 * entre 2026-08-19 e 2026-08-21, período em que a coluna existiu restaurada
 * como espelho; ela agora descreve o estado real.
```

Na linha 43, trocar:

```ts
 * `User.papel`, que não existe mais). Ativos primeiro, depois por nome.
```

por:

```ts
 * `User.papel`, derrubada no Ciclo 1f). Ativos primeiro, depois por nome.
```

- [ ] **Step 2: `prisma/seed.ts` — o docstring de `vincularAEmpresa`**

Nas linhas 255-258, trocar:

```ts
 * o `papel` que o chamador passa. `User` não tem mais coluna `papel` (Ciclo
 * 1a, Task 2 parte 2 a derrubou) — o vínculo é a ÚNICA fonte do papel a
 * partir de agora, então quem chama esta função decide o literal, em vez de
 * reler algo que não existe mais no registro de `User`.
```

por:

```ts
 * o `papel` que o chamador passa. `User` não tem coluna `papel`: o Ciclo 1a a
 * derrubou, ela voltou horas depois como espelho temporário, e o Ciclo 1f a
 * derrubou de vez (`20260821130000_derruba_user_papel_de_vez`). O vínculo é a
 * ÚNICA fonte do papel, então quem chama esta função decide o literal, em vez
 * de reler algo que não existe no registro de `User`.
```

- [ ] **Step 3: `prisma/seed-demo.ts` — conferir, e só editar se houver o que editar**

`medicao:86-87` mediu que este arquivo **não escreve `papel`**: só faz
`findUniqueOrThrow` por e-mail nas linhas 311-312, e usa apenas `.id`.

```bash
grep -n "papel" prisma/seed-demo.ts
```

Se a saída for **vazia**, não edite nada e registre isso no relatório. Se
aparecer alguma linha, ela é prosa desatualizada sobre a coluna: reescreva-a com
o mesmo teor dos Steps 1 e 2 e **reporte que a medição não a tinha visto**.

- [ ] **Step 4: `tests/unit/seed.test.ts:145-146`**

Trocar:

```ts
        // `papel` não é mais coluna de `User` (derrubada nesta tarefa) — é
        // `vincularAEmpresa()` quem grava "ADMIN" no `Membership`.
```

por:

```ts
        // `papel` não é coluna de `User` — é `vincularAEmpresa()` quem grava
        // "ADMIN" no `Membership`. "Derrubada nesta tarefa" era o Ciclo 1a, e
        // a frase ficou falsa por dois dias quando a coluna foi restaurada
        // como espelho; quem a derrubou de vez foi o Ciclo 1f.
```

- [ ] **Step 5: `tests/unit/migracoes-seguras.test.ts` — a isenção que venceu**

A entrada `20260819140000_restaura_user_papel_temporariamente` em `PERDOADAS`
**fica** (é história, e apagá-la seria fingir que a janela de quebra não
existiu). O que muda é o parágrafo que declara quando ela deixa de valer:
aquele dia chegou.

Nas linhas 72-76, trocar:

```ts
  // - QUANDO ISTO DEIXA DE VALER: no dia em que o CRM for publicado, e
  //   também no dia em que a tarefa dedicada derrubar "User"."papel" de novo
  //   (o objetivo declarado desta migração ponte) — qualquer NOT NULL futuro
  //   nesta ou em outras tabelas vivas volta a precisar da regra sem
  //   isenção. A isenção é desta migração específica, não da regra.
```

por:

```ts
  // - ISTO JÁ DEIXOU DE VALER, em 2026-08-21. O Ciclo 1f derrubou
  //   "User"."papel" de novo (20260821130000_derruba_user_papel_de_vez), que
  //   era o objetivo declarado desta migração ponte, depois de converter os
  //   53 pontos que a liam ou escreviam. A entrada continua na lista porque
  //   ela é HISTÓRIA -- a janela de quebra existiu, e apagar o registro seria
  //   fingir que não. Mas ela não protege nada mais: qualquer NOT NULL futuro,
  //   nesta ou em outra tabela viva, precisa da regra sem isenção. A isenção
  //   sempre foi desta migração específica, nunca da regra.
```

- [ ] **Step 6: `docs/` — notas de fechamento, sem reescrever histórico**

Os três documentos abaixo descrevem corretamente o que era verdade no dia em
que foram escritos. **Não reescreva o corpo deles.** Acrescente a nota indicada,
no lugar indicado.

**`docs/auditorias/2026-08-19-ciclo-1a-tenancy.md`**, ao final da seção
`### R4 — `User.papel` sobrevive como espelho, com dual-write` (depois da linha
566):

```markdown
> **FECHADO em 2026-08-21, pelo Ciclo 1f.** A coluna saiu
> (`20260821130000_derruba_user_papel_de_vez`) e o dual-write morreu junto.
> Duas correções ao texto acima, medidas em
> `.superpowers/sdd/medicao-user-papel.md`: `core/audit/alerta.ts` **já não era
> leitor** quando esta auditoria foi escrita — ele consulta
> `db.membership.findMany` desde `3744e64` —, e os "3 arquivos de e2e" eram
> ESCRITORES, não leitores. A superfície real era de 32 arquivos (11 leitores,
> 42 escritores), não os ~80 do texto: aquele número contava prosa e
> `Membership.papel` junto. O que impede a volta é
> `tests/unit/user-papel-nao-volta.test.ts`.
```

E, ao final da seção `### `User.papel` não saiu — e é dívida de autorização,
não cosmética` (depois da linha 158):

```markdown
> **Saiu em 2026-08-21** (Ciclo 1f). A frase que abre esta seção descreve
> corretamente o dia 19; a partir do dia 21, o estado é o oposto.
```

**`docs/superpowers/specs/2026-08-19-ciclo-1a-tenancy-design.md`**, logo abaixo
da linha 194 (*"**`User.papel` sai neste mesmo ciclo**"*):

```markdown
> **Não saiu no Ciclo 1a.** Três tentativas, três grupos de leitores
> descobertos tarde, e uma migração de restauração no mesmo dia. Saiu no Ciclo
> 1f, em 2026-08-21 — ver
> `docs/superpowers/plans/2026-08-21-n8necrm-ciclo-1f-derrubar-user-papel.md`.
```

**`docs/superpowers/plans/2026-08-19-n8necrm-ciclo-1a-tenancy.md`**, logo abaixo
da linha 509 (o `Step 7` que diz *"Nada mais lê a coluna"*):

```markdown
> **Este Step ficou aberto**, e a afirmação "nada mais lê a coluna" era falsa
> quando foi escrita: 11 pontos liam, em 8 arquivos de `tests/unit/`. A conta
> de "26 lugares" da linha 310 também estava baixa — com a coluna fora do
> schema, o `tsc` aponta 62 erros, dos quais só 10 são leitura. Medido em
> `.superpowers/sdd/medicao-user-papel.md`; fechado pelo Ciclo 1f em
> 2026-08-21.
```

- [ ] **Step 7: Os três documentos que carregam R4 adiante**

`medicao:272-273` lista seis pontos, em seis documentos, que dizem alguma
variante de *"`User.papel` continua de pé / continua como espelho depreciado"*.
Eram verdade quando escritos e ficam falsos agora.

```bash
grep -rn "User.papel" docs/auditorias/2026-08-20-ciclo-1c-*.md docs/auditorias/2026-08-20-ciclo-2a-*.md docs/auditorias/2026-08-21-ciclo-1e-*.md docs/superpowers/specs/*-1b-*.md docs/superpowers/specs/*-1c-*.md docs/superpowers/specs/*-2a-*.md
```

Para **cada** ocorrência que afirme, no presente, que a coluna existe,
acrescentar na linha seguinte:

```markdown
> **Não vale mais desde 2026-08-21:** a coluna saiu no Ciclo 1f.
```

Nada mais. Não reescreva o texto original — são registros datados, e a nota é o
que os mantém legíveis sem os falsificar.

Colar, no relatório da tarefa, **quantas ocorrências foram anotadas e em quais
arquivos**. Se o número for maior que 6, reporte a diferença: significa que a
medição não viu alguma, e vale saber quais.

- [ ] **Step 8: Provar que a prosa não mexeu em comportamento**

```bash
npm run typecheck
npx vitest run tests/unit/user-papel-nao-volta.test.ts tests/unit/migracoes-seguras.test.ts tests/unit/seed.test.ts tests/unit/users-service.test.ts
git diff --stat HEAD
```

Esperado: `tsc` em zero; as quatro suítes verdes; e o `git diff --stat` mostrando
mudanças **só** em comentário, `docs/` e docstring. ⚠️ `seed.test.ts` reescreve
as senhas de desenvolvimento outra vez (mesmo aviso da Task 7, Step 6).

Se alguma linha de código executável aparecer no diff, **pare e reporte** — uma
tarefa de prosa não muda código. Cole as saídas.

- [ ] **Step 9: Commit**

```bash
git add prisma/seed.ts prisma/seed-demo.ts src/core/users/queries.ts tests/unit/seed.test.ts tests/unit/migracoes-seguras.test.ts docs/
git commit -m "$(cat <<'MSG'
docs(tenancy): a prosa que a coluna deixou para tras

Nos Ciclos 1c e 1e, doze e depois oito blocos de documentacao afirmavam no
presente um estado que deixara de existir. A lista desta vez foi levantada pela
medicao SEM ser corrigida, de proposito, para que a correcao fosse deliberada.

Duas categorias. A que ja era falsa ANTES deste ciclo: quatro pontos nomeavam
core/audit/alerta.ts como leitor vivo de producao, e ele consulta
membership.findMany desde 3744e64 -- divida herdada, paga aqui porque estamos
com a mao nela. E a que passou a ser falsa agora.

Documento historico nao e reescrito: auditoria e plano de ciclo passado
descrevem o que era verdade no dia, e o que ganham e uma nota de fechamento. O
que e reescrito de fato e comentario de codigo lido como estado atual -- entre
eles dois em users/queries.ts que estavam ERRADOS desde a restauracao da coluna
e so agora ficaram certos.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

### Task 13: Verificação final e relatório do ciclo

**DEPENDE DE AÇÃO DO DONO:** não. **A auditoria de segurança que vem DEPOIS
dela, sim — ver o Step 7.**

**Files:**
- Nenhum, exceto se algum passo achar defeito. Se achar, corrigir e commitar
  com a mensagem do Step 8.

**Interfaces:**
- Consumes: tudo o que as Tasks 1-12 produziram.
- Produces: o relatório do ciclo, entregue como texto — não como arquivo `.md`
  novo. A auditoria formal em `docs/auditorias/` é escrita DEPOIS, pelo dono ou
  por quem ele designar, e não faz parte deste plano.

- [ ] **Step 1: A coluna não existe no banco**

```bash
npx tsx --conditions=react-server -e "import 'dotenv/config'; import { PrismaClient } from '@prisma/client'; import { PrismaPg } from '@prisma/adapter-pg'; const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) }); const r = await p.\$queryRaw\`SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'User' ORDER BY ordinal_position\`; console.log(JSON.stringify(r, null, 2)); await p.\$disconnect();"
```

Esperado: as colunas `id`, `nome`, `email`, `senhaHash`, `ativo`, `criadoEm` —
e **nenhuma `papel`**. Cole a saída.

- [ ] **Step 2: `Membership.papel` continua de pé, e com dado**

```bash
npx tsx --conditions=react-server -e "import 'dotenv/config'; import { PrismaClient } from '@prisma/client'; import { PrismaPg } from '@prisma/adapter-pg'; const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) }); const r = await p.\$queryRaw\`SELECT papel, count(*)::int AS quantos FROM \"Membership\" GROUP BY papel ORDER BY papel\`; const orfaos = await p.\$queryRaw\`SELECT count(*)::int AS sem_vinculo FROM \"User\" u WHERE NOT EXISTS (SELECT 1 FROM \"Membership\" m WHERE m.\"userId\" = u.id)\`; console.log(JSON.stringify({ papeis: r, orfaos })); await p.\$disconnect();"
```

Esperado: pelo menos um papel com contagem maior que zero, e
`sem_vinculo: 0`. Um `User` sem vínculo agora é uma conta **sem papel nenhum**,
não uma conta com papel só na coluna espelho — a diferença deixou de existir.
Cole a saída.

- [ ] **Step 3: As travas todas, num comando**

```bash
npx vitest run tests/unit/user-papel-nao-volta.test.ts tests/unit/migracoes-seguras.test.ts tests/unit/catraca-prisma-cru.test.ts tests/unit/escopo-empresa.test.ts tests/unit/consultas-estreitas.test.ts
```

Esperado, e cada número precisa ser CONFERIDO e colado:

| Trava | Valor esperado |
| --- | --- |
| `user-papel-nao-volta` | 12 casos verdes, `EM_CONVERSAO` vazio |
| `migracoes-seguras` | 7 casos verdes, `PERDOADAS` com 2 |
| `catraca-prisma-cru` | verde, `LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS = 0` |
| `escopo-empresa` | verde, `MODELOS_DE_TENANT` com 13 |
| `consultas-estreitas` | verde |

- [ ] **Step 4: A suíte de unidade inteira — o único ponto do plano onde ela roda**

⚠️ **Rode `npx vitest run`, e NÃO `npm test`.** Os dois executam a mesma coisa
neste projeto (`"test": "vitest run"`), e os dois passam por `seed.test.ts`, que
**reescreve o `senhaHash` de `admin@exemplo.com` e `vendedor@exemplo.com`** (⚠️
R1 do Ciclo 1a, 🔍 NV6 do Ciclo 2a). **Se essas senhas tiverem sido
rotacionadas, rotacione de novo depois deste passo** — e diga isso no relatório.

```bash
npx vitest run
```

Esperado: **tudo verde.** É a primeira e única vez neste ciclo que a suíte
inteira roda, e é o que fecha a diferença entre "os arquivos que eu sabia que
tinha tocado" e "o repositório".

Se algum arquivo que este plano nunca nomeou falhar por causa de `papel`,
**pare e reporte**: é um ponto que os dois instrumentos da medição deixaram
passar, e é informação de primeira ordem sobre o método — não um conserto de
rotina.

Se aparecer `Failed to start forks worker`, leia o rodapé de `vitest.config.ts`
antes de investigar o teste citado: é I/O do OneDrive disputando com a
sincronização, o arquivo citado muda a cada execução, e a assinatura é o tempo
de `import` no relatório. Espere assentar e rode de novo.

- [ ] **Step 5: `typecheck`, `lint` e `build`**

```bash
rm -f tsconfig.tsbuildinfo
npm run typecheck
npm run lint
npm run build
```

Esperado: zero erros nos três. O `build` importa: `next build` avalia módulos
alcançáveis, e é onde uma validação de env em escopo de módulo derrubaria tudo
(armadilha registrada no `CLAUDE.md`). Nenhuma tarefa deste plano acrescentou
leitura de env, então o esperado é que ele passe como antes — mas "esperado" não
é "provado". Cole as três saídas.

- [ ] **Step 6: Conferir a linha de base contra o que este ciclo produziu**

```bash
ls prisma/migrations/ | wc -l
git log --oneline ciclo-1a-tenancy..HEAD
git status --short
```

Esperado: **25** migrações (23 da linha de base mais as duas deste ciclo,
`20260821120000_user_papel_aceita_nulo` e
`20260821130000_derruba_user_papel_de_vez`) mais o `migration_lock.toml` na
contagem do `ls` — confira o número que o comando imprimir contra a listagem, e
cole os dois. **13 commits** na branch, um por tarefa (ou 12, se a Task 12 não
tiver achado nada em `seed-demo.ts`; ou 14, se este Step 8 tiver o que
commitar). `git status` **vazio**.

- [ ] **Step 7: O relatório — o que ele precisa dizer**

Entregue como texto, não como arquivo. Itens obrigatórios:

1. **Os cinco números da medição, confirmados ou corrigidos:** 11 leitores, 42
   escritores, 32 arquivos de superfície, 29 arquivos alcançados pela trava, 62
   erros de `tsc` previstos. Para cada um, o valor observado na execução. Uma
   divergência não é falha do plano — é a informação mais valiosa que este ciclo
   pode produzir sobre o método de medição, e precisa aparecer com destaque.
2. **A pergunta central respondida:** o `tsc` do Step 7 da Task 11 deu zero na
   primeira vez? Se sim, o inventário de dois instrumentos funcionou. Se não,
   quantos erros e quais — e isso vira a lição do ciclo.
3. **O que a varredura textual pegou e o `tsc` não teria pegado**, nominalmente.
   Espera-se exatamente um: `audit-isolamento.test.ts:163`. Se tiver sido mais,
   nomeie todos.
4. **O aviso das senhas**, repetido: os Steps 6 da Task 7, 8 da Task 11, 8 da
   Task 12 e 4 desta tarefa rodaram `seed()` contra o banco de desenvolvimento.
   `admin@exemplo.com` e `vendedor@exemplo.com` estão com `SEED_PASSWORD` ou
   `senha123`. Se o dono tinha rotacionado, precisa rotacionar de novo.
5. **A auditoria de segurança que este plano NÃO faz.** O `AGENTS.md` deste
   projeto exige a **Fase 1 da skill `auditoria-seguranca`** sobre a superfície
   que a branch mexeu, **antes** de qualquer merge ou PR. O relatório é entregue
   e a execução **PARA** até o dono aprovar. Esta branch mexeu em autorização —
   é a superfície mais sensível possível para pular essa varredura. **Este é o
   único ponto do ciclo que depende de ação do dono, e ele é depois do plano,
   não durante.**
6. **Os 🔍 NÃO VERIFICADO que sobram.** Ver a seção abaixo.
7. **Nenhum push.** A branch fica local.

- [ ] **Step 8: Commit, só se houver o que commitar**

Se algum passo desta tarefa achou e corrigiu defeito:

```bash
git add -A
git commit -m "$(cat <<'MSG'
fix(tenancy): <o que a verificacao final achou, em uma linha>

<Por que passou pelas tarefas anteriores -- qual instrumento nao o alcancava.>

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

Se nada foi achado, **não commite nada** e diga "não há o que commitar: a
verificação final não achou defeito" no relatório. `git status` já ter voltado
vazio no Step 6 é a prova.

---

## 🔍 NÃO VERIFICADO — o que fica aberto, e o comando que um humano roda

Um item, e ele encolheu em relação à medição.

**NV1 — SQL contra a tabela `User` vivendo fora do banco E fora do repositório.**

`medicao:229-234` deixou este vetor inteiro em aberto. Este plano fecha as duas
metades que dava para fechar:

- **Objetos no banco** (view, materialized view, função, política de RLS,
  índice): fechado pela Task 11, Step 2, com consulta a `pg_views`,
  `pg_matviews`, `pg_proc`, `pg_policies` e `pg_indexes`. E o `DROP COLUMN` sem
  `CASCADE` recusaria de qualquer jeito.
- **`Bots/`**: fechado por medição em 2026-08-21 —
  `grep -rl 'papel' Bots/` e `grep -rlE '"User"' Bots/` voltaram **vazios**.

O que **não** fecha: um nó Postgres dentro de um workflow em
`https://n8n.nateksoft.com` executando SQL escrito à mão. Esse texto vive na
instância do n8n, não no banco e não neste repositório, e nenhum comando deste
ambiente o alcança.

**Comando que um humano roda**, na máquina dele, com as credenciais da API do
n8n:

```bash
# Lista os workflows e procura, no JSON de cada um, referência à tabela User
# com a coluna. Ajuste N8N_URL e N8N_API_KEY.
curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" "$N8N_URL/api/v1/workflows?limit=250" \
  | jq -r '.data[] | select((.nodes | tostring) | test("papel"; "i")) | "\(.id)  \(.name)"'
```

Esperado: nenhuma linha. Se aparecer algum workflow, ele quebra na próxima
execução com `column "papel" does not exist` — e a correção é trocar a consulta
para partir de `"Membership"`.

**Por que este resíduo é pequeno:** os fluxos de n8n deste projeto ainda são
Ciclo 4, não implementados (`docs/superpowers/plans/2026-08-19-n8necrm-ciclo-4-fluxos-n8n.md`),
e nenhum fluxo existente foi escrito para ler `User`. Isso é argumento, não
prova — e por isso o item continua marcado, em vez de virar "ok" presumido.

---

## Auto-revisão (`superpowers:writing-plans`)

### 1. Cobertura — cada afirmação da medição tem tarefa e prova

| Item de `.superpowers/sdd/medicao-user-papel.md` | Onde é feito | Onde é provado |
| --- | --- | --- |
| § 1, leitores 1-10 (`where: { papel }`, 7 arquivos) | Task 4, Steps 3-9 | Task 4, Step 10 |
| § 1, leitor 11 (`usuario-ativo.test.ts:68`, invisível ao `tsc`) | Task 5, Steps 1-3 | Task 5, Step 5 (regressão feita à mão e desfeita) |
| § 1, os dois ambíguos (`lead-actions`, `task-actions`) | Task 6, Steps 2 e 4 | Task 6, Steps 1 (RED) e 5 |
| § 2, escritores de `src/` (2) | Task 7, Steps 2-3 | Task 7, Steps 5-6 |
| § 2, escritores de `prisma/` (3) | Task 7, Step 4 | Task 7, Step 6 (`seed.test.ts`) |
| § 2, escritores de `tests/e2e/` (4) | Task 8, Steps 2-4 | Task 11, Step 9 (a suíte e2e, com a coluna fora) |
| § 2, escritores de `tests/unit/` (33) | Tasks 9 e 10 | Tasks 9, Step 10; 10, Step 13 |
| § 2, `usuario-ativo.test.ts:30` (fixture sem banco) | Task 5, Step 1 | Task 5, Step 4 |
| § 3, vetores vazios (SQL cru, relação aninhada, serialização) | nenhuma tarefa — nada a fazer | Task 11, Step 2 (`pg_views`/`pg_proc`/`pg_policies`) e Task 13, Step 4 |
| § 4, o buraco do `.map()` | Task 3 (a trava) e Task 9, Step 2 | Task 3, caso "a regra pega o `.map()` que o tsc NÃO pega" |
| § 5, prosa já falsa hoje (`alerta.ts` como leitor, "~80 arquivos") | Task 12, Steps 1-2 e 6 | Task 12, Step 8 |
| § 5, prosa que passa a ser falsa no DROP | Task 12, Steps 4-7 | Task 12, Step 8 |
| § 6, "o que eu faria e não fiz: rodar a suíte com a coluna fora" | Task 11, Step 8 e Task 13, Step 4 | as próprias execuções |
| § 6, NÃO VERIFICADO fora do repositório | Task 11, Step 2 (fecha o banco e `Bots/`) | § NÃO VERIFICADO acima (o resto, com comando) |

**Restrições do brief, uma a uma:**

| Restrição | Onde é honrada |
| --- | --- |
| `migracoes-seguras` — confirmar, não presumir | Task 1 inteira (caso de teste permanente), reconfirmada na Task 11, Step 5 |
| `PERDOADAS` continua com 2 | Task 1, Step 4 e Task 11, Step 5, com `grep -c` |
| `DATABASE_URL` 6543 / `DIRECT_URL` 5432 | Constraint global; aviso literal em Task 2, Step 3 e Task 11, Step 4 |
| Banco compartilhado, seed reescreve senhas | Aviso em "Ações do dono", em Task 7, Step 6; Task 11, Step 8; Task 12, Step 8; Task 13, Step 4 e no item 4 do relatório |
| `vitest` nunca em paralelo | Constraint global, repetida em Task 4, Step 10; Task 9, Step 10; Task 10, Step 13; Task 11, Step 8 |
| Catraca de prisma cru em ZERO | Task 3, Step 4 e Task 13, Step 3 |
| `MODELOS_DE_TENANT` em 13 | Constraint global (com o argumento do regex `^\s*companyId\s+\w+` não casar com a linha apagada) e Task 13, Step 3 |
| Toda frase universal com caso que a exercita | Cada trava tem o par "morde" / "não acusa falso": Task 1, Steps 2 (dois casos); Task 3, Step 1 (cinco casos); Task 11, Step 1 (três casos) |
| Comentário em português, denso, citando a fonte | Todo bloco de código deste plano; a prosa falsa sai na Task 12 |
| ZERO tarefas dependendo do dono | Todas trazem `DEPENDE DE AÇÃO DO DONO: não` |

**As cinco perguntas do brief:**

1. **A ordem** — § "Por que esta ordem", três decisões numeradas, com o
   argumento contrário respondido (o valor de descoberta do DROP-primeiro já foi
   extraído no worktree descartável) e com o passo de expansão que só apareceu
   ao notar que `papel` é `NOT NULL` sem `DEFAULT`.
2. **A trava** — Task 3 (texto) e Task 11, Step 1 (schema), no mesmo arquivo,
   as duas com prova de que mordem, no molde de
   `escopo-empresa.test.ts:1138-1165`.
3. **O passo que não depende do `tsc`** — Task 3, e a Task 11, Step 8 como
   segunda camada (runtime).
4. **Os dois ambíguos** — Task 6, com o RED real do `companyId: undefined`.
5. **A prosa do schema** — Task 11, Step 6, com o texto de substituição
   completo.

### 2. Varredura de placeholders

Nenhum `TODO`, `FIXME`, `...`, `<preencher>`, "similar à Task N" ou "tratamento
apropriado" sobrevive nos blocos de código deste plano. Todo bloco é o texto
final a ser colado.

Os únicos marcadores de substituição humana, e os dois são deliberados:

- **Task 13, Step 8**: `<o que a verificacao final achou, em uma linha>` — dentro
  de uma mensagem de commit que só existe se houver correção, e o próprio passo
  manda dizer "não há o que commitar" no caso contrário.
- **Task 12, Step 7**: a instrução manda anotar "cada ocorrência que afirme, no
  presente, que a coluna existe", em vez de listar as seis linhas literalmente.
  É deliberado: `medicao:272-273` dá o número (6) e os arquivos, mas as linhas
  exatas variam com a formatação de cada documento, e o passo exige colar quantas
  foram anotadas — se não forem 6, a divergência é reportada.

Três instruções apontam por LINHA e não por texto literal, e cada uma diz o que
conferir antes: Task 10, Step 7 (`session.test.ts:59-65`, cujo trecho começa no
meio de uma frase — o passo manda conferir e parar se não bater), Task 11,
Step 6 (o bloco do schema, cujas linhas se deslocaram na Task 2 — por isso é
descrito por texto de início e fim, não por número), e Task 12, Step 3
(`seed-demo.ts`, que a medição diz não ter nada — o passo manda `grep` primeiro
e não editar se vier vazio).

Os cinco comandos `npx tsx -e` são longos e usam escape de `$` e de aspas para
sobreviver ao shell. Se algum falhar por escape no ambiente real, o passo é
**equivalente** a rodar o mesmo SQL por qualquer caminho — o que importa é a
saída esperada, que está escrita em cada um.

### 3. Consistência de tipos e nomes

- **Migrações.** `20260821120000_user_papel_aceita_nulo` e
  `20260821130000_derruba_user_papel_de_vez` — os dois nomes aparecem na
  migração, nos comentários do schema, na `PERDOADAS` reescrita (Task 12,
  Step 5) e em `users/queries.ts` (Task 12, Step 1). Conferidos um a um. O
  padrão `AAAAMMDDHHMMSS_nome_em_snake_case` bate com as 23 existentes, e os dois
  carimbos são posteriores ao último (`20260820250000`).
- **`UsuarioDoSeed`** é `{ id: string; companyId: string }`. `pipeline-service`
  usa `admin.id` (existe) e `admin.companyId` (existe); os outros seis arquivos
  usam `.id` e, em `lead-notes`, `.companyId`. Nenhum lê outro campo — a Task 4,
  Step 6, manda parar e reportar se algum ler.
- **`UsuarioAtivo`** tem exatamente `id`, `nome`, `email`, `ativo`, `companyId`,
  `papel` (lido em 2026-08-21 de `src/core/auth/usuario-ativo.ts:20-29`). O
  `usuarioFake` das Tasks 6 monta os seis, nem um a mais. `senhaHash` e
  `criadoEm` somem do `usuarioFake` dos dois arquivos, e nenhum caso os lê. O
  `grep -n "senhaHash\|criadoEm" tests/unit/lead-actions.test.ts tests/unit/task-actions.test.ts`,
  rodado em 2026-08-21, devolve 7 linhas: as 2 de `senhaHash` (as duas dentro do
  próprio `usuarioFake`, e são as que somem), 2 de `criadoEm` dentro do
  `usuarioFake` (idem), 2 de `criadoEm` dentro de `leadFake()`/`taskFake()` —
  que **ficam**, porque `Lead` e `Task` têm a coluna — e 1 em comentário
  (`task-actions.test.ts:73`). Nenhuma asserção lê nenhum dos dois campos do
  usuário.
- **`EMPRESA_FAKE = "empresa-fake-id"`** é o MESMO literal que `taskFake()` já
  usa em `companyId` (`task-actions.test.ts:47`) e que `leadFake()` usa
  (`lead-actions.test.ts:92`). Escolhido para isso, não por acaso.
- **`EM_CONVERSAO`** vai 29 → 23 (Task 4) → 21 (Task 7) → 18 (Task 8) → 10
  (Task 9) → 0 (Task 10). A soma dos lotes é 6 + 2 + 3 + 8 + 10 = **29**.
  Conferida.
- **Contagem de casos de `user-papel-nao-volta.test.ts`**: nasce com 9 (Task 3)
  e vai a 12 (Task 11, três de schema). Os dois números aparecem em todo Step
  que roda o arquivo, e batem.
- **`analisar`**, **`blocoDoModelo`**, **`camposDoModelo`**, **`semTextoDeString`**,
  **`fimDoBalanceamento`**, **`semSubarvoreDeMemberships`**, **`relativoPosix`**,
  **`arquivosDeCodigo`** — todos declarados uma vez só, no arquivo da trava.
  `relativoPosix` e `arquivosDeCodigo` existem também em
  `catraca-prisma-cru.test.ts` e `consultas-estreitas.test.ts`, com o mesmo nome
  e a mesma forma; são cópias locais de propósito, seguindo o precedente daqueles
  dois arquivos (importar entre `.test.ts` acopla suítes).
- **`semComentarios`** vem de `tests/unit/helpers/codigo-fonte.ts`, importada e
  não redeclarada.
- **`Role`** é o enum do Prisma (`ADMIN`, `GESTOR`, `VENDEDOR` — os três
  aparecem: `GESTOR` em `usuario-ativo.test.ts:91` e em
  `lead-actions.test.ts:246`). O helper da Task 4 o recebe por parâmetro tipado.
- **`PERDOADAS`** continua com 2 entradas, e a Task 12, Step 5, edita PROSA
  dentro de uma delas sem mexer na chave nem no valor da string — o `grep -c` da
  Task 13, Step 3, ancora em `^\s*"[0-9]\{14\}_`, que casa só a chave.
- **Nomes de arquivo de teste**: os 29 de `EM_CONVERSAO` foram conferidos
  contra `ls tests/unit/` e `ls tests/e2e/` em 2026-08-21.

### 4. Ordem — nenhuma tarefa usa algo que uma posterior cria

- **Task 1** só depende de `255076a`. Cria a branch.
- **Task 2** depende da branch (Task 1, Step 1). Não usa nada da Task 1.
- **Task 3** depende da coluna aceitar nulo? **Não** — a trava textual funciona
  com a coluna existindo. Depende da branch, e é ordenada aqui porque as Tasks 4
  a 10 precisam dela para ter RED.
- **Task 4** consome `EM_CONVERSAO` (Task 3). Produz o helper.
- **Task 5** não consome nada das Tasks 3 e 4 — mas roda depois delas de
  propósito, para que "o leitor que nenhuma ferramenta alcança" seja lido no
  contexto de já existirem duas ferramentas. Pode rodar antes sem quebrar nada;
  a ordem é editorial, e está declarada como tal.
- **Task 6** consome `UsuarioAtivo`, que existe desde o Ciclo 1a. Não consome
  nada das Tasks 3-5.
- **Task 7** consome `EM_CONVERSAO` (Task 3) e a coluna nula-aceita (Task 2) —
  **esta é a dependência dura do plano**: sem a Task 2, o Step 2 da Task 7
  produz `23502` em runtime. Declarada em três lugares (§ "Por que esta ordem"
  Decisão 2, cabeçalho da Task 2, e comentário da migração).
- **Task 8** consome `EM_CONVERSAO` (Task 3) e a Task 2, pelo mesmo motivo.
- **Task 9** e **Task 10**: idem.
- **Task 11** consome `EM_CONVERSAO` vazio (Task 10), a varredura (Task 3) e
  todas as conversões (Tasks 4-10). Produz a migração de DROP.
- **Task 12** consome o nome da migração da Task 11 — e cita esse nome em prosa,
  em `users/queries.ts`, `seed.ts` e `PERDOADAS`. **É a única referência para a
  frente do plano, e ela é segura porque o nome é FIXADO por este documento**
  (Task 11, Step 3), não descoberto na execução. As Tasks 7 e 8, que também
  reescrevem comentário, dizem "Ciclo 1f" sem citar a migração, exatamente para
  não criar essa referência antes da hora.
- **Task 13** depende de tudo.

Conferido percorrendo os blocos **Interfaces** na ordem: cada `Consumes` só cita
coisa que já existia em `255076a` ou que foi produzida por uma tarefa anterior.

### 5. Tarefas que dependem de ação do dono

**ZERO.** As treze trazem `DEPENDE DE AÇÃO DO DONO: não`.

O que existe **depois** do plano, e não durante:

1. A **auditoria de segurança** (Fase 1 da skill `auditoria-seguranca`), exigida
   pelo `AGENTS.md` antes de qualquer merge ou PR. Esta branch mexe em
   autorização, que é a superfície mais sensível possível. O relatório é
   entregue e a execução **PARA** até o dono aprovar. Task 13, Step 7, item 5,
   obriga a dizer isso.
2. A **rotação das senhas** de `admin@exemplo.com` e `vendedor@exemplo.com` — 🔍
   NV6 do Ciclo 2a, herdada. Este plano a piora: ele roda `seed()` em quatro
   pontos, e o aviso aparece nos quatro.
3. O 🔍 **NV1** acima: o `curl` contra a API do n8n, que só o dono pode rodar.
4. **Nenhum push.** A branch fica local.

### 6. Riscos de execução, e o que os contém

| Risco | Contenção |
| --- | --- |
| Um leitor ou escritor que os dois instrumentos deixaram passar | Três camadas em série: `tsc` (Task 11, Step 7, esperado ZERO), varredura textual (Task 3, permanente), runtime contra o Postgres (Task 11, Step 8, e Task 13, Step 4). Cada uma manda **parar e reportar como ACHADO**, nunca "consertar e seguir" |
| `prisma migrate` pendurado sem imprimir nada | Constraint global mais aviso literal em Task 2, Step 3 e Task 11, Step 4: são as portas trocadas, **pare e reporte**, não edite o `.env` |
| `23502` ao parar de escrever a coluna | Task 2 inteira, e a ordem dura declarada em três lugares |
| `RAISE EXCEPTION` no meio do DROP | A transação da migração desfaz sozinha (o Prisma envolve cada `migration.sql`). O passo manda parar e reportar a mensagem, e afirma que nada foi apagado |
| Uma view ou índice dependendo da coluna | Task 11, Step 2 (consulta ao catálogo, resposta legível ANTES) mais o `DROP COLUMN` sem `CASCADE`, que recusaria de qualquer jeito. `CASCADE` não aparece no plano em lugar nenhum, de propósito |
| Apagar um `papel` que era do `Membership` | Regra escrita no cabeçalho das Tasks 9 e 10, cada Step nomeia a linha que **NÃO** muda, e o Step de execução manda repor antes de qualquer outra coisa se um teste falhar por papel |
| A trava reprovar o padrão CERTO (papel no vínculo aninhado) | Task 3, caso "papel escrito no Membership ANINHADO não é violação", com o trecho real de `session.test.ts` |
| A trava se acusar (ela cita o código que proíbe) | Task 3, caso "os próprios exemplos deste arquivo não se acusam", que roda o analisador sobre o próprio arquivo |
| `EM_CONVERSAO` virar depósito | A segunda asserção: arquivo listado que já não viola REPROVA. A lista só encolhe, nas duas direções |
| Duas execuções de `vitest` envenenarem o banco | Constraint global, repetida em todo Step que roda mais de um arquivo |
| As senhas de desenvolvimento serem reescritas sem o dono saber | Aviso em quatro Steps e no item 4 do relatório final |
| `Failed to start forks worker` confundido com defeito do ciclo | Task 13, Step 4, manda ler o rodapé de `vitest.config.ts` antes de investigar: é I/O do OneDrive, o arquivo citado muda a cada execução |
| A prosa da Task 12 mexer em código sem querer | Task 12, Step 8, roda `git diff --stat HEAD` e manda parar se linha executável aparecer |
