# Conversa aguardando humano — aviso e estado visível

Data: 2026-08-06 · Depende de: Fatia 2 (mesclada em `main`, commit `b3109b3`)

## 1. Objetivo

A Fatia 2 deu ao CRM o poder de calar a IA — por conversa, por interruptor
global, e automaticamente quando um humano responde. Ela deixou aberto o outro
lado disso: **quando a IA cala, ninguém é avisado**. O cliente manda mensagem,
ela é gravada e aparece na inbox, e fica lá. Uma conversa pode esperar horas
sem que nenhum vendedor saiba que ela existe.

A própria spec da Fatia 2 registrou isto como lacuna conhecida (§ 9) e como
primeira candidata à fatia seguinte, à frente do catálogo. É o que esta fatia
fecha.

## 2. Escopo

**Dentro:** um campo durável na conversa marcando desde quando ela espera;
notificação in-app para todos os usuários ativos, uma por conversa; o estado
visível e ordenável na lista de conversas; limpeza automática quando alguém
responde.

**Fora, de propósito:** e-mail (§ 3.4); reaviso periódico para conversa
ignorada (§ 3.3); atribuição de conversa a um vendedor específico; qualquer
noção de horário comercial.

## 3. Decisões e por quê

### 3.1 O campo durável é a entrega; a notificação é o acessório

Notificação é evento efêmero. Se os cinco vendedores estiverem almoçando
quando o sino tocar, a conversa continua esquecida — o problema não foi
resolvido, foi movido para outro lugar.

`Conversation.aguardandoHumanoDesde` é durável: sobrevive ao sino não ter sido
visto, aparece na lista, ordena, e responde "há quanto tempo" em vez de só
"sim ou não". Construir a notificação sem ele seria construir a cutucada sem a
rede de segurança.

Descartado: só notificação, com deduplicação consultando a tabela
`Notification`. Evitaria a migração, mas `payload` é `Json` sem índice (o
filtro por conversa seria em memória) e "não lida" é por pessoa — se A leu e B
não, a conversa está avisada ou não? A pergunta não tem resposta boa, o que é
sinal de que o estado está no lugar errado.

### 3.2 A transição é decidida pelo banco, não por consulta prévia

A notificação nasce **apenas** quando o campo vai de nulo a preenchido, e quem
decide isso é um UPDATE condicional atômico:

```sql
UPDATE "Conversation" SET "aguardandoHumanoDesde" = now()
WHERE "id" = $1 AND "aguardandoHumanoDesde" IS NULL
```

Uma linha afetada significa que este processo ganhou a transição e deve criar
as notificações; zero significa que outro já marcou, e não se cria nada.

Isto importa porque turnos concorrentes na mesma conversa são normais neste
sistema — o lease existe justamente porque acontecem. Um "consulta e depois
grava" teria janela entre a leitura e a escrita, e o resultado seria a equipe
recebendo dois avisos da mesma conversa. É o mesmo idioma que `claimLease`,
`pausarIa` e `checarRateLimit` já usam.

### 3.3 Um aviso por conversa, sem reaviso periódico

Decisão do Rodrigo. Com todos os usuários como destinatários, cada aviso já é
multiplicado pelo tamanho da equipe: cinco mensagens de um cliente ansioso com
cinco vendedores seriam vinte e cinco notificações, e um sino que ninguém olha
é pior que sino nenhum.

Descartado: reavisar a cada N minutos enquanto ninguém responde. Resolveria o
caso de todos ignorarem o primeiro aviso, mas exige um mecanismo que rode
sozinho (cron), que o projeto não tem. O campo visível na lista cobre o mesmo
caso sem infraestrutura nova.

### 3.4 In-app agora, e-mail depois

Decisão do Rodrigo. Metade do trabalho, e resolve para quem está com o CRM
aberto — o caso normal de um vendedor em horário comercial. Se na prática as
conversas continuarem esperando, o e-mail se justifica com dado observado em
vez de suposição.

O caminho de e-mail já existe (`notificarNovoLead` usa Resend, melhor esforço),
então acrescentá-lo depois é somar uma chamada, não reconstruir nada.

### 3.5 Todos os usuários ativos

Decisão do Rodrigo, coerente com uma decisão que o projeto já tomou: todos veem
todos os leads. Numa revenda de três a cinco vendedores, quem estiver livre
pega.

O usuário de sistema do WhatsApp (`WHATSAPP_SYSTEM_USER_ID`) é `ativo: false`
no seed, então o filtro `ativo: true` já o exclui — sem regra especial, sem
lista de exceções que alguém precise lembrar de manter.

## 4. Modelo de dados

`Conversation` ganha um campo:

| Campo | Tipo | Nota |
|---|---|---|
| `aguardandoHumanoDesde` | `DateTime?` | Nulo = ninguém esperando |

Mais `@@index([aguardandoHumanoDesde])`, porque a lista de conversas passa a
ordenar por ele.

`DateTime?` e não `Boolean` de propósito: "esperando" não diz nada útil,
"esperando há quarenta minutos" diz tudo. O mesmo campo serve à decisão de
quem atende e à ordenação da lista.

**Nenhuma tabela nova**, então esta migração não precisa de RLS/REVOKE — a
`Conversation` já os tem desde a Fatia 1. (Vale repetir a regra: o Prisma não
emite nenhum dos dois, e toda tabela **nova** precisa deles à mão.)

O tipo de notificação novo é `"CONVERSA_AGUARDANDO"`, com payload
`{ conversationId: string; nomeExibicao: string }` — o nome é copiado no
momento da criação, congelado, pelo mesmo motivo que `NovoLeadPayload` congela
`contatoNome`: não há FK entre `Notification` e nada, e o payload não deve
depender de a conversa continuar existindo.

`nomeExibicao` é sempre uma string, nunca nula, resolvida na ordem
`contact?.nome ?? conversation.nomeExibicao ?? telefone ?? waId` — a mesma
cadeia que a tela de detalhe já usa. Um payload com `null` obrigaria o extrator
e o sino a tratar o caso, e "conversa sem nome" não é informação que ajude
alguém a decidir se atende.

## 5. Comportamento

### 5.1 Onde é marcado

`turno.ts` tem hoje quatro chamadas a `marcarPendentesComoProcessadas`. Três
são "processou sem responder" e uma é o envio normal. O campo é marcado nas
**três primeiras**:

| Ponto | Situação |
|---|---|
| Guarda de entrada | interruptor global desligado, ou conversa pausada |
| Teto por hora | conversa atingiu o limite de respostas de IA |
| Aborto pós-modelo | um humano pausou enquanto o modelo respondia |

O quarto ponto — a IA respondeu — não marca. É a distinção inteira: o cliente
só está esperando se ninguém falou com ele.

### 5.2 Onde é limpo

Nos dois pontos em que alguém falou com o cliente:

- `responderComoHumano` — um humano respondeu pela inbox. A limpeza vai no
  mesmo passo que grava a `WhatsappMessage`, **depois** do envio confirmado:
  limpar antes deixaria a conversa parecendo atendida se o envio falhasse.
- `processarMensagensPendentes` — no mesmo ponto em que as pendentes são
  marcadas, ou seja, quando a **primeira** resposta da IA foi confirmada
  enviada. Não depois de todas: a partir da primeira, alguém já falou com o
  cliente, e é isso que o campo significa.

A limpeza é incondicional (`update`, não `updateMany` condicional): não há
corrida a resolver aqui, porque limpar duas vezes tem o mesmo efeito de limpar
uma.

### 5.3 Quem recebe

Todos os `User` com `ativo: true`, via um único `createMany`. Se por algum
motivo não houver nenhum usuário ativo, não há o que criar e a função retorna
sem erro — um sistema sem usuários ativos tem um problema maior que este.

### 5.4 Onde o código mora

`src/modules/whatsapp/notificacoes.ts`, no módulo e não em `core`, pela regra
de fronteira: `src/core` não pode importar de `src/modules`, e esta lógica
conhece `Conversation`, que é conceito do módulo. O caminho inverso é
permitido, então o módulo usa `prisma` e os tipos de `core/notifications`
livremente.

O extrator de payload vai em `src/modules/whatsapp/notificacao-tipos.ts`,
**sem** `import "server-only"` — espelhando `core/notifications/types.ts`,
porque o sino é Client Component e precisa importá-lo.

## 6. Telas

**Sino (`notification-bell.tsx`)** — ganha um ramo para `"CONVERSA_AGUARDANDO"`
com link para `/conversas/[id]`. O componente já tem fallback para tipo
desconhecido, então o ramo novo é acréscimo, não mudança de estrutura.

**Lista `/conversas`** — mostra há quanto tempo cada conversa espera, e as que
esperam vêm primeiro. É esta parte, não a notificação, que resolve o caso de
todo mundo estar fora quando o sino toca.

A ordenação passa a ser: aguardando primeiro (mais antiga no topo, porque quem
espera há mais tempo é mais urgente), depois o resto por `atualizadoEm desc`
como hoje.

Concretamente, e este detalhe não pode ficar implícito porque erra em silêncio:

```ts
orderBy: [
  { aguardandoHumanoDesde: { sort: "asc", nulls: "last" } },
  { atualizadoEm: "desc" },
]
```

Sem `nulls: "last"` o Postgres ordena nulos **por último em `ASC`** por padrão,
o que por acaso é o que queremos — mas "por acaso" não é garantia que se
mantenha se alguém trocar para `desc` depois. Explícito é uma palavra a mais e
uma dúvida a menos.

## 7. Testes

Os que provam comportamento, não fiação:

- **Marca e notifica uma vez só.** Dois turnos seguidos sem resposta geram um
  conjunto de notificações, não dois.
- **Concorrência real.** Dois processos disputando a mesma transição — só um
  cria notificações. Contra o banco real, mesmo padrão dos testes de lease.
- **A IA respondendo não marca.** O caso que, se quebrar, enche o sino de
  conversas que estão sendo atendidas normalmente.
- **Resposta humana limpa**, e uma mensagem nova do cliente depois disso marca
  de novo (o ciclo fecha e reabre).
- **Notifica todos os ativos e nenhum inativo** — em especial o usuário de
  sistema do WhatsApp.
- **A lista ordena** as que aguardam à frente.

## 8. Limitação conhecida

**Resposta pelo celular do vendedor não limpa o estado.** O webhook descarta o
eco de mensagens que a própria instância enviou (`fromMe: true`), então se o
atendente responder fora do CRM, o sistema não fica sabendo e a conversa
continua marcada como aguardando.

Isso já é verdade hoje para a pausa da IA — não é regressão. Mas com um campo
visível e ordenado na lista, o sintoma sai da invisibilidade: em vez de nada
acontecer, uma conversa fica presa no topo. Vale saber antes de a equipe
reclamar.

Fechar exigiria ingerir os ecos `fromMe`, o que é mudança no gateway e tem
efeito colateral sobre o buffer de fragmentos — fatia própria, não esta.

## 9. Riscos

| Risco | Mitigação |
|---|---|
| Sino vira ruído | Um aviso por conversa, e só quando ninguém respondeu. Se ainda assim incomodar, o próximo passo é filtrar por papel, não reduzir o gatilho |
| Campo preso em conversa abandonada | Visível e ordenado na lista, então salta aos olhos em vez de apodrecer calado (§ 8) |
| `createMany` por usuário cresce com a equipe | Cinco vendedores é cinco linhas por conversa. Se algum fork chegar a dezenas, a correção é notificar por papel — não antecipar sem medida |
