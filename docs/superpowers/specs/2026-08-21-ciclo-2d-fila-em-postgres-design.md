# n8necrm — Ciclo 2d: sair da Vercel, a fila vira Postgres — Design Spec

**Data:** 2026-08-21
**Branch de origem:** `ciclo-1a-tenancy`, HEAD `eb23ffb`, árvore limpa
**Plano:** `docs/superpowers/plans/2026-08-21-n8necrm-ciclo-2d-fila-em-postgres.md`

---

## 1. A decisão do dono, e o que ela reabre

O dono decidiu, em 2026-08-21, **não usar a Vercel**. Isso reabre a decisão
travada nº 6 do `CLAUDE.md` e da §3 do spec fundador
(`docs/superpowers/specs/2026-08-19-n8necrm-fundacao-design.md`), que dizia
"Hospedagem: Vercel agora. O runtime continua sendo Vercel Queues".

Ele escolheu duas coisas, e recusou outras:

1. **A fila vira Postgres, no Supabase que já existe.** Tabela com lease
   atômico, no mesmo idioma de `UPDATE` condicional que `claimLease`
   (`src/modules/whatsapp/turno.ts`) e `checarRateLimit`
   (`src/core/rate-limit/limiter.ts`) já usam. **Zero infra nova.**
   Recusados: **pg-boss numa VPS** (mais um processo para manter e vigiar) e
   **o próprio n8n** (acoplaria o núcleo do chat a um sistema externo que
   hoje é só uma tela do CRM).
2. **Hospedagem: ainda não decidida.** O app precisa ficar **agnóstico**,
   rodando em qualquer Node. Onde publicar fica para depois e **não pode
   travar nada deste ciclo**.

Este spec desenha o item 1 inteiro e o que o item 2 exige de quem escreve o
código: nenhuma decisão aqui pode pressupor plataforma.

## 2. O que foi medido antes de desenhar

Tudo abaixo foi medido nesta árvore, em 2026-08-21, e a medição é o que
sustenta o desenho — não a lembrança de como o código era.

| Medida | Valor | Como |
| --- | --- | --- |
| Arquivos de `src/` que citam a Vercel | **18** | `grep -rli vercel src/ \| wc -l` |
| Arquivos de `tests/` que a citam | **12** | `grep -rli vercel tests/ \| wc -l` |
| Arquivos de `config/` | **1** | `config/client.ts:36` |
| Documentos que a citam | **27** | `grep -rli vercel docs/ \| wc -l`, antes deste ciclo |
| Importadores de `publicarTurno` | **3** | rota do webhook (1) e `turno.ts` (2) |
| Arquivos de `src/` que citam `@vercel/queue` | **5**, dos quais **4 importam** | `grep -rln "@vercel/queue" src/`. O quinto é `fila/tipos.ts`, que só o menciona em comentário — a mesma distinção entre importar e MENCIONAR que `catraca-prisma-cru.test.ts` faz para o prisma cru, e pelo mesmo motivo |
| Arquivos de `tests/` que o citam | **5** | `grep -rln "@vercel/queue" tests/` |
| Modelos de tenant | **13** | `MODELOS_DE_TENANT`, `src/core/tenancy/escopo.ts:287` |
| Catraca do prisma cru | **0 temporários, 5 permanentes** | `eslint.config.mjs:428`, `tests/unit/catraca-prisma-cru.test.ts` |
| `PERDOADAS` de migração | **2** | `tests/unit/migracoes-seguras.test.ts:38` |
| Consumidores de `obterIpDaRequisicao` | **3** | webhook, export de leads, `credenciais.ts` |
| Última migração aplicada | `20260821130000_derruba_user_papel_de_vez` | `ls prisma/migrations` |
| Deploys publicados | **zero** | `docs/ESTADO.md`: "nada integrado, nada publicado" |

**A costura do Ciclo 0 pagou.** `src/modules/whatsapp/fila/` já é adaptador: a
interface é `FilaTurnos { publicar(job, opcoes) }` (`fila/tipos.ts`), e o
comentário de `fila/index.ts` **previu este dia**, nomeando pg-boss e BullMQ
como os candidatos a segundo adaptador. Os três importadores não sabem que a
Vercel existe.

**A costura tem UM furo, e ele é medido:** `DuplicateMessageError`, um tipo de
`@vercel/queue`, é importado **fora** do adaptador — em
`src/app/api/whatsapp/evolution/[companyId]/[token]/route.ts:2` e em
`src/modules/whatsapp/turno.ts:3`. Apagar a dependência sem tratar isso deixa
dois arquivos sem compilar. A §5.6 resolve.

## 3. O problema que este ciclo existe para resolver

Fora da Vercel, três coisas que a plataforma dava de graça deixam de existir:

1. **A entrega.** Nada acorda o consumidor. `send()` empurrava; agora alguém
   precisa puxar.
2. **A rede.** A rota consumidora era **air-gapped**. Passa a ser alcançável
   da internet.
3. **O IP real.** `x-vercel-forwarded-for` some, e o que sobra é forjável.

As três são endereçadas nas §5.2, §5.4 e §5.7. Nenhuma é "trocar uma string".

## 4. O achado de segurança que o desenho precisa resolver

O consumidor de hoje (`src/app/api/queues/whatsapp-turn/route.ts`) documenta,
com citação da documentação da Vercel, que a rota fica *"completamente
air-gapped da internet… só pode ser invocada pela infraestrutura interna de
fila da Vercel"*, e registra que a inspeção do código-fonte de `@vercel/queue`
mostrou que **o SDK não faz nenhuma verificação de assinatura nem OIDC** —
confia inteiramente na garantia de rede.

O segredo compartilhado (`WHATSAPP_QUEUE_SECRET`), embutido **no payload do
job**, é a segunda camada. O próprio comentário do adaptador explica por que
ele foi para o payload e não para um cabeçalho: *"a documentação não confirma
que headers chegam como header HTTP na entrega por push"*.

**Fora da Vercel, a primeira camada deixa de existir.** Consequências, ditas
uma a uma:

- A rota passa a ser alcançável por qualquer um que descubra o caminho, e o
  segredo vira a **única** defesa.
- O segredo viajava **no corpo**. Um segredo que viaja no corpo de um POST
  que qualquer um pode montar não autentica nada por si — ele só era útil
  porque o corpo vinha da fila da própria plataforma.
- A comparação existe e é de tempo constante (`crypto.timingSafeEqual`,
  linha 80), mas tem um **oráculo de comprimento**: `if
  (bufferRecebido.length !== bufferEsperado.length) return false` responde
  antes de comparar. Contra um segredo de 32 bytes hex isso é irrelevante na
  prática (a entropia é a defesa, o mesmo argumento de
  `core/conexoes/webhook-token.ts`), mas é uma assimetria gratuita que some
  com uma linha melhor.

**O desenho responde assim:** o segredo sai do payload e vira **cabeçalho de
quem ACIONA o consumidor** (§5.4 e §5.5), comparado por **digest de tamanho
fixo** (§5.5). E o payload deixa de ter onde carregar segredo, porque o job
não viaja mais por rede nenhuma: ele nasce e morre dentro do nosso Postgres
(§5.1).

## 5. Decisões deste spec

### 5.1 A forma da tabela — e por que `TurnoJob` É modelo de tenant

`TurnoJob` carrega `companyId`. A pergunta é se ela entra em
`MODELOS_DE_TENANT` (hoje 13, com trava de deriva que **morde**:
`tests/unit/escopo-empresa.test.ts`, "MODELOS_DE_TENANT não pode derivar do
schema", lê o schema e falha nomeando o modelo).

**Decisão: sim, `TurnoJob` é o 14º modelo de tenant.**

Havia três formas possíveis, e as três foram consideradas:

**(a) Infraestrutura, sem coluna `companyId`, como `RateLimit`.** A empresa
viajaria dentro de uma coluna `Json` ou numa coluna com outro nome
(`empresaId`). Isto **passa** na trava de deriva — o leitor do schema procura
o escalar `companyId`. E é exatamente por isso que foi **recusada**: passar na
trava por escolher outro nome é contornar a trava, não satisfazê-la. A trava
existe para achar tabela com dono de empresa que escapou do escopo, e é
precisamente o que esta seria.

**(b) Coluna `companyId` fora do Set.** Não é opção: a trava de deriva falha,
e falha com a mensagem certa — *"tem companyId no schema e NÃO está em
MODELOS_DE_TENANT: operação nele passa SEM filtro de empresa (vazamento
silencioso)"*.

**(c) Coluna `companyId` dentro do Set.** Escolhida. E o argumento não é
"sobrou": é que o Set **compra proteção real em três dos quatro caminhos** que
tocam a tabela.

| Caminho | Tem `companyId` antes de tocar o banco? | Cliente |
| --- | --- | --- |
| Publicar (`FilaPostgres.publicar`) | **sim** — vem do job, resolvido pela CONEXÃO no webhook | `prismaDaEmpresa(companyId)` |
| Concluir (apagar o job feito) | **sim** — o `RETURNING` da reivindicação devolveu | `prismaDaEmpresa(companyId)` |
| Falhar / matar / podar | **sim** — mesma origem | `prismaDaEmpresa(companyId)` |
| **Reivindicar** | **não, e não pode ter** | `prisma` cru, `$queryRaw` |

A reivindicação é a exceção, e a razão dela é estrutural, não preguiça: **o
consumidor descobre a empresa reivindicando**. Ele roda fora de qualquer
requisição, sem sessão, e a pergunta que ele faz ao banco é "qual o próximo
job de QUALQUER empresa que está pronto". `prismaDaEmpresa(companyId)`
exigiria como parâmetro exatamente o valor que o `UPDATE … RETURNING
"companyId"` devolve. **É a mesma circularidade que já isenta
`core/auth/session.ts`, `core/auth/credenciais.ts` e `core/users/empresa.ts`
na `EXCECAO_PERMANENTE` do `eslint.config.mjs`** — e é verificável em uma
linha, do mesmo jeito que a delas.

Consequência declarada: `src/modules/whatsapp/fila/postgres.ts` entra na
`EXCECAO_PERMANENTE`, que passa de 5 para 6 entradas, com o motivo escrito na
mesma voz das outras cinco. É a **primeira** exceção permanente fora de
`src/core/**`, e isso está dito de propósito.

**O que se perde, em voz alta:** a Parte 2b de
`tests/unit/catraca-prisma-cru.test.ts` — que lê o TEXTO de todo
`$queryRaw`/`$executeRaw` e reprova quem citar tabela de tenant sem
`companyId` — **não cobre arquivo que está nas listas de exceção**. Ou seja,
este arquivo sai da cobertura dela. A compensação é um teste próprio
(`tests/unit/fila-postgres.test.ts`) que afirma três coisas sobre o texto do
próprio módulo: existe **exatamente um** `$queryRaw` nele; o `RETURNING` dele
inclui `"companyId"`; e nenhum outro `$queryRaw`/`$executeRaw` aparece. Sem a
segunda, um refator que parasse de devolver a empresa faria todo o resto do
fluxo cair em `undefined` silenciosamente.

**A tabela:**

```prisma
model TurnoJob {
  id                     String       @id @default(cuid())
  companyId              String
  company                Company      @relation(fields: [companyId], references: [id], onDelete: Restrict)
  conversationId         String
  conversation           Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  seq                    Int
  tentativaReagendamento Int          @default(0)
  chaveIdempotencia      String
  disponivelEm           DateTime
  leaseAte               DateTime?
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

Decisões dentro da tabela:

- **`@@unique([companyId, chaveIdempotencia])`, não `@unique` global.** O
  Ciclo 1e existiu para tornar unicidades por empresa. A chave deriva de
  `conversationId`, que é `cuid()` e portanto já global — então as duas
  formas seriam corretas hoje. A composta é a que continua correta se um dia
  a chave passar a derivar de algo por empresa, e é a que não exige o leitor
  confiar num raciocínio sobre cuid.
- **Sem `estado` enum. `mortoEm DateTime?` é o estado.** `NULL` = vivo. Um
  enum precisaria de valor para "pendente", "reivindicado" e "morto", e os
  dois primeiros já são deduzidos de `disponivelEm`/`leaseAte` — dois lugares
  dizendo a mesma coisa é onde a deriva nasce. E `mortoEm` é a data, não só a
  marca: a poda (§5.8) precisa dela de qualquer jeito.
- **Sem coluna de teto de tentativas.** `MAX_TENTATIVAS_ENTREGA` é constante
  de código. Se ela fosse a condição de morte lida a cada reivindicação, subir
  a constante **ressuscitaria** jobs mortos antigos, sem ninguém pedir.
  `mortoEm` gravado é decisão tomada, não recalculada.
- **FK para `Conversation` com `onDelete: Cascade`.** O job é um PONTEIRO para
  uma conversa; o ponteiro não pode sobreviver ao alvo. Sem a FK, apagar uma
  conversa deixaria jobs que reivindicam, falham no `claimLease`, reagendam
  até o teto e desistem — barulho por minutos para nada.
- **FK para `Company` com `onDelete: Restrict`,** igual a `CompanyConfig` e
  `WhatsappConnection`: apagar empresa com trabalho pendente é o tipo de
  operação que deve parar e ser olhada.
- **RLS ligada e zero políticas, `REVOKE ALL … FROM anon, authenticated`.**
  Obrigatório em toda tabela nova deste projeto —
  `tests/e2e/banco-blindado.spec.ts` varre sem lista fixa e uma tabela nova
  desprotegida aparece sozinha.

### 5.2 Como o job é reivindicado sem dois consumidores pegarem o mesmo

O projeto tem **dois** idiomas prontos, e os dois são a mesma coisa: um
`UPDATE` condicional atômico cuja própria cláusula `WHERE` é a exclusão mútua.

- `claimLease` (`turno.ts:562`): `UPDATE "Conversation" SET "processandoAte" =
  … WHERE "id" = … AND "companyId" = … AND ("processandoAte" IS NULL OR
  "processandoAte" < agora) RETURNING …`. Zero linhas = outro dono. O valor
  devolvido é o **fencing token**.
- `checarRateLimit` (`limiter.ts:166`): `INSERT … ON CONFLICT … DO UPDATE …
  RETURNING`, apoiado no lock de linha que o Postgres toma durante a
  instrução.

**Decisão: seguir os dois, sem inventar um terceiro.** A reivindicação é o
mesmo `UPDATE` condicional com `RETURNING`, e o `leaseAte` devolvido é o
fencing token — literalmente o desenho de `claimLease`, aplicado a uma tabela
em vez de a uma linha conhecida. A liberação (`concluirJob`, `falharJob`) só
age quando `leaseAte` no banco **ainda é** o token que a reivindicação
devolveu, exatamente como `liberarLease`.

A única coisa que a fila tem e o `claimLease` não é que **a linha ainda
precisa ser escolhida**. Daí o subselect:

```sql
UPDATE "TurnoJob"
SET "leaseAte" = $ate, "tentativasEntrega" = "tentativasEntrega" + 1
WHERE "id" = (
  SELECT "id" FROM "TurnoJob"
  WHERE "mortoEm" IS NULL
    AND "disponivelEm" <= $agora
    AND ("leaseAte" IS NULL OR "leaseAte" < $agora)
  ORDER BY "disponivelEm" ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
  AND "mortoEm" IS NULL
  AND "disponivelEm" <= $agora
  AND ("leaseAte" IS NULL OR "leaseAte" < $agora)
RETURNING "id", "companyId", "conversationId", "seq",
          "tentativaReagendamento", "tentativasEntrega", "leaseAte"
```

**As condições aparecem DUAS vezes, e a repetição é a correção, não descuido.**
O subselect escolhe; o `WHERE` de fora é o que torna a escolha atômica. Sob
`READ COMMITTED`, dois consumidores podem avaliar o subselect no mesmo
instante e chegar ao mesmo `id`; o segundo bloqueia no lock de linha e, ao
destravar, **reavalia a cláusula do próprio `UPDATE`** contra a versão nova da
linha. Se a condição de lease só existisse no subselect (já avaliado), o `id =
X` de fora continuaria casando e o segundo consumidor reivindicaria o job que
o primeiro acabou de pegar. É o mesmo raciocínio do `AND ("processandoAte" IS
NULL OR …)` de `claimLease`, e é ele que faz a garantia.

**`FOR UPDATE SKIP LOCKED` é a outra metade, e ela é de vazão, não de
correção.** Sem ele, N consumidores concorrentes enfileiram no lock da MESMA
linha e todos menos um saem de mãos vazias depois de esperar; com ele, cada um
pula para a próxima linha livre. Recusar SKIP LOCKED por ser "um terceiro
idioma" seria confundir cláusula com idioma: o idioma é `UPDATE` condicional
com `RETURNING`, e ele está intacto.

**Prova:** `tests/unit/fila-postgres.test.ts` dispara reivindicações
simultâneas com `Promise.all` contra o Postgres real — o mesmo método que
`tests/unit/rate-limit.test.ts` já usa para provar a atomicidade do limiter —
e afirma que N reivindicações concorrentes sobre M jobs devolvem `min(N, M)`
**ids distintos**, nunca o mesmo id duas vezes.

### 5.3 O que a fila nova reproduz da Vercel

| O que a Vercel dava | Como fica |
| --- | --- |
| **Entrega atrasada** (`delaySeconds`, 8s padrão, 5s no reagendamento) | `disponivelEm = agora + delaySeconds`. A reivindicação só enxerga `disponivelEm <= agora`. A interface `OpcoesPublicacao` **não muda**. |
| **Nova tentativa** (handler lançou → reentrega em `retryAfterSeconds: 30`) | `falharJob` põe `leaseAte = NULL` e `disponivelEm = agora + 30s`. Mesmo número, agora escrito em `RETRY_APOS_MS`. |
| **Teto de tentativas** | `MAX_TENTATIVAS_ENTREGA = 5`. `tentativasEntrega` incrementa **na reivindicação**, não na conclusão — é o que faz um job que MATA o processo morrer também, em vez de girar para sempre. |
| **Entrega no máximo uma por vez** | O lease de job (`leaseAte`, 90s) com fencing token. `claimLease` de `turno.ts` continua sendo a trava por conversa; são camadas diferentes e as duas ficam. |
| **Deduplicação** (`idempotencyKey`, janela de até 24h) | `@@unique([companyId, chaveIdempotencia])` + `skipDuplicates`. §5.6 explica a mudança de janela. |

**Os três leases, e a ordem entre eles.** O ciclo de vida de um turno passa a
ter três tempos, e a ordem entre eles é invariante:

```
TEMPO_MAX_TURNO_MS (60s)  <  LEASE_DURACAO_MS (75s)  <  JOB_LEASE_MS (90s)
   teto do processamento      lease da CONVERSA         lease do JOB
```

- `TEMPO_MAX_TURNO_MS = 60_000` é **novo, e é obrigatório**. Hoje quem
  garantia esse teto era `export const maxDuration = 60` na rota — o teto do
  plano Hobby da Vercel. Fora da Vercel **nada mata a função**, e o comentário
  de `LEASE_DURACAO_MS` em `turno.ts` diz textualmente que 75s foi escolhido
  para ficar ACIMA daquele teto. Apagar a plataforma sem repor o teto quebra
  o raciocínio inteiro: um `processarTurno` pendurado passaria dos 75s, o
  lease da conversa expiraria embaixo dele, e o fencing token — que existe
  para o caso RARO — viraria o caso comum. O teto volta como `Promise.race`
  dentro de `drenarFila`.
- `JOB_LEASE_MS = 90_000` fica acima dos dois para que o job só seja
  reentregue depois de o turno ter desistido de verdade.

**Prova:** um caso de teste afirma a desigualdade lendo as três constantes.
Sem ele, a frase acima é afirmação universal sem exercício — e este projeto
reescreve frase assim.

### 5.4 Quem aciona o consumidor, dado que a hospedagem é indefinida

**Decisão: o desenho entrega DOIS gatilhos que não pressupõem plataforma
nenhuma, e ambos chamam a MESMA função.**

```
                       drenarFila()          ← toda a lógica mora aqui
                        ↑          ↑
        POST /api/queues/whatsapp-turn    scripts/fila-worker.ts
        (HTTP, autenticado por cabeçalho)  (laço em processo, sem rede)
```

- **O endpoint** serve a quem for acionar de fora: `pg_cron` + `pg_net` do
  Supabase, um `curl` num cron de VPS, um agendador de plataforma, um
  workflow do n8n batendo na URL. Ele não sabe nem se importa com qual.
- **O worker** serve a quem tiver um Node sempre ligado: `npm run
  fila:worker`. Ele **não abre porta nenhuma** e não depende do endpoint —
  quem usar essa forma pode deixar a rota inacessível de fora e a fila
  continua funcionando. É a opção com menor superfície, e a que dá a menor
  latência sem depender de granularidade de cron.

**O caminho da rota não muda: continua `/api/queues/whatsapp-turn`.** Renomear
obrigaria a mexer no matcher de `src/proxy.ts` e no
`tests/unit/proxy-matcher.test.ts`, que já registram a exceção daquele
prefixo — risco sem ganho. O que muda é o corpo da rota e o comentário que
explica por que ela é pública.

Nenhum dos dois gatilhos é o padrão do código: **sem alguém ligar um dos dois,
a fila enche e ninguém drena**. Isto é dito no `.env.example`, no
`docs/ESTADO.md` e na §9 deste spec, porque é a única regressão funcional real
do ciclo — a Vercel empurrava sozinha.

**Latência, dita com honestidade.** Hoje a resposta sai ~8s depois da mensagem
(a janela de buffer). Com o worker em laço de 2s, sai ~8–10s: praticamente
igual. Com um cron de 1 minuto, sai em até ~68s — uma regressão de
experiência que o dono precisa conhecer ANTES de escolher, não depois. É por
isso que os dois gatilhos existem, e por isso o worker é o recomendado.

### 5.5 Como o consumidor se autentica agora que não há air-gap

Três mudanças, cada uma com um motivo próprio:

1. **O segredo sai do payload.** Ele estava lá porque o payload era a única
   coisa que nós mesmos serializávamos numa entrega feita pela plataforma.
   Agora o job **não atravessa rede nenhuma**: é uma linha do nosso Postgres,
   lida pelo nosso processo. Não há payload de fora para carregar segredo, e
   um campo `segredo` na tabela seria segredo em repouso sem necessidade.
2. **O segredo vira cabeçalho de quem ACIONA.** `x-fila-segredo`. O que
   precisa ser autenticado mudou de "esta mensagem" para "esta chamada de
   tick", e cabeçalho é onde credencial de chamada mora.
3. **A variável continua sendo `WHATSAPP_QUEUE_SECRET`.** O papel dela mudou e
   o nome não — de propósito: renomear obrigaria o dono a mexer no ambiente
   para uma troca sem ganho de segurança, e ele já tem ação demais nesta
   lista. O bloco do `.env.example` é reescrito para dizer o que ela protege
   AGORA.

**A comparação.** O projeto **já tem** o padrão, em
`src/app/api/queues/whatsapp-turn/route.ts:74-81` — mas com o oráculo de
comprimento da §4. Como haverá **um** chamador, extrair um módulo
compartilhado seria antecipar (o argumento que fez `obterIpDaRequisicao`
virar módulo foi o SEGUNDO chamador). O que o desenho faz é escrever a versão
sem o oráculo, num arquivo próprio e testável, `src/lib/segredo.ts`:

```ts
export function segredoConfere(recebido: string, esperado: string): boolean {
  if (esperado.length === 0) return false;
  const a = crypto.createHash("sha256").update(recebido, "utf8").digest();
  const b = crypto.createHash("sha256").update(esperado, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}
```

O digest não é enfeite: `timingSafeEqual` **lança** com buffers de tamanhos
diferentes, e é essa restrição que empurrava o código antigo para o `return
false` antecipado. Dois SHA-256 têm sempre 32 bytes, então não sobra ramo
dependente do comprimento. (Como em `webhook-token.ts`, a defesa real são os
256 bits de entropia; o que se ganha aqui é não deixar uma assimetria de
graça.)

**A resposta a segredo errado é `404`, não `401`.** Mesma decisão já tomada na
rota do webhook — *"não confirma a quem está adivinhando que este path sequer
existe"* —, e agora ela vale para os dois pontos de entrada públicos do
sistema, não para um só.

**O que o proxy diz sobre este caminho muda junto.** `src/proxy.ts:212-217`
afirma hoje que `/api/queues` é *"seguro mesmo sem token próprio — … só a
própria Vercel invoca"*. Isso deixa de ser verdade no commit em que a Vercel
sai, e um comentário que sobrevive ao fato vira mentira. A rota passa a estar
sob o mesmo invariante que `/api/whatsapp/*` já carrega: **público por
definição, autentica-se sozinho**.

### 5.6 O furo da costura: `DuplicateMessageError`

Dois arquivos fora do adaptador importam esse tipo de `@vercel/queue`, e os
dois fazem a MESMA coisa com ele: tratam como **esperado** e seguem
(`continue` na rota do webhook, `return` em `turno.ts`).

**Decisão: `publicar` deixa de lançar em duplicata.** O `INSERT` usa
`skipDuplicates`, a publicação vira no-op, e os dois `catch` somem junto com o
import. O comportamento observável é idêntico ao de hoje — os dois chamadores
já traduziam a exceção para "tudo bem" — e a interface `FilaTurnos` continua
`Promise<void>`, sem provedor vazando para fora do adaptador.

**A janela de dedupe muda, e a mudança precisa ser dita.** Na Vercel a chave
ficava reservada por `min(retenção, 24h)`. Aqui ela vale **enquanto a linha
existir** — e a linha é apagada quando o job conclui (§5.8). Ou seja: uma
republicação da MESMA chave depois da conclusão cria um job novo.

Isso é seguro, e o caminho é verificável no código de hoje: o segundo turno
reivindica o lease da conversa, encontra `bufferSeq === seq`, chama
`processarMensagensPendentes`, e ali `pendentes.length === 0` — porque o
primeiro turno já gravou `processadoEm` — então ele **retorna sem enviar
nada** (`turno.ts`, `processarMensagensPendentes`). Nenhuma mensagem duplicada
chega ao cliente. `tests/unit/whatsapp-turno.test.ts` já exercita o ramo de
zero pendentes; o ciclo acrescenta o caso que faz o percurso completo pela
fila.

### 5.7 O IP real sem o cabeçalho da Vercel

Este é o item que **não** tem resposta boa enquanto a hospedagem estiver em
aberto, e a resposta honesta é dizer isso.

`x-vercel-forwarded-for` funcionava por uma propriedade que o comentário de
`src/lib/ip.ts` registra: *"a plataforma sobrescreve, não concatena, o que
vier de fora com esse nome"*. Sem a plataforma, sobram `x-real-ip` e
`x-forwarded-for` — e **os dois são escolhidos pelo cliente** quando não há um
proxy confiável na frente reescrevendo-os. Manter a precedência atual fora da
Vercel seria trocar um cabeçalho não forjável por um forjável **sem mudar uma
linha de comentário**: o pior desfecho possível, porque o código continuaria
afirmando uma garantia que perdeu.

**Decisão: nenhum cabeçalho é confiável até alguém dizer qual é.**

```ts
// IP_CABECALHO_CONFIAVEL: o nome do cabeçalho que a borda SOBRESCREVE.
// Ausente = não existe borda confiável = não existe IP.
export const IP_DESCONHECIDO = "desconhecido";
```

- Definida (`x-vercel-forwarded-for` na Vercel, `x-real-ip` atrás de nginx com
  `proxy_set_header X-Real-IP $remote_addr`, `cf-connecting-ip` atrás da
  Cloudflare): esse cabeçalho é a **única** fonte. O comportamento de hoje
  volta a existir **por configuração**, não por código.
- Ausente (o estado até a hospedagem ser decidida): `obterIpDaRequisicao`
  devolve `IP_DESCONHECIDO` e `ipDaRequisicaoAtual` devolve `undefined`.
  Nenhum cabeçalho é lido.

**Aviso que vai junto da variável:** o cabeçalho nomeado precisa ser um que a
borda **sobrescreva**, não um que ela **acrescente**. `x-forwarded-for` atrás
de um nginx que faz `proxy_add_x_forwarded_for` continua tendo o valor do
cliente na primeira posição — apontar a variável para ele seria escolher a
aparência de segurança. Os exemplos seguros vão escritos no `.env.example`.

**O que isso significa para o rate limit por IP no login — e por que "todo
mundo na mesma chave" NÃO é o comportamento seguro.** `checarLimiteLogin`
consulta o IP **primeiro** e retorna sem tocar na cota da conta se ele
estourou (`login.ts`, seção "O IP é checado primeiro, de propósito"). Se todas
as requisições colapsassem em `login:ip:desconhecido`, **20 tentativas erradas
de um atacante trancariam o login de TODO MUNDO por 10 minutos**. Uma defesa
contra força bruta que vira negação de serviço global é pior que a ausência
dela.

Então: **quando o IP é `IP_DESCONHECIDO`, a dimensão por IP é PULADA** — não
aplicada a um balde compartilhado. O que sustenta o login nesse estado é a
dimensão **por conta** (`login:conta:<email>`, 10 por 10 minutos), que é a que
protege uma conta específica de adivinhação dirigida, e que continua intacta.
O que se perde é a defesa contra **varredura de muitas contas a partir de uma
origem** — e essa perda é **uma consequência da hospedagem indefinida**, não
uma escolha de código. Ela some no dia em que `IP_CABECALHO_CONFIAVEL` for
definida.

**O webhook do WhatsApp** também usa a chave por IP
(`whatsapp:webhook:${ip}`, 600/min). Colapsar tudo num balde só ali derrubaria
mensagens legítimas de todas as empresas juntas. Quando o IP é desconhecido, a
chave passa a ser a **empresa do path** (`whatsapp:webhook:empresa:<id>`), que
está disponível antes de qualquer consulta. Limite conhecido, dito aqui: quem
souber o `companyId` de uma empresa (ele está na URL do webhook que o dono
cola no painel da Evolution) pode queimar o balde daquela empresa. Um
cabeçalho confiável fecha isso; nada mais fecha.

**`AuditLog.ip` volta a ser nulo enquanto não houver borda.** A Fase 2 da
auditoria de 2026-08-21 levou o `ip` aos 22 pontos que não o tinham. Essa
canalização **fica inteira** — o que desaparece é um valor em que se possa
confiar. E um IP forjado num log de auditoria é pior que um campo vazio:
vazio é ausência de informação; forjado é informação falsa que pode apontar
para a pessoa errada. Uma linha no ambiente devolve o campo.

### 5.8 A limpeza da tabela

`podarNotificacoes` (`core/notifications/dispatch.ts:259`) e
`podarRateLimitExpirado` (`limiter.ts:222`) são o padrão da casa: poda
**probabilística** (1%) pendurada num caminho frequente, **por empresa**, com
o `catch` que registra em vez de engolir. O argumento escrito nos dois é o
mesmo: *"cron exigiria rota nova, segredo próprio e configuração no painel da
Vercel, e correção que depende de configuração pode nunca entrar em vigor"*.

**Decisão, em duas metades:**

**Job concluído é APAGADO, não marcado.** Uma coluna `concluidoEm` exigiria um
segundo mecanismo para tirar a linha — e o segundo mecanismo é exatamente o
que nunca foi construído no caso do `RateLimit` (*"nada nunca apagava linha
desta tabela"*). O histórico que importa já existe em outro lugar:
`WhatsappMessage` guarda a mensagem e o `processadoEm`, `AuditLog` guarda o
que virou ação. A fila é lista de trabalho, não livro-razão. Bônus concreto: o
índice da reivindicação fica pequeno porque a tabela fica pequena.

**Job MORTO fica, e é podado por retenção.** Apagar em silêncio um job que
esgotou as tentativas é apagar a única evidência de que uma conversa nunca foi
respondida. Ele fica com `mortoEm` e `ultimoErro`, e sai depois de
`RETENCAO_JOB_MORTO_MS = 7 dias`.

**O gancho.** `drenarFila` roda constantemente e já tem o `companyId` do job
que acabou de tratar — então a poda é a mesma de `podarNotificacoes`: 1% de
chance, escopada naquela empresa, dentro de `try/catch` que registra. Herda a
mesma limitação conhecida, e ela é benigna aqui: empresa sem tráfego não tem
quem pode a tabela dela, mas também não tem o que podar, porque o que faz a
tabela crescer é uso.

**Nota sobre o argumento "cron exigiria a Vercel".** Depois deste ciclo existe
um laço nosso (`fila-worker`) e um endpoint de tick. A justificativa da poda
probabilística **enfraquece**, mas a decisão fica: ela não depende de
configuração nenhuma, e é o comportamento que já está provado por
`tests/unit/notificacoes-poda.test.ts` e `tests/unit/rate-limit.test.ts`.
Trocá-la por um agendamento seria trocar algo que funciona sozinho por algo
que só funciona se alguém ligar. O que muda é o **comentário**, nos dois
arquivos: ele cita "painel da Vercel", e essa frase precisa envelhecer junto
com o resto.

## 6. A ordem: expande → migra → contrai

A mesma do Ciclo 2a, pelo mesmo motivo, e aqui com uma consequência dura: **a
fila nova nasce e funciona antes de a Vercel sair.** Apagar `fila/vercel.ts`
antes de existir substituto deixa o WhatsApp mudo — e, como cada tarefa é
executada por um subagente que só vê a própria, o subagente seguinte herdaria
uma árvore quebrada sem saber por quê.

**A migração é um passo só, e isso é deliberado.** O publicador
(`fila/index.ts`) e o consumidor (a rota) são as duas pontas da MESMA costura:
trocar uma sem a outra deixa jobs indo para um lugar que ninguém lê. Elas
viram numa tarefa.

## 7. O que este ciclo prova, e onde

| | Prova | Onde |
| --- | --- | --- |
| P1 | `TurnoJob` está em `MODELOS_DE_TENANT` e a lista tem **14** | `tests/unit/escopo-empresa.test.ts` |
| P2 | A trava de deriva continua batendo schema × Set | idem (caso já existente) |
| P3 | A tabela nova nasce com RLS ligada e sem grant para `anon`/`authenticated` | `tests/e2e/banco-blindado.spec.ts` (sem lista fixa) |
| P4 | A migração não cria `NOT NULL` sem `DEFAULT` em tabela viva | `tests/unit/migracoes-seguras.test.ts`, `PERDOADAS` continua com **2** |
| P5 | Publicar duas vezes a mesma chave deixa **uma** linha | `tests/unit/fila-postgres.test.ts` |
| P6 | Reivindicações concorrentes nunca devolvem o mesmo `id` | idem, `Promise.all` contra o Postgres real |
| P7 | Job com `disponivelEm` no futuro não é reivindicado | idem |
| P8 | Job com lease vivo não é reivindicado; com lease expirado, é | idem |
| P9 | `concluirJob` com token errado não apaga (fencing) | idem |
| P10 | `falharJob` reagenda até o teto e então marca `mortoEm` | idem |
| P11 | Job morto nunca é reivindicado de novo, e a poda o remove por idade | idem |
| P12 | O módulo tem **um** `$queryRaw`, e o `RETURNING` dele traz `companyId` | idem (varredura do próprio texto) |
| P13 | `TEMPO_MAX_TURNO_MS < LEASE_DURACAO_MS < JOB_LEASE_MS` | `tests/unit/fila-consumidor.test.ts` |
| P14 | `drenarFila` conclui o job em sucesso e falha o job em exceção | idem |
| P15 | `processarTurno` que passa do teto vira falha, não pendura o laço | idem (relógio falso) |
| P16 | Segredo certo passa; errado, curto e longo são recusados igual | `tests/unit/fila-segredo.test.ts` |
| P17 | Sem cabeçalho, ou com segredo errado, a rota responde **404** | `tests/unit/fila-tick-route.test.ts` |
| P18 | A rota não chama `drenarFila` antes de autenticar | idem |
| P19 | Sem `IP_CABECALHO_CONFIAVEL`, nenhum cabeçalho vira IP | `tests/unit/auditoria-login.test.ts` |
| P20 | Com ela definida, só o cabeçalho nomeado é lido | idem |
| P21 | IP desconhecido pula a dimensão de IP e mantém a de conta | `tests/unit/login-seguranca.test.ts` |
| P22 | Webhook com IP desconhecido usa a chave por empresa | `tests/unit/whatsapp-webhook-route.test.ts` |
| P23 | Nenhum arquivo de `src/` ou `tests/` importa `@vercel/queue` | varredura na tarefa de contração |
| P24 | A catraca do prisma cru continua com **0** temporários | `tests/unit/catraca-prisma-cru.test.ts` |
| P25 | A exceção permanente nova existe, é literal e o arquivo importa mesmo o prisma cru | idem |

### 7.1 O que este ciclo NÃO consegue provar, e por quê

- **Que o endpoint de tick está inacessível/acessível na internet.** Depende
  de onde o app rodar, e não há deploy. `curl` contra a origem real, por um
  humano, depois da escolha.
- **Que `pg_cron` deste projeto agenda abaixo de um minuto.** Exige o painel
  do Supabase.
- **Que dois processos de worker simultâneos se comportam.** A correção está
  provada no nível da reivindicação (P6, com conexões concorrentes de
  verdade), mas subir dois processos Node e medi-los está fora do que a suíte
  faz.
- **A latência ponta a ponta.** Depende da cadência do gatilho, que só existe
  depois da escolha da hospedagem.

## 8. O que muda nos documentos — e o que NÃO muda

**Documento de auditoria é registro histórico.** `docs/auditorias/*` diz o que
era verdade na data dele. Falsificá-lo é pior que deixá-lo desatualizado — e
os **8** arquivos de lá que citam a Vercel **não são tocados**. O mesmo vale
para specs e planos de ciclos **já executados**: **10 planos e 8 specs**, dos
quais **17 ficam intocados** e **1** (o spec fundador) recebe apenas o adendo
da §8.1. Os 27 documentos medidos na §2 são estes 26 mais o `docs/ESTADO.md`,
que é o único vivo entre eles.

Muda o que está **vivo**:

| Arquivo | O que muda |
| --- | --- |
| `CLAUDE.md`, decisão 6 | Reescrita: a decisão foi **reaberta em 2026-08-21** e substituída. Diz o que passou a valer, aponta para este spec, e mantém o histórico ("era Vercel até…"), porque decisão travada sem histórico é decisão que alguém reabre de novo sem saber que já foi discutida. |
| `docs/ESTADO.md` | O bloco "Na Vercel" da lista do dono, e um item novo: **a fila não drena sozinha**. |
| `.env.example` | `WHATSAPP_QUEUE_SECRET` (papel novo), `IP_CABECALHO_CONFIAVEL` (nova), e o bloco do `SENTRY_ENVIRONMENT`, que hoje diz "só para deploy fora da Vercel". |
| `docs/superpowers/specs/2026-08-19-n8necrm-fundacao-design.md` | **Um adendo datado** sob a decisão 6 — não uma reescrita. Ver §8.1. |

### 8.1 Por que o spec fundador recebe adendo em vez de nada

A regra é não reescrever spec de ciclo executado, e ela não é afrouxada aqui:
**nenhuma palavra do texto original muda**. O que entra é um bloco marcado
`> **Adendo de 2026-08-21**` dizendo que a decisão 6 foi reaberta e apontando
para este documento. O motivo é assimétrico: um leitor que encontra a decisão
6 original e não descobre que ela foi revertida vai agir com base nela — que é
exatamente o dano que a proibição de reescrever tenta evitar, só que pelo
outro lado.

### 8.2 Quais ciclos dependiam da decisão 6, e o que acontece com eles

O `CLAUDE.md` avisa que reabrir decisão travada **invalida os ciclos que
dependem dela**. Foram procurados um a um. Nenhum precisa ser refeito; três
mudam de estado:

| Ciclo / peça | Dependia como | O que acontece |
| --- | --- | --- |
| **Ciclo 0** — fila como adaptador | Foi construído **para** este dia: a §4 do spec fundador diz que trocar para pg-boss/BullMQ vira "escrever um segundo adaptador". | **Vindicado, não invalidado.** Este ciclo é o teste daquela costura, e ela passou: os três importadores de `publicarTurno` não mudam. |
| **Ciclo 4** — n8n em iframe | `frame-ancestors` precisa da origem pública do CRM, que o spec fundador diz que "depende do domínio que o projeto na Vercel receber". | **Continua bloqueado, com outro dono.** A origem passa a depender da hospedagem escolhida. Nada a refazer; o item permanece na lista do dono. |
| **Ciclo 1b** — JWT do Supabase | `SUPABASE_JWT_ISSUER` é a origem pública do deploy. | **Mesmo efeito.** O valor é configuração, não código; troca no dia da escolha. |
| **Ciclo 3** — Realtime | Não depende de hospedagem: é Supabase ↔ navegador. | **Intacto.** |
| **Ciclos 1a / 1c / 1e / 1f / 2a** | Banco e tenancy, sem plataforma no caminho. | **Intactos.** |
| Poda probabilística (`limiter.ts`, `dispatch.ts`) | Justificada por "cron exigiria configuração no painel da Vercel". | **Decisão mantida, comentário atualizado** — §5.8. |
| `maxDuration = 60` | Era o teto da plataforma. | **Substituído por `TEMPO_MAX_TURNO_MS`** — §5.3. Esta é a única dependência que, deixada como está, produziria defeito. |
| Sentry `VERCEL_ENV` | Rótulo de ambiente. | Cai para `SENTRY_ENVIRONMENT` e depois `"local"`. O ramo já existe. |

## 9. Ações do dono

**Nenhuma tarefa do plano fica bloqueada por ação do dono.** Tudo é
verificável em desenvolvimento local. As ações abaixo são de **implantação**.

1. **Escolher a hospedagem.** Nada neste ciclo depende disso, e tudo abaixo
   depende disso.
2. **Ligar um gatilho de drenagem.** Sem isto a fila enche e ninguém
   responde. Uma das formas:
   - **Node sempre ligado (recomendado):** `npm run fila:worker` como serviço
     (systemd, PM2, container). Menor latência, nenhuma porta exposta.
   - **`pg_cron` + `pg_net` no Supabase:** agendar um `POST` para
     `<origem>/api/queues/whatsapp-turn` com o cabeçalho `x-fila-segredo`.
     🔍 **NÃO VERIFICADO:** se este projeto tem as duas extensões e se aceita
     agendamento abaixo de um minuto. Comando:
     `select extname from pg_extension where extname in ('pg_cron','pg_net');`
   - **`cron` de VPS:**
     `curl -fsS -X POST -H "x-fila-segredo: $SEGREDO" <origem>/api/queues/whatsapp-turn`
3. **Definir `IP_CABECALHO_CONFIAVEL`** com o nome do cabeçalho que a borda
   escolhida **sobrescreve**. Até lá não há rate limit por IP no login, não há
   `AuditLog.ip`, e o balde do webhook é por empresa (§5.7).
4. **Definir `SENTRY_ENVIRONMENT`** no deploy, se usar Sentry: `VERCEL_ENV`
   não existirá mais e o rótulo cai para `"local"`.
5. **Definir `SUPABASE_JWT_ISSUER`** com a origem pública real (Ciclo 1b).
6. **Conferir o dimensionamento do pooler.** `DATABASE_URL` na 6543 e
   `DIRECT_URL` na 5432 continuam valendo. O worker é mais um consumidor de
   conexões; num host de processo único isso é pequeno, mas é medição que só
   existe depois de haver host.
7. **Apagar o projeto da Vercel**, se existir, e as variáveis que estiverem
   lá — apikey esquecida em painel é credencial viva sem dono.

## 10. O que este ciclo NÃO faz

- **Não escolhe hospedagem.** É a decisão do dono, e o ponto do ciclo é ela
  não travar nada.
- **Não cria Dockerfile, systemd unit, nginx.conf ou CI.** Todos dependem do
  host escolhido, e escrever para um host hipotético é escrever para o
  errado.
- **Não faz fila genérica.** `TurnoJob` é a fila de turnos de WhatsApp. Uma
  abstração de "job de qualquer tipo" com um consumidor só é abstração
  inventada — quando existir o segundo tipo, ela terá dois exemplos para
  aprender.
- **Não mexe em RLS nem cria política nenhuma.** A tabela nasce default-deny.
  A exceção NOMEADA do Realtime continua sendo do Ciclo 3.
- **Não mexe em `docs/auditorias/*`** nem em spec/plano de ciclo executado.
- **Não faz push, PR, merge nem deploy.** O `AGENTS.md` exige a Fase 1 da
  auditoria de segurança antes de integrar, e ela é o passo seguinte a este
  plano.

## 11. Riscos e dívidas declaradas

| | Risco | Contenção |
| --- | --- | --- |
| R1 | **Ninguém liga o gatilho e o WhatsApp fica mudo em silêncio.** | Dito em três lugares (`.env.example`, `ESTADO.md`, §9). A fila acumula sem perder nada: ligar o worker depois drena tudo. |
| R2 | **Cron de baixa frequência degrada a resposta ao cliente.** | §5.4 dá o número (até ~68s com cron de 1 min) e recomenda o worker. |
| R3 | **A exceção permanente do prisma cru cresce para 6, e a primeira fora de `src/core/`.** | Motivo escrito na mesma voz das outras cinco, um `$queryRaw` só no arquivo, e P12 travando a forma dele. |
| R4 | **Sem `IP_CABECALHO_CONFIAVEL`, some o limite por IP no login e o `AuditLog.ip`.** | §5.7. Uma linha de ambiente reverte; a dimensão por conta segura o caso dirigido. |
| R5 | **Job envenenado morre calado.** | `mortoEm` + `ultimoErro` ficam 7 dias, e a morte é registrada com `console.error` nomeando conversa e empresa. |
| R6 | **Dois workers em máquinas diferentes.** | Correto por construção (P6), mas não medido com dois processos. 🔍 NÃO VERIFICADO. |
| R7 | **O tick é síncrono: uma chamada segura até `LOTE_MAX × 60s`.** | `LOTE_MAX = 10` e o teto por turno limitam o pior caso absoluto; o caso real é milissegundos por job vazio. Quem usar HTTP deve ter timeout de cliente maior que o tick, ou usar o worker. |
| R8 | **A dedupe deixa de valer depois da conclusão do job.** | §5.6: o caminho está fechado por `processadoEm`, com caso de teste. |

## 12. Critérios de aceite

1. `npm run typecheck` limpo.
2. `npm run lint` sem erro novo.
3. `npm run build` verde.
4. `npx vitest run tests/unit` verde, com os arquivos novos, e **nenhum caso
   removido** dos existentes sem substituto nomeado.
5. `npm run test:e2e` verde, incluindo `banco-blindado.spec.ts` com a tabela
   nova.
6. `grep -rn "@vercel/queue" src/ tests/` → **zero**.
7. `grep -rni "vercel" src/ config/` → só ocorrências que sejam **história
   datada**, nomeadas uma a uma no relatório.
8. `vercel.json` não existe; `@vercel/queue` não está em `package.json`.
9. A catraca do prisma cru verde, com `EXCECAO_PERMANENTE` em 6 e temporários
   em 0.
10. Uma mensagem de WhatsApp simulada percorre webhook → `TurnoJob` →
    `drenarFila` → resposta, sem a Vercel em lugar nenhum do caminho.
