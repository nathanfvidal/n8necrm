# Editar o que já existe

Data: 2026-08-08

## 1. O problema

O CRM cria e não corrige. Um lead cadastrado com o responsável errado fica errado para
sempre; uma tarefa com a data trocada não se ajusta; uma nota digitada com erro entra no
histórico definitivamente. Um levantamento contra CRMs em geral mostrou muitas lacunas, e
esta é a mais visível no uso diário: não é falta de recurso avançado, é falta de desfazer.

Há um segundo problema, encontrado durante o levantamento e maior do que parece.
**`Lead.valorEstimado` está morto**: a coluna existe, e nenhum caminho de código a escreve
ou lê. A única menção no projeto é um comentário em `core/audit/log.ts` sobre serialização
de `Decimal`. Quer dizer que o CRM não sabe quanto vale nenhum negócio — o dado que faz
funil e painel terem sentido.

Então "editar lead" não é só corrigir digitação. É a primeira vez que o sistema vai
registrar o valor de um negócio.

**Resultado pretendido:** o que foi criado pode ser corrigido, arquivado ou apagado por
quem tem direito, com rastro de quem mexeu; e o valor do negócio passa a existir.

## 2. Escopo

| Entrega | Detalhe |
|---|---|
| Editar lead | Valor, responsável e etapa |
| Arquivar lead | Sai do funil e das somas, sem apagar histórico |
| Editar e excluir tarefa | Título, descrição, vencimento, vínculo com lead — só as próprias |
| Editar e excluir nota | Só as próprias, marcando que foi editada |

**Fora, de propósito:** paginação (o maior cliente previsto tem ~500 leads);
Empresa/Organização; motivo de perda; trocar o contato de um lead; editar o canal; delegar
tarefa a outra pessoa.

O **canal** fica de fora por decisão, não por esquecimento: ele é a procedência do lead
(de onde a pessoa veio), e torná-lo editável faz qualquer relatório de origem deixar de
ser confiável.

## 3. As duas regras que o código já tem, e que esta spec respeita

O projeto separa **pipeline compartilhado** de **lembrete pessoal**, e
`core/tasks/service.ts` carrega um aviso explícito para nunca igualar os dois:

- **Lead é colaborativo.** Qualquer vendedor move o lead de qualquer colega. Editar e
  arquivar seguem a mesma regra e reusam a permissão `mover_lead`, que todos os papéis já
  têm. Nenhuma permissão nova.
- **Tarefa é pessoal.** Só o dono conclui — e agora só o dono edita e exclui.

**Nota segue a regra do dono**, como tarefa: só o autor edita e exclui.

Nota e tarefa devolvem a **mesma mensagem** para "não existe" e "não é sua", como
`concluirTask` já faz. Diferenciá-las confirmaria, a quem adivinha ids, que aquele id
pertence a alguém.

### Auditoria: a mesma linha divisória

**Auditado** — `atualizarLead`, `arquivarLead`, `desarquivarLead`, `editarNota`,
`excluirNota`. São dados do funil, que a equipe inteira vê e sobre os quais um gestor
precisa saber quem mexeu.

**Não auditado** — `editarTask`, `excluirTask`. Consistente com `criarTask` e
`concluirTask`, que já não auditam. Uma linha de auditoria por título de lembrete
corrigido é ruído.

## 4. Modelo de dados

```prisma
model Lead {
  valorEstimado  Decimal?  @db.Decimal(14, 2)   // era Decimal? sem precisão
  arquivadoEm    DateTime?                       // null = ativo
  @@index([arquivadoEm])
}

model LeadNote {
  editadoEm      DateTime?                       // null = nunca editada
}
```

**`@db.Decimal(14, 2)`** corrige um defeito existente: sem precisão declarada, o Prisma
usa o padrão do Postgres e a coluna aceita 30 casas decimais — frações de centavo. Dinheiro
tem exatamente duas. A migração é segura porque a coluna está inteiramente nula hoje: não
existe valor gravado para arredondar ou truncar.

**`arquivadoEm` e não `ativo`**, e **coluna e não etapa "Arquivado"**. A coluna guarda
*quando*, seguindo `Task.concluidaEm`. Uma etapa no funil seria mais barata (zero
migração), mas o lead arquivado continuaria dentro do funil, aparecendo no kanban e
somando no painel — exatamente o que arquivar deve evitar. E `ehGanho`/`ehPerdido` mostram
que etapa carrega significado de negócio; "arquivado" ali misturaria *onde o negócio está*
com *este registro conta?*.

**`editadoEm`** existe para a tela poder marcar "editada". Sem isso, alguém corrige uma
nota e o histórico mente por omissão: o texto muda e nada indica que mudou.

Tarefa não ganha coluna. `titulo`, `descricao`, `vencimento` e `leadId` já existem e passam
a ser graváveis; excluir é remoção real, porque nada referencia `Task`.

## 5. Dinheiro

`valorEstimado` traz duas armadilhas, e a segunda quase passou.

**`Decimal` não atravessa a fronteira servidor→cliente.** É um objeto Decimal.js, não um
valor serializável. Toda consulta que alimente componente de cliente converte para
**string**, nunca para `Number` — dinheiro em ponto flutuante é a origem clássica de
centavo que some.

**Texto com separador é ambíguo e não há regra que resolva:**

| Digitado | Pode ser | Ou pode ser |
|---|---|---|
| `1.500` | 1500 (milhar BR) | 1,5 (decimal EUA) |
| `1.5` | 1,5 | 15 (milhar malformado) |

Qualquer regra escolhida seria palpite, e o modo de falhar é o pior: silencioso, com o
número errado indo para o painel. Um `parseFloat("1.500,50")` devolve `1.5` sem erro
nenhum.

**Solução: o campo não aceita separador digitado.** A máscara formata enquanto se digita,
com os algarismos entrando pela direita, como caixa de banco:

| Teclas | Mostra |
|---|---|
| `15050` | `1.500,50` |
| `15000000` | `150.000,00` |
| `150000000` | `1.500.000,00` |

Assim "1,5 milhão" e "150 mil" deixam de ser problema de interpretação e viram conferência
visual — a pessoa vê a ordem de grandeza formada na tela e confirma na hora.

**O servidor valida por conta própria**, em `src/lib/dinheiro.ts`, espelhando o que
`src/lib/date.ts` faz com `parseDataCivil` para o `<input type="date">`. Regra estrita e
única: ponto só como milhar em grupos de três, vírgula como decimal, dois dígitos. `1.5` é
**recusado** com mensagem clara em vez de virar `1.5` ou `15`. Isso é defesa em
profundidade — Server Action é endpoint HTTP público e a máscara vive no cliente.

Módulo puro, sem Prisma, testável sem mock — como `sentry-scrub.ts`.

**Descartado:** aceitar `1,5 mi` e `150 mil`. Acrescenta superfície de interpretação para
resolver um problema que a formatação ao vivo já resolve, e traz ambiguidade nova.

## 6. Camada de serviço

Sete funções, no padrão que `criarLead` e `moverEtapa` estabelecem: `autorId` explícito
(a barreira contra id forjado fica em `actions.ts`, que o deriva de `usuarioAtual()`),
validação de chave estrangeira antes de escrever, e erro de domínio legível em vez de
violação crua do Postgres.

**`core/leads/service.ts`** — `atualizarLead({ leadId, valorEstimado, responsavelId, stageId, autorId })`,
`arquivarLead`, `desarquivarLead`.

**`core/leads/notes.ts`** — `editarNota({ notaId, texto, autorId })`, `excluirNota`.

**`core/tasks/service.ts`** — `editarTask`, `excluirTask`.

**`atualizarLead` não reusa `moverEtapa`.** Grava uma auditoria `atualizar_lead` com
apenas os campos que mudaram de fato. O arraste do kanban continua em `moverEtapa`,
gravando `mover_etapa`. Duas entradas diferentes de propósito: saber se o negócio andou
por arraste no funil ou por correção no formulário é informação, não redundância. Quando a
etapa muda, os dois atualizam `ultimaInteracaoEm`.

## 7. Server Actions

Sete, devolvendo `ResultadoAcao` de `@/lib/acao`, com `usuarioAtual()` **dentro** do
`try` — fora dele, uma sessão expirada rejeita sem produzir resultado e a tela não mostra
nem sucesso nem erro.

Invalidação explícita de `/leads`, `/leads/kanban`, `/leads/[id]`, `/` e `/contatos/[id]`,
em vez de `revalidatePath("/", "layout")` — que a doc do Next classifica como "revalidando
todos os dados" e esconde o que de fato depende do quê.

## 8. Telas

**`/leads/[id]`** ganha a edição. `lead-form.tsx` recebe prop opcional `lead?` e passa a
servir criar e editar, como `contact-form.tsx` já faz com `contato?`. Arquivar é botão à
parte, com confirmação, porque some da lista.

**Notas e tarefas editam em linha**, no padrão de `user-table.tsx` (um estado com o id da
linha em edição). Os botões só aparecem para o autor ou dono, mas isso é conveniência:
**quem recusa é o servidor**, porque esconder botão não protege endpoint.

**Quatro consultas passam a filtrar arquivados**: `listarLeads`, `listarLeadsPorEtapa`, a
agregação do painel e o export CSV.

**E `/leads` ganha um alternador "mostrar arquivados"** (`?arquivados=1`, no mesmo estilo
do `?q=` da busca de contatos: `<form method="get">`, sem estado no cliente). Sem ele,
arquivar seria mão única — a autorrevisão desta spec pegou justamente isso: `desarquivarLead`
existia no serviço e nenhuma tela alcançava um lead arquivado para chamá-la. A tela de
detalhe continua acessível por URL e mostra "Desarquivar" no lugar de "Arquivar".

**Uma exceção deliberada:** o histórico do contato mostra leads arquivados, marcados como
tal. "O que aconteceu com esta pessoa" precisa ser completo; é o funil que precisa ser
limpo. Registrado aqui porque é o tipo de exceção que alguém "corrige" depois por engano.

## 9. Testes

**`dinheiro.ts`** — os casos que importam são os que falhariam em silêncio: `1.500,50` vira
1500.50; `1.500` vira 1500 e **não** 1,5; `1.5` é **recusado**.

**Serviço** — regra de dono em nota e tarefa, incluindo que a mensagem de "não é sua" é
idêntica à de "não existe"; auditoria gravada exatamente onde a § 3 define; `atualizarLead`
registrando só os campos alterados.

**O teste que mais importa:** um único teste percorre os **quatro** caminhos de listagem e
prova que o lead arquivado sumiu de todos. É a armadilha "regra numa tela, esquecida na
outra" — a que faz o lead reaparecer justamente no painel do gestor.

**E2E** — editar o valor e vê-lo na tela; arquivar e confirmar que sumiu da lista, do
kanban e do painel, e que **continua** no histórico do contato.

Cada teste novo é sabotado antes de ser aceito. Foi o que pegou os quatro testes falsos
das fatias anteriores.

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Arquivado reaparece numa tela esquecida | O teste dos quatro caminhos (§ 9). É o risco central desta entrega |
| Valor errado por interpretação de separador | Máscara no cliente + `parseValorBR` estrito no servidor, com `1.5` recusado |
| Centavo perdido por ponto flutuante | `Decimal(14,2)` no banco, string na fronteira, nunca `Number` |
| Empresa/Organização (próxima entrega) forçar retrabalho | Esta entrega não toca `Contact` nem cria vínculo novo; `Lead` só ganha colunas próprias |
| Botão escondido confundido com proteção | Autorização no serviço, testada por chamada direta — não pela interface |
