# Auditoria de segurança — Ciclo 1a (tenancy) e o Ciclo 1d que saiu dele

**Data:** 2026-08-20
**Escopo:** branch `ciclo-1a-tenancy` completa, `54127ac..b5b3810` (32 commits) — as tabelas
`Company` e `Membership`, `companyId` nas 10 tabelas de dado de tenant, o papel do usuário saindo
de `User.papel` para o vínculo, o cliente escopado `prismaDaEmpresa()`, a regra de lint que o torna
obrigatório, a catraca que a trava, e o Ciclo 1d — os 31 defeitos de tenancy vivos que o
levantamento desta branch encontrou e fechou.
**Ambiente:** leitura de código e histórico local, execução dos quatro portões nesta árvore, e
consulta ao Postgres real do Supabase (projeto `uzumzfxjcxrbxaucvfsr`) via MCP. Uma única escrita
foi tentada contra o banco, deliberadamente construída para FALHAR (✅7) — nenhuma linha criada,
alterada ou apagada por esta auditoria, confirmado depois por contagem.

## Resumo

**❌ Críticas em aberto: 0 · ❌ Críticas fechadas DENTRO desta branch: 33 · ⚠️ Riscos: 6 ·
✅ Verificados: 19 · 🔍 Não verificados: 5**

Os dois primeiros números contam a história deste ciclo, e o segundo é o que importa. A branch não
introduziu vazamento de tenancy nenhum: ela **descobriu 33 que já estavam vivos** — código escrito
antes de `companyId` existir, e que ninguém tinha motivo para reler. Dois deles não eram hipótese:
o fan-out de notificação deixou **11 linhas em disco** no banco de desenvolvimento, com rótulo de
cliente de uma empresa no sino de gente de outra; e `redefinirSenha` era **tomada de conta** entre
empresas, não vazamento de leitura.

Nada disso está publicado — este CRM não tem deploy no ar — então não há incidente ativo. Mas um
relatório que se limitasse a "0 críticas em aberto" seria falso pelo que omite, e o `AGENTS.md`
deste projeto não permite isso.

O que sustenta o "0 em aberto" não é uma varredura bem feita: é uma trava. `@/lib/prisma` deixou de
ser alcançável de `src/core/**`, `src/modules/**` e `src/app/**`, a fila de exceções temporárias
chegou a **zero**, e a família que reincidiu **seis vezes** neste ciclo — *validação que confere que
o registro EXISTE e nunca que ele é da mesma empresa* — perdeu a porta por onde reaparecia. Nenhuma
das seis foi achada por algo que o sistema fizesse sozinho; foi por isso que a saída virou
mecanismo, e não disciplina.

---

## Como a verificação foi feita

Toda linha marcada `✅ OK` abaixo carrega o comando e a saída. O que este ambiente não provou está
em `🔍 Não verificados`, com o comando que um humano precisa rodar — nunca como "ok" presumido. A
revisão final do Ciclo 4 pegou uma auditoria afirmando um gate que o código não tinha; a regra
existe por causa disso.

Duas restrições de método valem registro:

- **Nada de `vitest` em paralelo.** O banco de teste **não é separado** do de desenvolvimento
  (⚠️ R1). Duas execuções simultâneas o envenenam — foi o que explicou as falhas "intermitentes"
  de `whatsapp-turno` na Task 4, que não eram teste instável. Todas as suítes citadas aqui rodaram
  em série, sozinhas.
- **`npm test` reescreve a senha do admin no banco de desenvolvimento.** Ele é `vitest run`, e
  `tests/unit/seed.test.ts:185` define `SENHA_NOVA = "outraSenhaDeTeste789"` — um literal
  versionado neste repositório — e chama `seed()` de verdade contra o Postgres, trocando o
  `senhaHash` de `admin@exemplo.com` e `vendedor@exemplo.com`. O `finally` daquele caso
  **deliberadamente não** reverte, e o comentário diz por quê: o reset que fazia isso gravava
  `senha123`, pior ainda. É problema pré-existente e conhecido, fora do escopo deste ciclo, que o
  dono do projeto rotaciona depois de cada execução. Esta auditoria rodou `npm test` porque a
  Task 5 exige, e **registra o efeito em vez de escondê-lo — não tentou consertar**.

---

## 1. O modelo de tenancy

`Membership(userId, companyId, papel)`, muitos-para-muitos, com `@@unique([userId, companyId])`. A
mesma pessoa pode estar em várias empresas com papéis diferentes — é o que permitirá entrar na
conta de um cliente para dar suporte sem uma segunda conta.

**Quem recebeu `companyId`** (10 tabelas de dado de tenant, mais a própria `Membership`):
`AuditLog`, `BotConfig`, `Contact`, `Conversation`, `Lead`, `LeadNote`, `Notification`,
`PipelineStage`, `Task`, `WhatsappMessage`. Todas `NOT NULL`, com FK e com índice em que
`companyId` é a **primeira** coluna — provado no catálogo, não lido do schema (✅2).

**Quem não recebeu, e por quê:**

- **`User`** — a relação com empresa é `Membership`, não coluna. Uma pessoa existe
  independentemente de empresa, e `email` é `@unique` **global** por decisão registrada no schema.
- **`RateLimit`** — `chave String @id`, indexada por IP ou identificador opaco. Infraestrutura
  global: o teto de tentativas de login de um IP não pertence a empresa nenhuma. Se um dia
  precisar ser por empresa, a empresa entra na **composição da chave**, não numa coluna nova.

Confirmado no catálogo: nenhuma das duas tem a coluna (✅3).

### A armadilha do `BotConfig`

`BotConfig` era linha única imposta pelo banco por um truque: `id String @id @default("bot-config")`.
Um segundo `create` sem id explícito colidia na chave primária. Config por empresa quebra isso, e a
troca era obrigatória: `id` passou a `cuid()` e a unicidade passou a `@@unique([companyId])`.

Este é o tipo de mudança que o compilador **não** pega — `findUnique({ where: { id: "bot-config" } })`
continua compilando e passa a devolver `null` para sempre. O ledger registra que a armadilha
disparou de verdade na Task 1 (o `where` por id constante virou no-op silencioso), junto de uma
segunda que também não é de tipo: o banco de desenvolvimento estava com `BotConfig.ativo = false`
de uma execução anterior. Nenhuma das duas dá erro; as duas dão comportamento errado calado.

---

## 2. A resolução de papel — e o critério que prova que ela não vazou

`usuarioAtual()` devolvia `Promise<User>` (o modelo do Prisma, com a coluna `papel`). Passou a
devolver `UsuarioAtivo`, um tipo próprio que **mantém o campo `papel`**, resolvido a partir de
`Membership`:

```ts
export interface UsuarioAtivo {
  id: string; nome: string; email: string; ativo: boolean;
  /** Empresa ativa desta requisição. Todo escopo de query sai daqui. */
  companyId: string;
  /** Papel do usuário NESTA empresa — vem de `Membership`, não de `User`. */
  papel: Role;
}
```

Preservar a forma não é economia de digitação. Vinte e seis lugares chamam
`hasPermission(usuario.papel, acao)`, e cada edição manual num deles é uma chance de trocar a ação,
inverter a condição ou esquecer o `!` — vinte e seis oportunidades de produzir falha de autorização
que nenhum compilador pega. Mover autorização é a parte mais arriscada deste ciclo exatamente
porque errar **não dá erro de compilação**: dá permissão errada em silêncio.

Por isso o sucesso se mede pelo que **não** mudou, e esse é o critério de aceite mais forte do spec.
Está provado em ✅6: o `git diff -U0` do branch inteiro não tem **uma linha** `+`/`-` que contenha
uma chamada `hasPermission(`, e a contagem por arquivo é idêntica nos dois lados.

Três decisões de resolução, todas com teste nomeado (`tests/unit/usuario-ativo.test.ts`):

| Situação | O que acontece | Por quê |
|---|---|---|
| **Um vínculo** | é aquele; `papel` vem dele | o caso normal |
| **Zero vínculo** | lança `"Não autenticado"`, a mesma string que `ehSessaoInvalida` reconhece | conta sem empresa não é conta usável, e deixá-la entrar sem escopo é exatamente como vazamento entre tenants começa |
| **Mais de um vínculo** | lança `EmpresaAmbiguaError`, **distinto** de "Não autenticado" | a sessão é legítima; a aplicação é que não sabe qual empresa servir. Tratar as duas como a mesma coisa mandaria a pessoa para o login num loop, sem nunca dizer o que está errado |

A terceira mudou durante o desenho, e a mudança é a decisão mais importante do ciclo. A primeira
versão escolhia "o vínculo mais antigo" — um chute com cara de regra, cujo modo de falha é ler dado
da **empresa errada**. Falhar alto custa zero hoje (um vínculo por pessoa, situação inalcançável), e
no dia em que deixar de ser, o erro aponta para a causa.

O teste do papel merece nota: ele monta o caso com o vínculo em `VENDEDOR` e a coluna antiga
`User.papel` em `ADMIN`, **divergentes de propósito**, "para que o teste não passe por acidente se
alguém reintroduzir a leitura da coluna". É uma trava, não uma asserção.

### `User.papel` não saiu — e é dívida de autorização, não cosmética

O spec e o plano diziam que a coluna sairia neste ciclo. **Ela não saiu.** O DROP foi aplicado
(`20260819130000_derruba_user_papel`) e **revertido** na sequência
(`20260819140000_restaura_user_papel_temporariamente`, commit `ad6391a`), porque o `typecheck` do
repositório inteiro revelou um **terceiro** grupo de leitores que nem o plano nem a tarefa previram
— e um deles era produção, não teste: `src/core/audit/alerta.ts`, a lista de destinatários do
alerta de rajada destrutiva, consultava `prisma.user.findMany({ where: { papel: "ADMIN", ... } })`.

O estado de hoje é **dual-write**: `src/core/users/service.ts` grava nas duas colunas enquanto a
ponte existir, e o schema marca `User.papel` como espelho depreciado (`a8dd76a`). Isso é
exatamente o que o spec argumentava contra — *"duas fontes de verdade para autorização não são uma
rede de segurança, são a própria falha esperando alguém ler a errada"* — e sobrevive por decisão
consciente de sequenciamento, não por esquecimento. Fica como ⚠️ R4.

O que impede a divergência hoje: **nada lê `User.papel` para autorizar.** `usuarioAtual()` lê o
vínculo, e é o `papel` dele que chega nos 26 `hasPermission`. A coluna é espelho de escrita, não
fonte de decisão — e o teste com valores divergentes citado acima é o que trava isso.

---

## 3. O mecanismo de escopo — e seus pontos cegos DECLARADOS

`src/core/tenancy/escopo.ts` entrega `prismaDaEmpresa(companyId, cliente = prisma)`: uma extensão
`$extends({ query: { $allModels: { $allOperations } } })` que injeta e **verifica** `companyId`.
Sem estado global de propósito — nada de `AsyncLocalStorage`, que funciona até o primeiro caminho
que roda fora do ciclo de requisição (job de fila, seed, script), que é exatamente onde ninguém
está olhando quando o escopo some.

O que ele faz, em uma frase: `findFirst({ where: { id } })` através dele já sai
`findFirst({ where: { id, companyId } })`, e escrita com `companyId` divergente é **recusada**, não
corrigida em silêncio.

**A regra de fechamento que só ficou de pé na segunda tentativa.** Duas rodadas de correção da
Task 3 produziram Crítico pela mesma causa — *"conferir formato conhecido em vez de fechar a
lista"*: `updateMany` movia linha via `data.companyId`, e `company: { create }` / `connectOrCreate`
aninhados **fabricavam empresa nova** e gravavam a linha nela. Resolvido invertendo para **lista
branca**: só `connect: { id: <escopo> }` passa. Fechada de verdade porque `Company` tem `id` como
único campo único e os 11 modelos nomeiam a relação `company`. Furada com 28 vetores, não cedeu.

Uma segunda família de defeito reincidiu **três vezes** na mesma tarefa: *"afirmar fechamento em
prosa sem verificar"*. Resolvida por regra, não por correção — toda frase de `escopo.ts` que afirme
universal (*todo/sempre/nenhum/qualquer/só*) precisa do teste que a exercita. A varredura achou 21
afirmações: 4 já tinham caso, 9 ganharam, e **5 foram reescritas por não serem verificáveis sem
banco vivo**.

### Os quatro pontos cegos, ditos no próprio arquivo

Nenhum destes é defeito escondido; os quatro estão escritos em `escopo.ts` com a origem da certeza à
vista. Registrados aqui porque uma auditoria que os omitisse deixaria "o escopo é obrigatório"
parecer mais forte do que é.

1. **`$queryRaw` / `$executeRaw` estão fora de qualquer proteção.** Não passam por `$allModels` —
   `$allOperations` alcança os *delegates* de modelo, e `$queryRaw` é método do cliente.
   `prismaDaEmpresa(id).$queryRaw` compila, roda e lê o banco inteiro. É por isso que o **lint é a
   peça central**: chegar no `prisma` cru exige exceção visível. A catraca cobre a outra metade,
   reprovando SQL cru que cite tabela de tenant sem citar `companyId` em arquivo fora da fila. O
   próprio arquivo marca isto como afirmação sobre o **contrato** da extensão, não medição —
   exercitá-lo faria uma consulta descer até o motor, e o banco falso do teste é montado justamente
   para que nada desça (🔍 NV3).
2. **Leitura aninhada (`include`/`select`) nunca é filtrada** — e é o caminho mais fácil de errar,
   porque não parece uma segunda consulta. Aos olhos da extensão não é: `$allOperations` vê UMA
   operação e o `include` desce intacto até o motor (medido sobre o banco falso). A regra prática:
   *relação que fica dentro de `Company` é segura; relação que passa por `User` não é.* `User` não é
   modelo de tenant e tem oito relações inversas. O caminho concreto:
   `lead.findMany({ include: { responsavel: { include: { leadsAtribuidos: true } } } })` devolve os
   leads de **todas** as empresas em que aquela pessoa tem vínculo. Não dá para consertar dentro de
   uma extensão `query`; quem escrever `include` através de `User` filtra à mão. O Ciclo 1d achou um
   caso real disto: `Lead.contactId` é FK que **não** carrega empresa, então "lead da B pendurado em
   contato da A" é estado expressável — filtrado à mão, com fixture que cria a linha e afirma que
   ela não aparece (🔍 NV1).
3. **`$extends` não relaxa os TIPOS dos argumentos.** Medido com `npm run typecheck`:
   `prismaDaEmpresa(x).contact.create({ data: { nome, telefone } })` **não** compila —
   `ContactCreateInput` continua exigindo `companyId`, mesmo que o escopo fosse injetá-lo um
   instante depois. Efeito prático benigno hoje (os chamadores já passam `companyId`, então o escopo
   age como **verificador**, não preenchedor), e o teste manda payload incompleto de propósito, com
   um helper `payload<T>()` que **descreve** a lacuna em vez de escondê-la.
4. **`$transaction` foi verificado só na fábrica do cliente interativo**, não ponta a ponta contra o
   Postgres. O `tx` carrega a extensão — isso está medido por duas vias na leitura do runtime e pelo
   caminho curto `prismaDaEmpresa(id).$transaction(cb)` — mas um `$transaction()` completo contra o
   banco real continua sem prova (🔍 NV2).

Há ainda dois **falsos positivos conhecidos**, e os dois falham ALTO em vez de calados: conteúdo de
coluna `Json` que por acaso tenha uma chave `companyId` (`Lead.utm`, `Notification.payload`,
`AuditLog.antes`/`depois`), e `where` aninhado dentro de `data`. A alternativa — uma segunda lista,
de caminhos a ignorar — compraria conveniência com deriva silenciosa, que é o defeito que a lista
branca acabou de fechar.

---

## 4. O que a exceção do lint ainda deixa aberto: **nada temporário**

A regra `no-restricted-imports` contra `@/lib/prisma` cobre `src/core/**`, `src/modules/**` e
`src/app/**`. A extensão a `src/app/**` foi decisão tomada na revisão da Task 3: a regra original
não alcançava duas leituras de modelo de tenant sem escopo, uma delas **sem `where` nenhum** em
`(painel)/page.tsx` — e um contador que não conta tudo mente.

A fila começou em **25** violadores temporários e chegou a **zero** em 2026-08-20 (✅10, ✅11). As
três constantes `VIOLADORES_TEMPORARIOS_{CORE,MODULES,APP}` continuam existindo, **vazias, de
propósito**: `tests/unit/catraca-prisma-cru.test.ts` as lê por NOME, e apagá-las faria a leitura
devolver `[]` sem distinguir "vazia" de "não encontrei" — a catraca ficaria verde por um motivo
diferente do que afirma.

Sobram **5 exceções permanentes**, e cada uma tem justificativa verificável, não "ainda não
converteram":

| Arquivo | Por que nunca vai para o cliente escopado |
|---|---|
| `src/core/auth/session.ts` | resolve **quem** é a pessoa. O escopo é derivado do vínculo dela; exigir escopo aqui é circular |
| `src/core/auth/credenciais.ts` | autentica **antes** de existir sessão, e portanto antes de existir empresa. Além disso a consulta é `user.findUnique({ where: { email } })`, e `User` não é modelo de tenant — `escoparArgumentos` devolveria os argumentos **intactos**. Não há por o que trocar. Ele chegou a entrar na lista TEMPORÁRIA com a anotação "converter é trocar o import, nada mais"; a anotação estava errada |
| `src/core/users/empresa.ts` | **calcula** `companyIdDoUsuario(usuarioId)` lendo `Membership`. Escopá-lo exigiria o `companyId` que ele está produzindo |
| `src/core/rate-limit/limiter.ts` | opera em `RateLimit`, tabela sem `companyId`: defesa global, consultada antes de existir empresa |
| `src/core/tenancy/escopo.ts` | **é** o cliente escopado. O único arquivo cujo import do prisma cru é o ponto |

Uma dessas mudou de categoria por um argumento que merece registro. `users/empresa.ts` esteve na
lista temporária com um argumento que parecia forte: o arquivo se documenta como **ponte** que some
quando todos os chamadores passarem `UsuarioAtivo.companyId`, e uma exceção permanente sobreviveria
ao arquivo e viraria mentira. Não sobrevive, e o que impede é mecânico: a catraca reprova toda
exceção declarada — permanente inclusive — para arquivo que não exista em disco ou que não importe
mais o prisma cru. Apagar `empresa.ts` sem apagar a linha deixa a suíte vermelha.

**Armadilha que quase deixou uma exceção invisível:** `"[id]"` numa lista de caminhos do eslint é
**classe de caracteres**, não pasta literal. A exceção de `leads/[id]/page.tsx` *parecia* declarada e
não estava, até virar `\[id\]`. Exceção que não casa é pior que exceção ausente — o lint fica verde.
A catraca hoje reprova metacaractere de glob nu por isso.

### A catraca, e por que ela é melhor que a varredura que eu pedi

Eu pedi ao subagente uma varredura ampla de padrões suspeitos. Ele **recusou**, com medida: a
varredura dava 12 falsos positivos em arquivos já convertidos e 62 achados contra 31 defeitos reais,
o que exigiria perdoada por linha e produziria um número que **parece** contagem de defeito sem ser.
Entregou no lugar `tests/unit/catraca-prisma-cru.test.ts` (18 casos), que:

- compara **duas fontes da verdade** — a árvore (`src/**` inteira) e as listas lidas do
  `eslint.config.mjs` — e exige que sejam o mesmo conjunto, **nomeando** o arquivo que entrou;
- alcança mais que o lint: `src/components/**`, `src/lib/**` e `src/proxy.ts` **não têm bloco** no
  eslint, e um `import { prisma }` ali passaria com o lint verde;
- reprova exceção órfã (que sobreviveu à conversão — o contador mentindo) e metacaractere nu;
- fecha as duas portas de serviço que um arquivo já convertido ainda tem: cliente **cru por
  parâmetro** (`PrismaClient` / `Prisma.TransactionClient`) e **SQL cru** sobre tabela de tenant.

Foi julgamento melhor que o meu pedido, e fica registrado como tal.

**Fragilidade nova da catraca em zero**, dita aqui porque ela não é óbvia: antes, "a lista tem
itens" provava que o parser funcionava. Com a lista vazia isso deixou de valer, e a guarda passou a
ser a presença literal de `const NOME = [` no texto. Se alguém apagar as três constantes "porque
estão vazias", a catraca fica verde sem ter lido nada.

---

## 5. Os 33 defeitos: o que estava vivo, e a família que reincidiu seis vezes

O levantamento completo (feito em `da2a402`, atualizado em `f2f05cf`) contou **33 defeitos de
tenancy vivos**, 17 de severidade ALTA, registrados linha a linha no `eslint.config.mjs` — porque a
fila anterior ordenava por "importa prisma cru" e **não registrava defeito**, então quem convertesse
pela ordem não saberia o que havia ali.

**A família reincidiu SEIS vezes no ciclo, sempre com a mesma forma: uma validação que confere que o
registro EXISTE e nunca que ele é da mesma empresa.**

| # | Onde | O que vazava |
|---|---|---|
| 1 | `core/audit/alerta.ts` | destinatários do alerta de rajada, o banco inteiro (fechado em `3744e64`) |
| 2 | `modules/whatsapp/notificacoes.ts` | fan-out do aviso de conversa — **vazamento vivo, com 11 linhas em disco** (§ 5.1) |
| 3 | `core/leads/service.ts` (3 pontos: `:60`, `:213`, `:381`) | responsável validado como existente e ativo, nunca como da mesma empresa |
| 4 | `core/tasks/service.ts` → `Lead` | `Task` da empresa A pendurada em `Lead` da B (`da2a402`) |
| 5 | `core/tasks/service.ts` → `Contact` | idem para contato: a lista de `/tasks` mostrava o **nome** de contato de outro cliente |
| 6 | `core/users/service.ts` → `redefinirSenha` | **tomada de conta** entre empresas (§ 5.2) |

**Nenhuma das seis foi achada por algo que o sistema fizesse sozinho.** Uma saiu de um rastro em
disco; as outras, de leitura dirigida. É esse fato — e não a contagem — que justifica a trava do § 4
existir: a saída não podia ser "lembrar de conferir empresa".

### 5.1 O fan-out de notificação — o único vazamento com prova em disco

`src/modules/whatsapp/notificacoes.ts:78`, em `marcarAguardandoHumano`:

```ts
// Todos os ativos. O usuário de sistema do WhatsApp é `ativo: false` no seed,
// então o filtro já o exclui — sem lista de exceções para alguém manter.
const ativos = await prisma.user.findMany({ where: { ativo: true }, select: { id: true } });
```

Sem empresa nenhuma, e logo abaixo uma `Notification` por usuário do banco **inteiro**. O rastro
medido antes do reparo: **11 linhas** `tipo: CONVERSA_AGUARDANDO`, `companyId: "company-migracao-1a"`
(a empresa real), `userId` de usuários de **8 empresas de teste**, cada uma carregando
`payload: { nomeExibicao: "Cliente ···4062", conversationId }`. Rótulo de cliente de uma empresa
entregue no sino de gente de outra.

O comentário é a parte instrutiva: foi escrito **antes de a tenancy existir**, e o raciocínio dele é
sobre o usuário de sistema do seed, não sobre empresa. Continuou verdadeiro sobre o que afirmava e
falso sobre o que o código precisava fazer — e por isso ninguém o releu.

Duas coisas foram medidas em vez de presumidas na correção: o usuário de sistema **tem**
`Membership` (o filtro de empresa **não** o exclui; quem continua excluindo é `ativo: false`), e a
consulta passou a partir de `Membership`, que é o que define "pessoa desta empresa".

**O achado mais fino foi no teste, não no código.** Três casos já existentes afirmavam
`toHaveLength(await prisma.user.count({ where: { ativo: true } }))` — **a mesma consulta sem empresa
que o defeito tinha**. Com uma empresa só no banco os dois números coincidem, então a suíte passava
por cima do vazamento sem enxergá-lo. O teste espelhava o bug.

E a consequência em cadeia, que envenenava o banco compartilhado: o vazamento entregava avisos a
usuários de teste → a FK `Notification_userId_fkey` (RESTRICT) barrava o `deleteMany` do `afterAll`
→ o arquivo deixava 11 usuários e 8 empresas para trás → **toda execução seguinte** falhava no
`beforeAll` por e-mail duplicado. O sintoma (`Unique constraint`) não aponta para a causa (uma FK
barrando limpeza duas execuções atrás). Quatro fixtures foram corrigidas na mesma varredura, e
`tasks.test.ts` foi conferida e **não** tocada, porque o usuário dela é `ativo: false`.

### 5.2 `redefinirSenha` — tomada de conta, não vazamento de leitura

`src/core/users/service.ts`, alcançado por `redefinirSenhaAction`. O caminho inteiro:
`exigirGestorDeUsuarios()` provava que **quem age** tem `gerenciar_usuarios` (só ADMIN), e **nada,
em lugar nenhum do caminho, provava coisa alguma sobre o ALVO**. `entrada.id` vem do cliente — Server
Action é endpoint HTTP público, e a lista de `/usuarios` na tela não é a fronteira.

Resultado: um ADMIN da empresa A redefinia a senha do ADMIN da empresa B **e entrava com ela**. É o
pior item da fila inteira, e a única categoria diferente de todos os outros 32: não é leitura de
dado alheio, é tomada de conta.

Duas coisas agravam o caso. Primeiro, `recusarContaDeSistema` **dá a impressão** de que o alvo é
filtrado — e é, contra UMA conta, a do robô do WhatsApp; empresa, nunca. Segundo, e este é o ponto
desconfortável: **as três funções vizinhas do mesmo arquivo já faziam certo.** `atualizarUsuario`,
`definirAtivo` e `garantirQueSobraAdmin` já recebiam `companyId` e já recusavam quem não tem vínculo
naquela empresa. A omissão era de **uma função só**, no meio de vizinhas corretas — o que descarta
"ninguém sabia como fazer" e deixa só "ninguém conferiu".

O teste tem as **duas metades**, e a de recusa **lê o `senhaHash` de volta do banco**: sem isso, uma
implementação que gravasse e só depois lançasse passaria — e a conta estaria tomada do mesmo jeito.

A mensagem de erro é, palavra por palavra, a mesma de "não existe". Distinguir "não existe" de
"existe, mas é de outra empresa" confirmaria, a quem sonda ids, que aquele cuid pertence a alguém.

### 5.3 O que o Ciclo 1d fechou, e o que ele mostrou

Os 31 restantes caíram em cinco blocos (`fe4d13a`, `6d6ab46`, `21094d3`, `782a850`,
`b65846d..5f6dc65`), levando a fila de 19 a 0. O que vale registrar não é a contagem:

- **`core/pipeline/` (13 defeitos)** — nenhuma assinatura recebia `companyId`; não era conversão,
  era redesenho de interface. `definirEtapaDeFechamento` fazia
  `updateMany({ where: { ehGanho: true } })` **sem empresa**: desligava a etapa de ganho de TODAS as
  empresas de uma vez. `excluirEtapa` movia leads para etapa de outra empresa.
- **`modules/whatsapp/` (6)** — o pior não era leitura: `responderComoHumano` **enviava uma mensagem
  de WhatsApp de verdade** pela instância Evolution da outra empresa, para o cliente dela, com o
  número dela. O teste daquele caso afirma que o gateway **não foi chamado** — "a função lançou" não
  provaria nada, porque lançar depois do envio passaria igual e continuaria vazando.
- **`podarNotificacoes`** apagava a tabela **inteira**, de todas as empresas, disparada pela
  navegação de qualquer uma.
- **`/conversas/page.tsx` não tinha sessão nenhuma**, e `/contatos/page.tsx` tinha sessão e não a
  usava (um `Promise.all` disparava a busca em paralelo, antes de a empresa existir).
- **Testes que mockavam `usuarioAtual()` com o modelo `User` do Prisma ficariam VERDES repassando
  `companyId: undefined`** — achado em dois blocos.

**A prova mais forte do ciclo inteiro:** no RED do pipeline, `definirEtapaDeFechamento` desligou o
`ehGanho` da etapa "Fechado" **da empresa do seed**, que não participava de fixture nenhuma. O
vazamento alcançou uma empresa que o teste nem tinha tocado.

E uma armadilha de teste que apareceu **três vezes**: caso que passa no RED **pelo motivo errado** —
a assinatura nova faz o código velho ler a empresa como id e "não achar nada". Resolvida com sonda
temporária de assinatura ANTIGA que **afirma o vazamento**. Sem ela, três blocos teriam declarado
RED falso.

---

## 6. Erros meus, do controlador

O ledger (`.superpowers/sdd/progress.md`) registra estes, e eles são de planejamento, não de
implementação. Ficam aqui porque uma auditoria que só listasse o que os subagentes erraram estaria
contando metade.

1. **"Escopo só em leads neste ciclo"** — decisão minha, e ela não sobrevive a `companyId NOT NULL`.
   A coluna obrigatória força **todo** `create` do sistema: 71 erros de tipo em 13 arquivos de
   `src/` no instante seguinte à Task 1. **Não existe "um serviço por vez" com coluna obrigatória.**
2. **Não previ os leitores de `User.papel` fora de `hasPermission` — três vezes.** O pré-voo já
   tinha achado um conflito (o DROP na Task 1 antes de a Task 2 parar de ler), e mesmo depois de
   mover o DROP, um **terceiro** grupo apareceu — incluindo `core/audit/alerta.ts`, que é produção e
   é uma feature de segurança. A coluna teve de ser restaurada (§ 2), e a dívida virou ⚠️ R4.
3. **Chamei `ADD nullable → backfill → SET NOT NULL` de "padrão seguro"** ao planejar a restauração
   de `User.papel`. Esta base tem uma guarda contra exatamente isso —
   `tests/unit/migracoes-seguras.test.ts` — escrita a partir de um incidente real, com o SQL
   anexado: a migração `20260813200000_contato_cadastro_completo` criou `Contact.atualizadoEm` como
   `NOT NULL` sem `DEFAULT`, e como banco de desenvolvimento e produção são **o mesmo**, o cliente
   Prisma antigo continuou emitindo `INSERT INTO "Contact" (id, nome, telefone, email)` — sem a
   coluna nova — e o Postgres recusou com `23502`. O estrago não ficou na tela de contatos:
   `encontrarOuCriarContact` (`core/leads/dedupe.ts`) é o ponto único por onde passa toda criação de
   lead com telefone ainda não cadastrado.
   A migração deste ciclo entrou na lista `PERDOADAS` **com justificativa escrita e com data de
   validade** — não vale mais no dia do deploy publicado, e a tarefa que derrubar `papel` de novo
   **não herda a isenção** (✅18). E a alternativa óbvia (`DEFAULT` acrescentado e derrubado na
   mesma migração) foi recusada por motivo próprio: um `DEFAULT` em `papel` atribuiria papel de
   autorização **em silêncio** a qualquer `INSERT` futuro que esquecesse a coluna — do lado errado
   de um controle de acesso, seja qual for o valor escolhido.
4. **Defeitos meus nos briefs**, o mesmo padrão herdado do Ciclo 4: teste que não rodaria como
   colado, arquivo nomeado que não existe, evidência de comentário diluída ao dividir arquivo. Em
   várias ocasiões o implementador ou o revisor pegou; numa delas o subagente **se recusou a chutar**
   a origem da empresa em `ingest.ts` (webhook sem sessão nem registro) e estava certo — a saída foi
   `EVOLUTION_COMPANY_ID`, explícito, preguiçoso e falhando alto (⚠️ R5).

---

## ✅ Verificado e correto

| # | Item | Como foi verificado |
|---|---|---|
| 1 | `Company` e `Membership` existem, com RLS ligada e **zero políticas** | SQL no Postgres real via MCP sobre `pg_class`/`pg_policies` → `[{"tabela":"Company","rls":true,"politicas":0},{"tabela":"Membership","rls":true,"politicas":0}]` |
| 2 | As 11 tabelas com `companyId` o têm `NOT NULL`, com FK e com índice em que ele é a **primeira** coluna | SQL sobre `pg_attribute`/`pg_constraint`/`pg_index`, filtrado por `relkind='r'` → 11 linhas, todas `not_null:true, tem_fk:true, indice_prefixo:true` (`AuditLog`, `BotConfig`, `Contact`, `Conversation`, `Lead`, `LeadNote`, `Membership`, `Notification`, `PipelineStage`, `Task`, `WhatsappMessage`) |
| 3 | `User` e `RateLimit` **não** têm `companyId` | `information_schema.columns` → `User tem companyId? 0` · `RateLimit tem companyId? 0` |
| 4 | `usuarioAtual()` devolve `UsuarioAtivo` com `companyId` e `papel` **vindo do vínculo** | `src/core/auth/usuario-ativo.ts` (a interface) + `src/core/auth/session.ts:95` + `tests/unit/usuario-ativo.test.ts`, caso "o papel devolvido é o do vínculo, e NÃO o de `User.papel`", montado com os dois valores **divergentes de propósito** (vínculo `VENDEDOR`, coluna `ADMIN`) |
| 5 | Zero vínculo lança `"Não autenticado"`; dois vínculos lançam `EmpresaAmbiguaError`, **distinto** | `tests/unit/usuario-ativo.test.ts`, dois casos nomeados; o segundo afirma `rejects.toBeInstanceOf(EmpresaAmbiguaError)` **e** `rejects.not.toThrow("Não autenticado")` |
| 6 | **Nenhuma das 26 chamadas de `hasPermission` foi editada** | `git diff 54127ac..HEAD -U0 -- src/ \| grep -E "^[+-].*hasPermission[(]"` → **uma única linha**, e é um comentário num arquivo apagado (`src/types/next-auth.d.ts`: "…é consumido por hasPermission()"), não uma chamada. `git grep -c "hasPermission[(]"` nos dois lados devolve a **mesma contagem em cada um dos 19 arquivos**; o total de linhas de chamada é 26 hoje e era 26 na base |
| 7 | `BotConfig` aceita uma linha por empresa e o **banco recusa a segunda** | `pg_index` → `CREATE UNIQUE INDEX "BotConfig_companyId_key" ON public."BotConfig" USING btree ("companyId")`, e `id` perdeu o `@default("bot-config")` (`column_default` ausente). **Provado tentando inserir** — ver bloco abaixo desta tabela |
| 8 | Nenhum `where: { id: "bot-config" }` sobrou no código | `grep -rn 'id: "bot-config"' src/ prisma/` → uma única ocorrência, dentro de um **comentário** em `prisma/migrations/20260819120000_tenancy_company_membership/migration.sql:231`, explicando a troca |
| 9 | Existe teste que prova que query escopada em A **não** devolve linha de B | 7 suítes de isolamento contra **duas empresas reais no Postgres** — `lead-isolamento` (17 casos), `task-isolamento` (24), `whatsapp-isolamento` (22), `pipeline-isolamento` (17), `contact-isolamento` (17), `audit-isolamento` (8), `notificacoes-isolamento` (8) = **113**; mais `escopo-empresa` (51) e a catraca (18) = **182**. Contados com `grep -cE '^[[:space:]]*(it\|test)\('` |
| 10 | O `prisma` cru é **inalcançável** de `src/core/**`, `src/modules/**` e `src/app/**` | `grep -rln '"@/lib/prisma"' src/` → exatamente **5** arquivos, e são exatamente os 5 da `EXCECAO_PERMANENTE`. Sonda executada nesta auditoria: criei `src/core/sonda-auditoria-descartavel.ts` importando `@/lib/prisma` e chamando `prisma.lead.findFirst`; `npx eslint` nele → `1:1 error '@/lib/prisma' import is restricted from being used by a pattern…  no-restricted-imports` · `✖ 1 problem (1 error, 0 warnings)`. Sonda apagada em seguida; `git status --short` sem saída |
| 11 | A fila temporária chegou a **zero** | `VIOLADORES_TEMPORARIOS_APP = []` literal em `eslint.config.mjs:383`; `_CORE` e `_MODULES` idem (só comentários entre os colchetes). Corroborado por ✅10: 5 importadores, 5 exceções permanentes, nenhuma sobrando e nenhum importador fora |
| 12 | Advisors de segurança do Supabase **sem regressão** | `get_advisors(security)` no projeto `uzumzfxjcxrbxaucvfsr` → **15** `rls_enabled_no_policy` nível INFO (`AuditLog`, `BotConfig`, `Company`, `Contact`, `Conversation`, `Lead`, `LeadNote`, `Membership`, `Notification`, `PipelineStage`, `RateLimit`, `Task`, `User`, `WhatsappMessage`, `_prisma_migrations`) e **2** WARN, os dois sobre `public.rls_auto_enable()` ser executável por `anon` e por `authenticated`. Bate exatamente com a linha de base prevista: 13 → 15, as duas tabelas novas entrando, e **sem política é o estado CORRETO por decisão** (§ 6 do spec). Nenhum achado além destes — zero regressão |
| 13 | Blindagem do banco intacta: **zero** grants para `anon`/`authenticated`, **zero** tabelas sem RLS | SQL via MCP sobre `information_schema.role_table_grants` + `pg_tables`/`pg_class` → `[{"grantee":"TABELAS_SEM_RLS","grants":0}]`; a **ausência de linha** para `anon` e `authenticated` no `group by` é o zero grants. Reexecutado depois do `npm test` desta auditoria, com o mesmo resultado |
| 14 | `npm run typecheck` verde | `tsc --noEmit` → exit 0, sem saída |
| 15 | `npm run lint` sem erro | `✖ 6 problems (0 errors, 6 warnings)`. Os 6 são pré-existentes: `lead-table.tsx:117` (TanStack Table), `proxy-matcher.test.ts:53` (diretiva `eslint-disable` órfã), `whatsapp-fila-vercel.test.ts:22` (3× parâmetro não usado) e `core/contacts/actions.ts:61` (`_ignorado`). O último está num arquivo que o ciclo **tocou**, mas a linha é idêntica à da base: `git show 54127ac:src/core/contacts/actions.ts \| grep -n _ignorado` → `61:  const { documento: _ignorado, ...resto } = dados;`, e no diff ela aparece como **contexto**, nunca como `+` |
| 16 | `npm run build` verde | 18 rotas listadas, `ƒ Proxy (Middleware)` presente |
| 17 | Suíte completa verde | `npm test` (`vitest run`, sozinho, nada em paralelo) → `Test Files 111 passed \| 1 skipped (112)` · `Tests 1195 passed \| 13 skipped (1208)` · `Duration 373.37s` · exit 0. **Esta execução reescreveu a senha do admin** — ver ⚠️ R1 e 🔍 NV5 |
| 18 | A isenção da migração de `User.papel` está **registrada com justificativa e prazo**, não afrouxada | `tests/unit/migracoes-seguras.test.ts`, entrada `20260819140000_restaura_user_papel_temporariamente` no mapa `PERDOADAS`: o porquê de ser seguro aqui (sem deploy publicado, logo sem a janela do `23502`), o porquê de **não** usar `DEFAULT` (atribuição silenciosa de papel de autorização), e a data de validade explícita ("volta a valer no dia do deploy publicado, e a tarefa que derrubar `papel` não herda a isenção") |
| 19 | As 4 unicidades **globais** que ainda bloqueiam a segunda empresa estão onde o ledger diz | `pg_index` com `indisunique` → `Contact_telefone_key`, `Conversation_waId_key`, `PipelineStage_ordem_key`, `WhatsappMessage_idExterno_key` — todas de **uma coluna só**, nenhuma composta com `companyId`. Ver ⚠️ R2 |

**Prova de ✅7 por inserção tentada.** Foi a única escrita que esta auditoria mandou ao banco,
construída para falhar e para não criar nada caso a premissa não valesse (se não houvesse linha para
aquela empresa, o `SELECT` devolveria zero linhas e nada seria inserido):

```sql
insert into "BotConfig" (id, ativo, "personaNome", "personaPapel", regras, faq,
                         "atualizadoEm", "atualizadoPorId", "companyId")
select 'sonda-auditoria-1a', ativo, "personaNome", "personaPapel", regras, faq,
       "atualizadoEm", "atualizadoPorId", "companyId"
from "BotConfig" where "companyId" = 'company-migracao-1a' limit 1;
```

```
ERROR: 23505: duplicate key value violates unique constraint "BotConfig_companyId_key"
DETAIL: Key ("companyId")=(company-migracao-1a) already exists.
```

E a confirmação de que nada ficou para trás:

```sql
select count(*) as linhas_botconfig,
       count(*) filter (where id='sonda-auditoria-1a') as sonda_gravada from "BotConfig";
-- [{"linhas_botconfig":1,"sonda_gravada":0}]
```

(Uma primeira tentativa, com `select *`, colidiu antes em `BotConfig_pkey` — provando o truque
antigo e não o novo. Foi refeita com id distinto para que a constraint exercitada fosse a de
empresa, que é a que importa aqui.)

---

## ⚠️ Riscos

### R1 — O banco de teste **não é separado** do de desenvolvimento (bloqueio antes de publicar)

`npm test` é `vitest run` contra o Postgres real do Supabase. Quatro consequências medidas, não
supostas:

1. **A senha do admin volta a ser um literal versionado a cada execução.** `seed.test.ts:185` grava
   `"outraSenhaDeTeste789"` no `senhaHash` de `admin@exemplo.com` e `vendedor@exemplo.com`. O Ciclo
   0 já tinha removido o `afterAll` que gravava `senha123`; **a classe do problema não saiu**, só o
   literal.
2. **Duas execuções simultâneas de `vitest` envenenam o banco.** Foi a explicação real das falhas
   "intermitentes" de `whatsapp-turno` na Task 4 — não era teste instável.
   `vitest.config.ts` já usa `fileParallelism: false` para a corrida *dentro* de uma execução; nada
   protege contra duas execuções.
3. **Fixture que não limpa envenena a execução seguinte**, e o sintoma não aponta para a causa
   (§ 5.1).
4. **Resíduo medido AGORA, nesta auditoria.** Depois de `npm test` terminar, o banco de
   desenvolvimento tem **6 `Company` órfãs** de fixture: `teste-users-service-outra-empresa`,
   `…-senha` e `…-busca`, em dois conjuntos idênticos criados às `08:07:08` e às `08:07:44` de
   2026-08-20 — ou seja, **duas execuções distintas anteriores à minha** (a minha começou 09:08:03).
   `User` e `Membership` estão limpos (4 e 4, todos legítimos), então a cadeia de e-mail duplicado
   descrita em § 5.1 **não** vai se repetir; o que sobra é acumulação silenciosa, porque
   `Company.nome` não é único e nada colide. Não é defeito de segurança; é a mesma causa raiz
   aparecendo por outro sintoma.
   ```sql
   select id, nome, "criadoEm" from "Company" order by "criadoEm";
   -- company-migracao-1a  n8necrm                                  2026-08-20 00:58:24
   -- cmt18m0ut000w306j…   teste-users-service-outra-empresa         2026-08-20 08:07:08
   -- cmt18m1et0010306j…   teste-users-service-outra-empresa-senha   2026-08-20 08:07:09
   -- cmt18m4an001c306j…   teste-users-service-outra-empresa-busca   2026-08-20 08:07:12
   -- cmt18mskf000w7g6j…   teste-users-service-outra-empresa         2026-08-20 08:07:44
   -- cmt18mt4h00107g6j…   teste-users-service-outra-empresa-senha   2026-08-20 08:07:45
   -- cmt18mvxk001c7g6j…   teste-users-service-outra-empresa-busca   2026-08-20 08:07:48
   ```

Este ciclo é o pior momento possível para essa confusão existir, porque ele mexe em `User` e no
papel. **Bloqueio duro antes de qualquer deploy público**, já registrado desde o Ciclo 0 e adiado
por decisão consciente do dono — não esquecido.

### R2 — Quatro unicidades **globais** bloqueiam a segunda empresa, e uma ficou mais cara

`Contact.telefone`, `Conversation.waId`, `PipelineStage.@@unique([ordem])` e
`WhatsappMessage.idExterno` são únicos no banco inteiro, não por empresa (✅19). Duas empresas
brigam pela ordem 1 do funil; o mesmo telefone não pode ser cliente de duas.

Inofensivas com uma empresa só — e é por isso que não são crítica hoje. Mas **`Conversation.waId`
atrapalha agora duas vezes**: com o `upsert` por `waId` recusado pelo escopo, a substituição é
`findFirst` escopado + `create`, e o `findFirst` escopado **não encontra** a conversa de outra
empresa com o mesmo `waId`. A corrida "dois webhooks do mesmo `waId` novo ao mesmo tempo", que o
**banco** resolvia, **voltou para o código**: cai num `catch` de `P2002` que aprendeu a distinguir
colisão de `idExterno` (redelivery — confirma, `duplicada: true`) de colisão de `waId` (corrida —
deixa subir; a Evolution reentrega e a segunda passagem encontra a conversa). Funciona, e é mais
frágil que uma constraint. **A pendência de schema ficou mais cara depois do Ciclo 1d, não menos.**

O que impede o caso hoje é a ponte `EVOLUTION_COMPANY_ID` (uma instância por deploy). **Nenhuma
segunda ponte foi inventada** para contornar as unicidades — isso é deliberado.

### R3 — Os quatro pontos cegos declarados do escopo (§ 3)

`$queryRaw` fora de alcance, leitura aninhada nunca filtrada, tipos que não acompanham o runtime, e
`$transaction` sem prova ponta a ponta. Estão **declarados no código**, com a origem da certeza à
vista, e cada um tem o contorno escrito. O risco não é defeito escondido; é alguém ler "o escopo é
obrigatório" e presumir mais fechamento do que existe. Três deles viram 🔍 NV1, NV2 e NV3.

### R4 — `User.papel` sobrevive como espelho, com dual-write

Duas colunas carregando papel, e papel é autorização (§ 2). Mitigado por nada ler a coluna para
decidir, e por um teste que trava exatamente isso com valores divergentes. Some quando os leitores
restantes (`core/audit/alerta.ts`, mais ~17 arquivos de teste unitário e 3 de e2e; ~80 arquivos ao
todo) migrarem para `Membership` — ciclo próprio.

### R5 — `EVOLUTION_COMPANY_ID` é ponte, e é segunda fonte de verdade sobre a conversa

`ingest.ts` não tinha origem de empresa (webhook sem sessão nem registro). A ponte é explícita,
preguiçosa e falha alto — o subagente **se recusou a chutar**, e estava certo. Mas a empresa do
`TurnoJob` continua sendo um valor sobre o qual duas coisas poderiam discordar, ainda que venha de
origem autenticada e falhe fechado. O Ciclo 2 a remove, quando a conexão Evolution virar linha de
tabela com `companyId` e a empresa voltar a ser **derivada**.

### R6 — Nove chamadas ainda resolvem a empresa por um vínculo **arbitrário**

`companyIdDoUsuario` faz `findFirstOrThrow` sobre `Membership`: para quem tem dois vínculos, pega um
qualquer. Restam 9 chamadas (`leads/service.ts` ×6, `leads/notes.ts` ×3), medidas em 2026-08-20 com
`grep -rn "await companyIdDoUsuario" src/`. O Ciclo 1d cortou três usos (`audit/log.ts`,
`audit/alerta.ts`, `tasks/service.ts`). Inalcançável hoje (um vínculo por pessoa, e `usuarioAtual()`
lança se houver dois), e concentrado em nove linhas visíveis num módulo só, em vez de espalhado.
Dívida do Ciclo 2: a origem passa a ser `UsuarioAtivo.companyId`.

---

## ❌ Herdado, não corrigido aqui

Esta auditoria cobre o que o Ciclo 1a e o 1d mudaram no CRM. Os achados de **infraestrutura** que
esta base já registrou continuam abertos: nenhum introduzido aqui, nenhum corrigido aqui. Estão
escritos em `docs/superpowers/specs/2026-08-19-ciclo-4-fluxos-n8n-design.md`, seção "Achados fora do
escopo deste ciclo, registrados porque foram vistos", e repetidos em
`docs/auditorias/2026-08-19-ciclo-4-fluxos.md`. Ficam citados aqui pelo mesmo motivo de lá: um
relatório de "0 críticas em aberto" não fica de pé sem eles, porque quem lesse só este documento
sairia acreditando que a infraestrutura não tem problema crítico nenhum.

1. **`N8N_ENCRYPTION_KEY=nateksoft`** — é a chave que criptografa **todas as credenciais salvas no
   n8n** (tokens de WhatsApp, OAuth e API keys de todos os workflows de cliente), adivinhável a
   partir do nome da empresa. Trocar exige reencriptar as credenciais existentes: é projeto, não
   ajuste de branch.
2. **A chave global da Evolution é `nateksoft`** — cria, apaga e lê qualquer instância. Um
   `GET /instance/fetchInstances` com ela devolveu número de telefone e foto de perfil.
3. **Senha reusada** — `DB_POSTGRESDB_PASSWORD` do n8n é a mesma senha do projeto Supabase do CRM.
   Este item toca esta branch de perto: é o **mesmo Postgres** onde `Company` e `Membership` acabaram
   de nascer, e onde a blindagem de ✅13 é medida.
4. **O JWT da API do n8n não expira** (sem claim `exp`).

Do Ciclo 4 segue aberto também o **R1 daquela auditoria**: as ações destrutivas de fluxo
(`ativar`/`desativar`/`apagar`) não têm teto de taxa. Decisão do dono, inalterada por este ciclo.

E do Ciclo 0, o **bloqueio do banco de teste** — que aqui reaparece como R1 com medição nova.

---

## 🔍 Não verificados

| # | Item | Por que não deu | O que destravaria |
|---|---|---|---|
| NV1 | Que `include`/`select` através de `User` atravessa a empresa **contra o Postgres real** | Foi **deduzido** do schema (`User` não tem `companyId`; relação inversa não carrega filtro) e **medido** só sobre o banco falso do teste, onde se confirma que o `include` chega intacto ao motor. Medir de verdade exige duas empresas com o mesmo usuário vinculado às duas — estado que `usuarioAtual()` hoje recusa | Criar por SQL um segundo `Membership` para um usuário, criar `Lead` nas duas empresas, e rodar `prismaDaEmpresa(A).lead.findMany({ include: { responsavel: { include: { leadsAtribuidos: true } } } })` afirmando que aparecem leads de B. Depois **apagar o segundo vínculo** — enquanto ele existir, aquele usuário não consegue entrar |
| NV2 | `$transaction` ponta a ponta contra o Postgres carregando a extensão | Verificado só na **fábrica** do cliente interativo (leitura do runtime, duas vias) e pelo caminho curto `prismaDaEmpresa(id).$transaction(cb)`; um `$transaction()` completo contra o banco real não foi exercitado | Teste de integração que abra `prismaDaEmpresa(A).$transaction(async (tx) => tx.lead.findMany({}))` contra o Postgres com linha de B presente, afirmando que ela não vem |
| NV3 | Que `$queryRaw` de fato escapa da extensão | É afirmação sobre o **contrato** (`$allOperations` alcança delegates de modelo; `$queryRaw` é método do cliente), não medição. Exercitá-la faria uma consulta descer até o motor, e o banco falso do teste é montado justamente para que nada desça | Com linhas de A e de B no banco, rodar `prismaDaEmpresa(A).$queryRaw` de um `SELECT count(*) FROM "Lead"` e afirmar que o total é o das **duas** empresas |
| NV4 | Comportamento real do CRM com **duas empresas** na interface | Impossível hoje: as 4 unicidades globais (R2) impedem duas empresas de coexistirem com funil, contatos e conversas próprios, e a UI é de empresa única por decisão travada. As suítes de isolamento cobrem o **serviço** com duas empresas reais (✅9), nunca a tela | Fechar R2 (unicidades compostas com `companyId`) e só então montar o cenário de ponta a ponta |
| NV5 | Estado do banco de desenvolvimento **depois** desta auditoria quanto à senha do admin | `npm test` rodou aqui e reescreveu o `senhaHash` (⚠️ R1). Esta auditoria **não rotaciona senha** — não tem, nem deve ter, o valor novo, e nada deste documento pode conter senha | `SEED_PASSWORD=<valor forte gerado>` + `npx prisma db seed`, e depois `bcrypt.compare` provando que `"outraSenhaDeTeste789"` **não** autentica mais, para `admin@exemplo.com` e `vendedor@exemplo.com` |

---

## Só um humano pode fazer

1. **Rotacionar a senha do admin agora.** `npm test` rodou nesta auditoria (✅17) e gravou
   `"outraSenhaDeTeste789"` — literal público deste repositório — no `senhaHash` de
   `admin@exemplo.com` e `vendedor@exemplo.com`. É NV5, e é a única pendência operacional imediata
   deste documento.
2. **Decidir R1** — banco de teste separado do de desenvolvimento. Está registrado como bloqueio
   duro antes de qualquer deploy público desde o Ciclo 0, e cada ciclo que passa aumenta o custo:
   este mexeu em `User` e no papel. As 6 `Company` órfãs medidas em R1 podem ser apagadas de
   passagem, mas apagá-las não é a correção.
3. **Decidir R2** — as 4 unicidades compostas com `companyId`. `Conversation.waId` encabeça, porque
   além de bloquear a segunda empresa ela é o que reabriu a corrida no `ingest`.
4. **Decidir quando `User.papel` cai** (R4). Enquanto a coluna existir, existem duas fontes de
   verdade sobre autorização, e o que impede a divergência é um teste, não o schema.
5. **Rodar NV1, NV2 e NV3** se quiser fechar os pontos cegos declarados do escopo com medição em vez
   de dedução. Nenhum é defeito conhecido; os três são afirmações que hoje se apoiam em contrato e
   em leitura de runtime.
