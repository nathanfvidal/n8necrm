# Auditoria de segurança — Ciclo 4 (tela Fluxos / editor n8n) do n8necrm

**Data:** 2026-08-19
**Escopo:** as 6 tarefas do Ciclo 4, `7053afb..HEAD` (branch `ciclo-4-fluxos`) — adapter HTTP do
n8n, permissões `ver_fluxos`/`gerenciar_fluxos`, server actions com auditoria, tela de lista,
tela de detalhe com iframe do editor, e `frame-src` no CSP (esta tarefa, Task 6)
**Ambiente:** leitura de código + verificação ao vivo contra `n8n.nateksoft.com`, a instância de
**produção** que atende 6 workflows reais de clientes (WhatsApp de clínica médica, barbearia e
outros). Nenhuma escrita destrutiva foi feita contra ela nesta auditoria — ver seção
"Como a verificação foi feita sem tocar produção" abaixo.

## Resumo

**❌ Críticas nesta branch: 0 · ⚠️ Riscos: 1 · ✅ Verificados: 15 · 🔍 Não verificados: 2**

Este número é sobre o que o Ciclo 4 mudou, não sobre o estado da instância. A mesma superfície
levantada para este ciclo (`docs/superpowers/specs/2026-08-19-ciclo-4-fluxos-n8n-design.md`) já
tinha registrado **quatro** achados críticos herdados da instância `n8n.nateksoft.com` — nenhum
introduzido por este ciclo, nenhum corrigido aqui, e a revisão final apontou que esta auditoria
não os citava uma vez sequer. Ver seção "Herdado, não corrigido aqui" abaixo — o `AGENTS.md` deste
projeto não permite um relatório de "Críticas: 0" sobre uma instância nessas condições.

O núcleo do ciclo — `N8N_API_KEY` nunca alcança o navegador, `ver_fluxos` (ADMIN e GESTOR) e
`gerenciar_fluxos` (só ADMIN) são checados tanto na renderização quanto em cada Server Action,
e o `frame-src` novo abre exatamente uma origem sem tocar `frame-ancestors` — está no lugar e
foi provado ao vivo nesta sessão, não só lido no código. O único risco (R1) é uma ausência, não
um defeito: as operações destrutivas de fluxo não têm teto de taxa, diferente de outras ações
sensíveis do mesmo porte já auditadas neste projeto.

---

## Como a verificação foi feita sem tocar produção

A instância n8n é compartilhada por clientes reais. Toda prova abaixo que envolve a API do n8n
foi **leitura** (`GET /workflows`, `GET /workflows/:id`) ou uma leitura seguida de **cancelamento**
explícito antes de qualquer escrita:

- O diálogo de "Desativar" foi aberto para o workflow "Atendimento - Clinica Medica (IA First)",
  o campo de confirmação foi preenchido com o nome errado e depois com o nome exato (para provar
  a régua de habilitação do botão), e o diálogo foi **cancelado** — nunca confirmado. Consultei a
  API do n8n depois: `ativo: true` continua batendo, confirmando que nada foi escrito.
- Nenhum workflow foi ativado, desativado, apagado ou reexecutado. O botão "Reexecutar" foi
  confirmado presente e habilitado para ADMIN e GESTOR só por inspeção da árvore de acessibilidade
  da página — nunca clicado.
- O login digitado no iframe do editor do n8n não foi tentado com credencial real; a prova do
  framing é a própria tela de login do n8n aparecendo dentro do iframe (ver ✅13).

---

## 1. Exposição de `N8N_API_KEY`

**Onde é lida:** só em `src/modules/automation/n8n/index.ts`, atrás de `import "server-only"` —
um import de valor desse módulo a partir de código de cliente quebra o build, não só um
descuido em runtime. A leitura é **preguiçosa** (`obterCliente()`, no primeiro uso, não no
escopo do módulo) de propósito: validar a env em tempo de build (`next build` avalia todo
módulo alcançável) foi a causa de um deploy quebrado por três dias em 2026-08-07 no módulo do
WhatsApp — o comentário em `index.ts:48-55` documenta o precedente.

**Onde ela NUNCA aparece:**

- No HTML servido de `/fluxos` e de `/fluxos/[id]?aba=editar` — grep pelos 12 primeiros
  caracteres da chave real no corpo da resposta autenticada devolveu `0` nos dois (ver ✅1, ✅2).
- Nas mensagens de erro voltadas ao usuário: `mensagemDeErro()` em `actions.ts:53-65` cita o
  **nome** da variável (`N8N_API_KEY`) quando o n8n recusa a chave, nunca o valor — o comentário
  no código é explícito sobre isso ser deliberado, não uma omissão a corrigir.
- Na URL do editor embutido: `urlEditor` (`fluxos/[id]/page.tsx:67`) é montada só com
  `N8N_API_URL` + o id do workflow. O editor autentica pelo **cookie de sessão do próprio n8n**,
  não pela chave de API — o comentário no código é explícito: "a chave nunca deve sair daqui".
- Em nenhuma resposta HTTP do CRM: a chave só viaja em header `X-N8N-API-KEY` nas chamadas
  **saindo do servidor do CRM para o n8n** (`cliente.ts:102-117`), nunca em query string
  (comentário no código cita vazamento por log de proxy/histórico como o motivo) e nunca
  ecoada de volta pelo n8n em nenhuma resposta que o CRM repasse ao navegador.

---

## 2. As duas permissões e onde cada uma é aplicada

| Permissão | Quem tem | Onde é checada |
|---|---|---|
| `ver_fluxos` | ADMIN, GESTOR | `fluxos/page.tsx:46`, `fluxos/[id]/page.tsx:32` (ambos `notFound()`, não `redirect()`), `reexecutarExecucaoAction` (`actions.ts:165`), link do menu (`painel-nav.tsx:54`) |
| `gerenciar_fluxos` | só ADMIN | `operar()` em `actions.ts:91` — guarda comum de `ativarFluxoAction`, `desativarFluxoAction`, `apagarFluxoAction` — e a prop `podeGerenciar` que decide se a coluna "Ações"/botão "Apagar fluxo" renderizam |

O ponto que a Task 3 deste ciclo corrigiu (e que a matriz atual evita repetir): `reexecutar`
exige `ver_fluxos`, não `gerenciar_fluxos` — é diagnóstico ("isso ainda quebra?"), não
destruição, e prender GESTOR fora dele tiraria a única ferramenta que ele tem para investigar um
"parou de funcionar" sem ganhar segurança nenhuma em troca (comentário em `permissions.ts:60-73`
detalha o raciocínio e o incidente que motivou a criação da permissão).

Esconder o link do menu (`painel-nav.tsx`) **não é o gate** — é só evitar ruído para quem de
qualquer forma bateria em `notFound()`. O gate real é a checagem de permissão em cada página e em
cada Server Action, porque Server Action é endpoint HTTP público, alcançável sem passar pelo menu.

---

## 3. `frame-src` no CSP (o que esta tarefa acrescentou)

```
frame-src https://n8n.nateksoft.com
```

Abre **uma única origem**: o CRM só pode embutir conteúdo de `n8n.nateksoft.com` em iframe —
qualquer outra origem embutida (por um script malicioso injetado, por exemplo) continua barrada
pelo navegador. `script-src` não foi tocado por esta mudança.

**Não é o mesmo eixo que `frame-ancestors 'none'`** (inalterado por este ciclo): `frame-src`
controla o que ESTE site pode embutir; `frame-ancestors` controla quem pode embutir ESTE site.
As duas convivem porque respondem perguntas opostas — confirmado que `frame-ancestors 'none'`
segue presente no header real (ver ✅6), então o CRM continua impossível de embutir em qualquer
página de terceiro, mesmo depois desta mudança.

---

## 4. O que o iframe do editor do n8n permite

`EditorN8n` (`components/automation/editor-n8n.tsx`) **não usa o atributo `sandbox`**, de
propósito documentado no próprio componente: o editor do n8n precisa de script, formulário,
popup de OAuth e do próprio cookie de sessão — um `sandbox` permissivo o bastante para não
quebrar isso não estaria restringindo nada de fato. A contenção real é a origem única do
`frame-src`, não um sandbox.

Não há SSO entre CRM e n8n: quem abre a aba "Editar" pela primeira vez vê a **tela de login do
próprio n8n** dentro do iframe (confirmado ao vivo, ✅13) e precisa ter (ou criar) uma conta lá.
Duas peças de infraestrutura fora do código deste repositório tornam isso possível, registradas
no spec do ciclo: o nginx da VPS troca `X-Frame-Options` por `frame-ancestors` listando a origem
do CRM, e o n8n roda com `N8N_SAMESITE_COOKIE=none` (sem isso o navegador não enviaria o cookie
de sessão do n8n em contexto de terceiro, e a tela ficaria presa no login para sempre).

**Consequência de design, não achado — mas a permissão citada abaixo estava errada nesta mesma
auditoria e foi corrigida na revisão final (achado I2):** a aba "Editar" (`fluxos/[id]/page.tsx`)
não tem gate além de `ver_fluxos` — **não** `gerenciar_fluxos`. Quem alcança o editor embutido,
uma vez autenticado no n8n dentro do iframe, é ADMIN **e GESTOR**, e tem o mesmo poder que teria
abrindo o n8n direto, fora do CRM — o CRM não adiciona nem remove capacidade dentro do editor
embutido, só decide quem chega até ele. Isso é esperado: o editor É o n8n, só reenquadrado.

Decisão do dono, registrada em comentário no próprio código junto da aba "Editar": manter ADMIN e
GESTOR é escolha consciente, não herança acidental — quem já tem conta no n8n alcança tudo isso
pelo domínio dele de qualquer forma, e o CRM só poupa um clique. A barreira real é a conta
separada do n8n, que este CRM não provisiona.

---

## 5. Auditoria de ações destrutivas (`ACOES_SENSIVEIS`)

Este ciclo somou `desativar_fluxo` e `apagar_fluxo` a `ACOES_SENSIVEIS`
(`core/audit/alerta.ts:68-69`) — cada um derruba o atendimento de um cliente inteiro, e a
instância é compartilhada por vários, exatamente o cenário que o detector de rajada existe para
pegar. `ativar_fluxo` (reparo) e `reexecutar_execucao` (diagnóstico, não destruição) ficam de
fora, por decisão documentada no comentário do próprio arquivo.

Toda chamada a `operar()` (as três ações de `gerenciar_fluxos`) e a `reexecutarExecucaoAction`
grava linha de auditoria **depois** de o n8n confirmar a operação, nunca antes — o comentário em
`actions.ts:78-82` é explícito: auditar antes produziria uma linha de "isso aconteceu" para algo
que não aconteceu, o que é pior que não auditar.

---

## ✅ Verificado e correto

| # | Item | Como foi verificado |
|---|---|---|
| 1 | `N8N_API_KEY` ausente do HTML de `/fluxos` | `curl` autenticado (sessão real de ADMIN) → corpo salvo em arquivo → `grep -c` pelos 12 primeiros caracteres da chave real → `0` |
| 2 | `N8N_API_KEY` ausente do HTML de `/fluxos/[id]?aba=editar` (a página que monta a URL do editor) | Mesmo método → `0`; a URL do editor (`n8n.nateksoft.com/workflow/<id>`) aparece no HTML, como esperado — é pública |
| 3 | Lista de fluxos bate com a API real, inclusive estado ativo/desligado | `GET /api/v1/workflows` direto na instância comparado item a item com o que a tela renderizou (Playwright) → 8 ativos + 3 desligados, mesmos nomes, mesma ordem |
| 4 | Detalhe pagina e mostra status/duração das execuções | `/fluxos/eqqEnl042R9NZN_UWToot` → 20 linhas com status `success`, duração calculada (`18 ms` a `1.0 s`) e horário real |
| 5 | Confirmação por digitação barra o botão até o nome exato | Diálogo de "Desativar" aberto → nome errado digitado → botão `[disabled]` → nome exato digitado → botão habilita (sem `disabled`) → diálogo **cancelado** |
| 6 | Cancelar não escreve nada na instância | Após o teste acima, `GET /api/v1/workflows/eqqEnl042R9NZN_UWToot` → `active: true`, sem mudança |
| 7 | VENDEDOR não vê o link "Fluxos" no menu | Sessão de VENDEDOR real (`vendedor@exemplo.com`) → menu renderizado só com Dashboard/Leads/Funil/Contatos/Tarefas/Conversas |
| 8 | VENDEDOR em `/fluxos` cai no boundary de não encontrado | Navegação real (Playwright) → conteúdo da página é "404 — This page could not be found"; ver ressalva sobre o **status HTTP** na seção "Não verificados" |
| 9 | GESTOR vê a lista completa, sem coluna "Ações" nem botões Ativar/Desativar/Apagar | Conta GESTOR criada via `/usuarios` (ADMIN), sessão real → tabela sem `columnheader "Ações"`, nenhum botão de ativar/desativar nas 11 linhas |
| 10 | GESTOR não vê "Apagar fluxo" no detalhe, mas vê "Reexecutar" habilitado | `/fluxos/eqqEnl042R9NZN_UWToot` como GESTOR → sem botão "Apagar fluxo" no cabeçalho; 20 botões "Reexecutar" presentes, nenhum `disabled` — **não clicado**, ver seção de metodologia |
| 11 | `reexecutarExecucaoAction` exige só `ver_fluxos`, não `gerenciar_fluxos` | Leitura de `actions.ts:165` + teste existente `tests/unit/automation-actions.test.ts` ("reexecutar nao exige gerenciar_fluxos, so ver_fluxos") |
| 12 | CSP real da resposta contém `frame-src` novo e `frame-ancestors 'none'` inalterado | `curl -D` autenticado em `/fluxos` → header completo capturado, ambas as diretivas presentes na mesma política |
| 13 | O iframe carrega conteúdo real do n8n (framing passou) | Screenshot da aba "Editar" → tela de login do n8n renderizada dentro do iframe; console do navegador sem nenhuma violação de `frame-src` (só ruído de extensão de dev alheia) |
| 14 | `N8N_API_URL` apontando para host inexistente não derruba a tela | Dev server reiniciado com `N8N_API_URL` sobrescrita para um host `.invalid` → `/fluxos` responde 200 com "Não foi possível falar com o n8n / A instância pode estar fora do ar ou o endereço em N8N_API_URL pode estar errado" |
| 15 | Teste novo do CSP roda sem importar `src/proxy.ts` (evita o crash conhecido de `next-auth` sob Vitest) | `npx vitest run tests/unit/proxy-matcher.test.ts` → 7/7 passam; import isolado de `src/proxy.ts` sob Vitest reproduzido e confirmado que quebra (`Cannot find module '.../next/server' imported from next-auth/lib/env.js`), justificando a técnica de extração de literal em vez de import |

---

## ⚠️ Riscos

### R1 — `ativar_fluxo`/`desativar_fluxo`/`apagar_fluxo` não têm teto de taxa

**Onde:** `src/modules/automation/actions.ts` — nenhuma das três chama `checarRateLimit` ou
equivalente, diferente do padrão que outras ações sensíveis do projeto já seguem (ex.: login).

**Impacto:** um ADMIN (ou alguém com a sessão dele) com script poderia alternar o estado de um
workflow em rajada. O detector de auditoria (`ACOES_SENSIVEIS`, seção 5) **vê** isso depois do
fato — mas nada no servidor recusa a rajada em si, e cada chamada é uma requisição real contra a
instância de produção de um cliente. A superfície é estreita (só ADMIN alcança `gerenciar_fluxos`
hoje), o que diferencia este risco de algo como R5 da auditoria de 2026-08-15 (`criar_etapa`,
alcançável por qualquer ADMIN sem teto e sem estar no detector de rajada — mesma classe).

**Correção proposta:** decisão do dono, mesmo trade-off já registrado em auditorias anteriores
deste projeto. O detector de rajada por auditoria já cobre a detecção pós-fato; um rate limit
cobriria a prevenção.

---

## ❌ Herdado, não corrigido aqui

Achado I3 da revisão final: esta auditoria cobre o que o Ciclo 4 mudou (o CRM), não o estado da
instância `n8n.nateksoft.com` em si — mas a mesma superfície levantada para este ciclo já tinha
registrado quatro achados críticos da instância, e omiti-los deste documento deixava "❌ Críticas:
0" parecer uma afirmação sobre a instância inteira, que não é. Nenhum dos quatro foi introduzido
por este ciclo nem é corrigido aqui — todos já estavam escritos em
`docs/superpowers/specs/2026-08-19-ciclo-4-fluxos-n8n-design.md`, seção "Achados fora do escopo
deste ciclo, registrados porque foram vistos", e ficam repetidos aqui só para que uma auditoria de
segurança sobre esta superfície não deixe de citá-los:

1. **`N8N_ENCRYPTION_KEY=nateksoft`.** É a chave que criptografa **todas as credenciais salvas no
   n8n** — tokens de WhatsApp, OAuth e API keys de todos os workflows de cliente. Valor adivinhável
   a partir do nome da empresa. Trocar exige reencriptar as credenciais existentes, então é
   projeto, não ajuste desta branch.
2. **Chave global da Evolution é `nateksoft`.** Cria, apaga e lê qualquer instância. Um
   `GET /instance/fetchInstances` com essa chave devolveu número de telefone e foto de perfil.
3. **Senha reusada.** `DB_POSTGRESDB_PASSWORD` do n8n é a mesma senha do projeto Supabase do CRM.
4. **O JWT da API do n8n não expira** (sem claim `exp`).

Nenhum destes quatro é corrigido nesta branch — o próprio spec já registrava que trocar a chave de
encriptação, por exemplo, exige reencriptar credenciais existentes e é projeto à parte. O ponto
deste achado é só que um relatório de "Críticas: 0" não pode ficar de pé sem citá-los, porque quem
lê só este documento sairia acreditando que a instância não tem problema crítico nenhum.

---

## 🔍 Não verificados

| # | Item | Por que não deu | O que destravaria |
|---|---|---|---|
| NV1 | Status HTTP real de `/fluxos` para VENDEDOR em **produção** (`next start`) | `next start` local nesta máquina falha o login com `UntrustedHost` (Auth.js exige `AUTH_TRUST_HOST`/`AUTH_URL` fora de `next dev`, não configurado no `.env` deste checkout) — falha de ambiente de verificação, não do código deste ciclo. Em `next dev` (o ambiente que o brief pede), o **conteúdo** da página já é o boundary de "não encontrado" correto (✅8), mas o **status HTTP** observado foi 200, não 404 — comportamento conhecido do dev server do Next.js/Turbopack para boundaries `notFound()`, não específico desta branch | Configurar `AUTH_TRUST_HOST=true` (ou `AUTH_URL`) num `.env` de teste isolado, rodar `npm run build && npm run start`, repetir o login e o `curl -o /dev/null -w "%{http_code}" /fluxos` como VENDEDOR |
| NV2 | Se algum outro ambiente/deploy já publicado tem `frame-src` divergente do `N8N_API_URL` configurado nele | Esta auditoria só cobre este checkout | Em cada ambiente: `curl -sI <url>/fluxos \| grep -i content-security` e comparar a origem em `frame-src` com o valor de `N8N_API_URL` configurado lá — precisam ser a mesma origem, senão o iframe fica em branco sem erro nenhum no servidor |

---

## Só um humano pode fazer

1. **Configurar `AUTH_TRUST_HOST`/`AUTH_URL`** se quiser reproduzir NV1 localmente — ou aceitar
   a prova de conteúdo (✅8) como suficiente, já que o `notFound()` renderiza o boundary correto e
   o comportamento de status HTTP no `next dev` é uma característica conhecida do dev server, não
   deste código.
2. **Decidir R1** — se o custo de um rate limit nas três ações de `gerenciar_fluxos` vale a pena
   frente à superfície estreita (só ADMIN chega lá hoje).
3. **Rodar NV2** contra qualquer deploy real fora deste checkout, comparando `frame-src` com
   `N8N_API_URL` configurado lá.
