# Ciclo 2a — Cofre de credenciais e conexões da Evolution

Data: 2026-08-20
Status: aguardando revisão
Spec do programa: `2026-08-19-n8necrm-fundacao-design.md`
Ciclos anteriores: `2026-08-19-ciclo-1a-tenancy-design.md` ·
`2026-08-20-ciclo-1b-jwt-isolamento-design.md` ·
`2026-08-20-ciclo-1c-config-no-banco-design.md`
Auditorias que este ciclo herda: `docs/auditorias/2026-08-19-ciclo-1a-tenancy.md` ·
`docs/auditorias/2026-08-20-ciclo-1c-config-no-banco.md`
Ponto de partida: branch `ciclo-1a-tenancy`, HEAD `8912941`, árvore limpa

---

## 1. O que este ciclo entrega

Três coisas, e elas só fazem sentido juntas:

1. **Um cofre** (`src/core/cofre/`) que cifra um segredo em repouso com AEAD e
   chave mestra vinda do ambiente. Ele não sabe o que é WhatsApp, o que é
   Evolution nem o que é uma empresa — recebe texto e um rótulo de propósito e
   devolve um blob autenticado.
2. **Uma tabela de conexões por empresa** (`WhatsappConnection`) que guarda o
   segredo cifrado, os campos não secretos tipados em colunas próprias, e o
   **hash** do token do webhook.
3. **Uma aba de administração em Configurações** (`/configuracoes/conexoes`),
   ADMIN apenas, onde a credencial é cadastrada e substituída — nunca lida.

Com os três no lugar, **as quatro variáveis `EVOLUTION_*` morrem**, incluindo
a ponte `EVOLUTION_COMPANY_ID` que o Ciclo 1a criou nomeadamente para este
ciclo remover (⚠️ R5 da auditoria do Ciclo 1a).

**Decisão do dono, travada em 2026-08-20:** as credenciais de API são
configuradas numa aba de administração em Configurações, não em variável de
ambiente. Este ciclo é isso.

**Fora do escopo, e a §7 diz por quê:** QR Code, status de pareamento ao vivo,
Meta Cloud API (Ciclo 2b).

---

## 2. O que foi medido antes de desenhar

Nenhuma decisão da §4 é lembrança. Cada uma se apoia numa linha desta tabela.

| # | Medida | Valor | Comando / fonte |
| --- | --- | --- | --- |
| M1 | Criptografia simétrica existente em `src/` | **zero** ocorrências | `grep -rn "createCipheriv\|createDecipheriv\|webcrypto\|subtle\." src/` → 0 linhas |
| M2 | Telas de configuração existentes | **nenhuma**. `src/app/(painel)/` tem `contatos, conversas, etapas, export, fluxos, leads, tasks, usuarios` e mais nada | `ls "src/app/(painel)/"` |
| M3 | Onde `EVOLUTION_DOMAIN/INSTANCE/APIKEY` são lidas | um lugar só: `src/modules/whatsapp/gateway/index.ts:29-31`, com Zod e construção preguiçosa | `grep -rn "EVOLUTION_" src/` |
| M4 | Onde `EVOLUTION_COMPANY_ID` é lida | um lugar só: `src/modules/whatsapp/ingest.ts:58` | mesmo grep |
| M5 | Quem consome o gateway | 4 pontos: a rota do webhook (`verificarOrigem`, `normalizarEventos`), `turno.ts:370` e `agente.ts:254` (`enviarTexto`) | `grep -rn "whatsappGateway" src/` |
| M6 | `companyId` já está em mãos nos dois pontos de ENVIO | `turno.ts` recebe `companyId` do job da fila; `responderComoHumano` (`agente.ts`) recebe `companyId` como 1º parâmetro | `src/modules/whatsapp/turno.ts`, `src/modules/whatsapp/agente.ts:225` |
| M7 | O consumidor da fila roda **sem sessão** e **com** `companyId` | `turnoJobSchema` exige `companyId: z.string().min(1)`, obrigatório desde o Ciclo 1d | `src/app/api/queues/whatsapp-turn/route.ts:66` |
| M8 | O webhook roda **sem sessão** e **sem** `companyId` | a rota só tem o token do path e o corpo; o payload da Evolution traz `instance`, nunca empresa | `src/app/api/whatsapp/evolution/[token]/route.ts`; `gateway/evolution.ts:52-58` |
| M9 | Modelos de tenant hoje | **12** | `src/core/tenancy/escopo.ts`, `MODELOS_DE_TENANT` |
| M10 | Modelos de tenant com `companyId` único | **2** (`BotConfig`, `CompanyConfig`) | `tests/unit/escopo-empresa.test.ts`, caso "são os ÚNICOS modelos de tenant onde companyId é único" |
| M11 | Relações inversas de `User` | **9** | `prisma/schema.prisma:89-97`; contado na prosa de `escopo.ts`, seção "Leitura ANINHADA" |
| M12 | Exceções do lint ao prisma cru | **5 permanentes, 0 temporárias** | `eslint.config.mjs:428`; catraca em `tests/unit/catraca-prisma-cru.test.ts` (`LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS = 0`) |
| M13 | Precedente de auditoria sem `antes`/`depois` | `redefinirSenha` (`src/core/users/service.ts:501-507`) audita `acao/entidade/entidadeId` e nada mais | leitura do fonte |
| M14 | O que `sentry-scrub.ts` remove hoje | hash bcrypt, e-mail, telefone brasileiro. **Nada de chave nem de blob cifrado** | `src/lib/sentry-scrub.ts:37-51` |
| M15 | AEADs disponíveis no runtime | `aes-256-gcm` **e** `chacha20-poly1305`, os dois presentes | `node -e "require('node:crypto').getCiphers()"` em Node **v22.21.0**, 2026-08-20 |
| M16 | Precedente de valor de enum declarado antes de existir código | `WhatsappAutor.HUMANO` — *"o valor já existe no enum agora para não exigir uma migração de enum quando essa fatia chegar"* | `prisma/schema.prisma:27-35` |
| M17 | Precedente de configuração preguiçosa e por que ela existe | `gateway/index.ts:53-97` — validar no escopo do módulo derrubou o build inteiro na Vercel por três dias | o próprio JSDoc, e `tests/unit/whatsapp-config-preguicosa.test.ts` |
| M18 | `Conversation.waId` é `@unique` **GLOBAL** | sim, e é ⚠️ R2 do Ciclo 1a | `prisma/schema.prisma:420` |
| M19 | Ícones disponíveis na navegação | união fechada `IconeDoPainel`, mapeada para `LucideIcon` em `nav-links.tsx`; **não há** entrada de configurações | `src/components/nav-links.tsx:26-36` |

---

## 3. O problema que este ciclo existe para resolver

`EVOLUTION_APIKEY` é uma credencial **por empresa** morando numa variável de
ambiente **por deploy**. Enquanto houver uma empresa só, isso funciona e
esconde três defeitos:

1. **A segunda empresa não cabe.** Não há onde pôr a segunda apikey.
2. **`EVOLUTION_COMPANY_ID` é uma segunda fonte de verdade sobre a conversa**
   (⚠️ R5). O webhook não deduz a empresa — ele a lê de uma constante do
   deploy. Duas instâncias apontando para o mesmo deploy escreveriam as duas
   na mesma empresa, sem erro nenhum.
3. **Trocar a apikey é um redeploy.** O dono precisa de um engenheiro para
   girar uma credencial.

O ciclo não conserta isso movendo a variável de lugar. Ele constrói o lugar
onde a credencial de qualquer canal cabe, com as três defesas que uma
credencial em banco exige (cifra, não-leitura, não-vazamento) e a resolução de
empresa que o webhook precisa.

---

## 4. Decisões travadas pelo dono — registradas com o motivo, não reabertas

### 4.1 Segredo cifrado em repouso

O Prisma conecta como **dono da tabela** e ignora RLS — `CLAUDE.md` registra
isso e a migração `20260730212500_enable_rls_and_revoke_anon_grants` diz por
escrito que `FORCE ROW LEVEL SECURITY` **não** está ligada, de propósito. Três
caminhos entregam a coluna em texto puro a quem não deveria vê-la:

| Caminho | RLS ajuda? | Cifra ajuda? |
| --- | --- | --- |
| `pg_dump` / backup automático do Supabase | não | **sim** |
| Vazamento da `SUPABASE_SERVICE_ROLE_KEY` | não (a chave bypassa) | **sim** |
| Qualquer consulta pelo caminho do Prisma | não (dono da tabela) | **sim** |

A cifra é a **única** defesa que sobrevive aos três, e é por isso que ela
existe aqui e não existe em nenhuma outra coluna deste banco.

A chave mestra vem do **ambiente** — é a única peça que continua fora do
banco, e é o que faz o dump valer nada sozinho. O que acontece quando ela
falta ou muda está em §5.4.

### 4.2 O segredo NUNCA volta para o navegador

Nem mascarado a partir do valor real no cliente. A máscara é montada **no
servidor**, e no desenho deste ciclo ela nem sequer exige decifrar: os últimos
4 caracteres são gravados numa coluna própria, em texto puro, no momento em
que o segredo entra (§5.3). A tela mostra o bastante para reconhecer e oferece
**substituir**, nunca ler.

**A exceção nomeada, e ela não é uma brecha:** o token do webhook é gerado
**pelo servidor** e precisa ser colado no painel da Evolution por um humano.
Ele é devolvido **uma vez**, na resposta da ação que o criou, e nunca mais —
o banco guarda só o `sha256` dele (§5.5). A regra que fica escrita, e que tem
caso de teste, é: **o cofre nunca decifra para o navegador; um segredo que o
servidor acabou de gerar pode ser entregue uma vez, na resposta que o criou.**
Esse caminho não decifra nada.

### 4.3 O segredo NUNCA entra em `AuditLog`

Toda ação sobre conexão é auditada — quem, quando, qual conexão — **sem
`antes` e sem `depois`**. O precedente é literal: `redefinirSenha` (M13).

E há uma segunda razão, mecânica: a varredura de escopo recusa `companyId`
dentro de coluna `Json`, e `AuditLog.antes`/`depois` são exatamente as colunas
que a seção "Falsos positivos conhecidos" de `escopo.ts` nomeia. Um
instantâneo de conexão carregaria `companyId` e seria recusado pelo próprio
escopo. Não usar as duas colunas resolve o problema de segurança e o mecânico
com a mesma decisão.

**A regra é para TODAS as ações de conexão, não só as que tocam o segredo** —
inclusive `criar` e `editar`, que só mexem em campo não secreto. O motivo é
deriva: um `depois` legítimo hoje é um `{ ...conexao }` amanhã, e aí o blob
cifrado entra junto. A regra que ninguém erra é a que não tem exceção. §8
lista o caso de teste que a exercita para cada ação.

### 4.4 O segredo NUNCA chega ao Sentry

`src/lib/sentry-scrub.ts` hoje remove hash bcrypt, e-mail e telefone (M14).
Este ciclo acrescenta dois padrões e uma redação no adaptador:

1. **Blob cifrado do cofre** — o formato `v1.<8 hex>.<b64url>.<b64url>.<b64url>`
   vira `[segredo cifrado]`.
2. **Chave mestra em base64** — um bloco isolado de exatamente 43 caracteres
   base64 (32 bytes) com padding opcional vira `[chave]`. É agressivo de
   propósito, seguindo o critério que o próprio arquivo já registra
   (*"redigir agressivamente e aceitar falso positivo"*); a fronteira de
   43 caracteres exatos é o que impede um sha256 de 64 hex de casar.
3. **A apikey ecoada pela Evolution** — `EvolutionGateway.enviarTexto` põe o
   corpo da resposta de erro na mensagem (`evolution.ts:325-328`). O adaptador
   **conhece a própria apikey** e passa a substituí-la por `[apikey]` antes de
   montar a mensagem. Isso é exato, não heurístico, e é a defesa certa para um
   segredo cujo FORMATO não dá para reconhecer por expressão regular.

Os três têm caso de teste (§8, P9-P11).

### 4.5 Uma permissão nova, de ADMIN: `gerenciar_conexoes`

**Nome:** segue a convenção `verbo_substantivo` da matriz (`gerenciar_usuarios`,
`gerenciar_funil`, `gerenciar_fluxos`).

**Por que não reaproveita nenhuma existente:**

- **`gerenciar_fluxos`** é sobre a instância n8n. Fundir daria a quem religa um
  workflow o poder de **substituir a credencial do WhatsApp** — e o inverso.
  São dois sistemas externos diferentes, com donos operacionais diferentes.
- **`configurar_agente`** é o *conteúdo* do bot (persona, regras, FAQ). Quem
  ajusta o tom de voz não precisa poder trocar o número de onde a empresa
  responde. E `configurar_agente` vive atrás do portão do módulo `whatsapp`,
  numa tela dentro de `/conversas`; esta vive em Configurações.
- **`gerenciar_usuarios`** é sobre pessoas.

**Por que UMA permissão e não o par `ver_conexoes`/`gerenciar_conexoes`:** a
matriz registra, no comentário de `ver_fluxos`, que separar sem motivo cria
"uma permissão órfã de um lado e uma tela morta do outro". Aqui o argumento é
mais forte ainda: **não há nada nesta tela para ver**. O segredo não renderiza
(4.2), e o que sobra — nome, domínio, instância, data da última troca — só
interessa a quem pode mudar. `ver_fluxos` existe porque há uma pergunta
("isso ainda quebra?") que um leitor responde sem escrever nada; aqui não há
pergunta equivalente.

`ADMIN` apenas. Não vai para `GESTOR` pelo mesmo argumento de
`gerenciar_fluxos`: o erro derruba o atendimento da empresa inteira.

### 4.6 Credencial é por empresa, lida por `prismaDaEmpresa`

Sem exceção, e sem uma única consulta global. §5.5 mostra como o webhook —
que chega sem sessão — consegue isso **sem** `prisma.company.findFirst()` e
**sem** exceção nova no lint.

---

## 5. Decisões deste spec

### 5.1 O algoritmo, o formato e a rotação de chave

**Algoritmo: `aes-256-gcm`, de `node:crypto`. Sem dependência nova.**

- **Por que um AEAD e não `aes-256-cbc` + HMAC:** o segredo fica numa coluna
  que o Prisma escreve e lê como texto. Quem tem `service_role` pode
  **trocar** o blob de uma linha pelo de outra. Cifra sem autenticação aceita
  a troca em silêncio; um AEAD recusa. Autenticar não é luxo aqui, é a defesa
  contra o mesmo atacante que a cifra assume.
- **Por que GCM e não `chacha20-poly1305`,** já que os dois existem no runtime
  (M15): AES-GCM tem aceleração de hardware (AES-NI) no host, é o AEAD que
  mais gente sabe revisar, e o nosso volume de cifragem é ridículo (uma
  escrita por troca de credencial). ChaCha ganharia num runtime sem AES-NI —
  não é o caso, e trocar é mudar uma constante graças ao versionamento do
  formato abaixo.
- **Nonce de 96 bits, aleatório, um por cifragem.** O limite de aniversário
  para nonce aleatório de 96 bits fica na casa de 2^32 cifragens **com a
  mesma chave**; este sistema cifra na ordem de dezenas por ano. A margem não
  é apertada, é absurda — e vale registrar o número em vez de dizer "é
  seguro".
- **`node:crypto`, não dependência nova.** Uma biblioteca de cofre traria
  superfície de supply-chain para exatamente as ~40 linhas que `createCipheriv`
  já resolve. Se algum dia for preciso KMS/HSM, o ponto de troca é o carregador
  de chave (`chave.ts`), não o formato.

**Formato, uma string só, coluna `TEXT`:**

```
v1.<keyId>.<iv>.<ciphertext>.<tag>
```

- `v1` — versão do FORMATO. É o que permite trocar algoritmo depois sem
  reescrever nada: um `v2` decifra `v2`, delega `v1` ao decifrador antigo, e
  os blobs antigos continuam legíveis.
- `keyId` — 8 primeiros caracteres hex de `sha256(chave crua de 32 bytes)`.
  Derivado da chave, **nunca digitado**: um id digitado pode ser repetido ou
  errado. Expor 32 bits do sha256 da chave não é caminho para a chave.
- `iv`, `ciphertext`, `tag` — base64url **sem padding**, para que o separador
  `.` nunca apareça dentro de um campo.

**AAD (dado autenticado, não cifrado):** a string
`v1|<keyId>|<companyId>|<proposito>`, onde `proposito` é um rótulo constante
(`"whatsapp-connection:apiKey"`). Efeito, e cada um tem caso de teste:

- mover o blob da empresa A para a linha da empresa B **falha na tag**;
- mover o blob de uma coluna para outra **falha na tag**;
- editar o cabeçalho (`v1`, `keyId`) **falha na tag**.

O que a AAD **não** cobre, e está dito para não virar promessa falsa: trocar o
blob entre **duas conexões da MESMA empresa, do mesmo propósito**. Isso passa.
Quem tem `service_role` e quer isso já pode reescrever a linha inteira; cobrir
esse caso exigiria pôr o `id` da linha na AAD, e o `id` não existe antes de o
Prisma criar a linha. Registrado, não escondido.

**Rotação — uma variável, uma regra:**

```
COFRE_CHAVE_MESTRA="<base64 de 32 bytes>[,<chave anterior>,...]"
```

A **primeira** chave da lista cifra. **Qualquer** chave da lista decifra, e a
escolha é pelo `keyId` do próprio blob. Rotacionar é **acrescentar a nova na
frente** — nada é reescrito, e os blobs antigos continuam abrindo. Quando
todos os blobs tiverem migrado (por uma substituição normal pela tela), a
chave antiga sai da lista.

**Sem memoização, sem estado de módulo.** O carregador lê `process.env` a cada
chamada. Custo: dois `Buffer.from(base64)` e um `sha256` de 32 bytes por
operação — irrelevante ao lado de uma ida ao banco. Ganhos: rotação vale sem
reiniciar processo, e o módulo não tem binding mutável para envenenar entre
testes.

### 5.2 O que acontece com as variáveis `EVOLUTION_*` — elas MORREM

As quatro. `EVOLUTION_DOMAIN`, `EVOLUTION_INSTANCE`, `EVOLUTION_APIKEY` e
`EVOLUTION_COMPANY_ID` saem de `src/`, do `.env.example` e da documentação.

**Não** viram "padrão de arquivo sobreposto pelo banco", como
`config/client.ts` no Ciclo 1c. O padrão do 1c é certo para **marca** e errado
para **credencial**, e a diferença é o custo do padrão errado:

| | Marca (Ciclo 1c) | Credencial (aqui) |
| --- | --- | --- |
| Padrão aplicado à empresa errada | painel abre com a cor genérica | a empresa B responde clientes **pelo número da empresa A**, e as respostas dela vão para a instância da A |
| Como se percebe | na hora, visualmente | não se percebe |

Um padrão de credencial por deploy é literalmente `Company.findFirst()` com
outro nome — o vazamento silencioso que `EVOLUTION_COMPANY_ID` foi criada
para **evitar** (`ingest.ts:31-46`). Substituí-la por um fallback global seria
reintroduzir o defeito que ela nomeava.

**Empresa sem conexão ativa = WhatsApp desligado para ela**, com erro nomeado
(`ConexaoNaoConfiguradaError`), nunca com fallback.

**A migração do deploy atual** não é script: o dono abre
`/configuracoes/conexoes`, cadastra a conexão com os valores que já tem no
painel da Evolution, e cola no painel da Evolution a URL de webhook que a tela
devolve. Um script de importação foi considerado e recusado — ele leria as
mesmas variáveis que o ciclo está matando, viraria peso morto depois de uma
execução, e não exercita a tela que precisa funcionar de qualquer forma.

**A construção preguiçosa continua**, e agora é obrigatória por dois motivos
em vez de um: além do que M17 registra (`next build` avalia módulos alcançáveis
e derrubou o deploy por três dias), a leitura da credencial passou a tocar o
**banco** — e nenhum módulo pode consultar Postgres ao ser importado.

### 5.3 O modelo no Prisma

```prisma
enum CanalConexao {
  EVOLUTION
  META_CLOUD
}

model WhatsappConnection {
  id        String       @id @default(cuid())
  companyId String
  company   Company      @relation(fields: [companyId], references: [id])
  canal     CanalConexao
  nome      String
  ativa     Boolean      @default(true)

  // Evolution. Nulos para outros canais — colunas TIPADAS, nunca `Json`.
  dominio   String?
  instancia String?

  segredoCifrado         String
  segredoUltimos4        String
  segredoAtualizadoEm    DateTime
  segredoAtualizadoPorId String?
  segredoAtualizadoPor   User?  @relation("SegredosDeConexao", fields: [segredoAtualizadoPorId], references: [id])

  webhookTokenHash String @unique

  criadoEm     DateTime @default(now())
  atualizadoEm DateTime @updatedAt

  conversas Conversation[]

  @@unique([companyId, canal, instancia])
  @@index([companyId])
}
```

E em `Conversation`, duas linhas novas:

```prisma
  connectionId String?
  connection   WhatsappConnection? @relation(fields: [connectionId], references: [id])
  @@index([connectionId])
```

**Colunas tipadas, nunca `Json`.** A varredura do Ciclo 1d recusa `companyId`
dentro de `Json` (`escopo.ts`, "Falsos positivos conhecidos"), e um `Json` de
configuração é onde `companyId` acaba parando. Campo de canal que não se
aplica é coluna **nula**, e é o mesmo padrão que `CompanyConfig` já usa.

**Mais de uma conexão por empresa: sim** — é a decisão travada nº 4 do
programa (multi-instância). `@@unique([companyId, canal, instancia])` impede a
mesma instância cadastrada duas vezes na mesma empresa. `instancia` nula não
colide com nada, porque o Postgres trata NULL como distinto — o que é o
comportamento desejado para canais que não têm instância.

**`Conversation.connectionId` existe porque multi-instância sem ele é
mentira.** Com duas conexões na mesma empresa, "por qual das duas eu
respondo?" não tem resposta sem esta coluna — e o erro seria responder o
cliente **pelo número errado da mesma empresa**. Ela é preenchida na ingestão,
onde a conexão já foi resolvida (§5.5). É **nula** para conversas anteriores a
este ciclo; o envio trata a nula caindo na única conexão ativa da empresa e
**recusa, com erro nomeado, se houver mais de uma** — falha alta, nunca
chute.

**`webhookTokenHash` é `@unique` GLOBAL, e isso é diferente de `Conversation.waId`.**
`waId` é global-único sobre um identificador **compartilhável** (o mesmo
número pode ser atendido por duas empresas) — por isso é ⚠️ R2 e por isso é
defeito. Um token de webhook é um **segredo de 256 bits**: duas empresas com o
mesmo token é um estado que **deve** ser impossível, e colisão aleatória não
acontece. A unicidade global aqui afirma exatamente a propriedade certa.

**Este ciclo NÃO mexe em `Conversation.waId`** (M18). Vale dizer o que muda:
até hoje, `EVOLUTION_COMPANY_ID` tornava a segunda empresa **inalcançável**, e
o defeito era teórico. Depois deste ciclo duas empresas podem ter conexões, e
o mesmo número atendido pelas duas colide em `P2002` → 500 → a Evolution
reentrega para sempre. É a mesma dívida, agora **alcançável**. Fica declarada
em §11 (D4), com o sintoma escrito, para que quem topar com ela não gaste um
dia diagnosticando.

**Contagens que este ciclo move, e cada uma tem trava:**

- `MODELOS_DE_TENANT`: **12 → 13** (`WhatsappConnection`). A trava de deriva de
  `tests/unit/escopo-empresa.test.ts` exige igualdade exata.
- Relações inversas de `User`: **9 → 10** (`segredosDeConexao`). O número está
  escrito na prosa de `escopo.ts` ("NOVE relações inversas") e ele **conta as
  portas de saída do tenant** — o próprio arquivo diz que ele "envelhece a
  cada relação nova".
- Modelos de tenant com `companyId` único: **continua 2**. A `@@unique`
  composta de `WhatsappConnection` não torna `companyId` sozinho único, então
  `findUnique` continua recusado ali pelo escopo, como em qualquer outro
  modelo de tenant.

### 5.4 O que acontece quando a chave mestra falta, muda ou não bate

Cinco erros nomeados, todos descendo de `CofreError`, e **nenhum deles carrega
texto claro nem material de chave** — isso é caso de teste, não promessa.

| Situação | Erro | Efeito na tela | Efeito no webhook |
| --- | --- | --- | --- |
| `COFRE_CHAVE_MESTRA` ausente ou vazia | `CofreSemChaveError` | a aba recusa salvar e diz que o cofre não está configurado | 500 → a Evolution reentrega |
| Entrada da lista que não é 32 bytes de base64, ou dois `keyId` iguais | `CofreChaveInvalidaError` | idem | idem |
| Blob nomeia um `keyId` que não está mais na lista | `CofreChaveDesconhecidaError` (a mensagem cita o `keyId`) | idem | idem |
| String fora do formato `v1.a.b.c.d` | `CofreFormatoInvalidoError` | idem | idem |
| Tag GCM não confere (blob adulterado, AAD errada) | `CofreDecifragemError` | idem | idem |

**A chave sumiu para sempre: e agora?** Não há recuperação, e é essa a
propriedade que a cifra compra. A mensagem de `CofreChaveDesconhecidaError`
diz as duas saídas em voz alta — restaurar a chave, ou substituir a
credencial pela tela. O que ela **nunca** faz é degradar para "credencial não
configurada": esse texto convidaria alguém a recadastrar por cima de um
segredo que ainda está lá, quando o problema era só a chave fora do ambiente.

**A chave nunca é validada em escopo de módulo.** M17 é a razão, e ela vale
igual aqui: `next build` avaliaria o carregador ao coletar a configuração de
qualquer rota alcançável e derrubaria o build inteiro num ambiente sem a
variável.

### 5.5 Como `EVOLUTION_COMPANY_ID` morre — a pergunta mais difícil do ciclo

O webhook chega **sem sessão** (M8). Ele precisa saber a empresa antes de
qualquer escrita, e não pode consultar o banco fora de escopo — a lista de
exceções do lint está em zero e assim fica.

**A rota passa a carregar as duas coisas no path:**

```
antes:  POST /api/whatsapp/evolution/<token>
depois: POST /api/whatsapp/evolution/<companyId>/<token>
```

A resolução, em ordem:

1. `companyId` sai do path. Ele é **hipótese**, não autoridade.
2. `prismaDaEmpresa(companyId).whatsappConnection.findFirst({ where: { webhookTokenHash: sha256(token), ativa: true } })`.
   Consulta **escopada**, cliente escopado, zero exceção de lint.
3. Não achou → **404**, sem dizer se o erro foi na empresa ou no token
   (mesma política de hoje: 404 não confirma que o path existe).
4. Achou → a conexão traz `companyId`, `dominio`, `instancia` e o segredo. O
   gateway é construído a partir **dela**.
5. `verificarOrigem` compara o campo `instance` do payload com
   `conexao.instancia`. **Instância desconhecida → 403**, e nada é escrito.
6. `ingerirMensagem(evento, { companyId: conexao.companyId, connectionId: conexao.id })`.

**Por que um `companyId` que vem da URL não viola a regra do programa.** A
regra — "em Server Action a empresa vem de `usuarioAtual().companyId`, nunca
de parâmetro" — existe porque Server Action é endpoint público com sessão, e
aceitar a empresa por parâmetro deixaria alguém autenticado agir na empresa
alheia. Um webhook **não tem sessão**: não há de onde derivar empresa. Aqui o
`companyId` do path é um **atalho de roteamento** cuja autoridade é o token, e
o desenho é fecha-fechado:

- `companyId` de A + token de A → **encontra**, e é a única combinação que passa.
- `companyId` de B + token de A → a consulta escopada em B não acha o hash de
  A → 404. **Saber o token da empresa A não dá nada na empresa B.**
- `companyId` inventado + token qualquer → 404.

Ou seja: quem manda no resultado é o segredo, e o `companyId` só escolhe onde
procurar. Isso tem caso de teste (§8, P6).

**Cofre para o que precisa ser LIDO de volta; hash para o que só precisa ser
CONFERIDO.** A apikey da Evolution vai no cofre porque é usada para chamar a
API dela. O token do webhook vai como `sha256` porque nunca é usado, só
comparado — e assim um dump do banco não entrega uma URL de webhook
funcional, coisa que o desenho de hoje (token em texto puro no `.env`,
comparado com `timingSafeEqual`) não oferece.

**O que se perde:** a comparação deixa de ser de tempo constante — vira uma
busca por índice. A defesa contra adivinhação **nunca foi** o `timingSafeEqual`
e sim os 256 bits de entropia do token; o que se ganha (dump inútil) é maior
que o que se perde (um canal lateral sobre um valor que não se adivinha em
tempo nenhum). Registrado como escolha, não como descuido.

**A URL antiga deixa de existir.** O dono precisa colar a nova no painel da
Evolution — a tela mostra a URL completa no momento em que a conexão é criada
(§4.2), e há um botão de gerar de novo.

### 5.6 De onde o CONSUMIDOR DA FILA tira a credencial

Ele não tem sessão, mas **tem `companyId`** desde o Ciclo 1d: o job o exige
(M7), e `turno.ts` e `agente.ts` já o recebem (M6). O envio passa a resolver
o gateway **pela conversa**:

```ts
gatewayDaConversa(companyId, { id, connectionId }) // → Promise<WhatsappGateway>
```

- `connectionId` preenchido → aquela conexão. É o caso de toda conversa
  criada a partir deste ciclo.
- `connectionId` nulo (conversa anterior ao ciclo) → a **única** conexão ativa
  da empresa; **mais de uma → lança** `ConexaoAmbiguaError`, com o
  `conversationId` na mensagem. Responder pelo número errado é pior que não
  responder.
- Nenhuma conexão ativa → `ConexaoNaoConfiguradaError`.

O singleton `whatsappGateway` — o `Proxy` de `gateway/index.ts` — **deixa de
existir**. Ele era um objeto por processo com uma credencial só; um processo
serve várias empresas.

**Sem memoização.** Um `Map` de gateway por empresa no escopo do módulo seria
exatamente o estado global que o programa proíbe, e o modo de falha é servir a
credencial da empresa A para a B entre requisições — o mesmo defeito que o
caso "`leitura.ts` não tem binding mutável" (Ciclo 1c) existe para travar. O
custo é uma consulta e uma decifragem por mensagem enviada; a decifragem é
AES-GCM sobre ~40 bytes.

### 5.7 A tela

**Onde:** `/configuracoes/conexoes`, dentro de `(painel)`.

```
src/app/(painel)/configuracoes/layout.tsx   → a régua de seções (hoje: uma)
src/app/(painel)/configuracoes/page.tsx     → redirect("/configuracoes/conexoes")
src/app/(painel)/configuracoes/conexoes/page.tsx
src/app/(painel)/configuracoes/conexoes/actions.ts
```

A régua com **uma** seção é deliberada: é onde a marca (dívida D3 do Ciclo 1c)
e a Meta (2b) entram sem reescrever rota. `page.tsx` redireciona para a
primeira seção em vez de ser a tela, para que a URL não precise mudar quando
existir a segunda.

**Menu:** entrada "Configurações" apontando para `/configuracoes`, exibida
quando `hasPermission(papel, "gerenciar_conexoes")`. Isso é ruído de menu, não
o portão — o portão são a página e as actions. Hoje a régua tem uma seção só,
então a permissão da seção e a do menu coincidem; quando houver uma segunda
seção com outra permissão, esta condição vira um OU. Está escrito para não
parecer esquecimento.

**O que a tela mostra — uma LISTA, porque multi-instância:**

| Coluna | Conteúdo |
| --- | --- |
| Nome | rótulo humano ("Comercial", "Suporte") |
| Canal | `Evolution` |
| Instância / Domínio | texto puro, não são segredo |
| Chave | `••••••••1a2b` — dos **últimos 4 gravados em coluna própria**, sem decifrar nada |
| Última troca | data + nome de quem trocou |
| Estado | `Ativa` / `Inativa` — é o interruptor do operador, **não** o estado de pareamento do WhatsApp (§7) |

**O que a pessoa consegue fazer:** criar; substituir a chave (um campo, tipo
`password`, sem valor inicial); editar nome/domínio/instância; ativar e
desativar; gerar uma URL de webhook nova; apagar. **Não** consegue ler a chave.

Criar e "gerar URL nova" devolvem a URL de webhook **uma vez**, com aviso de
que não aparece de novo (§4.2).

O `<select>` de canal lista `Evolution` e mostra `Meta Cloud API` desabilitado
com "Ciclo 2b". A action **recusa** `META_CLOUD` com erro nomeado — o gate é
o servidor, o `disabled` é conveniência (§8, P8).

---

## 6. Como a Meta Cloud API (2b) cabe aqui sem reescrita

Dito, não construído.

1. **O discriminador já existe.** `CanalConexao.META_CLOUD` nasce declarado no
   enum, sem código que o aceite. Precedente literal nesta mesma base:
   `WhatsappAutor.HUMANO` (M16), declarado antes da fatia que o usaria
   "para não exigir uma migração de enum quando essa fatia chegar". A fábrica
   de gateway tem um ramo que **recusa** `META_CLOUD` com erro nomeado, e esse
   ramo tem caso de teste — então 2b troca uma recusa por uma implementação em
   vez de acrescentar um `else`.
2. **O cofre não sabe o que é WhatsApp.** `cifrar(texto, { companyId, proposito })`
   serve o access token da Meta com a mesma chamada, mudando o rótulo de
   propósito. Nada em `src/core/cofre/` precisa mudar.
3. **Colunas nulas por canal, tipadas.** Evolution usa `dominio`/`instancia`;
   Meta usará `phoneNumberId`/`wabaId` — **colunas novas nulas**, não `Json`
   (§5.3). Meta tem DOIS segredos (access token e app secret, este para o
   HMAC de `X-Hub-Signature-256`): 2b acrescenta uma segunda coluna cifrada.
   Este ciclo **não** a cria, porque uma coluna sem escritor é dado morto com
   aparência de recurso — é a mesma recusa que o Ciclo 1c fez a
   `entidade.campos`.
4. **A regra do webhook já é por conexão.** `verificarOrigem` é do adaptador
   desde a Fatia 1 (`tipos.ts:39-59` já descreve o handshake `hub.challenge` +
   HMAC da Meta). A rota resolve a conexão e delega — para a Meta, a rota
   muda de segmento (`/api/whatsapp/meta/<companyId>/<token>`) e a resolução
   é idêntica.
5. **Auditoria, máscara e redação são agnósticas de canal**: valem por serem
   regras da tabela e do cofre, não do Evolution.

---

## 7. QR Code fica FORA do 2a — e por quê

Decidido pelo critério de "o que torna cada peça testável sozinha".

1. **Nada de QR é provável neste ambiente.** `gateway/evolution.ts` registra,
   duas vezes, que *"não há uma instância Evolution real acessível neste
   ambiente"*. Um fluxo de pareamento é justamente o que só se prova contra uma
   instância viva. Entregá-lo aqui seria código sem teste por construção,
   dentro de um ciclo cujo resto é inteiramente testável.
2. **QR depende do cofre, não o contrário.** Para pedir um QR é preciso chamar
   a API da Evolution — ou seja, ter a credencial. Fazer o cofre primeiro é o
   que dá ao QR um alvo real para exercitar.
3. **QR traz uma segunda máquina de estados.** Pareado / desconectado /
   aguardando leitura vem pelo evento `connection.update`, que hoje a rota
   descarta explicitamente (`evolution.ts:252-256`). Isso é coluna de estado,
   evento novo e tela que atualiza sozinha — rejeitável por conta própria.

Por isso a tela **não** mostra "conectado/desconectado": mostraria um estado
que não é medido. `Ativa/Inativa` é o interruptor do operador e diz apenas
isso. Fingir o outro seria a pior das opções.

**Fica nomeado: Ciclo 2c — QR Code e estado de pareamento.**

---

## 8. O que este ciclo prova, e onde

| # | Prova | Onde | Como |
| --- | --- | --- | --- |
| P1 | Cifrar e decifrar dá a volta | `tests/unit/cofre-segredo.test.ts` | ida e volta com acentos e emoji; e o blob **nunca contém** o texto claro |
| P2 | Blob adulterado é RECUSADO, não decifrado pela metade | idem | um bit virado em `ciphertext`, um na `tag`, um no `iv` — três casos, os três lançam `CofreDecifragemError` |
| P3 | A AAD prende o blob à empresa e ao propósito | idem | decifrar o blob de A com `companyId` de B lança; com propósito diferente lança |
| P4 | Duas cifragens do MESMO texto dão blobs diferentes | idem | prova que o nonce é por operação, não fixo |
| P5 | A rotação funciona sem reescrever nada | `tests/unit/cofre-chave.test.ts` | cifra com `k1`; acrescenta `k2` na frente; o blob de `k1` continua abrindo e o novo sai com `keyId` de `k2`. E chave removida → `CofreChaveDesconhecidaError` citando o `keyId` |
| P6 | Token da empresa A não vale na empresa B | `tests/unit/conexoes-isolamento.test.ts` (Postgres real, duas empresas) | resolver com `companyId` de B e token de A devolve `null`; a sonda mostra que a busca sem escopo acharia |
| P7 | O segredo NÃO volta para o navegador | `tests/unit/conexoes-service.test.ts` | `listarConexoes` devolve `segredoUltimos4` e **nenhuma** chave chamada `segredoCifrado`; varredura do objeto inteiro |
| P8 | `META_CLOUD` é recusado com erro nomeado | `tests/unit/conexoes-service.test.ts` e `tests/unit/whatsapp-gateway-fabrica.test.ts` | criar com `META_CLOUD` lança; a fábrica lança `CanalNaoImplementadoError` |
| P9 | Auditoria sem `antes`/`depois`, em TODA ação de conexão | `tests/unit/conexoes-auditoria.test.ts` | uma asserção por ação: `registrarAuditoria` chamado, e o objeto **não tem** as chaves `antes` nem `depois` |
| P10 | O blob cifrado não chega ao Sentry | `tests/unit/sentry-scrub.test.ts` | um blob `v1....` real dentro de uma mensagem sai como `[segredo cifrado]` |
| P11 | A chave mestra em base64 não chega ao Sentry | idem | 43 caracteres base64 saem como `[chave]`; e um sha256 de 64 hex **não** é redigido (prova que a fronteira não pegou geral) |
| P12 | A apikey ecoada pela Evolution não chega ao erro | `tests/unit/whatsapp-evolution-gateway.test.ts` | resposta 401 com a apikey no corpo → a mensagem lançada contém `[apikey]` e **não** contém a chave |
| P13 | Importar o gateway sem cofre e sem banco NÃO lança | `tests/unit/whatsapp-config-preguicosa.test.ts` (reescrito) | é o que mantém o `next build` de pé — a metade 1 do teste que já existe |
| P14 | Usar sem cofre configurado AINDA lança, dizendo o que falta | idem | metade 2: adiar a validação não pode virar engolir a validação |
| P15 | A empresa sem conexão ativa não cai em fallback nenhum | `tests/unit/whatsapp-gateway-fabrica.test.ts` | lança `ConexaoNaoConfiguradaError`; e **nenhum** arquivo de `src/` menciona `EVOLUTION_` (varredura de fonte) |
| P16 | Conversa com duas conexões possíveis RECUSA em vez de chutar | idem | `connectionId` nulo + duas ativas → `ConexaoAmbiguaError` com o `conversationId` |
| P17 | A ingestão grava `connectionId` | `tests/unit/whatsapp-ingest.test.ts` | a `Conversation` criada carrega o id da conexão que resolveu o webhook |
| P18 | A rota nova recusa token errado, empresa errada e instância errada | `tests/unit/whatsapp-webhook-route.test.ts` | 404 / 404 / 403, nessa ordem, com o gateway nunca construído nos dois primeiros |
| P19 | A tabela nova nasce blindada | `tests/e2e/banco-blindado.spec.ts` (sem alteração) | ele varre `pg_class`/`role_table_grants` sem lista fixa; tabela nova desprotegida aparece sozinha |
| P20 | `WhatsappConnection` é modelo de tenant de verdade | `tests/unit/escopo-empresa.test.ts` | a trava de deriva exige o conjunto **exato** de 13 |
| P21 | Nenhum arquivo novo alcança o prisma cru | `tests/unit/catraca-prisma-cru.test.ts` + `npm run lint` | catraca com linha de base **0**, inalterada |
| P22 | A permissão é de ADMIN e ninguém mais | `tests/unit/permissions.test.ts` | ADMIN sim; GESTOR e VENDEDOR não |
| P23 | A tela funciona no navegador, de ponta a ponta | `tests/e2e/configuracoes-conexoes.spec.ts` | ADMIN cria, vê a máscara, substitui a chave, e a máscara muda; VENDEDOR não alcança a rota; a URL do webhook aparece uma vez |
| P24 | O texto claro nunca aparece no HTML servido | idem | depois de criar, o HTML da página **não contém** a apikey digitada |

### 8.1 O que este ciclo NÃO consegue provar, e por quê

- **Que a Evolution aceita a apikey vinda do banco.** Não há instância
  acessível neste ambiente (`gateway/evolution.ts`, duas vezes). O que se
  prova é que o valor que chega ao `fetch` é o que foi cadastrado — o
  adaptador é exercitado com `fetch` falso. A ponta real fecha com um humano
  (§10, NV3).
- **Que o dump do banco é inútil sem a chave.** Provar isso exigiria rodar
  `pg_dump` contra o Supabase e inspecionar. O que se prova é que a coluna
  guarda um blob que não contém o texto claro (P1) e que não abre sem a chave
  certa (P5). O passo do `pg_dump` fica como NV2.
- **Que `FORCE ROW LEVEL SECURITY` mudaria alguma coisa.** Continua desligada
  de propósito e este ciclo não a liga — a cifra é a resposta ao problema que
  ela resolveria, não um substituto dela.

---

## 9. O que este ciclo NÃO faz

- **Não faz QR Code nem estado de pareamento** (§7). É o Ciclo 2c.
- **Não faz Meta Cloud API** (§6). É o Ciclo 2b. Só o valor do enum entra.
- **Não mexe em `Conversation.waId`, `Contact.telefone`, `PipelineStage.ordem`
  nem `WhatsappMessage.idExterno`** — as quatro unicidades globais do ⚠️ R2 do
  Ciclo 1a. A de `waId` fica **alcançável** pela primeira vez, e por isso é
  declarada em D4.
- **Não escreve política RLS nem concede grant.** A tabela nova nasce com RLS
  ligada e **zero** políticas (default-deny), igual às outras. A exceção
  NOMEADA do Realtime continua sendo Ciclo 3.
- **Não liga `FORCE ROW LEVEL SECURITY`.**
- **Não cria exceção nova no lint.** O esperado é zero (M12), e o desenho da
  §5.5 existe justamente para que a resolução do webhook não precise de uma.
- **Não fecha `User.papel`** (⚠️ R4) nem as chamadas de `companyIdDoUsuario`
  (⚠️ R6).
- **Não separa o banco de teste do de desenvolvimento** (⚠️ R1) — continua o
  bloqueio duro de sempre.
- **Não põe credencial de n8n nem de OpenAI no cofre.** As duas cabem no
  desenho, nenhuma entra aqui: cada uma é uma tabela e uma tela próprias, e
  este ciclo entrega uma.

---

## 10. Ações do dono

**Nenhuma tarefa do plano fica bloqueada por ação do dono.** As duas abaixo
são de **implantação**, depois do ciclo pronto:

1. **Gerar a chave mestra e pô-la na Vercel.**
   ```bash
   openssl rand -base64 32
   ```
   Colar o valor em `COFRE_CHAVE_MESTRA`, em Vercel → Settings → Environment
   Variables, nos três ambientes. **Sem ela o WhatsApp não sobe** — e é assim
   que tem de ser (§5.4).
   *No ambiente local o plano gera a chave sozinho e a acrescenta ao `.env`
   sem imprimi-la; a suíte e2e precisa dela em disco.*

2. **Cadastrar a conexão e recolar a URL do webhook.** Abrir
   `/configuracoes/conexoes` como ADMIN, cadastrar domínio, instância e apikey
   (os valores que hoje estão nas variáveis `EVOLUTION_*`), copiar a URL de
   webhook que a tela devolve **uma vez** e colá-la no painel da Evolution no
   lugar da atual. Só depois disso apagar as quatro variáveis `EVOLUTION_*` da
   Vercel.

Continua valendo, herdada e não deste ciclo: **depois de rodar `npm test`,
rotacionar a senha do admin** (🔍 NV5 do Ciclo 1a).

### 10.1 NÃO VERIFICADO

| # | Item | Por que não deu | O que fecha |
| --- | --- | --- | --- |
| NV1 | Se o `sha256` do token com busca por índice tem custo aceitável com muitas conexões | O banco de desenvolvimento tem uma empresa; medir exige volume | `EXPLAIN ANALYZE SELECT * FROM "WhatsappConnection" WHERE "webhookTokenHash" = $1;` com alguns milhares de linhas |
| NV2 | Que um `pg_dump` da tabela não contém a apikey em texto | Exige rodar `pg_dump` contra o Supabase, fora do que este ambiente faz | `pg_dump --data-only -t '"WhatsappConnection"' "$DIRECT_URL" \| grep -c '<a apikey conhecida>'` → deve ser **0** |
| NV3 | Que a Evolution aceita a apikey lida do banco | Não há instância Evolution acessível neste ambiente (limitação já registrada em `gateway/evolution.ts`) | Depois da ação 2 do dono: mandar uma mensagem para o número e confirmar que a resposta sai |
| NV4 | Que a URL de webhook nova é aceita pelo painel da Evolution com dois segmentos dinâmicos | Idem — depende de instância viva | Colar a URL no painel e disparar um evento de teste; conferir 200 no log da Vercel |
| NV5 | Que `prisma migrate dev` não acusa deriva com o enum novo | Exige shadow database | `npx prisma migrate dev --create-only` num branch descartável |
| NV6 | Estado da senha do admin no banco de desenvolvimento | Herdado; este ciclo roda `npm test` na tarefa final | `SEED_PASSWORD=<valor forte> npx prisma db seed` |

---

## 11. Riscos e dívidas que este ciclo declara

**D1 — a chave mestra é ponto único de falha, por desenho.** Perdê-la torna
todo segredo do cofre irrecuperável. É o preço do que §4.1 compra, e a
mitigação é operacional (guardar a chave num gerenciador de segredos), não de
código. O que o código faz é falhar **alto e nomeado** (§5.4) em vez de
degradar.

**D2 — a AAD não separa duas conexões da MESMA empresa.** §5.1 diz o motivo
(o `id` não existe antes do `create`) e o que passa. Fechar isso é um ciclo
com id gerado na aplicação, não uma linha.

**D3 — a máscara guarda os últimos 4 caracteres em texto puro.** É entropia
revelada — 4 caracteres de uma chave. Foi escolhido porque o preço da
alternativa é decifrar toda vez que a lista renderiza, o que põe texto claro
na memória do processo a cada carregamento de tela para não ganhar nada. É o
mesmo trade que Stripe e GitHub fazem com `sk_live_…abcd`, e está registrado
como escolha.

**D4 — `Conversation.waId` global-única passa a ser ALCANÇÁVEL.** Enquanto
`EVOLUTION_COMPANY_ID` existia, a segunda empresa não tinha como receber
webhook; agora tem. O mesmo número atendido por duas empresas colide em
`P2002`, a rota devolve 500 e a Evolution reentrega indefinidamente. É ⚠️ R2 do
Ciclo 1a, sem mudança de gravidade e com mudança de alcance. **Não é deste
ciclo** (o dono travou isso), e está aqui para que o sintoma tenha nome antes
de aparecer.

**D5 — a comparação do token deixa de ser de tempo constante** (§5.5). Escolha
consciente: a entropia é a defesa, e o hash em vez do texto puro é ganho maior
que a perda.

**D6 — desativar a última conexão desliga o WhatsApp da empresa sem aviso
prévio.** A tela pede confirmação e a ação entra na detecção de rajada
destrutiva (`desativar_conexao`, ao lado de `desativar_fluxo`), mas nada
impede o clique. Impedir exigiria saber se há conversa em andamento, o que é
outra pergunta.

**D7 — a régua de Configurações tem uma seção só.** Enquanto for assim, a
permissão do menu e a da seção coincidem, e a condição do menu vira um OU
quando a segunda seção chegar (§5.7). É andaime declarado, não descuido.

**D8 — herdadas e não tocadas aqui.** ⚠️ R1 (banco de teste não separado),
R2 (unicidades globais — ver D4), R3 (os pontos cegos do escopo; **fica maior**:
`User` vai a 10 relações inversas), R4 (`User.papel`), R6
(`companyIdDoUsuario`). ⚠️ **R5 é o que este ciclo FECHA.** Somam-se os quatro
achados de infraestrutura que a auditoria do 1c lista como herdados e não
corrigidos — entre eles `N8N_ENCRYPTION_KEY=nateksoft` e "a chave global da
Evolution é `nateksoft`". **Este último é vizinho direto do que o ciclo
entrega:** o cofre protege a apikey **da instância** dentro do CRM, e não faz
nada contra uma chave global adivinhável **na Evolution**. Cifrar bem uma
credencial cuja irmã global é o nome da empresa é meia defesa, e ela precisa
ser dita inteira.

---

## 12. Critérios de aceite

Cada um com comando e saída coladas. O que este ambiente não provar sai como
**NÃO VERIFICADO** com o comando que um humano roda.

- `enum CanalConexao` e `model WhatsappConnection` no schema, com
  `@@unique([companyId, canal, instancia])`, `webhookTokenHash @unique` e a
  relação chamada `company`
- `Conversation.connectionId` nullable + `@@index([connectionId])`
- `MODELOS_DE_TENANT` tem **13** entradas e bate exatamente com o schema —
  caso de deriva verde
- O caso "modelos de tenant com `companyId` único" continua devolvendo
  `["BotConfig", "CompanyConfig"]` — **não** afrouxado
- A prosa de `escopo.ts` diz **10** relações inversas de `User` e **13**
  modelos — nenhuma frase antiga deixada para trás
- A migração tem `ENABLE ROW LEVEL SECURITY` e
  `REVOKE ALL ... FROM anon, authenticated`, e **nenhum** `INSERT`
- `tests/unit/migracoes-seguras.test.ts` verde com a migração nova em disco
- Ida e volta do cofre preserva o texto, e o blob **não contém** o texto claro
- Blob com um bit virado lança `CofreDecifragemError` — três casos
- Blob de A não decifra com `companyId` de B — caso de teste
- Duas cifragens do mesmo texto produzem blobs **diferentes** — caso de teste
- Chave nova na frente da lista: blobs antigos continuam abrindo; blobs novos
  saem com o `keyId` novo — caso de teste
- `keyId` fora da lista lança `CofreChaveDesconhecidaError` **citando o
  `keyId`** — caso de teste
- **Nenhuma** mensagem de erro do cofre contém texto claro nem base64 de chave
  — varredura das cinco classes
- `hasPermission("ADMIN", "gerenciar_conexoes")` é `true`; `GESTOR` e
  `VENDEDOR` são `false`
- `listarConexoes` não devolve **nenhuma** chave `segredoCifrado` — varredura
  do objeto
- Toda ação de conexão audita **sem** `antes` e **sem** `depois` — um caso por
  ação
- `apagar_conexao`, `desativar_conexao` e `substituir_segredo_conexao` estão em
  `ACOES_SENSIVEIS`; `criar_conexao`, `ativar_conexao` e `editar_conexao`
  **não** estão
- Um blob do cofre numa mensagem sai como `[segredo cifrado]`; 43 caracteres
  base64 saem como `[chave]`; um sha256 de 64 hex **não** é redigido
- Erro da Evolution que ecoa a apikey sai com `[apikey]` e **sem** a chave
- Importar `@/modules/whatsapp/gateway` sem `COFRE_CHAVE_MESTRA` e sem banco
  **não** lança; usar sem cofre lança dizendo o que falta
- `grep -rn "EVOLUTION_" src/` devolve **zero** linhas — caso de teste que
  varre o fonte
- `src/app/api/whatsapp/evolution/[token]/route.ts` **não existe mais**
- Webhook com token de A na URL de B → **404**; token certo com `instance`
  errada → **403**; token certo e instância certa → **200** e
  `Conversation.connectionId` preenchido
- `connectionId` nulo com **duas** conexões ativas → `ConexaoAmbiguaError` com
  o `conversationId` na mensagem
- Empresa sem conexão ativa → `ConexaoNaoConfiguradaError`, **nunca** fallback
- Criar conexão com `META_CLOUD` é recusado; a fábrica lança
  `CanalNaoImplementadoError`
- A empresa A não resolve a conexão da B contra Postgres real, e a sonda
  afirma que a busca sem escopo resolveria — dois casos no mesmo arquivo
- e2e: ADMIN cria, vê `••••…`, substitui e a máscara muda; a URL de webhook
  aparece **uma vez**; VENDEDOR não alcança `/configuracoes/conexoes`; o HTML
  servido **não contém** a apikey digitada
- `tests/unit/catraca-prisma-cru.test.ts` verde **sem exceção nova**, com
  `LINHA_DE_BASE_DE_IMPORTADORES_TEMPORARIOS` ainda em 0
- `npm run typecheck`, `npm run lint`, `npm test` e `npm run build` verdes
- `get_advisors(security)` sem achado novo além do esperado: a linha de base é
  16 × `rls_enabled_no_policy` (INFO) + 2 × WARN de `rls_auto_enable`; com a
  tabela nova espera-se **17 × INFO** e os mesmos 2 WARN
