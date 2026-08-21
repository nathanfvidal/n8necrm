# Auditoria de segurança — Ciclo 2a (cofre de credenciais e conexões da Evolution)

**Data:** 2026-08-20
**Escopo:** os 11 commits do Ciclo 2a na branch `ciclo-1a-tenancy`, `049df2d..c7e0486` — a tabela
`WhatsappConnection` (13º modelo de tenant), o cofre `aes-256-gcm` com AAD e rotação por lista de
chaves, os dois padrões novos de redação do Sentry, a permissão `gerenciar_conexoes`, o serviço
escopado de conexões, a fábrica de gateway por conexão, a rota de webhook que resolve a empresa pela
CONEXÃO, o envio saindo pela conexão da conversa, a aba `/configuracoes/conexoes` e a morte das
quatro variáveis `EVOLUTION_*`.
**Ambiente:** leitura de código e histórico local, execução dos quatro portões e da suíte Playwright
nesta árvore, e consulta ao Postgres real do Supabase (projeto `uzumzfxjcxrbxaucvfsr`) pela MCP.
**Escritas ao banco:** esta auditoria **não apagou, criou nem alterou nenhuma linha por conta
própria**. O que escreveu foi consequência dos testes que ela mandou rodar — `npm test`, que roda o
seed e **reescreve o `senhaHash` de `admin@exemplo.com` e `vendedor@exemplo.com`** (⚠️ R1 / 🔍 NV6),
e a suíte Playwright, cujas fixtures criam e apagam as próprias linhas. O estado final está medido em
**Sonda final ao banco**.

## Resumo

**❌ Críticas em aberto: 0 · ⚠️ Riscos e dívidas: 22 (3 medidos aqui, 7 declarados pelo spec, 7
medidos pelas tarefas do ciclo, 5 herdados do Ciclo 1a — R2 e R3 **pioraram**) · ✅ Verificados: 26 ·
🔍 Não verificados: 6 · ❌ Herdados de infraestrutura, não corrigidos aqui: 5**

O ciclo faz o que se propôs. A apikey da Evolution deixou de ser uma variável de ambiente por deploy
e passou a ser uma coluna cifrada por empresa; a tabela nova nasceu com RLS ligada, zero políticas e
zero grants para `anon`/`authenticated`, confirmado sem lista fixa pelo e2e `banco-blindado` e pelo
advisor do Supabase, que subiu de 16 para **17** `rls_enabled_no_policy` exatamente como o critério
de aceite previu. A catraca do Prisma cru continua em **zero** e `eslint.config.mjs` não ganhou
exceção nenhuma — o diff dos dois arquivos no intervalo do ciclo é **vazio**.

**Um relatório que parasse aqui seria falso pelo que omite.** O ciclo mexeu na porta de entrada do
sistema, e mexer nela mudou o alcance de defeitos que já existiam:

- **`Conversation.waId` `@unique` GLOBAL deixou de ser teórica.** Enquanto `EVOLUTION_COMPANY_ID`
  amarrava o deploy a uma empresa, a segunda empresa era inalcançável e a colisão era hipótese. Agora
  o mesmo número atendido por duas empresas colide em `P2002`, a rota devolve 500 e **a Evolution
  reentrega para sempre**. Não foi tocada de propósito (o dono travou isso); o que mudou foi o
  alcance, e isso precisa estar escrito.
- **Conversas anteriores ao ciclo têm `connectionId` nulo, e não houve backfill.** Elas respondem
  pela única conexão ativa da empresa e **param de ser respondidas** com `ConexaoAmbiguaError` no dia
  em que a empresa cadastrar a segunda. É recusa alta, não vazamento — mas é migração de dados
  pendente. **Neste banco a contagem é zero**, porque `Conversation` está vazia (sonda final): a
  dívida é do desenho e o código dela está exercitado, mas aqui não há linha para migrar. Em produção
  o número pode ser outro, e a consulta que o mede está na sonda.
- **`credencialDaConexao` não filtrava `ativa`.** Desativar uma conexão calava a ENTRADA e deixava a
  SAÍDA falando — a família *"sessão que sobrevive"* que o `AGENTS.md` registra. Achado pela Task 6,
  não corrigido lá (é contrato de outra tarefa), corrigido na Task 7 por decisão do dono.
- **O cofre tem dois limites declarados**, e nenhum dos dois é um detalhe: a AAD não separa duas
  conexões da MESMA empresa e mesmo propósito, e a chave vive no ambiente do processo que decifra.
- **A vizinhança que o cofre não alcança continua aberta.** A chave global da Evolution é
  `nateksoft`. Cifrar bem a apikey da instância dentro do CRM enquanto isso é verdade é **meia
  defesa**.
- **Nada foi exercitado contra uma instância Evolution real.** O ponta a ponta deste ciclo é mock, e
  o banco de desenvolvimento tem **zero** conexões cadastradas.

---

## Como a verificação foi feita

Toda linha marcada `✅ OK` abaixo carrega o comando e a saída. O que este ambiente não provou está em
`🔍 Não verificados`, com o comando que um humano precisa rodar — nunca como "ok" presumido. A
revisão final do Ciclo 4 pegou uma auditoria afirmando um gate que o código não tinha; a regra existe
por causa disso.

Quatro restrições de método valem registro:

- **Nada de `vitest` em paralelo.** O banco de teste **não é separado** do de desenvolvimento
  (⚠️ R1 do Ciclo 1a). Todas as execuções citadas aqui foram em série, sozinhas.
- **`npm test` foi executado, e reescreveu as duas senhas.** A alternativa oferecida
  (`npx vitest run tests/unit`) **não é uma alternativa**: `vitest.config.ts:21` tem
  `include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"]`, e `package.json` define
  `"test": "vitest run"`. Os dois comandos rodam **exatamente o mesmo conjunto de arquivos**, seed
  incluído. Escolher o menor mudaria o rótulo no relatório, não o efeito no banco — foi o que a
  auditoria do Ciclo 1c já havia medido, e a medição se confirma aqui pela configuração. **Rotacionar
  as duas senhas é ação do dono** (🔍 NV6).
- **`grep` desta sessão não é confiável para padrões com aspas nem para heredoc com barra invertida.**
  Um `node -e` com `\\s` no argumento chegou ao Node como `s`, e um heredoc `<<'EOF'` teve as barras
  comidas antes de virar arquivo. Todas as contagens deste documento usam `/usr/bin/grep` ou um
  parser em Node escrito com a ferramenta de escrita de arquivo, nunca colado pela linha de comando.
- **Nenhum segredo, chave, token ou blob real aparece neste documento.** Onde havia valor, há
  contagem, tamanho ou máscara.

---

## 1. O que o ciclo mudou na superfície de segurança

```bash
$ git log --oneline 049df2d^..HEAD
c7e0486 refactor(gateway): as quatro EVOLUTION_* morrem, e a varredura impede a volta
64f235e feat(configuracoes): a aba onde a credencial e cadastrada, e nunca lida
f09ca18 feat(whatsapp): a resposta sai pela conexao por onde a mensagem entrou
6349479 feat(webhook): a empresa sai da conexao, e EVOLUTION_COMPANY_ID morre
e39e32e feat(gateway): fabrica por conexao, ao lado do singleton que ainda vive
469a464 feat(conexoes): CRUD escopado que cifra ao gravar e nunca devolve o segredo
020052b feat(auth): gerenciar_conexoes, de ADMIN, separada das tres vizinhas
02d6912 fix(sentry): fecha os tres caminhos por onde credencial chegaria ao Sentry
4a8d6ce feat(cofre): cifra autenticada para o que nao pode sair em texto num dump
2c6a5da feat(conexoes): abre lugar para a credencial da Evolution viver por empresa
049df2d docs(ciclo-2a): desenha o cofre de credenciais e o plano que mata EVOLUTION_*

$ git diff --stat 049df2d^..HEAD | tail -1
 59 files changed, 12919 insertions(+), 543 deletions(-)
```

A ordem dos commits é o desenho, não acidente: **expande → migra → contrai**. `e39e32e` põe a fábrica
ao lado do singleton sem apagá-lo; `6349479` e `f09ca18` movem os dois consumidores; `64f235e` entrega
a tela **antes** de `c7e0486` apagar as variáveis. A inversão (apagar antes da tela) deixaria o
sistema num estado em que cadastrar uma conexão exigiria SQL à mão.

Dez arquivos de teste nasceram no ciclo:

```bash
$ git diff --stat 049df2d^..c7e0486 --diff-filter=A --name-only | /usr/bin/grep -E "^tests/"
tests/e2e/configuracoes-conexoes.spec.ts
tests/unit/cofre-chave.test.ts
tests/unit/cofre-segredo.test.ts
tests/unit/conexoes-actions.test.ts
tests/unit/conexoes-auditoria.test.ts
tests/unit/conexoes-isolamento.test.ts
tests/unit/conexoes-service.test.ts
tests/unit/configuracoes-pages-gate.test.tsx
tests/unit/whatsapp-envio-por-conexao.test.ts
tests/unit/whatsapp-gateway-fabrica.test.ts
```

---

## 2. O cofre: o que ele compra, e os dois limites que ele NÃO cobre

A §4.1 do spec nomeia três caminhos que entregam a coluna em texto puro a quem não deveria vê-la, e
diz por que a cifra é a única defesa que sobrevive aos três: `pg_dump` e backup automático do
Supabase; vazamento da `SUPABASE_SERVICE_ROLE_KEY`; e qualquer consulta pelo caminho do Prisma, que
conecta como **dono da tabela** e ignora RLS. `FORCE ROW LEVEL SECURITY` continua desligada de
propósito, e este ciclo não a liga.

O formato é `v1.<8 hex do keyId>.<b64url iv>.<b64url ciphertext>.<b64url tag>`, e a AAD é
`v1|<keyId>|<companyId>|<proposito>` (`src/core/cofre/segredo.ts:38`).

**Os dois limites estão escritos no próprio código, não só aqui** — e é isso que os torna
verificáveis por quem ler o arquivo:

```
src/core/cofre/segredo.ts:36  * ## O que a AAD prende, e o que ela NÃO prende
src/core/cofre/segredo.ts:44  * do mesmo propósito. Isso passa. Cobrir exigiria pôr o `id` da linha na AAD,
```

1. **A AAD não separa duas conexões da MESMA empresa e do MESMO propósito.** Trocar o blob de uma
   pela outra passa pela decifragem. Fechar isso exige o `id` da linha dentro da AAD, e o `id` não
   existe antes do `create` do Prisma. É a **⚠️ D2** do spec, e é decisão registrada, não descuido.
2. **A chave mestra vive no ambiente do processo que decifra.** Quem executa código no servidor lê as
   duas coisas. O que a cifra compra são os três caminhos da tabela acima — dump, backup e
   `service_role` —, **não** execução de código no servidor. Nenhuma frase deste documento, do spec
   ou do `chave.ts` afirma o contrário.

Um terceiro trade, menor e igualmente declarado: **a máscara guarda os últimos 4 caracteres em texto
puro** (⚠️ D3 do spec). É entropia revelada, escolhida para que a lista de conexões não precise
decifrar a cada renderização — o mesmo trade que `sk_live_…abcd` faz.

A rotação é por lista: a primeira chave da lista é a ativa, o `keyId` é derivado da chave (não
digitado), e um blob cifrado com a chave antiga continua abrindo depois de a nova entrar na frente.
Chave retirada da lista lança `CofreChaveDesconhecidaError`, **distinta** de `CofreDecifragemError`
— a distinção é o que diz a quem opera que há conserto. Os dez casos de `cofre-chave.test.ts` e os 14
de `cofre-segredo.test.ts` amarram isso, incluindo o caso que afirma que **nenhuma mensagem de erro
carrega material de chave**.

---

## 3. O segredo não volta para o navegador — e a exceção é nomeada

`src/core/conexoes/service.ts` **não importa `decifrar`**:

```bash
$ /usr/bin/grep -c "decifrar" src/core/conexoes/service.ts
0
```

`listarConexoes` monta a máscara a partir de `segredoUltimos4`, uma coluna própria em texto puro
gravada no momento em que o segredo entra. O tipo devolvido é fechado:

```
src/core/conexoes/service.ts:51-62  ConexaoApresentada = { id, canal, nome, ativa, dominio,
                                    instancia, mascara, segredoAtualizadoEm, segredoAtualizadoPor }
```

E o caso de teste correspondente afirma sobre o objeto **inteiro serializado**, nas duas metades: uma
lista FECHADA de chaves permitidas (`Object.keys(...).sort()` contra `toEqual`) e uma varredura de
conteúdo por apikey e por prefixo de blob. A lista fechada é mais forte que a varredura por
substring que o briefing da Task 5 pedia — aquela reprovava `segredoAtualizadoEm` e
`segredoAtualizadoPor`, que são uma data e um nome de pessoa, e não cobria o caso que importa: um
campo NOVO entrando no tipo sem ninguém decidir.

**A exceção nomeada é o token do webhook**, devolvido **uma vez** pela ação que o criou. Ela não é
decifragem: o servidor acabou de sortear 32 bytes e guardou só o `sha256` deles
(`WhatsappConnection.webhookTokenHash`). O e2e afirma as duas metades — o token aparece na criação e
**não volta** depois do `reload`.

A auditoria não recebe instantâneo: `auditar()` é privada em `service.ts` e **não aceita**
`antes`/`depois`. Quem quisesse gravar o segredo teria de mudar a assinatura, e isso aparece na
revisão. `conexoes-auditoria.test.ts` percorre as seis ações e afirma a ausência das duas chaves em
cada uma.

---

## 4. A resolução do webhook: o `companyId` do path é hipótese, o token é autoridade

A rota nasceu com um segmento a mais — `/api/whatsapp/evolution/[companyId]/[token]` — e o desenho
está escrito nela:

```
route.ts:20  * O `companyId` é **hipótese, não autoridade** — ele só escolhe ONDE procurar.
route.ts:24  * - `companyId` de B + token de A -> a busca escopada em B não acha o hash de
route.ts:45  * `conexao.companyId`, NUNCA o `companyId` do path por si só.
```

Quem decide é o token, porque `resolverConexaoPorWebhook(companyId, token)` busca **escopada** naquela
empresa, por `webhookTokenHash` e com `ativa: true` no filtro. Token de A com `companyId` de B não
acha nada, e a resposta é **indistinguível** da de token inexistente — mesmo status, mesmo corpo,
mesmos cabeçalhos. Diferença aqui viraria oráculo.

A ordem das camadas é rate limit por IP → corpo → resolução da conexão → `verificarOrigem`, e tem
caso próprio. O rate limit fica na frente porque resolver a conexão é uma ida ao banco.

Isto é o que fecha o ⚠️ R5 do Ciclo 1a: `EVOLUTION_COMPANY_ID` não é lida em lugar nenhum de `src/`.

```bash
$ /usr/bin/grep -rn "process.env.EVOLUTION_\|process.env\[.EVOLUTION" src/ | wc -l
0
$ /usr/bin/grep -rn "EVOLUTION_" src/ | wc -l
13
```

As 13 ocorrências restantes são **linhas de comentário**, em sete arquivos que contam de onde a
credencial veio e por que saiu. Apagá-las seria o oposto do que o ⚠️ R5 pediu: o defeito é a variável
ser **lida**, não a história dela ser contada. A guarda que impede a volta é uma varredura de fonte
em `whatsapp-config-preguicosa.test.ts` que reprova **leitura de `process.env`** e absolve
comentário — e num ponto ela é mais apertada que um `grep`: pega
`process.env["EVOLUTION_INSTANCE"]` e destructuring.

---

## 5. A contração, e o que ela deixou para trás

`.env.example` não declara mais nenhuma das cinco variáveis:

```bash
$ /usr/bin/grep -cE "^(EVOLUTION_|WHATSAPP_WEBHOOK_TOKEN)" .env.example
0
```

O `next build` e a suíte unitária inteira passam com elas **ausentes do ambiente**, medido na Task 10
e confirmado aqui pelos portões desta auditoria. Essa é a prova de que a contração é segura.

**A remoção das mesmas variáveis do painel da Vercel é ação do dono**, e não é cosmética: uma
`EVOLUTION_APIKEY` esquecida lá é credencial viva sem dono no código.

---

## 6. O que ficou PIOR por consequência: `Conversation.waId` global-única

Esta é a seção que impede este documento de ser um relatório de sucesso.

`Conversation.waId` é `@unique` **global** (`prisma/schema.prisma:440`), não
`@@unique([companyId, waId])`. É uma das quatro unicidades globais do ⚠️ R2 do Ciclo 1a, e o Ciclo
2a **não a tocou** — o spec diz isso por escrito na §9, e a decisão é do dono.

O que mudou não foi a dívida. Foi o **alcance** dela. E a mudança é consequência direta do que este
ciclo entrega:

```
src/modules/whatsapp/ingest.ts:117-123
// O QUE MUDOU NO CICLO 2a: até aqui, `EVOLUTION_COMPANY_ID` (uma
// instância por deploy) tornava a segunda empresa INALCANÇÁVEL, e o
// defeito era teórico. Agora duas empresas podem ter conexões, e o mesmo
// número atendido pelas duas colide em `P2002` → 500 → a Evolution
// reentrega para sempre.
```

**Por que "para sempre" e não "o retry acerta":** o `catch` de `P2002` (`ingest.ts:190-213`) trata
duas colisões diferentes. Para `WhatsappMessage.idExterno` ele acha a mensagem já gravada e devolve
`duplicada: true`. Para `Conversation.waId` **não há mensagem gravada** — a busca por `idExterno`
volta vazia, o erro sobe, a rota devolve 500 e a Evolution reentrega. O comentário do próprio
`catch` diz que "o retry acerta, porque na segunda vez o `findFirst` encontra a conversa", e isso é
verdade para a corrida **dentro da mesma empresa**. Não é verdade entre empresas: o `findFirst` da
linha 124 é **escopado**, então ele nunca encontrará a conversa da outra empresa, e o `create`
colidirá de novo. O laço não tem saída por si.

**Gravidade prática hoje:** nula, porque o banco tem uma empresa e zero conexões (sonda final). A
gravidade vira real no dia em que a segunda empresa cadastrar uma conexão e um mesmo número falar
com as duas.

**Não foi contornado de propósito** — o desenho manda reportar antes de corrigir, e a correção é
mudança de schema com migração de dados. O que este ciclo fez foi dar **nome ao sintoma** dentro do
arquivo onde ele acontece, para que ninguém gaste um dia diagnosticando um 500 em laço.

---

## 7. Dívida nova: conversas com `connectionId` nulo, e nenhum backfill

`Conversation.connectionId` nasceu **nullable, sem `DEFAULT` e sem backfill**:

```
prisma/migrations/20260820210000_cofre_conexoes_whatsapp/migration.sql:60
ALTER TABLE "Conversation" ADD COLUMN "connectionId" TEXT;
```

Nullable é o certo, e a Task 1 registrou por quê nas duas direções: escolher uma conexão para
conversas que nasceram antes de existir conexão nenhuma seria chute com aparência de dado; e
`NOT NULL` numa tabela viva derrubaria toda ingestão com `23502` durante a janela de deploy.

A consequência é o caminho de reserva em `credencialAtivaUnica` (`src/core/conexoes/leitura.ts:221`),
e ele tem **duas** saídas nomeadas e diferentes:

- nenhuma conexão ativa → `ConexaoNaoConfiguradaError`;
- **mais de uma** conexão ativa → `ConexaoAmbiguaError`, com o `conversationId` e as duas saídas
  possíveis escritas na mensagem.

Ou seja: **hoje nada quebra**, porque nenhuma empresa tem mais de uma conexão. No dia em que uma
empresa cadastrar a segunda, **toda conversa anterior ao Ciclo 2a para de ser respondida** — recusa
alta e nomeada, nunca resposta pelo número errado. Isso está medido ao vivo, não presumido:
`tests/unit/whatsapp-envio-por-conexao.test.ts` monta uma fixture com **duas** conexões ativas e uma
desativada, e exercita as duas metades (`connectionId` nulo com uma ativa → responde normalmente;
`connectionId` nulo com duas ativas → `ConexaoAmbiguaError` e **`fetch` não chamado**).

**É migração de dados pendente.** A contagem neste banco, medida na sonda final **depois** de toda a
suíte, é:

```
Conversation: 0  (com connectionId: 0 · sem connectionId: 0)
```

Ou seja: **zero linhas afetadas hoje**. O briefing desta tarefa previa `sem_connection_id > 0` e
errou — a tabela `Conversation` está vazia neste ambiente. Isso não desfaz a dívida (o caminho de
reserva existe, está exercitado com duas conexões ativas, e morde em qualquer base com conversas),
mas muda o que o dono precisa decidir **aqui**: não há o que migrar neste banco. Em produção o número
pode ser outro, e a consulta é a mesma.

---

## 8. O achado da Task 6, e a decisão que o fechou na Task 7

`credencialDaConexao(companyId, connectionId)` **não filtrava `ativa`**, ao contrário das duas
leituras vizinhas (`resolverConexaoPorWebhook` e `credencialAtivaUnica`, que filtram). O efeito era
a metade pior de "desativado": o operador desligava a conexão na tela, a **entrada** parava, e a
**saída** continuava — uma conversa com `connectionId` preenchido seguia respondendo por um número
que o operador tinha desligado.

A Task 6 achou e **não corrigiu**, com motivo escrito: é contrato da Task 5, com testes próprios, e
mudá-lo por conta própria seria alterar o trabalho de outra tarefa. Levantou a pergunta ao dono —
*desativar deve calar só a entrada, ou também a saída?* — e a Task 7 aplicou a resposta: **os dois
sentidos**, pelo padrão *"sessão que sobrevive"* que o `AGENTS.md` registra.

A implementação é deliberada em dois pontos, e os dois estão comentados no arquivo:

```
src/core/conexoes/leitura.ts:167-171
 * O filtro fica FORA do `where` porque `where: { ativa: true }` devolveria
 * `null` para a linha desligada, e `null` aqui vira "não existe" — exatamente a
 * confusão que `ConexaoDesativadaError` existe para desfazer.
```

`ConexaoDesativadaError` é classe própria, **distinta** de `ConexaoNaoConfiguradaError`, com caso de
teste afirmando que uma não é a outra nos dois sentidos. A mensagem diz `DESATIVADA` e aponta
`Configurações → Conexões` — a linha existe e está desligada, não sumiu.

Vale registrar o que este achado diz sobre o processo: ele veio de uma tarefa **lendo o trabalho da
anterior**, não de um teste. Nenhum caso do Ciclo 2a teria ficado vermelho por causa dele.

---

## 9. Detalhes que não viram manchete e mudam comportamento

### 9.1 `@@unique([companyId, canal, instancia])` não impede duas linhas com `instancia` NULA

No Postgres, `NULL` é distinto de `NULL` num índice único. Duas linhas
`(empresa X, META_CLOUD, NULL)` convivem sem violar a constraint
(`prisma/migrations/20260820210000_cofre_conexoes_whatsapp/migration.sql:48`).

Hoje isso não morde: `validarCampos` exige instância não vazia para `EVOLUTION`, o único canal
aceito. Quando o Ciclo 2b abrir `META_CLOUD` — que não tem instância —, a constraint **deixa de
proteger**, e "uma conexão Meta por empresa" precisará de índice parcial próprio. Registrado agora
para não ser descoberto lá.

### 9.2 `ACOES_SENSIVEIS` cresceu de 10 para 14, e `LIMITE_ALERTA` não mudou

Medido por parser em Node sobre o fonte:

```
ACOES_SENSIVEIS: 14
excluir_task, excluir_nota, arquivar_lead, desativar_usuario, redefinir_senha,
excluir_etapa, exportar_leads, desativar_fluxo, apagar_fluxo, reexecutar_execucao,
substituir_segredo_conexao, desativar_conexao, apagar_conexao, regenerar_webhook_conexao

src/core/audit/alerta.ts:116  export const LIMITE_ALERTA = 10;
src/core/audit/alerta.ts:118  export const JANELA_ALERTA_MS = 5 * 60_000;
```

O limiar é **10 ações sensíveis em 5 minutos**, contadas **juntas** (`alerta.ts:179-182`), e foi
calibrado para o conjunto antigo. Quatro ações novas num conjunto contado junto tornam o gatilho
**mais sensível** sem que ninguém tenha decidido isso. O comentário do arquivo diz que errar para o
lado sensível é barato, e é razoável — mas a mudança de calibragem foi efeito colateral, não escolha,
e é isso que fica registrado.

Nenhum teste afirma o tamanho da lista, então acrescentar entradas não quebrou nada. Isso é
conveniente e também significa que **não há trava** avisando quando o conjunto crescer de novo.

### 9.3 `atualizarConexaoAction` existe, é testada e não tem botão

```bash
$ /usr/bin/grep -rn "atualizarConexaoAction" src/ tests/
src/core/conexoes/actions.ts:141:export async function atualizarConexaoAction(entrada: {
tests/unit/conexoes-actions.test.ts:63, 116, 196
tests/unit/configuracoes-pages-gate.test.tsx:60
```

Nenhum componente a chama. Consequência operacional: **renomear uma conexão hoje exige apagar e
recadastrar**, e recadastrar sorteia um `webhookToken` novo — ou seja, obriga a recolar a URL no
painel da Evolution. É lacuna de UI, não de servidor, mas o custo dela cai sobre quem opera.

### 9.4 `lib/env.ts` é o último ponto do repositório com validação em escopo de módulo

```
src/lib/env.ts:3  const envSchema = z.object({
src/lib/env.ts:8  export const env = envSchema.parse({
```

`CLAUDE.md` registra que validar env em escopo de módulo derruba o build, e o resto da base migrou
para construção preguiçosa. Este arquivo não migrou — e a cadeia de import do gateway **agora passa
por ele**: `gateway/index.ts` → `./fabrica` → `@/core/conexoes/leitura` → `@/core/tenancy/escopo` →
`lib/prisma` → `lib/env`.

O build **não** quebra por isso (`DATABASE_URL` e `AUTH_SECRET` existem em qualquer deploy que sirva
uma página), e a Task 10 mediu o efeito real com uma sonda descartável, importando a fábrica sem
`DATABASE_URL`: o `parse` falha no import. A garantia foi então reescrita no alcance que é
verdadeiro — *nenhuma credencial de canal, nem `COFRE_CHAVE_MESTRA`, é exigida para importar; e
importar não consulta o banco* —, com o teste stubando `DATABASE_URL` para uma URL onde não há
Postgres, justamente para que uma consulta no import não passasse batida.

Fica como **dívida nomeada**: acrescentar uma variável de integração ao schema central reintroduz o
defeito de 2026-08-07.

### 9.5 O que o ciclo NÃO exercitou

Nenhuma linha deste ciclo tocou uma instância Evolution real. O `fetch` é substituído em toda a
suíte, como desde a Fatia 1 do módulo. O que está provado é que **o valor que chega ao `fetch` é o
que foi cadastrado**, com credencial cifrada de verdade no Postgres de verdade —
`whatsapp-envio-por-conexao.test.ts` não mocka fábrica, leitura nem cofre, e o único ponto interposto
é o `fetch` global. O que **não** está provado é que a Evolution aceita essa apikey, nem que o painel
dela aceita uma URL de webhook com dois segmentos dinâmicos. São 🔍 NV3 e NV4, e o banco de
desenvolvimento tem **zero** conexões cadastradas (sonda final), então nem o cadastro foi exercitado
com valor real.

---

## 10. Os briefings contradiziam o repositório — e a conta não é 22

A instrução desta tarefa afirma que "vinte e duas contradições entre os briefings e o repositório
foram achadas pelas onze tarefas". Contadas nos próprios relatórios, sob os títulos que cada tarefa
usou (*"Desvios do brief"*, *"Onde o briefing contradisse o repositório"*, *"divergências"*,
*"Contradições"*), o número é **32** — ou **31**, se descontado o único item da Task 9 que é escolha
de método e não contradição (o e2e desativar a conexão antes de apagar).

| Tarefa | Itens | Relatório |
| --- | --- | --- |
| 1 | 4 | `.superpowers/sdd/task-2a-1-report.md` |
| 2 | 4 | `task-2a-2-report.md` |
| 3 | 4 | `task-2a-3e4-report.md` |
| 4 | 1 | idem |
| 5 | 3 | `task-2a-5-report.md` (o título diz "duas"; lista três, a terceira marcada "menor") |
| 6 | 3 | `task-2a-6-report.md` |
| 7 | 4 | `task-2a-7-report.md` (C1–C4) |
| 8 | 1 | `task-2a-8-report.md` |
| 9 | 5 | `task-2a-9-report.md` (4 contradições + 1 escolha de método) |
| 10 | 3 | `task-2a-10-report.md` |
| **total** | **32** | |

Registro a diferença porque um documento cujo primeiro parágrafo diz "provar, não presumir" não pode
repetir um número que ele não contou. **Nenhuma das 32 afrouxou guarda** — conferido item a item nos
relatórios; três delas **apertaram**. As quatro que mais importam para quem for revisar:

1. **Um `require()` que reprova o próprio lint** (Task 2). O briefing ditava
   `require("node:crypto")` dentro de um caso de teste. O caso rodava, e `npm run lint` saía com
   `error @typescript-eslint/no-require-imports`. Corrigido com `import`, mantendo o recálculo do
   `keyId` à mão — usar `chavePorId` ali seria pedir a resposta à função que o teste exercita.
2. **Um `as never` que não mordia** (Task 4). O comentário ditado afirmava que a asserção deixaria de
   compilar se `ver_conexoes` entrasse em `Acao`. Medido: acrescentar o membro e rodar `tsc --noEmit`
   dá **verde**. Escrito como o briefing mandava, seria afirmação falsa guardando uma decisão de
   segurança. Substituída por um condicional de tipo **não distributivo**
   (`[Extract<Acao, "ver_conexoes">] extends [never] ? true : false`), e o mutante correspondente
   reprova com `TS2322`.
3. **`expect.anything()` reprova `null`** (Task 8). O briefing pedia
   `objectContaining({ connectionId: expect.anything() })` contra uma fixture que cria conversa **sem**
   conexão. A frouxidão conhecida do Vitest é entre chave ausente e `undefined`; `null` contra ausente
   reprova. Trocado por `connectionId: null` explícito, que continua mordendo — e o caso com
   `connectionId` **não** nulo mora onde deve morar, em `whatsapp-envio-por-conexao.test.ts`, contra
   duas conexões ativas no Postgres real.
4. **Uma varredura por substring que reprovava campos legítimos** (Task 5). O caso ditado procurava a
   substring `"segredo"` no JSON de `ConexaoApresentada`, que expõe `segredoAtualizadoEm` e
   `segredoAtualizadoPor` — uma data e um nome. O teste ficava vermelho contra a implementação do
   próprio briefing. Corrigido **fortalecendo**: lista FECHADA de chaves permitidas, que cobre também
   o que a substring não cobria — um campo novo entrando no tipo sem ninguém decidir.

Um quinto item merece nota porque é do gênero mais perigoso: **a Task 10 recebeu uma varredura
impossível**. O briefing mandava afirmar que nenhum arquivo de `src/` **menciona** `EVOLUTION_`;
`tests/unit/whatsapp-ingest.test.ts:356` tem um caso **verde** que EXIGE a menção, escrito pela Task
7 com o motivo (*"o defeito é a variável ser LIDA, não a história dela ser contada"*). As duas não
cabem juntas. Ficou a que fecha o defeito — varredura por **leitura de `process.env`** —, e ela é
mais apertada que a pedida em pelo menos um ponto: pega `process.env["EVOLUTION_INSTANCE"]` e
destructuring, que um `grep` por `process.env.EVOLUTION_` não pegaria.

---

## 11. Erros meus, do controlador

1. **Rodei `npm test` sabendo que ele reescreve duas senhas, e a alternativa oferecida não poupava
   nada.** A instrução desta tarefa oferecia trocar por `npx vitest run tests/unit` se isso provasse
   o mesmo. Provaria — e não pouparia: `package.json` define `"test": "vitest run"` e
   `vitest.config.ts:21` restringe o `include` a `tests/unit/**`. Os dois comandos rodam **o mesmo
   conjunto**, `tests/unit/seed.test.ts` incluído. Escolher o menor mudaria o rótulo, não o efeito.
   Rodei o que o critério pede e registro a consequência em vez de escondê-la (🔍 NV6).

2. **O briefing desta tarefa e a instrução do orquestrador pedem o e2e de formas diferentes, e segui
   a do orquestrador.** O Step 3 do `task-11-brief.md` manda `npx playwright test --workers=1`,
   citando ⚠️ N1 da auditoria do Ciclo 1c (`seguranca-headers.spec.ts` falhando de forma
   determinística com `workers > 1`). A instrução de trabalho diz que a suíte "agora passa com 3
   workers" e manda `npm run test:e2e`, que é o padrão do `playwright.config.ts`. Rodei o comando do
   orquestrador porque é a informação mais recente, e a saída está colada abaixo — se ela contradiz
   ⚠️ N1, é a medição que manda.

3. **Repeti duas execuções por causa do ambiente, não do código.** Um `node -e` com `\\s` no
   argumento chegou ao Node com as barras comidas (`SyntaxError: Invalid regular expression`), e um
   heredoc `<<'EOF'` teve o mesmo destino. É o proxy de linha de comando desta sessão mexendo no
   argumento — o mesmo gênero de armadilha que a auditoria do Ciclo 1c registrou para
   `grep -c '"src/'`. Todos os parsers deste documento foram escritos em arquivo pela ferramenta de
   escrita, e todas as contagens usam `/usr/bin/grep`.

4. **Contei as contradições em vez de repetir o número que recebi.** Ver §10: a instrução diz 22, a
   contagem pelos relatórios dá 32. Um documento que abre com "provar, não presumir" e copia um
   número que não conferiu já falhou na primeira linha.

---

## ✅ Verificado e correto

| # | Item | Como foi verificado |
|---|---|---|
| 1 | `npm run typecheck` verde | `tsc --noEmit` → **sem saída**, exit 0 |
| 2 | `npm run lint` sem **erro** | `✖ 6 problems (0 errors, 6 warnings)`. Os 6 são pré-existentes e nomeados: `src/components/leads/lead-table.tsx:117` (`react-hooks/incompatible-library`, TanStack Table), `src/core/contacts/actions.ts:61` (`_ignorado`), `tests/unit/proxy-matcher.test.ts:53` (diretiva `eslint-disable` órfã) e `tests/unit/whatsapp-fila-vercel.test.ts:22` (3× parâmetro não usado). **Nenhum em arquivo criado por este ciclo** |
| 3 | `npm run build` verde | `✓ Compiled successfully in 393ms` · `Finished TypeScript in 3.8s` · exit 0 |
| 4 | A tabela de rotas continua com **1** estática, e as rotas novas estão lá | `○ /_not-found` e mais nada estático; **22** `ƒ` dinâmicas + `ƒ Proxy (Middleware)`. Entre elas `ƒ /api/whatsapp/evolution/[companyId]/[token]` (a antiga `[token]` não existe mais), `ƒ /configuracoes` e `ƒ /configuracoes/conexoes`. Eram 21 dinâmicas antes do ciclo; o saldo `+1` é a aba nova, porque a rota do webhook substituiu a antiga |
| 5 | Suíte unitária inteira verde | `npm test` (`vitest run`, sozinho, em série) → `Test Files 130 passed \| 1 skipped (131)` · `Tests 1494 passed \| 13 skipped (1507)` · `Duration 445.18s` · exit 0. **Esta execução reescreveu as senhas de `admin@exemplo.com` e `vendedor@exemplo.com`** — ver 🔍 NV6 |
| 6 | O 1 arquivo pulado é conhecido e alheio | `tests/unit/seed-demo.test.ts`, `describe.skipIf(!funilEhOSemeado)`: exige 5 etapas com a última `ehGanho`; o banco de dev tem 4. Pré-existente desde o Ciclo 1c, nada deste ciclo toca `PipelineStage` |
| 7 | `tests/unit/catraca-prisma-cru.test.ts` verde, isolado | `npx vitest run tests/unit/catraca-prisma-cru.test.ts` → `Test Files 1 passed (1)` · `Tests 18 passed (18)` · `Duration 537ms` |
| 8 | `LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS` continua em **0** | `/usr/bin/grep -n` → `108:const LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS = 0;` |
| 9 | **Nenhuma exceção nova de lint**, e a prova é o diff vazio | `git diff --stat 049df2d^..c7e0486 -- eslint.config.mjs tests/unit/catraca-prisma-cru.test.ts` → **saída vazia**. Os dois arquivos que poderiam conceder exceção estão byte a byte iguais aos de antes do ciclo |
| 10 | `EXCECAO_PERMANENTE` tem exatamente as **mesmas 5** entradas, e as três filas temporárias têm **0** | Parser em Node que remove comentários e conta só caminhos terminados em `.ts`/`.tsx` → `EXCECAO_PERMANENTE: 5` (`credenciais.ts`, `session.ts`, `users/empresa.ts`, `rate-limit/limiter.ts`, `tenancy/escopo.ts`); `VIOLADORES_TEMPORARIOS_{CORE,MODULES,APP}: 0` cada. Corrobora o item 9 por outro caminho, e fecha o M12 do spec: **a resolução do webhook não precisou de exceção** |
| 11 | A tabela nova nasceu blindada, medido **sem lista fixa** | `npx playwright test tests/e2e/banco-blindado.spec.ts --workers=1` → **`9 passed (18.6s)`**. Os casos `:42`, `:59` e `:95` varrem `pg_class.relrowsecurity` e `information_schema.role_table_grants` sem enumerar tabelas — uma tabela nova desprotegida apareceria sozinha |
| 12 | Advisor de segurança do Supabase **sem achado novo além do previsto** | `get_advisors(security)` em `uzumzfxjcxrbxaucvfsr` → **17 × `rls_enabled_no_policy` (INFO)** — as 16 do Ciclo 1c mais `public.WhatsappConnection` — e **2 × WARN**, os mesmos dois sobre `public.rls_auto_enable()` ser executável por `anon` e por `authenticated`. Bate **exatamente** com o critério de aceite. RLS ligada sem política é o default-deny desejado, não achado |
| 13 | A migração liga RLS, revoga grants e **não insere nada** | `/usr/bin/grep -nE` sobre `20260820210000_cofre_conexoes_whatsapp/migration.sql` → `82:ALTER TABLE "WhatsappConnection" ENABLE ROW LEVEL SECURITY;` e `83:REVOKE ALL ON TABLE "WhatsappConnection" FROM anon, authenticated;`; `grep -c "INSERT"` → **0** |
| 14 | O schema `public` continua com **zero** políticas | `select count(*) from pg_policies where schemaname = 'public'` → `0`. Default-deny inteiro, e a exceção NOMEADA do Realtime continua sendo Ciclo 3 |
| 15 | A suíte e2e **não regrediu** | `npm run test:e2e` (3 workers, o padrão) → `1 failed · 52 passed (1.3m)`. A falha é `sessao-e-cache.spec.ts:37`, spec que **este ciclo não tocou** e que a auditoria do Ciclo 1c já registrou no conjunto instável (⚠️ N3). Eram 46 passando no 1c; são 52 agora, e os 3 casos novos de `configuracoes-conexoes.spec.ts` estão entre eles |
| 16 | E a falha do item 15 é instabilidade, não defeito — **medido, não suposto** | `npx playwright test tests/e2e/sessao-e-cache.spec.ts --workers=1` → **`5 passed (29.9s)`**, com o `:37` verde em `3.4s`. O arquivo inteiro passa isolado; ele falha quando divide banco com os outros specs. Confirma ⚠️ N3 do Ciclo 1c e **descarta regressão deste ciclo** |
| 17 | `EVOLUTION_COMPANY_ID` e as outras três não são LIDAS em lugar nenhum | `/usr/bin/grep -rn "process.env.EVOLUTION_\|process.env\[.EVOLUTION" src/ \| wc -l` → **0**. As 13 ocorrências restantes de `EVOLUTION_` são linha de comentário, e a varredura de fonte de `whatsapp-config-preguicosa.test.ts` reprova leitura e absolve comentário — mordida provada por mutação na Task 10 |
| 18 | `.env.example` não declara mais nenhuma das cinco | `/usr/bin/grep -cE "^(EVOLUTION_\|WHATSAPP_WEBHOOK_TOKEN)" .env.example` → **0**. E o build e as 1494 asserções passam com elas ausentes do ambiente (✅3, ✅5) |
| 19 | O serviço que serve a tela **nunca decifra** | `/usr/bin/grep -c "decifrar" src/core/conexoes/service.ts` → **0**. As três únicas leituras que decifram vivem em `src/core/conexoes/leitura.ts`, e as três usam `prismaDaEmpresa` |
| 20 | O que volta para o navegador é um tipo FECHADO, sem segredo | `ConexaoApresentada` (`service.ts:51-62`) tem 9 campos: `id`, `canal`, `nome`, `ativa`, `dominio`, `instancia`, `mascara`, `segredoAtualizadoEm`, `segredoAtualizadoPor`. O caso de teste afirma `Object.keys(...).sort()` contra um `toEqual` — lista fechada, não busca por substring —, mais uma varredura de conteúdo por apikey e por prefixo de blob. A máscara é `••••••••` + 4 caracteres, montada **no servidor** |
| 21 | A auditoria de conexão não carrega instantâneo — provado contra o **banco real** | Depois da suíte e2e, `select acao, (antes is null), (depois is null) from "AuditLog" where acao like '%conexao%'` devolve **8 linhas** (`criar_conexao`, `substituir_segredo_conexao`, `desativar_conexao`, `apagar_conexao`, duas vezes cada) e **todas com `antes` e `depois` NULOS**, tamanho 0. Isto é mais forte que o caso de unidade: é o que o navegador de verdade gravou |
| 22 | Desativar cala os DOIS sentidos, com erro próprio | `src/core/conexoes/leitura.ts:194-204`: `ativa` sai do `select` e não do `where`, e a linha desligada lança `ConexaoDesativadaError` — classe distinta de `ConexaoNaoConfiguradaError`, com caso afirmando que uma não é a outra nos dois sentidos, e caso ponta a ponta afirmando que o `fetch` **não** foi chamado |
| 23 | A rota do webhook trata `companyId` como hipótese, e as duas recusas são indistinguíveis | `route.ts:98-105`: `resolverConexaoPorWebhook(companyId, token)` busca escopada; token de A com `companyId` de B devolve 404 com o mesmo corpo e os mesmos cabeçalhos de "token inexistente". Instância errada → 403, nada escrito. Rate limit **antes** da resolução (`route.ts:86`), porque resolver é ida ao banco |
| 24 | `gerenciar_conexoes` é de ADMIN e de mais ninguém | `src/core/auth/permissions.ts`, matriz com a entrada só em `ADMIN`; mutante que a tira de ADMIN reprova 1 caso; mutante que acrescenta `ver_conexoes` a `Acao` reprova com `TS2322`. Checada no servidor nas **seis** actions e nas **duas** páginas, com arquivo de gate próprio (`configuracoes-pages-gate.test.tsx`) porque barrar o POST e barrar a navegação são metades independentes |
| 25 | Nenhum segredo gravado fora do formato do cofre | `select count(*) from "WhatsappConnection" where "segredoCifrado" not like 'v1.%'` → **0**. **Ressalva honesta:** a tabela tem **0 linhas**, então este `0` é verdadeiro por vacuidade. Ele vira prova de verdade depois da ação 4 de "Só um humano pode fazer" |
| 26 | Nenhum resíduo de fixture no banco depois de tudo | Sonda final abaixo: `Company: 1`, nenhuma linha com prefixo `teste-`/`ZZTeste`/`ZZEnvio`/`ZZConexao`/`e2e`, `WhatsappConnection: 0`. A conta `e2e-revogacao-cache@teste.invalid` que a auditoria do Ciclo 1c registrou como ⚠️ N2 **não reapareceu** nesta execução |

---

## Sonda final ao banco

Executada **depois** de `npm test`, da suíte e2e inteira e das duas execuções focadas do Playwright,
pela MCP do Supabase contra o projeto `uzumzfxjcxrbxaucvfsr`.

```
Company: 1 | CompanyConfig: 1 | WhatsappConnection: 0 | User: 6 | Membership: 6
Conversation: 0  (com connectionId: 0 · sem connectionId: 0)
Contact: 4 | WhatsappMessage: 0 | Lead: 4 | AuditLog: 71 (8 de conexao)
segredo fora do formato do cofre (`not like 'v1.%'`): 0
politicas em public: 0

-- Company (todas) --
│ 'company-migracao-1a' │ 'n8necrm' │

-- orfas de fixture (teste-% / ZZTeste% / %e2e% / ZZEnvio% / ZZConexao%) --
(nenhuma linha, nem em Company nem em Contact)

-- User + vinculos --
│ 'admin@exemplo.com'              │ ativo: true  │ 1 │
│ 'e2e-admin@teste.invalid'        │ ativo: true  │ 1 │
│ 'e2e-vendedor@teste.invalid'     │ ativo: true  │ 1 │
│ 'gestor-teste-task6@exemplo.com' │ ativo: false │ 1 │
│ 'vendedor@exemplo.com'           │ ativo: true  │ 1 │
│ 'whatsapp-bot@sistema.invalid'   │ ativo: false │ 1 │
```

Leitura, item a item — e três destes números **corrigem** o que o próprio briefing desta tarefa
previa:

- **`WhatsappConnection: 0`.** O caminho ponta a ponta do Ciclo 2a **nunca rodou com credencial
  real**. Todas as conexões criadas pelo e2e foram apagadas pela própria suíte, e as 8 linhas de
  `AuditLog` são o rastro delas. Isso confirma ✅26 e também confirma 🔍 NV3/NV4 como abertos.
- **`Conversation: 0` — e o briefing previa `sem_connection_id > 0`.** A dívida do backfill (§7)
  existe pelo desenho e tem **zero linhas afetadas neste banco hoje**. Ela não é hipotética: o código
  do fallback existe, está exercitado com duas conexões ativas em `whatsapp-envio-por-conexao.test.ts`,
  e morde em qualquer base que já tenha conversas. Mas quem for decidir o backfill precisa saber que,
  **aqui**, não há o que fazer backfill. Em produção o número pode ser outro, e a consulta que o mede
  está no item 6 do briefing.
- **`User: 6`, não 7.** A auditoria do Ciclo 1c mediu 7, com
  `e2e-revogacao-cache@teste.invalid` ativa e **sem vínculo** (⚠️ N2 daquele documento). A conta não
  existe mais e não reapareceu nesta execução — apesar de `sessao-e-cache.spec.ts` ter rodado duas
  vezes aqui. Todas as 6 contas restantes têm **1 vínculo**; nenhuma com `vinculos: 0`, que era o
  sintoma daquele achado.
- **`gestor-teste-task6@exemplo.com`** é resíduo declarado de uma tarefa do Ciclo 1c, inativo e com
  vínculo. Deixado onde está: apagar dado de outra tarefa sem pedir é o oposto do que a regra de
  resíduo quer.
- **`AuditLog: 71`, das quais 8 de conexão.** Bem abaixo de qualquer janela de rajada
  (`LIMITE_ALERTA = 10` em 5 minutos), e as 8 são de duas execuções do mesmo spec e2e.

---

## ⚠️ Riscos e dívidas

### Medidos nesta auditoria (novos)

- **A1 — `ACOES_SENSIVEIS` cresceu 40% e `LIMITE_ALERTA` não mudou** (§9.2). O gatilho do alerta de
  rajada ficou mais sensível por efeito colateral, não por decisão. Nenhum teste afirma o tamanho da
  lista, então o próximo crescimento também passará calado.
- **A2 — `atualizarConexaoAction` existe, é testada e não tem botão** (§9.3). Renomear uma conexão
  hoje exige apagar e recadastrar, o que **rotaciona o token do webhook** e obriga a recolar a URL no
  painel da Evolution.
- **A3 — `lib/env.ts` é o último ponto do repositório com validação em escopo de módulo, e a cadeia
  de import do gateway agora passa por ele** (§9.4). O build não quebra hoje; acrescentar uma
  variável de integração ao schema central reintroduz o defeito de 2026-08-07.

### Declaradas pelo próprio spec do Ciclo 2a (§11), todas de pé

- **D1 — a chave mestra é ponto único de falha, por desenho.** Perdê-la torna todo segredo do cofre
  irrecuperável. A mitigação é operacional (gerenciador de segredos), não de código; o que o código
  faz é falhar **alto e nomeado** em vez de degradar.
- **D2 — a AAD não separa duas conexões da MESMA empresa e do mesmo propósito** (§2).
- **D3 — a máscara guarda os últimos 4 caracteres em texto puro.** Entropia revelada por escolha.
- **D4 — `Conversation.waId` global-única passa a ser ALCANÇÁVEL** (§6). É a dívida que este ciclo
  **piorou em alcance** sem tocá-la.
- **D5 — a comparação do token deixa de ser de tempo constante.** Passou a ser `sha256` contra
  `webhookTokenHash`, com busca por índice. Escolha consciente: a entropia é a defesa, e guardar o
  hash em vez do texto puro é ganho maior que a perda. `src/proxy.ts` foi corrigido para não afirmar
  mais `timingSafeEqual`.
- **D6 — desativar a última conexão desliga o WhatsApp da empresa sem aviso prévio.** A tela pede
  confirmação e a ação entra na detecção de rajada (`desativar_conexao`), mas nada impede o clique.
- **D7 — a régua de Configurações tem uma seção só.** Andaime declarado: a condição do menu vira um
  OU quando a segunda seção chegar.

### Medidas pelas tarefas do ciclo, registradas e não fechadas

- **N1 — `@@unique([companyId, canal, instancia])` não impede duas linhas com `instancia` NULA**
  (§9.1). Inócuo hoje, deixa de proteger quando o Ciclo 2b abrir `META_CLOUD`.
- **N2 — conversas anteriores ao ciclo têm `connectionId` nulo, sem backfill** (§7). Migração de
  dados pendente; recusa alta no dia da segunda conexão. **Zero linhas afetadas neste banco**
  (`Conversation: 0`), o que torna a decisão barata **agora** e cara depois.
- **N3 — nada foi exercitado contra instância Evolution real, e o banco tem zero conexões** (§9.5).
- **N4 — `redigirApiKey` protege `enviarTexto`, e só ele.** Ela é local a
  `src/modules/whatsapp/gateway/evolution.ts` e não exportada. Qualquer caminho novo que ponha corpo
  de resposta da Evolution numa mensagem de erro — registro de instância, QR Code, teste de conexão —
  precisa passar pela mesma função, e o Ciclo 2c traz exatamente esses caminhos.
- **N5 — `CHAVE_BASE64` é agressiva por decisão.** Qualquer corrida de exatamente 43 caracteres
  base64 com fronteira dos dois lados sai como `[chave]` no Sentry. Há caso provando que um `sha256`
  de 64 hex **não** é redigido e que um cuid passa — mas um identificador de 43 caracteres exatos, se
  um dia existir neste sistema, sumiria dos relatórios de erro. Foi a troca escolhida.
- **N6 — o gateway do turno é resolvido uma vez por turno.** Um turno longo com o operador trocando
  a credencial no meio usa a antiga até a próxima mensagem. É o custo aceito, e está no comentário.
- **N7 — `agente.ts` pausa a IA mesmo quando a conexão está desativada.** Deliberado e com caso de
  teste; o efeito visível para quem opera é uma conversa pausada por uma tentativa que não saiu.
  Errar para o lado de "a IA fica calada" continua sendo o lado seguro.

### Herdadas do Ciclo 1a, nenhuma tocada aqui — e duas **pioraram**

- **R1 — o banco de teste não é separado do de desenvolvimento.** É a causa raiz da rotação de senha
  do 🔍 NV6 e da restrição de nunca rodar `vitest` em paralelo. Bloqueio duro desde o Ciclo 0.
- **R2 — as quatro unicidades globais** (`PipelineStage.ordem`, `Contact.telefone`,
  `Conversation.waId`, `WhatsappMessage.idExterno`). **Piorou em alcance** — ver §6.
- **R3 — os pontos cegos do escopo. Ficou MAIOR.** `User` tinha nove relações inversas depois do
  Ciclo 1c; a `WhatsappConnection.segredoAtualizadoPor` fez **dez**
  (`src/core/tenancy/escopo.ts`). Cada uma é uma porta por onde um `include` aninhado através de
  `User` sai do tenant. Mitigação parcial e honesta: o que está do outro lado desta décima é
  `segredoCifrado` — cifrado, sem a chave no banco —, mas `nome`, `dominio` e `instancia` da conexão
  de outra empresa continuariam visíveis por esse caminho. A defesa segue sendo não escrever
  `include` através de `User` sem filtrar à mão. A relação foi registrada em `RELACOES_SENSIVEIS`
  (`tests/unit/consultas-estreitas.test.ts`) — o que **não conserta bug nenhum hoje**, e existe para
  que o dia do `segredoAtualizadoPor: true` seja vermelho.
- **R4 — `User.papel`** continua como espelho depreciado.
- **R6 — `companyIdDoUsuario`** continua.
- **R5 está FECHADA por este ciclo.** `EVOLUTION_COMPANY_ID` não é lida em lugar nenhum de `src/`.

> **Não vale mais desde 2026-08-21:** a coluna saiu no Ciclo 1f.

---

## ❌ Herdado, não corrigido aqui — e o vizinho direto do que este ciclo entrega

Os achados de **infraestrutura** que esta base já registrou continuam abertos. Nenhum introduzido
aqui, nenhum corrigido aqui. O primeiro da lista não é um item qualquer: ele é a **outra metade** da
defesa que este ciclo construiu.

1. **A chave global da Evolution é `nateksoft`** — cria, apaga e lê qualquer instância. O cofre deste
   ciclo protege a apikey **da instância**, dentro do CRM, contra dump, backup e `service_role`. Ele
   **não faz nada** contra alguém que adivinhe a chave global e converse direto com a Evolution:
   nesse caminho a instância inteira é lida, apagada ou recriada sem passar pelo CRM. **Cifrar bem
   uma credencial cuja irmã global é o nome da empresa é meia defesa**, e um relatório que celebrasse
   o cofre sem dizer isso deixaria o leitor achando que fechou. Trocar essa chave é ação de
   infraestrutura, não de código, e não depende deste ciclo para acontecer.
2. **`N8N_ENCRYPTION_KEY=nateksoft`** — criptografa todas as credenciais salvas no n8n, adivinhável a
   partir do nome da empresa. Mesma família do item 1.
3. **Senha reusada** — `DB_POSTGRESDB_PASSWORD` do n8n é a mesma senha do projeto Supabase do CRM. É
   o **mesmo Postgres** onde `WhatsappConnection` acabou de nascer.
4. **O JWT da API do n8n não expira** (sem claim `exp`).
5. **As ações destrutivas de fluxo** (`ativar`/`desativar`/`apagar`) **não têm teto de taxa** — e
   agora as de conexão também não têm; o que existe é detecção de rajada **depois do fato**
   (`ACOES_SENSIVEIS`), não um teto.

Detalhe e origem em `docs/auditorias/2026-08-19-ciclo-4-fluxos.md`,
`docs/auditorias/2026-08-19-ciclo-1a-tenancy.md` e
`docs/auditorias/2026-08-20-ciclo-1c-config-no-banco.md`.

---

## 🔍 Não verificados

Os seis itens da §10.1 do spec, cada um com o estado ao fim desta auditoria.

| # | Item | Estado | O que fecha |
|---|---|---|---|
| NV1 | Custo do `sha256` do token com busca por índice, com muitas conexões | **continua aberto** — o banco tem 1 empresa e 0 conexões (sonda final); medir exige volume | `EXPLAIN ANALYZE SELECT * FROM "WhatsappConnection" WHERE "webhookTokenHash" = $1;` com alguns milhares de linhas |
| NV2 | Que um `pg_dump` da tabela não contém a apikey em texto | **continua aberto** — exige rodar `pg_dump` contra o Supabase, e hoje não há linha para dumpar | `pg_dump --data-only -t '"WhatsappConnection"' "$DIRECT_URL" \| grep -c '<a apikey conhecida>'` → deve ser **0** |
| NV3 | Que a Evolution aceita a apikey lida do banco | **continua aberto** — não há instância Evolution acessível neste ambiente | Depois da ação 2 do dono: mandar uma mensagem para o número e confirmar que a resposta sai |
| NV4 | Que o painel da Evolution aceita a URL de webhook com dois segmentos dinâmicos | **continua aberto** — depende de instância viva | Colar a URL no painel, disparar evento de teste, conferir 200 no log da Vercel |
| NV5 | Que `prisma migrate dev` não acusa deriva com o enum novo | **continua aberto** — exige shadow database. O que **está** medido é `prisma migrate status` → `19 migrations found` · `Database schema is up to date!` (Task 1), que não é a mesma pergunta | `npx prisma migrate dev --create-only` num branch descartável |
| NV6 | Estado da senha do admin no banco de desenvolvimento | **aberto e URGENTE** — `npm test` rodou nesta auditoria (✅5) e reescreveu o `senhaHash` de `admin@exemplo.com` e `vendedor@exemplo.com` com literais versionados neste repositório. Esta auditoria **não rotaciona senha**: não tem, nem deve ter, o valor novo, e nada deste documento pode conter senha | `SEED_PASSWORD=<valor forte gerado> npx prisma db seed`, e depois `bcrypt.compare` provando que os literais antigos não autenticam mais |

---

## Só um humano pode fazer

1. **Rotacionar as senhas de `admin@exemplo.com` e `vendedor@exemplo.com` agora.** `npm test` rodou
   nesta auditoria e gravou literais públicos deste repositório no `senhaHash` das duas contas. É o
   🔍 NV6, e é a única pendência **operacional imediata** deste documento.
2. **Aprovar ou recusar este relatório antes de qualquer merge ou PR.** O `AGENTS.md` exige a Fase 1
   da auditoria sobre a superfície que a branch mexeu, entregue e **parada** até o dono aprovar.
   Correção começa depois disso — e é por isso que ⚠️ A1, A2, A3, N1 e N2 estão descritos com o
   conserto sugerido e **não aplicados**.
3. **Gerar a chave mestra e pô-la na Vercel.** `openssl rand -base64 32` → `COFRE_CHAVE_MESTRA`, nos
   três ambientes. **Sem ela o WhatsApp não sobe**, e é assim que tem de ser (§5.4 do spec). No
   ambiente local a chave já existe e nunca foi impressa — conferida por contagem
   (`/usr/bin/grep -c "^COFRE_CHAVE_MESTRA=" .env` → `1`), jamais por valor.
4. **Cadastrar a primeira conexão pela tela e recolar a URL do webhook** no painel da Evolution. Só
   depois disso apagar as quatro variáveis `EVOLUTION_*` **da Vercel** — elas já saíram do código e
   do `.env.example`, mas uma `EVOLUTION_APIKEY` esquecida no painel é credencial viva sem dono.
   Este é também o passo que fecha 🔍 NV3 e NV4.
5. **Decidir `Conversation.waId`** (⚠️ D4 / R2). Enquanto a base tiver uma empresa, é teoria; ela
   deixa de ser teoria no dia da segunda, e o modo de falha é um 500 em laço que a Evolution
   reentrega para sempre. A correção é mudança de schema com migração de dados, e não cabe numa
   tarefa de auditoria.
6. **Decidir o backfill de `Conversation.connectionId`** (⚠️ N2). Barato agora, caro depois da
   segunda conexão.
7. **Trocar a chave global da Evolution** (❌ item 1). É a metade da defesa que este ciclo não
   alcança.
8. **Decidir R1** — banco de teste separado do de desenvolvimento. É a causa raiz do item 1 desta
   lista e da regra de nunca rodar `vitest` em paralelo. Registrado como bloqueio duro desde o
   Ciclo 0.
