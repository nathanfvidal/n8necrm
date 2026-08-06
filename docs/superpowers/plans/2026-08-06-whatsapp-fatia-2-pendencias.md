# Fatia 2 do WhatsApp — pendências deixadas para depois

Registro do que as revisões encontraram e **não** foi corrigido antes do merge,
com o critério de cada adiamento. Escrito no fim da Fatia 2 (branch
`feature/whatsapp-fatia-2`, 21 commits, revisão final aprovada).

Não é lista de desejos: cada item foi achado por uma revisão, julgado, e
adiado por um motivo. O motivo está junto para que a decisão possa ser
revista com a mesma informação que a produziu.

## Decisão de produto pendente

**Não fica registrado qual humano enviou cada mensagem.** `WhatsappMessage`
guarda `autor: "HUMANO"`, sem coluna de usuário. `Conversation.iaPausadaPorId`
registra quem pausou, mas só na primeira mensagem — `pausarIa` é no-op da
segunda em diante, de propósito, para não roubar a autoria de quem assumiu
primeiro.

Com dois vendedores na mesma conversa, o CRM atribui tudo ao primeiro e não há
vestígio do segundo. Para mensagem que sai em nome da empresa a um cliente
real, é pouco.

Mitigação aplicada nesta fatia: o balão de saída diz **"Equipe"**, não "Você" —
a tela deixou de afirmar algo falso, mas também não diz a verdade completa.

Fechar de verdade é uma coluna `enviadoPorId` em `WhatsappMessage` mais
migração. Três agentes independentes levantaram isto durante a execução.

## Limitações conhecidas (decisão, não defeito)

**O interruptor global tem atraso de até ~75 segundos.** `BotConfig.ativo` é
lido na entrada do turno; desligar o bot com um turno em voo ainda deixa aquela
resposta sair. Reconfirmar exigiria uma segunda consulta ao banco por turno.
Depois da revisão final, a tela de detalhe mostra o estado global, então quem
opera ao menos enxerga o que está acontecendo.

**Mensagens que chegam com o bot desligado nunca são respondidas ao religar.**
Ficam visíveis na inbox para um humano, mas religar não faz a IA voltar e
responder o que perdeu. Coerente com o teto de respostas por hora, que já
funciona assim.

## Corrigir na próxima fatia

| Item | Por que importa | Onde |
|---|---|---|
| Autoria da mensagem humana | ver acima | `WhatsappMessage` |
| `registrarAuditoria` na edição de persona | `AuditLog` já existe e é usado para mutações bem menos sensíveis; hoje só sobra `atualizadoPorId` da última edição, sem histórico | `agente-actions.ts` |
| Notificar conversa aguardando humano | quando a IA pausa ou bate o teto, ninguém é avisado; a conversa pode esperar horas. `Notification` já funciona (in-app + e-mail) | fatia própria |
| `findUniqueOrThrow` do `BotConfig` no caminho de mídia | um fork que rode migração sem seed passa a quebrar também em áudio, não só em texto. Fechar junto com um teste "fork sem seed" | `turno.ts` |
| `SessaoInvalidaError` exportada de `session.ts` | hoje a detecção de sessão inválida compara a **string** `"Não autenticado"` em dois arquivos. Reescrever a mensagem quebra a detecção em silêncio, e os testes também fixam a string. É o idioma do projeto inteiro, então a correção é de repositório, não desta fatia | `core/auth/session.ts` + os dois `actions.ts` |

## Pode esperar

- **`exigirModulo` nas Server Actions.** Num fork com o módulo desligado a rota
  dá 404, mas os endpoints continuam registrados. Risco baixo (exige ADMIN e o
  id de uma conversa que ninguém tem), e a correção não é uma linha:
  `exigirModulo` chama `notFound()`, que dentro do `try` viraria mensagem
  genérica — precisa de um `moduloAtivo()` devolvendo `ResultadoAcao`.
- **`paraResultadoErro` duplicado** entre `actions.ts` e `agente-actions.ts`.
  Consolidar antes de resolver a string acoplada só muda a duplicação de lugar.
- **Teste de componente para `ConversaEstadoIa`.** As quatro combinações de
  (bot ligado/desligado × conversa ativa/pausada) e o botão desabilitado não
  têm cobertura automatizada.
- **`limparConversasDeTeste` apaga por prefixo amplo** (`teste-`), mais largo
  que o de qualquer arquivo. Só é seguro porque `vitest.config.ts` fixa
  `fileParallelism: false` — a mesma corrida que a Task 8 teve de resolver no
  e2e, segurada por uma linha de config em outro arquivo, sem comentário
  ligando os dois.
- **`login()` duplicado em quatro specs e2e.** Não são quatro cópias
  equivalentes: `auth.spec.ts` tem o login como objeto do teste, os outros não.
  Extrair vale para dois deles.
- **Margem do rate limit de login.** A suíte e2e consome 8 das 10 tentativas de
  `admin@exemplo.com` por janela de 10 minutos. O próximo spec que logar como
  admin estoura. `globalSetup` zera antes de cada rodada, então hoje passa.
- **`claimLease` poderia devolver `iaAtiva`** no `RETURNING` que já faz,
  economizando uma consulta por turno. Deliberadamente adiado: mexer no lease
  sem necessidade é o pior negócio desta base — é o mecanismo que a Fatia 1
  pagou caro para acertar.
- **E2E acoplado ao interruptor global.** `whatsapp-agente.spec.ts` espera "IA
  respondendo" e clica "Pausar IA"; com `BotConfig.ativo = false` no banco de
  dev, os dois testes falham por motivo alheio. O cabeçalho diz "nunca toca
  `BotConfig`", verdade para escrita, mas agora há dependência de leitura não
  documentada.

## Armadilhas do ambiente de teste (não são defeitos do produto)

Descobertas durante esta fatia, custaram tempo real de diagnóstico:

- **`seed.test.ts` rotaciona a senha do admin** e só restaura no `afterAll`.
  Uma suíte **morta no meio** deixa o banco com a senha trocada, e a rodada
  seguinte falha em testes que não têm nada a ver com login. Não diagnosticar
  como regressão.
- **`seed-demo.test.ts` assume contagens absolutas.** Resíduo de execução
  anterior quebra. Cura: `npm run seed:demo:limpar`.
- **`beforeAll`/`afterAll` do Playwright rodam por worker, não por arquivo.**
  Com `fullyParallel` e limpeza por prefixo compartilhado, um grupo apaga o
  dado que o outro usa. Resolvido em `whatsapp-agente.spec.ts` com
  `mode: "serial"`; vale para qualquer spec futuro com o mesmo padrão.
- **`lead-to-won.spec.ts:278` é intermitente** (`toHaveClass` na coluna de
  destino do funil). Pré-existente, não relacionado a esta fatia.
- **Nunca rodar a suíte em paralelo com um agente trabalhando** — os dois
  competem pelo mesmo Postgres.

## Verificação que só um humano pode fazer

Nenhuma cabe em teste automatizado, e nenhuma é opcional antes de considerar a
fatia entregue a um cliente:

1. Enviar uma resposta humana de verdade por uma conversa real e confirmar que
   chega no WhatsApp do cliente.
2. Mandar outra mensagem do celular do cliente e confirmar que **nenhuma**
   resposta automática chega, e que a mensagem aparece na inbox.
3. Religar e confirmar que a IA volta a responder.
4. Editar a persona pela tela e confirmar, na resposta seguinte, que o bot
   mudou de comportamento **sem deploy** — é a promessa comercial inteira da
   fatia num teste só.
5. `DIRECT_URL` e a `DATABASE_URL` de transaction pooler nas variáveis de
   ambiente da Vercel. Sem elas, a migração desta fatia não roda no deploy.
