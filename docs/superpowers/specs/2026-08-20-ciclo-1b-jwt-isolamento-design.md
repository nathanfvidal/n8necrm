# Ciclo 1b — JWT do Supabase e isolamento por empresa

Data: 2026-08-20
Status: aguardando revisão
Spec do programa: `2026-08-19-n8necrm-fundacao-design.md`
Ciclo anterior: `2026-08-19-ciclo-1a-tenancy-design.md` · auditoria em
`docs/auditorias/2026-08-19-ciclo-1a-tenancy.md`
Medição que sustenta este desenho: `.superpowers/sdd/medicao-jwt-supabase.md`

## 1. O que este ciclo entrega

O CRM passa a **emitir** um JWT que o Supabase reconhece, carregando a empresa
ativa do usuário, e passa a **provar** que o claim de empresa chega até a
expressão que as políticas do Ciclo 3 vão ler.

Concretamente: um par de chaves ES256 cuja privada mora só no CRM, uma rota
pública que publica a metade pública dela, uma rota autenticada que emite o
token, a fábrica do callback que o renova, e três provas — de formato, de
leitura do claim no Postgres, e de aceitação pelo Supabase.

**Nenhum canal de Realtime é aberto. Nenhuma política RLS é escrita. Nenhum
grant é concedido.** Isso é Ciclo 3, e a seção 6 diz por que a fronteira está
exatamente aqui.

## 2. A costura do spec do programa mudou, e é medição que muda

As linhas 123-131 de `2026-08-19-n8necrm-fundacao-design.md` dizem:

> O CRM emite um JWT de vida curta, assinado com **o segredo do projeto** [...]
> O caminho de "third-party auth provider" registrado **exige JWT assimétrico
> com OIDC discovery**, que o Auth.js não expõe — descartado.

As duas metades caíram na medição de 2026-08-20:

- **O registro de third-party auth NÃO exige OIDC discovery.** O schema
  `CreateThirdPartyAuthBody` do OpenAPI do Management API tem `oidc_issuer_url`,
  `jwks_url` e `custom_jwks` como três propriedades independentes. A lista de
  cinco provedores do guia é a lista de guias escritos, não a lista do que a API
  aceita. (medição §2)
- **O "segredo do projeto" é o segredo legado HS256**, formalmente depreciado
  (*"No longer recommended"*), o mesmo que valida `anon` e `service_role`, e com
  fim declarado junto das chaves legadas: *"until the end of 2026"* — quatro
  meses a partir de hoje. (medição §1)

A seção de riscos do spec do programa já previa isto, no item "Segredo JWT do
Supabase": *"Projetos migrados para chaves assimétricas mudam esse caminho.
Verificar no painel antes do Ciclo 1"*. Foi verificado. Mudou.

Este spec substitui aquela costura. O spec do programa continua correto em tudo
o mais; o parágrafo do JWT está desatualizado e deve ser lido daqui.

## 3. Decisões travadas pelo dono do projeto

Decididas em 2026-08-20, depois da medição. Reabrir qualquer uma invalida este
ciclo e o Ciclo 3.

### 3.1 Third-party auth com JWKS próprio — as chaves ficam separadas

O CRM publica um JWKS numa rota do Next.js e assina os próprios tokens com
`jose`. O Supabase **confia** nessa origem, mas continua guardando a chave
dele. Nenhuma das duas partes consegue assinar pela outra.

**Recusado — importar uma chave ES256 no signing-keys do Supabase.** É o
caminho mais barato de operar (sem custo por MAU, sem infra pública) e a
medição o recomendava em primeiro lugar. O dono recusou pelo preço que ele
cobra, e a doc do Supabase nomeia esse preço:

> Why is it not possible to extract the private key or shared secret from
> Supabase? [...] This ensures that no one in your organization is able to
> impersonate your users or gain privileged access to your project's data.

Importar a chave desfaz essa garantia de propósito: a partir da rotação, **o
Supabase Auth passa a assinar toda sessão de todo usuário com a chave que o
CRM guarda**. Vazar o env do CRM deixaria de ser "forjar um token de empresa"
e passaria a ser "forjar qualquer papel, `service_role` inclusive".

**Recusado — o segredo legado HS256, como o spec do programa desenhou.**
Funciona hoje, medido (medição §1, sonda contra a Data API). Recusado por três
motivos somados: está depreciado; é o mesmo segredo que valida `anon` e
`service_role`, então vazá-lo entrega o projeto inteiro; e morre no fim de
2026, dentro do horizonte deste programa. Construir o 1b em cima disso é
agendar a reescrita. Fica como último recurso operacional se o painel estiver
inacessível na hora de executar — **não** como destino.

### 3.2 A opção `accessToken` do `createClient`, não `realtime.setAuth(jwt)`

O spec do programa cita as duas. A medição confirmou no `node_modules`
(`@supabase/realtime-js` 2.111.0) que elas não são equivalentes:

> When an `accessToken` callback IS configured, **the callback is the source of
> truth**: the client remains in callback mode and continues to refresh from it
> on heartbeat, even after a bootstrap/override `setAuth(token)` call.

Medido no código instalado, não só na doc: `_wrapHeartbeatCallback` chama
`_setAuthSafely()` a cada heartbeat com status `sent`
(`RealtimeClient.js:554-563`), e o intervalo padrão de heartbeat é
`HEARTBEAT_INTERVAL: 25000` ms (`RealtimeClient.js:9`). Ou seja: com
`accessToken` configurado, o callback é chamado **a cada ~25 s por cliente
conectado**, e é isso que resolve a expiração curta sem ninguém reinjetar token
na mão.

**Armadilha a dizer em voz alta:** `accessToken` e o namespace `supabase.auth`
são mutuamente exclusivos **no mesmo cliente** — *"When set, the `auth`
namespace of the Supabase client cannot be used"*
(`@supabase/supabase-js/dist/index.d.mts`). Aqui isso não custa nada, porque o
login é cookie do Auth.js e ninguém chama `supabase.auth`. Mas o cliente de
`src/lib/storage.ts`, que usa `service_role`, tem que continuar sendo **outro
cliente** — e continua, porque este ciclo não encosta nele.

### 3.3 Em dev, `custom_jwks` inline; em produção, `jwks_url`

O Supabase precisa **alcançar** a URL do JWKS. Em desenvolvimento o CRM roda em
`localhost`, que o Supabase não alcança — `custom_jwks` resolve isso sem túnel,
porque o JWKS vai inline na configuração do provider.

Os dois modos existem no desenho e a troca entre eles é **explícita**: são dois
registros diferentes no Supabase, feitos pelo dono, um de cada vez. Não há
código que "detecte o ambiente e escolha" — o CRM assina do mesmo jeito nos
dois; o que muda é só de onde o Supabase leu a chave pública.

**Consequência que precisa ser dita, porque ela morde:** dev e produção usam
**o mesmo projeto Supabase** neste programa (o mesmo Postgres, registrado em
`docs/auditorias/2026-08-19-ciclo-1a-tenancy.md`, ⚠️ R1). Registrar os dois
providers ao mesmo tempo significa que **a chave da máquina de desenvolvimento
mintaria tokens aceitos em produção**. Por isso: **um provider registrado por
vez**, e a troca para produção é apagar o de dev antes de criar o de produção.
Está na seção 8, na ordem em que o dono executa. Isto é da mesma família do
R1 do Ciclo 1a — banco de teste não separado do de dev — e não se resolve
dentro deste ciclo.

## 4. Decisões deste spec

Cada uma foi tomada aqui, com o motivo. Não são pontos em aberto.

### 4.1 Onde mora a chave privada, e em que formato

**Decisão: uma variável de ambiente, `SUPABASE_JWT_PRIVATE_JWK`, contendo o JWK
privado como JSON de uma linha. Não PEM PKCS8, não arquivo em disco, não KMS.**

Por que **JWK e não PKCS8 PEM**, que é o formato mais comum:

1. **PEM tem quebras de linha; `.env` e o painel da Vercel, não.** Guardar PEM
   em variável de ambiente obriga a escapar `\n` ou a embrulhar em base64, e as
   duas soluções produzem o mesmo modo de falha: uma chave que parece presente e
   falha na importação com erro de parser, longe da causa.
2. **O `kid` viaja dentro da chave.** O Supabase localiza a chave de verificação
   pelo `kid` do header (*"The signed JWTs must have a `kid` header parameter to
   identify which key must be used"* — medição §2). Com o `kid` dentro do JWK, o
   header do token e o JWKS publicado saem **do mesmo objeto** e não têm como
   divergir. Com PEM, `kid` seria uma segunda variável — e duas fontes de
   verdade para um identificador de chave é exatamente o defeito que produz
   "token recusado sem explicação".
3. **O JWKS público é derivado, não configurado.** A rota do JWKS remove `d` do
   mesmo objeto e publica o resto. Não existe segunda variável com a chave
   pública, então não existe o estado "publiquei a pública de uma chave e assino
   com outra".
4. `jose` importa JWK direto (`importJWK`), sem passar por parser de PEM.

Por que **variável de ambiente e não arquivo nem KMS**: a Vercel entrega
segredo por variável de ambiente e o resto da base já faz assim
(`SUPABASE_SERVICE_ROLE_KEY`, `EVOLUTION_APIKEY`, `WHATSAPP_QUEUE_SECRET`). Um
KMS seria mais forte e é o caminho de endurecimento futuro; hoje ele
acrescentaria um provedor externo a um ciclo cuja tarefa é provar uma costura.

**Construção preguiçosa, obrigatória.** A validação da variável roda **dentro de
uma função**, na primeira emissão, nunca no escopo do módulo — e o padrão a
seguir é `src/modules/whatsapp/gateway/index.ts`, que carrega o registro do
incidente: `next build` avalia cada módulo alcançável para coletar a
configuração das rotas, e validar no topo derrubou o deploy de produção por três
dias. `src/lib/env.ts` valida no escopo do módulo e **não** recebe estas
variáveis, pelo mesmo motivo que não recebe as da Evolution.

Isso é afirmação universal ("nunca no escopo do módulo") e por isso tem caso que
a exercita: `tests/unit/supabase-jwt-chave.test.ts` importa o módulo com o
ambiente **vazio** e afirma que o import não lança.

**O que a chave nunca é:** `NEXT_PUBLIC_SUPABASE_JWT_PRIVATE_JWK`. O prefixo
público empacota o valor no bundle do navegador. O teste
`tests/unit/supabase-jwt-chave.test.ts` afirma que a string
`NEXT_PUBLIC_SUPABASE_JWT` não aparece em `src/` nem em `.env.example`.

### 4.2 A rota do JWKS

**Decisão: `GET /api/jwks`, arquivo `src/app/api/jwks/route.ts`, handler
dinâmico (`export const dynamic = "force-dynamic"`), com
`Cache-Control: public, max-age=300`.**

**Por que `/api/jwks` e não `/.well-known/jwks.json`.** O caminho
`.well-known` é convenção de OIDC discovery, e o Supabase **não** faz discovery
neste caminho: o campo `jwks_url` do `CreateThirdPartyAuthBody` é uma string
livre (medição §2), então o caminho não compra nada. Contra ele há um custo
real: servir `/.well-known/...` no App Router depende de como o Next 16.3 trata
um segmento de rota que começa com ponto, e **isto não foi verificado neste
ambiente** — a doc da própria base (`node_modules/next/dist/docs/01-app/
02-guides/backend-for-frontend.md:112-118`) cita `.well-known` como algo que
"você também pode definir", com exemplo de `app/rss.xml/route.ts`, sem mostrar o
caso do ponto inicial. Desenhar a rota pública do ciclo em cima de um
comportamento não verificado seria o oposto do que este ciclo existe para fazer.
`src/app/api/jwks/route.ts` também fica na mesma árvore que os outros route
handlers, que é onde o bloco `src/app/**` do `no-restricted-imports` já alcança.

Se um dia a URL canônica precisar ser `.well-known`, um `rewrite` no
`next.config.ts` move a URL sem mover o código — mas **mover a URL depois custa
uma reregistração no Supabase**, com até 30 minutos de defasagem de propagação
(medição §2, Limitations 2). Escolher agora e não mexer é mais barato.

**Por que dinâmico.** Um route handler sem leitura da requisição pode ser
avaliado em tempo de build, e em tempo de build a variável da chave não existe —
é o mesmo modo de falha do `gateway/index.ts`. `force-dynamic` é explícito para
que ninguém "otimize" isso depois. O teste
`tests/unit/rota-jwks.test.ts` importa o módulo e afirma
`dynamic === "force-dynamic"`.

**O cache de 5 minutos** é deliberado nos dois sentidos: o documento é público e
imutável entre rotações, então cachear é correto; e 5 minutos é bem menor que a
janela de até 30 minutos que o próprio Supabase leva para reler o JWKS, então o
nosso cache nunca é o gargalo de uma rotação.

**A rota é pública por definição, e é isso que ela implica:** qualquer pessoa na
internet lê o conteúdo dela, sem sessão, sem `apikey`, sem rate limit útil.
Logo:

- Ela **só** pode conter `kty`, `crv`, `x`, `y`, `kid`, `alg`, `use`. O campo
  `d` — o escalar privado — é o que transforma a chave pública na chave que
  assina. `tests/unit/rota-jwks.test.ts` afirma isso sobre o **texto
  serializado** do corpo, não sobre o objeto: uma asserção sobre o objeto
  passaria por cima de um getter ou de um campo herdado do protótipo.
- Ela nunca ecoa nada da requisição, nunca lê cookie, e nunca varia por usuário.
- Com a chave ausente ou malformada, ela responde **500 com corpo genérico** e
  loga no servidor — e **não** responde 200 com `{"keys":[]}`. Um JWKS vazio
  faz o Supabase recusar todo token com um erro que não diz "o JWKS está vazio",
  e a origem do problema fica a três saltos de distância.

### 4.3 O conteúdo exato do token

Header: `{ "alg": "ES256", "kid": <o kid do JWK>, "typ": "JWT" }`.

Payload — **seis claims, e nenhum a mais**:

| Claim | Valor | Por que está aqui |
| --- | --- | --- |
| `role` | `"authenticated"` | **Obrigatório.** É o único claim com semântica sequestrada: vira o papel Postgres da conexão. Sem ele o Supabase cai em `anon`, e `anon` está revogado de tudo nesta base — o Realtime entregaria silêncio. (medição §2) |
| `sub` | `User.id` (cuid) | Identidade de quem age. Livre neste caminho — não precisa ser UUID de `auth.users`; Firebase e Clerk usam ids próprios (medição §2). Ver a armadilha do `auth.uid()` em 4.3.1. |
| `company_id` | `UsuarioAtivo.companyId` | O motivo do ciclo. As políticas do Ciclo 3 leem `auth.jwt() ->> 'company_id'`. |
| `exp` | `iat + 300` | Obrigatório. Ver 4.4. |
| `iat` | agora | Sem ele, um token achado num log não tem data. `exp` sozinho não distingue um token de 5 minutos recém-emitido de um de 24 horas prestes a vencer — e essa distinção é a primeira pergunta de qualquer investigação. Um campo, padrão, sem semântica sequestrada. |
| `iss` | `SUPABASE_JWT_ISSUER` (origem pública do CRM) | Nomeia **quem mintou**. Ver a justificativa e o risco abaixo. |

**Fora, de propósito:**

- **`aud`** — não é exigido pelo Supabase para aceitar o token (medição §2). Um
  `aud` com valor errado é pior que `aud` ausente: qualquer verificador
  configurado para conferir audiência recusaria. Claim a mais é superfície a
  mais.
- **`email`, `phone`, `session_id`, `aal`, `is_anonymous`** — são a lista de
  claims obrigatórios do **Custom Access Token Hook**, que governa tokens que o
  *Supabase Auth* emite. Token mintado pelo CRM não passa por aquele hook.
  Confundir as duas listas faria este ciclo carregar sete claims inúteis
  (medição §5, "pegadinha de leitura").
- **`papel`** (o `Role` do CRM: ADMIN/VENDEDOR/…) — **e esta é a exclusão que
  mais importa.** Autorização por papel vive no caminho do Prisma, em
  `hasPermission`. Pôr o papel no token criaria uma segunda fonte de verdade
  sobre autorização, que é exatamente a dívida ⚠️ R4 que o Ciclo 1a já carrega
  com `User.papel`. O caminho do navegador filtra por **empresa**, e só.

**O `iss`, e o risco que ele carrega.** A medição não diz se o Supabase compara
`iss` quando o provider foi registrado por `jwks_url`/`custom_jwks` — e com
`custom_jwks` não existe issuer registrado com que comparar, o que torna
improvável que a comparação seja universal. Incluí mesmo assim, por dois
motivos operacionais: um token colado em `jwt.io` durante uma investigação diz
de qual deploy saiu; e se algum dia dois providers estiverem registrados (o que
3.3 proíbe, mas proibição não é mecanismo), `iss` é a única coisa no token que
distingue dev de produção. O custo é uma variável de ambiente obrigatória a
mais. **A alternativa considerada** — omitir `iss` e ficar no payload mínimo
medido (`role` + `exp` + `sub`) — foi recusada por isso; se o registro recusar o
token por causa do `iss`, o teste de formato (4.5) nomeia o claim e a correção é
uma linha.

**Nenhum claim a mais**, e essa é afirmação universal: o teste
`tests/unit/supabase-jwt-emitir.test.ts` afirma o conjunto **exato** de chaves
do payload e o conjunto exato do header. Um claim acrescentado sem querer, ou um
aperto de validação do Supabase como o do changelog de 2025-09-17 (medição §5),
aparece como teste vermelho em vez de Realtime mudo.

#### 4.3.1 `auth.uid()` é inutilizável neste projeto — medido

`auth.uid()` faz cast de `sub` para `uuid`. O `User.id` desta base é **cuid**.
Medido contra o Postgres real do projeto `uzumzfxjcxrbxaucvfsr` nesta sessão:

```sql
select p.proname, pg_get_functiondef(p.oid) from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='auth' and p.proname='uid';
```
```
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $function$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$
```
```sql
select set_config('request.jwt.claims',
  '{"sub":"cmt18m0ut000w306jabcdefgh","role":"authenticated","company_id":"company-migracao-1a"}',
  true) is not null as ok, auth.uid();
```
```
ERROR: 22P02: invalid input syntax for type uuid: "cmt18m0ut000w306jabcdefgh"
```

Uma política que chame `auth.uid()` **não devolve falso: ela levanta exceção** e
derruba a consulta inteira. Alto, mas confuso — o erro fala de sintaxe de UUID,
não de política.

**Decisão: manter o cuid em `sub`** (a alternativa seria inventar um UUID por
usuário, uma coluna nova e uma segunda identidade para manter em sincronia) e
travar a armadilha com teste: `tests/e2e/claims-jwt.spec.ts` afirma que
`auth.uid()` levanta `22P02` com o payload real deste CRM, e que
`auth.jwt() ->> 'sub'` devolve o id. O Ciclo 3 escreve políticas com
`auth.jwt() ->> ...`, nunca com `auth.uid()`.

### 4.4 Vida do token e renovação

**Decisão: `exp = iat + 300` (5 minutos). Renova quem consome: o callback do
`accessToken`, que refaz o token quando faltam menos de 60 s para expirar, com
uma única requisição em voo por vez.**

Os números saem de medição, não de gosto:

- O callback é chamado **a cada ~25 s por cliente conectado** (heartbeat de
  25000 ms, `RealtimeClient.js:9` + `:554-563`), e a doc avisa que ele é chamado
  *"concurrently and many times"*, mandando memoizar e travar.
- Com 5 minutos de vida e margem de 60 s, cada aba emite **um token a cada ~4
  minutos** e reaproveita o mesmo em cerca de dez heartbeats. Sem memoização,
  seriam ~12 emissões por minuto por aba.
- A margem de 60 s também cobre relógio do navegador adiantado em relação ao
  servidor: sem ela, um cliente com 30 s de deriva mandaria tokens que o
  Supabase considera vencidos.

Por que **não 60 s de vida**: cada heartbeat viraria emissão, e uma falha de
rede perto da expiração derruba o canal — *"If a new JWT is never received on
the Channel, the client will be disconnected when the JWT expires"*.

Por que **não uma hora**: o token é um crachá de leitura da empresa inteira pelo
caminho do navegador. Vazado (devtools, log de proxy, print), ele vale até
expirar, e não há revogação — o Supabase verifica assinatura, não consulta
lista. Cinco minutos é o que reduz essa janela sem transformar a renovação em
tráfego.

**Falha do callback: lançar, nunca devolver `null`.** Isto é contraintuitivo e é
medido em `RealtimeClient.js:456-495`:

- se o callback **lança**, o cliente loga e **cai no último token bom**
  (`tokenToSend = this.accessTokenValue`) — degradação graciosa até a expiração;
- se o callback **devolve `null`**, `accessTokenValue` é sobrescrito com `null`,
  e o canal já juntado recebe um push de `access_token: null`.

Ou seja, o caminho que *parece* mais educado é o destrutivo. `tests/unit/
supabase-access-token.test.ts` afirma que a fábrica lança em falha e que a
chamada seguinte tenta de novo (falha não é memoizada).

### 4.5 Onde o token é emitido

**Decisão: um route handler, `GET /api/supabase/token`, em
`src/app/api/supabase/token/route.ts`. Não Server Action.**

Por que route handler: o consumidor é uma função `async` de JavaScript comum no
navegador, que precisa de um valor. Chamar uma Server Action dali acopla o token
ao protocolo de ações do RSC e não permite controlar cabeçalho de resposta — e
este endpoint **precisa** de `Cache-Control: no-store`, porque devolve
credencial portadora.

**A empresa vem de `usuarioAtual().companyId`, no servidor, e de mais lugar
nenhum.** A rota **não lê nenhuma entrada da requisição**: nem query string, nem
corpo, nem cabeçalho customizado. Essa é a forma mais forte de garantir que o
cliente não escolhe a empresa — não há parâmetro a forjar.

Não é zelo teórico. Server Action e route handler são endpoints HTTP públicos, e
o Ciclo 1a fechou um caso exatamente desta forma: `redefinirSenha` recebia
`entrada.id` do cliente, provava que o **agente** tinha permissão e nunca
provava nada sobre o **alvo** — um ADMIN da empresa A redefinia a senha do ADMIN
da B (auditoria 1a, § 5.2). Aqui a aposta é maior: o `company_id` do token é
literalmente o que as políticas do Ciclo 3 vão confiar. Se o cliente puder
escolhê-lo, o RLS inteiro vira decoração.

O teste que exercita isso (`tests/unit/rota-token-supabase.test.ts`) manda uma
requisição carregando `?companyId=empresa-b`, um corpo com `companyId`, e um
cabeçalho `x-company-id` — e afirma que o token emitido carrega a empresa **da
sessão**.

**Sem sessão → 401**, com corpo sem nenhum campo `token`.

**Teto de taxa: 120 emissões por 5 minutos, por `User.id`**, com
`checarRateLimit` (`src/core/rate-limit/limiter.ts`), chave
`jwt-supabase:<userId>`. O legítimo consome ~1,25 por janela por aba; 120 cabe
dez abas abertas com folga de ordem de grandeza. Existe porque um endpoint que
minta credencial sem teto transforma um cookie de sessão roubado em fábrica de
tokens. A chave é o **id do usuário** e não o IP, de propósito: um escritório
inteiro atrás de um NAT dividiria o orçamento. Ao estourar: 429, corpo sem
`token`, e log no servidor — afirmado por caso de teste, porque um 429 que ainda
emite é teatro.

Custo aceito e registrado: quando o teto estoura, o canal do Realtime cai na
expiração do último token, sem mensagem na tela. É o comportamento correto (o
teto existe para conter abuso) e é o motivo de o limite ser folgado.

### 4.6 Onde o código mora

```
src/core/supabase-jwt/chave.ts          # carga preguiçosa do JWK privado, derivação do público
src/core/supabase-jwt/emitir.ts         # mint (server-only)
src/core/supabase-jwt/access-token.ts   # fábrica do callback (roda no navegador)
src/app/api/jwks/route.ts               # JWKS público
src/app/api/supabase/token/route.ts     # emissão autenticada
scripts/gerar-chave-jwt-supabase.ts     # CLI fina sobre chave.ts, para o dono rodar
```

**Nenhum destes arquivos toca o `prisma` cru**, e portanto **nenhuma exceção
nova entra na lista do lint** — que chegou a zero temporárias no Ciclo 1a e tem
catraca (`tests/unit/catraca-prisma-cru.test.ts`) que só permite diminuir. A
rota do token chama `usuarioAtual()` e `checarRateLimit()`, que são funções de
módulos que já estão na `EXCECAO_PERMANENTE`; importar uma função não é importar
o prisma. Isso é afirmação verificável e o plano a verifica rodando a catraca e
o lint com os arquivos novos em disco.

## 5. O que este ciclo prova, e como

Quatro provas, em ordem de distância do CRM.

**P1 — o token tem o formato exato, e o formato está travado.**
Unitário. Emite com a chave, verifica com `jwtVerify` contra a pública derivada
do JWKS, afirma o conjunto exato de claims e a janela de 5 minutos. Também
afirma o negativo: token assinado por outra chave não verifica.

**P2 — a rota do JWKS publica a pública e nunca a privada.**
Unitário, sobre o texto serializado do corpo.

**P3 — `auth.jwt() ->> 'company_id'` lê o claim, no Postgres real.**
E2E de banco (mesmo formato de `tests/e2e/banco-blindado.spec.ts`, que é teste
de banco vestido de Playwright). Emite um token de verdade, decodifica o
payload, faz `set_config('request.jwt.claims', <payload>, true)` dentro de uma
transação e afirma o que a política do Ciclo 3 vai afirmar. **Não precisa de
grant, de política nem de exceção nenhuma** — roda pela conexão do Prisma, que
é dona da tabela.

Já medido nesta sessão, contra o projeto `uzumzfxjcxrbxaucvfsr`:

```sql
select set_config('request.jwt.claims',
  '{"iss":"https://crm.exemplo","sub":"cmt18m0ut000w306jabcdefgh","role":"authenticated",
    "company_id":"company-migracao-1a","iat":1787000000,"exp":1787000300}', true) is not null,
  auth.jwt() ->> 'company_id', auth.jwt() ->> 'sub', auth.role();
```
```
[{"configurado":true,"company_id":"company-migracao-1a",
  "sub":"cmt18m0ut000w306jabcdefgh","papel_pg":"authenticated"}]
```

O teste do ciclo transforma essa medição em portão permanente, e acrescenta a
armadilha do `auth.uid()` (4.3.1).

**P4 — o Supabase ACEITA um token do CRM.**
E2E de rede, e é a prova que fecha a decisão 3.1. Usa a técnica da medição §1:
bater na Data API com uma tabela **inexistente**, para separar "JWT recusado" de
"JWT aceito, tabela não existe".

| Sonda | Cabeçalhos | Esperado | O que prova |
| --- | --- | --- | --- |
| A | `apikey: <publishable>` + `Bearer <token do CRM>` sobre `/rest/v1/tabela_que_nao_existe` | 404, `PGRST205` | assinatura verificada contra o nosso JWKS, `role` resolvido |
| B (controle negativo) | igual, mas token assinado por uma chave ES256 aleatória | 401, `PGRST301` | a sonda A significa alguma coisa |
| C | `apikey: <publishable>` + `Bearer <token do CRM>` sobre `/rest/v1/Lead` | erro de permissão (`42501`), **não** `PGRST301` | a blindagem continua de pé **contra o tipo de token novo que este ciclo criou** |

**Nada disso concede grant, cria política ou afrouxa o `banco-blindado`.** A
sonda A não toca tabela nenhuma; a C confirma a porta fechada por dentro.

### 5.1 O que este ciclo NÃO consegue provar, e por quê

**A ponta a ponta — que o gateway do Supabase popula `request.jwt.claims` a
partir do nosso token — não é provável sem uma exceção que pertence ao Ciclo 3.**

P4-A prova que o token é **aceito**; P3 prova que a expressão lê **um payload da
nossa forma**. O elo do meio (aceito → claims populados → política avalia) exige
que exista **alguma** tabela que `authenticated` possa ler, e criar isso é
exatamente a exceção nomeada que o Ciclo 3 abre: `SELECT` em uma tabela só, com
política junto, e `banco-blindado.spec.ts` atualizado para **afirmar** essa
exceção.

**Considerado e recusado: uma tabela-sonda temporária**, criada com grant e
política, medida, e derrubada na mesma sessão. Recusada por dois motivos: uma
exceção que existe só durante a execução de um teste é uma exceção que ninguém
consegue auditar depois; e enquanto ela existisse, `banco-blindado.spec.ts`
estaria **verde afirmando algo falso** — o teste passaria a mentir por uma
janela, que é o defeito que ele existe para impedir.

**O que dá para fazer no lugar, e este ciclo faz:** deixar o elo do meio como o
único item aberto, nomeado, com o teste que o fechará já escrito em prosa na
seção 10, e **pré-armar a afirmação** em `banco-blindado.spec.ts` — hoje ele
passa a afirmar que o schema `realtime` tem **zero** políticas e **zero** grants
para `anon`/`authenticated` (medido nesta sessão: `politicas_realtime: 0`,
`grants_publicos: 0`). No Ciclo 3, essa afirmação é **editada** para nomear a
única política que passará a existir. Editar uma afirmação é visível no diff;
afrouxar um teste também deveria ser, e historicamente não é.

## 6. O que este ciclo NÃO faz

- **Nenhuma política RLS.** Nem uma. Mesma decisão do Ciclo 1a, pelo mesmo
  motivo: escrever política antes de existir quem leia reabre a API pública para
  tabelas que nenhum navegador consulta.
- **Nenhum grant** para `anon` ou `authenticated`.
- **Nenhum cliente Supabase de navegador, nenhum canal, nenhuma assinatura.**
  Ciclo 3.
- **Nenhuma mudança no CSP.** `connect-src 'self'` continua como está — o
  websocket do Realtime exige abri-lo, e essa diretiva é do Ciclo 3. As duas
  rotas deste ciclo são da própria origem.
- **Nenhuma mudança de schema, nenhuma migration.**
- **Nada em `src/lib/storage.ts`** — o cliente `service_role` continua sendo
  outro cliente (3.2).
- **`User.papel` continua de pé** (⚠️ R4 do Ciclo 1a). Não é assunto deste
  ciclo.

## 7. Fatos medidos, com a fonte

Tudo abaixo foi medido nesta sessão ou está na medição de referência. Nada é
presumido.

| Fato | Como foi verificado |
| --- | --- |
| `jose` **6.2.5** está em `node_modules`, mas **não** é dependência direta | `node -e "require('./node_modules/jose/package.json').version"` → `6.2.5`; `package.json` não tem `jose`; `package-lock.json` mostra `@auth/core → jose ^6.0.6`. **É transitiva, por hoisting.** |
| `accessToken` é `() => Promise<string \| null>` | `@supabase/supabase-js/dist/index.d.mts` |
| O callback roda no heartbeat, a cada 25 s | `realtime-js/dist/module/RealtimeClient.js:9` (`HEARTBEAT_INTERVAL: 25000`) e `:554-563` (`_wrapHeartbeatCallback` → `_setAuthSafely`) |
| Callback que **lança** → cai no último token; que devolve **`null`** → sobrescreve com `null` | `RealtimeClient.js:456-495` |
| `auth.jwt() ->> 'company_id'` lê claim customizado | SQL contra `uzumzfxjcxrbxaucvfsr`, seção 5, P3 |
| `auth.uid()` **levanta** `22P02` com `sub` cuid | SQL contra `uzumzfxjcxrbxaucvfsr`, seção 4.3.1 |
| `realtime` tem **0** políticas; `public` tem **0** grants para `anon`/`authenticated`; **0** tabelas sem RLS; `realtime.messages` existe | `select count(*) from pg_policies where schemaname='realtime'` etc. → `{"politicas_realtime":0,"tem_messages":1,"grants_publicos":0,"publicacao_realtime":1,"tabelas_sem_rls":0}` |
| `role` é o único claim com semântica sequestrada | medição §5 |
| `jwks_url` e `custom_jwks` são campos de primeira classe do registro | medição §2, schema `CreateThirdPartyAuthBody` do OpenAPI |
| Third-Party MAU custa US$ 0,00325 acima da cota | medição §2, seção Pricing |
| Rotação de JWKS leva **até 30 min** para o Supabase notar | medição §2, Limitations 2 |
| A chave `apikey` **não** pode ser o token mintado | medição §3 |

## 8. Ações do dono — eu não tenho painel do Supabase nem PAT

Nesta ordem. **A execução do plano para na Tarefa 6 sem os itens 1 a 4.**

1. **Desligar *Allow public access* em Realtime → Settings.**
   `https://supabase.com/dashboard/project/uzumzfxjcxrbxaucvfsr/settings/realtime`
   A doc é explícita: *"To enforce private channels you need to disable the
   'Allow public access' setting in Realtime Settings"*. **Sem isso o RLS de
   canal não tranca nada**, qualquer que seja o caminho de JWT escolhido.
   Reportar o estado antes e depois.

2. **Abrir `Settings → JWT Keys` e reportar o inventário.**
   `https://supabase.com/dashboard/project/uzumzfxjcxrbxaucvfsr/settings/jwt`
   Quantas chaves existem, e o estado de cada uma (`in_use`, `standby`,
   `previously_used`, `revoked`), e se a legada foi migrada. Isto é **NÃO
   VERIFICADO** hoje (medição §1) e não bloqueia a decisão 3.1 — bloqueia saber
   se o último recurso HS256 ainda existe de fato. Com um PAT em mãos, o mesmo
   dado sai de:
   ```
   curl -H "Authorization: Bearer $SUPABASE_PAT" \
     https://api.supabase.com/v1/projects/uzumzfxjcxrbxaucvfsr/config/auth/signing-keys
   ```

3. **Gerar a chave do CRM e guardá-la.**
   ```
   npx tsx scripts/gerar-chave-jwt-supabase.ts
   ```
   (existe a partir da Tarefa 1 do plano). Ele imprime duas coisas e não grava
   nada em disco: o **JWK privado** (linha única, vai para `.env` em
   `SUPABASE_JWT_PRIVATE_JWK`, **nunca** com prefixo `NEXT_PUBLIC_`) e o **JWKS
   público** (vai para o item 4). Preencher também `SUPABASE_JWT_ISSUER` e
   `SUPABASE_PUBLISHABLE_KEY` — ver `.env.example`.

4. **Registrar o provider de third-party auth — e há uma contradição a
   atravessar.**

   A medição achou duas páginas da Supabase que discordam:

   - **O guia** (`/docs/guides/auth/third-party/overview`) lista cinco
     provedores (Clerk, Firebase, Auth0, Cognito, WorkOS) e diz, em
     *Limitations 1*, que o provedor precisa expor uma **OIDC Issuer Discovery
     URL**.
   - **O OpenAPI do Management API** (`https://api.supabase.com/api/v1-json`,
     schema `CreateThirdPartyAuthBody`) aceita `oidc_issuer_url`, `jwks_url` **e**
     `custom_jwks` como três propriedades independentes, e o schema de resposta
     `ThirdPartyAuth` devolve as três mais `resolved_jwks`, todas `nullable`.

   **O plano assume o OpenAPI**, porque ele é o contrato executável da API e a
   lista do guia é lista de guias escritos. Se o formulário do painel não
   oferecer campo genérico, o registro sai pela API com um PAT (item 5).

   **Em desenvolvimento**, registrar com `custom_jwks` (o JSON impresso no item
   3), porque o Supabase não alcança `localhost`:
   ```
   curl -X POST -H "Authorization: Bearer $SUPABASE_PAT" -H "Content-Type: application/json" \
     https://api.supabase.com/v1/projects/uzumzfxjcxrbxaucvfsr/config/auth/third-party-auth \
     -d '{"custom_jwks": <o JWKS publico impresso no item 3>}'
   ```
   **Em produção**, e só quando o CRM tiver origem pública, apagar o de dev
   (`DELETE /v1/projects/{ref}/config/auth/third-party-auth/{id}`) e criar o de
   produção com `{"jwks_url":"https://<origem>/api/jwks"}`. **Um por vez** — ver
   3.3.

   Reportar: quais opções o formulário "Add integration" mostra em
   `Authentication → Third-Party Auth`, e o `id` do provider criado.

5. **Gerar um Personal Access Token** se o item 4 precisar da Management API.
   `https://supabase.com/dashboard/account/tokens`. Ele **não** entra no
   repositório nem no `.env` do projeto — é credencial de conta, usada na linha
   de comando e descartada.

6. **Depois de rodar `npm test` alguma vez, rotacionar a senha do admin.**
   Herdado do Ciclo 1a (🔍 NV5 daquela auditoria): `tests/unit/seed.test.ts`
   grava um literal versionado no `senhaHash`. Não é deste ciclo, e continua
   valendo.

## 9. NÃO VERIFICADO

Cada item sai daqui como pergunta aberta, com o comando que a fecha. Nenhum é
tratado como "ok" presumido.

| # | Item | Por que não deu | O que fecha |
| --- | --- | --- | --- |
| NV1 | O inventário de chaves JWT deste projeto (`in_use`/`standby`/`previously_used`) e se a legada foi migrada | Não há ferramenta MCP para isso e não tenho PAT | Ação do dono nº 2 |
| NV2 | Se o painel oferece opção genérica de JWKS, ou só os cinco provedores nomeados | Não tenho acesso ao painel | Ação do dono nº 4 — reportar o que o formulário mostra |
| NV3 | Se o Supabase compara `iss` quando o provider foi registrado por `jwks_url`/`custom_jwks` | A doc não diz, e o OpenAPI não expõe a regra de validação | A sonda P4-A com o token real, depois do registro. Se recusar, o payload do teste de formato nomeia o claim |
| NV4 | Se `authenticated`, com token do CRM, recebe `42501` (e não outra coisa) em tabela de tenant | Depende do registro, que é ação do dono | Sonda P4-C, Tarefa 7 do plano |
| NV5 | Se o Supabase aceita `Content-Type: application/jwk-set+json` no JWKS | Não é observável deste lado; o fetcher é dele | Não precisa fechar: a rota serve `application/json`, que é universalmente aceito. Registrado para não ser "melhorado" sem medir |
| NV6 | Se `src/app/.well-known/...` serve no Next 16.3 | Não medido, e a decisão 4.2 escolheu não depender disso | `mkdir` da rota + `npm run build` e conferir se ela aparece na lista de rotas. Só vale a pena se a URL canônica precisar mudar |
| NV7 | O que exatamente o PostgREST apertou em 2025-07-24 ("Data API v13 tightened JWT validation") | A entrada do changelog não detalha | Mitigado por processo, não por medição: o teste de formato (P1) faz um aperto futuro aparecer vermelho |

## 10. Critérios de aceite

Cada um com comando e saída colados. O que este ambiente não provar sai como
**NÃO VERIFICADO** com o comando que um humano roda.

- `jose` é dependência **direta** em `package.json` — provado por
  `node -e "console.log(require('./package.json').dependencies.jose)"`
- Importar `src/core/supabase-jwt/chave.ts` com o ambiente vazio **não lança** —
  caso de teste nomeado (é o modo de falha que derrubou o build por três dias)
- O token emitido tem **exatamente** os seis claims de 4.3 e **exatamente** os
  três campos de header — caso de teste que afirma os conjuntos, não só a
  presença
- O token verifica com a chave pública que a rota do JWKS publica, e **não**
  verifica com outra chave — dois casos
- O corpo de `GET /api/jwks` **não contém** `d` — afirmado sobre o texto
  serializado
- `GET /api/supabase/token` emite com a empresa **da sessão** mesmo quando a
  requisição carrega `companyId` em query, corpo e cabeçalho — caso de teste com
  os três ao mesmo tempo
- Sem sessão, a rota responde 401 e o corpo **não tem** campo `token`
- Estourado o teto, responde 429 e o corpo **não tem** campo `token`
- O callback do `accessToken`: 20 chamadas concorrentes produzem **uma** busca;
  dentro da validade, **zero** buscas extras; passada a margem, **uma** busca
  nova; em falha, **lança** e não memoiza a falha — quatro casos
- `auth.jwt() ->> 'company_id'` devolve a empresa do token, contra o Postgres
  real — e `auth.uid()` levanta `22P02` com o `sub` deste CRM
- O Supabase **aceita** um token do CRM (`PGRST205`) e **recusa** um assinado por
  chave aleatória (`PGRST301`) — depende da ação do dono nº 4
- Uma tabela de tenant continua **inalcançável** com token do CRM válido
  (`42501`) — depende da ação do dono nº 4
- `banco-blindado.spec.ts` passa a afirmar **zero políticas e zero grants** no
  schema `realtime`, e continua afirmando tudo o que já afirmava — nenhuma
  asserção removida ou afrouxada, provado pelo diff
- `tests/unit/catraca-prisma-cru.test.ts` verde **sem exceção nova**, e
  `npm run lint` verde com os arquivos novos em disco
- `npm run typecheck`, `npm test` e `npm run build` verdes
- `get_advisors` de segurança sem achado novo em relação à linha de base do
  Ciclo 1a: 15 × `rls_enabled_no_policy` (INFO) + 2 × WARN de `rls_auto_enable`

## 11. Riscos e dívidas que este ciclo declara

**D1 — o elo do meio fica aberto até o Ciclo 3.** Que o gateway popula
`request.jwt.claims` a partir do nosso token é dedução apoiada em duas medições
(P3 e P4-A), não medição direta. Fechá-lo exige a exceção nomeada do Ciclo 3
(§ 5.1). Registrado, não escondido.

**D2 — um provider por vez, e nada mecânico impede o contrário.** Dev e produção
compartilham o projeto Supabase; registrar os dois faz a chave da máquina de
desenvolvimento mintar token válido em produção (§ 3.3). A trava hoje é
procedimento, não código — mesma classe do ⚠️ R1 do Ciclo 1a.

**D3 — não existe revogação de token.** O Supabase verifica assinatura; não
consulta lista. Um token vazado vale até `exp` (5 minutos), e a única revogação
possível é rotacionar a chave — que leva até 30 minutos para propagar via
`jwks_url`. É o motivo de a vida ser curta.

**D4 — o custo por Third-Party MAU entra na conta.** US$ 0,00325 por MAU acima
da cota do plano (medição §2). Zero hoje, com uma empresa; deixa de ser zero
quando o multi-empresa tiver usuários de verdade.

**D5 — `src/core/supabase-jwt/access-token.ts` nasce sem consumidor.** Ele só é
ligado ao `createClient` no Ciclo 3. Está aqui, e não lá, porque as decisões que
ele encarna (margem de 60 s, trava de concorrência, lançar em vez de devolver
`null`) saem todas de medições sobre o **token**, e reencontrá-las dali a dois
ciclos é como se erra.

**D6 — herdadas e não tocadas aqui.** ⚠️ R1 (banco de teste não separado do de
dev), R2 (quatro unicidades globais), R4 (`User.papel` como espelho), R5
(`EVOLUTION_COMPANY_ID` como ponte) e R6 (`companyIdDoUsuario` por vínculo
arbitrário), todas de `docs/auditorias/2026-08-19-ciclo-1a-tenancy.md`. Nenhuma
introduzida aqui, nenhuma corrigida aqui.
