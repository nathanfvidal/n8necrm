# Ciclo 4 — Fluxos n8n

Data: 2026-08-19
Status: aguardando revisão
Spec do programa: `2026-08-19-n8necrm-fundacao-design.md`

## 1. O que este ciclo entrega

Uma tela **Fluxos** no CRM que opera a instância n8n em `n8n.nateksoft.com`: lista
os workflows, mostra status e execuções, reexecuta um caso real, liga e desliga
fluxo, e embute o editor do n8n num iframe para edição de verdade.

Depende só do Ciclo 0. Não depende de multi-empresa, conexões Evolution nem chat
ao vivo, e nenhum deles depende dele.

## 2. O contexto que muda todas as decisões

**A instância não é laboratório.** Levantado em 2026-08-19, com a API pública:

- 10 workflows, **6 ativos**
- São de cliente, em produção: `Natek Soft - Atendimento WhatsApp` (64 nós),
  `Noiva Inteligente` (65 nós), `Atendimento - Clinica Medica (IA First)` (55),
  `Studio Fight`, `Barbearia BOX64`, `CineMatch`
- **Tráfego ao vivo durante o levantamento**: `Noiva Inteligente` executou 6 vezes
  em 5 minutos, modo `webhook`, todas `success`
- n8n roda em **queue mode** (`EXECUTIONS_MODE=queue`, container `n8n` + worker +
  redis), em Docker Compose **v1.29.2**

Consequência: um botão "desativar" nesta tela derruba o WhatsApp de um cliente
pagante. Toda decisão abaixo parte disso.

## 3. O que a API pública permite — verificado no OpenAPI da instância

Lido em `GET /api/v1/openapi.yml` na própria instância, não de memória.

| Ação | Endpoint | Existe |
| --- | --- | --- |
| Listar workflows | `GET /workflows` | sim |
| Ler um workflow | `GET /workflows/{id}` | sim |
| Ativar / desativar | `POST /workflows/{id}/activate` · `/deactivate` | sim |
| Criar / atualizar / apagar | `POST`/`PUT`/`DELETE /workflows` | sim |
| Listar execuções | `GET /executions` (cursor, filtro por workflow) | sim |
| Ler execução com dados | `GET /executions/{id}?includeData=true` | sim |
| **Reexecutar uma execução** | `POST /executions/{id}/retry` | sim |
| **Disparar execução nova com payload próprio** | — | **NÃO EXISTE** |

### A correção que isso força

O brainstorm do programa prometeu "disparar teste com payload de exemplo". **Isso
não é possível pela API pública.** O que existe é melhor, e o spec adota:

```yaml
/executions/{id}/retry:
  post:
    loadWorkflow: boolean
      "Whether to load the currently saved workflow to execute instead of
       the one saved at the time of the execution."
```

`retry` com `loadWorkflow: true` reexecuta **um caso real que aconteceu**, contra
a versão atual do fluxo. É um teste mais honesto que payload inventado: usa dado
que chegou de verdade, do jeito que chegou. É o botão "Testar" desta tela.

Disparar com payload arbitrário exigiria bater na URL de webhook do próprio
workflow — fora da API pública, e nesta instância significa injetar tráfego real
no fluxo de produção de um cliente. **Fora de escopo, e não por preguiça.**

## 4. Decisões travadas

1. **Módulo `automation`.** O enum de `config/client.schema.ts` já o inclui —
   nenhuma migração de schema para criar o módulo.
2. **Rota `/fluxos`**, dentro de `(painel)`, barrada por `exigirModulo("automation")`.
3. **Controle total, atrás de confirmação por digitação.** Ativar, desativar e
   apagar exigem digitar o nome exato do workflow. Decidido pelo dono do projeto
   em 2026-08-19, com o risco de produção declarado antes da escolha.
4. **Toda ação destrutiva grava em `AuditLog`.** A tabela já existe e já é usada
   pelo núcleo. Sem isso, "quem desativou o fluxo do cliente, e quando" não tem
   resposta — e com clientes reais essa pergunta vai ser feita.
5. **ADMIN apenas.** Mesmo tratamento de `/conversas/agente`. GESTOR e VENDEDOR
   nem veem o link no menu, e a rota redireciona.
6. **`N8N_API_KEY` nunca vai ao navegador.** Toda chamada à API do n8n sai do
   servidor. A chave dá poder total sobre workflows de todos os clientes.
7. **Iframe do editor**, sem SSO. O time loga no n8n uma vez, dentro do iframe.

## 5. O que já está feito na VPS

Aplicado e verificado em 2026-08-19, com backup e sem interromper tráfego:

**nginx** — `/opt/nateksoft/nginx/nateksoft.conf`, bloco `n8n.nateksoft.com`:

```diff
-    add_header X-Frame-Options "SAMEORIGIN" always;
+    add_header Content-Security-Policy "frame-ancestors 'self' http://localhost:3000" always;
```

Verificado ao vivo: `content-security-policy: frame-ancestors 'self'
http://localhost:3000`, sem `x-frame-options`. O bloco da Evolution **não** foi
tocado e segue com `SAMEORIGIN`. Execuções de cliente completaram durante o
reload (21:16:31, :44, :57, todas `success`).

Armadilha registrada: existem **dois** `nateksoft.conf`. O de
`/etc/nginx/sites-available/` é cópia velha com md5 diferente; o que vale é
`/opt/nateksoft/nginx/nateksoft.conf`, para onde o `sites-enabled` aponta e de
onde o `deploy.sh` copia. Editar o outro não faz efeito nenhum.

**n8n** — `N8N_SAMESITE_COOKIE=none` **aplicado** no serviço `n8n` do compose e
confirmado dentro do container (`docker exec n8n printenv | grep -i samesite`).
Sem ela o iframe carrega mas não autentica: o cookie de sessão do n8n é
`SameSite=lax` por padrão e o navegador não o envia em contexto de terceiro.

**Sistema** — kernel `6.8.0-124` → `6.8.0-138` (estava 14 revisões atrás, com
9 semanas sem reboot), 71 pacotes aplicados. `cloud-init` já estava em `hold` e
permaneceu em 24.1.3 — o salto para 26.1 mexe em rede no boot e é o tipo de
coisa que tranca alguém fora de uma VPS.

### Três armadilhas de infraestrutura, encontradas ao vivo

Nenhuma é do CRM. Todas custam uma tarde a quem tropeçar sem saber.

**1. `restart: always` não aplica mudança de compose.** Reiniciar a máquina
reinicia o container *existente*, com o ambiente antigo. Variável nova exige
**recriar**: `docker compose up -d --no-deps n8n`.

**2. `docker-compose` v1 quebra contra o Docker Engine 29 — e destrói antes de
falhar.** `KeyError: 'ContainerConfig'`, depois de já ter removido o container.
Derrubou o n8n por ~90s em 2026-08-19. Corrigido: Compose v2 instalado como
plugin, e `/usr/bin/docker-compose` desviado por `dpkg-divert` para um atalho
que encaminha ao v2 (original em `/usr/bin/docker-compose.v1`). O desvio
sobrevive a `apt upgrade`, ao contrário de sobrescrever o arquivo.

**3. Os scripts de deploy criavam `upstream` duplicado.** `deploy.sh` e
`deploy-auto.sh` faziam `ln -sf ... sites-enabled/nateksoft` **sem** remover o
`sites-enabled/nateksoft.conf` que já existia; os dois declaravam `upstream n8n`
e o nginx recusava a configuração inteira com `duplicate upstream`. Aconteceu ao
vivo. Corrigido nos dois scripts: um único link habilitado, apontando direto
para a fonte em `/opt`.

Ainda em aberto nesses scripts, **não corrigido**: ambos imprimem
`✅ Certificados OK` mesmo quando o certbot falha. O certificado do domínio raiz
`nateksoft.com` de fato falha ao renovar, porque o domínio aponta para o
Cloudflare e não para esta VPS — inofensivo hoje (nada aqui serve o raiz), mas a
mensagem de sucesso mentirosa esconderia um problema real. Os certificados que
importam (`n8n` e `evolution`) estavam válidos por 74 dias em 2026-08-19.

## 6. Arquitetura

Segue a fronteira que a base já impõe: `src/core/` não conhece `src/modules/`.

```text
src/modules/automation/
  n8n/
    tipos.ts        contrato: Workflow, Execucao, e a interface do cliente
    cliente.ts      adapter HTTP da API pública do n8n
    index.ts        singleton preguiçoso + validação de env
  queries.ts        leitura para as telas (server-side)
  actions.ts        server actions: ativar, desativar, apagar, reexecutar
src/app/(painel)/fluxos/
  page.tsx          lista
  [id]/page.tsx     detalhe: execuções + aba do editor
src/components/automation/
  ...               tabela, selo de status, diálogo de confirmação
```

`tipos.ts` sem `server-only` e sem `fetch`, pelo mesmo motivo de
`gateway/tipos.ts` e `fila/tipos.ts`: o adapter concreto tem que ser testável
sem variável de ambiente e sem marcação de servidor. `index.ts` valida env
**preguiçosamente** — validar em escopo de módulo já derrubou o build deste
projeto uma vez.

### Variáveis novas

- `N8N_API_URL` — `https://n8n.nateksoft.com`
- `N8N_API_KEY` — chave da API pública

Ambas entram no `.env.example` com o padrão de comentário do arquivo. Nota a
registrar lá: o JWT emitido pelo n8n **não tem claim `exp`** — não expira.
Revogar exige apagar a chave no painel do n8n.

### O que a tela mostra

**Lista** — nome, ativo/inativo, número de nós, tags, última execução com status,
e ações. **Detalhe** — execuções paginadas por cursor (status, modo, início,
duração), com "Reexecutar" por linha, e uma aba "Editar" com o iframe.

### Erro e indisponibilidade

A API do n8n é rede: pode estar fora. A tela precisa distinguir três casos e
dizer qual é — instância inalcançável, chave inválida (401), workflow sumido
(404) — em vez de mostrar lista vazia, que é indistinguível de "não há fluxos".

## 7. Segurança

**Auditoria da superfície, exigida pelo `AGENTS.md`**, antes de integrar.

- `N8N_API_KEY` só no servidor. Nenhum componente cliente a recebe, nem por prop.
- Ativar/desativar/apagar só para ADMIN, com confirmação por digitação do nome e
  registro em `AuditLog`.
- CSP do CRM ganha **`frame-src https://n8n.nateksoft.com`** e nada mais. Não
  encosta em `script-src`.
- O `frame-ancestors` do n8n lista origens concretas. Quando a Vercel tiver
  domínio, ele entra na lista e `http://localhost:3000` sai.

### Achados fora do escopo deste ciclo, registrados porque foram vistos

Nenhum é corrigido aqui. Estão escritos para não serem redescobertos:

1. **`N8N_ENCRYPTION_KEY=nateksoft`.** É a chave que criptografa **todas as
   credenciais salvas no n8n** — tokens de WhatsApp, OAuth e API keys de todos os
   workflows de cliente. Valor adivinhável a partir do nome da empresa. Trocar
   exige reencriptar as credenciais existentes, então é projeto, não ajuste.
2. **Chave global da Evolution é `nateksoft`.** Cria, apaga e lê qualquer
   instância. Um `GET /instance/fetchInstances` com essa chave devolveu número de
   telefone e foto de perfil.
3. **Senha reusada.** `DB_POSTGRESDB_PASSWORD` do n8n é a mesma senha do projeto
   Supabase do CRM.
4. **O JWT da API do n8n não expira** (sem claim `exp`).

## 8. Fora de escopo

Criar ou editar workflow pelo CRM fora do iframe; construtor visual próprio;
catálogo de templates a partir de `Bots/*.json`; SSO no iframe (exige licença
Enterprise); disparar execução com payload arbitrário; e qualquer coisa
multi-empresa, que é o Ciclo 1.

## 9. Critérios de aceite

- A lista mostra os 10 workflows reais, com o estado ativo/inativo batendo com o
  que a API devolve
- O detalhe pagina execuções e mostra status e duração
- "Reexecutar" dispara `retry` com `loadWorkflow: true` e a nova execução aparece
- Ativar/desativar exige digitar o nome e grava em `AuditLog` — provado por
  consulta à tabela, não por afirmação
- Um GESTOR não vê o link e recebe 404 ao digitar `/fluxos`
- Nenhuma resposta do servidor para o navegador contém `N8N_API_KEY` — provado
  por inspeção do HTML e do payload RSC
- Com a instância fora do ar, a tela diz que está fora do ar
- O iframe carrega o editor. Enquanto `N8N_SAMESITE_COOKIE` não for aplicada,
  carregar a **tela de login do n8n** dentro do iframe é o resultado esperado e
  já prova que o framing passou

## 10. Bloqueio herdado

Do Ciclo 0, e vale antes de qualquer deploy público: **banco de teste separado
do banco de dev.** Enquanto a suíte unitária escrever no mesmo Postgres, a senha
do admin volta a ser um literal versionado a cada `npm test`. Não bloqueia este
ciclo; bloqueia publicar.
