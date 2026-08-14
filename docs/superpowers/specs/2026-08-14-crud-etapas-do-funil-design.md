# CRUD de etapas do funil

**Objetivo:** um ADMIN cria, renomeia, recolore, reordena e remove etapas do funil pela
interface, sem editar código e sem rodar seed.

**Estado hoje:** `PipelineStage` só nasce pelo seed, a partir de
`config/client.ts:43` (`funil: ["Novo", "Contato feito", "Visita agendada", "Proposta",
"Fechado"]`). Não há tela, action nem serviço. Mudar o funil de um cliente exige um
desenvolvedor — o mesmo buraco que a tela de Equipe fechou para usuários.

---

## O enunciado certo

O funil **não está sem dono**. Ele tem um, e é `config/client.ts`.

`prisma/seed.ts` reconcilia a tabela com aquela lista: `upsert` por `ordem`, recolore por
índice (`CORES[index % CORES.length]`), marca a última como `ehGanho`, **apaga** as etapas
que sobraram de um funil maior (`reconciliarEtapasOrfas`) e aborta se alguma delas ainda
tiver lead. Existe até `confirmarInvarianteEhGanho`, escrita depois de um bug real em que
duas etapas ficaram com a flag ligada ao mesmo tempo.

Construir a tela sem decidir isso primeiro produziria um sistema onde a etapa "Negociação"
criada pela interface é renomeada para "Fechado" — ou apagada — pelo próximo seed.

**O segundo enunciado, que a revisão adversarial desta spec trouxe à tona:** o número 5 não
está só em `client.funil`. Ele está fixado em literal no grid do painel, na distribuição do
seed de demonstração e em três arquivos de teste. Tornar o funil variável é, em boa parte,
caçar o `5` nos lugares onde ele foi escrito como se fosse constante do universo. A § 10 e a
§ 11 são esse trabalho.

---

## Decisões do dono (fechadas)

| # | Decisão |
|---|---|
| 1 | **O banco passa a mandar.** `client.funil` vira semente: o seed só cria etapas quando a tabela está vazia, e nunca mais renomeia, recolore ou apaga |
| 2 | **Remover etapa pergunta para onde vão os leads.** Move todos numa transação, audita, e só então apaga |
| 3 | **A etapa de fechamento é escolhida na tela**, exatamente uma, obrigatória. `ehPerdido` continua morto |
| 4 | **`gerenciar_funil` é exclusiva de ADMIN**, no molde de `gerenciar_usuarios` |
| 5 | **Reordenação por setas ↑↓**, uma troca com a vizinha por clique |
| 6 | **A troca usa posição de estacionamento negativa** dentro de uma transação, preservando o `UNIQUE(ordem)` |

---

## 1. O banco não muda

**Zero migração.** `PipelineStage` já tem `nome`, `ordem`, `cor`, `ehGanho`, `ehPerdido` e
o `UNIQUE(ordem)`.

Isso é o que torna a branch barata, e é a primeira resposta que a Fase 1 da
`auditoria-seguranca` vai pedir: sem tabela nova, **sem migração companheira de RLS ou
REVOKE**. `ehPerdido` continua existindo, continua sempre `false`, e nenhuma action o
escreve — ativar aquela flag é produto para outra branch (mudaria painel, listagens e
kanban).

## 2. As cinco invariantes

O seed garantia por construção o que a tela agora precisa garantir por checagem explícita
no servidor.

| Invariante | Quem quebraria | O que o servidor faz |
|---|---|---|
| Exatamente 1 etapa com `ehGanho` | marcar a segunda sem desmarcar a primeira | a mesma transação desliga a anterior |
| Nunca zero etapas com `ehGanho` | excluir a etapa de fechamento | **recusa**: "marque outra etapa como fechamento antes de remover esta" |
| Pelo menos 1 etapa no funil | excluir a última que sobrou | recusa |
| Nome não repetido | criar **ou renomear para** um nome que já existe | recusa, comparando sem diferenciar maiúscula |
| Etapa com **qualquer** lead só sai com destino | apagar uma etapa que só tem leads arquivados | recusa com erro de domínio: "esta etapa ainda tem N leads (incluindo arquivados)" |

**Arquivado conta aqui, e só aqui.** `Lead.arquivadoEm` tira o lead do funil para efeito de
tela (`schema.prisma:170-176`), mas não apaga a linha nem zera `stageId` — `arquivarLead`
(`core/leads/service.ts:297`) só escreve a data. E `Lead_stageId_fkey` é `ON DELETE
RESTRICT` (`prisma/migrations/20260730211315_init/migration.sql:140`). Para o Postgres, um
lead arquivado é uma referência tão viva quanto qualquer outra. Toda invariante de exclusão
de etapa conta arquivado; toda listagem continua não contando. A § 4 explica de onde vem
cada um dos dois números.

A checagem de nome vale para `criarEtapa` **e** `editarEtapa`. Cobrir só a criação deixa o
buraco aberto pelo caminho mais provável: quem já tem "Proposta" e "Proposta enviada" tende
a renomear uma delas, não a criar uma terceira.

**Guarda de borda, que não é invariante de dado mas precisa existir:** `moverNaOrdem`
recusa subir a primeira etapa e descer a última. A tela já não desenha essas setas, mas a
Server Action responde a qualquer chamada — a mesma razão pela qual a página não é a
defesa.

**Por que o nome é único.** Não é preciosismo: o e2e localiza coluna do kanban por nome, e
dois elementos com o mesmo nome acessível violam o *strict mode* do Playwright. Para quem
usa, duas colunas "Proposta" são indistinguíveis.

**Por que a checagem é no serviço e não no banco.** Um índice único case-insensitive em
Postgres é funcional (`LOWER(nome)`), o Prisma não o representa, e ele viraria *drift* no
próximo `migrate diff` — o mesmo motivo pelo qual a branch de cadastro de contato recusou o
índice `pg_trgm` (`schema.prisma:117-121` registra aquela recusa). Sobra uma janela de
corrida: dois ADMINs criando o mesmo nome no mesmo segundo. Com a decisão 4 (só ADMIN) ela
é quase inalcançável, e o pior desfecho é duas colunas com nome igual, consertável
renomeando uma. **Registrado como aceito, não como resolvido** — e o comentário no código
deve dizer isso, não fingir que a checagem é atômica.

## 3. O seed deixa de mandar

`prisma/seed.ts` passa a semear etapas **apenas quando `pipelineStage.count() === 0`**.

- **`reconciliarEtapasOrfas` é apagada.** Ela existe para remover etapas fora de
  `client.funil`, que é exatamente o que a tela passa a criar. Mantê-la faria o seed comer
  o trabalho do usuário na primeira reexecução.
- **`confirmarInvarianteEhGanho` fica, com o alvo encolhido.** Deixa de checar "exatamente
  1, e é a última" e passa a checar só **"exatamente 1"**. A parte "é a última" é revogada
  pela decisão 3, e o dono da invariante passa a ser `core/pipeline/service.ts`. Continua
  sendo o alarme, agora apontado para a tela.
- **`client.funil` continua** em `config/client.ts` e em `config/client.schema.ts`
  (`z.array(z.string()).min(1)`). É o que permite um fork nascer com o funil dele.

### `prisma/seed-demo.ts` é o segundo lugar onde o 5 está fixado

`seed-demo.ts:155` tem `CONTAGEM_POR_ETAPA = [10, 7, 5, 3, 5]` e `FAIXA_DIAS_ATRAS` indexada
por posição de etapa; `:269-276` aborta quando não encontra exatamente 5 etapas. Isso **não é
só um script**: `tests/unit/seed-demo.test.ts:71-73` chama `seedDemo()` num `beforeAll` único
do arquivo, e `vitest.config.ts` inclui `tests/unit/**`. Na primeira etapa criada pela tela —
o objetivo desta branch — aquele `beforeAll` lança, o arquivo inteiro cai, e **`npx vitest
run` passa a sair não-zero para sempre**. É o portão de merge que a própria seção de
Verificação desta spec manda rodar.

**A escolha, e ela é minha, não do dono:** o guarda deixa de ser exceção no `beforeAll` e
vira pré-condição do teste. `seed-demo.test.ts` lê o funil antes e usa `describe.skipIf` com
motivo impresso — *"o funil deixou de ser o semeado de 5 etapas; seed-demo não descreve mais
este banco"* —, e a mensagem de `seed-demo.ts:270` passa a citar a tela `/etapas` como causa
provável, não `client.funil`.

**O que eu recusei, e por quê.** Generalizar a distribuição para um funil de tamanho
arbitrário é a correção "de verdade", e ela é escopo de outra branch: `[10, 7, 5, 3, 5]` não
é um número, é uma *forma* — decrescente, com repique na etapa de fechamento — e não existe
resposta certa para essa forma com 3 ou 9 etapas. Inventar uma é desenhar dado de
demonstração no meio de uma branch de CRUD. Trocar vermelho permanente por pulado explícito
custa cinco linhas e mantém o portão informando; fica registrado como dívida na § 12.

## 4. `src/core/pipeline/` ganha corpo

Hoje é um arquivo com uma função.

| Arquivo | Responsabilidade |
|---|---|
| `stages.ts` | `listarEtapas()` — **código intocado**; ganha `contarLeadsQueSeguramEtapa()`. O teste dele muda: ver § 11 |
| `schema.ts` (novo) | Zod dos campos, no molde de `core/contacts/schema.ts` |
| `service.ts` (novo) | `criarEtapa`, `editarEtapa`, `moverNaOrdem`, `definirEtapaDeFechamento`, `excluirEtapa`; lança `EtapaInvalidaError` |
| `actions.ts` (novo) | Cinco Server Actions, todas devolvendo `ResultadoAcao` |
| `core/audit/log.ts` | **muda** — ver § 7: a linha de auditoria precisa nascer dentro da transação |

**Zod:** `nome` obrigatório, `trim`, ≤ 40 caracteres; `cor` casando `/^#[0-9a-f]{6}$/i`,
normalizada para minúscula. Segue a decisão da branch de contatos — Zod valida entrada de
usuário dentro de `core/`, com `safeParse` convertido em erro de domínio
(`storage.ts:133-138` é o modelo).

**`ResultadoAcao` não é opcional.** A branch anterior acabou de converter 14 actions para
esse contrato e tirar as cinco comparações de string do cliente. Nascer fora dele criaria,
no mesmo mês, a dívida que acabou de ser paga. `hasPermission(papel, "gerenciar_funil")`
vai **dentro** do `try`, como em `core/leads/actions.ts`.

### São duas contagens, e a diferença separa apagar de falhar

`contarLeadsPorEtapa()` (`core/leads/queries.ts:165`) já existe, é `groupBy` sem teto, e
serve a coluna "leads" da tabela — mas ela filtra `where: { arquivadoEm: null }` (linha 168),
de propósito: arquivado sai do funil por definição. É o número certo para descrever o funil e
o número **errado** para decidir se uma etapa pode ser apagada.

Reaproveitá-la produziria o pior desfecho possível desta tela. Uma etapa com 0 leads ativos
e 5 arquivados apareceria como **vazia**; o diálogo da § 8 não pediria destino; o
`pipelineStage.delete` da § 7 bateria na FK `RESTRICT`; o `P2003` cairia no `catch` genérico
e o ADMIN leria *"tente novamente em instantes"* para uma condição permanente. A etapa
ficaria indeletável, com um diagnóstico que só sai abrindo o Postgres. E não é cenário
exótico: arquivar existe justamente para tirar o lead do funil, então uma etapa "vazia"
cheia de arquivados é o estado esperado de uma etapa que caiu em desuso — exatamente a que
alguém quer remover.

Nasce então uma segunda função, ao lado de `listarEtapas`, para que as duas se expliquem uma
à outra:

```ts
/**
 * Quantos leads SEGURAM cada etapa — arquivados incluídos. É o número que o
 * `ON DELETE RESTRICT` da FK enxerga, e portanto o único que pode decidir se
 * uma etapa é apagável.
 *
 * Não confundir com `contarLeadsPorEtapa` (`core/leads/queries.ts`), que é
 * vista de funil e exclui arquivados de propósito. As duas divergem sempre
 * que alguém arquivou um lead sem tirá-lo da etapa, que é o caso comum.
 */
export async function contarLeadsQueSeguramEtapa(): Promise<Record<string, number>>
```

Mesmo `groupBy`, sem `where`, sem índice novo (`@@index([stageId, responsavelId])` já cobre
o agrupamento pelo prefixo). `contarLeadsPorEtapa()` fica **intocada**; painel e taxa de
conversão não mudam.

Este projeto já escreveu essa distinção uma vez, em `core/contacts/queries.ts:173-176`:
*"Lead arquivado APARECE aqui de propósito … as quatro listagens do funil filtram, esta
não"*. Apagar uma linha é operação **estrutural**, não vista de funil.

## 5. A reordenação e o `UNIQUE(ordem)`

`CREATE UNIQUE INDEX "PipelineStage_ordem_key"` é verificado a cada `UPDATE`, não no fim da
transação. Trocar as etapas de `ordem` 0 e 1 falha na primeira linha.

Dentro de um `$transaction`:

```
UPDATE PipelineStage SET ordem = -1 WHERE id = A   -- A sai do caminho
UPDATE PipelineStage SET ordem =  0 WHERE id = B   -- B ocupa o lugar de A
UPDATE PipelineStage SET ordem =  1 WHERE id = A   -- A ocupa o lugar de B
```

O `-1` existe por microssegundos dentro de uma transação atômica; nenhuma leitura o vê.

**Alternativas recusadas.** Trocar o índice por uma *constraint* `DEFERRABLE INITIALLY
DEFERRED` é o jeito idiomático no Postgres e permitiria dois `UPDATE`s simples — mas o
Prisma não representa `DEFERRABLE` e o objeto viraria *drift* no próximo diff. Índice único
é justamente a classe que o Prisma **modela**: o único índice escrito à mão do repositório
(`20260801181733_notification_unread_index`) tem contraparte declarada em `schema.prisma`.
As migrações SQL manuais que convivem sem atrito aqui são de outra classe — `ENABLE ROW
LEVEL SECURITY`, `REVOKE`, `ALTER DEFAULT PRIVILEGES` —, que nunca aparecem num diff
gerado. Remover a unicidade e desempatar por `ordem, id` barateia a escrita e torna legal
duas etapas na mesma posição, trocando uma garantia dura por conveniência.

**Buracos em `ordem` são inofensivos e não são renumerados.** Apagar a etapa de `ordem: 2`
deixa 0, 1, 3, 4. `orderBy: { ordem: "asc" }` não liga, a troca de vizinhas troca os
valores reais, e `criarLead` continua achando a primeira etapa por
`findFirstOrThrow({ orderBy: { ordem: "asc" } })`. Renumerar seria escrita a mais para
resolver problema nenhum. **Consequência que a § 11 cobra:** `pipeline-stages.test.ts:37`
hoje exige `ordem` densa (`[0,1,2,3,4]`), o oposto disto. Manter os dois no repositório é
manter uma contradição, não uma salvaguarda.

**Etapa nova entra no fim:** `ordem = (max ?? -1) + 1`.

## 6. A validação de `cor` é de segurança, não de estética

`etapa.cor` cai direto em `style={{ borderTopColor: etapa.cor }}`
(`src/components/leads/kanban-board.tsx:197`) e em `fill={etapa.cor}` no gráfico do painel
(`conversion-chart.tsx:30`). Hoje o valor vem de uma constante do seed; com a tela, passa a
vir de quem digitou.

A tela usa `<input type="color">`, que só produz `#rrggbb`. Isso é validação de navegador —
a Server Action responde a qualquer POST. **O regex no servidor é a defesa**; o
`<input type="color">` é conveniência.

## 7. A exclusão é uma transação, e a auditoria nasce dentro dela

```ts
const leadsMovidos = await prisma.$transaction(async (tx) => {
  const { count } = await tx.lead.updateMany({
    where: { stageId: alvo },
    data: { stageId: destino },
  });
  await tx.pipelineStage.delete({ where: { id: alvo } });
  await gravarLinhaDeAuditoria(
    {
      userId: autorId,
      acao: "excluir_etapa",
      entidade: "PipelineStage",
      entidadeId: alvo,
      antes: { nome, ordem, ehGanho },
      depois: { destinoId: destino, leadsMovidos: count },
    },
    tx
  );
  return count;
});

await avaliarAtividadeSuspeita({ userId: autorId, acao: "excluir_etapa" });
```

**Forma interativa, não a de array.** Na forma `$transaction([...])` nenhuma operação pode
depender do resultado de outra — e o número de leads movidos só existe depois que o
`updateMany` roda. A promessa de "gravar quantos leads foram movidos" é incumprível ali; o
número teria que vir de uma leitura feita antes da transação, isto é, de uma estimativa. A
forma interativa é a que o projeto já usa em `modules/whatsapp/ingest.ts:44`.

**Ou a etapa some com o rastro, ou nada some.** Esta é a **única** entrada forense da
operação — não há entrada por lead —, e a etapa de origem deixa de existir, então não há de
onde reconstituir de onde os leads vieram. O projeto já formulou essa regra em
`core/audit/log.ts:54-59`: na exportação o log é *fail-closed* "porque lá o log ERA o
registro". Aqui também é.

**O que isso obriga em `core/audit/log.ts`.** `registrarAuditoria` importa `prisma` do
módulo e chama `avaliarAtividadeSuspeita` no fim — não aceita cliente de transação, e não
deveria arrastar a detecção de rajada (que faz `count`, `findMany` de ADMINs e `createMany`
de notificações) para dentro de uma transação que está segurando lock em linhas de `Lead`.
A mudança é uma separação, compatível com os chamadores existentes:

- `gravarLinhaDeAuditoria(params, cliente = prisma)` — só escreve a linha.
- `registrarAuditoria(params)` — chama a primeira e depois `avaliarAtividadeSuspeita`.
  Comportamento idêntico ao de hoje para todos os chamadores atuais.

**Por que uma entrada e não uma por lead.** 40 entradas `mover_etapa` afogariam a única
linha que importa em 40 que não importam.

**Correção de uma afirmação errada da versão anterior desta spec:** eu havia escrito que 40
entradas cruzariam o `LIMITE_ALERTA` e disparariam o alerta de rajada. Isso não acontece.
`avaliarAtividadeSuspeita` retorna cedo quando a ação não é sensível (`alerta.ts:103`) e
conta apenas `acao: { in: ACOES_SENSIVEIS }` (`:117`); `mover_etapa` não só está fora da
lista como é citada nominalmente no docblock (`:45-46`) como trabalho normal que fica de
fora. A decisão continua certa pela primeira razão; a segunda descrevia um mecanismo que
não existe. **Fica escrito que o detector não cobre movimentação de lead**, para a próxima
branch não presumir cobertura que não há.

**`excluir_etapa` entra em `ACOES_SENSIVEIS`** (`core/audit/alerta.ts:52`): destrói
estrutura e reescreve `stageId` em massa, que é o critério declarado da lista.
`criar_etapa`, `editar_etapa` e `reordenar_etapa` ficam de fora, junto com o trabalho
normal.

**O `updateMany` não filtra `arquivadoEm`, e está certo:** a etapa vai deixar de existir, e
quem segura a FK tem que sair junto. Consequência a assumir: a transação mexe em mais linhas
do que a coluna "leads" da tela mostra — por isso o número auditado é o `count` devolvido
pelo próprio `updateMany`, **nunca** uma leitura anterior.

**O `updateMany` não toca `ultimaInteracaoEm`.** Mudar a estrutura do funil não é interação
com o lead; marcar 40 leads como interagidos hoje corromperia a única coluna que diz o
contrário.

## 8. A tela

**Rota `/etapas`, rótulo "Etapas"**, no segundo grupo do menu, ao lado de "Equipe", visível
só com `gerenciar_funil` — mesmo padrão de `painel-nav.tsx:42`.

**Não "Funil".** O menu já tem um item com esse rótulo: `/leads/kanban`
(`painel-nav.tsx:17`). Dois links com o mesmo nome acessível são ambíguos para leitor de
tela e quebram locators por nome no e2e.

`IconeDoPainel` (`src/components/nav-links.tsx:10`) é uma união fechada com um
`Record<IconeDoPainel, LucideIcon>` — adicionar `"etapas"` obriga o compilador a exigir a
entrada no mapa, então não há como esquecer metade. Ícone: `SlidersHorizontal`.

A página redireciona para `/` quem não é ADMIN, e **as actions recusam por conta própria**:
a página não é a defesa (ver o comentário em `usuarios/page.tsx:22-26`). `usuarios/page.tsx`
é o molde da tela — formulário de criação em cima, tabela embaixo.

Uma linha por etapa, na ordem de exibição: nome, cor, quantos leads, setas ↑↓ (a primeira
sem ↑, a última sem ↓), marcador de fechamento e Excluir. A célula de contagem mostra os
dois números quando divergem — **"12 (3 ativos)"** —, porque esconder o arquivado nesta tela
é o que cria o beco sem saída da § 4.

**O marcador de fechamento** aparece como *badge* estático "Fechamento" na etapa que tem
`ehGanho`, e como botão "Marcar como fechamento" nas demais. Não é um `<input type="radio">`:
o rádio sugere que a mudança acontece ao selecionar, quando na verdade cada clique é uma
Server Action com ida e volta ao servidor — e um rádio que volta sozinho para a posição
anterior quando a rede cai é pior que um botão que mostra erro.

**Editar** abre diálogo com nome e cor, como em Equipe. Não há edição *inline*: o nome de
uma etapa é vocabulário compartilhado por todo mundo que usa o CRM, e um campo que salva ao
sair do foco torna fácil demais renomear sem querer.

**A exclusão precisa de diálogo próprio.** `ConfirmarDialogo` (criado na branch de tarefas)
só aceita rótulos. Quando a etapa tem **qualquer** lead — arquivado inclusive —, o diálogo
mostra "Esta etapa tem 12 leads (3 ativos, 9 arquivados). Todos serão movidos." e um
`<select>` de destino, e o botão de confirmar fica desabilitado até haver escolha. O ramo
**sem** `<select>` só aparece quando a contagem total é zero.

Quem manda no ramo é o arquivado, não o ativo. É contraintuitivo na tela e óbvio no banco:
quem escolhe destino resolve a FK; quem não escolhe deixa a etapa presa com um erro que só
o Postgres explica. E a decisão do ramo é do **servidor**: `excluirEtapa` recusa sem destino
quando há leads, com `EtapaInvalidaError`, antes de deixar o `delete` chegar na FK. O
diálogo é conveniência; a recusa é a defesa.

## 9. Invalidação de cache

Mexer numa etapa afeta o quadro (colunas), o painel (cartões por etapa e taxa de conversão),
a listagem (filtro por etapa), o detalhe do lead (o `<select>` de etapa) e o **histórico do
contato** (`contatos/[id]` renderiza a coluna "Etapa" via `lead.etapaNome` —
`core/contacts/queries.ts:183` e `contatos/[id]/page.tsx:79,90`). As cinco actions invalidam
o mesmo conjunto, por um helper único no molde de `invalidarCaminhosDeLead`:

```ts
revalidatePath("/");                                // painel
revalidatePath("/leads");                           // listagem
revalidatePath("/leads/kanban");                    // quadro
revalidatePath("/(painel)/leads/[id]", "page");     // TODOS os detalhes de lead
revalidatePath("/(painel)/contatos/[id]", "page");  // TODOS os detalhes de contato
```

Os dois últimos usam **padrão de rota**, e não caminho literal como faz
`invalidarCaminhosDeLead`, porque aqui não existe *um* lead ou *um* contato afetado:
renomear "Proposta" muda o texto de toda pessoa que tenha um lead ali, e a action não sabe
quem são sem uma consulta que não vale a pena fazer.

**Os dois detalhes que a doc do Next 16.3 exige e que são fáceis de errar** (verificados em
`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md`):

1. `type: "page"` é **obrigatório** quando o caminho tem segmento dinâmico, e invalida todas
   as instâncias.
2. O prefixo do *route group* `/(painel)` entra no caminho porque `revalidatePath` "opera na
   estrutura de arquivos da rota, não na URL visível". Este projeto já pagou por isso uma
   vez: `core/leads/actions.ts:82-98` documenta que `revalidatePath("/", "layout")` não é "o
   layout do painel" — a própria doc classifica essa chamada à parte, como *"Revalidating
   all data"*, que purga o Client Cache e invalida o app inteiro.

Caminhos literais (`/leads`, `/contatos`) dispensam o prefixo e o `type` — é assim que
`core/contacts/actions.ts:108-109` já funciona.

**Não confiar no comportamento temporário.** O bloco *"Good to know"* da mesma doc diz que,
em Server Functions, `revalidatePath` **hoje** também atualiza todas as páginas já visitadas
— e que isso *"is temporary and will be updated in the future to apply only to the specific
path"*. É o que mascararia um caminho esquecido nesta lista. O mapa acima existe para não
depender dessa gentileza.

## 10. O painel presume cinco etapas — e deixa de presumir

O kanban foi escrito agnóstico ao tamanho do funil: `flex gap-4 overflow-x-auto`, colunas
`w-72 shrink-0`, `key={etapa.id}`. Qualquer número de etapas rola na horizontal, e nada nele
muda com esta branch.

O painel não. `StageSummary` monta os cartões num grid de largura literal:

```tsx
<div className="grid grid-cols-2 gap-3 md:grid-cols-5">   // stage-summary.tsx:26
```

É o único lugar do sistema onde o tamanho do funil está fixado em constante de layout —
exatamente o número que esta branch existe para tornar variável. Com seis etapas, um cartão
fica sozinho numa segunda linha; com duas, sobram três colunas vazias.

**A correção, uma linha:**

```tsx
<div className="grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
```

`auto-fit` colapsa as trilhas vazias e distribui o `1fr` entre as que sobram: com as cinco
etapas semeadas o resultado é **idêntico ao de hoje**. Não é redesenho, é tirar o `5` do
caminho.

**`key={etapa.nome}` vira `key={etapa.id}`** em `stage-summary.tsx:28` e
`conversion-chart.tsx:30`. Não pela corrida da § 2 — com um único ADMIN ela é quase
inalcançável e o pior desfecho aqui seria um aviso de desenvolvimento. É porque `id` já é a
chave do kanban e do `<select>` de etapa, e o painel deixa de se apoiar numa unicidade que a
§ 2 declaradamente **não** garante no banco.

**Dois comentários passam a mentir, e saem na mesma branch:**

- `src/app/(painel)/page.tsx:53-58` — *"A etapa 'ganha' é SEMPRE a última do funil e SEMPRE
  única — invariante garantida por `confirmarInvarianteEhGanho()` (prisma/seed.ts)"*.
- `src/components/dashboard/stage-summary.tsx:19` — *"A etapa `ehGanho` (exatamente uma,
  sempre a última do funil)"*.

A decisão 3 revoga "sempre a última"; a decisão 1 revoga "garantida pelo seed". O código não
depende da posição — `etapas.find((e) => e.ehGanho)` funciona com o fechamento em qualquer
lugar — e é justamente por isso que a correção entra aqui: nenhum teste, nenhum tipo e
nenhum lint vai apontar esses comentários um dia. Ou saem nesta branch, ou ficam para sempre.

Custo total da seção: três linhas de código e dois comentários.

## 11. Testes

### O que quebra, e deve quebrar

A lista abaixo é resultado de `grep -rn "client.funil" tests/`, não de memória — a versão
anterior desta spec parou em `seed.test.ts` e deixou passar um arquivo inteiro.

**Nenhum deles fica vermelho no dia do merge:** o banco ainda terá as cinco etapas
semeadas, com nome e `ordem` densa, então `npx vitest run` passa. Eles viram vermelho na
primeira vez que o ADMIN usar a tela — e sem caminho de volta, porque o seed novo só semeia
com a tabela vazia e `Lead.stageId` é `ON DELETE RESTRICT`. Por isso os quatro pontos são
tratados **junto com o código**, não depois.

| Onde | O que sai | O que fica no lugar |
|---|---|---|
| `seed.test.ts:59` | `stages: client.funil.length` | contagem comparada antes/depois — o que aquele teste prova é **não duplica**, não **são cinco** |
| `seed.test.ts:79-80`, no describe "contrato ehGanho" (**não** é o de órfãs) | `.ordem === client.funil.length - 1` e `.nome === client.funil[length - 1]` | só `expect(marcadasComoGanho).toHaveLength(1)` — a invariante real da § 2. Criar "Negociação" no fim e marcá-la como fechamento é o caso de uso central da decisão 3, e derrubaria as duas asserções removidas |
| `seed.test.ts:105-188` | o describe de reconciliação de órfãs — **um** describe com dois `it` (116 e 145), não dois describes como eu escrevi antes | nada: testa `reconciliarEtapasOrfas`, que está sendo apagada |
| `pipeline-stages.test.ts:35-37` | `toHaveLength(client.funil.length)`, `map(nome) === client.funil` e `map(ordem) === [0,1,2,3,4]` | o `it` passa a provar o que só ele prova: `listarEtapas()` devolve **todas** as linhas na ordem de `ordem`, comparando ids com um `findMany({ orderBy: { ordem: "asc" } })` direto, mais `toBeGreaterThanOrEqual(1)` |

`pipeline-stages.test.ts` não era citado em lugar nenhum da versão anterior — meu `grep` por
`PipelineStage` não o encontrou porque o arquivo nunca escreve essa palavra. A linha 37
merece nome próprio: ela exige `ordem` **densa**, o contrário direto da § 5.

Os outros dois `it` do arquivo (`ordem` estritamente crescente; a primeira é a de menor
`ordem`) **ficam como estão**: provam contrato, não configuração. O `beforeAll(seed)` também
fica, agora como garantia de "existe ao menos uma etapa" — com a tabela cheia ele vira
no-op, que é o comportamento correto.

`seed-demo.test.ts` é tratado na § 3, e é o mais urgente dos quatro, porque não é uma
asserção velha: é uma exceção no `beforeAll` que derruba o portão de merge inteiro.

### Novos

| Arquivo | Prova |
|---|---|
| `pipeline-schema.test.ts` | nome vazio/longo demais, cor fora do formato, normalização para minúscula |
| `pipeline-transacoes.test.ts` | Prisma mockado: a troca emite três `UPDATE`s dentro de um `$transaction` com o estacionamento negativo no meio; e `definirEtapaDeFechamento` desliga todas antes de ligar a escolhida |
| `pipeline-service.test.ts` | Postgres real: as invariantes de **recusa** da § 2 e a exclusão com movimentação, incluindo o caso do lead arquivado |
| `pipeline-actions.test.ts` | permissão negada, `ResultadoAcao` em todos os ramos, invalidação dos cinco caminhos |
| `etapas-table.test.tsx` | primeira linha sem ↑, última sem ↓, diálogo exige destino quando há leads |
| `tests/e2e/etapas.spec.ts` | criar → renomear → subir → descer → excluir; e o painel mostrando um cartão por etapa enquanto a extra existe |

**`definirEtapaDeFechamento` é provada com Prisma mockado, e não contra o banco real, de
propósito.** Aquela função desliga `ehGanho` de *todas* as etapas antes de ligar a escolhida
— rodá-la contra o Postgres compartilhado apagaria a flag da "Fechado" de produção, e
"limpa o que criou" não restaura flag de linha que o teste não criou. O que o banco real
prova são as **recusas**, que não escrevem nada.

`pipeline-service.test.ts` ganha o caso que nenhum outro alcança: etapa própria com um único
lead **arquivado** — sem destino recusa com erro de domínio (não `P2003`), com destino move
o arquivado junto e apaga.

### O risco que o e2e corre, e como ele é contido

O e2e roda contra o banco real **e em paralelo**: `playwright.config.ts:29` tem
`fullyParallel: true` e `:49` tem `workers: 3`. O próprio repositório documenta o que isso
significa, em `tests/e2e/whatsapp-agente.spec.ts:85-88`: *"`fullyParallel` continua
paralelizando ENTRE arquivos (este roda em paralelo com auth.spec.ts, lead-to-won.spec.ts
etc.)"*. E `test.describe.configure({ mode: "serial" })` serializa só dentro de um arquivo.

**"Criar a própria etapa e exercer o ciclo nela" não bastava, e a razão está na § 5.** A
etapa nova nasce em `ordem = max + 1`, depois de "Fechado", e por isso a única seta desenhada
nela é ↑. Esse primeiro ↑ é a troca da § 5, e a vizinha cuja `ordem` ela **escreve** só pode
ser "Fechado" — uma das cinco semeadas. Enquanto a troca vale, o funil é Novo(0), Contato
feito(1), Visita agendada(2), Proposta(3), NOVA(4), Fechado(5), e "Fechado" deixa de ser
vizinha de "Proposta", que é a adjacência de que `lead-to-won.spec.ts` depende:
`arrastarComTeclado(..., colunaProposta, "ArrowLeft")` anda uma coluna por toque
(`COLUNA_PASSO_PX = 304`), passaria a acender a etapa nova, e o `toPass` de 15s estouraria.
A mesma troca ainda desloca "Fechado" 304px para a direita, na direção do limite de viewport
que o comentário de `lead-to-won.spec.ts:329-334` já registra.

**A regra de contenção, então, não é "nunca toca nas cinco" — é "a troca acontece entre DUAS
etapas que o próprio teste criou".** `etapas.spec.ts` cria **duas** etapas com nomes
improváveis, que entram nas duas últimas posições, renomeia uma e exerce ↑ e ↓ na última: a
troca escreve só as duas linhas que o teste criou. Etapa acrescentada no fim não desloca
nenhuma anterior, então a adjacência Proposta↔Fechado fica intacta durante a execução
inteira, inclusive no meio da troca. No fim, exclui as duas.

Se algum dia se quiser o ciclo contra uma vizinha semeada, o paralelismo precisa ser barrado
de verdade: um `project` próprio em `playwright.config.ts` com `workers: 1` e `dependencies`.
`mode: "serial"` não serve.

O mesmo princípio vale para `pipeline-service.test.ts`: cria as etapas que usa e limpa o que
criou.

### Sabotagens obrigatórias

Cada teste novo quebra o código de propósito antes de ser aceito:

1. Trocar duas etapas sem o estacionamento negativo → vermelho por violação de unicidade.
2. Deixar a exclusão da etapa de fechamento passar → vermelho na invariante.
3. Mandar `cor: "red; background: url(x)"` direto na action → vermelho no schema.
4. Marcar a segunda etapa como fechamento sem desligar a primeira → vermelho na contagem.
5. Decidir o ramo da exclusão por `contarLeadsPorEtapa()` em vez da contagem sem filtro →
   vermelho no caso do lead arquivado, por violação da FK.
6. Inserir uma etapa extra **entre** "Proposta" e "Fechado" e rodar a suíte inteira →
   `lead-to-won.spec.ts` vermelho no `toPass`. É a prova de que a contenção acima é
   necessária; repetir com a etapa extra no fim e ver verde é a prova de que ela funciona.
7. Criar uma 6ª etapa e rodar `npx vitest run tests/unit/seed-demo.test.ts` → antes da
   correção da § 3, vermelho no `beforeAll`; depois, pulado com motivo impresso.

## 12. Fora deste desenho, de propósito

- **`ehPerdido`** continua morto. Ativá-lo mexeria em painel, listagens e kanban.
- **O kanban não muda** — consome `listarEtapas()`, cuja assinatura é preservada, e já é
  agnóstico ao tamanho do funil. **O painel muda e está no escopo:** ver § 10.
- **Generalizar a distribuição do `seed-demo`** para funil de tamanho arbitrário — § 3
  explica por que vira escopo de outra branch. Fica como dívida registrada.
- **Não há "arquivar etapa"**; a decisão 2 tornou o arquivamento desnecessário.
- **`Organization`** é o próximo item da fila, não deste desenho.
- **Renumerar `ordem` para ficar densa** — § 5 explica por que não.

## Verificação, antes de integrar

```
npm run typecheck && npm run lint
npx vitest run
npm run test:e2e
```

E, antes de merge ou PR, a **Fase 1 da skill `auditoria-seguranca`** sobre a superfície
tocada: as cinco Server Actions novas, a permissão nova, a escrita em massa de
`Lead.stageId`, o valor de `cor` que atravessa para atributo `style` e para `fill` do
gráfico, a mudança em `core/audit/log.ts`, e o que entra no `AuditLog`. Relatório entregue,
e **para** — correção só depois da aprovação do dono.

## Registro da revisão adversarial

Esta spec passou por uma revisão de quatro lentes independentes (fidelidade ao código,
segurança e concorrência, alternativas melhores, testes), com cada achado submetido a um
cético encarregado de derrubá-lo. Oito achados, seis confirmados contra o código e
incorporados acima. **Os dois derrubados ficam registrados, porque saber o que foi
investigado e descartado vale tanto quanto saber o que mudou:**

- *"A invariante `exatamente 1 ehGanho` não sobrevive a `READ COMMITTED`."* O mecanismo é
  real no Postgres, mas exige dois ADMINs disparando a ação em etapas diferentes dentro da
  janela de milissegundos de uma transação, numa ação estrutural feita algumas vezes por
  ano; o estado ruim se desfaz sozinho no clique seguinte, porque
  `definirEtapaDeFechamento` começa desligando todas; e a "defesa dura" proposta se apoiava
  na premissa falsa de que este repositório convive com objetos de schema não representáveis
  pelo Prisma — os três SQL manuais que existem são `RLS`/`REVOKE`/`ALTER DEFAULT
  PRIVILEGES`, classe que nunca aparece num diff.
- *"O estacionamento negativo só é provado contra Prisma mockado."* Falso: `etapas.spec.ts`
  exerce subir e descer pela UI contra o Postgres real, atravessando o índice
  `PipelineStage_ordem_key` de verdade, e `npm run test:e2e` está no portão de merge.
