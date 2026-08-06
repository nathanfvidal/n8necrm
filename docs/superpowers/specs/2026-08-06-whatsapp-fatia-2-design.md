# WhatsApp Fatia 2 — Controle do agente pelo CRM

Data: 2026-08-06 · Depende de: Fatia 1 (mesclada em `main`, commit `4120a32`)

## 1. Objetivo

A Fatia 1 entregou o atendente funcionando: webhook da Evolution, ingestão
idempotente, buffer de fragmentos, turno com lease e resposta por LLM, e uma
inbox de leitura no painel. Falta o que o torna **entregável a um cliente**:
hoje, para mudar qualquer coisa no comportamento do bot, é preciso editar
`config/bot.ts` e fazer deploy, e não existe nenhuma forma de um humano
assumir a conversa.

Esta fatia entrega três controles, todos pelo CRM:

1. Pausar e religar a IA por conversa.
2. Editar a personalidade e as regras do agente, mais um bloco de FAQ.
3. Responder ao cliente pela inbox.

## 2. Escopo

**Dentro:** pausa por conversa (automática ao responder + botão), interruptor
global, editor de persona/regras/FAQ com prévia do prompt, restauração ao
padrão do fork, envio de texto pela inbox, distinção visual entre mensagem de
IA e de humano.

**Fora, de propósito:** catálogo estruturado de veículos com consulta por
ferramenta (Fatia 3 — depende do módulo `catalog` da Fase 2, que não existe);
resposta com mídia (só texto); respostas prontas/templates; e notificação de
conversa aguardando humano (ver § 9).

## 3. Decisões e por quê

### 3.1 A pausa segue o precedente do n8n que já roda em produção

Os fluxos em `Bots/` resolvem isto há tempo, e o mecanismo foi lido antes de
desenhar:

- `01_-_ENTRADA_E_SAIDA...json` tem o nó `roteiaParaIaOuHumano`, que checa
  `chats.ai_service` e só deixa a IA responder quando o valor **não** começa
  com `pause`.
- O mesmo fluxo tem `pausaAtendimentoIA`, que grava `ai_service = "pause"`
  quando um humano escreve na conversa.
- `03_-_ENCAMINHAMENTO_PARA_HUMANO...json` grava a mesma pausa ao transferir.
- A reativação é manual: o nó `avaliaMensagemHumano` procura um `✅` enviado
  pelo atendente.

Adotamos a mesma semântica — **responder pausa, religar é explícito** — com
duas diferenças: booleano em vez de string (o campo lá é string porque
carrega outros valores; aqui não precisa), e um botão de verdade em vez do
emoji, já que a resposta humana passa pelo CRM e não pelo celular do
atendente.

Descartado: religar por tempo. Evitaria conversa esquecida com o bot mudo,
mas arrisca a IA voltar a falar horas depois de um acerto feito por humano e
contradizê-lo. O custo do silêncio é menor que o da contradição.

### 3.2 `config/bot.ts` semeia o banco; o banco manda

Mesmo padrão que a Task 9 já usa para `PipelineStage` a partir de
`config/client.ts`: o arquivo do fork é o conteúdo inicial, o seed grava uma
vez, e em runtime a verdade é o banco.

Isso preserva as duas propriedades que importam no modelo de agência: um fork
novo nasce com o bot funcionando (sem tela em branco esperando alguém
digitar), e o arquivo continua versionado documentando as regras-base.

Precisando ser exato sobre quem lê o quê: `config/bot.ts` é lido em **dois**
momentos — pelo seed, e pela ação "voltar ao padrão do fork" (§ 6), que é um
comando explícito de quem está na tela. Nunca no caminho de resposta ao
cliente. É essa a garantia que importa: nenhum turno consulta o arquivo, e
por isso não existe janela em que o bot responda com uma persona diferente da
que a tela mostra.

Descartado: config como padrão e banco como *override*, com merge em runtime.
Daria um "voltar ao padrão" de graça, mas cria duas fontes de verdade — e a
pergunta "de onde veio essa regra?" passaria a ter duas respostas.

### 3.3 Só o ADMIN configura o agente

Decisão do Rodrigo: quem edita a personalidade é a agência, não o cliente.
Consequência direta — a tela não precisa de campos guiados defensivos, nem
histórico de versões, nem aprovação. Um botão de "voltar ao padrão do fork" é
rede de segurança suficiente.

Responder e pausar/religar ficam abertos a todos os papéis, inclusive
VENDEDOR: são eles que falam com o cliente, e o projeto já decidiu antes que
todos veem todos os leads.

## 4. Modelo de dados

### 4.1 `Conversation` ganha o estado da IA

| Campo | Tipo | Nota |
|---|---|---|
| `iaAtiva` | `Boolean @default(true)` | Equivalente ao `ai_service != "pause"` do n8n |
| `iaPausadaEm` | `DateTime?` | Para a tela dizer *quando* |
| `iaPausadaPorId` | `String?` → `User` | Para a tela dizer *quem* |

`iaPausadaEm`/`iaPausadaPorId` não são enfeite: sem eles, uma conversa muda é
indistinguível de um bug, e a primeira reação de quem vê é reabrir o código.

### 4.2 `BotConfig` — tabela de linha única

| Campo | Tipo |
|---|---|
| `id` | `String @id @default("bot-config")` — sempre este valor |
| `ativo` | `Boolean @default(true)` — interruptor global |
| `personaNome` | `String` |
| `personaPapel` | `String` |
| `regras` | `String[]` |
| `faq` | `String @default("")` |
| `atualizadoEm` | `DateTime @updatedAt` |
| `atualizadoPorId` | `String?` → `User` |

**Linha única imposta pelo banco, não por convenção:** `id` tem o valor fixo
`"bot-config"` como default, então todo `create` sem id explícito colide na
chave primária — a segunda linha é impossível por construção, e nenhum código
precisa perguntar "qual das linhas é a certa". É o mesmo idioma de id estável
e legível que `prisma/seed.ts` já usa para o usuário de sistema do WhatsApp.
A leitura em runtime é `findUniqueOrThrow({ where: { id: "bot-config" } })`:
se o seed não rodou, falha alto em vez de responder ao cliente com uma
persona vazia.

O interruptor global mora aqui porque quando o bot faz besteira é preciso um
botão, não desligar conversa por conversa.

## 5. Comportamento

### 5.1 Montagem do prompt

`montarPromptSistema()` hoje é síncrona, sem argumentos, e determinística de
propósito — o comentário no arquivo registra o motivo: provedores de LLM
cacheiam o prefixo do prompt quando ele é byte-a-byte idêntico, e qualquer
valor variável ali em cima invalida esse cache a cada chamada.

Ela passa a **receber a config como argumento**. Continua determinística
(mesma config, mesmos bytes) e continua trivial de testar. Quem lê o banco é
o `turno.ts`, uma vez por turno.

Explicitamente **não** vamos fazer a função ir ao banco sozinha: viraria uma
consulta escondida dentro de algo que todo mundo trata como função pura.

### 5.2 Onde a IA é barrada

A guarda fica no `turno.ts`, **não** no webhook. A mensagem do cliente
continua sendo ingerida e aparece na inbox mesmo com a IA pausada — o que
muda é só a IA não responder.

Barrar no webhook faria a mensagem sumir, que é o pior comportamento possível
numa conversa sob atendimento humano.

São duas condições, checadas juntas: `BotConfig.ativo` e
`Conversation.iaAtiva`. Quando qualquer uma é falsa, as mensagens pendentes
são marcadas como processadas **sem resposta** — o mesmo tratamento que o teto
de respostas por hora já dá hoje ("persiste mas para de responder", nunca
"descarta calado").

### 5.3 Turno em voo

`processarMensagensPendentes` já reconfirma a titularidade do lease depois da
chamada ao modelo e antes de enviar — mecanismo criado no fix C1, quando o
revisor provou que uma chamada lenta podia gerar resposta duplicada.

Essa checagem passa a conferir `iaAtiva` junto, na mesma consulta. Se um
humano respondeu enquanto a IA pensava, a resposta gerada é descartada e o
cliente recebe só a do humano.

Custa uma coluna a mais numa consulta que já acontece, e reaproveita um ponto
de corte que já existe e já é testado.

### 5.4 Ordem das operações no envio humano

O envio é externo e não participa de transação. A ordem é:

1. **Pausa** a IA (transação própria).
2. **Envia** pelo gateway.
3. **Grava** a `WhatsappMessage` (`SAIDA`, autor `HUMANO`).

Parece contraintuitivo gravar por último. É o único arranjo em que toda falha
erra para o lado seguro:

| Falha | Resultado |
|---|---|
| Envio falha | Bot pausado, nada enviado. O humano vê o erro e repete — e a IA não aproveita a brecha |
| Gravação falha | Cliente recebeu, bot pausado, inbox sem a linha. Chato, mas ninguém fala por cima de ninguém |
| *(se gravasse primeiro)* envio falha | Inbox mostrando mensagem que o cliente nunca recebeu — o pior dos três |

Nenhum caminho deixa a IA respondendo em cima de um humano.

## 6. Telas

**Inbox `/conversas/[id]`** — hoje só leitura. Ganha campo de resposta com
botão enviar, indicador do estado da IA com botão de religar (mostrando quem
pausou e quando), e mensagens `HUMANO` visualmente distintas das `IA`.

**`/conversas/agente`** — tela nova, alcançável por link no cabeçalho da
inbox. Não vira item de menu: o painel já tem sete entradas e esta é uma tela
de uso raro.

Contém os campos da persona, a lista de regras, o bloco de FAQ, o interruptor
global, e duas coisas que valem mais que os campos:

- **Prévia do prompt montado.** Editar algo cujo efeito é invisível é como
  programar sem compilar. Como `montarPromptSistema` é pura e determinística,
  renderizar o texto final custa quase nada e transforma "acho que ficou bom"
  em "é isto que o modelo vai ler".
- **Voltar ao padrão do fork**, restaurando a partir de `config/bot.ts`.

## 7. Permissões

Uma ação nova na matriz de `src/core/auth/permissions.ts`:

| Ação | ADMIN | GESTOR | VENDEDOR |
|---|---|---|---|
| `configurar_agente` | ✅ | ❌ | ❌ |
| responder / pausar / religar | ✅ | ✅ | ✅ |

Responder e pausar não ganham ação própria na matriz: exigem apenas sessão
válida, como as demais operações de atendimento.

## 8. Testes

Os que provam o comportamento, não a fiação:

- **Turno abortado ao pausar no meio** — contra o banco real, mesmo padrão dos
  testes de lease da Fatia 1 (sem mock de relógio): pausa entre a geração e o
  envio, e o gateway não é chamado.
- **Envio humano pausa na ordem certa** — falha simulada no gateway deixa a
  conversa pausada e sem mensagem gravada.
- **Seed não sobrescreve config editada** — roda duas vezes, a segunda preserva
  o que foi editado pelo CRM.
- **Prompt montado a partir do banco**, não do `config/bot.ts`.
- **Interruptor global** cala todas as conversas, inclusive as com `iaAtiva`.
- **E2E curto**: pausa → cliente manda mensagem → bot fica mudo e a mensagem
  aparece na inbox → humano responde → religa.

## 9. Lacuna conhecida que esta fatia não fecha

Quando a IA pausa (ou bate o teto de respostas por hora), as mensagens do
cliente ficam na inbox e **ninguém é avisado**. Uma conversa pode esperar
horas sem que nenhum vendedor saiba.

O CRM já tem `Notification` funcionando (in-app e e-mail via Resend, Task 19),
então isto é encaixável depois sem retrabalho de modelo. Fica de fora agora
para a fatia não inchar — mas é o primeiro candidato à fatia seguinte, à
frente do catálogo.

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Persona editada errada quebra o atendimento sem aviso | Prévia do prompt na tela + botão de voltar ao padrão do fork |
| Conversa pausada e esquecida | Estado visível na lista da inbox, não só no detalhe (§ 9 fecha de vez) |
| Config lida do banco a cada turno vira consulta quente | Uma leitura por turno, tabela de uma linha; se pesar, cache em memória do processo é a próxima mudança — não antecipar sem medida |
