# Ciclo 1c — Configuração de cliente no banco

Data: 2026-08-20
Status: aguardando revisão
Spec do programa: `2026-08-19-n8necrm-fundacao-design.md`
Ciclos anteriores: `2026-08-19-ciclo-1a-tenancy-design.md` ·
`2026-08-20-ciclo-1b-jwt-isolamento-design.md` · auditoria do 1a em
`docs/auditorias/2026-08-19-ciclo-1a-tenancy.md`
Ponto de partida: branch `ciclo-1a-tenancy`, HEAD `6b90518`, árvore limpa

## 1. O que este ciclo entrega

A parte de `config/client.ts` que **não pode ser a mesma para duas empresas no
mesmo banco** passa a ter casa no banco, por empresa, e a interface do painel
passa a servi-la.

Concretamente: um modelo `CompanyConfig` (uma linha por empresa, opcional), uma
leitura escopada e memoizada por requisição que valida pelo **mesmo schema Zod
que hoje valida o arquivo**, o portão de módulos lendo do banco com `companyId`
explícito, e a marca da empresa aplicada no **layout do painel** — não na raiz.

**Nenhuma tela nova. Nenhuma permissão nova. Nenhum campo é apagado de
`config/client.ts`.** A seção 6 diz por que a fronteira está exatamente aqui, e
a 4.6 diz por que a tela é a parte errada de começar.

Isto é o que destrava a **decisão 8** do spec do programa ("Identidade do
produto: EM ABERTO"): depois deste ciclo, decidir a identidade deixa de ser
editar um arquivo versionado e virar um dado por empresa. O ciclo **não decide**
a identidade — ele constrói o lugar onde ela cabe.

## 2. O que foi medido antes de desenhar

Toda decisão da seção 4 se apoia em alguma linha desta tabela. Nenhuma delas é
lembrança.

| # | Medida | Valor | Comando / fonte |
| --- | --- | --- | --- |
| M1 | Arquivos que importam `config/client` ou `config/client.schema` | **14** (7 em `src/`, 6 em `tests/`, 1 em `prisma/`) | `grep -rn "config/client" src/ tests/ prisma/ scripts/` |
| M2 | Consumidores de PRODUÇÃO de `client.nome` | `src/app/layout.tsx` (metadata), `src/components/marca.tsx` (texto e `alt`), `prisma/seed.ts` (`Company.nome`) | `grep -rn "client\.\(nome\|vertical\|marca\|modulos\|entidade\|funil\|whatsapp\)" src/ tests/ prisma/` |
| M3 | Consumidores de produção de `client.vertical` | **zero** | mesmo grep de M2 — nenhuma linha em `src/` |
| M4 | Consumidores de produção de `client.whatsapp` | **zero** | mesmo grep — nenhuma linha em `src/` nem em `tests/` |
| M5 | Consumidores de produção de `client.entidade` | **zero**; a única leitura de `.campos` é `tests/unit/client-config.test.ts` | mesmo grep; e o comentário de `config/client.ts:38-47`, que já registrava isto |
| M6 | Consumidores de produção de `client.marca` | `src/app/layout.tsx` (`fonteDaMarca`, `derivarTema`), `src/components/marca.tsx` (`logo`) | mesmo grep |
| M7 | Leitura de `client.marca.nome` em qualquer lugar | **zero** — `marca.tsx` lê `client.nome`, não `client.marca.nome` | mesmo grep |
| M8 | Consumidores de `client.modulos` | `src/lib/module-gate.ts` (único), com 6 pontos de chamada de `moduloAtivo`/`exigirModulo` em `src/app/(painel)/**` e 2 em `src/components/painel-nav.tsx` | `grep -rn "moduloAtivo\|exigirModulo" src/ tests/` |
| M9 | Consumidores de `client.funil` | `prisma/seed.ts`, e só como **semente de instalação** (`if (quantasEtapasExistem === 0)`) | `prisma/seed.ts:94-110` e o comentário logo acima |
| M10 | Rotas ESTÁTICAS hoje | **1** — `/_not-found`. As outras 21 já são `ƒ` (dinâmicas), `/login` inclusive | `npm run build` em 2026-08-20 (tabela colada na seção 7) |
| M11 | Por que `/login` já é dinâmica | ela chama `usuarioAtual()` → `auth()` → cookies | `src/app/login/page.tsx:30` |
| M12 | Modelos de tenant hoje | **11**, e `BotConfig` é o único com `companyId` único | `src/core/tenancy/escopo.ts:250-262` e `tests/unit/escopo-empresa.test.ts:811-822` |
| M13 | Exceções do lint ao prisma cru | **5 permanentes, 0 temporárias** (as três listas `VIOLADORES_TEMPORARIOS_*` estão vazias) | `eslint.config.mjs:161,278,383,428`; catraca em `tests/unit/catraca-prisma-cru.test.ts:108` (`LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS = 0`) |
| M14 | Todas as 6 páginas com portão de módulo já resolvem sessão | as 6 chamam `usuarioAtualOuLogin()` no mesmo corpo | `grep -n "usuarioAtual\|exigirModulo\|moduloAtivo" src/app/(painel)/{conversas,fluxos,contatos}/**` |
| M15 | O layout do painel já tem `companyId` em mãos | `usuario.companyId`, usado em `listarNotificacoesNaoLidas` | `src/app/(painel)/layout.tsx:88-90` |
| M16 | O layout do painel já é `force-dynamic` | `export const dynamic = "force-dynamic"` | `src/app/(painel)/layout.tsx:21` |
| M17 | A fonte não é obstáculo | as 4 fontes de `FONTES` já são empacotadas em const de escopo de módulo e `fonteDaMarca(nome)` escolhe em runtime | `src/lib/tema/fontes.ts` |
| M18 | `--font-marca` é reavaliada por elemento | `@theme inline` faz `font-sans` virar `font-family: var(--font-marca)`, e `html { @apply font-sans }` é a única aplicação hoje | `src/app/globals.css:10-12` e `:120-129` |
| M19 | `next/font/google` **não funciona sob Vitest** | importar `src/lib/tema/fontes.ts` num teste lança `TypeError: Geist is not a function` — as funções de fonte são substituídas por um plugin do bundler do Next e, fora dele, o módulo não exporta função nenhuma | teste-sonda descartável em `tests/unit/`, rodado e apagado em 2026-08-20 |

## 3. A costura do spec do programa muda em dois pontos — e é medição que muda

As linhas 204-214 de `2026-08-19-n8necrm-fundacao-design.md` dizem:

> `config/client.ts` [...] carrega o nome do produto, o funil padrão e a
> **entidade do negócio** (hoje "Veículo", com marca/modelo/ano/km/câmbio). Isso
> serve perfeitamente ao modelo original [...] e é **incompatível com
> multi-empresa** [...] O Ciclo 1 move essa configuração de arquivo para tabela.

E a linha 90 da tabela de ciclos diz: *"Entidade, funil e marca saem de
`config/client.ts` para tabela por empresa"*.

**Duas metades daquilo caíram na medição.**

### 3.1 A entidade não existe mais como caminho vivo

O parágrafo foi escrito sobre a base original, onde a entidade era "Veículo" com
campos de verdade movendo telas. Nesta base ela não move nada: `entidade.campos`
tem **zero consumidores** (M5), e `prisma/schema.prisma:75-78` registra que o
caminho de campos configuráveis **"foi desenhado e descartado"** em favor de
colunas fixas no modelo `Lead`. O comentário de `config/client.ts:38-47` já
dizia a mesma coisa, com o grep que a sustenta.

A premissa do spec do programa ("duas empresas não podem ter entidades
diferentes se a entidade mora num arquivo") continua logicamente correta e
**vazia na prática**: duas empresas não têm entidades diferentes porque nenhuma
empresa tem entidade nenhuma. Mover `entidade` para o banco não daria a duas
empresas capacidade que uma sozinha não tem — daria uma tabela com dado que
ninguém lê, com aparência de recurso.

### 3.2 O funil já está no banco desde antes deste programa

`client.funil` é **semente de instalação**, não configuração viva (M9). Quem
manda no funil é `PipelineStage` — que já tem `companyId` desde o Ciclo 1a — e a
tela `/etapas` (ADMIN, permissão `gerenciar_funil`) cria, renomeia, recolore,
reordena e remove etapa. `prisma/seed.ts:94-99` registra por que a
reconciliação a partir do arquivo foi **removida**: ela era destrutiva no dia em
que a tela existiu.

Ou seja: a metade "funil" desta linha do spec do programa **já foi entregue**,
por outro ciclo, e refazê-la seria desfazer aquilo.

### 3.3 O que sobra, e é o que este ciclo faz

Sobram **marca** e **módulos**. A marca porque ela é a razão de ser do
white-label e hoje mora num arquivo de build. Os módulos porque "quais módulos
esta empresa tem" é a única linha de `config/client.ts` que descreve um fato
**comercial por empresa**, e é justamente o que uma segunda empresa mudaria.

Este spec substitui a linha 90 da tabela de ciclos por: *"**marca e módulos**
saem de `config/client.ts` para tabela por empresa; entidade e funil ficam onde
estão, pelos motivos de 3.1 e 3.2"*. O resto do spec do programa continua
correto.

## 4. Decisões deste spec

Cada uma foi tomada aqui, com o motivo. Nenhuma fica em aberto.

### 4.1 O que vai para o banco, e o que FICA no arquivo

**Decisão, bloco a bloco:**

| Bloco | Vai? | Por quê |
| --- | --- | --- |
| `nome` | **Já foi** — não ganha coluna | O nome por empresa já tem casa: `Company.nome`, criada no Ciclo 1a, e é dela que o seed tira o valor hoje (`prisma/seed.ts:87`). Criar `CompanyConfig.nome` seria uma **segunda fonte de verdade sobre o nome da empresa**, e a primeira coisa que duas fontes fazem é divergir. O arquivo mantém `nome` como o nome do PRODUTO — o que aparece em `/login`, onde ainda não há empresa. |
| `vertical` | **Fica** | Zero consumidores (M3). É o marcador escrito da decisão 8 do spec do programa, e o lugar de um marcador de decisão é o arquivo versionado, onde ele é lido por quem abre o repositório — não uma coluna que ninguém consulta. |
| `marca.nome` | **Não vai, e não ganha coluna** | Zero leituras (M7). O nome exibido pela marca é `Company.nome`; o campo do schema é paridade de forma herdada da base. Fica no arquivo, sem consumidor, como está hoje. |
| `marca.corPrimaria` | **VAI** | É o white-label. Duas empresas com a mesma cor primária é exatamente o que este ciclo existe para desfazer. |
| `marca.fonte` | **VAI** | Mesma razão, e M17 mostra que não há obstáculo técnico: as quatro fontes da lista fechada já estão empacotadas e a escolha já é em runtime. |
| `marca.logo` | **VAI** (duas colunas, `logoClaro` e `logoEscuro`) | Mesma razão. Continua opcional e continua **os dois ou nenhum** — ver 4.4. |
| `modulos` | **VAI** | É o único bloco que descreve um fato comercial por empresa. Empresa A com `whatsapp`, empresa B sem, no mesmo banco, é o caso que o multi-empresa existe para servir. |
| `entidade` (`singular`, `plural`, `campos`) | **Fica, inteiro** | Zero consumidores (M5) e caminho declaradamente descartado (`prisma/schema.prisma:75-78`). Mover dado morto para o banco cria dívida com aparência de recurso: uma tabela que precisa de migração, de validação, de escopo e de teste, para servir a nenhuma tela. Ver 3.1. |
| `funil` | **Fica** | Já está no banco por outra via, com CRUD próprio (M9, 3.2). O array do arquivo é semente de instalação e continua sendo. |
| `whatsapp` (`numero`, `mensagem`) | **Fica** | Zero consumidores (M4). É resíduo do produto de catálogo original (`"Olá, tenho interesse em {item}"`). Não vale coluna, e apagá-lo é decisão de outro ciclo — o schema Zod o exige, e removê-lo mexe em `client.schema.ts`, em `client-config.test.ts` e em nada mais que exista. |

**Nada é removido de `config/client.ts` neste ciclo.** O arquivo continua com os
sete blocos, com os mesmos valores, e continua validado por `clientConfigSchema`
na importação. O que muda é o **papel** dele, que 4.2 define — e isso é mudança
de comentário, não de dado.

### 4.2 O arquivo é o PADRÃO; o banco é a SOBREPOSIÇÃO

**Decisão: `config/client.ts` continua sendo a fonte do valor padrão. A linha de
`CompanyConfig` sobrepõe, campo a campo, para a empresa dela. Empresa sem linha,
ou com campo nulo, usa o padrão do arquivo.**

**Recusado — banco como fonte única, com o arquivo virando seed.** É mais limpo
conceitualmente, e é o que a formulação do spec do programa sugere. Três custos
concretos, medidos, que a sobreposição não paga:

1. **O ovo e a galinha do layout raiz.** O layout raiz envolve `/login`, onde
   não existe sessão e portanto não existe empresa. Com o banco como fonte
   única, `/login` precisaria de um valor que não existe — e o que sobraria
   seria um padrão embutido em código, ou seja, o arquivo outra vez, só que
   escondido dentro de um `??` em vez de declarado.
2. **`/login` passaria a depender do banco para renderizar.** Hoje ela renderiza
   com uma consulta a `User` que só acontece se houver cookie de sessão
   (`src/app/login/page.tsx:36-43`, dentro de `try/catch`). Com banco como fonte
   única da marca, o banco fora do ar deixa de dar "não consigo entrar" e passa
   a dar "a tela de login não abre".
3. **Segurança de build.** `config/client.ts` é validado no escopo do módulo, e
   o comentário no topo dele explica que isso é seguro **pelo motivo oposto** ao
   do incidente de env: os valores estão no arquivo versionado e não têm como
   faltar no build. Um padrão que venha do banco perde essa propriedade e volta
   para a família de falhas que `CLAUDE.md` registra em "Armadilhas conhecidas".

**A assimetria de `modulos`, dita em voz alta.** `corPrimaria`, `fonte`,
`logoClaro` e `logoEscuro` são colunas **nulas** — nulo significa "não decidi,
usa o arquivo". `modulos` é `String[]`, e no Prisma lista escalar **nunca é
nula**: ela é `[]`. Então não existe o estado "não decidi" dentro da linha, e a
regra é outra: **se a linha existe, `modulos` dela manda, inclusive quando está
vazia**. Empresa que não decidiu módulos é empresa **sem linha**.

Isso é afirmação universal ("inclusive quando está vazia") e por isso tem caso
que a exercita: `tests/unit/config-schema.test.ts` afirma que uma linha com `modulos: []`
desliga **todos** os módulos, e **não** cai no padrão do arquivo.

**A consequência que morde, e é deliberada:** depois que uma linha existe,
editar `config/client.ts` deixa de ter efeito para aquela empresa. É o mesmo
contrato que `client.funil` já tem com `PipelineStage` desde o CRUD de etapas
(`prisma/seed.ts:94-99`), e pela mesma razão: arquivo é semente, banco é o
estado. É também por isso que a migração **não faz backfill** (4.4) e o seed só
cria a linha com `modulos` (4.6) — ninguém congela no banco uma identidade que a
decisão 8 ainda não tomou.

### 4.3 A marca por empresa é aplicada no LAYOUT DO PAINEL, não na raiz

**Decisão: o layout raiz (`src/app/layout.tsx`) continua síncrono, com o padrão
do arquivo. O layout do painel (`src/app/(painel)/layout.tsx`) aplica a marca da
empresa por cima.**

O JSDoc do layout raiz diz hoje: *"O layout raiz continua SÍNCRONO: `client` é
importação estática, não há `headers()` aqui. Ler o nonce na raiz tornaria toda
rota dinâmica."*

**Essa frase é medida, e o número dela é 1, não "toda".** `npm run build` em
2026-08-20 (M10, tabela na seção 7) mostra **uma** rota estática no projeto
inteiro: `/_not-found`. As outras 21 já são dinâmicas — `/login` inclusive, e o
motivo dela está medido em M11. Tornar a raiz dinâmica custaria hoje **uma rota
estática**. A frase do JSDoc descreve o mecanismo corretamente e superestima o
efeito por um fator de 21; a correção dela entra neste ciclo (Tarefa 6).

**Então o custo de dinamizar a raiz não é o argumento. Estes três são:**

1. **A raiz não tem o que ler.** Ela envolve `/login`, onde não há sessão e
   portanto não há empresa (4.2). Dinamizar a raiz não faz aparecer um
   `companyId` que não existe — só troca uma rota estática por nada.
2. **A raiz passaria a consultar o banco em toda requisição, inclusive nas que
   não têm resposta.** `/login`, `/_not-found` e qualquer rota nova fora do
   painel pagariam uma consulta cujo resultado é "não sei de quem".
3. **O painel já pagou o preço todo.** Ele é `force-dynamic` desde antes deste
   ciclo (M16) e já tem `usuario.companyId` em mãos (M15). A marca por empresa
   ali custa **zero rota dinâmica nova** e **zero consulta nova por
   requisição** — a leitura da config é uma consulta, memoizada por requisição
   (4.5), e é a mesma que o portão de módulos e o `generateMetadata` reusam.

**Como a sobreposição acontece na página, mecanicamente:**

- **Cor.** O painel emite um **segundo** `<style>` com `derivarTema(marca)`. Os
  dois blocos usam o seletor `:root:root` (especificidade `(0,2,0)`, escolhido
  em `src/lib/tema/index.ts` para vencer `globals.css` sem depender de ordem de
  inserção). Entre dois blocos de **especificidade igual**, vence o que aparece
  **depois** no documento — e o do painel está no `<body>`, depois do `<head>`.
  Não há flash: os dois chegam no mesmo HTML da mesma resposta.
- **Fonte.** O painel envolve o conteúdo num elemento com
  `` `${fonteDaMarca(marca.fonte).variable} font-sans` ``. As duas classes,
  não uma: a `.variable` **redefine** `--font-marca` naquele elemento, e
  `font-sans` **reavalia** `font-family: var(--font-marca)` ali — sem ela, o
  valor computado herdado do `<html>` (M18) continuaria valendo e a redefinição
  não teria efeito nenhum. É o modo de falha silencioso deste desenho, e por
  isso tem caso: `tests/unit/painel-layout-marca.test.tsx` afirma **as duas
  classes** no mesmo elemento.
- **Título.** `generateMetadata` no layout do painel devolve
  `{ title: <Company.nome> }`, com `try/catch` caindo em `client.nome` quando
  não há sessão. Metadata de layout filho substitui a do raiz nas rotas dele, e
  `/login` continua com o nome do produto. Custo zero de consulta:
  `usuarioAtual()` e a leitura da config são as duas memoizadas por requisição,
  e `generateMetadata` roda na mesma requisição do render.
- **Logo e nome na barra.** `Marca` deixa de importar `config/client` e passa a
  receber `nome` e `logo` por props, vindas do layout. Mesmo movimento que
  `PainelNav` já fez com `notificacoesNaoLidas` e `papelUsuario`, e pelo mesmo
  motivo: mantém o componente síncrono e testável sem mock de banco.

**O CSP não muda.** `style-src` já tem `'unsafe-inline'` (registrado em
`src/lib/tema/index.ts`, por causa do atributo `style` das cores de etapa no
kanban), e o segundo `<style>` é do mesmo tipo do primeiro. Nenhuma diretiva é
tocada; `tests/e2e/seguranca-headers.spec.ts` e `tests/e2e/tema.spec.ts`
continuam valendo como estão.

**A superfície de injeção também não muda, e vale dizer por quê**, porque o
comentário do layout raiz apoia a segurança do `dangerouslySetInnerHTML` no fato
de `tema` ser "constante de build derivada de arquivo versionado". No painel o
valor passa a vir do **banco**. O que fecha isso não é a origem — é que
`derivarTema` só emite números: `hexParaOklch` **lança** para qualquer coisa fora
de `#RRGGBB`, e `formatarOklch` produz exclusivamente numerais. Além disso, o
valor do banco atravessa `marcaSchema` antes de chegar lá (4.4). São duas
travas, e a segunda tem caso: `tests/unit/config-leitura.test.ts` afirma que uma
linha com `corPrimaria` fora de `#RRGGBB` é **recusada na leitura**, e
`tests/unit/painel-layout-marca.test.tsx` afirma que o texto emitido no `<style>`
não contém `<`.

### 4.4 O modelo: `CompanyConfig`, uma linha por empresa, colunas TIPADAS

**Decisão: um modelo novo, `CompanyConfig`, com `@@unique([companyId])` — mesma
forma de `BotConfig` — e colunas escalares tipadas. Não uma coluna `Json`, e não
colunas novas em `Company`.**

```prisma
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

**Por que uma tabela à parte e não colunas em `Company`.** `Company` é a
fronteira de tenancy: ela é lida por `escoparArgumentos` como modelo **fora** do
tenant (passa intacta), e `tests/unit/escopo-empresa.test.ts:790-799` trava que
o bloco dela não tem nenhum `@unique` além do `id`, porque a lista branca de
`exigirRelacaoDeEmpresaFechada` depende disso. Engordar `Company` com quatro
colunas de apresentação mistura o registro de tenancy com a aparência do painel,
e cada coluna nova ali é uma coluna que a varredura de escopo enxerga sem
filtrar.

**Por que colunas tipadas e não uma coluna `Json`.** Três motivos, o primeiro
específico desta base:

1. **A varredura de escopo do Ciclo 1d recusa `companyId` divergente em qualquer
   profundidade do `data`, inclusive dentro de coluna `Json`.** É falso positivo
   **declarado** em `src/core/tenancy/escopo.ts` ("Falsos positivos conhecidos",
   nº 1) e tem caso de teste vivo
   (`tests/unit/escopo-empresa.test.ts:438-448`). Um documento de configuração
   que um dia ganhasse uma chave `companyId` — ou uma chave `company`, que é o
   nº 3 do mesmo bloco — seria recusado na escrita com uma mensagem sobre
   tenancy que não tem relação nenhuma com o defeito. Colunas escalares não têm
   como cair nisso.
2. **O Postgres deixa de conferir qualquer coisa.** Com `Json`, tipo e
   obrigatoriedade viram responsabilidade só do Zod, na leitura — e uma linha
   ruim só aparece quando alguém abre o painel. Com colunas, `logoClaro TEXT` é
   texto por construção.
3. **Precedente na própria base.** `BotConfig.regras` é `String[]` e
   `BotConfig.faq` é `String` — a configuração do agente, que é dado bem mais
   livre que este, já é colunas tipadas.

**Como o schema Zod continua sendo a fonte de verdade da forma.** As colunas são
o **armazenamento**; a forma é `marcaSchema` (`config/client.schema.ts`), e ela
não é reescrita: `src/core/config/schema.ts` a **deriva**, não a redigita. A
consequência é que o piso de croma (`CROMA_MINIMO = 0.04`), o enum fechado de
`FONTES` e o regex de `caminhoDeAsset` — os três com o porquê escrito no arquivo
de schema — continuam valendo para o valor que vem do banco, exatamente como
valem para o do arquivo. A validação roda sobre o objeto **já mesclado**, não
sobre a linha crua, porque é o mesclado que a tela usa.

**Linha inválida LANÇA, não degrada em silêncio.** É a mesma escolha que
`CROMA_MINIMO` já encarna: *"abaixo desse piso as superfícies derivadas ficam
indistinguíveis de neutro e o white-label para de funcionar em silêncio"*. Um
painel que abre cinza sem dizer nada é o defeito; um painel que quebra alto com
"a cor da empresa X tem croma abaixo do piso" é o diagnóstico. Não existe
caminho de escrita neste ciclo que produza linha inválida (a escrita valida
antes), então o único jeito de chegar lá é `UPDATE` à mão no Postgres — e é
exatamente aí que a mensagem alta paga.

**`logoClaro` e `logoEscuro`: os dois ou nenhum.** `marcaSchema.logo` é
`z.object({ claro, escuro }).optional()`, e o comentário dele explica: logo
monocromático some no fundo da mesma cor, e o painel abre no escuro por padrão.
A regra é mantida na leitura e na escrita, com mensagem própria.
**Recusado — uma `CHECK` constraint no Postgres** (`("logoClaro" IS NULL) =
("logoEscuro" IS NULL)`), que seria a trava mais forte: o Prisma não modela
`CHECK` no schema, e se `prisma migrate dev` tratar isso como deriva de schema
ele propõe **reset do banco**. Não medi esse comportamento neste ambiente (🔍
NV2), e desenhar uma migração em cima de um comportamento não medido é o oposto
do que este programa faz. Fica como endurecimento futuro, com o comando que
fecha a dúvida em NV2.

**O 12º modelo de tenant, e as três travas que ele move.** `CompanyConfig` tem
`companyId`, logo é modelo de tenant, logo entra em `MODELOS_DE_TENANT`
(`src/core/tenancy/escopo.ts:250`). Três coisas quebram se isso não for feito na
mesma tarefa, e as três estão previstas no plano:

1. `tests/unit/escopo-empresa.test.ts:997` exige que `MODELOS_DE_TENANT` bata
   **exatamente** com quem tem `companyId` no schema. Sem a entrada, o teste
   reprova com o nome do modelo na mensagem — que é o comportamento desejado.
2. `tests/unit/escopo-empresa.test.ts:811` afirma
   `expect(comCompanyIdUnico).toEqual(["BotConfig"])`. `CompanyConfig` tem
   `@@unique([companyId])`, então passam a ser **dois**, e o caso é atualizado
   junto com a prosa de `escopo.ts` que ele defende ("**`BotConfig` é a
   exceção**"). O comentário daquele teste diz textualmente: *"Um segundo modelo
   aqui torna a frase corrigida errada de novo."* Este é o segundo modelo.
3. As frases "os 11 modelos" em `src/core/tenancy/escopo.ts` (linhas 53, 90 e
   141) viram "os 12", e a de `escopo-empresa.test.ts:801` acompanha.

**Consequência operacional de `@@unique([companyId])`:** o escopo **recusa**
`findUnique`/`update`/`upsert` em modelo de tenant, por uniformidade, mesmo onde
o Prisma aceitaria o campo. Então a leitura e a escrita usam
`findFirst`/`create`/`updateMany`, como `ingest.ts` já faz. A leitura deste
ciclo não esbarra nisso — ela alcança `CompanyConfig` como relação aninhada de
`Company`, que é modelo **fora** do tenant e passa intacto —, mas está dito aqui
para não ser descoberto como surpresa por quem escrever a próxima.

**A tabela nasce blindada.** `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL ... FROM
anon, authenticated` na própria migração, mesmo par de linhas que
`20260806155117_whatsapp_fatia_2_bot_config` escreveu. Sem isso,
`tests/e2e/banco-blindado.spec.ts` fica vermelho — e com razão: ele varre
`pg_class.relrowsecurity` e `information_schema.role_table_grants` sem lista
fixa de tabelas, então uma tabela nova desprotegida aparece sozinha.

**A migração NÃO faz backfill.** Ela cria a tabela e para. Empresa sem linha é
estado **suportado** (4.2) e produz exatamente o comportamento de hoje.
Backfillar congelaria no banco os valores atuais do arquivo — inclusive a
identidade que a decisão 8 do spec do programa ainda **não** tomou — e a partir
daí editar o arquivo deixaria de ter efeito, em silêncio. É o defeito de 4.2
sendo introduzido pela migração em vez de por uma decisão.

### 4.5 O portão de módulos lê do banco, com `companyId` explícito e sem estado global

**Decisão: `moduloAtivo(companyId, nome)` e `exigirModulo(companyId, nome)`
viram assíncronas, recebem a empresa como PRIMEIRO parâmetro, e a memoização por
requisição é `cache()` do React sobre `configDaEmpresa(companyId)`.
`src/lib/module-gate.ts` é apagado; o código passa a morar em
`src/core/config/modulos.ts`.**

**Por que o arquivo muda de árvore.** `src/lib/**` **não** é coberto pelo bloco
`no-restricted-imports` do prisma cru — a regra vale para `src/core/**`,
`src/modules/**` e `src/app/**` (`eslint.config.mjs:466-500`). Um leitor de
banco em `src/lib/` seria o único caminho de leitura de modelo de tenant no
projeto que o lint não olha. Mover para `src/core/config/` põe o arquivo debaixo
da regra, e é a regra que garante que ele use `prismaDaEmpresa`.

**O nome do arquivo, e a armadilha que o nome antigo documentava.**
`src/lib/module-gate.ts` chama-se assim porque `no-restricted-imports` usa os
padrões `**/modules` e `**/modules/*` para a fronteira core↛modules, e um
arquivo `src/lib/modules.ts` colidiria com eles por coincidência de nome. O nome
novo é `src/core/config/modulos.ts` — **português, com `o`**. `modulos` não casa
com `modules`, então a colisão não volta. Isso é afirmação sobre o comportamento
de um glob e por isso não é presumida: a Tarefa 5 roda `npm run lint` com o
arquivo em disco e cola a saída.

**Por que `cache()` do React não é o estado global proibido.** O plano do
programa proíbe `AsyncLocalStorage` e estado global porque eles *"funcionam até
o primeiro caminho fora do ciclo de request (job de fila, seed, script)"*. A
distinção que importa é esta: **`cache()` é memoização com chave no argumento
explícito, não canal ambiente.** `companyId` continua entrando pela assinatura;
não há como chamar `configDaEmpresa()` sem dizer de quem. Fora de contexto de
requisição — job de fila, seed, Vitest — `cache()` simplesmente **não memoiza**
e a função faz a consulta: degrada em custo, nunca em resposta. Não é dedução
sobre o React: `src/core/auth/session.ts` já depende exatamente disso, e o
comentário dele registra que `tests/unit/session.test.ts` é o canário desse
comportamento.

Isso é afirmação universal ("nunca degrada em resposta") e por isso tem dois
casos que a exercitam:

- `tests/unit/config-leitura.test.ts` chama `configDaEmpresa` duas vezes com o
  mesmo `companyId` **fora** de requisição e afirma **duas** consultas ao banco
  falso e **o mesmo** resultado — a corretude não depende do cache;
- o mesmo arquivo varre o texto de `src/core/config/leitura.ts` (com
  `semComentarios`, de `tests/unit/helpers/codigo-fonte.ts`) e afirma que não há
  `let`, `var`, `new Map`, `new Set` nem `globalThis` em escopo de módulo — a
  versão executável de "sem estado global".

**A cadeia de chamadas, e por que nenhuma delas precisa de uma consulta a mais:**

- **`PainelNav` continua SÍNCRONA.** Ela recebe `modulosAtivos: ModuloNome[]`
  por prop, do layout do painel, junto de `nomeUsuario` e `papelUsuario` que já
  chegam assim. O comentário dela — *"continua SÍNCRONA e sem Prisma — é o que a
  deixa testável com `render(<PainelNav />)` sem nenhum mock de banco"* —
  continua verdadeiro, e `tests/unit/painel-nav.test.tsx` fica **mais simples**:
  o `vi.mock("../../config/client")` sai e vira uma prop.
- **As 6 páginas com portão** já chamam `usuarioAtualOuLogin()` no mesmo corpo
  (M14). O portão passa a rodar **depois** dela, com `usuario.companyId`.
- **`src/modules/automation/actions.ts`** não chama o portão — só o cita num
  comentário (M8). Nada a fazer ali além da citação.

**A ordem muda em 4 páginas, e a mudança é para melhor.** Hoje
`exigirModulo("whatsapp")` roda **antes** de `usuarioAtualOuLogin()` em
`/conversas`, `/conversas/[id]`, `/conversas/agente` e `/fluxos`. Depois, roda
depois. O efeito observável: um visitante **sem sessão** que digita `/conversas`
com o módulo desligado hoje recebe **404**; passa a receber **redirecionamento
para `/login`**. Isso é o correto — o estado dos módulos de uma empresa deixa de
ser observável por quem não está autenticado — e é o que o layout do painel já
faria de qualquer forma.

### 4.6 Quem edita: ninguém, ainda — e a tela é a parte errada de começar

**Decisão: este ciclo não cria tela, não cria Server Action e não cria
permissão. O único caminho de escrita é o `prisma/seed.ts`, gravando direto.**

Consultei `src/core/auth/permissions.ts` antes de decidir. As ações existentes
são `gerenciar_usuarios`, `criar_lead`, `mover_lead`, `ver_dashboard_geral`,
`exportar_leads`, `configurar_agente`, `ver_documento_contato`,
`gerenciar_funil`, `gerenciar_fluxos` e `ver_fluxos`. **Nenhuma cobre marca ou
módulos**, e inventar uma agora seria decidir duas coisas de uma vez.

Três motivos, o segundo é o forte:

1. **Não há o que digitar.** A decisão 8 do spec do programa mantém a identidade
   do produto EM ABERTO, de propósito. Uma tela para escolher a cor da marca,
   num ciclo cujo próprio spec-pai diz que a marca ainda não foi decidida, é
   tela para dado que ninguém tem.
2. **`modulos` não pode ser editável pelo tenant, e a tela borraria isso.**
   Quais módulos uma empresa tem é fato **comercial** — quem paga o quê. Uma
   tela onde o ADMIN da própria empresa liga o módulo que ele não contratou não
   é configuração, é escalonamento de privilégio com forma de formulário. O
   lugar disso é uma superfície de **operador**, que não existe neste produto e
   não é deste ciclo.
3. **A marca e os módulos não são a mesma permissão, e descobrir isso depois é
   barato; desfazer uma permissão larga não é.** `gerenciar_funil` e
   `gerenciar_fluxos` já carregam esse raciocínio escrito em
   `permissions.ts`: *"Estreitar depois é fácil; alargar depois de estragar,
   não."*

**Registrado para quando a tela vier** (e é decisão deste spec, não ponto em
aberto): a marca seria `gerenciar_marca`, **ADMIN apenas**, pelo mesmo argumento
de `gerenciar_funil` — trocar a cor muda a tela de todo mundo da empresa. Os
módulos **não** ganhariam permissão de tenant nenhuma.

**O seed cria a linha com `modulos` e SÓ.** As colunas de marca nascem nulas —
"não decidi, usa o arquivo" — porque a decisão 8 não foi tomada. O seed segue o
mesmo contrato de instalação de `client.funil`: cria se não existe, **nunca**
reconcilia (`prisma/seed.ts:94-99`). Assim o caminho de banco fica exercitado na
aplicação real (os módulos passam a vir de lá) sem inventar uma identidade que
ninguém escolheu.

### 4.7 Onde o código mora

| Arquivo | O quê | Novo? |
| --- | --- | --- |
| `prisma/schema.prisma` | `model CompanyConfig`, `Company.config`, `User.configsEditadas` | modificado |
| `prisma/migrations/20260820180000_company_config/migration.sql` | tabela + FK + índice único + RLS + REVOKE | novo |
| `src/core/tenancy/escopo.ts` | 12º modelo em `MODELOS_DE_TENANT`; três frases de "11" e o bloco do `BotConfig` | modificado |
| `src/core/config/schema.ts` | forma da sobreposição, derivada de `config/client.schema.ts`; padrão do arquivo | novo |
| `src/core/config/leitura.ts` | `configDaEmpresa(companyId)`, memoizada por requisição | novo |
| `src/core/config/modulos.ts` | `moduloAtivo`, `exigirModulo`, `ModuloNome` | novo |
| `src/lib/module-gate.ts` | — | **apagado** |
| `src/app/(painel)/layout.tsx` | tema, fonte, `generateMetadata`, props para `PainelNav` | modificado |
| `src/app/layout.tsx` | só o JSDoc: a frase "toda rota dinâmica" vira o número medido | modificado |
| `src/components/marca.tsx` | recebe `nome` e `logo` por prop | modificado |
| `src/components/painel-nav.tsx` | recebe `modulosAtivos`, `nomeMarca`, `logo` por prop | modificado |
| 6 páginas de `src/app/(painel)/**` | portão com `companyId` | modificado |
| `prisma/seed.ts` | garante a linha com `modulos` | modificado |
| `config/client.ts` | só comentário: o arquivo passa a ser o PADRÃO | modificado |

**Nenhum arquivo novo importa `@/lib/prisma`.** `leitura.ts` mora em
`src/core/**`, onde o lint proíbe, e usa `prismaDaEmpresa(companyId)`.
A expectativa deste ciclo é **zero exceção nova**, temporária ou permanente
(M13). Isso é verificável e é verificado: `tests/unit/catraca-prisma-cru.test.ts`
roda na Tarefa 8 com `LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS` intacta em 0.

## 5. O que este ciclo prova, e como

| # | Prova | Onde | Como |
| --- | --- | --- | --- |
| P1 | A tabela nova nasce blindada | `tests/e2e/banco-blindado.spec.ts` (já existente, sem alteração) | ele varre `pg_class`/`role_table_grants` sem lista fixa; se `CompanyConfig` ficasse de fora do RLS ou dos REVOKE, ele fica vermelho sozinho |
| P2 | `CompanyConfig` é modelo de tenant de verdade | `tests/unit/escopo-empresa.test.ts` | a trava de deriva exige o conjunto exato; e o caso do `companyId` único passa a listar dois modelos |
| P3 | A sobreposição funciona campo a campo | `tests/unit/config-schema.test.ts` (a mescla, pura) e `tests/unit/config-leitura.test.ts` (a mesma mescla chegando pela consulta) | sem linha → padrão do arquivo; campo nulo → padrão; campo preenchido → banco; `modulos: []` → nenhum módulo |
| P4 | A leitura recusa linha inválida em vez de degradar | `tests/unit/config-schema.test.ts` (sete casos parametrizados) e `tests/unit/config-leitura.test.ts` (a recusa chegando pela consulta) | `corPrimaria` cinza, `corPrimaria` malformada, `fonte` fora do enum, módulo desconhecido, logo só claro, logo só escuro, caminho de logo que sai do domínio |
| P5 | A leitura é escopada por empresa | `tests/unit/config-isolamento.test.ts` (Postgres real, duas empresas) | mesma forma dos `*-isolamento.test.ts` do Ciclo 1d: a empresa A não enxerga a linha da B, e a sonda afirma que a consulta sem escopo enxergaria |
| P6 | A corretude não depende do cache, e não há estado de módulo | `tests/unit/config-leitura.test.ts` | duas chamadas fora de requisição → duas consultas, mesmo resultado; e varredura do fonte sem `let`/`Map`/`globalThis` de módulo |
| P7 | O portão de módulos lê a empresa que recebeu, e nada mais | `tests/unit/config-modulos.test.ts` | `moduloAtivo` com duas empresas diferentes devolve respostas diferentes na mesma execução; `exigirModulo` chama `notFound()` |
| P8 | O painel aplica a marca da empresa por cima do padrão | `tests/unit/painel-layout-marca.test.tsx` | o segundo `<style>` carrega a cor da EMPRESA; o elemento tem **as duas** classes de fonte; o texto do `<style>` não contém `<` |
| P9 | A marca da empresa vence no navegador de verdade | `tests/e2e/marca-por-empresa.spec.ts` | escreve uma linha, mede `getComputedStyle` de `--primary` no `<html>`, restaura o estado anterior |
| P10 | Nenhum arquivo novo alcança o prisma cru | `tests/unit/catraca-prisma-cru.test.ts` + `npm run lint` | catraca com linha de base 0, inalterada |
| P11 | Dinamizar a raiz não foi necessário | `npm run build` | a tabela de rotas continua com `/_not-found` estática |

### 5.1 O que este ciclo NÃO consegue provar, e por quê

- **Que duas empresas veem marcas diferentes ao mesmo tempo, no navegador.** O
  produto tem uma sessão por navegador e uma empresa por sessão; provar isso
  exigiria dois contextos do Playwright com dois usuários de duas empresas, e o
  banco de desenvolvimento é o mesmo do de teste (⚠️ R1 do Ciclo 1a) — criar uma
  segunda empresa com usuário próprio num e2e deixa resíduo exatamente do tipo
  que aquela auditoria mediu. O que P5 prova é a metade que importa e que cabe:
  a **leitura** não atravessa a fronteira, contra Postgres real, com duas
  empresas.
- **Que a `CHECK` de logo-par não causaria deriva no `prisma migrate dev`.** Não
  foi medido (🔍 NV2), e por isso a constraint não entra.
- **Que o segundo `<style>` vence em todo navegador.** P9 mede num só (o
  Chromium do Playwright). A regra de cascata usada — mesma especificidade,
  vence o último — é do CSS, não do navegador, mas a medição é de um.
- **Que `fonteDaMarca("Manrope")` devolve mesmo a Manrope, num teste de
  unidade.** M19: `next/font/google` lança sob Vitest, então
  `tests/unit/painel-layout-marca.test.tsx` **mocka** `@/lib/tema/fontes` e
  prova só a COMPOSIÇÃO — qual classe vai em qual elemento, junto de qual
  outra. O mapeamento nome→fonte só é observável num navegador, e é por isso
  que o caso da fonte em `tests/e2e/marca-por-empresa.spec.ts` (que lê
  `font-family` computada no `<main>`) é a prova de verdade, não decoração.

## 6. O que este ciclo NÃO faz

- **Não cria tela, Server Action nem permissão** (4.6).
- **Não move `entidade`, `funil`, `vertical` nem `whatsapp`** (4.1, 3.1, 3.2).
- **Não apaga campo nenhum de `config/client.ts`.**
- **Não escreve política RLS nem concede grant.** A tabela nasce com RLS ligada e
  **zero** políticas — default-deny —, igual às outras 15. A exceção NOMEADA do
  Realtime continua sendo Ciclo 3.
- **Não faz backfill** (4.4).
- **Não mexe em `Conversation.waId`, `Contact.telefone`, `PipelineStage.ordem`
  nem `WhatsappMessage.idExterno`** — as quatro unicidades globais do ⚠️ R2 do
  Ciclo 1a continuam como estão.
- **Não fecha o `User.papel`** (⚠️ R4), não mexe em `EVOLUTION_COMPANY_ID`
  (⚠️ R5) nem nas 9 chamadas de `companyIdDoUsuario` (⚠️ R6).

> **Não vale mais desde 2026-08-21:** a coluna saiu no Ciclo 1f.

## 7. Fatos medidos, com a fonte

**Tabela de rotas — `npm run build`, 2026-08-20, Next.js 16.3.0 (Turbopack):**

```text
Route (app)
┌ ƒ /
├ ○ /_not-found
├ ƒ /api/auth/[...nextauth]
├ ƒ /api/jwks
├ ƒ /api/queues/whatsapp-turn
├ ƒ /api/supabase/token
├ ƒ /api/whatsapp/evolution/[token]
├ ƒ /contatos
├ ƒ /contatos/[id]
├ ƒ /conversas
├ ƒ /conversas/[id]
├ ƒ /conversas/agente
├ ƒ /etapas
├ ƒ /export/leads
├ ƒ /fluxos
├ ƒ /fluxos/[id]
├ ƒ /leads
├ ƒ /leads/[id]
├ ƒ /leads/kanban
├ ƒ /login
├ ƒ /tasks
└ ƒ /usuarios

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

Uma rota estática. É esse o número que a frase "tornaria toda rota dinâmica"
descreve hoje.

**Consumidores de config, por bloco** (M2-M8): `nome` tem 3 consumidores de
produção; `marca` tem 2; `modulos` tem 1 (com 8 pontos de chamada indiretos);
`funil` tem 1, e é semente; `vertical`, `entidade` e `whatsapp` têm **zero**.

**Exceções do lint** (M13): `VIOLADORES_TEMPORARIOS_CORE`,
`VIOLADORES_TEMPORARIOS_MODULES` e `VIOLADORES_TEMPORARIOS_APP` são arrays
vazios (só comentário); `EXCECAO_PERMANENTE` tem 5 entradas —
`credenciais.ts`, `session.ts`, `users/empresa.ts`, `rate-limit/limiter.ts`,
`tenancy/escopo.ts`.

**O que a base já garante e este ciclo depende:** `prismaDaEmpresa` devolve
argumentos **intactos** para modelo fora de `MODELOS_DE_TENANT` — está no código
(`escoparArgumentos`, primeira linha) e tem caso que compara por **identidade**
de referência (`escopo-empresa.test.ts:771-788`), para `User`, `RateLimit` e
`Company`. É isso que permite `leitura.ts` ler `Company` pelo id **através do
cliente escopado**, sem exceção de lint.

## 8. Ações do dono

**Nenhuma.** Este ciclo não toca painel do Supabase, não precisa de PAT, não
precisa de segredo novo no `.env` e não registra provider nenhum. A migração roda
com a `DIRECT_URL` que já está no ambiente.

Continua valendo, herdada e não deste ciclo: **depois de rodar `npm test` alguma
vez, rotacionar a senha do admin** (🔍 NV5 da auditoria do Ciclo 1a —
`tests/unit/seed.test.ts` grava um literal versionado no `senhaHash`).

## 9. NÃO VERIFICADO

Cada item sai daqui como pergunta aberta, com o comando que a fecha.

| # | Item | Por que não deu | O que fecha |
| --- | --- | --- | --- |
| NV1 | Quantas linhas de `Company` existem hoje no banco de desenvolvimento, e portanto quantas ficariam sem linha de config | A auditoria do Ciclo 1a mediu **7** em 2026-08-20 (1 legítima + 6 órfãs de fixture), mas `npm test` rodou desde então e a contagem pode ter mudado | `select count(*) from "Company";` — Tarefa 8 do plano roda e cola |
| NV2 | Se uma `CHECK` constraint escrita à mão numa migração faz `prisma migrate dev` acusar deriva e propor reset | Não medi, e medir exige um shadow database | `npx prisma migrate dev --create-only` num branch descartável depois de acrescentar a `CHECK`, e ler se ele avisa de deriva. Só vale a pena se a trava de banco para o par de logos for desejada |
| NV3 | Se `generateMetadata` num layout com `force-dynamic` compartilha a memoização de `cache()` com o render da mesma requisição | A doc do Next afirma que metadata e render acontecem na mesma requisição; não medi a contagem de consultas | Instrumentar `configDaEmpresa` com um contador e carregar `/leads` uma vez, comparando com 1. Se forem 2, o custo é uma consulta a mais por navegação do painel — não incorreção |
| NV4 | Se algum navegador fora do Chromium ordena diferente dois blocos `:root:root` de mesma especificidade | P9 mede num navegador | Rodar o mesmo spec com `--project=firefox`/`webkit`, se o projeto passar a suportá-los |
| NV5 | Estado da senha do admin no banco de desenvolvimento | Herdado do Ciclo 1a; este ciclo não roda o seed de senha | `SEED_PASSWORD=<valor forte> npx prisma db seed` e `bcrypt.compare` provando que o literal antigo não autentica mais |

## 10. Critérios de aceite

Cada um com comando e saída colados. O que este ambiente não provar sai como
**NÃO VERIFICADO** com o comando que um humano roda.

- `CompanyConfig` existe no schema com `@@unique([companyId])` e relação chamada
  `company` — as duas cobradas por `tests/unit/escopo-empresa.test.ts`
- `MODELOS_DE_TENANT` tem **12** entradas e bate exatamente com o schema — caso
  de deriva verde
- O caso "modelo de tenant com `companyId` único" passa a esperar
  `["BotConfig", "CompanyConfig"]`, e as frases "os 11 modelos" em `escopo.ts`
  viram "os 12" — nenhuma asserção removida, provado pelo diff
- A migração tem `ENABLE ROW LEVEL SECURITY` e `REVOKE ALL ... FROM anon,
  authenticated` para `CompanyConfig`, e **nenhum** `INSERT`
- `tests/unit/migracoes-seguras.test.ts` verde com a migração nova em disco
- Empresa **sem linha** produz exatamente os valores de `config/client.ts` —
  caso de teste que compara o objeto inteiro
- Campo nulo cai no padrão e campo preenchido vence — um caso por campo
  (`corPrimaria`, `fonte`, par de logos)
- Linha com `modulos: []` desliga **todos** os módulos e **não** cai no arquivo —
  caso de teste
- Linha com `corPrimaria` de croma abaixo de `CROMA_MINIMO` é **recusada na
  leitura**, com a mensagem do `marcaSchema` — caso de teste
- Linha com `modulos` fora do enum (`"modulo-que-nao-existe"`) é **recusada** —
  caso de teste
- Linha com só um dos dois logos é **recusada**, com mensagem própria — caso de
  teste
- `configDaEmpresa` chamada duas vezes fora de requisição faz **duas** consultas
  e devolve **o mesmo** resultado — caso de teste
- `src/core/config/leitura.ts` não tem `let`, `var`, `new Map`, `new Set` nem
  `globalThis` em escopo de módulo — varredura do fonte sem comentários
- A empresa A não lê a linha da B contra Postgres real, e a sonda afirma que a
  consulta sem escopo leria — dois casos no mesmo arquivo
- `moduloAtivo` devolve respostas **diferentes** para duas empresas na mesma
  execução — caso de teste
- `src/lib/module-gate.ts` **não existe mais**, e `npm run lint` está verde com
  `src/core/config/modulos.ts` em disco — a colisão de glob não voltou
- `PainelNav` renderiza sem mock de banco, recebendo `modulosAtivos` por prop —
  `tests/unit/painel-nav.test.tsx` sem `vi.mock("../../config/client")`
- O layout do painel emite um segundo `<style>` com a cor da EMPRESA, e o
  elemento de conteúdo tem **as duas** classes (`--font-marca` e `font-sans`) —
  casos de teste
- O texto emitido no `<style>` não contém `<` — caso de teste
- No navegador, `--primary` do `<html>` reflete a cor da empresa, e o estado
  anterior é restaurado no fim — e2e
- `npm run build` continua com **1** rota estática (`/_not-found`) — tabela
  colada
- `tests/unit/catraca-prisma-cru.test.ts` verde **sem exceção nova**, com
  `LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS` ainda em 0
- `npm run typecheck`, `npm run lint`, `npm test` e `npm run build` verdes
- `get_advisors(security)` sem achado novo além do esperado: a linha de base do
  Ciclo 1a é 15 × `rls_enabled_no_policy` (INFO) + 2 × WARN de `rls_auto_enable`;
  com a tabela nova espera-se **16 × INFO** e os mesmos 2 WARN. Qualquer coisa
  diferente disso é achado, não ruído

## 11. Riscos e dívidas que este ciclo declara

**D1 — não existe função de escrita validada, e isso é escolha.** A validação
mora só na LEITURA. A alternativa considerada — um
`definirConfigDaEmpresa(companyId, entrada)` que valida com `marcaSchema` antes
de gravar — foi **recusada porque não teria chamador**: o seed grava dois
campos cujos valores vêm de `client.modulos`, já validado na importação de
`config/client.ts`, e os dois outros processos que escreveriam (`seed-demo.ts` e
a suíte Playwright) rodam como Node comum, **fora** da condição de resolução
`react-server`, onde `import "server-only"` lança — os dois já mantêm
`PrismaClient` próprio por esse motivo exato, registrado no topo de
`prisma/seed-demo.ts`. Um helper cujo único chamador é um teste unitário é o
mesmo "dado morto com aparência de recurso" que 4.1 recusou para
`entidade.campos`. Quando a tela de 4.6 existir, ela nasce com essa função —
e aí ela terá chamador.

**D2 — depois que a linha existe, o arquivo deixa de ter efeito para aquela
empresa, em silêncio.** É o contrato de 4.2 e é o mesmo que `client.funil` já
tem. Mitigado por o seed criar a linha só com `modulos` (4.6), então as colunas
de marca ficam nulas e o arquivo continua mandando na marca até alguém decidir.
Não há aviso mecânico: quem editar `config/client.ts` esperando ver a cor mudar
no painel não vê nada acontecer, e nada explica por quê. O comentário novo em
`config/client.ts` é a única defesa, e comentário não é trava.

**D3 — `modulos` fica editável por SQL e por mais nada.** Sem tela e sem
Server Action, ligar um módulo para uma empresa é `UPDATE` à mão ou reexecutar o
seed numa base sem linha. É consequência assumida de 4.6, e é reversível: a tela
é um ciclo próprio, com a permissão de operador que hoje não existe.

**D4 — linha inválida derruba o painel daquela empresa.** Escolha explícita de
4.4: falhar alto em vez de pintar cinza. O caminho para chegar lá é `UPDATE` à
mão, porque a escrita valida antes. Se um dia houver tela, este risco encolhe
para zero; enquanto não houver, ele é o preço de não ter white-label quebrado em
silêncio.

**D5 — a marca de `/login` continua sendo a do arquivo, para todo mundo.** É
consequência direta do ovo-e-galinha (4.2, 4.3): sem sessão não há empresa. Uma
empresa que quisesse a própria marca na tela de login precisaria de um
discriminador antes do login — subdomínio, ou parâmetro de URL — e isso é
desenho de multi-tenant público, não deste ciclo.

**D6 — herdadas e não tocadas aqui.** ⚠️ R1 (banco de teste não separado do de
dev), R2 (quatro unicidades globais), R3 (os quatro pontos cegos declarados do
escopo), R4 (`User.papel` como espelho), R5 (`EVOLUTION_COMPANY_ID` como ponte) e
R6 (`companyIdDoUsuario` por vínculo arbitrário), todas de
`docs/auditorias/2026-08-19-ciclo-1a-tenancy.md`. Nenhuma introduzida aqui,
nenhuma corrigida aqui. Somam-se as pendências do Ciclo 1b que dependem de ação
do dono (D3/D4 daquele plano): elas não bloqueiam este ciclo.

> **Não vale mais desde 2026-08-21:** a coluna saiu no Ciclo 1f.
