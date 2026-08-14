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
criada pela interface é renomeada para "Fechado" — ou apagada — pelo próximo `npm run seed`.

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

## 2. As quatro invariantes

O seed garantia por construção o que a tela agora precisa garantir por checagem explícita
no servidor.

| Invariante | Quem quebraria | O que o servidor faz |
|---|---|---|
| Exatamente 1 etapa com `ehGanho` | marcar a segunda sem desmarcar a primeira | a mesma transação desliga a anterior |
| Nunca zero etapas com `ehGanho` | excluir a etapa de fechamento | **recusa**: "marque outra etapa como fechamento antes de remover esta" |
| Pelo menos 1 etapa no funil | excluir a última que sobrou | recusa |
| Nome não repetido | criar **ou renomear para** um nome que já existe | recusa, comparando sem diferenciar maiúscula |

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
Postgres é funcional (`LOWER(nome)`), o Prisma não o representa, e ele viraria *drift* em
todo `migrate dev` seguinte — o mesmo motivo pelo qual a branch de cadastro de contato
recusou o índice `pg_trgm`. Sobra uma janela de corrida: dois ADMINs criando o mesmo nome
no mesmo segundo. O pior desfecho é duas colunas com nome igual, consertável renomeando
uma. **Registrado como aceito, não como resolvido** — e o comentário no código deve dizer
isso, não fingir que a checagem é atômica.

## 3. O seed deixa de mandar

`prisma/seed.ts` passa a semear etapas **apenas quando `pipelineStage.count() === 0`**.

- **`reconciliarEtapasOrfas` é apagada.** Ela existe para remover etapas fora de
  `client.funil`, que é exatamente o que a tela passa a criar. Mantê-la faria o seed comer
  o trabalho do usuário na primeira reexecução.
- **`confirmarInvarianteEhGanho` fica, com o alvo trocado.** Deixa de checar o loop do
  seed e passa a checar o sistema: "o banco tem exatamente 1 etapa de fechamento". Continua
  sendo o alarme, agora apontado para a tela.
- **`client.funil` continua** em `config/client.ts` e em `config/client.schema.ts`
  (`z.array(z.string()).min(1)`). É o que permite um fork nascer com o funil dele.
- **`prisma/seed-demo.ts:270`** aborta quando não encontra exatamente 5 etapas, porque a
  distribuição de leads é *hardcoded*. A distribuição **não muda**; muda só a mensagem de
  erro, que hoje culpa `client.funil` e passa a ter uma segunda causa possível: alguém
  criou ou removeu etapa pela tela.

## 4. `src/core/pipeline/` ganha corpo

Hoje é um arquivo com uma função.

| Arquivo | Responsabilidade |
|---|---|
| `stages.ts` | `listarEtapas()` — **intocada** |
| `schema.ts` (novo) | Zod dos campos, no molde de `core/contacts/schema.ts` |
| `service.ts` (novo) | `criarEtapa`, `editarEtapa`, `moverNaOrdem`, `definirEtapaDeFechamento`, `excluirEtapa`; lança `EtapaInvalidaError` |
| `actions.ts` (novo) | Cinco Server Actions, todas devolvendo `ResultadoAcao` |

**Zod:** `nome` obrigatório, `trim`, ≤ 40 caracteres; `cor` casando `/^#[0-9a-f]{6}$/i`,
normalizada para minúscula. Segue a decisão da branch de contatos — Zod valida entrada de
usuário dentro de `core/`, com `safeParse` convertido em erro de domínio
(`storage.ts:133-138` é o modelo).

**`ResultadoAcao` não é opcional.** A branch anterior acabou de converter 14 actions para
esse contrato e tirar as cinco comparações de string do cliente. Nascer fora dele criaria,
no mesmo mês, a dívida que acabou de ser paga. `hasPermission(papel, "gerenciar_funil")`
vai **dentro** do `try`, como em `core/leads/actions.ts`.

**A contagem de leads por etapa não é consulta nova.** `contarLeadsPorEtapa()` já existe em
`core/leads/queries.ts`, feita com `groupBy`, sem teto — escrita para o painel na branch
passada e reaproveitada aqui sem uma linha a mais.

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
Prisma não representa `DEFERRABLE` e todo `migrate dev` seguinte veria *drift*. Remover a
unicidade e desempatar por `ordem, id` barateia a escrita e torna legal duas etapas na
mesma posição, trocando uma garantia dura por conveniência.

**Buracos em `ordem` são inofensivos e não são renumerados.** Apagar a etapa de `ordem: 2`
deixa 0, 1, 3, 4. `orderBy: { ordem: "asc" }` não liga, a troca de vizinhas troca os
valores reais, e `criarLead` continua achando a primeira etapa por
`findFirstOrThrow({ orderBy: { ordem: "asc" } })`. Renumerar seria escrita a mais para
resolver problema nenhum.

**Etapa nova entra no fim:** `ordem = (max ?? -1) + 1`.

## 6. A validação de `cor` é de segurança, não de estética

`etapa.cor` cai direto em `style={{ borderTopColor: etapa.cor }}`
(`src/components/leads/kanban-board.tsx:197`). Hoje o valor vem de uma constante do seed;
com a tela, passa a vir de quem digitou.

A tela usa `<input type="color">`, que só produz `#rrggbb`. Isso é validação de navegador —
a Server Action responde a qualquer POST. **O regex no servidor é a defesa**; o
`<input type="color">` é conveniência.

## 7. A exclusão é uma transação, e uma auditoria só

```
$transaction([
  lead.updateMany({ where: { stageId: alvo }, data: { stageId: destino } }),
  pipelineStage.delete({ where: { id: alvo } }),
])
```

Depois, **uma** entrada `excluir_etapa` no `AuditLog`, com o nome da etapa removida, o
destino e quantos leads foram movidos — **não uma por lead**. Duas razões: 40 entradas
`mover_etapa` inchariam o log sem servir a investigador nenhum, e cruzariam o
`LIMITE_ALERTA` de `core/audit/alerta.ts`, disparando o alerta de rajada destrutiva por uma
ação legítima. Treinar o ADMIN a ignorar o sino é o pior resultado possível para um
detector.

**`excluir_etapa` entra em `ACOES_SENSIVEIS`** (`core/audit/alerta.ts:52`): destrói
estrutura e reescreve `stageId` em massa, que é o critério declarado da lista.
`criar_etapa`, `editar_etapa` e `reordenar_etapa` ficam de fora, junto com o trabalho
normal — o mesmo critério que já deixa `mover_lead` fora.

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
sem ↑, a última sem ↓), marcador de fechamento e Excluir.

**O marcador de fechamento** aparece como *badge* estático "Fechamento" na etapa que tem
`ehGanho`, e como botão "Marcar como fechamento" nas demais. Não é um `<input type="radio">`:
o rádio sugere que a mudança acontece ao selecionar, quando na verdade cada clique é uma
Server Action com ida e volta ao servidor — e um rádio que volta sozinho para a posição
anterior quando a rede cai é pior que um botão que mostra erro.

**Editar** abre diálogo com nome e cor, como em Equipe. Não há edição *inline*: o nome de
uma etapa é vocabulário compartilhado por todo mundo que usa o CRM, e um campo que salva ao
sair do foco torna fácil demais renomear sem querer.

**A exclusão precisa de diálogo próprio.** `ConfirmarDialogo` (criado na branch de tarefas)
só aceita rótulos. Quando a etapa tem leads, o diálogo mostra "Esta etapa tem 12 leads" e um
`<select>` de destino com as demais etapas, e o botão de confirmar fica desabilitado até
haver escolha. Etapa vazia usa o mesmo diálogo sem o `<select>`.

## 9. Invalidação de cache

Mexer numa etapa afeta o quadro (colunas), o painel (cartões por etapa e taxa de
conversão), a listagem (filtro por etapa) e o detalhe do lead (o `<select>` de etapa). As
cinco actions invalidam o mesmo conjunto, por um helper único no molde de
`invalidarCaminhosDeLead`:

```ts
revalidatePath("/");                          // painel
revalidatePath("/leads");                     // listagem
revalidatePath("/leads/kanban");              // quadro
revalidatePath("/(painel)/leads/[id]", "page");  // TODOS os detalhes de lead
```

**Os dois detalhes que a doc do Next 16.3 exige e que são fáceis de errar** (verificados em
`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md`):

1. `type: "page"` é **obrigatório** quando o caminho tem segmento dinâmico, e invalida
   todas as instâncias — que é o que se quer aqui, já que uma etapa renomeada muda o
   `<select>` de todo lead, não de um.
2. O prefixo do *route group* `/(painel)` entra no caminho porque `revalidatePath` "opera
   na estrutura de arquivos da rota, não na URL visível". Este projeto já pagou por isso
   uma vez: `core/leads/actions.ts:82-98` documenta que `revalidatePath("/", "layout")`
   não é "o layout do painel" — a própria doc classifica essa chamada à parte, como
   *"Revalidating all data"*, que purga o Client Cache e invalida o app inteiro.

Caminhos literais (`/leads`, `/contatos`) dispensam o prefixo e o `type` — é assim que
`core/contacts/actions.ts:108-109` já funciona.

## 10. Testes

**O que quebra, e deve quebrar:** os dois `describe` de reconciliação de órfãs em
`tests/unit/seed.test.ts` testam o comportamento que está sendo removido. A asserção
`stages: client.funil.length` também sai: o banco é compartilhado e pode legitimamente ter
6 etapas depois desta branch. O que aquele teste deve provar é **não duplica**, não **são
cinco**.

**Novos:**

| Arquivo | Prova |
|---|---|
| `tests/unit/pipeline-schema.test.ts` | nome vazio/longo demais, cor fora do formato, normalização para minúscula |
| `tests/unit/pipeline-ordem.test.ts` | Prisma mockado: a troca emite três `UPDATE`s dentro de um `$transaction`, com o estacionamento negativo no meio |
| `tests/unit/pipeline-service.test.ts` | Postgres real: as quatro invariantes da § 2 e a exclusão com movimentação |
| `tests/unit/pipeline-actions.test.ts` | permissão negada, `ResultadoAcao` em todos os ramos, invalidação dos cinco caminhos |
| `tests/unit/etapas-table.test.tsx` | primeira linha sem ↑, última sem ↓, diálogo exige destino quando há leads |
| `tests/e2e/etapas.spec.ts` | criar → renomear → subir → descer → excluir, ponta a ponta |

**O risco que o e2e corre, e como ele é contido.** O e2e roda contra o banco real, e
`lead-to-won.spec.ts` depende dos nomes "Novo" e "Fechado". Um e2e de etapas que renomeie ou
reordene as cinco etapas semeadas quebra outro arquivo de teste, de forma intermitente e
difícil de rastrear — a assinatura exata do defeito de logout que motivou a regra de
auditoria do `AGENTS.md`. Então `etapas.spec.ts` **cria a própria etapa**, com nome
improvável, exerce o ciclo inteiro nela e a remove no fim. Nunca toca nas cinco.

O mesmo vale para `pipeline-service.test.ts`: cria as etapas que usa, com nome próprio, e
limpa o que criou.

**Sabotagens obrigatórias** — cada teste novo quebra o código de propósito antes de ser
aceito:

1. Trocar as duas etapas sem o estacionamento negativo → vermelho por violação de
   unicidade.
2. Deixar a exclusão da etapa de fechamento passar → vermelho na invariante.
3. Mandar `cor: "red; background: url(x)"` direto na action → vermelho no schema.
4. Marcar a segunda etapa como fechamento sem desligar a primeira → vermelho na contagem.

## 11. Fora deste desenho, de propósito

- **`ehPerdido`** continua morto. Ativá-lo mexeria em painel, listagens e kanban.
- **Painel e kanban não mudam** — consomem `listarEtapas()`, cuja assinatura é preservada.
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
tocada: as cinco Server Actions novas, a permissão nova, a escrita em massa de `Lead.stageId`,
o valor de `cor` que atravessa para um atributo `style`, e o que entra no `AuditLog`.
Relatório entregue, e **para** — correção só depois da aprovação do dono.
