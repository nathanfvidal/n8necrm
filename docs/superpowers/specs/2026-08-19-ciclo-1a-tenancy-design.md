# Ciclo 1a — Tenancy: Company, Membership e escopo obrigatório

Data: 2026-08-19
Status: aguardando revisão
Spec do programa: `2026-08-19-n8necrm-fundacao-design.md`

## 1. O que este ciclo entrega

O modelo de dados multi-empresa por baixo da aplicação: as tabelas `Company` e
`Membership`, a coluna `companyId` nas tabelas de dado de tenant, o papel do
usuário saindo do `User` para o vínculo, e uma camada de query que **não deixa
esquecer** o escopo.

A interface continua servindo uma empresa só. Nada de seletor de empresa, nada
de tela nova.

## 2. Por que este ciclo existe separado

O Ciclo 1 original foi decomposto em 2026-08-19, depois de medir o tamanho real:

| Medida | Valor |
| --- | --- |
| Chamadas a `hasPermission()` em `src/` | 26 |
| Arquivos que tocam `.papel` | 25 |
| Arquivos que importam `config/client` | 14 |
| Modelos no schema | 12 |

Três subsistemas independentes, cada um entregável e testável sozinho:

- **1a (este)** — Company, Membership, `companyId`, papel no vínculo, escopo de query
- **1b** — emissão do JWT do Supabase e testes de isolamento
- **1c** — configuração de cliente saindo do arquivo versionado para o banco

O 1a vem primeiro porque é o mais arriscado: mover o papel é refatoração de
**autorização**, e errar não dá erro de compilação — dá permissão errada em
silêncio.

## 3. Decisões travadas

Cada uma foi decidida explicitamente em 2026-08-19.

1. **Vínculo muitos-para-muitos.** `Membership(userId, companyId, papel)`. A
   mesma pessoa pode estar em várias empresas com papéis diferentes — é o que
   permite entrar na conta de um cliente para dar suporte sem uma segunda conta.
2. **O papel sai do `User` e vive no vínculo.** Papel é relação entre pessoa e
   empresa, não atributo da pessoa: o mesmo indivíduo pode ser ADMIN na própria
   empresa e VENDEDOR na de um cliente.
3. **RLS: infraestrutura agora, política só onde for lida.** Este ciclo **não
   escreve política RLS nenhuma**. Ver a seção 6.
4. **UI de empresa única.** Sem seletor, sem tela de empresas.
5. **`config/client.ts` fica onde está.** É o Ciclo 1c.

## 4. Arquitetura

### A decisão que torna este ciclo verificável: preservar a forma

`usuarioAtual()` hoje devolve `Promise<User>` — o modelo do Prisma, que tem
`papel`. Os 26 lugares que autorizam fazem `hasPermission(usuario.papel, acao)`.

Se o retorno passar a ser um tipo próprio que **mantém o campo `papel`**,
resolvido a partir do vínculo em vez da coluna, **nenhuma das 26 chamadas
muda**:

```ts
export interface UsuarioAtivo {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  /** Empresa ativa desta requisição. */
  companyId: string;
  /** Papel do usuário NESTA empresa — vem de `Membership`, não de `User`. */
  papel: Role;
}
```

É o mesmo raciocínio que fez a refatoração da fila do Ciclo 0 ser verificável:
**o sucesso se mede pelo que não muda.** Se um consumidor de `usuarioAtual()`
precisar ser editado, a refatoração vazou.

Isso não é economia de digitação: cada `hasPermission` editado à mão é uma
chance de trocar a ação, inverter a condição ou esquecer o `!`. Vinte e seis
oportunidades de introduzir uma falha de autorização que nenhum compilador pega.

**O que muda de propósito:** o tipo deixa de ser o modelo do Prisma. Quem
dependia de campo de `User` que não está em `UsuarioAtivo` (por exemplo
`senhaHash`) para de compilar — e isso é bom, porque nada fora de `core/auth`
tem por que ler o hash de senha.

### Qual empresa está ativa

Com vínculo muitos-para-muitos, a pergunta "qual empresa?" passa a existir.
Neste ciclo, a resposta é resolvida no servidor e não é escolhida pelo usuário:

- **Um vínculo** — é aquele.
- **Nenhum vínculo** — `usuarioAtual()` lança, mesmo tratamento de usuário
  desativado. Conta sem empresa não é uma conta usável, e deixá-la entrar num
  estado sem escopo é exatamente como vazamento entre tenants começa.
- **Mais de um vínculo** — **lança**, com mensagem que nomeia a situação
  ("sua conta está vinculada a mais de uma empresa e o seletor ainda não
  existe").

A última é a decisão que mais importa deste ciclo, e ela mudou durante o
desenho. A primeira versão escolhia "o vínculo mais antigo". Isso é um chute com
cara de regra: nada no domínio diz que o vínculo mais antigo é o que a pessoa
quer, e o modo de falha é ler dado da **empresa errada** — vazamento entre
clientes de verdade, que aparece como dado "sumindo" e desaparece quando alguém
vai investigar.

Falhar alto custa **zero hoje**: a migração cria exatamente um vínculo por
pessoa, então a situação é inalcançável. E o dia em que alguém criar o segundo
vínculo por SQL, o erro aparece imediatamente, apontando para a causa — em vez
de a aplicação seguir servindo dado de uma empresa que ninguém escolheu.

Escolher em silêncio troca um erro impossível hoje por um bug invisível depois.

### Quem recebe `companyId`, e quem não

**Recebem** — são dado de tenant: `Contact`, `PipelineStage`, `Lead`,
`LeadNote`, `Task`, `Notification`, `Conversation`, `WhatsappMessage`,
`AuditLog`, `BotConfig`.

**Não recebem:**

- **`User`** — a relação com empresa é `Membership`, não coluna. Uma pessoa
  existe independentemente de empresa.
- **`RateLimit`** — é `chave String @id`, indexada por IP ou identificador
  opaco. Infraestrutura global, não dado de tenant: o teto de tentativas de
  login de um IP não pertence a empresa nenhuma. Se um dia o limite precisar
  ser por empresa, a empresa entra na **composição da chave**, não numa coluna
  nova.

### A armadilha do `BotConfig`

`BotConfig` hoje é **linha única imposta pelo banco**, por um truque:

```prisma
id String @id @default("bot-config")
```

Um segundo `create` sem id explícito colide na chave primária. O comentário do
schema explica que isso existe para "nenhum código precisar perguntar qual das
linhas é a certa".

Config por empresa **quebra esse truque**, e trocá-lo é obrigatório:

- `id` passa a `@default(cuid())`
- a unicidade passa a ser `@@unique([companyId])` — uma config por empresa,
  imposta pelo banco do mesmo jeito, por outro caminho
- `prisma/seed.ts` semeia por empresa, não por id constante
- todo lugar que busca `where: { id: "bot-config" }` passa a buscar por
  `companyId`

Este é o tipo de mudança que o compilador não pega: `findUnique({ where: { id:
"bot-config" } })` continua compilando e passa a devolver `null` para sempre.

### A camada de escopo, e por que ela não é opcional

`companyId` numa coluna não protege nada sozinho. O que protege é não haver
caminho de leitura que **possa** esquecer o filtro.

Este ciclo entrega, em `src/core/`, uma forma de consultar que **exige** o
escopo — passado explicitamente, e não lido de um estado global. A forma exata
fica para o plano, mas a régua é:

> Esquecer o escopo tem que ser **erro de compilação**, não revisão de código
> atenta.

O motivo de não usar variável global de request (`AsyncLocalStorage` e
parentes): funciona até o primeiro caminho que roda fora do ciclo de request —
um job de fila, um seed, um script. E é justamente nesses caminhos que ninguém
está olhando.

**RLS não substitui isso.** O Prisma conecta com papel dono de tabela, que
ignora política de linha. Esta camada é a única defesa do caminho da
aplicação; o RLS defende o caminho do navegador, e é o Ciclo 1b/3.

### A migração dos dados existentes

O banco já tem dados semeados sem `companyId`. A migração precisa, na ordem:

1. criar `Company` e `Membership`
2. criar **uma** empresa para os dados que já existem
3. criar vínculo de cada `User` existente com ela, **carregando o papel que
   hoje está na coluna `User.papel`**
4. acrescentar `companyId` **nulo** nas tabelas de tenant
5. preencher com a empresa criada
6. só então tornar `NOT NULL` e criar as FKs

Acrescentar `NOT NULL` de uma vez numa tabela com linhas falha. E a ordem 3
antes de 5 importa: o papel tem que ser copiado **antes** de a coluna
`User.papel` sair, senão a informação se perde.

**`User.papel` sai neste mesmo ciclo**, e essa decisão também mudou durante o
desenho.

> **Não saiu no Ciclo 1a.** Três tentativas, três grupos de leitores
> descobertos tarde, e uma migração de restauração no mesmo dia. Saiu no Ciclo
> 1f, em 2026-08-21 — ver
> `docs/superpowers/plans/2026-08-21-n8necrm-ciclo-1f-derrubar-user-papel.md`.

A primeira versão mantinha a coluna por um ciclo, com o argumento de que
"enquanto as duas fontes existirem, divergência é detectável". Detectável por
quem? Nada iria conferir. E duas fontes de verdade para **autorização** não são
uma rede de segurança — são a própria falha esperando alguém ler a errada.

O que substitui o argumento é verificação no momento certo: **a migração
confere**, antes de derrubar a coluna, que todo usuário tem vínculo com
exatamente o papel que a coluna dizia, e **falha** se algum não tiver. Isso
transforma "detectável depois por ninguém" em "verificado agora ou nada é
apagado".

Concretamente, o passo de remoção só executa depois de um `DO $$ ... $$` que
levanta exceção se existir `User` sem `Membership` correspondente, ou com papel
diferente do que está na coluna.

### Índices

Toda coluna `companyId` recebe índice. Não é otimização prematura: **toda**
query da aplicação passa a filtrar por ela, então é a coluna mais consultada do
schema depois das chaves primárias. Onde já existe índice composto que a query
usa, `companyId` entra como **primeira** coluna dele — índice composto só serve
a query que filtra pelo prefixo.

Exemplo concreto, do que já existe: `WhatsappMessage` tem
`@@index([conversationId, direcao, processadoEm])`, usado por `turno.ts` a cada
job. Com escopo por empresa, a query passa a ter quatro predicados, e o índice
precisa acompanhar.

## 5. O que este ciclo NÃO faz

- **Nenhuma política RLS.** Nem uma.
- Nenhuma emissão de JWT (1b).
- Nenhum movimento de `config/client.ts` (1c).
- Nenhum seletor de empresa, nenhuma tela de empresas, nenhum convite de
  usuário para empresa.
- Nenhuma mudança na matriz de permissões — os papéis e as ações são os mesmos;
  só a origem do papel muda.

## 6. Por que nenhuma política RLS aqui

A base fechou o caminho `anon`/`authenticated` de propósito, com três
migrations e um teste e2e que falha se isso regredir. Hoje as 13 tabelas têm
**RLS ligada e zero políticas** — default-deny — e o advisor do Supabase
confirma isso como INFO, não como defeito.

Escrever política de `companyId` nas 13 tabelas agora **reabriria** a API
pública do Supabase para tabelas que nenhum navegador consulta. Superfície nova
para zero benefício, e cada política é algo a manter e auditar.

A política de verdade nasce no Ciclo 3, na **uma** tabela que o navegador vai
ler, com `SELECT` apenas, junto do JWT que a torna verificável — e o
`banco-blindado.spec.ts` é atualizado para afirmar **essa exceção exata**, não
afrouxado.

**Detalhe apurado que ajuda:** o projeto tem um gatilho de evento da própria
plataforma Supabase, `public.rls_auto_enable()`, que liga RLS em toda tabela
criada no schema `public`. Então `Company` e `Membership` **nascem com RLS
ligada sozinhas**, em default-deny. Não há passo a lembrar; há um passo a
verificar.

(O advisor marca essa função como `SECURITY DEFINER` chamável por `anon` via
`/rest/v1/rpc/`. É falso positivo: ela retorna `event_trigger`, e o Postgres
recusa invocação direta de função desse tipo.)

## 7. Critérios de aceite

- `Company` e `Membership` existem, com RLS ligada e zero políticas (o estado
  que o resto do schema já tem) — provado por consulta a `pg_tables`
- Toda tabela de tenant tem `companyId` **`NOT NULL`** com FK e índice —
  provado por consulta ao catálogo, não por leitura do schema
- `RateLimit` e `User` **não** têm `companyId`
- `usuarioAtual()` devolve `UsuarioAtivo` com `companyId` e `papel` vindo do
  vínculo
- **Nenhum dos 26 lugares que chamam `hasPermission` foi editado** — é o
  critério que prova que a refatoração não vazou
- Usuário sem vínculo não entra: `usuarioAtual()` lança, e a tela trata igual a
  usuário desativado
- `BotConfig` aceita uma linha por empresa e **recusa a segunda** para a mesma
  empresa — provado tentando inserir
- Nenhum `where: { id: "bot-config" }` sobrou no código
- Existe teste que prova que uma query com escopo de empresa A **não** devolve
  linha de empresa B
- Esquecer o escopo não compila — provado por um caso que o `tsc` recusa
- `npm run typecheck`, a suíte e `npm run build` verdes
- `get_advisors` de segurança sem achado novo em relação à linha de base de
  2026-08-19 (13 × `rls_enabled_no_policy` INFO, 2 × WARN do
  `rls_auto_enable`)

## 8. Dívidas que este ciclo declara

- **Seletor de empresa.** Com mais de um vínculo, `usuarioAtual()` lança. É
  inalcançável hoje (um vínculo por pessoa), e o dia em que deixar de ser, o
  erro aponta para a causa. O seletor é trabalho de outro ciclo.
- **Nada de convite/gestão de vínculo.** Criar vínculo é seed ou SQL até uma
  tela existir.

## 9. Bloqueio herdado

Do Ciclo 0, e vale antes de qualquer deploy público: **banco de teste separado
do de dev.** Enquanto a suíte unitária escrever no mesmo Postgres, a senha do
admin volta a ser um literal do repositório a cada `npm test` — e este ciclo,
que mexe em `User` e no papel, é o pior momento possível para essa confusão
existir.
