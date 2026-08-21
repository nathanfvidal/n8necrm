# Auditoria de segurança — Ciclo 1e (as quatro unicidades globais viram por empresa)

**Data:** 2026-08-21
**Escopo:** os 7 commits do Ciclo 1e na branch `ciclo-1a-tenancy`, `fda1906..1b4df8c` — a troca de
`Contact.telefone`, `PipelineStage.ordem`, `Conversation.waId` e `WhatsappMessage.idExterno` de
`@unique` de coluna única para `@@unique` composta com `companyId` na frente; as quatro migrações
que a executam; o defeito vivo de `criarEtapa` que a auditoria do schema desenterrou; a trava de
deriva das quatro compostas em `escopo-empresa.test.ts`; o parágrafo novo de `src/core/tenancy/escopo.ts`;
e o arquivo de prova `tests/unit/unicidades-por-empresa.test.ts`. 34 arquivos, `+4632 / -208`.
**Ambiente:** leitura de código e histórico local, execução dos três portões, da suíte Playwright e
da suíte unitária FOCADA nesta árvore, e consulta ao Postgres 17.6 real do Supabase (projeto
`uzumzfxjcxrbxaucvfsr`, `sa-east-1`) pelo `DIRECT_URL`.
**Escritas ao banco:** esta auditoria **escreveu no schema por conta própria**, e isso precisa ser a
primeira frase e não uma nota de rodapé. Ela executou **seis comandos DDL** — três pares
`DROP INDEX` / `CREATE UNIQUE INDEX` — para provar que o arquivo de teste discrimina. Cada par
deixou a base de desenvolvimento com a constraint ANTIGA por dezenas de segundos. Os três índices
foram repostos e a reposição está **provada abaixo, um a um**, com `pg_get_indexdef` e
`prisma migrate status` depois de cada uma. Fora isso, o que escreveu foi consequência dos testes
que mandou rodar: a suíte Playwright, cujas fixtures criam e apagam as próprias linhas, e o
`global-setup` do e2e, que regrava `senhaHash` de `e2e-admin@teste.invalid` e
`e2e-vendedor@teste.invalid` — **não** das contas do seed. **`npm test` NÃO foi executado**, e as
senhas de `admin@exemplo.com` e `vendedor@exemplo.com` **não foram tocadas por esta auditoria**.

## Resumo

**❌ Críticas em aberto: 0 · ⚠️ Riscos e dívidas: 14 (3 medidos aqui, 3 declarados pelo spec, 2
medidos pelas tarefas do ciclo, 6 herdados — e ⚠️ R2 do Ciclo 1a está **FECHADA**) · ✅ Verificados:
24 · 🔍 Não verificados: 6 · ❌ Herdados de infraestrutura, não corrigidos aqui: 5**

O ciclo faz o que se propôs, e a parte central dele está medida contra o Postgres real: as quatro
colunas deixaram de ser únicas no mundo e passaram a ser únicas dentro da empresa, com `companyId`
como **primeira** coluna do btree nos quatro. Nenhum índice de coluna única sobreviveu. As quatro
migrações contêm **só** `DROP INDEX` e `CREATE UNIQUE INDEX` — zero `INSERT`, `UPDATE`, `DELETE` ou
`ALTER TABLE` —, a guarda de migrações não foi acionada e `PERDOADAS` continua com **duas** entradas.
A catraca do Prisma cru continua em **zero**, `MODELOS_DE_TENANT` continua em **13**, e o diff de
`eslint.config.mjs` e dos dois arquivos de guarda no intervalo do ciclo é **vazio**: nenhuma exceção
foi concedida para fazer isto passar.

**Um relatório que parasse aqui seria falso pelo que omite.** Quatro coisas aconteceram neste ciclo
que não cabem numa lista de acertos:

- **`criarEtapa` tinha um defeito VIVO, não teórico.** Ele calculava `max(ordem DA EMPRESA) + 1` e
  gravava esse número contra uma constraint GLOBAL. Bastava a empresa A já ocupar a posição para a
  empresa B levar um `P2002` na tela `/etapas`, apontando para uma etapa que ela não pode enxergar.
  Foi reproduzido no RED da Task 2, no caminho de produção, e o `P2002` saiu de
  `src/core/pipeline/service.ts:197`. Quem o tornou alcançável foi o **próprio Ciclo 1d**, ao
  escopar o `_max` por empresa — a auditoria que o comentário do schema exigia é o que o achou.
- **O inventário que o spec chamava de "fechado" media só `src/` e `prisma/`.** Oito consultas em
  `tests/` pararam de compilar quando a chave mudou, e **uma delas afirmava a recusa entre
  empresas** (`lead-isolamento.test.ts`, "encontrarOuCriarContact não reaproveita contato de outra
  empresa"). Não corrigida, ela teria virado um teste verde defendendo o comportamento ANTIGO. Mais
  doze blocos de prosa afirmando no PRESENTE uma unicidade que tinha deixado de existir.
- **A escolha de `Conversation.waId` é decisão de PRODUTO, e ela custa alguma coisa.** Duas conexões
  da mesma empresa atendendo o mesmo número dão **uma** conversa, não duas. A consequência —
  declarada no schema, não escondida — é que a resposta sai pela conexão que **abriu** a conversa,
  não pela que recebeu a última mensagem.
- **A prova de que o arquivo de teste discrimina cobria uma das quatro constraints.** Esta auditoria
  fez as outras três, e a terceira delas produziu o achado mais desconfortável do documento: para
  `WhatsappMessage.idExterno`, a metade que prova "a dedup não afrouxou" fica **VERDE** com a
  constraint global de volta. Ela não é a metade que discrimina — e isso não estava escrito em lugar
  nenhum.

---

## Como a verificação foi feita

Toda linha marcada `✅ OK` abaixo carrega o comando e a saída. O que este ambiente não provou está em
`🔍 Não verificados`, com o comando que um humano precisa rodar — nunca como "ok" presumido. A regra
vem do `AGENTS.md` e existe por causa de uma auditoria de ciclo anterior que afirmou um gate que o
código não tinha.

Cinco restrições de método valem registro:

- **Nada de `vitest` em paralelo, e nada de `vitest` em paralelo com o DDL.** O banco de teste **não
  é separado** do de desenvolvimento (⚠️ R1 do Ciclo 1a). Todas as execuções citadas aqui foram em
  série, sozinhas, e as três reversões de índice foram feitas **uma de cada vez**, com a reposição
  provada antes do início da seguinte.
- **`npm test` NÃO foi executado.** O briefing da Task 7 o proíbe explicitamente ("Um comando por
  vez. **Não rodar `npm test`**"), e o motivo é o 🔍 NV6 herdado do Ciclo 2a: `npm test` roda
  `tests/unit/seed.test.ts`, que roda o seed e regrava o `senhaHash` de `admin@exemplo.com` e
  `vendedor@exemplo.com` com literais versionados neste repositório. Em vez dele, rodaram os **18
  arquivos focados** que o ciclo tocou, listados em ✅5, mais os dois de guarda (✅11, ✅13) — **20 dos 132** arquivos de `tests/unit/`. **Consequência a declarar:** a suíte
  unitária INTEIRA não foi executada nesta árvore. O que garante os outros 112 é
  `tsc --noEmit` verde mais o fato de que o ciclo não mexeu em `src/` fora de cinco arquivos.
- **`npm run test:e2e` FOI executado, e ele não toca as senhas do seed.** Conferido em
  `tests/e2e/global-setup.ts:52-60`: o `upsert` de `senhaHash` alcança
  `EMAIL_ADMIN_E2E` e `EMAIL_VENDEDOR_E2E`, que são `e2e-admin@teste.invalid` e
  `e2e-vendedor@teste.invalid`. As contas do seed não estão no laço.
- **Nenhum segredo, chave, token, senha ou blob aparece neste documento.**
- **Todas as contagens usam `/usr/bin/grep` ou uma sonda em arquivo executada por `tsx`**, nunca um
  `-e` colado na linha de comando. É a armadilha que as auditorias do Ciclo 1c e do 2a registraram:
  o proxy de linha de comando desta sessão come barras invertidas dentro de argumento.

---

## 1. O que o ciclo mudou, e a prova no Postgres

Sete commits, `fda1906..1b4df8c`:

| Commit | O que entrega |
| --- | --- |
| `fda1906` | spec e plano |
| `69e0f05` | `Contact.telefone` → `@@unique([companyId, telefone])` |
| `0b8a293` | `PipelineStage.ordem` → `@@unique([companyId, ordem])`, **e o defeito vivo de `criarEtapa` corrigido** |
| `ca1e52d` | `Conversation.waId` → `@@unique([companyId, waId])` |
| `2f03021` | `WhatsappMessage.idExterno` → `@@unique([companyId, idExterno])` |
| `d60e5ec` | trava de deriva das quatro compostas + o parágrafo de `src/core/tenancy/escopo.ts` |
| `1b4df8c` | `tests/unit/unicidades-por-empresa.test.ts` — duas empresas coexistindo com as quatro colisões |

### O estado das migrações

```
$ npx prisma migrate status
Datasource "db": PostgreSQL database "postgres", schema "public" at "aws-0-sa-east-1.pooler.supabase.com:5432"
23 migrations found in prisma/migrations
Database schema is up to date!
```

`19 + 4 = 23`, exatamente o que o critério de aceite §12.1 previa. As quatro novas:

```
20260820220000_contato_telefone_por_empresa
20260820230000_etapa_ordem_por_empresa
20260820240000_conversa_waid_por_empresa
20260820250000_mensagem_idexterno_por_empresa
```

E o conteúdo delas, com comentários e linhas em branco removidos — **duas linhas cada**, nada mais:

```sql
-- 20260820220000_contato_telefone_por_empresa
DROP INDEX "Contact_telefone_key";
CREATE UNIQUE INDEX "Contact_companyId_telefone_key" ON "Contact"("companyId", "telefone");
-- 20260820230000_etapa_ordem_por_empresa
DROP INDEX "PipelineStage_ordem_key";
CREATE UNIQUE INDEX "PipelineStage_companyId_ordem_key" ON "PipelineStage"("companyId", "ordem");
-- 20260820240000_conversa_waid_por_empresa
DROP INDEX "Conversation_waId_key";
CREATE UNIQUE INDEX "Conversation_companyId_waId_key" ON "Conversation"("companyId", "waId");
-- 20260820250000_mensagem_idexterno_por_empresa
DROP INDEX "WhatsappMessage_idExterno_key";
CREATE UNIQUE INDEX "WhatsappMessage_companyId_idExterno_key" ON "WhatsappMessage"("companyId", "idExterno");
```

```
$ /usr/bin/grep -c -iE "insert|update|delete|alter table" <as quatro migration.sql>
0   0   0   0
```

Isto fecha a §6 do spec por **medição** e não por dedução: sem `ADD COLUMN` e sem `SET NOT NULL`, o
analisador de `migracoes-seguras.test.ts` não tem o que reportar, e `PERDOADAS` não recebeu entrada.

### Os quatro índices, lidos do `pg_index`

Sonda contra `DIRECT_URL`, listando **todos** os índices únicos das quatro tabelas — não só os que
se espera encontrar, para que um sobrevivente aparecesse sozinho:

```
Contact          Contact_companyId_telefone_key             btree ("companyId", telefone)
Contact          Contact_pkey                               btree (id)
Conversation     Conversation_companyId_waId_key            btree ("companyId", "waId")
Conversation     Conversation_pkey                          btree (id)
PipelineStage    PipelineStage_companyId_ordem_key          btree ("companyId", ordem)
PipelineStage    PipelineStage_pkey                         btree (id)
WhatsappMessage  WhatsappMessage_companyId_idExterno_key    btree ("companyId", "idExterno")
WhatsappMessage  WhatsappMessage_pkey                       btree (id)
```

Oito índices, quatro compostos e quatro PKs. **Nenhum** `Contact_telefone_key`,
`PipelineStage_ordem_key`, `Conversation_waId_key` ou `WhatsappMessage_idExterno_key`. E `companyId`
é a **primeira** coluna nos quatro, que é o que faz o índice servir também `WHERE "companyId" = $1`.

No schema, o outro lado da mesma afirmação:

```
$ /usr/bin/grep -nE "^\s+(telefone|ordem|waId|idExterno)\s+\w+.*@unique" prisma/schema.prisma
(nenhuma linha)
```

Nenhuma das quatro colunas carrega `@unique` de coluna única. As compostas estão em
`prisma/schema.prisma:249`, `:291`, `:550` e `:792`.

---

## 2. A prova de que o arquivo de teste DISCRIMINA — as quatro, agora, e o que a quarta revelou

O risco central deste ciclo é **"apaguei a constraint" passar por "escopei a constraint"**. Um
arquivo de teste que só afirma coexistência passaria num banco sem unicidade nenhuma. A Task 6 provou
a discriminação revertendo **uma** das quatro à mão (`Contact`); as outras três ficaram pendentes, e
três quartos de uma prova é o tipo exato de lacuna que uma auditoria existe para não deixar passar.

Esta auditoria fez as três restantes. Procedimento, idêntico para cada uma: reverter o índice à mão
no Postgres, ler `pg_get_indexdef` para confirmar a reversão, rodar
`tests/unit/unicidades-por-empresa.test.ts` e ler **por que** ele fica vermelho, repor o índice, ler
`pg_get_indexdef` de novo, confirmar `prisma migrate status` limpo e o teste verde. Uma de cada vez,
com a reposição provada antes do início da seguinte.

### 2.1 `PipelineStage_companyId_ordem_key` — vermelho pela fixture, não por um caso

```
SQL> DROP INDEX "PipelineStage_companyId_ordem_key"                                    OK
SQL> CREATE UNIQUE INDEX "PipelineStage_ordem_key" ON "PipelineStage"(ordem)           OK
PipelineStage    PipelineStage_ordem_key    btree (ordem)
PipelineStage    PipelineStage_pkey         btree (id)
```

```
$ npx vitest run tests/unit/unicidades-por-empresa.test.ts
 ❯ tests/unit/unicidades-por-empresa.test.ts (6 tests | 6 failed) 8244ms
PrismaClientKnownRequestError:
Invalid `prisma.pipelineStage.createMany()` invocation in
  tests/unit/unicidades-por-empresa.test.ts:147:30
Unique constraint failed on the fields: (`ordem`)
 ❯ semear tests/unit/unicidades-por-empresa.test.ts:147:3
 Test Files  1 failed (1)
      Tests  6 failed (6)
```

Discrimina — e vale registrar **como**, porque não é do mesmo gênero da prova de `Contact`. Ali o
vermelho saiu de dentro de `encontrarOuCriarContact`, no caminho exato do defeito. Aqui ele sai da
**fixture**: `semear()` não consegue nem montar o cenário, porque duas empresas com a mesma posição
de funil não cabem no banco. O erro nomeia `ordem` **sozinha** — a chave antiga —, que é a
informação que importa. Mas os seis casos morrem juntos, e um sinal de seis não distingue qual
constraint foi mexida. Fica registrado como ⚠️ A2.

Reposição, provada:

```
SQL> DROP INDEX "PipelineStage_ordem_key"                                                        OK
SQL> CREATE UNIQUE INDEX "PipelineStage_companyId_ordem_key" ON "PipelineStage"("companyId", ordem)  OK
PipelineStage    PipelineStage_companyId_ordem_key    btree ("companyId", ordem)
PipelineStage    PipelineStage_pkey                   btree (id)

$ npx prisma migrate status   → 23 migrations found · Database schema is up to date!
$ npx vitest run tests/unit/unicidades-por-empresa.test.ts   → Tests 6 passed (6)  · 11.94s
```

### 2.2 `Conversation_companyId_waId_key` — vermelho no caminho de produção, cirúrgico

```
SQL> DROP INDEX "Conversation_companyId_waId_key"                              OK
SQL> CREATE UNIQUE INDEX "Conversation_waId_key" ON "Conversation"("waId")     OK
Conversation     Conversation_pkey       btree (id)
Conversation     Conversation_waId_key   btree ("waId")
```

```
$ npx vitest run tests/unit/unicidades-por-empresa.test.ts
 ❯ tests/unit/unicidades-por-empresa.test.ts (6 tests | 1 failed) 12153ms
     × o MESMO número e o MESMO id de mensagem entram nas duas empresas 1602ms
PrismaClientKnownRequestError:
Invalid `tx.conversation.create()` invocation in
  src/modules/whatsapp/ingest.ts:146:46
Unique constraint failed on the fields: (`"waId"`)
 ❯ Module.ingerirMensagem src/modules/whatsapp/ingest.ts:93:12
 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
```

Esta é a melhor das quatro provas, e é a que mais importa: **um caso vermelho, e ele é o 500 em laço
da §3.1 do spec, ao vivo**. O `P2002` sai de `ingerirMensagem` → `tx.conversation.create` em
`ingest.ts:146` — o caminho por onde o webhook da Evolution entra. Com a constraint global, a segunda
empresa que atendesse o mesmo número receberia 500 na rota, e a Evolution reentregaria para sempre.
Com a composta, a linha entra.

Reposição, provada:

```
SQL> DROP INDEX "Conversation_waId_key"                                                       OK
SQL> CREATE UNIQUE INDEX "Conversation_companyId_waId_key" ON "Conversation"("companyId","waId")  OK
Conversation     Conversation_companyId_waId_key    btree ("companyId", "waId")
Conversation     Conversation_pkey                  btree (id)

$ npx prisma migrate status   → 23 migrations found · Database schema is up to date!
$ npx vitest run tests/unit/unicidades-por-empresa.test.ts   → Tests 6 passed (6)  · 12.30s
```

### 2.3 `WhatsappMessage_companyId_idExterno_key` — e o achado que só apareceu aqui

```
SQL> DROP INDEX "WhatsappMessage_companyId_idExterno_key"                                  OK
SQL> CREATE UNIQUE INDEX "WhatsappMessage_idExterno_key" ON "WhatsappMessage"("idExterno")  OK
WhatsappMessage  WhatsappMessage_idExterno_key    btree ("idExterno")
WhatsappMessage  WhatsappMessage_pkey             btree (id)
```

```
$ npx vitest run tests/unit/unicidades-por-empresa.test.ts
 ❯ tests/unit/unicidades-por-empresa.test.ts (6 tests | 1 failed) 11034ms
     × o MESMO número e o MESMO id de mensagem entram nas duas empresas 1590ms
PrismaClientKnownRequestError:
Invalid `tx.whatsappMessage.create()` invocation in
  src/modules/whatsapp/ingest.ts:157:32
Unique constraint failed on the fields: (`"idExterno"`)
 ❯ Module.ingerirMensagem src/modules/whatsapp/ingest.ts:93:12
 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
```

Cirúrgico como o anterior, no caminho de produção, e desta vez `Conversation` passou (a composta dela
estava reposta) e quem barrou foi a mensagem, em `ingest.ts:157`.

**O que só apareceu porque esta reversão foi feita:** o caso "a reentrega DENTRO da mesma empresa
continua deduplicando — a segunda metade" ficou **VERDE** com a constraint global de volta. E está
certo que tenha ficado: uma constraint global sobre `idExterno` também impede a segunda gravação
dentro da mesma empresa. O caso mede o que promete e não afrouxou nada.

Mas a conclusão que se tira disso não estava escrita em lugar nenhum, e ela reordena o raciocínio do
ciclo inteiro. **As duas metades de cada par respondem a perguntas diferentes, e só uma delas
discrimina a reversão:**

| | O que a metade prova | Fica vermelha se a constraint voltar a ser global? |
| --- | --- | --- |
| Coexistência | que a constraint foi **escopada** | **sim** — é ela que discrimina |
| Segunda metade | que a constraint não foi **apagada** | **não** — uma global também deduplica dentro da empresa |

Nenhuma das duas é dispensável, e nenhuma cobre o buraco da outra: sem a coexistência, um banco com a
constraint antiga passaria; sem a segunda metade, um banco **sem constraint nenhuma** passaria. O que
esta auditoria acrescenta é o mapa de qual serve para quê — antes disso, um leitor podia razoavelmente
achar que "a segunda metade" era uma segunda prova da mesma coisa. Fica registrado como ⚠️ A3, com o
conserto sugerido: uma linha de comentário em cada par dizendo qual das duas morde em qual mutação.

Reposição, provada — e a listagem completa das quatro tabelas, não só da mexida:

```
SQL> DROP INDEX "WhatsappMessage_idExterno_key"                                                          OK
SQL> CREATE UNIQUE INDEX "WhatsappMessage_companyId_idExterno_key" ON "WhatsappMessage"("companyId","idExterno")  OK

Contact          Contact_companyId_telefone_key             btree ("companyId", telefone)
Contact          Contact_pkey                               btree (id)
Conversation     Conversation_companyId_waId_key            btree ("companyId", "waId")
Conversation     Conversation_pkey                          btree (id)
PipelineStage    PipelineStage_companyId_ordem_key          btree ("companyId", ordem)
PipelineStage    PipelineStage_pkey                         btree (id)
WhatsappMessage  WhatsappMessage_companyId_idExterno_key    btree ("companyId", "idExterno")
WhatsappMessage  WhatsappMessage_pkey                       btree (id)

$ npx prisma migrate status   → 23 migrations found · Database schema is up to date!
$ npx vitest run tests/unit/unicidades-por-empresa.test.ts   → Tests 6 passed (6)  · 12.28s
```

### 2.4 As quatro, somadas

| Constraint | Onde o vermelho sai | Casos vermelhos | Feita por |
| --- | --- | --- | --- |
| `Contact_companyId_telefone_key` | `encontrarOuCriarContact`, `src/core/leads/dedupe.ts:215` — o ramo de `P2002` que a Task 1 **reescreveu em vez de apagar** | 1 de 6 | Task 6 |
| `PipelineStage_companyId_ordem_key` | a fixture `semear()`, `unicidades-por-empresa.test.ts:147` | 6 de 6 | **esta auditoria** |
| `Conversation_companyId_waId_key` | `ingerirMensagem`, `src/modules/whatsapp/ingest.ts:146` | 1 de 6 | **esta auditoria** |
| `WhatsappMessage_companyId_idExterno_key` | `ingerirMensagem`, `src/modules/whatsapp/ingest.ts:157` | 1 de 6 | **esta auditoria** |

Três das quatro reversões produzem vermelho **dentro de código de produção**, não dentro do teste. É
a diferença entre um arquivo que verifica um `CREATE INDEX` e um arquivo que verifica o
comportamento que o índice governa.

---

## 3. O defeito VIVO: `criarEtapa` calculava um número que outra empresa podia estar ocupando

Este é o achado do ciclo, e ele não era hipótese.

`criarEtapa` (`src/core/pipeline/service.ts:180`) põe a etapa nova no fim do funil. Para isso calcula
`max(ordem) + 1`. Desde o **Ciclo 1d** esse `_max` é escopado por empresa — o que era, e continua
sendo, a correção certa. Só que a coluna `ordem` era `@@unique([ordem])` **GLOBAL**. As duas coisas
juntas são um defeito: a empresa B pergunta "qual a minha maior posição?", recebe 4, tenta gravar 5,
e o banco recusa porque a **empresa A** já tem uma etapa na posição 5.

O efeito visível para quem usa: `P2002` na tela `/etapas`, ao clicar em "criar etapa", com a
constraint apontando para uma linha de outra empresa que a pessoa não tem como enxergar nem apagar.
Recusa alta, não vazamento — mas recusa que não tem conserto pelo lado de quem opera.

Reproduzido no RED da Task 2, no caminho de produção:

```
 FAIL  ... > `criarEtapa` na B cai em `max(ordem da B) + 1` mesmo com a A já ocupando esse número
PrismaClientKnownRequestError:
Invalid `db.pipelineStage.create()` invocation in
  src/core/pipeline/service.ts:197:40
Unique constraint failed on the fields: (`ordem`)
 ❯ Module.criarEtapa src/core/pipeline/service.ts:197:17
```

O RED aqui não é "o teste novo ainda não passa". É o `P2002` **saindo de `criarEtapa`**, na pilha de
produção. Hoje o caso vive em `tests/unit/unicidades-por-empresa.test.ts` como
"`criarEtapa` na B não colide com a posição que a A já ocupa", e ele é o par de coexistência do
`PipelineStage`.

**Duas coisas a registrar sobre a origem deste defeito**, porque a lição é maior que o conserto:

1. **Ele foi criado por uma correção de segurança.** Enquanto o `_max` era global, `criarEtapa` era
   *inofensivo por acidente*: perguntava ao mundo e gravava contra o mundo, e as duas metades
   batiam. O Ciclo 1d escopou a pergunta e não a chave, e foi aí que a janela abriu. O comentário
   de `primeiraEtapaDoFunil` em `src/core/leads/service.ts` levava a frase "inofensivo por
   acidente"; o Ciclo 1e a trocou por "o Ciclo 1e desfez o acidente; o escopo agora é a única coisa
   que segura".
2. **Quem o achou foi a auditoria que o comentário do schema exigia**, não um teste falhando nem um
   usuário reclamando. Se o Ciclo 1e não tivesse sido desenhado, o defeito continuaria lá até a
   segunda empresa existir — e aí apareceria como "criar etapa não funciona", sem pista nenhuma.

O estacionamento `ORDEM_ESTACIONAMENTO` **continua necessário** depois do ciclo, e o comentário foi
reescrito para dizer por quê: a colisão que ele evita é entre duas etapas da **mesma** empresa
durante o reordenamento. O que mudou é que o valor `-1` deixou de ser disputado entre empresas.

---

## 4. O inventário "fechado" do spec não estava fechado — e uma das lacunas era um teste

A §7 do spec se intitula "O que muda fora do schema — **inventário fechado**". Ele mede `src/` e
`prisma/`. **Não mede `tests/`.** O resultado, medido pelas tarefas:

- **Oito consultas em `tests/` pararam de compilar** quando a chave mudou. Sete eram oráculo ou
  limpeza — `findUnique({ where: { telefone } })`, `findUniqueOrThrow` — e viraram
  `findFirst`/`findFirstOrThrow` com `companyId` no `where`. Ganharam com a troca: passaram a nomear
  a empresa em vez de depender da unicidade global para acertar a linha.
- **A oitava era um caso de teste que afirmava a recusa entre empresas.**
  `tests/unit/lead-isolamento.test.ts`, "encontrarOuCriarContact não reaproveita contato de outra
  empresa", com `rejects.toThrow(/outra empresa/i)`. Este é o item que justifica a seção inteira: um
  caso que **afirmava** o comportamento antigo. Não corrigido, ele teria virado um teste **verde**
  defendendo exatamente o que o ciclo existe para desfazer, e o próximo leitor concluiria que a
  recusa era desejada. Reescrito com a mesma forma dos outros pares: a empresa A cria o contato
  DELA, e a linha da B fica intacta.
- **Doze blocos de prosa afirmavam no PRESENTE uma unicidade que deixou de existir** — cinco sobre
  `Contact.telefone` (`lead-isolamento`, `pipeline-isolamento`, `task-isolamento`,
  `whatsapp-isolamento`, `global-setup`), cinco sobre `PipelineStage.ordem`, e mais os de
  `Conversation.waId` **fora** do módulo de WhatsApp: o doc de `WhatsappConnection.webhookTokenHash`
  no `prisma/schema.prisma`, o caso de `tests/unit/escopo-empresa.test.ts` que trava aquela linha, e
  `tests/e2e/whatsapp-agente.spec.ts`. Todos **reescritos, nenhum apagado**: onde havia "é `@unique`
  GLOBAL" agora há "era `@unique` GLOBAL até o Ciclo 1e, e o motivo do contorno é este outro".

Varredura final desta auditoria, que é o critério de aceite §12.7:

```
$ /usr/bin/grep -rn "unique. GLOBAL" src/ prisma/ tests/
src/core/contacts/service.ts:118      quando `Contact.telefone` era `@unique` GLOBAL: digitar…   [passado]
src/core/users/service.ts:36          `User` … e `email` é `@unique` GLOBAL                       [User, não é tenant]
src/modules/whatsapp/ingest.ts:121    até o Ciclo 1e, `waId` era `@unique` GLOBAL                 [passado]
tests/e2e/seguranca-headers.spec.ts:40  O comentário anterior culpava … ser `@unique` GLOBAL      [passado]
tests/unit/contact-isolamento.test.ts:414  era `@unique` GLOBAL, e o mesmo número não podia…      [passado]
tests/unit/escopo-empresa.test.ts:840  `WhatsappConnection.webhookTokenHash` é `@unique` GLOBAL   [exceção nomeada]
tests/unit/lead-isolamento.test.ts:514  Enquanto `Contact.telefone` era `@unique` GLOBAL          [passado]
tests/unit/unicidades-por-empresa.test.ts:234  `webhookTokenHash` é `@unique` GLOBAL de propósito [exceção nomeada]

$ /usr/bin/grep -rn "PipelineStage.@@unique(\[ordem\])\|Contact.telefone. é .@unique. GLOBAL\|waId. é .@unique. GLOBAL" src/ prisma/ tests/
(nenhuma linha)
```

Oito ocorrências, conferidas uma a uma: cinco em tempo **passado**, uma sobre `User.email` (que não é
modelo de tenant e cujo motivo está escrito em `src/core/users/service.ts:33-39`), e duas sobre
`WhatsappConnection.webhookTokenHash` — a exceção **nomeada** de §9.5 do spec, global de propósito
porque segredo de 256 bits repetido entre empresas é estado que deve ser impossível. Nenhuma frase
afirma, no presente, que uma das quatro é global. **§12.7 fechado.**

**A lição, e ela vale além deste ciclo:** um inventário que mede só código de produção mede metade do
repositório. Quando a mudança é de **schema**, o oráculo dos testes é feito da mesma chave que mudou,
e é ele que mais silenciosamente vira mentira — porque continua verde.

---

## 5. `Conversation.waId` é decisão de PRODUTO, e a consequência está declarada

A chave podia ter sido `[connectionId, waId]`. Não foi, e o motivo não é técnico:

**Duas conexões da mesma empresa atendendo o mesmo número dão UMA conversa, não duas.** Porque
`Conversation` não guarda só mensagens — ela carrega `iaAtiva`, `iaPausadaPor` e
`aguardandoHumanoDesde`. Duplicá-la por conexão duplicaria o estado do atendimento, e o modo de falha
é concreto: o humano assume de um lado enquanto o bot continua respondendo do outro, para a mesma
pessoa, no mesmo número.

Há também um motivo de integridade que só aparece quando se olha o `NULL`: `connectionId` é anulável
(conversas anteriores ao Ciclo 2a não têm conexão, e não houve backfill). Numa `@@unique` do
Postgres, `NULL` não é igual a `NULL` — duas linhas com o mesmo `waId` e `connectionId` nulo
**ambas** passariam. A chave por conexão não seria uma chave.

**A consequência, declarada e não corrigida:** a resposta sai por `Conversation.connectionId`, que é
a conexão que **ABRIU** a conversa — não necessariamente aquela para a qual o cliente escreveu por
último. Está escrita no `prisma/schema.prisma:536-544`, junto da chave, com o conserto já nomeado
(atualizar `connectionId` a cada mensagem de ENTRADA, como já se faz com `nomeExibicao`) e deixado
para o dono. É ⚠️ D3-a.

Ela só morde com **duas conexões ativas na mesma empresa**. Hoje o banco tem **zero** conexões
(sonda final), então não morde ninguém — e é por isso que decidir agora é barato.

---

## 6. O oráculo dos casos de `P2002` depende da string da mensagem do Prisma

Registrado pela Task 4 e herdado por esta auditoria, porque é o ponto onde a prova é mais frágil.

As "segundas metades" de `Conversation.waId` e de `WhatsappMessage.idExterno`, em
`tests/unit/whatsapp-isolamento.test.ts:725` e `:827`, afirmam duas coisas: que o erro tem
`code === "P2002"` **e** que a mensagem contém a substring `companyId`. É a segunda que distingue
"escopei a constraint" de "apaguei a constraint": com a chave antiga, a mensagem trazia só o campo
solitário, e a asserção falhava — medido nos dois sentidos nos REDs das Tasks 3 e 4.

**O risco:** isso acopla o teste ao formato de mensagem de uma biblioteca. Se o Prisma passar a
reportar violação por **nome de constraint** em vez de por lista de campos, esses casos ficam
vermelhos por um motivo que **não é defeito do produto**, e alguém vai perder uma tarde. A
alternativa óbvia — ler `meta.target` em vez da mensagem — não é mais estável no adapter `pg`, que é
o que esta base usa (`@prisma/adapter-pg`).

Mantido como está, com o motivo escrito nos comentários dos próprios casos, para que a falha futura
seja diagnosticada em minutos e não em horas. `tests/unit/unicidades-por-empresa.test.ts` **não**
tem essa fragilidade: ele mede efeito — contagens e ids lidos com o Prisma cru —, não string de erro.

---

## 7. `rejects.toThrow()` sem argumento: apertado neste ciclo, ainda frouxo na porta ao lado

O briefing da Task 4 ditava `rejects.toThrow()` **sem argumento** para a segunda metade de
`idExterno`. Um `toThrow()` nu aceita qualquer erro: uma violação de chave estrangeira, um enum
inválido, um `undefined is not a function`. Um teste desses não distingue "a dedup continua valendo"
de "o código quebrou de outro jeito". Foi trocado por `code === "P2002"` mais a mensagem, e o mesmo
tratamento foi aplicado ao caso de `waId`. É um dos itens em que a execução **apertou** o briefing.

**O que a auditoria mede é que o padrão sobrevive fora do ciclo:**

```
$ /usr/bin/grep -rn "rejects.toThrow()" tests/unit/ | wc -l
17

    5  tests/unit/lead-isolamento.test.ts
    4  tests/unit/whatsapp-isolamento.test.ts
    2  tests/unit/whatsapp-queue-consumer-route.test.ts
    1  cada em whatsapp-agente, tasks-editar, supabase-jwt-emitir,
       supabase-access-token, rota-token-supabase, escopo-empresa
```

Os cinco de `lead-isolamento.test.ts` (`:324`, `:353`, `:384`, `:392`, `:405`) são os que importam:
guardam afirmações de **recusa entre empresas** em `moverEtapa`, `arquivarLead`, `desarquivarLead` e
`adicionarNota`. Lidos um a um, eles **não** estão desprotegidos — cada um tem uma segunda metade
que lê a linha da empresa B com o Prisma cru e afirma que ela não mudou (`leadB.stageId` intacto,
`leadB.arquivadoEm` continua `null`). O efeito está medido.

O que **não** está medido é o **motivo** do `throw`. Uma mudança que fizesse `moverEtapa` lançar por
outra razão — etapa inexistente, autor sem vínculo — manteria os cinco casos verdes enquanto a
recusa por empresa deixasse de existir. É ⚠️ A1. Não é achado deste ciclo e não é urgente; é a mesma
família que o ciclo acabou de apertar em dois lugares, ainda aberta em cinco, e o conserto é o mesmo:
afirmar a classe do erro (`EscopoDeEmpresaError`) ou a mensagem.

---

## 8. Os briefings contradiziam o repositório — e a conta não é 21

A instrução desta tarefa afirma que "vinte e uma contradições entre os briefings e o repositório
foram achadas pelas tarefas deste ciclo". Contadas nos próprios relatórios, sob o título
*"Contradições entre briefing e repositório"* que cada um usa, o número é **14**:

| Tarefas | Itens | Relatório |
| --- | --- | --- |
| 1 e 2 | 7 (C1–C7) | `.superpowers/sdd/task-1e-1e2-report.md` |
| 3 e 4 | 7 (C1–C7) | `.superpowers/sdd/task-1e-3e4-report.md` |
| 5 e 6 | 0 — "nenhuma divergência encontrada"; a varredura de prosa achou 28 ocorrências, **todas já reescritas** pelas Tasks 1–4 | `.superpowers/sdd/task-1e-5e6-report.md` |
| **total documentado** | **14** | |

Mais **duas** achadas por esta tarefa, que os relatórios anteriores não tinham como registrar:

15. **O Step 5 do `task-7-brief.md` diz "`typecheck` e `lint` sem saída".** `npm run lint` **tem**
    saída: `✖ 6 problems (0 errors, 6 warnings)`. As 6 são pré-existentes e nomeadas em ✅2, nenhuma
    em arquivo deste ciclo. O critério de aceite §12.6 diz "limpos", que para `lint` nesta base
    significa **zero erros** — e é assim que está verificado.
16. **O Step 7 do `task-7-brief.md` manda entregar o fechamento "na resposta do agente, não num
    arquivo `.md`".** A instrução de trabalho do dono, mais recente, pede este documento em
    `docs/auditorias/` mais um relatório em `.superpowers/sdd/`. Prevaleceu a instrução do dono, pelo
    mesmo critério que a C1 das Tasks 1–2 usou para ficar em `ciclo-1a-tenancy` em vez de abrir
    branch nova: **a instrução direta é mais recente que o plano**.

Total conferido: **16**. Registro a diferença porque um documento cujo primeiro parágrafo diz
"provar, não presumir" não pode repetir um número que ele não contou. É o mesmo procedimento que a
auditoria do Ciclo 2a adotou quando a instrução dizia 22 e a contagem deu 32.

**Nenhuma das 16 afrouxou guarda** — conferido item a item nos relatórios. **Cinco apertaram.** As
quatro que mais importam para quem for revisar:

1. **Um caso de teste que teria virado a favor do defeito** (Tasks 1–2, C4). O spec dizia que os
    casos a reescrever eram os **dois** de `contact-isolamento.test.ts`. Havia um terceiro, em
    `lead-isolamento.test.ts`, afirmando `rejects.toThrow(/outra empresa/i)` — ver §4.
2. **`rejects.toThrow()` sem argumento, ditado pelo briefing** (Tasks 3–4, C3). Trocado por
    `code === "P2002"` + mensagem contendo `companyId` — ver §7.
3. **Comentários apontando para um arquivo que ainda não existia** (Tasks 3–4, C1). Os briefings
    mandavam citar `tests/unit/unicidades-por-empresa.test.ts` como o lugar onde as duas metades
    estão travadas, num commit em que a Task 6 ainda não o tinha criado. Trocado pelo caso que
    existia naquele commit. Citar arquivo inexistente é precisamente a afirmação-sem-caso que a
    restrição do ciclo proíbe.
4. **Prosa mentindo entre dois commits** (Tasks 3–4, C4; Tasks 1–2, C7). O bloco de doc do topo de
    `whatsapp-isolamento.test.ts` fala de `waId` **e** `idExterno`; o briefing mandava editá-lo só na
    Task 4. Ele passaria a mentir sobre `waId` já no commit da Task 3. Editado nas duas, com o texto
    intermediário dizendo "`waId` por empresa, `idExterno` ainda global **neste commit**". Deixar
    prosa falsa entre dois commits é o defeito que este ciclo inteiro existe para combater.

Um quinto item merece nota por ser do gênero mais perigoso: **o spec §4.2.4 previa o defeito de
`criarEtapa` como um item de desenho, e ele era um defeito vivo em produção** (§3). A diferença entre
as duas leituras não é acadêmica: um item de desenho pode esperar o próximo ciclo; um `P2002` na tela
de quem opera, não.

---

## 9. Erros meus, do controlador

1. **Escrevi no schema do banco de desenvolvimento por conta própria, seis vezes.** As três reversões
   de índice desta auditoria (§2) são DDL contra a base compartilhada, e cada uma deixou a base com a
   constraint ERRADA por dezenas de segundos. Foi a pedido explícito do dono e o procedimento foi o
   mais estreito que eu sabia fazer — uma de cada vez, reposição provada por `pg_get_indexdef` e
   `prisma migrate status` antes do início da seguinte, nada mais rodando contra a base durante a
   janela. Ainda assim: **é garantia de contexto, não do procedimento**. Se outra pessoa ou outro
   agente tivesse gravado contra esta base nesses segundos, teria batido numa constraint que o
   `schema.prisma` diz não existir. A causa raiz é ⚠️ R1, e ela continua aberta.
2. **Contei as contradições em vez de repetir o número que recebi.** Ver §8: a instrução diz 21, a
   contagem pelos relatórios dá 14, mais 2 achadas aqui = 16.
3. **Não rodei a suíte unitária inteira, e isso é uma lacuna de cobertura, não só de rótulo.** O
   briefing proíbe `npm test` e o motivo é bom (🔍 NV6). Mas a consequência é que 112 dos 132 arquivos de
   `tests/unit/` não foram executados nesta árvore. O que os cobre é `tsc --noEmit` verde — que pega
   o gênero de quebra que esta mudança de schema causa, porque o cliente Prisma é tipado e um `where`
   com chave antiga não compila — mais o e2e inteiro, mais os 20 que rodaram. Não é o mesmo que
   ter rodado. Está em 🔍 NV7 com o comando que fecha.
4. **Deixei um arquivo de sonda na raiz do projeto durante a execução.** `sonda-1e.mts` foi criado
   para que nenhuma consulta ao banco dependesse de escape de aspas na linha de comando (a armadilha
   registrada pelas auditorias do 1c e do 2a). Ele passou por `tsc --noEmit`, `eslint` e
   `next build` sem alterar a saída de nenhum dos três, e foi **removido antes do commit** —
   `git status` limpo é a prova, e está colada no relatório da tarefa.

---

## ✅ Verificado e correto

| # | Item | Como foi verificado |
|---|---|---|
| 1 | `npm run typecheck` verde | `tsc --noEmit` → **sem saída**, `exit=0` |
| 2 | `npm run lint` sem **erro** | `✖ 6 problems (0 errors, 6 warnings)`. As 6, nomeadas: `src/components/leads/lead-table.tsx:117` (`Compilation Skipped: Use of incompatible library`, TanStack Table), `src/core/contacts/actions.ts:61` (`_ignorado`), `tests/unit/proxy-matcher.test.ts:53` (diretiva `eslint-disable` órfã), `tests/unit/whatsapp-fila-vercel.test.ts:22` (3× parâmetro não usado). **Nenhuma em arquivo tocado por este ciclo** — as mesmas 6 que a auditoria do Ciclo 2a mediu |
| 3 | `npm run build` verde | `✓ Compiled successfully in 1528ms` · `Finished TypeScript in 12.3s` · `✓ Generating static pages (6/6)` · exit 0 |
| 4 | A tabela de rotas **não mudou**, e a prova é o diff vazio | `git diff --stat 60607fa..HEAD -- src/app/` → **saída vazia**. O build lista **1** estática (`○ /_not-found`) e **23** dinâmicas + `ƒ Proxy (Middleware)`, e nenhuma rota foi criada, apagada ou movida por este ciclo |
| 5 | Os **18 arquivos** que o ciclo tocou, verdes, **em série, um comando por vez** | `unicidades-por-empresa` 6/6 · `escopo-empresa` 68/68 · `contact-isolamento` 17/17 · `pipeline-isolamento` 19/19 · `whatsapp-isolamento` 26/26 · `lead-isolamento` 17/17 · `dedupe`+`contacts-service` 51/51 · `pipeline-service`+`pipeline-stages`+`pipeline-transacoes` 34/34 · `whatsapp-ingest`+`whatsapp-turno`+`whatsapp-agente` 51/51 · `whatsapp-webhook-route`+`whatsapp-envio-por-conexao` 33/33 · `seed`+`seed-demo` 14 passed / 13 skipped. **Total: 336 asserções passando, 13 puladas, em 17 arquivos executados** — o 18º (`seed-demo`) é pulado inteiro por `skipIf`, ver ✅6 |
| 6 | O 1 arquivo pulado é conhecido e alheio | `tests/unit/seed-demo.test.ts`, `describe.skipIf(!funilEhOSemeado)`: exige 5 etapas com a última `ehGanho`; o banco de dev tem 4 (sonda final). Pré-existente desde o Ciclo 1c |
| 7 | As quatro migrações aplicadas, sem deriva de estado | `npx prisma migrate status` → `23 migrations found in prisma/migrations` · `Database schema is up to date!` — rodado **quatro vezes** nesta sessão, incluindo depois de cada reposição de índice (§2) |
| 8 | Os quatro índices compostos existem, com `companyId` **na frente**, e nenhum antigo sobreviveu | Sonda `pg_index` + `pg_get_indexdef` sobre as 4 tabelas, **sem lista fixa de nomes** — um índice sobrevivente apareceria sozinho. Saída completa em §1 e §2.3 |
| 9 | As quatro `@@unique` no schema, e nenhuma `@unique` de coluna única nas quatro colunas | `prisma/schema.prisma:249`, `:291`, `:550`, `:792`; e `/usr/bin/grep -nE "^\s+(telefone\|ordem\|waId\|idExterno)\s+\w+.*@unique" prisma/schema.prisma` → **nenhuma linha** |
| 10 | As quatro migrações são **só** troca de índice | `/usr/bin/grep -c -iE "insert\|update\|delete\|alter table"` nas quatro → `0 0 0 0`. Nenhuma coluna nova, nenhuma coluna virando `NOT NULL`, nenhum dado tocado. Zero backfill |
| 11 | `tests/unit/migracoes-seguras.test.ts` verde | `Test Files 1 passed (1)` · `Tests 5 passed (5)` · 323ms |
| 12 | `PERDOADAS` continua com **exatamente 2** entradas | Chaves de topo do objeto, lidas por `awk` sobre o bloco `38..96`: `"20260813200000_contato_cadastro_completo"` e `"20260819140000_restaura_user_papel_temporariamente"`. **Nenhuma entrada nova neste ciclo** — §6 do spec fechada por medição |
| 13 | `tests/unit/catraca-prisma-cru.test.ts` verde, isolado | `Test Files 1 passed (1)` · `Tests 18 passed (18)` · 378ms |
| 14 | **A catraca continua em ZERO** | `/usr/bin/grep -n` → `108:const LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS = 0;` |
| 15 | **`MODELOS_DE_TENANT` continua em 13** | `tests/unit/escopo-empresa.test.ts:837` → `expect(MODELOS_DE_TENANT.size).toBe(13);`, no caso `` "`WhatsappConnection` é modelo de tenant, e a lista tem exatamente 13" ``, verde no arquivo de 68 asserções (✅5) |
| 16 | **Nenhuma exceção nova de guarda**, e a prova é o diff vazio | `git diff --stat 60607fa..HEAD -- eslint.config.mjs tests/unit/catraca-prisma-cru.test.ts tests/unit/migracoes-seguras.test.ts` → **saída vazia**. Os três arquivos que poderiam conceder exceção estão byte a byte iguais aos de antes do ciclo |
| 17 | A trava de deriva das quatro compostas **morde**, provado por mutação **nas duas direções** | Task 5, `.superpowers/sdd/task-1e-5e6-report.md`: (a) apagar a composta de `Contact` → `expected [ 'Contact' ] to deeply equal []`; (b) **repor a global SEM tirar a composta** → o mesmo vermelho. A metade (b) é a que impede a "correção" errada, porque acrescentar a composta sem tirar a global passaria em qualquer teste que só afirmasse a existência da composta |
| 18 | A recusa de `findUnique` em modelo de tenant **não foi reaberta** pelas chaves compostas | `tests/unit/escopo-empresa.test.ts:896`, "uma `@@unique` que CONTÉM companyId não reabre `findUnique` em modelo de tenant" — exercita os 4 modelos em 4 operações (`findUnique`, `update`, `upsert`, `delete`), cada uma com o `where` composto que o tipo **hoje aceita** (`companyId_telefone` e as outras três estão em `node_modules/.prisma/client/index.d.ts`), e afirma `toBeInstanceOf(EscopoDeEmpresaError)` **e** a mensagem contendo o `companyId` do escopo. Sem argumento nenhum de `toThrow` nu |
| 19 | A prosa de `escopo.ts` deixou de ser enganosa | `src/core/tenancy/escopo.ts`, parágrafo novo no commit `d60e5ec`: a frase antiga ("em 11 dos 13 modelos `companyId` não é único, logo não existe onde pendurar o filtro") continua literalmente verdadeira sobre `companyId` **sozinho**, e o parágrafo diz por que a recusa continua mesmo agora que existe onde pendurar — o `companyId` de um `where` composto vem de **quem chama**, então seria escopável pelo TIPO e não pela EMPRESA. Mesmo raciocínio que a Task 7 do Ciclo 2a fixou para `webhookTokenHash` |
| 20 | O arquivo de prova **discrimina nas QUATRO constraints** | §2 inteira. Três das quatro reversões produzem vermelho dentro de código de **produção** (`dedupe.ts:215`, `ingest.ts:146`, `ingest.ts:157`); a quarta, dentro da fixture. Os quatro índices repostos e a reposição provada uma a uma |
| 21 | Todo oráculo do arquivo de prova é lido com o Prisma **CRU**, fora do escopo | `tests/unit/unicidades-por-empresa.test.ts` — nunca uma segunda chamada à função sob teste. É a lição de `63cecd2`, e é o que faz o teste medir o **banco** e não a função |
| 22 | A suíte e2e **não regrediu** | `npm run test:e2e` (3 workers, o padrão) → `1 failed · 52 passed (1.4m)`. Exatamente o mesmo placar da auditoria do Ciclo 2a |
| 23 | E a falha do item 22 é instabilidade conhecida, não regressão — **medido, não suposto** | `npx playwright test tests/e2e/sessao-e-cache.spec.ts --workers=1` → **`5 passed (31.6s)`**, com o `:37` verde em **3.6s**. O arquivo inteiro passa isolado; ele falha quando divide banco com os outros specs. Confirma ⚠️ N3 do Ciclo 1c e **descarta regressão deste ciclo**. O ciclo não tocou esse spec (`git diff --stat 60607fa..HEAD` não o lista) |
| 24 | Nenhum resíduo de fixture no banco, e as contagens batem com a linha de base do spec | Sonda final abaixo. `Company 1 · Contact 4 · PipelineStage 4 · Lead 4 · Conversation 0 · WhatsappMessage 0 · WhatsappConnection 0` — idêntico à §2 do spec. Zero linhas com prefixo `uni-emp`, zero com `telefone = '11955550001'`, zero com `ordem IN (9901, 9902)` |

---

## Sonda final ao banco

Executada **depois** das três reversões e reposições de índice, dos 20 arquivos de vitest, da suíte
Playwright inteira e da execução isolada de `sessao-e-cache.spec.ts`. Contra o Postgres real do
projeto `uzumzfxjcxrbxaucvfsr` pelo `DIRECT_URL`.

```
Company: 1 | Contact: 4 | PipelineStage: 4 | Lead: 4
Conversation: 0 | WhatsappMessage: 0 | WhatsappConnection: 0
User: 6 | Membership: 6 | Notification: 14 | AuditLog: 83 | Task: 0

-- Company --
│ 'company-migracao-1a' │ 'n8necrm' │

-- User + vinculos --
│ 'admin@exemplo.com'              │ ativo: true  │ 1 │
│ 'e2e-admin@teste.invalid'        │ ativo: true  │ 1 │
│ 'e2e-vendedor@teste.invalid'     │ ativo: true  │ 1 │
│ 'gestor-teste-task6@exemplo.com' │ ativo: false │ 1 │
│ 'vendedor@exemplo.com'           │ ativo: true  │ 1 │
│ 'whatsapp-bot@sistema.invalid'   │ ativo: false │ 1 │

-- orfas de fixture (uni-emp% / teste-% / %e2e% / telefone 11955550001 / ordem 9901-9902) --
(nenhuma linha, em nenhuma das seis tabelas consultadas)

usuarios sem vinculo (qualquer origem): 0
politicas em public: 0
```

Leitura, item a item:

- **`Company 1 · Contact 4 · PipelineStage 4 · Lead 4 · Conversation 0 · WhatsappMessage 0`** — bate
  **exatamente** com a linha de base medida na §2 do spec, antes de o ciclo começar. Nenhuma linha
  criada, nenhuma apagada. Isto é o que fecha o Step 6 do briefing: contagem diferente significaria
  resíduo de teste não limpo, que é ⚠️ R1 se manifestando.
- **Zero órfãs de fixture.** Os filtros não foram só por prefixo: também por
  `telefone = '11955550001'` (a família que `unicidades-por-empresa.test.ts` reserva) e por
  `ordem IN (9901, 9902)` (a faixa que ele usa). O `limparTudo()` daquele arquivo faz o que promete.
- **`0` usuários sem `Membership` em toda a base.** Este projeto já teve 11 órfãos; o bug latente que
  `e67e1e6` fechou continua fechado.
- **`User: 6`**, os mesmos seis da auditoria do Ciclo 2a, todos com **1** vínculo.
  `e2e-revogacao-cache@teste.invalid` (⚠️ N2 do Ciclo 1c) **não reapareceu**, mesmo com
  `sessao-e-cache.spec.ts` tendo rodado duas vezes aqui. `gestor-teste-task6@exemplo.com` é resíduo
  declarado de uma tarefa do Ciclo 1c, inativo e com vínculo — deixado onde está, porque apagar dado
  de outra tarefa sem pedir é o oposto do que a regra de resíduo quer.
- **`AuditLog: 83`, contra 71 na auditoria do Ciclo 2a.** As 12 novas são rastro da suíte e2e desta
  sessão. Bem abaixo de qualquer janela de rajada (`LIMITE_ALERTA = 10` em 5 minutos por ação
  sensível). `Notification: 14` na mesma origem.
- **`politicas em public: 0`.** Este ciclo **não tocou RLS**, e a medição confirma: o schema continua
  em default-deny inteiro. `DROP INDEX` e `CREATE UNIQUE INDEX` não alteram
  `pg_class.relrowsecurity` nem `information_schema.role_table_grants`, que é o que
  `tests/e2e/banco-blindado.spec.ts` varre — e esse spec passou dentro dos 52 verdes de ✅22. A
  exceção NOMEADA do Realtime continua sendo assunto do Ciclo 3.
- **`WhatsappConnection: 0`.** Nenhuma conexão real cadastrada, o que mantém 🔍 NV2 e NV4 abertos por
  falta de instância Evolution viva — e mantém ⚠️ D3-a inofensivo **hoje**.

---

## ⚠️ Riscos e dívidas

### Medidos nesta auditoria (novos)

- **A1 — `rejects.toThrow()` sem argumento sobrevive em 17 lugares de `tests/unit/`, cinco deles
  guardando recusa entre empresas** (§7). Os cinco de `lead-isolamento.test.ts` têm segunda metade
  que mede efeito, então não estão nus; o que falta é a **razão** do `throw`. Um `moverEtapa` que
  passasse a lançar por outro motivo manteria os cinco verdes com a recusa por empresa desfeita.
  Conserto: afirmar `EscopoDeEmpresaError` ou a mensagem, como o ciclo fez nos dois casos que tocou.
- **A2 — reverter `PipelineStage_companyId_ordem_key` derruba a FIXTURE, e os seis casos morrem
  juntos** (§2.1). O arquivo discrimina, mas o sinal é grosso: seis vermelhos não dizem qual das
  quatro constraints foi mexida. As outras três produzem **um** vermelho, no caminho de produção.
- **A3 — as duas metades de cada par respondem a perguntas diferentes, e isso não estava escrito**
  (§2.3). Só a metade de **coexistência** fica vermelha quando a constraint volta a ser global; a
  "segunda metade" fica verde, porque uma constraint global também deduplica dentro da empresa. As
  duas continuam necessárias e nenhuma cobre o buraco da outra — mas um leitor podia razoavelmente
  achar que eram duas provas da mesma coisa. Conserto: uma linha de comentário em cada par dizendo
  qual morde em qual mutação.

### Declaradas pelo próprio spec do Ciclo 1e (§11), todas de pé

- **D3-a — a resposta sai pela conexão que ABRIU a conversa**, não pela que recebeu a última
  mensagem (§5). Só morde com duas conexões ativas na mesma empresa; hoje há **zero** conexões.
  Conserto nomeado em §4.3.4 do spec: atualizar `connectionId` a cada mensagem de entrada. Decisão
  de roteamento, do dono. **Declarado no `prisma/schema.prisma:536-544`, não escondido.**
- **D2-a — `prisma/seed.ts:139` conta `PipelineStage` sem empresa.** Um seed de segunda empresa
  pularia a criação do funil dela, porque a contagem global já traria as 4 etapas da primeira.
  Inofensivo enquanto o seed criar uma empresa só. **Não escopado por decisão do spec**, e agora com
  o comentário que diz isso e nomeia o gatilho de reabertura, em vez de parecer esquecimento.
- **D5 — os quatro `@@index([companyId])` ficaram redundantes** com o prefixo dos índices novos: um
  btree `("companyId", X)` serve `WHERE "companyId" = $1` igual a um btree `("companyId")`. Não
  derrubados de propósito: derrubar índice é mudança de desempenho, desempenho aqui não está medido
  (4 e 0 linhas), e o de `WhatsappMessage` carrega um bloco de comentário inteiro que precisaria ser
  reescrito junto. Gatilho de reabertura em §5 do spec: `pg_stat_user_indexes` com `idx_scan = 0` no
  índice de coluna única, depois de tráfego real.

### Medidas pelas tarefas do ciclo, registradas e não fechadas

- **N1 — o oráculo dos casos de `P2002` depende da string da mensagem do Prisma conter `companyId`**
  (§6). Acoplamento ao formato de mensagem de uma biblioteca; `meta.target` não é alternativa estável
  no adapter `pg`. Vale para `whatsapp-isolamento.test.ts:725` e `:827`, não para o arquivo de prova
  da Task 6, que mede efeito.
- **N2 — `WAID_COMPARTILHADO` não é numérico**, então `normalizarTelefoneWhatsapp` devolve
  `{ ok: false }` e `Conversation.telefone` fica `null` nas duas empresas do arquivo de prova. É
  deliberado (a chave é sobre a STRING, e o prefixo próprio evita colisão com resíduo da família
  "11966" de `whatsapp-isolamento.test.ts`), mas **aquele arquivo não exercita a normalização**. Quem
  quiser cobri-la precisa de um caso à parte.

### Herdadas, nenhuma tocada aqui — e uma **FECHADA**

- **⚠️ R2 do Ciclo 1a — "as quatro unicidades globais" — está FECHADA por este ciclo.** A condição que
  o spec §11 pôs ("se e somente se o teste da §8 estiver verde") está satisfeita, e mais do que ela:
  o teste está verde **e** provado discriminante nas quatro constraints (§2), o que a redação
  original nem exigia. Era a dívida que a auditoria do Ciclo 2a registrou como tendo **piorado em
  alcance** quando `EVOLUTION_COMPANY_ID` morreu e a segunda empresa deixou de ser inalcançável.
- **R1 — o banco de teste não é separado do de desenvolvimento.** Causa raiz do 🔍 NV6, da regra de
  nunca rodar `vitest` em paralelo, e da janela de risco das três reversões de índice desta auditoria
  (§9.1). Bloqueio duro desde o Ciclo 0.
- **R3 — os pontos cegos do escopo.** `User` tem dez relações inversas; cada uma é uma porta por onde
  um `include` aninhado através de `User` sai do tenant. **Não mexido por este ciclo, e não piorado:**
  o ciclo não acrescentou relação nenhuma a `User`.
- **R4 — `User.papel`** continua como espelho depreciado de `Membership.papel`.
- **R6 — `companyIdDoUsuario`** continua.
- **Herdada do Ciclo 2a — `Conversation.connectionId` nulo, sem backfill.** Este ciclo **depende dela
  continuar**: é justamente porque `connectionId` é anulável que a chave `[connectionId, waId]` não
  seria uma chave (§5). Zero linhas afetadas neste banco (`Conversation: 0`).

> **Não vale mais desde 2026-08-21:** a coluna saiu no Ciclo 1f.

---

## ❌ Herdado de infraestrutura, não corrigido aqui

Nenhum introduzido por este ciclo, nenhum corrigido por ele. Continuam abertos, com detalhe e origem
em `docs/auditorias/2026-08-19-ciclo-4-fluxos.md`,
`docs/auditorias/2026-08-19-ciclo-1a-tenancy.md` e
`docs/auditorias/2026-08-20-ciclo-2a-cofre-credenciais.md`:

1. **A chave global da Evolution é `nateksoft`** — cria, apaga e lê qualquer instância.
2. **`N8N_ENCRYPTION_KEY=nateksoft`** — cifra todas as credenciais do n8n, adivinhável a partir do
   nome da empresa.
3. **Senha reusada** — `DB_POSTGRESDB_PASSWORD` do n8n é a mesma senha do projeto Supabase do CRM, e
   é o **mesmo Postgres** cujas quatro constraints este ciclo acabou de trocar.
4. **O JWT da API do n8n não expira** (sem claim `exp`).
5. **As ações destrutivas de fluxo e de conexão não têm teto de taxa** — o que existe é detecção de
   rajada **depois do fato**.

---

## 🔍 Não verificados

Os cinco itens da §13 do spec, cada um com o estado ao fim desta auditoria, mais um herdado e um
novo.

| # | Item | Estado | O que fecha |
|---|---|---|---|
| NV1 | Que `prisma migrate dev` não acusa deriva depois das quatro migrações escritas à mão | **continua aberto** — exige shadow database, que este ambiente não provisiona. O que **está** medido é `npx prisma migrate status` → `23 migrations found` · `Database schema is up to date!` (✅7), que é **pergunta diferente**: `status` compara o histórico aplicado, não o SQL que o Prisma geraria a partir do schema | `npx prisma migrate dev --create-only` num branch descartável, e conferir que o SQL gerado sai **vazio** |
| NV2 | Que `idExterno` da Evolution não se repete entre contas diferentes | **continua aberto** — não há duas instâncias Evolution acessíveis, e o banco tem `WhatsappConnection: 0`. O argumento do spec §4.4 é sobre o **contrato** da Evolution, não medição. **E ele agora importa menos:** com a chave composta, repetição entre contas deixou de ser colisão | Cadastrar duas conexões em instâncias distintas e comparar `data.key.id` de mensagens recebidas |
| NV3 | Que `btree ("companyId","ordem")` serve as consultas do funil melhor que `btree (ordem)` | **continua aberto** — `PipelineStage` tem **4 linhas** (sonda final). Qualquer `EXPLAIN` neste volume dá `Seq Scan`, e a §4.2.3 do spec é dedução sobre o desenho do btree, escrita como dedução | `EXPLAIN ANALYZE SELECT * FROM "PipelineStage" WHERE "companyId"=$1 ORDER BY "ordem";` com alguns milhares de linhas |
| NV4 | Que o laço de reentrega da Evolution de fato para depois da mudança | **continua aberto** — exige instância viva e duas empresas com conexão. O que esta auditoria **prova** é o degrau anterior: com a constraint global, `ingerirMensagem` levanta `P2002` em `ingest.ts:146` (§2.2), e com a composta a linha entra. O comportamento da Evolution diante do 200 é do lado dela | Duas conexões reais, mesmo número escrevendo para as duas, conferir 200 no log da Vercel e a reentrega cessando |
| NV5 | Que os quatro `@@index([companyId])` são de fato redundantes na prática | **continua aberto** — `idx_scan` é zero em tudo neste volume | `SELECT relname, indexrelname, idx_scan FROM pg_stat_user_indexes WHERE relname IN ('Contact','PipelineStage','Conversation','WhatsappMessage');` depois de tráfego real |
| NV6 | Estado da senha de `admin@exemplo.com` e `vendedor@exemplo.com` no banco de desenvolvimento | **aberto, herdado do Ciclo 2a, e NÃO piorado aqui.** Esta auditoria **não rodou `npm test`** e portanto **não regravou** os `senhaHash` das duas contas. O `global-setup` do e2e alcança só `e2e-admin@teste.invalid` e `e2e-vendedor@teste.invalid` (`tests/e2e/global-setup.ts:52-60`). A pendência continua sendo a da execução do Ciclo 2a | `SEED_PASSWORD=<valor forte gerado> npx prisma db seed`, e depois `bcrypt.compare` provando que os literais versionados não autenticam mais |
| NV7 | Que a suíte unitária **inteira** continua verde nesta árvore | **aberto, e é lacuna desta auditoria** (§9.3). Rodaram **20 dos 132** arquivos (18 focados + 2 de guarda), 359 asserções; **112 não foram executados**. O que os cobre indiretamente é `tsc --noEmit` verde — que pega o gênero de quebra desta mudança, porque um `where` com chave antiga **não compila** — mais os 52 casos e2e verdes. Não é o mesmo que ter rodado | `npm test`, sozinho e em série — **e ele regrava as duas senhas do seed**, então rodar isto e rotacionar a senha são a mesma tarefa |

---

## Só um humano pode fazer

1. **Aprovar ou recusar este relatório antes de qualquer merge ou PR.** O `AGENTS.md` exige a Fase 1
   da auditoria de segurança sobre a superfície que a branch mexeu, entregue e **parada** até o dono
   aprovar. **Nenhum PR foi aberto e nenhum push foi feito.** É por isso que ⚠️ A1, A2 e A3 estão
   descritos com o conserto sugerido e **não aplicados**.
2. **Rotacionar as senhas de `admin@exemplo.com` e `vendedor@exemplo.com`** (🔍 NV6). Esta auditoria
   **não** as regravou, mas a execução do Ciclo 2a regravou e nada as rotacionou desde então. Fica
   como a pendência operacional herdada — e ela vira bloqueio no dia em que alguém precisar rodar
   `npm test` para fechar 🔍 NV7.
3. **Decidir ⚠️ D3-a** — se a resposta deve sair pela conexão que abriu a conversa ou pela que
   recebeu a última mensagem (§5). Enquanto a base tiver zero ou uma conexão por empresa, é teoria.
   O conserto está nomeado e é pequeno; a decisão é de produto.
4. **Decidir ⚠️ D2-a** — escopar ou não `prisma/seed.ts:139`. Barato agora, e o gatilho é o dia em
   que o seed precisar criar a segunda empresa.
5. **Decidir R1** — banco de teste separado do de desenvolvimento. É a causa raiz de 🔍 NV6, da regra
   de nunca rodar `vitest` em paralelo, e da janela de risco das três reversões de índice desta
   auditoria (§9.1). Registrado como bloqueio duro desde o Ciclo 0, e é o item que mais barato sairia
   se fosse resolvido antes de a base ter dado de produção.
6. **Trocar a chave global da Evolution e a `N8N_ENCRYPTION_KEY`** (❌ 1 e 2). Fora do alcance de
   qualquer ciclo de código.
