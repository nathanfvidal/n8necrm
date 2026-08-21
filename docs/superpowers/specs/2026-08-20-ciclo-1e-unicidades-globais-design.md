# Ciclo 1e — As quatro unicidades globais

**Data:** 2026-08-20
**Branch de origem:** `ciclo-1a-tenancy`, HEAD `60607fa`, árvore limpa
**Antecessores diretos:** Ciclo 1a (tenancy), 1c (config no banco), 1d (escopo em
`pipeline/`), 2a (cofre de credenciais e conexões)
**Auditoria que motivou:** `docs/auditorias/2026-08-20-ciclo-2a-cofre-credenciais.md`,
§6 e ⚠️ R2

---

## 1. O que este ciclo entrega

Quatro `@unique` GLOBAIS viram `@@unique` COMPOSTAS com `companyId`:

| Modelo | Hoje | Depois |
| --- | --- | --- |
| `Contact` | `telefone String @unique` | `@@unique([companyId, telefone])` |
| `PipelineStage` | `@@unique([ordem])` | `@@unique([companyId, ordem])` |
| `Conversation` | `waId String @unique` | `@@unique([companyId, waId])` |
| `WhatsappMessage` | `idExterno String @unique` | `@@unique([companyId, idExterno])` |

Não entrega nada de UI, nenhuma política de RLS, nenhum grant, nenhuma coluna
nova. Entrega quatro trocas de índice único, os ajustes de chamador que elas
exigem, e **a prova de que duas empresas coexistem** com o mesmo telefone, a
mesma ordem de etapa, o mesmo `waId` e o mesmo `idExterno`, cada uma vendo só o
seu.

Sem esse último item a mudança é só schema — ver §8.

---

## 2. O que foi medido antes de desenhar

Medido em 2026-08-20 contra o Postgres 17.6 do projeto `uzumzfxjcxrbxaucvfsr`,
não estimado.

**Volume das tabelas envolvidas:**

```sql
SELECT 'Company' t, count(*) n FROM "Company"
UNION ALL SELECT 'Contact', count(*) FROM "Contact"
UNION ALL SELECT 'Conversation', count(*) FROM "Conversation"
UNION ALL SELECT 'Conversation_connectionId_nulo', count(*) FROM "Conversation" WHERE "connectionId" IS NULL
UNION ALL SELECT 'WhatsappMessage', count(*) FROM "WhatsappMessage"
UNION ALL SELECT 'PipelineStage', count(*) FROM "PipelineStage"
UNION ALL SELECT 'Lead', count(*) FROM "Lead"
UNION ALL SELECT 'WhatsappConnection', count(*) FROM "WhatsappConnection";
```

| Tabela | Linhas |
| --- | --- |
| `Company` | **1** |
| `Contact` | **4** |
| `Conversation` | **0** (e 0 com `connectionId` nulo, porque não há linha nenhuma) |
| `WhatsappMessage` | **0** |
| `PipelineStage` | **4** |
| `Lead` | **4** |
| `WhatsappConnection` | **0** |

**Os quatro índices que serão trocados, com o nome exato que o Postgres tem
hoje:**

```sql
SELECT c.relname AS tabela, i.relname AS indice, pg_get_indexdef(x.indexrelid) AS def
FROM pg_index x
JOIN pg_class c ON c.oid = x.indrelid
JOIN pg_class i ON i.oid = x.indexrelid
WHERE x.indisunique AND c.relname IN ('Contact','PipelineStage','Conversation','WhatsappMessage')
ORDER BY c.relname, i.relname;
```

- `Contact_telefone_key` → `btree (telefone)`
- `PipelineStage_ordem_key` → `btree (ordem)`
- `Conversation_waId_key` → `btree ("waId")`
- `WhatsappMessage_idExterno_key` → `btree ("idExterno")`

**Por que a medição importa para o desenho, e não é enfeite:**

1. Com uma empresa só, **nenhuma das quatro tabelas pode conter duplicata sob a
   chave nova**: a chave antiga já proibia o valor repetido, e a chave nova é a
   antiga mais uma coluna constante. Logo, os quatro `CREATE UNIQUE INDEX` não
   podem falhar por dado existente. Isto é dedução a partir do volume medido, e
   o plano ainda assim confere com um `SELECT ... GROUP BY ... HAVING count(*) > 1`
   antes de cada criação — porque "não pode falhar" é exatamente a frase que
   antecede as falhas.
2. Com `Conversation` e `WhatsappMessage` **vazias**, não existe decisão de
   deduplicação a tomar. Depois de existir dado real, a mesma mudança vira
   migração com fusão de histórico de conversa — trabalho de outra ordem de
   grandeza. É por isso que este ciclo é agora.
3. Com 4 e 4 linhas nas duas tabelas não vazias, `DROP INDEX` + `CREATE UNIQUE
   INDEX` sem `CONCURRENTLY` é instantâneo e o bloqueio é irrelevante.

---

## 3. O problema que este ciclo existe para resolver

As quatro estão registradas como ⚠️ R2 desde o Ciclo 1a. Até esta semana eram
teóricas — "bloqueiam a segunda empresa". **Duas deixaram de ser.**

### 3.1 `Conversation.waId`: o 500 em laço

Até o Ciclo 2a, `EVOLUTION_COMPANY_ID` era uma constante do DEPLOY: uma
instância da Evolution por deploy, uma empresa por instância. A segunda empresa
era inalcançável e o defeito era teoria.

O Ciclo 2a matou a variável. O webhook passou a resolver a empresa pela
CONEXÃO (`src/modules/whatsapp/ingest.ts`, `ContextoDeIngestao`). Agora duas
empresas podem ter conexões, e o mesmo número atendido pelas duas produz:

```
ingest.ts:124   findFirst({ where: { waId } })   -- ESCOPADO: não acha a conversa da outra empresa
ingest.ts:141   create({ ... waId })             -- colide em Conversation_waId_key
                → P2002 → o catch busca por idExterno → não acha (a mensagem
                  não chegou a ser gravada) → o erro sobe → a rota devolve 500
                → a Evolution reentrega → tudo de novo, para sempre
```

O `catch` de `ingest.ts:190-213` documenta "o retry acerta, porque na segunda vez
o `findFirst` encontra a conversa". Isso é verdade para a corrida **dentro da
mesma empresa** e falso entre empresas: o `findFirst` é escopado e nunca
encontrará a conversa da outra. O laço não tem saída por si — é a §6 da
auditoria do Ciclo 2a, escrita como "o que ficou PIOR por consequência".

### 3.2 `Contact.telefone`: já cobrou preço real

`tests/e2e/seguranca-headers.spec.ts` quebrou em paralelo. O `test.beforeAll` do
Playwright roda **uma vez por worker**, `playwright.config.ts` tem
`fullyParallel: true` com `workers: 3`, e o telefone da fixture era literal:

```
Invalid `prisma.contact.create()` invocation
Unique constraint failed on the fields: (`telefone`)
```

Não era teste instável: `--workers=1` dava verde sempre, execução focada dava
vermelho sempre. O contorno em vigor (telefone montado com
`E2E_ID_EXECUCAO` + `TEST_PARALLEL_INDEX`) **continua necessário depois deste
ciclo** — ver §7.3, porque a razão dele é outra e o comentário dele hoje culpa a
razão errada.

### 3.3 As outras duas continuam teóricas — e é por isso que entram junto

`PipelineStage.ordem` e `WhatsappMessage.idExterno` não têm sintoma hoje. Entram
neste ciclo porque:

- são a mesma classe de defeito, com a mesma correção e o mesmo custo (uma troca
  de índice numa tabela de 4 ou 0 linhas);
- deixar duas de quatro resolvidas produz um estado que ninguém consegue
  descrever em uma frase ("multi-empresa funciona, menos para o funil e menos
  para a idempotência de mensagem");
- `PipelineStage.ordem` **já tem um defeito vivo hoje**, com uma empresa só, que
  ninguém percebeu porque exige a segunda para se manifestar — ver §4.2.4.

---

## 4. As quatro decisões, com o motivo

### 4.1 D1 — `Contact.telefone` → `@@unique([companyId, telefone])`

**Decisão: composta com `companyId`.** Não com nada mais.

**Por quê.** `Contact` é a agenda de UMA empresa. O telefone identifica a pessoa
dentro daquela agenda, e duas empresas atenderem o mesmo cliente é o caso
normal de um CRM multi-empresa, não uma anomalia. Não há nível intermediário
plausível: contato não pertence a conexão, nem a funil, nem a usuário — o
`Contact` tem exatamente uma coluna de posse, e é `companyId`.

**O que muda em `src/core/leads/dedupe.ts`.** Hoje ele tem um ramo inteiro para
a colisão global:

```
throw new Error(
  `Telefone já cadastrado em outra empresa: "${telefone}" existe como Contact fora do ` +
  `escopo ${JSON.stringify(dados.companyId)}. ...`
);
```

Esse ramo **deixa de ser alcançável**, e a razão é mecânica: depois da mudança,
o único `P2002` que `contact.create` pode produzir vem de
`Contact_companyId_telefone_key`, cujas duas colunas são exatamente as do
`findFirst` escopado logo acima (o escopo injeta `where.companyId`). Se o banco
diz "já existe", a busca escopada encontra.

O ramo **não é apagado, é reescrito**. Continua como defesa, porque existe uma
janela estreita e real: o vencedor da corrida pode apagar o contato entre a
colisão e a releitura. Apagar o `throw` transformaria essa janela num
`undefined` silencioso descendo para a criação de lead. A mensagem nova diz o
que de fato aconteceu, e não mais "existe em outra empresa" — que passaria a ser
mentira.

O tratamento de corrida (`P2002` → releitura → devolve o contato do concorrente)
**não muda em nada**, e `tests/unit/dedupe.test.ts` já o exercita com
`Promise.all` de 10 chamadas. Esse caso continua verde sem edição.

**O que muda em `src/core/contacts/service.ts`.** `erroDeTelefoneOcupado` tem
dois ramos:

- `dono` encontrado → "Este telefone já está cadastrado para {nome}."
- `dono` não encontrado → "Este telefone já está cadastrado fora desta empresa e
  não pode ser reaproveitado aqui."

O segundo ramo fica inalcançável pelo mesmo mecanismo, e pela mesma razão é
**reescrito e não removido**. Os dois casos de teste que hoje o afirmam
(`tests/unit/contact-isolamento.test.ts`, "telefone ocupado por contato de OUTRA
empresa não revela o nome do dono" e "trocar o telefone para um de OUTRA empresa
não revela o nome do dono") passam a afirmar o **oposto útil**: o telefone da
outra empresa deixa de ser recusado — o cadastro é criado — e o nome do dono de
fora continua não aparecendo em lugar nenhum. A segunda metade da afirmação é a
que importa e sobrevive: nenhuma das duas mudanças reabre o oráculo de "quem é o
cliente do concorrente neste número", porque a busca continua escopada.

**O que muda nos seeds.** `prisma/seed.ts:214` usa `Contact.telefone` como chave
única literal:

```ts
await prisma.contact.upsert({ where: { telefone: `1199999000${i}` }, ... })
```

Isso deixa de compilar: `ContactWhereUniqueInput` não aceita mais `telefone`
sozinho. Vira `where: { companyId_telefone: { companyId: empresa.id, telefone } }`.
`prisma/seed-demo.ts:214` (`findUnique({ where: { telefone } })`) tem o mesmo
destino. Os dois arquivos usam o `prisma` cru **legitimamente** — a catraca
`tests/unit/catraca-prisma-cru.test.ts` cobre só `src/` e diz isso por escrito na
linha 71.

### 4.2 D2 — `PipelineStage.@@unique([ordem])` → `@@unique([companyId, ordem])`

**Decisão: composta com `companyId`.**

O comentário do schema (linhas 247-253) diz textualmente o que travava a
mudança:

> `@@unique([ordem])` continua GLOBAL […] de propósito NESTA tarefa: virar
> composta exigiria auditar cada consulta que hoje confia em `ordem` ser única
> sozinha (`core/pipeline/service.ts`)

**Essa auditoria é o §4.2.1 abaixo, e ela ficou barata pelo motivo que o Ciclo 1d
produziu:** `pipeline/` inteiro foi convertido para `prismaDaEmpresa`, então
toda consulta de `PipelineStage` em `src/` já carrega `companyId`. Confirmado
por varredura, não presumido:

```bash
grep -rn "ordem" --include=*.ts --include=*.tsx src/ prisma/
```

#### 4.2.1 A auditoria: toda consulta que toca `ordem`

Nove ocorrências de código (o `grep` acima também devolve prosa e nomes de
variável de UI, que não contam). As nove, uma a uma:

| # | Consulta | Arquivo:linha | Escopada hoje? | O que muda |
| --- | --- | --- | --- | --- |
| 1 | `pipelineStage.findMany({ orderBy: { ordem: "asc" } })` | `src/core/pipeline/stages.ts:29` (`listarEtapas`) | **sim** (Ciclo 1a) | **nada.** Serve 4 telas; o `where.companyId` já é injetado. A ordenação passa a ser dentro da empresa por construção, e não por acidente da unicidade global |
| 2 | `pipelineStage.findMany({ orderBy: { ordem: "asc" } })` | `src/core/leads/queries.ts:91` (`listarLeadsPorEtapa`) | **sim** | **nada** |
| 3 | `pipelineStage.findFirstOrThrow({ orderBy: { ordem: "asc" } })` | `src/core/leads/service.ts:108` (`primeiraEtapaDoFunil`) | **sim** (Ciclo 1a) | **nada no código.** Mas o comentário acima dela diz "Hoje isso é inofensivo por acidente — `PipelineStage` ainda tem `@@unique([ordem])` GLOBAL" e "no dia em que virar `[companyId, ordem]`…". Esse dia é hoje: o comentário é reescrito, senão passa a mentir sobre o estado do schema |
| 4 | `pipelineStage.aggregate({ _max: { ordem: true } })` | `src/core/pipeline/service.ts:195` (`criarEtapa`) | **sim** (Ciclo 1d) | **corrige um defeito vivo — ver §4.2.4** |
| 5 | `findFirst` da vizinha, `where: { ordem: { lt/gt } }` | `src/core/pipeline/service.ts:310` (`moverNaOrdem`) | **sim** (Ciclo 1d) | **nada.** O caso "a última etapa da A não troca de lugar com a primeira da B" já está travado em `tests/unit/pipeline-isolamento.test.ts` |
| 6 | os três `updateMany` da troca, com `ORDEM_ESTACIONAMENTO = -1` | `src/core/pipeline/service.ts:337-345` | **sim** | **o estacionamento continua necessário**, e o próprio comentário dele já previu isto: "a colisão que ele evita é entre duas etapas da MESMA empresa". O que muda é que `-1` deixa de ser um ponto de colisão ENTRE empresas: hoje, duas empresas reordenando ao mesmo tempo colidem em `PipelineStage_ordem_key` no valor `-1` |
| 7 | `pipelineStage.count()` sem `where` | `prisma/seed.ts:139` | não (prisma cru, legítimo) | **nada hoje**, e é dívida registrada e não corrigida aqui: o seed cria/encontra **uma** empresa (`empresaExistente ?? create`), então "existe etapa no banco?" e "existe etapa desta empresa?" são a mesma pergunta. No dia em que o seed semear uma segunda empresa, ele pulará o funil dela. Fora do escopo deste ciclo — ⚠️ D2-a |
| 8 | `pipelineStage.findFirstOrThrow({ orderBy: { ordem: "asc" } })` sem `where` | `prisma/seed.ts:209` | não | **muda.** Ganha `where: { companyId: empresa.id }`. Hoje devolve a etapa de menor `ordem` do banco inteiro; com a unicidade composta e duas empresas, pode devolver a etapa de outra empresa e pendurar os 4 leads de demonstração nela |
| 9 | `pipelineStage.findMany({ orderBy: { ordem: "asc" } })` sem `where` | `prisma/seed-demo.ts:285` | não | **muda.** Ganha `where: { companyId: empresa.id }`. Mesmo raciocínio do #8; aqui o efeito seria pior, porque o arquivo checa `etapas.length !== 5` e lançaria com uma mensagem que culpa a tela `/etapas` |

**O que NÃO está na lista, e por que não está:** `excluirEtapa` não renumera
`ordem` (confirmado — as únicas escritas em `ordem` do arquivo são as três de
`moverNaOrdem` e a de `criarEtapa`); `definirEtapaDeFechamento` não toca `ordem`;
`contarLeadsQueSeguramEtapa` não toca `ordem`; `pipeline/service.ts:220`, `:355`,
`:356` e `:659` só copiam `ordem` para o payload do `AuditLog`.

#### 4.2.2 A consequência que ninguém pediu, e que é ganho

`ORDEM_ESTACIONAMENTO = -1` existe porque o Postgres verifica índice único a
cada `UPDATE`, não no fim da transação. O comentário registra que a alternativa
idiomática (`DEFERRABLE INITIALLY DEFERRED`) não é usada porque o Prisma não a
representa e ela viraria deriva no próximo `migrate diff`. **Nada disso muda.**
O que muda é que hoje duas empresas reordenando funis diferentes ao mesmo tempo
disputam a posição `-1` global; depois da mudança, cada uma tem a sua.

#### 4.2.3 O índice novo serve as consultas melhor que o antigo

Toda consulta de `PipelineStage` em `src/` tem a forma `WHERE "companyId" = $1
ORDER BY "ordem"`. O índice de hoje é `btree (ordem)` — igualdade em `companyId`
não é servida por ele de forma nenhuma. O índice novo, `btree ("companyId",
"ordem")`, serve igualdade no prefixo e ordenação no sufixo, que é literalmente
a forma da consulta. O schema já registra esse raciocínio de ordem de colunas em
`prisma/schema.prisma:361`.

Isto é dedução a partir do desenho do btree, **não medição** — com 4 linhas
qualquer `EXPLAIN` dá `Seq Scan` e não prova nada. Fica como 🔍 NV3.

#### 4.2.4 O defeito vivo que a composta corrige

`criarEtapa` faz `max(ordem DA EMPRESA) + 1` — corretamente, desde o Ciclo 1d.
Com a unicidade **global**, esse valor pode já estar ocupado por outra empresa:

```
Empresa A: ordem 0,1,2,3      Empresa B: ordem 4,5
A cria etapa nova → max(A)+1 = 4 → colide com a etapa 4 da B → P2002 na tela
```

A mensagem que chegaria à pessoa seria a de constraint violada, apontando para
uma etapa que ela não pode ver. O Ciclo 1d **acertou** ao escopar o `aggregate`
(sem o escopo, a etapa da A nascia depois da última etapa da B, com um buraco do
tamanho do funil alheio no meio) e, ao acertar, tornou este defeito alcançável.
É o mesmo padrão de `Conversation.waId` no Ciclo 2a: o escopo correto revela a
unicidade errada.

Isso não é hipótese sobre o futuro — é o estado de hoje, com o schema de hoje,
esperando a segunda empresa. Está travado no teste da §8, caso 2.

### 4.3 D3 — `Conversation.waId` → `@@unique([companyId, waId])`

**Esta é a decisão de PRODUTO do ciclo, e a mais difícil.** A pergunta não é
"qual chave", é: **uma empresa com dois números recebe o mesmo cliente
escrevendo para os dois. Isso é uma conversa ou duas?**

**Decisão: UMA. `@@unique([companyId, waId])`. `connectionId` fica FORA da
chave.**

#### 4.3.1 O argumento que decide: a conversa carrega ESTADO, não só mensagens

`Conversation` não é um agrupador de mensagens. Ela carrega, hoje:

```
contactId  leadId  iaAtiva  iaPausadaEm  iaPausadaPorId  aguardandoHumanoDesde  bufferSeq  processandoAte
```

Duas conversas para a mesma pessoa significam **duas cópias desse estado**. O
desfecho concreto, visível para o atendente e para o cliente:

> A atendente pausa a IA para assumir o atendimento do João. O João tinha escrito
> antes para o outro número da mesma empresa. O bot continua respondendo o João
> por lá, ao mesmo tempo, na mesma tela do WhatsApp dele.

`iaPausadaPor` e `aguardandoHumanoDesde` existem exatamente para que isso não
aconteça. Uma chave que os duplica desfaz a fatia "conversa aguardando humano"
(`docs/superpowers/specs/2026-08-06-conversa-aguardando-humano-design.md`) sem
que nenhum código dela mude.

#### 4.3.2 O segundo argumento: `connectionId` é ANULÁVEL, e NULL não é NULL

No Postgres, `NULL` é distinto de `NULL` num índice único. Este projeto já tem a
armadilha registrada, no schema, em `@@unique([companyId, canal, instancia])`:

> `instancia` nula não colide, porque o Postgres trata NULL como distinto — que
> é o comportamento desejado para canal sem instância.

Ali é o comportamento desejado. Aqui seria o contrário. `Conversation.connectionId`
é `String?` e nasceu assim no Ciclo 2a, deliberadamente e por dois motivos
escritos: escolher conexão para conversa anterior a existir conexão seria chute
com aparência de dado, e `NOT NULL` numa tabela viva derrubaria toda a ingestão
com `23502` na janela de deploy.

Com `connectionId` dentro da chave e nulo, duas linhas com o mesmo `waId` e
`connectionId IS NULL` **ambas passam**. A chave para de deduplicar exatamente
onde a dedup é necessária.

E há um segundo dano, pior porque é silencioso: `ingest.ts:124` teria de virar
`findFirst({ where: { waId, connectionId } })`. Uma conversa com `connectionId`
nulo nunca casa com um `connectionId` não nulo — então **toda mensagem nova
numa conversa legada criaria uma conversa nova**, órfã do histórico, do
`contactId`, do `leadId` e da pausa da IA.

Neste banco `Conversation` tem **0 linhas** (§2), então não há linha legada
aqui. Mas a coluna continua anulável no schema, e o caminho de reserva que
depende disso — `credencialAtivaUnica` com `ConexaoNaoConfiguradaError` /
`ConexaoAmbiguaError` (`src/core/conexoes/leitura.ts:221`) — foi construído no
Ciclo 2a e está exercitado com duas conexões ativas em
`tests/unit/whatsapp-envio-por-conexao.test.ts`. O desenho tem de sobreviver a
linhas nulas, não a supor que não existem.

#### 4.3.3 A saída que existiria, e por que é recusada

Tornar `connectionId` `NOT NULL` fecharia a armadilha do NULL — e a tabela
vazia tornaria a migração de dados trivial. **Recusado, por dois motivos:**

1. **Custo de escopo.** `NOT NULL` mataria o caminho de reserva inteiro do Ciclo
   2a (as duas saídas nomeadas, os testes com duas conexões ativas, a §7 da
   auditoria) — uma decisão de produto sobre roteamento de resposta, dentro de um
   ciclo que trata de unicidade. Duas decisões grandes num ciclo é como se perde
   a possibilidade de reverter uma sem a outra.
2. **A guarda de migrações.** `ALTER COLUMN "connectionId" SET NOT NULL` sem
   `SET DEFAULT` na mesma migração aciona
   `tests/unit/migracoes-seguras.test.ts`. As restrições deste ciclo dizem: ou o
   desenho muda, ou entra em `PERDOADAS` com justificativa escrita. **O desenho
   muda.** Um `DEFAULT` numa FK para conexão penduraria conversas numa conexão
   arbitrária — pior que a janela que estaria evitando, exatamente o argumento
   que a entrada `20260819140000_restaura_user_papel_temporariamente` já usa
   para `User.papel`. Este ciclo acrescenta **zero** entradas a `PERDOADAS`.

As duas outras saídas técnicas — índice único parcial (`WHERE "connectionId" IS
NOT NULL` mais um segundo índice para o caso nulo) e `UNIQUE NULLS NOT
DISTINCT` (disponível no Postgres 15+, e este é 17.6) — resolveriam o NULL sem
`NOT NULL`. As duas são recusadas pelo mesmo motivo, e o precedente é literal
neste repositório: o comentário de `ORDEM_ESTACIONAMENTO` recusa `DEFERRABLE
INITIALLY DEFERRED` porque "o Prisma não representa e viraria drift no próximo
diff". Índice parcial e `NULLS NOT DISTINCT` estão na mesma categoria.

#### 4.3.4 O que a escolha implica PARA O ATENDENTE

Explicitamente, sem eufemismo:

- **Uma linha por pessoa, por empresa.** A agenda de conversas mostra o João uma
  vez, com o histórico inteiro dele com aquela empresa, independente de por qual
  número ele escreveu. Pausar a IA pausa para o João, não para "o João no número
  do Suporte".
- **A resposta sai por `Conversation.connectionId`** — a conexão que ABRIU a
  conversa, não necessariamente aquela para a qual ele escreveu por último. Se o
  João falou primeiro com o Comercial e depois escreveu para o Suporte, a
  resposta do Suporte sai pelo número do Comercial.

Esse segundo ponto é uma consequência real e não é resolvida aqui. Fica como
**⚠️ D3-a**, com o conserto já nomeado: `ingest.ts` atualizar
`Conversation.connectionId` para a conexão da última mensagem de ENTRADA, do
mesmo jeito que já atualiza `nomeExibicao`. É pequeno e provavelmente certo —
e é decisão de roteamento de resposta, do dono, não de unicidade. Este ciclo o
registra e não o executa.

**Comparação honesta:** a alternativa (`[companyId, connectionId, waId]`)
resolve D3-a de graça, porque cada conversa nasce amarrada à sua conexão. Ela
perde §4.3.1 (o estado duplicado) e §4.3.2 (a armadilha do NULL). A troca é
"cliente respondido pelo número errado" contra "bot e humano respondendo o mesmo
cliente ao mesmo tempo, sem que nenhum dos dois saiba". O segundo é pior, é
invisível para o operador, e o primeiro tem conserto de uma linha.

#### 4.3.5 O que a escolha corrige, imediatamente

O laço de 500 da §3.1 fecha, e fecha porque a afirmação do `catch` passa a ser
verdadeira sem qualificação: o único `P2002` de `Conversation` que resta é a
corrida **dentro da mesma empresa**, e para essa "o retry acerta, porque na
segunda vez o `findFirst` encontra a conversa" é verdade — o `findFirst` é
escopado pela mesma empresa que a chave. O comentário de `ingest.ts:110-123`,
que hoje descreve a dívida, é reescrito para descrever o fechamento dela.

### 4.4 D4 — `WhatsappMessage.idExterno` → `@@unique([companyId, idExterno])`

**Decisão: composta com `companyId`.** Não com `conversationId`.

A função da chave é **deduplicar reentrega**: a Evolution reentrega em caso de
erro, e `idExterno` (`data.key.id` do payload) é o que faz a mesma mensagem,
entregue duas vezes, não virar duas linhas. Frouxa demais, mensagem duplica.
Apertada demais, a dedup para de funcionar. Os dois candidatos:

| Chave | Dedup sobrevive? | O que quebra |
| --- | --- | --- |
| `[companyId, idExterno]` | **sim** | nada identificado — ver abaixo |
| `[conversationId, idExterno]` | tecnicamente sim | **a busca do `catch`** — ver abaixo |

**Por que `companyId` e não `conversationId`, em quatro passos:**

1. **A chave tem de casar com a consulta que a lê.** O `catch` de `P2002` faz
   `db.whatsappMessage.findFirst({ where: { idExterno } })` num cliente
   **escopado por empresa** — ou seja, a consulta real é
   `WHERE "companyId" = $1 AND "idExterno" = $2`. Isso é exatamente
   `[companyId, idExterno]`. Uma chave por `conversationId` permitiria o mesmo
   `idExterno` duas vezes dentro da mesma empresa (em conversas diferentes), e
   então esse `findFirst` devolveria **uma mensagem arbitrária** entre as duas.
   O passo seguinte do `catch` (`conversation.findFirstOrThrow({ where: { id:
   mensagemExistente.conversationId } })`) devolveria a conversa errada, e o job
   de fila processaria o turno da conversa errada. Dedup "funcionando" e
   roteamento quebrado é pior que dedup falhando alto.
2. **A unidade de reentrega é a ENTREGA, e a entrega se resolve em empresa.** O
   webhook resolve empresa e conexão a partir de uma linha de
   `WhatsappConnection` (Ciclo 2a). Uma reentrega chega pela mesma conexão, logo
   pela mesma empresa. `companyId` é o menor escopo que contém, com certeza,
   toda reentrega de uma mensagem — e é isso que uma chave de idempotência
   precisa ser.
3. **`conversationId` não é mais estável que `companyId` para esta mensagem.** A
   conversa de uma mensagem é derivada (`waId` → conversa), a empresa é dada
   (vem da conexão). Amarrar a idempotência ao derivado significa que a dedup
   depende de a derivação ter dado o mesmo resultado nas duas entregas.
4. **`idExterno` não é garantidamente único entre contas da Evolution.**
   `src/modules/whatsapp/gateway/evolution.ts:373` chega a inventar
   `evolution-sem-id-${crypto.randomUUID()}` quando o payload não traz
   `key.id` — e mensagens de SAÍDA gravadas por `agente.ts:300` e
   `turno.ts:401` usam o id que o gateway devolveu. Confiar em unicidade global
   de um id de terceiro é exatamente a suposição que este ciclo existe para
   desfazer. Isto é raciocínio sobre o contrato da Evolution, não medição contra
   a API dela — 🔍 NV2.

**O que muda no código:** nada na lógica. O `catch` continua com os dois ramos
(`idExterno` → `duplicada: true`; `waId` → deixa subir para o retry), a busca
continua a mesma consulta escopada, e as duas escritas de SAÍDA continuam
iguais. O que muda são os comentários que afirmam "`@unique` GLOBAL" — três
deles, em `ingest.ts`, no bloco de doc de `WhatsappMessage` no schema, e em
`tests/unit/whatsapp-isolamento.test.ts:70-71` ("`waId` e `idExterno` são
`@unique` sem empresa").

---

## 5. O que a mudança faz com os índices

Cada troca remove um índice único de uma coluna e cria um de duas, com
`companyId` na frente. Consequência: os quatro modelos passam a ter um índice
cujo **prefixo é `companyId`**, e o `@@index([companyId])` que cada um já tem
vira redundante — um btree `(companyId, X)` serve `WHERE "companyId" = $1`
igual a um btree `(companyId)`.

**Este ciclo NÃO derruba esses quatro índices**, de propósito:

- derrubar índice é mudança de desempenho, e desempenho aqui não está medido
  (4 e 0 linhas — qualquer `EXPLAIN` dá `Seq Scan`);
- o `@@index([companyId])` de `WhatsappMessage` carrega um bloco de comentário
  inteiro explicando por que ele existe separado do índice composto de
  `(conversationId, direcao, processadoEm)`. Derrubá-lo exige reescrever esse
  raciocínio, não só a linha;
- índice redundante custa espaço e escrita, e neste volume os dois são zero.

Fica registrado como **⚠️ D5** com o gatilho para reabrir: quando qualquer uma
das quatro tabelas passar de algumas dezenas de milhares de linhas, medir com
`pg_stat_user_indexes` (`idx_scan = 0` no índice de coluna única é a evidência)
antes de derrubar.

---

## 6. A guarda de migrações NÃO é acionada — e a prova

`tests/unit/migracoes-seguras.test.ts` pega duas formas:

- `ADD COLUMN ... NOT NULL` sem `DEFAULT` em tabela que já existia;
- `ALTER COLUMN ... SET NOT NULL` sem um `SET DEFAULT` na mesma migração.

As quatro migrações deste ciclo contêm **apenas** `DROP INDEX` e `CREATE UNIQUE
INDEX`. Nenhuma coluna nova, nenhuma coluna virando `NOT NULL`, nenhum
`ALTER TABLE ... ADD COLUMN`. Logo o analisador não tem o que reportar.

Isso é dedução sobre o texto do SQL que ainda não existe; o plano transforma em
medição rodando o teste depois de cada migração escrita. **`PERDOADAS` não recebe
nenhuma entrada neste ciclo.** Se alguma tarefa se vir precisando de uma, o
desenho está errado e a tarefa deve parar e reportar.

Nenhuma política de RLS e nenhum `GRANT` neste ciclo. As quatro tabelas já
existem, já estão com RLS ligada e zero políticas, e `DROP INDEX` /
`CREATE UNIQUE INDEX` não tocam `pg_class.relrowsecurity` nem
`information_schema.role_table_grants` — que é o que `tests/e2e/banco-blindado.spec.ts`
varre. Esse e2e não muda.

---

## 7. O que muda fora do schema — inventário fechado

### 7.1 Código de produção (`src/`)

| Arquivo | O que muda | Lógica ou prosa? |
| --- | --- | --- |
| `src/core/leads/dedupe.ts` | o ramo "existe em outra empresa" vira defesa contra corrida-com-exclusão; o bloco de doc que chama a unicidade de "limite conhecido do schema" | prosa + a mensagem do `throw` |
| `src/core/contacts/service.ts` | `erroDeTelefoneOcupado`, segundo ramo; o bloco de doc que explica "os dois ramos" | prosa + a mensagem |
| `src/core/leads/service.ts` | o bloco de doc de `primeiraEtapaDoFunil` ("inofensivo por acidente") | só prosa |
| `src/core/pipeline/service.ts` | o bloco de doc de `ORDEM_ESTACIONAMENTO` | só prosa |
| `src/modules/whatsapp/ingest.ts` | os blocos "`waId` é `@unique` GLOBAL, e isso é pendência de SCHEMA" e o do `catch` | só prosa |
| `src/core/tenancy/escopo.ts` | um parágrafo novo no bloco "Recusa, lançando" — ver §7.4 | só prosa |

**Nenhuma assinatura de função muda. Nenhum import novo. Nenhuma exceção de lint
nova.** A catraca `LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS = 0` continua em
zero e só pode diminuir; este ciclo não a toca.

### 7.2 Seeds (`prisma/`)

| Arquivo:linha | O que muda | Por quê |
| --- | --- | --- |
| `prisma/seed.ts:214` | `where: { telefone }` → `where: { companyId_telefone: { … } }` | deixa de compilar (D1) |
| `prisma/seed.ts:209` | ganha `where: { companyId: empresa.id }` | D2, item 8 |
| `prisma/seed-demo.ts:214` | `findUnique({ where: { telefone } })` → `findFirst({ where: { companyId, telefone } })` | deixa de compilar (D1) |
| `prisma/seed-demo.ts:285` | ganha `where: { companyId: empresa.id }` | D2, item 9 |

### 7.3 O e2e que já pagou o preço — e que NÃO volta atrás

`tests/e2e/seguranca-headers.spec.ts` monta o telefone da fixture com
`E2E_ID_EXECUCAO` + `TEST_PARALLEL_INDEX`. **O contorno continua necessário**, e
é importante dizer por quê, porque o comentário atual dá o motivo errado: ele
culpa a unicidade GLOBAL, mas os três workers do Playwright usam **a mesma
empresa do seed**. `@@unique([companyId, telefone])` não separa worker de
worker; um telefone literal colidiria exatamente igual.

O que muda ali é **só o comentário**, que passa a dizer a verdade: a colisão é
entre workers dentro da mesma empresa, e por isso sobrevive à composição.
Reverter o telefone para literal reabriria a quebra — é uma armadilha ativa, e
o comentário é a única coisa que impede alguém de "limpar" isso no futuro.

### 7.4 O que a composição faz com `prismaDaEmpresa`, e o que NÃO faz

Depois deste ciclo, quatro modelos de tenant ganham uma `@@unique` que **contém**
`companyId`. Isso torna `ContactWhereUniqueInput` (e as três irmãs) capazes de
aceitar a chave composta — e portanto torna `findUnique` **tipável** ali, o que
não era antes.

**O escopo continua recusando `findUnique`, `findUniqueOrThrow`, `update`,
`delete` e `upsert` nos quatro.** A regra não muda, e a razão é a mesma que
`escopo.ts` já dá para `BotConfig` e `CompanyConfig`: "uma regra 'lança em
`findUnique`, menos em N modelos' é regra que ninguém lembra na hora de ler o
código, e `findFirst` resolve o caso com a mesma consulta".

Mas a **prosa** de `escopo.ts` precisa de um parágrafo, porque hoje ela justifica
a recusa dizendo "em 11 dos 13 modelos de tenant `companyId` não é único, então o
Prisma recusa o campo ali — não existe onde pendurar o filtro". Essa frase
continua literalmente verdadeira (`companyId` **sozinho** continua não sendo
único em 11 modelos), e mesmo assim fica enganosa: agora existe onde pendurar o
filtro, e a recusa passa a ser por uniformidade nesses quatro também. Sem o
parágrafo, o próximo leitor conclui que `findUnique` por `companyId_telefone` é
legítimo — e ele seria escopável pelo TIPO e não pela EMPRESA, porque o
`companyId` do `where` vem de quem chama. É o mesmo caminho que a Tarefa 7 do
Ciclo 2a fechou para `webhookTokenHash`.

`WhatsappConnection` já é precedente disto (`@@unique([companyId, canal,
instancia])`), e o parágrafo de `escopo.ts` que fala dela é o lugar certo para
os quatro novos entrarem.

**`MODELOS_DE_TENANT` não muda: continua com 13.** Nenhum modelo nasce ou morre
neste ciclo, e a trava de deriva (`escopo-empresa.test.ts`, "MODELOS_DE_TENANT
não pode derivar do schema") lê `^\s*companyId\s+\w+` — uma linha
`@@unique([companyId, telefone])` não casa com esse regex. O mesmo vale para o
leitor de schema de `catraca-prisma-cru.test.ts:146`. Verificado lendo os dois
regex, e travado pelo próprio fato de os dois testes rodarem no final.

O caso "`BotConfig` e `CompanyConfig` são os ÚNICOS modelos de tenant onde
companyId é único" também não muda: o regex dele é `@@unique\(\[companyId\]\)`,
exato, e `@@unique([companyId, telefone])` não casa.

---

## 8. O que este ciclo prova, e onde

**O ciclo só está pronto quando existir prova de que duas empresas coexistem**
com o mesmo telefone de contato, a mesma ordem de etapa, o mesmo `waId` de
conversa e o mesmo `idExterno` de mensagem — cada uma vendo só o seu.

Essa prova mora em **`tests/unit/unicidades-por-empresa.test.ts`**, arquivo novo,
contra o **Postgres real**. A escolha do lugar não é arbitrária:

- não pode ser `tests/unit/escopo-empresa.test.ts`: aquele arquivo usa um banco
  FALSO que nunca chama `query()`. Ele prova o mecanismo de injeção, não o que o
  índice único faz;
- não pode ser um dos `*-isolamento.test.ts`: cada um deles prova "o escopo da A
  não alcança o dado da B" para um módulo. Esta pergunta é outra — "o BANCO
  aceita as duas linhas?" — e ela atravessa quatro módulos;
- não pode ser e2e: a afirmação é sobre constraint de banco, e um e2e provaria a
  mesma coisa mais devagar e com mais coisas capazes de falhar no caminho.

Os casos, com as **duas metades** que a base exige de todo teste de isolamento
(prova que A não alcança B **e** prova que o dado certo continua chegando):

**Seis casos**, em três pares — um par por superfície. O primeiro de cada par
prova a coexistência; o segundo prova o que não pode ter sido quebrado no
caminho (a dedup, nos pares 1 e 3; o cálculo de posição de `criarEtapa`, no
par 2):

| # | Prova | Como falha hoje, antes da mudança |
| --- | --- | --- |
| 1 | `encontrarOuCriarContact` nas duas empresas com o MESMO telefone devolve dois contatos distintos; o oráculo cru vê 2 linhas; cada cliente escopado vê só a sua | `P2002` em `Contact_telefone_key`, traduzido hoje no erro "Telefone já cadastrado em outra empresa" |
| 2 | `encontrarOuCriarContact` duas vezes na MESMA empresa devolve o mesmo id, sem sobrescrever o nome — **a dedup não afrouxou** | (já passa hoje; é a segunda metade) |
| 3 | `PipelineStage`: a mesma `ordem` existe em A e em B, e cada escopo vê só a sua | `P2002` em `PipelineStage_ordem_key` — **já na fixture**, no `createMany` que semeia as duas etapas |
| 4 | `criarEtapa` em B cai em `max(ordem da B) + 1` mesmo quando A já ocupa esse número — §4.2.4 | `P2002` na tela `/etapas`, apontando para uma etapa invisível para quem clicou |
| 5 | `ingerirMensagem` com o mesmo `waId` **e** o mesmo `idExterno`, pelas conexões de A e de B, cria duas conversas e duas mensagens, ambas com `duplicada: false`, cada uma com o seu `connectionId` | `P2002` → o erro sobe → 500 → reentrega em laço (§3.1) |
| 6 | reentrega do MESMO payload dentro de A devolve `duplicada: true`, não incrementa `bufferSeq` e não cria segunda linha — **a dedup não afrouxou** | (já passa hoje; é a metade que impede "resolver" o ciclo quebrando a idempotência) |

O caso **6 é o que dá sentido ao 5**, e o **2 ao 1**. Sem eles, apagar as quatro
constraints passaria em todos os outros.

**Fora deste arquivo, e de propósito:** a trava de deriva que afirma que os
quatro `@@unique` existem, que **`companyId` é a primeira coluna dos quatro**, e
que nenhum dos quatro campos recuperou o `@unique` de coluna. Ela é asserção
sobre o TEXTO do schema, e o lugar dela é `tests/unit/escopo-empresa.test.ts`,
junto das outras travas de afirmação universal que aquele arquivo já carrega.

A fixture precisa de: duas `Company`, um `User` + `Membership` por empresa (o
`registrarAuditoria` de `criarEtapa` exige o vínculo desde o Ciclo 1a — ver o
commit `e67e1e6`), uma `WhatsappConnection` por empresa (o `ContextoDeIngestao`
exige `connectionId`) e uma `PipelineStage` inicial por empresa.

---

## 9. O que este ciclo NÃO faz

1. **Não torna `Conversation.connectionId` `NOT NULL`.** §4.3.3.
2. **Não atualiza `Conversation.connectionId` para a conexão da última
   mensagem.** ⚠️ D3-a, decisão de roteamento, do dono.
3. **Não derruba os `@@index([companyId])` que ficaram redundantes.** §5, ⚠️ D5.
4. **Não escopa `prisma/seed.ts:139` (`pipelineStage.count()` global).** §4.2.1
   item 7, ⚠️ D2-a.
5. **Não mexe em `WhatsappConnection.webhookTokenHash`.** Ele é `@unique` GLOBAL
   deliberadamente, e há caso de teste amarrando a decisão. Segredo de 256 bits
   repetido entre empresas é estado que deve ser impossível — o oposto do
   raciocínio das quatro deste ciclo. Se alguma tarefa "arrumar" isso por
   simetria, quebrou a resolução do webhook.
6. **Não mexe em `Membership.@@unique([userId, companyId])`, `BotConfig`,
   `CompanyConfig` nem `User.email`.** As duas primeiras já são compostas; as
   duas últimas são globais por razão própria (`User` não é modelo de tenant, e o
   comentário do schema explica).
7. **Não toca RLS, políticas, grants nem o e2e `banco-blindado`.** §6.
8. **Não faz backfill nenhum.** Não há o que migrar: as duas tabelas do WhatsApp
   estão vazias e as outras duas têm uma empresa só.

---

## 10. Ações do dono

**NENHUMA.** Nenhuma tarefa do plano fica bloqueada por ação do dono. As quatro
migrações rodam contra o mesmo banco de desenvolvimento que já é usado, com as
credenciais que já estão no `.env`.

Herdada e não deste ciclo: 🔍 NV6 do Ciclo 2a — a senha de `admin@exemplo.com` e
`vendedor@exemplo.com` foi reescrita pela última execução de `npm test` e
continua pendente de rotação. Este ciclo **não roda `npm test`** por esse motivo,
e a tarefa final roda os arquivos focados.

---

## 11. Riscos e dívidas que este ciclo declara

| Id | O que é | Estado |
| --- | --- | --- |
| ⚠️ D3-a | Resposta sai pela conexão que ABRIU a conversa, não pela que recebeu a última mensagem. Só morde com duas conexões ativas na mesma empresa | **declarado, não corrigido.** Conserto nomeado em §4.3.4 |
| ⚠️ D2-a | `prisma/seed.ts:139` conta `PipelineStage` sem empresa; um seed de segunda empresa pularia o funil dela | **declarado, não corrigido.** Inofensivo enquanto o seed criar uma empresa só |
| ⚠️ D5 | Quatro `@@index([companyId])` ficam redundantes com o prefixo dos índices novos | **declarado, não corrigido.** Gatilho de reabertura em §5 |
| ⚠️ R2 (Ciclo 1a) | "As quatro unicidades globais" | **FECHADA por este ciclo**, se e somente se o teste da §8 estiver verde |
| ⚠️ Herdado | `Conversation.connectionId` nulo, sem backfill (§7 da auditoria do 2a) | continua, e este ciclo depende dele continuar — §4.3.2 |

---

## 12. Critérios de aceite

1. As quatro `@@unique` no schema, com `companyId` como primeira coluna, e as
   quatro migrações aplicadas (`npx prisma migrate status` → `Database schema is
   up to date!`).
2. `tests/unit/unicidades-por-empresa.test.ts` verde, com os **seis** casos da
   §8 — incluindo o 2 e o 6, que provam que a dedup não afrouxou. E a prova de
   que o arquivo DISCRIMINA: com uma das quatro constraints revertida à mão no
   banco, ele fica vermelho.
3. `tests/unit/migracoes-seguras.test.ts` verde **sem nenhuma entrada nova em
   `PERDOADAS`**.
4. `tests/unit/escopo-empresa.test.ts` verde, com `MODELOS_DE_TENANT.size === 13`
   intacto e a trava nova dos quatro `@@unique`.
5. `tests/unit/catraca-prisma-cru.test.ts` verde com
   `LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS = 0`.
6. `npm run typecheck` e `npm run lint` limpos.
7. Nenhuma frase de comentário afirmando "`@unique` GLOBAL" sobre as quatro
   sobrevive no repositório —
   `grep -rn "unique. GLOBAL" src/ prisma/ tests/` devolve só as ocorrências que
   falam de `WhatsappConnection.webhookTokenHash` e de `User.email`.

---

## 13. 🔍 NÃO VERIFICADO

| Id | O que não foi verificado | Por quê | O comando que um humano roda |
| --- | --- | --- | --- |
| NV1 | Que `prisma migrate dev` não acusa deriva depois das quatro migrações escritas à mão | Exige shadow database, que este ambiente não provisiona. O que **é** medido é `migrate status` — pergunta diferente | `npx prisma migrate dev --create-only` num branch descartável, e conferir que o SQL gerado é vazio |
| NV2 | Que `idExterno` da Evolution não se repete entre contas diferentes | Não há duas instâncias Evolution acessíveis neste ambiente; o argumento de §4.4 item 4 é sobre o contrato, não medição | Cadastrar duas conexões em instâncias distintas e comparar `data.key.id` de mensagens recebidas |
| NV3 | Que `btree ("companyId","ordem")` serve as consultas do funil melhor que `btree (ordem)` | 4 linhas: qualquer `EXPLAIN` dá `Seq Scan`. §4.2.3 é dedução sobre o desenho do btree | `EXPLAIN ANALYZE SELECT * FROM "PipelineStage" WHERE "companyId"=$1 ORDER BY "ordem";` com alguns milhares de linhas |
| NV4 | Que o laço de reentrega da Evolution de fato para depois da mudança | Exige instância Evolution viva e duas empresas com conexão. O que o ciclo prova é que o `create` não colide mais — o comportamento da Evolution é do lado dela | Duas conexões reais, mesmo número escrevendo para as duas, conferir 200 no log da Vercel |
| NV5 | Que os quatro `@@index([companyId])` são de fato redundantes na prática | `idx_scan` é zero em tudo neste volume | `SELECT relname, indexrelname, idx_scan FROM pg_stat_user_indexes WHERE relname IN (…);` depois de tráfego real |
