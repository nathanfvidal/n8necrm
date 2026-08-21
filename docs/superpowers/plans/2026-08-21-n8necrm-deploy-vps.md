# n8necrm — Deploy na VPS (systemd, nginx, certbot) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O n8necrm sai da máquina de desenvolvimento e passa a servir em `https://crm.nateksoft.com`, na mesma VPS onde já rodam n8n e Evolution, **sem derrubar nenhum dos dois**. O gatilho da fila é o worker (`fila:worker`) como serviço supervisionado, e a rota de tick HTTP fica **recusada na borda**, porque o worker é local e não precisa dela.

**Architecture:** Node 22 no host sob **systemd** (não Docker), com **diretórios de release** e um symlink `current` que faz a troca ser atômica e a reversão ser um comando. Dois serviços permanentes (`n8necrm-web`, `n8necrm-worker`) e um par timer+serviço de vigia (`n8necrm-saude`) que pergunta ao banco se a fila está parada — porque worker morto não acusa sozinho. nginx **no host** (já existe) ganha um arquivo **novo** em `sites-available`, e o arquivo que sustenta n8n e Evolution é tocado em **uma linha só**, num passo isolado e reversível. TLS por `certbot certonly --webroot`, nunca `--nginx`.

**Tech Stack:** Ubuntu 24.04 · Node 22.23.2 (host) · nginx 1.24.0 (host) · certbot 2.9.0 · systemd 255 · Next.js 16.3 · Prisma 7.9 · Postgres 17.6 no Supabase (remoto).

**Spec:** não há spec separado. **O desenho é a medição** registrada em "Linha de base medida na VPS" e em "As sete decisões" abaixo.

---

## Global Constraints

- **Idioma do código e dos comentários é português.** Comentário explica **por que**, com evidência. Nunca "o quê".
- **Provar, não presumir.** Todo item marcado ✅ carrega o comando executado e a saída obtida. O que não der para provar sai como 🔍 **NÃO VERIFICADO**, com o comando que um humano roda.
- **Nunca ler, imprimir, ecoar ou colar valor de segredo.** Nem em log, nem no relatório, nem numa saída de comando. Onde este plano manda conferir um segredo, ele confere **presença e permissão**, nunca conteúdo.
- **Nunca `set -x` num script que carrega o arquivo de ambiente.** Ele imprimiria cada valor.
- **`DATABASE_URL` na porta 6543, `DIRECT_URL` na 5432.** Trocar deixa `prisma migrate` **PENDURADO sem imprimir nada** — parece lentidão, é falha.
- **O banco é o Supabase remoto.** O container `postgres` da VPS é do n8n e **não é tocado por nada neste plano**.
- **Não derrubar container nenhum.** `n8n`, `docker-n8n-worker-1`, `evolution`, `postgres` e `redis` estão de pé há 46 h. Nenhum passo deste plano roda `docker compose down`, `docker stop` ou `docker restart`.
- **`nginx -t` antes de todo `reload`.** Sem exceção. E `systemctl reload nginx`, nunca `restart` — reload não derruba conexão em curso.
- **O worker precisa de `--conditions=react-server`.** Sem a condição, `server-only` é um `throw` na primeira linha importada e o processo morre na importação de `turno.ts`. Medido no Ciclo 2d.
- **Validar env em escopo de módulo derruba o `next build`.** `src/lib/env.ts` já valida `DATABASE_URL` e `AUTH_SECRET` no topo — por isso o build na VPS **exige** o arquivo de ambiente carregado, e falha alto e cedo se ele estiver errado. Isso é uma trava a favor, não um problema.
- **Não rodar `npm test`** (executa o seed e reescreve as senhas de `admin@exemplo.com` e `vendedor@exemplo.com`). Rodar arquivos focados com `npx vitest run <arquivo>`.
- **Nada de `vitest` em paralelo com outra execução de `vitest`.**
- **Nenhuma migração nova neste plano.** Nenhuma tarefa cria arquivo em `prisma/migrations/`. Se alguma parecer precisar, ela saiu do escopo — **pare e reporte**.
- **Nenhuma exceção nova no `eslint.config.mjs`.** A Tarefa 2 acrescenta uma função a um arquivo que **já tem** a exceção nomeada. Se o lint pedir entrada nova, **pare e reporte**.
- **Branch de trabalho: `deploy-vps`**, criada a partir de `main` (HEAD `ce46ac2`).
- Toda mensagem de commit termina com:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **Nenhum push. Nenhum PR. Nenhum merge** antes da auditoria da Tarefa 11.

### Legenda dos marcadores

| Marcador | Significa |
| --- | --- |
| 🖥️ **TOCA A VPS** | O passo altera estado na máquina `76.13.224.40`. Carrega **COMO REVERTER** escrito ali mesmo. |
| 🔑 **AÇÃO DO DONO** | O passo não avança sem uma ação humana fora deste ambiente. |
| 🔍 **NÃO VERIFICADO** | Não dá para provar daqui. Vem com o comando que um humano roda. |

---

## SE O DONO ESCOLHER OUTRO NOME QUE NÃO `crm.nateksoft.com`

**Este é o único lugar desta lista.** O plano inteiro assume `crm.nateksoft.com`. Trocar o nome muda **dez** coisas, e nada além delas:

| # | Onde | O quê |
| --- | --- | --- |
| 1 | DNS | O registro A aponta `<nome>` → `76.13.224.40` |
| 2 | `deploy/nginx/crm.nateksoft.com.fase1.conf` | nome do arquivo e a linha `server_name` |
| 3 | `deploy/nginx/crm.nateksoft.com.conf` | nome do arquivo e as **duas** linhas `server_name` (80 e 443) |
| 4 | VPS: `/etc/nginx/sites-available/` e o symlink em `sites-enabled/` | nome do arquivo nos dois lugares |
| 5 | Tarefa 9 | `certbot certonly ... -d <nome>` |
| 6 | Tarefa 10 | as duas linhas `ssl_certificate*` → `/etc/letsencrypt/live/<nome>/` |
| 7 | `/etc/n8necrm/n8necrm.env` | `AUTH_URL="https://<nome>"` |
| 8 | `/etc/n8necrm/n8necrm.env` | `SUPABASE_JWT_ISSUER="https://<nome>"` |
| 9 | VPS: `/opt/nateksoft/nginx/nateksoft.conf` (Tarefa 10) | a origem dentro de `frame-ancestors` do bloco do n8n |
| 10 | Painéis externos (Tarefa 11) | `jwks_url` no Supabase e a URL de webhook colada na Evolution |

**Nada em `src/` muda.** O `frame-src https://n8n.nateksoft.com` de `src/proxy.ts` aponta para o **n8n**, não para o CRM, e continua correto qualquer que seja o nome escolhido.

Se o nome sair de `nateksoft.com` para outro domínio, some também a única facilidade que o domínio atual dá: nenhum bloco herdado passa a valer, e a Tarefa 9 fica **mais simples**, não mais difícil.

---

## Linha de base medida na VPS em 2026-08-21 — conferir se mudou antes de começar

Acesso: `ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40`.
A chave `myp_deploy_ed25519` **não** funciona nesta máquina.

| Medida | Valor | Como |
| --- | --- | --- |
| SO | Ubuntu 24.04 | `lsb_release -a` |
| CPU / RAM | 2 vCPU · 7,8 GB (6,0 disponíveis) · 4 GB swap | `nproc`, `free -h` |
| Disco | 96 GB, **66 GB livres** | `df -h /` |
| Node no host | **v22.23.2** | `node --version` |
| npm | 10.9.8 | `npm --version` |
| git / rsync / certbot | 2.43.0 / 3.2.7 / **2.9.0** | `--version` |
| systemd | **255** | `systemctl --version` |
| Docker / Compose | 29.1.3 / v5.5.0 | `docker version` |
| nginx | **1.24.0, no HOST** (não em container) | `nginx -v`, `systemctl is-active nginx` |
| **ufw** | **INATIVO** | `ufw status` → `Status: inactive` |
| Portas 3000 e 3001 | **livres** | `ss -lntp` |
| Containers de pé (46 h) | `n8n`, `docker-n8n-worker-1`, `evolution`, `postgres` (healthy), `redis` (healthy) | `docker ps` |
| Compose deles | `/opt/nateksoft/docker/docker-compose.yml` | — |
| n8n / Evolution escutam em | `127.0.0.1:5678` / `127.0.0.1:8080` | `ss -lntp` |
| Config nginx do stack | `/opt/nateksoft/nginx/nateksoft.conf`, **symlinkada** em `sites-enabled/` | `ls -la /etc/nginx/sites-enabled/` |
| Backup dela ao lado | `nateksoft.conf.bak-20260819-211631` | — |
| Certificados | por subdomínio, **NÃO curinga**: `api.cinematchbr.com`, `api.nateksoft.com`, `chat.nateksoft.com`, `contratos.nateksoft.com`, `evolution.nateksoft.com`, `mail.cinematchbr.com`, `mail.nateksoft.com`, `n8n.nateksoft.com`, `nateksoft.com` | `ls /etc/letsencrypt/live/` |
| DNS | **não é curinga**: `n8n.nateksoft.com` → `76.13.224.40`; `crm.nateksoft.com` **não resolve** | medido em 2026-08-21 |
| Repositório | `https://github.com/nathanfvidal/n8necrm.git`, **PÚBLICO** (HTTP 200 na API sem token) | `curl -s -o /dev/null -w "%{http_code}" https://api.github.com/repos/nathanfvidal/n8necrm` |

### Três achados da medição que mudam o plano

**1. O port 80 de `crm.nateksoft.com` já é respondido hoje — com `404`.**
`/opt/nateksoft/nginx/nateksoft.conf:132-135` tem `listen 80; server_name nateksoft.com *.nateksoft.com; return 404;`. O bloco ACME (`/etc/nginx/sites-enabled/default-acme.conf`) é `listen 80 default_server` **sem `server_name`**, e na precedência do nginx o curinga `*.nateksoft.com` ganha do `default_server`. **Consequência direta: `certbot certonly --webroot` para `crm.nateksoft.com` FALHARIA hoje**, porque o desafio HTTP-01 cairia no `return 404`. Por isso a Tarefa 9 sobe um bloco de porta 80 **antes** de pedir o certificado.

**2. O port 443 de `crm.nateksoft.com` também já é respondido hoje — com o certificado errado.**
`nateksoft.conf:20-31` tem `listen 443 ssl; server_name nateksoft.com *.nateksoft.com;` servindo o certificado de `mail.nateksoft.com` e redirecionando tudo. Hoje um navegador em `https://crm.nateksoft.com` levaria erro de nome de certificado. Isso **não é um problema a resolver**: na precedência do nginx, `server_name` **exato** ganha do curinga com `*` à esquerda, independentemente da ordem dos arquivos. Um bloco nosso com `server_name crm.nateksoft.com;` assume sozinho, **sem tocar naquele arquivo**.

**3. `certbot --nginx` está PROIBIDO neste plano.**
`nateksoft.conf` já carrega marcadores `# managed by Certbot` — o plugin `--nginx` reescreve exatamente esse arquivo, que é o que mantém n8n e Evolution no ar, e é o arquivo com precedente de quebra registrado. Usar `certonly --webroot` obtém o mesmo certificado **sem que o certbot escreva uma linha de nginx**.

### Linha de base do repositório

| Medida | Valor | Como |
| --- | --- | --- |
| Branch / HEAD | `main` / `ce46ac2`, árvore limpa | `git status` |
| Unitários | **1679 passando**, 13 pulados | `docs/ESTADO.md` |
| e2e | **54 passando** | `docs/ESTADO.md` |
| `Dockerfile`, `docker-compose*`, `vercel.json`, `.dockerignore`, `.npmrc`, `.github/` | **nenhum existe** | `ls` na raiz |
| `output` em `next.config.ts` | **ausente** | `grep -n "output" next.config.ts` |
| `engines` em `package.json` | **ausente** | `grep -n engines package.json` |
| Endpoint de saúde HTTP | **NÃO EXISTE** nenhum | varredura de `src/app/api/` |
| Rotas de API | `/api/auth/*`, `/api/jwks`, `/api/queues/whatsapp-turn`, `/api/supabase/token`, `/api/whatsapp/evolution/:companyId/:token`, e `/export/leads` | — |
| `node_modules` / `.next` locais | **1,2 GB** / 851 MB | `du -sh` |
| Constantes da fila | `TEMPO_MAX_TURNO_MS=60_000` < `LEASE_DURACAO_MS=75_000` < `JOB_LEASE_MS=90_000`; `MAX_TENTATIVAS_ENTREGA=5`; `RETRY_APOS_MS=30_000`; `LOTE_MAX_PADRAO=10`; `RETENCAO_JOB_MORTO_MS=7d` | `consumidor.ts`, `postgres.ts`, `turno.ts` |

---

## As sete decisões, e o custo do que foi recusado

### Decisão 1 — **systemd no host**, não Docker

**Escolhido:** dois `systemd.service` rodando Node 22 do host.

**Por quê:**
- A política de reinício, que é o motivo mais citado para preferir Docker, o systemd entrega **igual**: `Restart=always`, `RestartSec=`, `MemoryMax=`, log em journald, `systemctl status`. Nesse quesito o Docker não compra nada.
- O Node 22.23.2 **já está no host**, e é a versão que o projeto usa. Não há passo de imagem.
- A máquina tem 2 vCPU e **cinco containers de pé**. Construir imagem ali é somar um build de camadas ao build do Next, no mesmo orçamento de CPU.
- Segredo em Docker é a parte fácil de errar: um `COPY .env` ou um `ARG` viram **camada de imagem**, permanente e legível por quem tiver a imagem. `EnvironmentFile=` do systemd lê um arquivo `0600 root:root` na hora de executar e não deixa cópia em lugar nenhum.

**O custo do que foi recusado, dito por inteiro:**
1. **Sem isolamento de runtime.** Um `apt upgrade` no host pode trocar o Node debaixo da aplicação sem rebuild nenhum. **Mitigado, não eliminado:** a Tarefa 1 põe `engines` no `package.json` e o `deploy.sh` **falha alto** se o Node major não for 22.
2. **Não é reprodutível como imagem.** O resultado do build depende do estado do host. Uma imagem seria byte-a-byte a mesma em qualquer máquina; isto não é.
3. **Foge da convenção do stack.** n8n e Evolution são containers com compose em `/opt/nateksoft/docker/`. Quem chegar depois vai procurar um compose do CRM e não achar. **Mitigado:** `docs/DEPLOY.md` (Tarefa 6) diz onde está tudo, e os arquivos de infraestrutura ficam versionados em `deploy/` no próprio repositório.
4. **Sem teto de recurso por padrão.** **Mitigado:** `MemoryMax=` nas duas units.

**Se um dia isto virar Docker**, o que sobrevive é `deploy/` inteiro menos as units; o que morre é a escolha 2 (o `standalone` passaria a valer).

### Decisão 2 — **sem `output: "standalone"`**

**Escolhido:** `next.config.ts` **não muda**. O runtime é `next start` sobre a árvore completa.

**Por quê:** `standalone` existe para **encolher o artefato** que atravessa uma fronteira — camada de imagem Docker, upload de artefato. Neste plano o build acontece **no alvo**, e o `node_modules` já está lá porque o próprio build precisou dele. O artefato não atravessa fronteira nenhuma, então `standalone` compraria zero.

**E cobraria três coisas concretas:**
1. `standalone` **não copia** `public/` nem `.next/static`. Esquecer o `cp` produz uma aplicação que sobe, responde 200 e aparece **sem CSS e sem imagem** — falha que parece deploy quebrado e é passo de cópia faltando.
2. `next start` **não é o comando** de um build standalone (`node server.js` é), então `package.json` passaria a ter dois modos de subir, e o `playwright.config.ts` — que roda `npm run build && npm run start` — teria de saber qual é qual.
3. `scripts/fila-worker.ts` **não faz parte do build do Next**. Ele precisa de `tsx` e do `src/` em disco de qualquer jeito. Um `.next/standalone` mínimo ao lado de um `node_modules` completo, exigido pelo worker, é o pior dos dois mundos.

**O custo de recusar:** cada release carrega o `node_modules` inteiro (~1,2 GB medido). Com 66 GB livres e poda em 3 releases, cabe — e a Tarefa 5 põe uma checagem de disco que **falha antes** de começar, em vez de encher o disco no meio.

### Decisão 3 — **`next build` roda NA VPS**, num diretório de release novo

**Escolhido:** o build acontece em `76.13.224.40`, dentro de `/opt/n8necrm/releases/<timestamp>-<sha>/`, enquanto o release anterior continua servindo.

**Por quê — e o motivo é a máquina de desenvolvimento ser Windows:** construir localmente e enviar o artefato atravessaria `win32` → `linux`. Isso quebra em binário nativo, não em JavaScript: `@tailwindcss/oxide`, `lightningcss` e `@next/swc-*` resolvem pacote **por plataforma**, e o cliente do Prisma é gerado para o host. Um artefato construído no Windows não sobe no Ubuntu, e o modo de falha aparece só na hora de servir.

**O custo do que foi recusado, dito por inteiro:** o build compete por CPU com n8n e Evolution na janela em que roda, numa máquina de 2 vCPU. **Três mitigações, todas no `deploy.sh`:**
1. O build roda **`nice -n 10`**: qualquer coisa que n8n ou Evolution precisem de CPU tem prioridade sobre ele.
2. O build acontece **num diretório novo**. O `current` só troca **depois** de o build ter dado certo — build que falha não derruba nada e não deixa a árvore pela metade.
3. O script exige **10 GB livres** antes de começar.

🔍 **NÃO VERIFICADO:** a duração real e o pico de memória de `next build` nesses 2 vCPU. A Tarefa 8 mede com `/usr/bin/time -v` e registra o número.

### Decisão 4 — **o worker**

**Escolhido:** `n8necrm-worker.service`, `Restart=always`, `RestartSec=10`, **`StartLimitIntervalSec=0`**, mais um par `n8necrm-saude.timer` + `.service` a cada 5 minutos que **pergunta ao banco** se a fila está parada.

**Como ele reinicia:** systemd o levanta 10 s depois de qualquer saída. `StartLimitIntervalSec=0` é a linha que mais importa e a menos óbvia: **no padrão do systemd, 5 reinícios em 10 s põem a unit em `failed` e ela para de tentar para sempre.** Para o servidor web isso seria visível (o site cai). Para o worker seria a falha exata que o `.env.example` chama de pior modo possível: mensagem entra, vira linha em `TurnoJob`, e **ninguém nunca responde, sem erro em lugar nenhum**. Desligar o limite troca "desiste calado" por "insiste para sempre", e o `RestartSec=10` limita a insistência a 6 tentativas por minuto.

**Como se sabe que está vivo:** `systemctl is-active` responde só "o processo existe" — um worker travado numa consulta pendurada responde `active` e não drena nada. Por isso a vigia **não olha para o processo, olha para o efeito**: `medirSaudeDaFila()` conta os jobs prontos e parados e mede a idade do mais velho. Fila parada há mais de 5 minutos é falha, com worker vivo ou morto. `FILA_SAUDE_ALERTA_URL` — opcional, e o lugar natural dela é um webhook do **n8n que já roda nesta mesma máquina** — é o que fecha o laço; sem ela o alarme existe só em `journalctl` e em `systemctl --failed`, onde ninguém está olhando.

**Se ele morrer no meio de um turno — o que o lease COBRE:**
- A reivindicação grava `leaseAte = agora + JOB_LEASE_MS` (**90 s**) e `reivindicarJob` já trata `leaseAte < agora` como reivindicável de novo. **Não há job preso:** ele volta sozinho em no máximo 90 s.
- O `UPDATE` condicional é atômico e `concluirJob` só apaga `where: { id, leaseAte: <token> }`. Um worker lento que ressuscite **depois** do lease vencer é cercado pelo token e devolve `false` em vez de apagar o trabalho de outro.
- `tentativasEntrega` sobe **na reivindicação**, então job envenenado morre na 5ª entrega (`MAX_TENTATIVAS_ENTREGA = 5`) em vez de girar para sempre.

**O que o lease NÃO cobre — e é o que precisa estar escrito:**
- **Se NENHUM worker estiver vivo, o lease não faz nada.** Ele governa a redistribuição entre consumidores; sem consumidor, a fila só enche. É exatamente por isso que a vigia da Tarefa 2 existe.
- **Efeito colateral já cometido não volta atrás.** Se o processo morrer **depois** de a Evolution ter aceitado o envio e **antes** de `concluirJob`, o lease reentrega o job e o cliente pode receber a resposta **duas vezes**. 🔍 **NÃO VERIFICADO:** se `turno.ts` grava a mensagem de saída antes ou depois do envio, e se essa gravação torna a repetição inofensiva. A Tarefa 2 **lê `turno.ts` e responde isto por escrito**, sem alterar comportamento nenhum.
- **Custo aceito, medido:** matar o worker custa até 90 s de espera para aquela conversa, mais uma tentativa de entrega das 5.

**O agendador foi recusado** (`pg_cron`, `cron`+`curl`, workflow do n8n). Custo do recusado: um cron de um minuto entrega a resposta em até ~68 s contra os ~8-10 s do worker, e — o que pesa mais — **manteria a rota `/api/queues/whatsapp-turn` obrigatoriamente aberta**, quando a Decisão 5 a fecha na borda.

### Decisão 5 — `IP_CABECALHO_CONFIAVEL`

**Valor exato:**

```
IP_CABECALHO_CONFIAVEL="x-real-ip"
```

**Linha exata do nginx** (Tarefa 10, dentro do `location /` do bloco 443 do CRM):

```nginx
        proxy_set_header X-Real-IP $remote_addr;
```

**Por que `X-Forwarded-For` sozinho não serve.** As duas linhas parecem irmãs e não são:

| Linha | O que faz com o que o cliente mandou |
| --- | --- |
| `proxy_set_header X-Real-IP $remote_addr;` | **descarta** e escreve o IP do socket |
| `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` | **preserva e anexa**: vira `<o que o cliente mandou>, <IP do socket>` |

E `src/lib/ip.ts:99-102` lê **o primeiro item da lista**:

```ts
function primeiroDaLista(valor: string | null): string | null {
  const primeiro = valor?.split(",")[0]?.trim();
  return primeiro ? primeiro : null;
}
```

Então `IP_CABECALHO_CONFIAVEL="x-forwarded-for"` faria o CRM ler **o valor que o atacante escreveu**, com aparência perfeita de configuração correta. As três consequências concretas: `AuditLog.ip` passa a guardar IP **forjado** (pior que nulo — nulo é ausência de informação, forjado é informação falsa apontando para a pessoa errada); `checarLimiteLogin` passa a ser contornável trocando o cabeçalho a cada tentativa; e o balde do webhook idem. É a aparência de segurança em vez dela.

**A trava que sustenta a escolha, e ela é medida:** `ufw` está **INATIVO** nesta VPS. Se `next start` escutasse em `0.0.0.0:3000`, qualquer um na internet falaria com a aplicação **direto**, sem passar pelo nginx, e mandaria o `X-Real-IP` que quisesse — a sobrescrita da borda viraria decoração. Por isso as duas units usam **`-H 127.0.0.1`**, que é a mesma postura de n8n (`127.0.0.1:5678`) e Evolution (`127.0.0.1:8080`) nesta máquina. A Tarefa 8 **prova** isso com `ss -lntp` e com um `curl` do IP público.

**Limite conhecido, dito em voz alta.** Com `x-real-ip` valendo, o webhook passa a limitar por IP (600 req / 60 s, `route.ts:97`) em vez de por empresa. A Evolution roda **nesta mesma máquina**, então **todo** tráfego de webhook chega de um único IP e divide **um balde só entre todas as empresas**. 600/min é folgado para o porte deste CRM, mas é um teto compartilhado e não estava lá antes. 🔍 **NÃO VERIFICADO:** o valor de `$remote_addr` que a Evolution em container apresenta ao nginx do host. A Tarefa 11 mede com `journalctl` durante um webhook real e registra o número.

### Decisão 6 — os segredos na VPS

**Onde:** um arquivo só, **fora** dos diretórios de release:

```
/etc/n8necrm/n8necrm.env     root:root   0600
/etc/n8necrm/                root:root   0700
```

**Por que fora do release:** um `rm -rf` de poda, um rollback ou um `git archive` novo não podem alcançá-lo. E como ele nunca está dentro da árvore do repositório, não existe o caminho em que um `git add -A` o comita.

**Como ele chega ao processo:** `EnvironmentFile=/etc/n8necrm/n8necrm.env` nas duas units. O systemd o lê como root no momento de executar e entrega o ambiente ao processo já rebaixado para o usuário `n8necrm`.

**Como não vaza:**
- **Para imagem Docker:** não existe imagem (Decisão 1).
- **Para o repositório:** o `deploy.sh` **falha** se encontrar um `.env` dentro do release. Duas fontes de verdade para segredo é a falha que este projeto já catalogou — e um `.env` no release seria lido pelo Next **em vez** do `EnvironmentFile`, silenciosamente.
- **Para log:** nenhum script deste plano usa `set -x`, nenhum roda `env`, `printenv` ou `cat` no arquivo. Onde o plano confere o arquivo, ele confere **modo e lista de nomes de variável**, nunca valor (`cut -d= -f1`).
- **Para `systemctl show`:** o conteúdo de `EnvironmentFile=` **não** aparece na saída de `systemctl show` (só o caminho do arquivo). A Tarefa 7 **prova** isso rodando o comando e mostrando que nenhum valor aparece.
- **Para outro usuário do sistema:** `/proc/<pid>/environ` é legível só pelo dono do processo e pelo root.
- **Para o Sentry:** `SENTRY_DEBUG` fica **vazio**, como o `.env.example` manda.

**As variáveis, e por que cada uma:**

| Variável | Sem ela | Valor nesta VPS |
| --- | --- | --- |
| `DATABASE_URL` | build **não passa** (`src/lib/env.ts` valida no topo) | pooler Supabase **:6543** |
| `DIRECT_URL` | `prisma migrate deploy` **pendura sem imprimir nada** | pooler Supabase **:5432** |
| `AUTH_SECRET` | build **não passa** (mínimo 32 caracteres) | `openssl rand -base64 32` |
| **`AUTH_URL`** | **o login inteiro quebra** com `UntrustedHost` — ver Tarefa 1 | `https://crm.nateksoft.com` |
| **`AUTH_TRUST_HOST`** | idem — ver Tarefa 1 | `true` |
| `COFRE_CHAVE_MESTRA` | **o WhatsApp inteiro não sobe**: não decifra a apikey da conexão | `openssl rand -base64 32` |
| `WHATSAPP_QUEUE_SECRET` | única defesa da rota de tick | `openssl rand -hex 32` |
| `SUPABASE_JWT_PRIVATE_JWK` | `/api/supabase/token` não assina | `npx tsx scripts/gerar-chave-jwt-supabase.ts` |
| `SUPABASE_JWT_ISSUER` | claim `iss` errado; sem padrão de propósito | `https://crm.nateksoft.com` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY` | Supabase indisponível | painel do projeto |
| `IP_CABECALHO_CONFIAVEL` | sem limite por IP no login, `AuditLog.ip` nulo | `x-real-ip` (Decisão 5) |
| `SENTRY_ENVIRONMENT` | **todo evento de produção é rotulado `local`** | `production` |
| `SENTRY_DSN` | opcional; sem ela nada é inicializado | do painel, ou vazio |
| `OPENAI_API_KEY` | o atendente não responde | do painel |
| `N8N_API_URL`, `N8N_API_KEY` | `/fluxos` não lista workflow | `https://n8n.nateksoft.com` + chave |
| `RESEND_API_KEY` | opcional; só notificação in-app | do painel, ou vazio |
| `FILA_SAUDE_ALERTA_URL` | opcional; o alarme fica só em journald | webhook do n8n local |

**Fora do arquivo, de propósito:** `SEED_PASSWORD` e `E2E_SENHA`. Produção não roda seed nem suíte e2e, e uma variável presente é uma variável que alguém um dia usa.

### Decisão 7 — como se atualiza depois, e onde entra `prisma migrate deploy`

Um script: `/opt/n8necrm/deploy.sh <ref>` (versionado em `deploy/deploy.sh`). **A ordem é a decisão**, e ela é esta:

```
 1. checagens que falham cedo   root · env 0600 · Node major 22 · >=10 GB livres
 2. carrega o ambiente          set -a ; . /etc/n8necrm/n8necrm.env ; set +a
 3. git fetch                   no espelho /opt/n8necrm/repo
 4. extrai o release novo       git archive <sha> -> releases/<ts>-<sha7>
 5. guarda anti-.env            falha se houver .env dentro do release
 6. npm ci                      COM devDependencies (o build precisa; o worker precisa de tsx)
 7. nice -n 10 npm run build    <- o release ANTERIOR ainda esta servindo
 8. prisma migrate deploy       <- AQUI
 9. ln -sfn <novo> current      troca atomica
10. systemctl restart web+worker
11. fumaca: /login devolve 200  30 tentativas x 2 s
12. se a fumaca falhar          symlink volta, restart, exit 1
13. poda                        mantem as 3 releases mais novas
```

**Por que a migração entra no passo 8, e não antes nem depois:**

- **Depois do `npm ci` (6)** porque `prisma migrate deploy` precisa do CLI e do cliente gerado, que só existem depois da instalação.
- **Depois do build (7)** porque migrar para um build que vai falhar altera o banco por nada. Build falhando no passo 7 aborta com o banco **intacto** e o release anterior servindo.
- **Antes da troca (9)** porque o código novo pode depender de coluna nova. Trocar primeiro e migrar depois abre uma janela em que o código novo consulta coluna que ainda não existe.
- **A consequência que precisa estar escrita:** entre 8 e 10, o código **ANTIGO** está rodando contra o schema **NOVO**. Isso obriga toda migração a ser compatível com a versão anterior — que é a disciplina **expande → migra → contrai** que este projeto já usa desde o Ciclo 2d. Uma migração destrutiva (DROP de coluna que o código antigo lê) derruba o CRM nessa janela de segundos. **Não há atalho:** contrair é sempre um deploy separado do que parou de usar a coluna.
- **A migração NÃO é revertida pelo rollback do passo 12**, e isso é deliberado: o Prisma não tem migração de volta, e reverter schema automaticamente perderia dado. O rollback devolve **código**; o schema fica adiante. É outra razão para a migração ser sempre compatível com a versão anterior.

**Reverter, à mão, a qualquer momento** — está impresso pelo próprio script no fim de cada execução:

```bash
ls -1dt /opt/n8necrm/releases/*/            # o segundo da lista é o anterior
ln -sfn /opt/n8necrm/releases/<anterior> /opt/n8necrm/current
systemctl restart n8necrm-web n8necrm-worker
```

---

## Ações do dono

| # | Ação | Trava qual tarefa | Já pedida? |
| --- | --- | --- | --- |
| 1 | Criar o **registro A `crm` → `76.13.224.40`** | **9** e **10** | **sim**, em andamento |
| 2 | Fornecer os **valores dos segredos** para `/etc/n8necrm/n8necrm.env` | **7** | não |
| 3 | Apontar o **`jwks_url` do Supabase** para `https://crm.nateksoft.com/api/jwks` | **11** | não |
| 4 | Colar a **URL de webhook** que o CRM devolve no painel da Evolution | **11** | não |
| 5 | Decidir se o **repositório continua público** | nenhuma | não |
| 6 | **Aprovar o relatório de auditoria** da Tarefa 11 | integração | não |

**Ação 5, dita por inteiro:** `https://github.com/nathanfvidal/n8necrm` responde HTTP 200 sem token — é **público**. Nenhum segredo está lá (`.env` é ignorado e este plano nunca o comita), mas o `deploy/` que este plano cria publica caminho de arquivo de ambiente, porta interna, nome de unit e o desenho do nginx. Nada disso é uma chave; tudo isso é reconhecimento. É decisão do dono, não bloqueia nada, e o plano **não põe valor nenhum de segredo em `deploy/`** — só nomes de variável e marcadores.

**Ações 3 e 4 não bloqueiam o CRM subir.** Sem a 3, o caminho do navegador ao Supabase (Ciclo 1b) não autentica — o painel funciona pelo caminho do Prisma. Sem a 4, o WhatsApp não recebe mensagem. As duas são de ativação, não de instalação, e por isso vivem na Tarefa 11.

---

## Ordem, e por que ela é esta

**Nada que dependa de DNS vem antes do que não depende.** O dono está criando o registro agora; o repositório avança em paralelo.

| Tarefa | Toca a VPS? | Depende de DNS? | Depende do dono? |
| --- | --- | --- | --- |
| 1 `AUTH_URL` e `engines` | não | não | não |
| 2 Vigia da fila (`medirSaudeDaFila` + script) | não | não | não |
| 3 As units do systemd | não | não | não |
| 4 Os dois arquivos de nginx | não | não | não |
| 5 `deploy.sh` e `bootstrap.sh` | não | não | não |
| 6 `docs/DEPLOY.md` e `ESTADO.md` | não | não | não |
| 7 🖥️ Bootstrap da VPS | **sim** | não | **sim** (segredos) |
| 8 🖥️ Primeiro release em `127.0.0.1:3000` | **sim** | **não** | não |
| 9 🖥️ Porta 80 e certificado | **sim** | **SIM** | **sim** (DNS) |
| 10 🖥️ Porta 443, e a linha do CSP | **sim** | **SIM** | não |
| 11 🖥️ Ativação e verificação final | **sim** | **SIM** | **sim** (3, 4, 6) |

As Tarefas **1 a 6 não tocam a VPS** e podem ser executadas inteiras enquanto o DNS propaga. A Tarefa **8 sobe o CRM funcionando e verificado em `127.0.0.1:3000` sem nenhum DNS** — o teste real do build, da migração e das duas units acontece **antes** de qualquer nome resolver, o que separa "a aplicação não sobe" de "o nome não chega".

---

### Task 1: `AUTH_URL`/`AUTH_TRUST_HOST` — a variável que quebra o login inteiro, e o `engines`

🖥️ **TOCA A VPS:** não. **AÇÃO DO DONO:** não.

**Por que esta é a Tarefa 1.** `playwright.config.ts:55-76` sobe o servidor com `env: { AUTH_TRUST_HOST: "true" }`, e o comentário ali (linhas 60-72) explica: sob `NODE_ENV=production`, o Auth.js v5 recusa a requisição com `UntrustedHost` se não confiar no host. `next start` roda com `NODE_ENV=production`. **Essa variável não está no `.env.example`** — está escondida numa configuração de teste. Deployar sem ela produz um CRM que sobe, responde, mostra a tela de login, e **falha em todo login** com um erro que não nomeia a causa. É o defeito mais caro deste plano e ele custa duas linhas de arquivo de ambiente.

**Files:**
- Modify: `.env.example`
- Modify: `package.json`
- Modify: `tests/unit/supabase-jwt-chave.test.ts` (é o arquivo que já varre `.env.example` como texto cru)

**Interfaces:**
- Consumes: `.env.example` como texto cru (padrão já existente em `tests/unit/supabase-jwt-chave.test.ts`).
- Produces:
  - bloco `AUTH_URL` + `AUTH_TRUST_HOST` no `.env.example`
  - `package.json` com `"engines": { "node": ">=22.18.0 <23" }`
  - dois casos de teste novos que travam as duas coisas

- [ ] **Step 1: Criar a branch e medir**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git checkout -b deploy-vps
git log --oneline -1
grep -n "AUTH_TRUST_HOST\|AUTH_URL" .env.example playwright.config.ts src/ -r
grep -n "engines" package.json
```

Esperado: HEAD em `ce46ac2`; `AUTH_TRUST_HOST` aparecendo **só** em `playwright.config.ts`; **nenhuma** ocorrência em `.env.example` nem em `src/`; nenhum `engines`. Se `.env.example` já tiver as variáveis, **pare e reporte** — a premissa desta tarefa caiu. Cole a saída.

- [ ] **Step 2: Escrever os casos que falham (RED)**

Em `tests/unit/supabase-jwt-chave.test.ts`, dentro do bloco que já lê o `.env.example` como texto, acrescentar:

```ts
  it("`.env.example` documenta AUTH_URL e AUTH_TRUST_HOST — sem elas o login inteiro quebra", () => {
    // Achado do deploy de 2026-08-21: `playwright.config.ts` sobe o servidor
    // com AUTH_TRUST_HOST="true" e o comentário de lá explica por quê — sob
    // NODE_ENV=production o Auth.js v5 recusa com `UntrustedHost`. `next
    // start` roda com NODE_ENV=production. A variável existia SÓ na
    // configuração de teste, então um deploy novo herdava um CRM que sobe,
    // responde, mostra o formulário e falha em TODO login.
    //
    // Este caso trava a documentação, não o comportamento: quem faz o deploy
    // lê o .env.example, e o que não estiver lá não é configurado.
    expect(texto).toMatch(/^AUTH_URL=/m);
    expect(texto).toMatch(/^AUTH_TRUST_HOST=/m);
  });

  it("o comentário de AUTH_URL nomeia o erro que aparece sem ela", () => {
    // "UntrustedHost" é a string que a pessoa vai colar num buscador às 2 da
    // manhã. Um comentário que diga "configure a URL" e não diga o nome do
    // erro não a leva de volta a este arquivo.
    expect(texto).toContain("UntrustedHost");
  });

  it("package.json declara `engines` — o host não tem isolamento de runtime", () => {
    // Deploy por systemd no host (não Docker): um `apt upgrade` pode trocar o
    // Node debaixo da aplicação sem rebuild nenhum. `engines` é metade da
    // defesa (npm avisa); a outra metade é a checagem dura em
    // `deploy/deploy.sh`, que FALHA se o major não for 22.
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.engines?.node).toBe(">=22.18.0 <23");
  });
```

⚠️ Se o nome da variável que guarda o texto do `.env.example` naquele arquivo **não** for `texto`, use o nome real — **leia o arquivo antes**. E se `readFileSync` ainda não estiver importado ali, acrescente o import.

- [ ] **Step 3: Rodar para ver falhar**

```bash
npx vitest run tests/unit/supabase-jwt-chave.test.ts
```

Esperado: **FAIL** nos três casos novos, e **PASS** em todos os que já existiam. Cole a saída. Se algum caso antigo quebrar, **pare e reporte** — significa que o import ou a variável foi mexida errado.

- [ ] **Step 4: O bloco do `.env.example`**

Acrescentar ao `.env.example`, **logo depois** da linha `AUTH_SECRET=...`:

```
# --- A ORIGEM PÚBLICA, e o erro que aparece sem ela ------------------------

# URL pública completa deste deploy, com esquema e sem barra no final.
#
# LEIA ISTO ANTES DE PUBLICAR. Sem AUTH_URL e AUTH_TRUST_HOST, o CRM sobe,
# responde, desenha o formulário de login e falha em TODO login com
# `UntrustedHost`. Nada na tela diz isso; o erro sai no log do servidor. É a
# falha mais cara deste projeto por linha de configuração.
#
# Por que ela some em desenvolvimento: o Auth.js v5 só faz essa checagem sob
# NODE_ENV=production. `next dev` não passa por ali. `next start` SIM -- e é
# `next start` que serve em produção. A suíte e2e já sabia disso desde
# 2026-08: `playwright.config.ts` passa AUTH_TRUST_HOST="true" ao subir o
# build de produção, e o comentário de lá avisa que um deploy real precisa
# configurar o host de verdade. Este bloco existe porque aquele aviso morava
# num arquivo de teste, onde quem faz deploy não olha.
#
# As duas juntas, e não uma só: AUTH_URL diz QUAL é a origem (e é ela que
# monta o `redirect_uri` e a URL de callback), AUTH_TRUST_HOST autoriza o
# Auth.js a operar atrás de um proxy reverso que reescreve o Host.
AUTH_URL="http://localhost:3000"
AUTH_TRUST_HOST="true"

# Por que confiar no Host não é um buraco AQUI, e seria em outro lugar:
# confiar cegamente no cabeçalho Host permite envenenamento de Host quando
# qualquer Host chega ao servidor. Na VPS isso está fechado por baixo -- o
# bloco do nginx casa `server_name` EXATO, então requisição com Host
# arbitrário nem alcança este processo (ver
# docs/superpowers/plans/2026-08-21-n8necrm-deploy-vps.md, Decisão 5). Numa
# hospedagem sem essa garantia, AUTH_URL sozinha é a postura correta.
```

- [ ] **Step 5: O `engines` do `package.json`**

Acrescentar, **entre** `"private": true,` e `"scripts": {`:

```json
  "engines": {
    "node": ">=22.18.0 <23"
  },
```

**Por que este intervalo, e não `>=22`:** o piso é a menor versão 22 em que este projeto já rodou com `next start` e `--conditions=react-server` sem incidente; o teto exclui o major 23 porque nada aqui foi exercitado nele. O host mede **v22.23.2** e a máquina de desenvolvimento **v22.21.0** — as duas passam, e é isso que se quer: a trava não pode inventar trabalho hoje.

**Sem `.npmrc` com `engine-strict=true`, de propósito.** Ele transformaria o aviso num erro de `npm ci` **em toda máquina**, inclusive na de quem clona o repositório para olhar. A trava dura vive onde ela importa — em `deploy/deploy.sh` (Tarefa 5), com mensagem escrita por nós.

- [ ] **Step 6: Rodar para ver passar (GREEN)**

```bash
npx vitest run tests/unit/supabase-jwt-chave.test.ts
npm run typecheck
npm run lint
```

Esperado: tudo verde, zero falhas, e a contagem de casos daquele arquivo **três a mais** do que no Step 3. Cole as três saídas.

⚠️ **Não rode `npm test`.**

- [ ] **Step 7: Commit**

```
fix(deploy): AUTH_URL e AUTH_TRUST_HOST saem do arquivo de teste

O aviso morava em playwright.config.ts, onde quem faz deploy nao olha.
Sem as duas, `next start` sobe, desenha o formulario e falha em TODO
login com UntrustedHost -- erro que so aparece no log do servidor. `next
dev` nunca passa por essa checagem, entao a falha e invisivel ate o dia
da publicacao.

`engines` entra junto porque o deploy escolhido e systemd no host, sem
isolamento de runtime: um apt upgrade troca o Node debaixo da aplicacao
sem rebuild. Aqui e so o aviso do npm; a trava dura fica no deploy.sh.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

### Task 2: A vigia da fila — `medirSaudeDaFila()` e `scripts/fila-saude.ts`

🖥️ **TOCA A VPS:** não. **AÇÃO DO DONO:** não para existir; **sim** para ligar `FILA_SAUDE_ALERTA_URL`.

**Por que ela existe.** `systemctl is-active` responde "o processo existe", e um worker travado numa consulta pendurada responde `active` sem drenar nada. A pergunta que importa não é "o processo está vivo?", é "**a fila está andando?**". Esta tarefa cria quem faz essa pergunta ao banco.

**Files:**
- Modify: `src/modules/whatsapp/fila/postgres.ts`
- Create: `scripts/fila-saude.ts`
- Create: `tests/unit/fila-saude.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `prisma` (`@/lib/prisma`); a exceção **já existente** de `no-restricted-syntax`/prisma cru que cobre `fila/postgres.ts` no `eslint.config.mjs`.
- Produces:
  - `export interface SaudeDaFila { prontos: number; idadeDoMaisVelhoMs: number | null; mortosRecentes: number }`
  - `export async function medirSaudeDaFila(): Promise<SaudeDaFila>`
  - `export const LIMIAR_FILA_PARADA_MS = 5 * 60_000`
  - script `scripts/fila-saude.ts`, saída `0` = saudável, `1` = fila parada, `2` = erro de infraestrutura

- [ ] **Step 1: Ler antes de escrever, e responder a pergunta em aberto**

```bash
sed -n '1,120p' src/modules/whatsapp/fila/postgres.ts
grep -n "EXCECAO_PERMANENTE" -A 40 eslint.config.mjs | grep -n "fila/postgres"
grep -n "enviar\|concluirJob\|registrarMensagem\|gateway" src/modules/whatsapp/turno.ts
```

Três coisas a apurar, e **as três entram no relatório da tarefa por escrito**:

1. Que a exceção do prisma cru **já cobre** `fila/postgres.ts`. Se não cobrir, **pare e reporte** — este plano proíbe exceção nova.
2. O nome exato dos campos de `TurnoJob` (`mortoEm`, `disponivelEm`, `leaseAte`, `criadoEm`) como o Prisma os expõe.
3. **A pergunta em aberto da Decisão 4:** em `turno.ts`, a mensagem de saída é gravada **antes** ou **depois** de o gateway aceitar o envio? Disso depende se uma reentrega por lease vencido pode mandar a mesma resposta duas vezes ao cliente. **Responda por escrito, com o número da linha. NÃO altere o comportamento** — se houver defeito, ele é de outro ciclo e vai para o relatório, não para esta branch.

- [ ] **Step 2: Escrever os casos que falham (RED)**

Criar `tests/unit/fila-saude.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * A vigia é testada com o Prisma MOCKADO, não contra o banco.
 *
 * O que se está afirmando aqui é a REGRA — "fila parada há mais de
 * LIMIAR_FILA_PARADA_MS é falha" —, e regra se prova com entradas escolhidas.
 * Ir ao banco exigiria fabricar jobs velhos num Postgres COMPARTILHADO com o
 * desenvolvimento (é o mesmo banco, ver docs/ESTADO.md), e o teste que fabrica
 * job velho numa fila real é o teste que a vigia depois acusa como incidente.
 */
const contar = vi.fn();
const primeiro = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    turnoJob: {
      count: (...args: unknown[]) => contar(...args),
      findFirst: (...args: unknown[]) => primeiro(...args),
    },
  },
}));

describe("medirSaudeDaFila", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T12:00:00.000Z"));
    contar.mockReset();
    primeiro.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fila vazia devolve idade nula — e nulo NÃO é falha", async () => {
    // Distinção que a vigia precisa acertar: "nada para fazer" e "não está
    // fazendo" têm a mesma aparência numa contagem só. Fila vazia é o estado
    // NORMAL de um CRM pequeno na madrugada, e uma vigia que alarme nisso é
    // desligada na primeira semana — depois disso ela não protege mais nada.
    const { medirSaudeDaFila } = await import("@/modules/whatsapp/fila/postgres");
    contar.mockResolvedValue(0);
    primeiro.mockResolvedValue(null);

    const saude = await medirSaudeDaFila();

    expect(saude.prontos).toBe(0);
    expect(saude.idadeDoMaisVelhoMs).toBeNull();
  });

  it("mede a idade do job pronto MAIS VELHO, não a média nem a do mais novo", async () => {
    // A média esconde exatamente o caso que interessa: 99 jobs de 1 s e um de
    // 40 min dão média de 24 s. É o mais velho que diz há quanto tempo
    // ninguém drena.
    const { medirSaudeDaFila } = await import("@/modules/whatsapp/fila/postgres");
    contar.mockResolvedValue(100);
    primeiro.mockResolvedValue({ criadoEm: new Date("2026-08-21T11:20:00.000Z") });

    const saude = await medirSaudeDaFila();

    expect(saude.idadeDoMaisVelhoMs).toBe(40 * 60_000);
    expect(primeiro).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { criadoEm: "asc" } })
    );
  });

  it("só conta job PRONTO: morto não conta, e lease vivo não conta", async () => {
    // Job com lease vivo está sendo trabalhado AGORA — contá-lo faria a vigia
    // acusar o worker justamente enquanto ele trabalha. Job morto já saiu da
    // fila por decisão (5 entregas) e fica 7 dias só para diagnóstico; contá-lo
    // deixaria a vigia em falha permanente por uma semana depois de um único
    // job envenenado.
    const { medirSaudeDaFila } = await import("@/modules/whatsapp/fila/postgres");
    contar.mockResolvedValue(0);
    primeiro.mockResolvedValue(null);

    await medirSaudeDaFila();

    const onde = contar.mock.calls[0]?.[0]?.where;
    expect(onde.mortoEm).toEqual(null);
    expect(onde.disponivelEm).toEqual({ lte: new Date("2026-08-21T12:00:00.000Z") });
    expect(onde.OR).toEqual([
      { leaseAte: null },
      { leaseAte: { lt: new Date("2026-08-21T12:00:00.000Z") } },
    ]);
  });

  it("o limiar é 5 min, e é MAIOR que o pior caso de um turno legítimo", async () => {
    // Se o limiar fosse menor que o tempo que um turno legítimo pode demorar,
    // a vigia acusaria trabalho normal. O pior caso legítimo é
    // TEMPO_MAX_TURNO_MS (60s) mais RETRY_APOS_MS (30s) por reentrega, e o
    // limiar precisa ficar acima disso com folga.
    const { LIMIAR_FILA_PARADA_MS, RETRY_APOS_MS } = await import(
      "@/modules/whatsapp/fila/postgres"
    );
    const { TEMPO_MAX_TURNO_MS } = await import("@/modules/whatsapp/fila/consumidor");

    expect(LIMIAR_FILA_PARADA_MS).toBe(5 * 60_000);
    expect(LIMIAR_FILA_PARADA_MS).toBeGreaterThan(TEMPO_MAX_TURNO_MS + RETRY_APOS_MS);
  });
});
```

⚠️ Se `RETRY_APOS_MS` **não** for exportado por `postgres.ts`, exporte-o nesta tarefa (é uma constante, não muda comportamento). Se `TEMPO_MAX_TURNO_MS` não estiver exportado, **pare e reporte** — a Tarefa 4 do Ciclo 2d afirma que está.

- [ ] **Step 3: Rodar para ver falhar**

```bash
npx vitest run tests/unit/fila-saude.test.ts
```

Esperado: **FAIL**, `medirSaudeDaFila is not a function` (ou erro de import). Cole a saída.

- [ ] **Step 4: A função, no arquivo que já tem a exceção**

Acrescentar ao **fim** de `src/modules/whatsapp/fila/postgres.ts`:

```ts
/**
 * Há quanto tempo a fila pode ficar parada antes de isso ser FALHA.
 *
 * O piso não é arbitrário: um turno legítimo pode consumir `TEMPO_MAX_TURNO_MS`
 * (60s) e ser reentregue depois de `RETRY_APOS_MS` (30s). Um limiar abaixo
 * disso acusaria trabalho normal, e uma vigia que dá alarme falso é uma vigia
 * que alguém desliga — e depois disso ela não protege mais nada. Cinco minutos
 * é folga de mais de 3x sobre o pior caso legítimo, e ainda assim é um décimo
 * do tempo que alguém levaria para reparar sozinho que o WhatsApp emudeceu.
 *
 * `tests/unit/fila-saude.test.ts` lê as três constantes e afirma a ordem, em
 * vez de repetir os números — se alguém subir `TEMPO_MAX_TURNO_MS`, o teste
 * morde aqui.
 */
export const LIMIAR_FILA_PARADA_MS = 5 * 60_000;

export interface SaudeDaFila {
  /** Jobs prontos para serem pegos AGORA e que ninguém pegou. */
  prontos: number;
  /** Idade do job pronto mais velho. `null` quando não há nenhum. */
  idadeDoMaisVelhoMs: number | null;
  /** Jobs que morreram na última hora — envenenamento, não parada. */
  mortosRecentes: number;
}

/**
 * A pergunta que `systemctl is-active` NÃO responde.
 *
 * ## Por que a vigia olha para o efeito e não para o processo
 *
 * `systemctl is-active n8necrm-worker` responde `active` para um processo que
 * existe. Um worker preso numa consulta que não volta existe, responde
 * `active`, e não drena nada — e o modo de falha que o `.env.example` chama de
 * pior possível ("mensagem entra, vira linha, e NUNCA é respondida, sem erro
 * em lugar nenhum") acontece exatamente assim. Só o banco sabe a verdade.
 *
 * ## Por que ela vive AQUI e não no script
 *
 * Esta consulta é cross-tenant por construção — a pergunta é "há job parado de
 * QUALQUER empresa" —, e este arquivo é o que já tem a exceção NOMEADA de
 * prisma cru no `eslint.config.mjs`, pelo mesmo motivo e provada por
 * `tests/unit/catraca-prisma-cru.test.ts`. Pôr a consulta num script novo
 * exigiria uma exceção nova para a mesma justificativa que esta já carrega, e
 * a catraca daquele arquivo gira num sentido só.
 *
 * ## Três estados, não dois
 *
 * `prontos: 0` é o estado NORMAL de madrugada e não é falha. Falha é
 * `idadeDoMaisVelhoMs > LIMIAR_FILA_PARADA_MS`. `mortosRecentes` é a terceira
 * coisa e é DIFERENTE das outras duas: job envenenado que morre na 5ª entrega
 * some da contagem de prontos, então uma fila que mata tudo o que entra
 * pareceria perfeitamente saudável sem esta terceira medida.
 */
export async function medirSaudeDaFila(): Promise<SaudeDaFila> {
  const agora = new Date();

  // "Pronto" tem três condições, e as três são as MESMAS do subselect de
  // `reivindicarJob` — de propósito. Uma vigia que definisse "pronto" com
  // outro critério responderia sobre uma fila que não é a que o worker vê.
  const onde = {
    mortoEm: null,
    disponivelEm: { lte: agora },
    OR: [{ leaseAte: null }, { leaseAte: { lt: agora } }],
  };

  const [prontos, maisVelho, mortosRecentes] = await Promise.all([
    prisma.turnoJob.count({ where: onde }),
    prisma.turnoJob.findFirst({
      where: onde,
      orderBy: { criadoEm: "asc" },
      select: { criadoEm: true },
    }),
    prisma.turnoJob.count({
      where: { mortoEm: { gte: new Date(agora.getTime() - 60 * 60_000) } },
    }),
  ]);

  return {
    prontos,
    idadeDoMaisVelhoMs: maisVelho ? agora.getTime() - maisVelho.criadoEm.getTime() : null,
    mortosRecentes,
  };
}
```

⚠️ Se `RETRY_APOS_MS` estiver declarado sem `export`, acrescente o `export` — nada mais muda nele.

- [ ] **Step 5: O script**

Criar `scripts/fila-saude.ts`:

```ts
import "dotenv/config";

import {
  LIMIAR_FILA_PARADA_MS,
  medirSaudeDaFila,
} from "../src/modules/whatsapp/fila/postgres";

/**
 * A vigia da fila, rodada por `n8necrm-saude.timer` a cada 5 minutos.
 *
 * ## O código de saída é a interface
 *
 * `0` saudável, `1` fila parada, `2` erro de infraestrutura. O systemd põe a
 * unit em `failed` para qualquer coisa diferente de 0, então `systemctl
 * --failed` e `systemctl status n8necrm-saude` já contam a história sem
 * ninguém ter escrito integração nenhuma.
 *
 * `1` e `2` são separados porque exigem coisas diferentes de quem lê: `1` é
 * "o worker não está drenando", `2` é "não consegui nem perguntar" (banco
 * fora do ar, variável faltando). Colapsar os dois faria uma queda do
 * Supabase parecer worker morto.
 *
 * ## `FILA_SAUDE_ALERTA_URL` é o que fecha o laço, e é OPCIONAL
 *
 * Sem ela o alarme existe só em journald e em `systemctl --failed`, onde
 * ninguém está olhando — e uma vigia que ninguém lê tem o valor de uma vigia
 * que não existe. Isto está dito aqui em vez de a variável ser obrigatória
 * porque exigi-la impediria a vigia de subir antes de o destino existir, e
 * vigia parcial vale mais que vigia nenhuma. A ação está registrada em
 * docs/DEPLOY.md como ação do dono.
 *
 * O destino natural dela é um webhook do n8n, que roda NESTA MESMA MÁQUINA
 * (`127.0.0.1:5678`) e já sabe mandar WhatsApp e e-mail.
 *
 * ## Por que não há `--conditions=react-server` aqui
 *
 * O worker precisa da condição porque arrasta `turno.ts`, que carrega
 * `server-only`. Este script importa SÓ `fila/postgres.ts`, que não carrega.
 * `tests/unit/fila-saude.test.ts` não prova isso — quem prova é a unit rodar.
 * Se um dia este script passar a importar algo marcado, ele morre na primeira
 * linha, alto, e a correção é acrescentar a flag em `n8necrm-saude.service`.
 */
async function principal(): Promise<number> {
  const saude = await medirSaudeDaFila();

  const parada =
    saude.idadeDoMaisVelhoMs !== null && saude.idadeDoMaisVelhoMs > LIMIAR_FILA_PARADA_MS;

  const linha =
    `fila: prontos=${saude.prontos} ` +
    `maisVelhoMs=${saude.idadeDoMaisVelhoMs ?? "-"} ` +
    `mortosNaUltimaHora=${saude.mortosRecentes} ` +
    `limiarMs=${LIMIAR_FILA_PARADA_MS}`;

  if (!parada) {
    console.log(`OK  ${linha}`);
    return 0;
  }

  const alerta =
    `FILA PARADA. ${linha}. ` +
    `O worker (n8necrm-worker) nao esta drenando: mensagem de WhatsApp entra e ninguem responde. ` +
    `Conferir: systemctl status n8necrm-worker && journalctl -u n8necrm-worker -n 50`;

  console.error(`FALHA  ${alerta}`);

  const destino = process.env.FILA_SAUDE_ALERTA_URL?.trim();
  if (destino) {
    try {
      // Sem `await` numa promessa solta e sem retry: o systemd já vai chamar
      // de novo em 5 minutos. Um retry aqui atrasaria a saída do processo e a
      // unit ficaria "activating" enquanto a fila continua parada.
      const resposta = await fetch(destino, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ origem: "n8necrm-saude", alerta, ...saude }),
        signal: AbortSignal.timeout(10_000),
      });
      console.error(`alerta enviado: HTTP ${resposta.status}`);
    } catch (erro) {
      // Falhar em ALERTAR não pode mudar o diagnóstico. O código de saída
      // continua sendo 1 (fila parada), não 2 — o problema segue sendo a fila.
      console.error("alerta NAO enviado:", erro);
    }
  }

  return 1;
}

principal()
  .then((codigo) => process.exit(codigo))
  .catch((erro) => {
    // 2, e não 1: "não consegui perguntar" é diferente de "a fila está
    // parada". Colapsar os dois faria uma queda do Supabase parecer worker
    // morto, e mandaria quem lê procurar no lugar errado.
    console.error("ERRO ao medir a saude da fila:", erro);
    process.exit(2);
  });
```

- [ ] **Step 6: O bloco do `.env.example`**

Acrescentar ao fim da seção da fila, depois do bloco de `WHATSAPP_QUEUE_SECRET`:

```
# Destino opcional de alerta da vigia da fila (scripts/fila-saude.ts).
#
# Um POST JSON quando a fila estiver parada há mais de 5 minutos. Sem esta
# variável a vigia continua rodando e continua falhando alto -- mas só em
# journald e em `systemctl --failed`, onde ninguém está olhando. Uma vigia que
# ninguém lê vale o mesmo que vigia nenhuma.
#
# Na VPS o destino natural é um webhook do n8n, que roda na mesma máquina e já
# sabe mandar WhatsApp e e-mail.
FILA_SAUDE_ALERTA_URL=""
```

- [ ] **Step 7: GREEN**

```bash
npx vitest run tests/unit/fila-saude.test.ts
npm run typecheck
npm run lint
npx tsx scripts/fila-saude.ts ; echo "codigo de saida: $?"
```

Esperado: os quatro casos passando; typecheck e lint limpos (**zero exceções novas** no eslint — se o lint reclamar de prisma cru, **pare e reporte**); e o script imprimindo uma linha `OK fila: prontos=0 ...` com código de saída **0** contra o banco de desenvolvimento. Cole as quatro saídas.

- [ ] **Step 8: Commit**

```
feat(fila): vigia que pergunta ao banco, nao ao systemd

`systemctl is-active` responde "o processo existe". Worker preso numa
consulta que nao volta existe, responde active, e nao drena nada -- que e
exatamente o pior modo de falha deste projeto: mensagem entra, vira linha
em TurnoJob, e ninguem nunca responde, sem erro em lugar nenhum.

medirSaudeDaFila mede o EFEITO: quantos jobs estao prontos e parados, e ha
quanto tempo o mais velho espera. Mora em fila/postgres.ts porque a
consulta e cross-tenant pelo mesmo motivo que a reivindicacao, e aquele
arquivo ja tem a excecao nomeada -- nenhuma excecao nova entrou.

Tres estados e nao dois: fila vazia e o estado NORMAL de madrugada, e
vigia que alarma nisso e desligada na primeira semana.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

### Task 3: As três units do systemd

🖥️ **TOCA A VPS:** não — esta tarefa só **escreve os arquivos** no repositório. Quem os instala é a Tarefa 8.
**AÇÃO DO DONO:** não.

**Files:**
- Create: `deploy/systemd/n8necrm-web.service`
- Create: `deploy/systemd/n8necrm-worker.service`
- Create: `deploy/systemd/n8necrm-saude.service`
- Create: `deploy/systemd/n8necrm-saude.timer`
- Create: `tests/unit/deploy-units.test.ts`

**Interfaces:**
- Consumes: `scripts/fila-saude.ts` (Tarefa 2); `scripts/fila-worker.ts` (já existe).
- Produces: quatro arquivos de unit, e os invariantes travados por teste:
  - as duas units permanentes escutam **só em `127.0.0.1`**
  - as duas usam `EnvironmentFile=/etc/n8necrm/n8necrm.env`
  - o worker carrega `--conditions=react-server`
  - `StartLimitIntervalSec=0` nas duas permanentes

- [ ] **Step 1: Escrever o teste que falha (RED)**

Criar `tests/unit/deploy-units.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * As units são testadas como TEXTO, porque é como texto que elas falham.
 *
 * Nada aqui roda systemd. O que estes casos protegem são quatro decisões que,
 * se alguém apagar por engano numa edição futura, produzem falhas que NÃO
 * aparecem em teste nenhum e só se manifestam em produção — três delas em
 * silêncio.
 */
const web = readFileSync("deploy/systemd/n8necrm-web.service", "utf8");
const worker = readFileSync("deploy/systemd/n8necrm-worker.service", "utf8");
const saude = readFileSync("deploy/systemd/n8necrm-saude.service", "utf8");
const timer = readFileSync("deploy/systemd/n8necrm-saude.timer", "utf8");

describe("units do systemd", () => {
  it("o servidor escuta SÓ em 127.0.0.1 — a VPS não tem firewall", () => {
    // Medido em 2026-08-21: `ufw status` responde "Status: inactive". Escutar
    // em 0.0.0.0 exporia a aplicação direto na internet, contornando o nginx
    // — e com ela a sobrescrita de X-Real-IP, que é a ÚNICA coisa que torna
    // IP_CABECALHO_CONFIAVEL confiável. Um atacante falando direto com a
    // porta 3000 escreve o X-Real-IP que quiser, e o AuditLog passa a guardar
    // IP forjado apontando para a pessoa errada.
    expect(web).toContain("-H 127.0.0.1");
    expect(web).not.toContain("0.0.0.0");
  });

  it("o worker carrega --conditions=react-server", () => {
    // Sem a condição, `server-only` é um throw de uma linha e o processo morre
    // na PRIMEIRA linha importada (turno.ts:1). Medido no Ciclo 2d. A falha é
    // alta e imediata, mas a unit tem Restart=always: sem este caso, um erro
    // de digitação aqui vira um laço de reinício a cada 10s com o WhatsApp
    // mudo, que ninguém nota até alguém abrir o journal.
    expect(worker).toContain("--conditions=react-server");
  });

  it("as duas units permanentes desligam o limite de reinício do systemd", () => {
    // O PADRÃO do systemd é: 5 reinícios em 10s põem a unit em `failed`, e ela
    // PARA DE TENTAR para sempre. Para o worker isso é o pior modo de falha
    // deste projeto — WhatsApp mudo sem erro em lugar nenhum — travado
    // permanentemente por um soluço de rede de 30 segundos.
    expect(web).toContain("StartLimitIntervalSec=0");
    expect(worker).toContain("StartLimitIntervalSec=0");
    expect(web).toContain("Restart=always");
    expect(worker).toContain("Restart=always");
  });

  it("as três units leem o mesmo arquivo de ambiente, e nenhuma embute segredo", () => {
    // Duas fontes de verdade para segredo é a família de defeito que este
    // projeto já catalogou. E um `Environment=` com valor apareceria em
    // `systemctl show` para qualquer usuário do sistema — EnvironmentFile não.
    for (const unit of [web, worker, saude]) {
      expect(unit).toContain("EnvironmentFile=/etc/n8necrm/n8necrm.env");
    }
    // `Environment=` só é permitido para valor NÃO secreto (NODE_ENV, TZ).
    const linhasDeAmbiente = [web, worker, saude]
      .flatMap((u) => u.split("\n"))
      .filter((l) => l.startsWith("Environment="));
    for (const linha of linhasDeAmbiente) {
      expect(linha).toMatch(/^Environment=(NODE_ENV|TZ|NODE_OPTIONS)=/);
    }
  });

  it("o timer da vigia dispara mesmo depois de a máquina ficar desligada", () => {
    // Persistent=true faz o systemd rodar a execução perdida assim que a
    // máquina volta. Sem ele, um reboot no meio da noite adia a primeira
    // verificação para o próximo múltiplo de 5 minutos — e, mais grave,
    // esconde justamente a janela em que o worker pode não ter subido.
    expect(timer).toContain("Persistent=true");
    expect(timer).toContain("OnUnitActiveSec=5min");
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
npx vitest run tests/unit/deploy-units.test.ts
```

Esperado: **FAIL**, `ENOENT ... deploy/systemd/n8necrm-web.service`. Cole a saída.

- [ ] **Step 3: `deploy/systemd/n8necrm-web.service`**

```ini
# Servidor Next.js do n8necrm.
#
# Instalado por `deploy/bootstrap.sh` em /etc/systemd/system/. A fonte de
# verdade e este arquivo, no repositorio -- editar direto em
# /etc/systemd/system/ produz uma VPS que diverge do git sem ninguem notar.
[Unit]
Description=n8necrm - servidor Next.js
Documentation=https://github.com/nathanfvidal/n8necrm
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=n8necrm
Group=n8necrm

# Symlink, de proposito: o deploy.sh troca para onde ele aponta e o `restart`
# seguinte ja executa a release nova. O systemd resolve o symlink na hora de
# executar, nao na de carregar a unit.
WorkingDirectory=/opt/n8necrm/current

# O UNICO lugar dos segredos. Nao ha `Environment=` com valor sensivel aqui:
# `systemctl show` imprime Environment= para qualquer usuario do sistema e
# NAO imprime o conteudo de EnvironmentFile=.
EnvironmentFile=/etc/n8necrm/n8necrm.env
Environment=NODE_ENV=production

# `node .../next start` e nao `npm run start`: o npm vira um processo pai que
# repassa sinal mal, e o systemd passaria a matar o npm enquanto o Next
# continua. Assim o Next e o processo principal e recebe SIGTERM direto.
#
# `-H 127.0.0.1` e a linha que mais importa deste arquivo. A VPS nao tem ufw
# ativo (medido em 2026-08-21), entao escutar em 0.0.0.0 poria a aplicacao na
# internet sem passar pelo nginx -- e quem falasse direto com a porta 3000
# escreveria o X-Real-IP que quisesse. E a mesma postura do n8n
# (127.0.0.1:5678) e da Evolution (127.0.0.1:8080) nesta maquina.
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000

Restart=always
RestartSec=5
# Sem isto, 5 reinicios em 10s poem a unit em `failed` PARA SEMPRE. Aqui a
# consequencia seria visivel (o site cai), mas a simetria com o worker importa:
# as duas se comportam igual sob falha, entao quem le uma sabe ler a outra.
StartLimitIntervalSec=0

KillSignal=SIGTERM
TimeoutStopSec=30

# Teto de memoria: a maquina tem 2 vCPU e cinco containers de pe. Sem teto, um
# vazamento no Next levaria n8n e Evolution junto via OOM killer.
MemoryMax=2G

StandardOutput=journal
StandardError=journal
SyslogIdentifier=n8necrm-web

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
# `next start` escreve cache em .next/cache -- ProtectSystem=strict deixaria o
# sistema de arquivos inteiro somente-leitura sem esta linha.
ReadWritePaths=/opt/n8necrm

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 4: `deploy/systemd/n8necrm-worker.service`**

```ini
# Worker da fila de turnos do WhatsApp.
#
# ESTE E O PROCESSO QUE FAZ O WHATSAPP RESPONDER. Morto, nada acusa: mensagem
# entra, vira linha em TurnoJob, e ninguem nunca responde -- sem erro em lugar
# nenhum. Quem acusa e `n8necrm-saude.timer`, e ele existe por causa disto.
[Unit]
Description=n8necrm - worker da fila de turnos
Documentation=https://github.com/nathanfvidal/n8necrm
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=n8necrm
Group=n8necrm
WorkingDirectory=/opt/n8necrm/current
EnvironmentFile=/etc/n8necrm/n8necrm.env
Environment=NODE_ENV=production

# `--conditions=react-server` NAO E OPCIONAL e NAO E CONTORNO.
#
# `node_modules/server-only/index.js` e um throw de uma linha, e o campo
# `exports` daquele pacote so desvia para o empty.js inofensivo sob essa
# condicao. O Next a aplica em componente de servidor; o tsx, sozinho, nao
# aplica nenhuma -- e `src/modules/whatsapp/turno.ts:1` carrega a marcacao.
# Sem a flag o processo morre na PRIMEIRA linha importada. Medido no Ciclo 2d.
#
# A flag vai no comando, e nao em NODE_OPTIONS, pelo mesmo motivo que
# prisma.config.ts documenta: a posicao dela e parte do contrato do tsx.
ExecStart=/opt/n8necrm/current/node_modules/.bin/tsx --conditions=react-server scripts/fila-worker.ts

Restart=always
# 10s e nao 5s: se a causa da morte for o banco fora do ar, um laco mais lento
# desperdicaria menos e ainda assim tenta 6 vezes por minuto.
RestartSec=10
# A LINHA MAIS IMPORTANTE DESTE ARQUIVO. O padrao do systemd (5 reinicios em
# 10s -> `failed`, para sempre) transformaria um soluco de 30 segundos no
# banco num WhatsApp permanentemente mudo, sem nada na tela dizendo isso.
# Desligar o limite troca "desiste calado" por "insiste para sempre".
StartLimitIntervalSec=0

# O worker ja trata SIGTERM: para de pegar LOTE novo e termina o lote em curso
# (ate 10 turnos de ate 60s). 90s cobre isso; passando disso o systemd manda
# SIGKILL, e ai o lease de 90s devolve o job em curso para a fila sozinho.
KillSignal=SIGTERM
TimeoutStopSec=90

MemoryMax=1G

StandardOutput=journal
StandardError=journal
SyslogIdentifier=n8necrm-worker

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/n8necrm

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 5: `deploy/systemd/n8necrm-saude.service` e o `.timer`**

`deploy/systemd/n8necrm-saude.service`:

```ini
# Vigia da fila. Pergunta AO BANCO se a fila esta andando.
#
# Nao pergunta ao systemd: `systemctl is-active n8necrm-worker` responde
# `active` para um worker preso numa consulta que nao volta, e esse worker nao
# drena nada. So o banco sabe a verdade.
#
# Type=oneshot: roda, responde com o codigo de saida, morre. Saida != 0 poe a
# unit em `failed`, entao `systemctl --failed` conta a historia sem integracao
# nenhuma. 0 saudavel, 1 fila parada, 2 nao consegui perguntar.
[Unit]
Description=n8necrm - vigia da fila de turnos
Documentation=https://github.com/nathanfvidal/n8necrm

[Service]
Type=oneshot
User=n8necrm
Group=n8necrm
WorkingDirectory=/opt/n8necrm/current
EnvironmentFile=/etc/n8necrm/n8necrm.env
Environment=NODE_ENV=production

# Sem --conditions=react-server: este script importa so fila/postgres.ts, que
# nao carrega `server-only`. Se um dia passar a carregar, ele morre alto na
# primeira linha e a correcao e acrescentar a flag aqui.
ExecStart=/opt/n8necrm/current/node_modules/.bin/tsx scripts/fila-saude.ts

# Sem Restart: e oneshot disparado por timer. Reiniciar sozinho mascararia a
# falha que ele existe para reportar.
TimeoutStartSec=60
MemoryMax=512M

StandardOutput=journal
StandardError=journal
SyslogIdentifier=n8necrm-saude

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/n8necrm
```

`deploy/systemd/n8necrm-saude.timer`:

```ini
[Unit]
Description=n8necrm - dispara a vigia da fila a cada 5 minutos
Documentation=https://github.com/nathanfvidal/n8necrm

[Timer]
# 2min depois do boot: da tempo de o worker subir, sem esconder o caso em que
# ele NAO sobe.
OnBootSec=2min
OnUnitActiveSec=5min

# Se a maquina estiver desligada na hora, roda assim que voltar. Sem isto, um
# reboot de madrugada adia a verificacao -- justamente na janela em que o
# worker pode nao ter subido.
Persistent=true

# Espalha ate 30s para nao bater no banco no mesmo segundo que outra coisa
# agendada.
RandomizedDelaySec=30

[Install]
WantedBy=timers.target
```

- [ ] **Step 6: GREEN**

```bash
npx vitest run tests/unit/deploy-units.test.ts
```

Esperado: os cinco casos passando. Cole a saída.

🔍 **NÃO VERIFICADO:** que o systemd aceita estes arquivos. Nada aqui roda `systemd-analyze`. A prova é a Tarefa 8, Step 3, que roda `systemd-analyze verify` na VPS **antes** de habilitar qualquer unit.

- [ ] **Step 7: Commit**

```
feat(deploy): as tres units do systemd, versionadas no repo

A fonte de verdade fica no git e nao em /etc/systemd/system/: editar
direto na VPS produz uma maquina que diverge do repositorio sem ninguem
notar, e foi assim que o arquivo de nginx deste stack acumulou um .bak.

Quatro decisoes ficam travadas por teste de texto porque, apagadas numa
edicao futura, falham so em producao e tres delas em silencio: escutar em
127.0.0.1 (a VPS nao tem ufw ativo), --conditions=react-server no worker,
StartLimitIntervalSec=0 nas duas permanentes (o padrao do systemd desiste
depois de 5 reinicios, para sempre), e segredo so via EnvironmentFile.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

### Task 4: Os dois arquivos de nginx do CRM

🖥️ **TOCA A VPS:** não — esta tarefa só **escreve os arquivos** no repositório. Quem os instala são as Tarefas 9 e 10.
**AÇÃO DO DONO:** não.

**Por que são DOIS arquivos e não um.** O bloco de porta 443 referencia `/etc/letsencrypt/live/crm.nateksoft.com/fullchain.pem`. Esse arquivo **não existe** antes de o certificado ser emitido, e `nginx -t` **falha** apontando para um caminho inexistente. Mas o certificado não pode ser emitido antes de o nginx responder ao desafio ACME em `crm.nateksoft.com` — que hoje cai no `return 404` do bloco curinga (achado 1 da medição). É um ovo e uma galinha, e a saída é a fase 1: um arquivo que só serve o desafio, sem TLS nenhum.

**Files:**
- Create: `deploy/nginx/crm.nateksoft.com.fase1.conf`
- Create: `deploy/nginx/crm.nateksoft.com.conf`
- Create: `tests/unit/deploy-nginx.test.ts`

**Interfaces:**
- Consumes: nada do código; a porta `127.0.0.1:3000` das units da Tarefa 3.
- Produces: os dois arquivos, e os invariantes travados por teste:
  - `proxy_set_header X-Real-IP $remote_addr;` **presente**
  - `IP_CABECALHO_CONFIAVEL` nunca apontado para `x-forwarded-for`
  - `location = /api/queues/whatsapp-turn` devolvendo `404`
  - **nenhum** `add_header` de segurança (o Next já os manda)

- [ ] **Step 1: Escrever o teste que falha (RED)**

Criar `tests/unit/deploy-nginx.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * O nginx é testado como TEXTO. Nada aqui roda nginx.
 *
 * Estes casos não substituem `nginx -t` — substituem a MEMÓRIA. Cada um deles
 * é uma decisão que parece detalhe de encanamento e é de segurança ou de
 * correção, e que uma edição futura apagaria sem que nada quebrasse na hora.
 */
const conf = readFileSync("deploy/nginx/crm.nateksoft.com.conf", "utf8");
const fase1 = readFileSync("deploy/nginx/crm.nateksoft.com.fase1.conf", "utf8");

describe("nginx do CRM", () => {
  it("sobrescreve X-Real-IP com $remote_addr", () => {
    // IP_CABECALHO_CONFIAVEL="x-real-ip" só é seguro porque ESTA linha existe.
    // Ela DESCARTA o que o cliente mandou. Sem ela, o cabeçalho chega intacto
    // do cliente e o AuditLog passa a guardar IP forjado -- pior que nulo,
    // porque aponta para a pessoa errada.
    expect(conf).toContain("proxy_set_header X-Real-IP $remote_addr;");
  });

  it("NUNCA sobrescreve X-Forwarded-For com $remote_addr", () => {
    // A convenção de X-Forwarded-For é ACUMULAR, e `$proxy_add_x_forwarded_for`
    // é o que faz isso. Trocá-lo por `$remote_addr` apagaria a cadeia inteira.
    // O par correto é: X-Real-IP sobrescreve, X-Forwarded-For acumula -- e é
    // exatamente por acumular que ele NÃO serve para IP_CABECALHO_CONFIAVEL,
    // já que src/lib/ip.ts lê o PRIMEIRO item da lista, que é o do cliente.
    expect(conf).toContain("proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;");
    expect(conf).not.toMatch(/X-Forwarded-For\s+\$remote_addr/);
  });

  it("recusa /api/queues/whatsapp-turn na borda, com 404 e não 403", () => {
    // O gatilho escolhido é o worker EM PROCESSO: nada legítimo chama esta
    // rota de fora. Na Vercel havia air-gap de rede; aqui não há, e o segredo
    // seria a única defesa. Isto devolve a segunda camada.
    //
    // 404 e não 403 porque a própria rota responde 404 a segredo errado
    // (route.ts:74). Se a borda respondesse 403, uma sonda externa
    // distinguiria "bloqueado na borda" de "segredo errado" -- e essa
    // diferença confirma que o path existe, que é o que o 404 recusa dizer.
    expect(conf).toMatch(/location\s*=\s*\/api\/queues\/whatsapp-turn\s*\{[^}]*return\s+404;/s);
  });

  it("não manda NENHUM header de segurança — o Next já manda", () => {
    // next.config.ts:1-60 já envia nosniff, X-Frame-Options, Referrer-Policy,
    // Permissions-Policy e HSTS; src/proxy.ts envia o CSP com nonce POR
    // REQUISIÇÃO. Um `add_header Content-Security-Policy` aqui faria o
    // navegador receber DOIS CSPs e aplicar a INTERSEÇÃO das duas políticas --
    // mais restritiva que qualquer uma isolada, quebrando de um jeito difícil
    // de diagnosticar. O comentário de next.config.ts já registra esse modo de
    // falha; este caso impede que ele seja reintroduzido pela outra ponta.
    expect(conf).not.toMatch(/add_header\s+Content-Security-Policy/i);
    expect(conf).not.toMatch(/add_header\s+Strict-Transport-Security/i);
    expect(conf).not.toMatch(/add_header\s+X-Frame-Options/i);
  });

  it("a fase 1 não referencia certificado nenhum", () => {
    // O motivo de existirem dois arquivos: `nginx -t` FALHA apontando para um
    // ssl_certificate que ainda não foi emitido, e o certificado não pode ser
    // emitido enquanto o nginx não responder ao desafio ACME.
    expect(fase1).not.toContain("ssl_certificate");
    expect(fase1).not.toContain("listen 443");
    expect(fase1).toContain("/.well-known/acme-challenge/");
  });

  it("os dois arquivos usam server_name EXATO", () => {
    // A precedência do nginx é: nome exato ganha de curinga com `*` à
    // esquerda, independentemente da ordem dos arquivos. É o que permite o CRM
    // assumir crm.nateksoft.com SEM tocar em nateksoft.conf, que hoje casa
    // `*.nateksoft.com` nas portas 80 e 443 e é o arquivo que mantém n8n e
    // Evolution de pé.
    expect(conf).toContain("server_name crm.nateksoft.com;");
    expect(fase1).toContain("server_name crm.nateksoft.com;");
    expect(conf).not.toContain("*.nateksoft.com");
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
npx vitest run tests/unit/deploy-nginx.test.ts
```

Esperado: **FAIL**, `ENOENT ... deploy/nginx/crm.nateksoft.com.conf`. Cole a saída.

- [ ] **Step 3: `deploy/nginx/crm.nateksoft.com.fase1.conf`**

```nginx
# CRM n8necrm -- FASE 1: so o desafio ACME, sem TLS.
#
# ESTE ARQUIVO E TEMPORARIO. Ele existe por causa de um ovo e uma galinha:
# `nginx -t` falha se um bloco 443 apontar para um certificado que ainda nao
# existe, e o certificado nao pode ser emitido enquanto o nginx nao responder
# ao desafio HTTP-01 em crm.nateksoft.com.
#
# E o desafio nao seria respondido sozinho. Medido em 2026-08-21:
# /opt/nateksoft/nginx/nateksoft.conf:132-135 tem
# `listen 80; server_name nateksoft.com *.nateksoft.com; return 404;`, e o
# bloco ACME padrao (/etc/nginx/sites-enabled/default-acme.conf) e
# `listen 80 default_server` SEM server_name. Na precedencia do nginx o curinga
# ganha do default_server -- entao um `certbot certonly --webroot` para
# crm.nateksoft.com receberia 404 e falharia.
#
# Este arquivo casa o nome EXATO, que ganha do curinga, e serve o desafio. A
# Tarefa 10 o SUBSTITUI por crm.nateksoft.com.conf.

server {
    listen 80;
    listen [::]:80;
    server_name crm.nateksoft.com;

    # O mesmo webroot que o resto da maquina ja usa (existe desde 2026-08-19).
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # 404 e nao 301: nao ha para onde redirecionar ainda, e um 301 para https
    # numa origem sem certificado daria erro de certificado em vez de "ainda
    # nao publicado".
    location / {
        return 404;
    }
}
```

- [ ] **Step 4: `deploy/nginx/crm.nateksoft.com.conf`**

```nginx
# CRM n8necrm -- configuracao definitiva.
#
# ## Por que este arquivo e SEPARADO de /opt/nateksoft/nginx/nateksoft.conf
#
# Aquele arquivo e o que mantem n8n e Evolution no ar, e tem precedente de
# quebra registrado neste projeto. Este nao o toca em linha nenhuma. Na
# precedencia do nginx, `server_name` EXATO ganha de curinga com `*` a
# esquerda, independentemente da ordem dos arquivos -- entao os blocos
# `*.nateksoft.com` que hoje respondem por crm.nateksoft.com (com 404 na 80 e
# com o certificado do mail na 443) sao superados sem serem editados.
#
# Reverter o CRM inteiro na borda e:
#     rm /etc/nginx/sites-enabled/crm.nateksoft.com
#     nginx -t && systemctl reload nginx
#
# ## O que este arquivo NAO faz, e por que
#
# Nenhum `add_header` de seguranca. next.config.ts ja envia nosniff,
# X-Frame-Options, Referrer-Policy, Permissions-Policy e HSTS; src/proxy.ts
# envia o CSP com nonce POR REQUISICAO. Um CSP aqui faria o navegador receber
# DOIS e aplicar a INTERSECAO das duas politicas -- mais restritiva que
# qualquer uma isolada, e quebrando de um jeito dificil de diagnosticar. O
# comentario no topo de next.config.ts ja registra esse modo de falha.
#
# Nenhum `proxy_set_header Upgrade`/`Connection`. `next start` em producao nao
# usa WebSocket (o HMR e so de `next dev`). As duas linhas exigiriam um bloco
# `map` para nao mandar "upgrade" em toda requisicao, e nao compram nada.

upstream n8necrm {
    # 127.0.0.1, nunca 0.0.0.0. A aplicacao tambem ESCUTA so em 127.0.0.1 (ver
    # deploy/systemd/n8necrm-web.service): a VPS nao tem ufw ativo, entao esse
    # bind e a unica coisa que impede alguem de falar com a aplicacao direto,
    # sem passar por aqui, mandando o X-Real-IP que quiser.
    server 127.0.0.1:3000;
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name crm.nateksoft.com;

    # Continua servindo o desafio DEPOIS da emissao: e por aqui que
    # `certbot renew` renova a cada 60 dias. Tirar esta linha faz o
    # certificado expirar em silencio daqui a tres meses.
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    # `listen ... http2` e nao a diretiva `http2 on;`: o nginx desta VPS e
    # 1.24.0, e a diretiva so existe a partir da 1.25.1. Mesmo estilo dos
    # blocos de n8n e Evolution, que rodam nesta mesma instancia.
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name crm.nateksoft.com;

    ssl_certificate /etc/letsencrypt/live/crm.nateksoft.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/crm.nateksoft.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # 10M e nao os 50M dos outros dois: o CRM nao recebe upload de midia. A
    # Evolution recebe, e por isso ela tem 50M.
    client_max_body_size 10M;

    # ------------------------------------------------------------------
    # A rota de tick da fila NAO e servida para fora.
    #
    # Na Vercel esta rota era "completamente air-gapped da internet" -- e a
    # inspecao do SDK mostrou que ele nao verificava assinatura nenhuma,
    # confiava inteiramente naquela garantia de rede. Fora da Vercel a garantia
    # sumiu e WHATSAPP_QUEUE_SECRET virou a UNICA defesa de uma rota alcancavel
    # por qualquer um.
    #
    # O gatilho escolhido e o worker EM PROCESSO (`fila:worker`), que chama
    # `drenarFila()` direto e nao usa esta rota nem este segredo. Entao nada
    # legitimo a chama de fora, e recusa-la aqui devolve a segunda camada que a
    # saida da Vercel tinha custado.
    #
    # 404, e nao 403: a propria rota responde 404 a segredo errado, pelo motivo
    # escrito em route.ts -- nao confirmar a quem esta adivinhando que o path
    # existe. Um 403 aqui distinguiria "bloqueado na borda" de "segredo
    # errado", e essa diferenca e a confirmacao que o 404 recusa dar.
    #
    # SE UM DIA O GATILHO VOLTAR A SER UM AGENDADOR EXTERNO, este bloco tem de
    # sair -- e ai o segredo volta a ser a unica defesa, conscientemente.
    # ------------------------------------------------------------------
    location = /api/queues/whatsapp-turn {
        return 404;
    }

    location / {
        proxy_pass http://n8necrm;
        proxy_http_version 1.1;

        # Host: o Auth.js monta callback a partir dele. AUTH_URL no arquivo de
        # ambiente e a fonte autoritativa; isto mantem as duas de acordo.
        proxy_set_header Host $host;

        # A LINHA QUE SUSTENTA IP_CABECALHO_CONFIAVEL="x-real-ip".
        # `$remote_addr` SOBRESCREVE: o que o cliente mandou neste cabecalho e
        # descartado aqui. E o oposto da linha de baixo, e a diferenca e o
        # motivo de a variavel apontar para este cabecalho e nao para aquele.
        proxy_set_header X-Real-IP $remote_addr;

        # `$proxy_add_x_forwarded_for` ACUMULA: vira
        # "<o que o cliente mandou>, <ip do socket>". Correto para a convencao
        # do cabecalho, e INUTILIZAVEL como fonte de IP confiavel, porque
        # src/lib/ip.ts le o PRIMEIRO item da lista -- que e o do cliente.
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # Sem isto o Next monta URL http:// atras do proxy e o cookie de sessao
        # `__Secure-` nao e aceito -- login que parece funcionar e nao mantem
        # sessao.
        proxy_set_header X-Forwarded-Proto $scheme;

        # Streaming do App Router: com buffering ligado o nginx segura a
        # resposta ate o fim e a renderizacao progressiva do React some.
        proxy_buffering off;

        # 90s cobre `/export/leads`, a rota mais lenta que sobra depois de a de
        # tick ser recusada acima. O padrao do nginx e 60s.
        proxy_read_timeout 90s;
        proxy_send_timeout 90s;
    }
}
```

- [ ] **Step 5: GREEN**

```bash
npx vitest run tests/unit/deploy-nginx.test.ts
```

Esperado: os seis casos passando. Cole a saída.

🔍 **NÃO VERIFICADO:** que o nginx aceita estes arquivos. `nginx -t` só existe na VPS, e ele roda nas Tarefas 9 e 10 — sempre **antes** de qualquer `reload`.

- [ ] **Step 6: Commit**

```
feat(deploy): o nginx do CRM, num arquivo que nao toca o dos outros

nateksoft.conf mantem n8n e Evolution no ar e tem precedente de quebra.
Este arquivo nao mexe nele: na precedencia do nginx, server_name exato
ganha de curinga com * a esquerda, entao os blocos *.nateksoft.com que
hoje respondem por crm.nateksoft.com (404 na 80, certificado do mail na
443) sao superados sem serem editados. Reverter e apagar um symlink.

Sao dois arquivos porque `nginx -t` falha apontando para um certificado
que ainda nao existe, e o certificado nao pode ser emitido enquanto o
nginx nao responder ao desafio ACME -- que hoje cai no `return 404` do
bloco curinga. A fase 1 quebra o ciclo.

A rota de tick da fila e recusada na borda com 404: o gatilho escolhido e
o worker em processo, nada legitimo a chama de fora, e isso devolve a
segunda camada que a saida da Vercel custou.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

### Task 5: `deploy.sh` e `bootstrap.sh`

🖥️ **TOCA A VPS:** não — esta tarefa só **escreve os scripts**. Quem os roda são as Tarefas 7 e 8.
**AÇÃO DO DONO:** não.

**Files:**
- Create: `deploy/deploy.sh`
- Create: `deploy/bootstrap.sh`
- Create: `deploy/n8necrm.env.exemplo`
- Create: `tests/unit/deploy-script.test.ts`

**Interfaces:**
- Consumes: `deploy/systemd/*` (Tarefa 3); `deploy/nginx/*` (Tarefa 4).
- Produces:
  - `/opt/n8necrm/deploy.sh <ref>` — atualização completa com rollback automático
  - `/opt/n8necrm/bootstrap.sh` — instalação de primeira vez, **idempotente**
  - o modelo do arquivo de ambiente, **sem nenhum valor**

- [ ] **Step 1: Escrever o teste que falha (RED)**

Criar `tests/unit/deploy-script.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const deploy = readFileSync("deploy/deploy.sh", "utf8");
const bootstrap = readFileSync("deploy/bootstrap.sh", "utf8");
const exemplo = readFileSync("deploy/n8necrm.env.exemplo", "utf8");

describe("scripts de deploy", () => {
  it("nenhum dos dois usa `set -x`", () => {
    // Os dois carregam /etc/n8necrm/n8necrm.env no proprio ambiente. `set -x`
    // imprimiria cada valor no journal, onde ele fica para sempre.
    expect(deploy).not.toMatch(/^\s*set\s+-[a-z]*x/m);
    expect(bootstrap).not.toMatch(/^\s*set\s+-[a-z]*x/m);
  });

  it("nenhum dos dois imprime o ambiente", () => {
    expect(deploy).not.toMatch(/^\s*(env|printenv)\s*$/m);
    expect(deploy).not.toMatch(/cat\s+.*n8necrm\.env/);
    expect(bootstrap).not.toMatch(/cat\s+.*n8necrm\.env(?!\.exemplo)/);
  });

  it("o modelo de ambiente não tem VALOR nenhum", () => {
    // Ele vai para um repositório PÚBLICO. Toda linha de variável termina em
    // `=` ou `=""`, e nada mais.
    const linhas = exemplo
      .split("\n")
      .filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l));
    expect(linhas.length).toBeGreaterThan(10);
    for (const linha of linhas) {
      expect(linha).toMatch(/^[A-Z_][A-Z0-9_]*=("")?$/);
    }
  });

  it("a migração roda DEPOIS do build e ANTES da troca do symlink", () => {
    // A ordem é a decisão. Migrar antes do build altera o banco por um build
    // que pode falhar; migrar depois da troca abre uma janela em que o código
    // novo consulta coluna que ainda não existe.
    const iBuild = deploy.indexOf("npm run build");
    const iMigrate = deploy.indexOf("migrate deploy");
    const iSymlink = deploy.indexOf("ln -sfn");
    expect(iBuild).toBeGreaterThan(-1);
    expect(iMigrate).toBeGreaterThan(iBuild);
    expect(iSymlink).toBeGreaterThan(iMigrate);
  });

  it("o deploy falha se houver .env dentro do release", () => {
    // Duas fontes de verdade para segredo. Pior: o Next leria o .env do
    // diretório EM VEZ do EnvironmentFile, em silêncio.
    expect(deploy).toMatch(/\$NOVO\/\.env/);
  });

  it("o deploy confere o major do Node", () => {
    // Metade da defesa contra a falta de isolamento de runtime do systemd no
    // host; a outra metade é o `engines` do package.json (Tarefa 1).
    expect(deploy).toContain("22");
    expect(deploy).toMatch(/node\s+(-v|--version)/);
  });

  it("o rollback do symlink está no script, não só na documentação", () => {
    // Rollback que depende de alguém lembrar do comando não é rollback.
    expect(deploy).toContain("ANTERIOR");
    expect(deploy).toMatch(/ln -sfn "\$ANTERIOR"/);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

```bash
npx vitest run tests/unit/deploy-script.test.ts
```

Esperado: **FAIL**, `ENOENT ... deploy/deploy.sh`. Cole a saída.

- [ ] **Step 3: `deploy/n8necrm.env.exemplo`**

```
# Modelo do arquivo de ambiente da VPS.
#
# DESTINO: /etc/n8necrm/n8necrm.env, root:root, modo 0600.
#
# ESTE ARQUIVO VAI PARA UM REPOSITORIO PUBLICO. Ele nunca carrega valor
# nenhum, e ha um caso de teste que afirma isso
# (tests/unit/deploy-script.test.ts). Os valores sao preenchidos A MAO na VPS.
#
# O significado de cada variavel esta em .env.example, na raiz do repositorio,
# com o comentario que explica o que quebra sem ela. Esta lista e so o
# INVENTARIO do que a VPS precisa -- se as duas divergirem, .env.example manda.
#
# Duas ausencias sao deliberadas: SEED_PASSWORD e E2E_SENHA. Producao nao roda
# seed nem suite e2e, e variavel presente e variavel que alguem um dia usa.

# --- Banco (Supabase REMOTO -- o container postgres da VPS e do n8n) --------
# 6543 (transaction pooler). Trocar as duas portas deixa `prisma migrate`
# PENDURADO sem imprimir nada.
DATABASE_URL=""
# 5432 (session pooler). NUNCA db.<projeto>.supabase.co: so resolve em IPv6.
DIRECT_URL=""

# --- Sessao -----------------------------------------------------------------
AUTH_SECRET=""
# https://crm.nateksoft.com -- sem ela, TODO login falha com UntrustedHost.
AUTH_URL=""
AUTH_TRUST_HOST=""

# --- Origem e borda ---------------------------------------------------------
# "x-real-ip". O nginx do CRM SOBRESCREVE esse cabecalho com $remote_addr.
# NUNCA "x-forwarded-for": aquele ACUMULA, e src/lib/ip.ts le o primeiro item
# da lista, que e o que o cliente escreveu.
IP_CABECALHO_CONFIAVEL=""

# --- Cofre (sem ela o WhatsApp inteiro nao sobe) -----------------------------
COFRE_CHAVE_MESTRA=""

# --- Fila -------------------------------------------------------------------
# Continua obrigatoria mesmo com a rota recusada no nginx: a rota existe no
# processo, e o nginx e uma camada, nao a defesa.
WHATSAPP_QUEUE_SECRET=""
# Opcional. Sem ela o alarme da vigia fica so em journald, onde ninguem olha.
FILA_SAUDE_ALERTA_URL=""

# --- Supabase ---------------------------------------------------------------
SUPABASE_URL=""
SUPABASE_SERVICE_ROLE_KEY=""
SUPABASE_PUBLISHABLE_KEY=""
SUPABASE_JWT_PRIVATE_JWK=""
# https://crm.nateksoft.com
SUPABASE_JWT_ISSUER=""

# --- Integracoes ------------------------------------------------------------
OPENAI_API_KEY=""
N8N_API_URL=""
N8N_API_KEY=""
RESEND_API_KEY=""

# --- Observabilidade --------------------------------------------------------
SENTRY_DSN=""
# "production". Sem ela TODO evento de producao e rotulado `local`.
SENTRY_ENVIRONMENT=""
# DEIXAR VAZIO.
SENTRY_DEBUG=""
```

- [ ] **Step 4: `deploy/bootstrap.sh`**

```bash
#!/usr/bin/env bash
#
# Instalacao de primeira vez do n8necrm nesta VPS. IDEMPOTENTE: rodar duas
# vezes nao quebra nada e nao sobrescreve o arquivo de ambiente.
#
# NAO instala nginx nem pede certificado -- isso e das Tarefas 9 e 10, que
# dependem de DNS. Este script para exatamente no ponto em que o CRM pode subir
# escutando so em 127.0.0.1, sem nome nenhum resolver.
#
# NUNCA `set -x` aqui: este script toca o caminho do arquivo de segredos.
set -Eeuo pipefail

BASE=/opt/n8necrm
ENVDIR=/etc/n8necrm
ENVFILE="$ENVDIR/n8necrm.env"
REPO_URL=https://github.com/nathanfvidal/n8necrm.git
USUARIO=n8necrm

if [ "$(id -u)" -ne 0 ]; then
  echo "ERRO: rode como root." >&2
  exit 1
fi

# --- 1. Usuario de servico, sem shell e sem home -----------------------------
# `--system` nao cria home nem entra na faixa de UID de gente. `nologin` porque
# este usuario nunca precisa entrar: quem faz deploy e o root pelo deploy.sh.
if ! id -u "$USUARIO" >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin "$USUARIO"
  echo "usuario $USUARIO criado"
else
  echo "usuario $USUARIO ja existe"
fi

# --- 2. Diretorios -----------------------------------------------------------
mkdir -p "$BASE/releases"
chown -R "$USUARIO:$USUARIO" "$BASE"

# 0700 no diretorio, alem do 0600 no arquivo: sem isto, outro usuario do
# sistema consegue LISTAR o diretorio e descobrir que o arquivo existe e qual e
# o nome dele.
mkdir -p "$ENVDIR"
chmod 0700 "$ENVDIR"
chown root:root "$ENVDIR"

# --- 3. Modelo do arquivo de ambiente, SEM sobrescrever ----------------------
# `-e` e nao `-f`: um arquivo existente com os segredos ja preenchidos nao pode
# ser tocado por uma reexecucao. Este e o unico estado deste script que, se
# perdido, nao se recupera de lugar nenhum.
if [ ! -e "$ENVFILE" ]; then
  install -m 0600 -o root -g root /dev/null "$ENVFILE"
  echo "MODELO criado em $ENVFILE (VAZIO -- preencher a mao)."
  echo "     Fonte do modelo: $BASE/repo/deploy/n8necrm.env.exemplo"
else
  echo "$ENVFILE ja existe -- NAO foi tocado."
fi

# --- 4. Espelho do repositorio ----------------------------------------------
# Um clone so, reaproveitado por todo deploy. `git archive` extrai dele para
# cada release, entao nenhuma release carrega um .git de 60 MB.
if [ ! -d "$BASE/repo/.git" ]; then
  git clone "$REPO_URL" "$BASE/repo"
else
  git -C "$BASE/repo" remote set-url origin "$REPO_URL"
  git -C "$BASE/repo" fetch --prune origin
fi

# --- 5. Units do systemd ----------------------------------------------------
# Copia, e nao symlink para dentro do repo: um symlink faria o systemd carregar
# um arquivo que muda sozinho no `git fetch` seguinte, sem `daemon-reload`.
install -m 0644 -o root -g root "$BASE/repo/deploy/systemd/n8necrm-web.service"    /etc/systemd/system/
install -m 0644 -o root -g root "$BASE/repo/deploy/systemd/n8necrm-worker.service" /etc/systemd/system/
install -m 0644 -o root -g root "$BASE/repo/deploy/systemd/n8necrm-saude.service"  /etc/systemd/system/
install -m 0644 -o root -g root "$BASE/repo/deploy/systemd/n8necrm-saude.timer"    /etc/systemd/system/
systemctl daemon-reload

# --- 6. O script de deploy --------------------------------------------------
install -m 0700 -o root -g root "$BASE/repo/deploy/deploy.sh" "$BASE/deploy.sh"

echo
echo "bootstrap concluido. NADA foi habilitado nem iniciado ainda."
echo "Proximo passo: preencher $ENVFILE e rodar $BASE/deploy.sh main"
```

- [ ] **Step 5: `deploy/deploy.sh`**

```bash
#!/usr/bin/env bash
#
# Atualiza o n8necrm nesta VPS.
#
#     /opt/n8necrm/deploy.sh [ref]     (padrao: main)
#
# A ORDEM E A DECISAO deste arquivo, e ela esta em
# docs/superpowers/plans/2026-08-21-n8necrm-deploy-vps.md, Decisao 7:
#
#   checagens -> ambiente -> fetch -> extrai -> npm ci -> BUILD ->
#   MIGRATE -> troca o symlink -> restart -> fumaca -> (falhou? volta) -> poda
#
# O release anterior continua SERVINDO durante o build inteiro. Build que falha
# nao derruba nada.
#
# NUNCA `set -x`: este script carrega /etc/n8necrm/n8necrm.env no proprio
# ambiente, e o rastreio imprimiria cada segredo no journal, onde fica para
# sempre.
set -Eeuo pipefail

BASE=/opt/n8necrm
REPO="$BASE/repo"
RELEASES="$BASE/releases"
ATUAL="$BASE/current"
ENVFILE=/etc/n8necrm/n8necrm.env
USUARIO=n8necrm
REF="${1:-main}"
MANTER=3
DISCO_MINIMO_GB=10

falhar() { echo "ERRO: $*" >&2; exit 1; }

# --- 1. Checagens que falham CEDO -------------------------------------------
# Todas antes de qualquer efeito colateral. Descobrir que o Node esta errado
# depois de 4 minutos de build e desperdicio; descobrir depois do symlink
# trocado e incidente.
[ "$(id -u)" -eq 0 ] || falhar "rode como root."
[ -f "$ENVFILE" ]    || falhar "$ENVFILE nao existe. Rode o bootstrap.sh primeiro."

MODO=$(stat -c %a "$ENVFILE")
[ "$MODO" = "600" ] || falhar "$ENVFILE esta com modo $MODO; tem de ser 600. Corrija: chmod 600 $ENVFILE"

NODE_MAJOR=$(node -v | sed 's/^v\([0-9]*\).*/\1/')
[ "$NODE_MAJOR" = "22" ] || falhar "Node major e $NODE_MAJOR; este projeto exige 22 (ver engines no package.json). Sem Docker, o runtime e o do host -- um apt upgrade pode ter trocado."

LIVRE_GB=$(df --output=avail -BG "$BASE" | tail -1 | tr -dc '0-9')
[ "$LIVRE_GB" -ge "$DISCO_MINIMO_GB" ] || falhar "so ha ${LIVRE_GB}G livres; sao necessarios ${DISCO_MINIMO_GB}G. Cada release carrega node_modules inteiro (~1,2G) e o .next."

# --- 2. Carrega o ambiente --------------------------------------------------
# `set -a` exporta tudo o que for definido a seguir. Sem ele as variaveis
# ficariam locais ao shell e nem `next build` nem `prisma migrate` as veriam.
#
# O build PRECISA delas: src/lib/env.ts valida DATABASE_URL e AUTH_SECRET em
# escopo de modulo, e `next build` avalia modulos alcancaveis. Isso e uma trava
# a favor -- ambiente errado derruba o build, nao a producao.
set -a
# shellcheck disable=SC1090
. "$ENVFILE"
set +a

[ -n "${DATABASE_URL:-}" ] || falhar "DATABASE_URL vazia em $ENVFILE."
# ATENCAO A ESTAS MENSAGENS: nada de crase dentro de aspas duplas em shell --
# ela e substituicao de comando, e "`prisma migrate`" TENTARIA EXECUTAR
# `prisma migrate` no meio da mensagem de erro. Este defeito existiu numa
# redacao anterior deste arquivo e foi corrigido na auto-revisao do plano.
[ -n "${DIRECT_URL:-}" ]   || falhar "DIRECT_URL vazia em $ENVFILE. Sem ela, 'prisma migrate' PENDURA sem imprimir nada."

# A confusao mais cara deste projeto, checada em vez de lembrada.
case "$DATABASE_URL" in *:6543*) ;; *) falhar "DATABASE_URL nao aponta para a porta 6543 (transaction pooler)." ;; esac
case "$DIRECT_URL"   in *:5432*) ;; *) falhar "DIRECT_URL nao aponta para a porta 5432 (session pooler). Com a 6543 aqui, 'prisma migrate' PENDURA sem imprimir nada -- parece lentidao, e falha." ;; esac

# --- 3. Resolve o commit ----------------------------------------------------
git -C "$REPO" fetch --prune origin
COMMIT=$(git -C "$REPO" rev-parse "origin/$REF") || falhar "ref '$REF' nao existe em origin."
CURTO=${COMMIT:0:7}
NOVO="$RELEASES/$(date -u +%Y%m%d%H%M%S)-$CURTO"

echo "==> release: $NOVO  (origin/$REF = $COMMIT)"

# --- 4. Extrai -------------------------------------------------------------
# `git archive` e nao `git clone`: nenhuma release carrega um .git proprio, e o
# conteudo extraido e exatamente a arvore daquele commit -- sem estado de
# working tree, sem branch, sem nada que possa divergir.
mkdir -p "$NOVO"
git -C "$REPO" archive "$COMMIT" | tar -x -C "$NOVO"

# --- 5. Guarda anti-.env ----------------------------------------------------
# Duas fontes de verdade para segredo. E o pior caso e silencioso: o Next
# carrega o .env do diretorio de trabalho e ele GANHA de partes do ambiente,
# entao a VPS passaria a rodar com valores que ninguem sabe de onde vieram.
if [ -e "$NOVO/.env" ]; then
  rm -rf "$NOVO"
  falhar "o commit $CURTO contem um .env versionado. Duas fontes de verdade para segredo -- e o Next leria ESSE em vez de $ENVFILE, em silencio. Remova-o do repositorio."
fi

# --- 6. Dependencias --------------------------------------------------------
# COM devDependencies, de proposito: `next build` precisa delas, e o worker
# precisa do `tsx` EM RUNTIME (scripts/fila-worker.ts nao faz parte do build do
# Next). `--omit=dev` aqui produziria um build que falha e, se passasse, um
# worker que nao sobe.
#
# `npm ci` roda o postinstall `prisma generate` sozinho.
cd "$NOVO"
npm ci --no-audit --no-fund

# --- 7. Build ---------------------------------------------------------------
# `nice -n 10`: a maquina tem 2 vCPU e cinco containers de pe (n8n, o worker do
# n8n, Evolution, postgres, redis). Qualquer coisa que eles precisem de CPU tem
# prioridade sobre este build. E o release ANTERIOR continua servindo o tempo
# todo -- build que falha aborta aqui sem tocar em producao nem no banco.
echo "==> build (nice 10; o release anterior continua servindo)"
nice -n 10 npm run build

# --- 8. Migracao ------------------------------------------------------------
# AQUI, e nao antes nem depois:
#   - depois do npm ci, porque precisa do CLI e do cliente gerado;
#   - depois do build, porque migrar para um build que vai falhar altera o
#     banco por nada;
#   - antes da troca, porque o codigo novo pode depender de coluna nova.
#
# CONSEQUENCIA QUE PRECISA ESTAR ESCRITA: entre esta linha e o restart, o
# codigo ANTIGO roda contra o schema NOVO. Toda migracao tem de ser compativel
# com a versao anterior -- e a disciplina expande -> migra -> contrai que este
# projeto usa desde o Ciclo 2d. Migracao destrutiva derruba o CRM nesta janela.
#
# E ela NAO e revertida pelo rollback abaixo: o Prisma nao tem migracao de
# volta, e desfazer schema automaticamente perderia dado.
echo "==> prisma migrate deploy (usa DIRECT_URL, porta 5432)"
npx prisma migrate deploy

# --- 9. Troca atomica -------------------------------------------------------
ANTERIOR=$(readlink -f "$ATUAL" 2>/dev/null || true)
chown -R "$USUARIO:$USUARIO" "$NOVO"
ln -sfn "$NOVO" "$ATUAL"
echo "==> current -> $NOVO   (anterior: ${ANTERIOR:-nenhum})"

# --- 10. Restart ------------------------------------------------------------
systemctl restart n8necrm-web n8necrm-worker

# --- 11. Fumaca -------------------------------------------------------------
# /login e a unica pagina publica: todo o resto redireciona para ela. Nao ha
# endpoint de saude neste projeto e este plano NAO cria um -- rota nova e
# superficie nova, e /login ja exercita o mesmo caminho (processo de pe, Next
# servindo, roteador respondendo).
#
# O QUE ESTA FUMACA NAO PROVA, dito em voz alta: que o banco responde, que o
# login funciona (AUTH_URL aponta para https://crm..., entao um POST via
# 127.0.0.1 seria recusado de proposito) e que o worker esta drenando. Quem
# prova o worker e `n8necrm-saude`, em ate 5 minutos.
echo "==> fumaca: GET http://127.0.0.1:3000/login"
OK=0
for _ in $(seq 1 30); do
  CODIGO=$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/login 2>/dev/null || echo 000)
  if [ "$CODIGO" = "200" ]; then OK=1; break; fi
  sleep 2
done

if [ "$OK" -ne 1 ]; then
  echo "FUMACA FALHOU (ultimo codigo: ${CODIGO:-000}). Revertendo o symlink." >&2
  if [ -n "$ANTERIOR" ] && [ -d "$ANTERIOR" ]; then
    ln -sfn "$ANTERIOR" "$ATUAL"
    systemctl restart n8necrm-web n8necrm-worker
    echo "revertido para $ANTERIOR. ATENCAO: a MIGRACAO nao foi revertida." >&2
  else
    echo "NAO HA release anterior para voltar -- este e o primeiro deploy." >&2
    echo "Diagnostico: journalctl -u n8necrm-web -n 80 --no-pager" >&2
  fi
  exit 1
fi

# --- 12. Worker de pe -------------------------------------------------------
# `is-active` responde so "o processo existe" -- e por isso que a vigia
# n8necrm-saude existe. Mas `failed` aqui e informacao imediata e barata.
systemctl is-active --quiet n8necrm-worker || {
  echo "AVISO: n8necrm-worker NAO esta ativo. O WhatsApp nao vai responder." >&2
  echo "       journalctl -u n8necrm-worker -n 50 --no-pager" >&2
}

# --- 13. Poda ---------------------------------------------------------------
# Mantem as 3 mais novas. `-mindepth 1 -maxdepth 1` e a ordenacao por mtime
# evitam tanto apagar o proprio $RELEASES quanto depender de o nome ordenar --
# e o guard do `readlink` garante que a release em uso nunca entra na lista.
EM_USO=$(readlink -f "$ATUAL")
# shellcheck disable=SC2012
ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +$((MANTER + 1)) | while read -r velha; do
  if [ "$(readlink -f "$velha")" != "$EM_USO" ]; then
    rm -rf "$velha"
    echo "podado: $velha"
  fi
done

echo
echo "==> OK. release em uso: $NOVO"
echo
echo "Para REVERTER:"
echo "  ln -sfn ${ANTERIOR:-<release-anterior>} $ATUAL"
echo "  systemctl restart n8necrm-web n8necrm-worker"
echo "  (a MIGRACAO nao volta -- o Prisma nao tem migracao de volta)"
```

- [ ] **Step 6: GREEN e conferência de sintaxe**

```bash
npx vitest run tests/unit/deploy-script.test.ts
bash -n deploy/deploy.sh && echo "deploy.sh: sintaxe OK"
bash -n deploy/bootstrap.sh && echo "bootstrap.sh: sintaxe OK"
```

Esperado: os sete casos passando e as duas linhas de sintaxe OK. `bash -n` **analisa sem executar** — não toca a VPS nem roda nada. Cole as três saídas.

⚠️ Se `bash` não estiver disponível nesta máquina Windows, rode pelo Git Bash. Se ainda assim não der, marque como 🔍 **NÃO VERIFICADO** e passe o comando adiante — a Tarefa 7 roda `bash -n` na própria VPS antes de executar qualquer coisa.

- [ ] **Step 7: Commit**

```
feat(deploy): deploy.sh e bootstrap.sh, com rollback dentro do script

Rollback que depende de alguem lembrar do comando nao e rollback: a
fumaca falhando devolve o symlink sozinha e reinicia. O que ela NAO
desfaz esta escrito ali e no fim de toda execucao -- a migracao fica, o
Prisma nao tem migracao de volta e desfazer schema perderia dado.

A ordem e a decisao: build antes da migracao (migrar para um build que
vai falhar altera o banco por nada), migracao antes da troca (codigo novo
pode depender de coluna nova). O preco esta escrito no comentario: entre
migrar e reiniciar, o codigo ANTIGO roda contra o schema NOVO, entao toda
migracao tem de ser compativel com a versao anterior.

As checagens vem todas antes de qualquer efeito: root, modo 0600 do
arquivo de ambiente, major do Node (sem Docker o runtime e o do host),
disco, e as portas 6543/5432 -- essa ultima checada em vez de lembrada,
porque trocar as duas pendura o migrate sem imprimir nada.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

### Task 6: `docs/DEPLOY.md` e os documentos vivos

🖥️ **TOCA A VPS:** não. **AÇÃO DO DONO:** não.

**Files:**
- Create: `docs/DEPLOY.md`
- Modify: `docs/ESTADO.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: tudo o que as Tarefas 1–5 produziram.
- Produces: o runbook que a Tarefa 11 verifica, e a decisão de hospedagem registrada onde ela é lida a cada sessão.

- [ ] **Step 1: `docs/DEPLOY.md`**

Criar, com **exatamente** este esqueleto (o conteúdo de cada seção vem das Tarefas 1–5 e do plano; **não invente comando novo**):

```markdown
# Deploy do n8necrm

Máquina: `76.13.224.40` (Ubuntu 24.04), a mesma onde rodam n8n e Evolution.
Origem pública: `https://crm.nateksoft.com`.
Acesso: `ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40`
(a chave `myp_deploy_ed25519` **não** funciona nesta máquina).

## O mapa

| O quê | Onde |
| --- | --- |
| Código em uso | `/opt/n8necrm/current` → `releases/<ts>-<sha>` |
| Espelho do repositório | `/opt/n8necrm/repo` |
| Segredos | `/etc/n8necrm/n8necrm.env` — `root:root`, `0600` |
| Script de atualização | `/opt/n8necrm/deploy.sh` |
| Units | `/etc/systemd/system/n8necrm-{web,worker,saude}.service`, `n8necrm-saude.timer` |
| nginx do CRM | `/etc/nginx/sites-available/crm.nateksoft.com` (symlink em `sites-enabled/`) |
| nginx de n8n e Evolution | `/opt/nateksoft/nginx/nateksoft.conf` — **não é do CRM** |
| Banco | Supabase **remoto** — o container `postgres` da VPS é do n8n |
| Fonte de verdade de tudo acima | este repositório, em `deploy/` |

## Atualizar

    ssh root@76.13.224.40
    /opt/n8necrm/deploy.sh main

## Reverter

    ls -1dt /opt/n8necrm/releases/*/
    ln -sfn /opt/n8necrm/releases/<anterior> /opt/n8necrm/current
    systemctl restart n8necrm-web n8necrm-worker

A **migração não volta** — o Prisma não tem migração de volta. Por isso toda
migração precisa ser compatível com a versão anterior.

## Está no ar?

    systemctl status n8necrm-web n8necrm-worker n8necrm-saude.timer
    curl -sI https://crm.nateksoft.com/login | head -1
    journalctl -u n8necrm-worker -n 50 --no-pager

## O WhatsApp emudeceu

A vigia responde em até 5 minutos:

    systemctl start n8necrm-saude && systemctl status n8necrm-saude

`0` saudável · `1` fila parada · `2` não consegui perguntar ao banco.

## Ações do dono ainda pendentes

- [ ] `FILA_SAUDE_ALERTA_URL` → webhook do n8n local. Sem ela o alarme fica
      só em journald, onde ninguém está olhando.
- [ ] `jwks_url` do Supabase → `https://crm.nateksoft.com/api/jwks`
- [ ] URL de webhook no painel da Evolution
- [ ] Decidir se o repositório continua público
- [ ] Considerar `ufw` — hoje **inativo**

## As sete decisões, e o custo do recusado

Estão em `docs/superpowers/plans/2026-08-21-n8necrm-deploy-vps.md`.
**Não as repita aqui** — duas cópias divergem, e a que alguém lê é sempre a
errada.
```

- [ ] **Step 2: `docs/ESTADO.md`**

Substituir a seção **"### 4. Escolher a hospedagem, e ligar o gatilho da fila"** por:

```markdown
### 4. Hospedagem: DECIDIDA em 2026-08-21 — a propria VPS

A decisão de hospedagem deixou de estar em aberto. O CRM vai para
`76.13.224.40`, a mesma VPS de n8n e Evolution, sob **systemd** (não Docker),
com o **worker** (`fila:worker`) como gatilho da fila — não agendador.

O runbook é `docs/DEPLOY.md`. O plano, com as sete decisões e o custo de cada
alternativa recusada, é
`docs/superpowers/plans/2026-08-21-n8necrm-deploy-vps.md`.

**O que essa decisão fechou, e que estava aberto aqui:**

- O gatilho da fila é o worker. A rota `/api/queues/whatsapp-turn` passa a ser
  **recusada na borda** (`return 404` no nginx), porque nada legítimo a chama
  de fora. `WHATSAPP_QUEUE_SECRET` continua obrigatória — a recusa no nginx é
  uma camada, não a defesa.
- `IP_CABECALHO_CONFIAVEL="x-real-ip"`, com
  `proxy_set_header X-Real-IP $remote_addr;` no nginx.
- `SENTRY_ENVIRONMENT="production"`,
  `SUPABASE_JWT_ISSUER="https://crm.nateksoft.com"`.

**O que ela ABRIU, e não estava aqui antes:** `AUTH_URL` e `AUTH_TRUST_HOST`.
Sem as duas, `next start` sobe, desenha o formulário e falha em **todo** login
com `UntrustedHost` — o aviso existia desde 2026-08 dentro de
`playwright.config.ts`, onde quem faz deploy não olha. Agora está no
`.env.example`.
```

- [ ] **Step 3: `CLAUDE.md`**

Na seção **"Decisões travadas"**, substituir o item 6 por:

```markdown
6. **Hospedagem: a própria VPS `76.13.224.40`**, sob systemd, ao lado de n8n e
   Evolution. **Reaberta e refechada duas vezes:** era Vercel (2026-08-19),
   virou "em aberto" no Ciclo 2d (2026-08-21), e fechou na VPS no mesmo dia. A
   fila é uma tabela do Postgres desde o Ciclo 2d e o gatilho é o **worker**
   (`npm run fila:worker`) como serviço supervisionado — não agendador. Ver
   `docs/DEPLOY.md` e
   `docs/superpowers/plans/2026-08-21-n8necrm-deploy-vps.md`.
```

E acrescentar à seção **"Armadilhas conhecidas"**:

```markdown
- **`AUTH_URL` e `AUTH_TRUST_HOST` não são opcionais em produção.** Sem elas o
  Auth.js v5 recusa **todo** login com `UntrustedHost` — mas só sob
  `NODE_ENV=production`, então `next dev` nunca mostra o problema e `next
  start` sempre mostra. O aviso viveu por meses só dentro de
  `playwright.config.ts`.
- **Mexer em `/opt/nateksoft/nginx/nateksoft.conf` pode derrubar n8n e
  Evolution.** Há precedente: uma edição anterior daquele arquivo, e um
  `docker-compose` v1 que tirou o n8n do ar por ~90 s. O CRM vive num arquivo
  **separado** em `sites-available/`, e a precedência de `server_name` exato
  sobre curinga é o que torna isso possível. `nginx -t` antes de todo
  `reload`, sempre.
- **A VPS não tem `ufw` ativo** (medido em 2026-08-21). É por isso que
  `next start` escuta em `127.0.0.1` e não em `0.0.0.0`: sem esse bind,
  qualquer um fala com a aplicação direto e escreve o `X-Real-IP` que quiser,
  e o `AuditLog` passa a guardar IP forjado.
```

- [ ] **Step 4: Provar que nada histórico foi tocado**

```bash
git status --short docs/ CLAUDE.md
git diff --stat docs/ CLAUDE.md
```

Esperado: **só** `docs/DEPLOY.md` (novo), `docs/ESTADO.md`, `CLAUDE.md` e o plano deste ciclo. **Nenhum arquivo de `docs/auditorias/` e nenhum plano ou spec de ciclo já executado.** Se aparecer, **pare e reverta**.

- [ ] **Step 5: Commit**

```
docs(deploy): a decisao 6 fecha na VPS, e o runbook existe

A hospedagem foi reaberta e refechada duas vezes em tres dias -- Vercel,
"em aberto", VPS. O CLAUDE.md registra as tres, e nao so a ultima: um
leitor que encontre "em aberto" sem saber que fechou vai perguntar de
novo, e um que encontre "Vercel" vai agir errado.

docs/DEPLOY.md e o runbook e nao repete as decisoes: duas copias divergem,
e a que alguem le e sempre a errada.

Tres armadilhas novas entram: AUTH_URL/AUTH_TRUST_HOST (o aviso viveu
meses dentro do playwright.config.ts), nginx compartilhado com n8n e
Evolution, e a VPS sem ufw -- que e o motivo de o bind ser 127.0.0.1.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

### Task 7: 🖥️ Bootstrap da VPS — usuário, diretórios, segredos, units

🖥️ **TOCA A VPS: SIM.** Todo passo carrega **COMO REVERTER**.
🔑 **AÇÃO DO DONO: SIM** — os **valores dos segredos** (ação 2). Sem eles a tarefa para no Step 4 e reporta.
**DEPENDE DE DNS: não.**

**Regra desta tarefa inteira:** nenhum passo aqui **inicia** ou **habilita** serviço nenhum. O bootstrap deixa tudo instalado e desligado; quem liga é a Tarefa 8. E **nenhum container é tocado**.

**Files:** nenhum arquivo do repositório é modificado. Só a VPS.

**Interfaces:**
- Consumes: `deploy/bootstrap.sh`, `deploy/systemd/*`, `deploy/n8necrm.env.exemplo` — todos vindos do **repositório publicado**, então a branch `deploy-vps` das Tarefas 1–6 precisa **já estar em `origin/main`** ou o passo 4 do bootstrap traz código velho.
- Produces na VPS: usuário `n8necrm`, `/opt/n8necrm/{repo,releases}`, `/etc/n8necrm/n8necrm.env` preenchido, quatro units instaladas e **paradas**, `/opt/n8necrm/deploy.sh`.

- [ ] **Step 1: ⚠️ PARADA OBRIGATÓRIA — o código precisa estar publicado**

```bash
cd "d:/Projetos Programação/N8n + Crm"
git log --oneline origin/main -1
git log --oneline -1
```

O `bootstrap.sh` clona de `origin`. Se as Tarefas 1–6 ainda não estiverem em `origin/main`, **PARE E REPORTE**: o `AGENTS.md` proíbe push antes da auditoria de segurança, e este plano não o autoriza.

**A saída correta desta parada é reportar ao dono**, com estas duas opções, e **esperar a escolha dele**:
- **(a)** rodar a Fase 1 da `auditoria-seguranca` sobre as Tarefas 1–6 **agora**, integrar, e só então seguir; ou
- **(b)** fazer o bootstrap a partir de uma branch, trocando `main` por `deploy-vps` no `git clone`/`fetch` e no argumento de `deploy.sh` — e **registrar essa escolha no relatório**, porque uma VPS servindo uma branch não auditada é uma dívida, não um estado final.

**COMO REVERTER:** nada foi feito ainda.

- [ ] **Step 2: 🖥️ Fotografar o estado ANTES de tocar em qualquer coisa**

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  echo "=== containers ==="; docker ps --format "{{.Names}}\t{{.Status}}"
  echo "=== nginx ==="; systemctl is-active nginx; nginx -t 2>&1 | tail -2
  echo "=== n8n e evolution respondem ==="
  curl -s -o /dev/null -w "n8n:%{http_code}\n"       --max-time 10 https://n8n.nateksoft.com/
  curl -s -o /dev/null -w "evolution:%{http_code}\n" --max-time 10 https://evolution.nateksoft.com/
  echo "=== portas ==="; ss -lntp | grep -E ":(80|443|3000|3001|5678|8080) "
  echo "=== disco ==="; df -h / | tail -1
  echo "=== ja existe algo do CRM? ==="
  ls -d /opt/n8necrm /etc/n8necrm 2>&1
  systemctl list-unit-files "n8necrm*" 2>&1 | tail -5
'
```

**Cole a saída inteira. Ela é a linha de base contra a qual a Tarefa 11 compara.** Os cinco containers têm de estar `Up`, `nginx -t` tem de dizer `syntax is ok` **e** `test is successful`, e n8n e Evolution têm de responder um código HTTP (qualquer 2xx/3xx/4xx serve — o que importa é **responder**).

Se `/opt/n8necrm` ou units `n8necrm*` já existirem, **pare e reporte**: alguém rodou isto antes e o estado não é o que este plano presume.

**COMO REVERTER:** só leitura. Nada a reverter.

- [ ] **Step 3: 🖥️ Rodar o bootstrap**

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  set -e
  cd /tmp
  rm -rf n8necrm-boot
  git clone --depth 1 https://github.com/nathanfvidal/n8necrm.git n8necrm-boot
  bash -n n8necrm-boot/deploy/bootstrap.sh && echo "sintaxe OK"
  bash n8necrm-boot/deploy/bootstrap.sh
'
```

Esperado: `sintaxe OK`, depois `usuario n8necrm criado`, `MODELO criado em /etc/n8necrm/n8necrm.env (VAZIO -- preencher a mao)`, o clone do repositório, e `bootstrap concluido. NADA foi habilitado nem iniciado ainda.` Cole a saída.

⚠️ Se o clone falhar por o repositório ser privado, **pare e reporte** — isso contradiz a medição (HTTP 200 sem token) e vira ação do dono.

**COMO REVERTER (o bootstrap inteiro):**

```bash
systemctl disable --now n8necrm-web n8necrm-worker n8necrm-saude.timer 2>/dev/null || true
rm -f /etc/systemd/system/n8necrm-{web,worker,saude}.service /etc/systemd/system/n8necrm-saude.timer
systemctl daemon-reload
rm -rf /opt/n8necrm /tmp/n8necrm-boot
rm -rf /etc/n8necrm            # CUIDADO: apaga os segredos
userdel n8necrm 2>/dev/null || true
```

Nada disso toca nginx, container nenhum, nem o Supabase.

- [ ] **Step 4: 🔑 AÇÃO DO DONO + 🖥️ Preencher os segredos**

**Este passo não é executável por um agente.** O modelo está em `/opt/n8necrm/repo/deploy/n8necrm.env.exemplo`; o destino é `/etc/n8necrm/n8necrm.env`.

Entregue ao dono **esta lista**, e nada além dela:

| Variável | Como obter |
| --- | --- |
| `DATABASE_URL` | Supabase → Connect → **Transaction pooler** (`:6543`) |
| `DIRECT_URL` | Supabase → Connect → **Session pooler** (`:5432`) |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_URL` | `https://crm.nateksoft.com` |
| `AUTH_TRUST_HOST` | `true` |
| `IP_CABECALHO_CONFIAVEL` | `x-real-ip` |
| `COFRE_CHAVE_MESTRA` | `openssl rand -base64 32` — **perder é perder os segredos cifrados** |
| `WHATSAPP_QUEUE_SECRET` | `openssl rand -hex 32` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY` | Supabase → Settings → API |
| `SUPABASE_JWT_PRIVATE_JWK` | **reaproveitar a que já existe** — gerar uma nova invalidaria os tokens já emitidos |
| `SUPABASE_JWT_ISSUER` | `https://crm.nateksoft.com` |
| `OPENAI_API_KEY`, `N8N_API_KEY`, `RESEND_API_KEY`, `SENTRY_DSN` | painéis respectivos |
| `N8N_API_URL` | `https://n8n.nateksoft.com` |
| `SENTRY_ENVIRONMENT` | `production` |
| `SENTRY_DEBUG` | **vazio** |
| `FILA_SAUDE_ALERTA_URL` | opcional; webhook do n8n local |

**Reforçar ao dono, textualmente:**
- **`COFRE_CHAVE_MESTRA` é a única credencial fora do banco.** Sem ela o WhatsApp inteiro não sobe, e **não existe fallback para texto puro** em lugar nenhum do cofre — de propósito. Guarde-a num gerenciador de segredos, não só na VPS.
- **`SUPABASE_JWT_PRIVATE_JWK` é a chave que assina todo token** que o Supabase aceita como `role: authenticated`. Reaproveite a existente.
- **A porta importa.** 6543 na `DATABASE_URL`, 5432 na `DIRECT_URL`. Trocar deixa `prisma migrate` pendurado sem imprimir nada. O `deploy.sh` **checa isso** e falha alto — mas checa depois de o dono já ter errado.

- [ ] **Step 5: 🖥️ Conferir o arquivo SEM ler valor nenhum**

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  stat -c "%a %U:%G %n" /etc/n8necrm /etc/n8necrm/n8necrm.env
  echo "=== nomes de variavel definidos (SEM VALOR) ==="
  grep -oE "^[A-Z_][A-Z0-9_]*=" /etc/n8necrm/n8necrm.env | tr -d "=" | sort
  echo "=== quantas estao VAZIAS ==="
  grep -cE "^[A-Z_][A-Z0-9_]*=(\"\")?$" /etc/n8necrm/n8necrm.env
'
```

Esperado: `700 root:root /etc/n8necrm` e `600 root:root /etc/n8necrm/n8necrm.env`; a lista de nomes contendo **pelo menos** `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `AUTH_URL`, `AUTH_TRUST_HOST`, `COFRE_CHAVE_MESTRA`, `WHATSAPP_QUEUE_SECRET`, `IP_CABECALHO_CONFIAVEL`, `SUPABASE_JWT_PRIVATE_JWK`, `SUPABASE_JWT_ISSUER`, `SENTRY_ENVIRONMENT`; e a contagem de vazias sendo **só** as opcionais.

⚠️ **`grep -oE "...="` corta o valor no `=`.** Nenhum comando deste passo imprime conteúdo de variável. Se precisar conferir mais alguma coisa, confira **presença**, nunca valor.

**COMO REVERTER:** só leitura.

- [ ] **Step 6: 🖥️ Provar que os segredos não vazam por `systemctl show`**

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  systemctl show n8necrm-web -p EnvironmentFiles -p Environment
'
```

Esperado: `EnvironmentFiles=/etc/n8necrm/n8necrm.env (ignore_errors=no)` e `Environment=NODE_ENV=production`. **Nenhum valor de segredo na saída.** Cole-a inteira — ela é a prova de que a Decisão 6 se sustenta, e é a única forma de provar isso sem confiar na documentação do systemd.

Se algum valor de segredo aparecer, **PARE IMEDIATAMENTE E REPORTE**: significa que alguma unit tem `Environment=` com segredo, o que o teste da Tarefa 3 deveria ter impedido.

**COMO REVERTER:** só leitura.

- [ ] **Step 7: 🖥️ Confirmar que NADA foi ligado, e que o stack continua inteiro**

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  systemctl is-enabled n8necrm-web n8necrm-worker n8necrm-saude.timer 2>&1
  systemctl is-active  n8necrm-web n8necrm-worker n8necrm-saude.timer 2>&1
  docker ps --format "{{.Names}}\t{{.Status}}"
  systemctl is-active nginx
'
```

Esperado: `disabled` e `inactive` para as três (esse é o resultado **correto** deste passo), os cinco containers ainda `Up`, e o nginx `active`. Cole a saída.

- [ ] **Step 8: Relatar (não há commit — nada mudou no repositório)**

Esta tarefa **não gera commit**. Reporte: a saída do Step 2 (linha de base), a do Step 6 (prova do não vazamento), a do Step 7, e a escolha feita no Step 1 (a ou b).

---

### Task 8: 🖥️ O primeiro release, em `127.0.0.1:3000` — sem DNS nenhum

🖥️ **TOCA A VPS: SIM.**
🔑 **AÇÃO DO DONO:** não.
**DEPENDE DE DNS: NÃO — e isso é o ponto desta tarefa.**

**Por que esta tarefa vem antes do nginx e do DNS.** Build, migração e as duas units são onde as coisas de fato quebram; nome e certificado são encanamento. Provando o CRM funcionando em `127.0.0.1:3000` **antes** de qualquer nome resolver, um erro depois é inequívoco: se `https://crm.nateksoft.com` falhar mas `127.0.0.1:3000` responder, o problema é da borda, e não do CRM. Sem esta separação, as duas causas chegam juntas.

**Files:** nenhum no repositório.

**Interfaces:**
- Consumes: tudo o que a Tarefa 7 instalou.
- Produces na VPS: `/opt/n8necrm/current` apontando para o primeiro release; `n8necrm-web` e `n8necrm-worker` **ativos e habilitados**; `n8necrm-saude.timer` ativo; o schema do Supabase **migrado**.

- [ ] **Step 1: 🖥️ Medir o banco ANTES de migrar**

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  cd /opt/n8necrm/repo
  set -a; . /etc/n8necrm/n8necrm.env; set +a
  npx --yes prisma@7.9.1 migrate status --schema prisma/schema.prisma 2>&1 | tail -20
'
```

Esperado: `Database schema is up to date!` — o banco é o **mesmo** que o desenvolvimento usa, e a `main` já foi migrada de lá. Cole a saída.

⚠️ **Se ficar mais de 60 s sem imprimir nada, MATE o comando (Ctrl+C) e pare.** É a assinatura exata de `DIRECT_URL` na porta errada. O `deploy.sh` checa isso, mas este comando roda antes dele.

⚠️ Se aparecer migração **pendente**, **pare e reporte** antes de aplicar: aplicar migração alheia não é desta tarefa.

**COMO REVERTER:** só leitura.

- [ ] **Step 2: 🖥️ Validar as units antes de habilitar**

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  systemd-analyze verify /etc/systemd/system/n8necrm-web.service \
                         /etc/systemd/system/n8necrm-worker.service \
                         /etc/systemd/system/n8necrm-saude.service \
                         /etc/systemd/system/n8necrm-saude.timer 2>&1 | head -30
  echo "=== fim da verificacao (vazio acima = tudo ok) ==="
'
```

Esperado: **nenhuma linha** antes do marcador, ou só avisos sobre executáveis inexistentes (`/opt/n8necrm/current/...` ainda não existe — o symlink nasce no Step 3). Erro de **sintaxe** de unit, **pare e reporte**: é defeito da Tarefa 3, e corrigi-lo direto na VPS faria a máquina divergir do repositório.

**COMO REVERTER:** só leitura.

- [ ] **Step 3: 🖥️ O primeiro deploy**

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  /usr/bin/time -v /opt/n8necrm/deploy.sh main 2>&1 | tail -60
'
```

⚠️ **Este comando demora.** É `npm ci` (~1,2 GB) mais `next build` em 2 vCPU, com `nice -n 10`. Use **timeout de 20 minutos**. Não o interrompa por parecer travado — o `nice` faz exatamente isso parecer.

⚠️ **A fumaça vai falhar neste primeiro deploy, e é esperado**, porque as units ainda não estão habilitadas: o `systemctl restart` do passo 10 sobe os serviços, mas se algo estiver errado não há release anterior para voltar, e o script diz isso (`NAO HA release anterior para voltar -- este e o primeiro deploy`). **Se a fumaça passar, ótimo — os serviços subiram no `restart`.** Se falhar, siga para o Step 4 antes de concluir qualquer coisa.

Registre da saída de `/usr/bin/time -v`: **`Elapsed (wall clock) time`** e **`Maximum resident set size`**. Esses dois números fecham o item 🔍 NÃO VERIFICADO da Decisão 3 e vão para o relatório.

**COMO REVERTER:**

```bash
systemctl stop n8necrm-web n8necrm-worker
rm -f /opt/n8necrm/current
rm -rf /opt/n8necrm/releases/*
```

**A migração NÃO volta.** Se ela tiver aplicado alguma coisa, isso está no Supabase e é irreversível por este caminho. Foi por isso que o Step 1 exigiu `up to date` **antes** — com o banco já migrado, este primeiro deploy não tem migração para aplicar, e o rollback é completo.

- [ ] **Step 4: 🖥️ Habilitar as units e conferir**

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  systemctl enable --now n8necrm-web n8necrm-worker n8necrm-saude.timer
  sleep 15
  systemctl is-active n8necrm-web n8necrm-worker n8necrm-saude.timer
  echo "=== web ==="; journalctl -u n8necrm-web    -n 20 --no-pager
  echo "=== worker ==="; journalctl -u n8necrm-worker -n 20 --no-pager
'
```

Esperado: três `active`; o log do web com a linha de `Ready`/`started server` do Next; e o do worker com **`Worker da fila de turnos iniciado. Ctrl+C para sair.`**

⚠️ Se o worker mostrar `This module cannot be imported from a Client Component module`, a flag `--conditions=react-server` sumiu da unit. **Pare e reporte** — é defeito da Tarefa 3, e o teste dela deveria ter mordido.

**COMO REVERTER:**

```bash
systemctl disable --now n8necrm-web n8necrm-worker n8necrm-saude.timer
```

- [ ] **Step 5: 🖥️ A PROVA de que a aplicação não está exposta**

Este é o passo que sustenta a Decisão 5 inteira, e ele tem duas metades.

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  echo "=== metade 1: onde ele escuta ==="
  ss -lntp | grep -E ":300[01] "
  echo "=== metade 2: responde no loopback? ==="
  curl -s -o /dev/null -w "loopback /login: %{http_code}\n" --max-time 10 http://127.0.0.1:3000/login
'
```

Esperado na metade 1: **`127.0.0.1:3000`**, e **nunca** `0.0.0.0:3000` nem `*:3000`. Na metade 2: `200`.

E a metade que **precisa ser rodada de fora da VPS** — de outra máquina, não por SSH:

```bash
curl -s -o /dev/null -w "publico :3000 -> %{http_code}\n" --max-time 10 http://76.13.224.40:3000/login
```

Esperado: **falha de conexão** (`Connection refused` / `timed out`), e o `%{http_code}` saindo `000`. **Qualquer código HTTP aqui é uma falha de segurança**, e com `ufw` inativo não há segunda linha de defesa: **pare, corrija o bind na unit, e reporte**.

🔍 Se este ambiente não conseguir sair para o IP público, marque **NÃO VERIFICADO** e entregue o comando ao dono — mas **não** conclua a tarefa afirmando que está fechado.

**COMO REVERTER:** só leitura.

- [ ] **Step 6: 🖥️ Provar que a fila drena de ponta a ponta**

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  cd /opt/n8necrm/current
  set -a; . /etc/n8necrm/n8necrm.env; set +a
  sudo -u n8necrm --preserve-env ./node_modules/.bin/tsx scripts/fila-saude.ts
  echo "codigo de saida: $?"
  echo "=== a vigia pelo systemd ==="
  systemctl start n8necrm-saude
  systemctl status n8necrm-saude --no-pager | head -15
  systemctl list-timers n8necrm-saude.timer --no-pager
'
```

Esperado: uma linha `OK fila: prontos=0 maisVelhoMs=- mortosNaUltimaHora=0 limiarMs=300000`, código **0**, a unit `n8necrm-saude` em estado `inactive (dead)` com `status=0/SUCCESS` (é `oneshot`: rodar e morrer é o estado certo), e o timer listado com um `NEXT` a menos de 5 minutos. Cole tudo.

⚠️ Código **2** = não conseguiu falar com o banco. Confira `DATABASE_URL` (presença, não valor) e a rede — **não** conclua a tarefa com 2.

**COMO REVERTER:** só leitura e uma execução de vigia, que não escreve nada.

- [ ] **Step 7: 🖥️ Confirmar que o stack vizinho continua intacto**

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  docker ps --format "{{.Names}}\t{{.Status}}"
  systemctl is-active nginx
  curl -s -o /dev/null -w "n8n:%{http_code} "       --max-time 10 https://n8n.nateksoft.com/
  curl -s -o /dev/null -w "evolution:%{http_code}\n" --max-time 10 https://evolution.nateksoft.com/
  free -h | head -2
  df -h / | tail -1
'
```

Esperado: os **cinco** containers ainda `Up` com **o mesmo tempo de vida crescendo** (nenhum reiniciado), nginx `active`, os dois códigos HTTP iguais aos do Step 2 da Tarefa 7, e memória e disco com folga. Compare com aquela linha de base **explicitamente, item a item**, no relatório.

- [ ] **Step 8: Relatar**

Sem commit. Reporte os dois números de `/usr/bin/time -v`, a saída do Step 5 (as três metades), a do Step 6, e a comparação item a item do Step 7 contra a linha de base.

---

### Task 9: 🖥️🔑 Porta 80 e o certificado

🖥️ **TOCA A VPS: SIM.**
🔑 **AÇÃO DO DONO: SIM — o registro A `crm` → `76.13.224.40` (ação 1).** Esta tarefa **não começa** sem ele.
**DEPENDE DE DNS: SIM.**

**Files:** nenhum no repositório.

**Interfaces:**
- Consumes: `deploy/nginx/crm.nateksoft.com.fase1.conf` (Tarefa 4).
- Produces na VPS: `/etc/letsencrypt/live/crm.nateksoft.com/{fullchain,privkey}.pem` e a renovação automática registrada.

- [ ] **Step 1: 🔑 PORTA — o DNS resolve?**

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  getent hosts crm.nateksoft.com || echo "NAO RESOLVE"
  dig +short crm.nateksoft.com @1.1.1.1
  dig +short crm.nateksoft.com @8.8.8.8
'
```

Esperado: **`76.13.224.40`** nos três. Se sair `NAO RESOLVE` ou vazio, **PARE E REPORTE**: a ação 1 do dono ainda não foi feita ou não propagou. **Não invente contorno** — sem DNS o desafio HTTP-01 falha, e cada tentativa falha consome cota de rate limit da Let's Encrypt (5 falhas por conta, por hostname, por hora).

⚠️ Se um resolvedor responder e o outro não, **é propagação em curso: espere.** Emitir com propagação parcial é como as cotas se queimam.

**COMO REVERTER:** só leitura.

- [ ] **Step 2: 🖥️ Instalar o bloco da fase 1 — com backup e `nginx -t` ANTES do reload**

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  set -e
  cd /opt/n8necrm/repo && git fetch --prune origin && git checkout -q origin/main -- deploy/nginx/

  echo "=== BACKUP do sites-enabled inteiro ==="
  tar czf /root/nginx-sites-enabled-$(date -u +%Y%m%d%H%M%S).tgz -C /etc/nginx sites-enabled
  ls -la /root/nginx-sites-enabled-*.tgz | tail -1

  install -m 0644 -o root -g root \
    /opt/n8necrm/repo/deploy/nginx/crm.nateksoft.com.fase1.conf \
    /etc/nginx/sites-available/crm.nateksoft.com

  ln -sfn /etc/nginx/sites-available/crm.nateksoft.com /etc/nginx/sites-enabled/crm.nateksoft.com

  echo "=== nginx -t ANTES de qualquer reload ==="
  nginx -t
'
```

⚠️ **`nginx -t` é o portão.** Se ele falhar, **NÃO recarregue**. Desfaça com o rollback abaixo e reporte. O nginx em execução continua com a configuração antiga enquanto não houver reload — n8n e Evolution não são afetados por um arquivo que não passou no teste.

Só depois de `syntax is ok` **e** `test is successful`:

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  systemctl reload nginx
  sleep 3
  systemctl is-active nginx
  echo "=== os vizinhos, IMEDIATAMENTE depois do reload ==="
  curl -s -o /dev/null -w "n8n:%{http_code} "       --max-time 10 https://n8n.nateksoft.com/
  curl -s -o /dev/null -w "evolution:%{http_code}\n" --max-time 10 https://evolution.nateksoft.com/
  echo "=== o desafio ACME chega? ==="
  mkdir -p /var/www/certbot/.well-known/acme-challenge
  echo probe-$(date +%s) > /var/www/certbot/.well-known/acme-challenge/probe-n8necrm
  curl -s --max-time 10 http://crm.nateksoft.com/.well-known/acme-challenge/probe-n8necrm
  rm -f /var/www/certbot/.well-known/acme-challenge/probe-n8necrm
'
```

Esperado: nginx `active`; n8n e Evolution respondendo **os mesmos códigos** da linha de base; e o `curl` do desafio devolvendo o **conteúdo `probe-…`**.

⚠️ Se o desafio devolver **`404`**, o bloco novo não assumiu e o curinga `*.nateksoft.com` ainda ganha. **Pare e reporte** — não peça o certificado, seria queimar cota. A sonda ANTES da emissão existe exatamente para essa cota não ser gasta em tentativa cega.

**COMO REVERTER (o bloco da fase 1):**

```bash
rm -f /etc/nginx/sites-enabled/crm.nateksoft.com
nginx -t && systemctl reload nginx
curl -s -o /dev/null -w "n8n:%{http_code} evolution:" https://n8n.nateksoft.com/
curl -s -o /dev/null -w "%{http_code}\n" https://evolution.nateksoft.com/
```

E, se algo maior tiver acontecido, o `sites-enabled` inteiro volta:

```bash
tar xzf /root/nginx-sites-enabled-<carimbo>.tgz -C /etc/nginx
nginx -t && systemctl reload nginx
```

- [ ] **Step 3: 🖥️ Emitir o certificado — `certonly --webroot`, NUNCA `--nginx`**

**Ensaio primeiro**, com `--dry-run`, que **não consome cota**:

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  certbot certonly --webroot -w /var/www/certbot \
    -d crm.nateksoft.com \
    --non-interactive --agree-tos \
    --deploy-hook "systemctl reload nginx" \
    --dry-run
'
```

Esperado: `The dry run was successful.` Se falhar, **pare e reporte** — a cota de emissão real continua intocada.

Só então, para valer:

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  certbot certonly --webroot -w /var/www/certbot \
    -d crm.nateksoft.com \
    --non-interactive --agree-tos \
    --deploy-hook "systemctl reload nginx"
  echo "=== conferindo ==="
  ls -la /etc/letsencrypt/live/crm.nateksoft.com/
  certbot certificates --cert-name crm.nateksoft.com
'
```

Esperado: `Successfully received certificate`, os quatro symlinks (`cert.pem`, `chain.pem`, `fullchain.pem`, `privkey.pem`) e uma data de expiração ~90 dias à frente.

**Três coisas que este comando NÃO faz, e que são o motivo de ele ser assim:**
- **Não escreve uma linha de nginx.** `--nginx` reescreveria `/opt/nateksoft/nginx/nateksoft.conf` — o arquivo que mantém n8n e Evolution de pé, e que já carrega marcadores `# managed by Certbot`.
- **Não recarrega o nginx agora.** O `--deploy-hook` só dispara nas **renovações** futuras. Sem ele, o certificado renovaria em disco e o nginx continuaria servindo o velho até alguém notar — daqui a 90 dias.
- **Não toca em certificado nenhum dos outros nove.**

**COMO REVERTER:**

```bash
certbot delete --cert-name crm.nateksoft.com --non-interactive
```

⚠️ Fazer isso **depois** de a Tarefa 10 estar instalada quebra o nginx (o bloco 443 apontaria para arquivo inexistente e `nginx -t` falharia). Reverta o certificado **só** enquanto a fase 1 ainda estiver ativa — ou reverta a Tarefa 10 primeiro.

- [ ] **Step 4: 🖥️ Provar que a renovação automática existe**

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  systemctl list-timers certbot.timer --no-pager
  grep -E "webroot|deploy.hook|renew_before" /etc/letsencrypt/renewal/crm.nateksoft.com.conf
'
```

Esperado: o `certbot.timer` ativo com um `NEXT`, e o arquivo de renovação registrando `authenticator = webroot`, o `webroot_path` e o `renew_hook`.

⚠️ Se o `webroot_path` **não** estiver lá, a renovação vai falhar em 60 dias, **em silêncio**, e o certificado expira sem aviso. **Pare e reporte.**

**COMO REVERTER:** só leitura.

- [ ] **Step 5: Relatar**

Sem commit. Reporte: os três `dig`, a resposta da sonda ACME, o `--dry-run`, a emissão, a validade, e — **item a item contra a linha de base da Tarefa 7 Step 2** — que n8n e Evolution continuam respondendo e que nenhum container reiniciou.

---

### Task 10: 🖥️ Porta 443, e a única linha que toca o arquivo dos vizinhos

🖥️ **TOCA A VPS: SIM — e este é o passo de maior risco do plano inteiro.**
🔑 **AÇÃO DO DONO:** não (o DNS da Tarefa 9 já foi feito).
**DEPENDE DE DNS: SIM.**

**Por que este é o passo de maior risco.** O Step 3 edita `/opt/nateksoft/nginx/nateksoft.conf` — o arquivo que mantém n8n e Evolution no ar, com precedente de quebra registrado neste projeto. **A edição é de uma linha**, e ela é obrigatória: sem ela o editor do n8n embutido em `/fluxos` fica **em branco**, sem nenhuma mensagem no servidor, só uma violação de CSP no console do navegador.

**Files:** nenhum no repositório.

**Interfaces:**
- Consumes: `deploy/nginx/crm.nateksoft.com.conf` (Tarefa 4); o certificado da Tarefa 9.
- Produces na VPS: `https://crm.nateksoft.com` servindo o CRM; `/fluxos` capaz de embutir o n8n.

- [ ] **Step 1: 🖥️ Substituir a fase 1 pela configuração definitiva**

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  set -e
  cd /opt/n8necrm/repo && git fetch --prune origin && git checkout -q origin/main -- deploy/nginx/

  cp -a /etc/nginx/sites-available/crm.nateksoft.com \
        /etc/nginx/sites-available/crm.nateksoft.com.fase1.bak-$(date -u +%Y%m%d%H%M%S)

  install -m 0644 -o root -g root \
    /opt/n8necrm/repo/deploy/nginx/crm.nateksoft.com.conf \
    /etc/nginx/sites-available/crm.nateksoft.com

  echo "=== nginx -t ANTES do reload ==="
  nginx -t
'
```

⚠️ Se `nginx -t` falhar apontando para `ssl_certificate`, o certificado da Tarefa 9 não existe ou tem outro nome. **NÃO recarregue.** Volte a fase 1 (rollback abaixo) e reporte.

Só depois de `test is successful`:

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  systemctl reload nginx
  sleep 3
  echo "=== os vizinhos, IMEDIATAMENTE depois do reload ==="
  curl -s -o /dev/null -w "n8n:%{http_code} "       --max-time 10 https://n8n.nateksoft.com/
  curl -s -o /dev/null -w "evolution:%{http_code}\n" --max-time 10 https://evolution.nateksoft.com/
  echo "=== o CRM ==="
  curl -s -o /dev/null -w "crm /login: %{http_code}\n"  --max-time 15 https://crm.nateksoft.com/login
  curl -s -o /dev/null -w "crm / (raiz): %{http_code}\n" --max-time 15 https://crm.nateksoft.com/
  echo "=== redirect da porta 80 ==="
  curl -sI --max-time 10 http://crm.nateksoft.com/login | head -3
  echo "=== a rota de tick, DE FORA ==="
  curl -s -o /dev/null -w "tick sem segredo: %{http_code}\n" -X POST --max-time 10 https://crm.nateksoft.com/api/queues/whatsapp-turn
'
```

Esperado:
- n8n e Evolution nos **mesmos códigos** da linha de base (Tarefa 7, Step 2);
- `crm /login: 200`;
- `crm / (raiz)`: **`307`** (o proxy redireciona quem não tem sessão para `/login`);
- porta 80 devolvendo `HTTP/1.1 301` com `Location: https://crm.nateksoft.com/login`;
- **`tick sem segredo: 404`** — recusado pela borda.

⚠️ O `404` do tick é **indistinguível** do 404 que a própria rota devolve a segredo errado. Isso é o desenho, não uma ambiguidade a resolver. Para provar que foi a **borda** que recusou, o Step 2 compara com o loopback.

**COMO REVERTER (volta para a fase 1, o CRM some da internet e os vizinhos ficam intactos):**

```bash
cp -a /etc/nginx/sites-available/crm.nateksoft.com.fase1.bak-<carimbo> \
      /etc/nginx/sites-available/crm.nateksoft.com
nginx -t && systemctl reload nginx
```

**COMO REVERTER (tira o CRM da borda por completo):**

```bash
rm -f /etc/nginx/sites-enabled/crm.nateksoft.com
nginx -t && systemctl reload nginx
```

Nas duas, n8n e Evolution não são tocados: o arquivo deles não foi editado neste passo.

- [ ] **Step 2: 🖥️ Provar que foi a BORDA que recusou o tick**

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  set -a; . /etc/n8necrm/n8necrm.env; set +a
  echo -n "loopback COM segredo:  "
  curl -s -o /dev/null -w "%{http_code}\n" -X POST --max-time 15 \
    -H "x-fila-segredo: $WHATSAPP_QUEUE_SECRET" http://127.0.0.1:3000/api/queues/whatsapp-turn
  echo -n "publico  COM segredo:  "
  curl -s -o /dev/null -w "%{http_code}\n" -X POST --max-time 15 \
    -H "x-fila-segredo: $WHATSAPP_QUEUE_SECRET" https://crm.nateksoft.com/api/queues/whatsapp-turn
'
```

Esperado: **`200` no loopback** e **`404` no público**, **com o mesmo segredo**. Essa diferença é a prova: a rota funciona, o segredo está correto, e o que a recusa de fora é o `location = /api/queues/whatsapp-turn { return 404; }`.

⚠️ **`$WHATSAPP_QUEUE_SECRET` viaja num cabeçalho neste comando.** `curl` não imprime o cabeçalho (não há `-v` nem `-i`), e `%{http_code}` só imprime o número. **Não acrescente `-v`, `-i` nem `--trace`** aqui — qualquer um deles despejaria o segredo no log da sessão. Se precisar depurar, depure com um segredo errado propositalmente.

⚠️ Se o público devolver `200`, o bloco `location =` não está valendo. **Pare e reporte:** o CRM está no ar com a rota de fila exposta, e a única defesa é o segredo.

**COMO REVERTER:** só leitura.

- [ ] **Step 3: 🖥️ ⚠️ A ÚNICA LINHA que toca o arquivo de n8n e Evolution**

**Leia isto inteiro antes de rodar qualquer coisa.**

O bloco do n8n em `/opt/nateksoft/nginx/nateksoft.conf` tem hoje:

```nginx
    add_header Content-Security-Policy "frame-ancestors 'self' http://localhost:3000" always;
```

Ela precisa virar:

```nginx
    add_header Content-Security-Policy "frame-ancestors 'self' http://localhost:3000 https://crm.nateksoft.com" always;
```

**Por que a mudança é necessária:** `/fluxos` embute o editor do n8n num iframe (decisão travada nº 3). `frame-ancestors` do **n8n** é quem autoriza quem pode embuti-lo. Hoje a lista tem `http://localhost:3000` — o CRM em desenvolvimento — e **não** tem a origem de produção. Sem esta linha, `/fluxos` abre **em branco**, sem erro no servidor, só uma violação de CSP no console do navegador. O comentário que já está no arquivo (escrito em 2026-08-19) diz exatamente isso: *"cada origem autorizada entra aqui explicitamente"*.

**Por que `http://localhost:3000` FICA:** apagá-lo quebraria `/fluxos` na máquina de desenvolvimento. É acréscimo, não substituição.

**Do lado do CRM não muda nada:** `src/proxy.ts` já tem `frame-src https://n8n.nateksoft.com` fixo. Os dois lados já estavam de acordo; só o lado do n8n é que não conhecia a origem nova.

**O padrão de busca do `sed` é `http://localhost:3000"` — e NÃO a linha inteira.** Medido em 2026-08-21: essa string aparece **exatamente uma vez** no arquivo (`grep -c` → `1`, na linha 65). Casar só por ela evita ter de escrever `'self'` dentro de um `sed` que já está dentro de aspas duplas dentro de aspas simples de um `ssh` — o aninhamento de aspas em que uma primeira redação deste passo se enrolou. O `-c` no começo do bloco **prova a unicidade antes de editar**, em vez de confiar na medição de ontem.

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  set -e
  ALVO=/opt/nateksoft/nginx/nateksoft.conf
  CARIMBO=$(date -u +%Y%m%d%H%M%S)

  echo "=== 1. UNICIDADE do padrao (tem de ser exatamente 1) ==="
  N=$(grep -c "localhost:3000" "$ALVO")
  echo "ocorrencias: $N"
  [ "$N" = "1" ] || { echo "ABORTADO: esperava 1 ocorrencia, achei $N. NAO EDITE."; exit 1; }

  echo "=== 2. BACKUP em DOIS lugares ==="
  cp -a "$ALVO" /root/nateksoft.conf.bak-$CARIMBO
  cp -a "$ALVO" "$ALVO".bak-$CARIMBO
  ls -la /root/nateksoft.conf.bak-$CARIMBO

  echo "=== 3. a linha ANTES ==="
  grep -n "frame-ancestors" "$ALVO"

  echo "=== 4. a edicao: acrescenta UMA origem, sem tocar no resto da linha ==="
  sed -i "s|http://localhost:3000\"|http://localhost:3000 https://crm.nateksoft.com\"|" "$ALVO"

  echo "=== 5. a linha DEPOIS ==="
  grep -n "frame-ancestors" "$ALVO"

  echo "=== 6. o diff, inteiro ==="
  diff /root/nateksoft.conf.bak-$CARIMBO "$ALVO" || true

  echo "=== 7. quantas linhas mudaram (tem de ser 1 removida e 1 acrescentada) ==="
  diff /root/nateksoft.conf.bak-$CARIMBO "$ALVO" | grep -c "^[<>]" || true

  echo "=== 8. nginx -t ANTES do reload ==="
  nginx -t
'
```

⚠️ **O passo 7 tem de imprimir `2`** — uma linha removida e uma acrescentada, ou seja, **uma** linha alterada. Qualquer outro número: **NÃO recarregue**, restaure do backup e reporte. Uma alteração a mais neste arquivo é a queda do n8n e da Evolution.

⚠️ Se o passo 1 abortar, a medição de 2026-08-21 mudou — alguém editou o arquivo. **Pare e reporte**, não adapte o padrão sozinho.

⚠️ Se o passo 5 mostrar a linha **inalterada**, o `sed` não casou. **Não insista com variações às cegas:** restaure do backup e **edite à mão**, com o arquivo aberto, conferindo a linha antes de salvar.

Só depois de `test is successful`:

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  systemctl reload nginx
  sleep 3
  systemctl is-active nginx
  echo "=== OS VIZINHOS, o passo que este plano existe para nao pular ==="
  curl -s -o /dev/null -w "n8n raiz:        %{http_code}\n" --max-time 15 https://n8n.nateksoft.com/
  curl -s -o /dev/null -w "n8n healthz:     %{http_code}\n" --max-time 15 https://n8n.nateksoft.com/healthz
  curl -s -o /dev/null -w "evolution raiz:  %{http_code}\n" --max-time 15 https://evolution.nateksoft.com/
  echo "=== o header novo chegou? ==="
  curl -sI --max-time 15 https://n8n.nateksoft.com/ | grep -i "content-security-policy"
  echo "=== nenhum container reiniciou? ==="
  docker ps --format "{{.Names}}\t{{.Status}}"
'
```

Esperado: nginx `active`; **n8n e Evolution respondendo os mesmos códigos da linha de base**; o header trazendo `frame-ancestors 'self' http://localhost:3000 https://crm.nateksoft.com`; e os cinco containers com **`Up` e o tempo crescendo** — nenhum com `Up 3 seconds`, o que significaria reinício.

⚠️ Se n8n ou Evolution não responderem, **REVERTA IMEDIATAMENTE** com o comando abaixo, antes de diagnosticar qualquer coisa. Diagnosticar com o serviço de terceiros fora do ar é a escolha errada, sempre.

**COMO REVERTER (a linha do CSP):**

```bash
cp -a /root/nateksoft.conf.bak-<carimbo> /opt/nateksoft/nginx/nateksoft.conf
nginx -t && systemctl reload nginx
curl -s -o /dev/null -w "n8n:%{http_code} " https://n8n.nateksoft.com/
curl -s -o /dev/null -w "evolution:%{http_code}\n" https://evolution.nateksoft.com/
```

O backup vive em **dois lugares** de propósito: `/root/` (fora da árvore do stack, sobrevive a qualquer mexida em `/opt/nateksoft/`) e ao lado do original (onde quem for procurar vai olhar primeiro, seguindo o `.bak` de 2026-08-19 que já está lá).

**Custo de reverter esta linha:** `/fluxos` volta a abrir em branco. Nada mais.

- [ ] **Step 4: 🖥️ TLS conferido de fora**

```bash
echo | openssl s_client -connect crm.nateksoft.com:443 -servername crm.nateksoft.com 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
curl -sI --max-time 15 https://crm.nateksoft.com/login | head -20
```

Esperado: `subject=CN = crm.nateksoft.com` (**não** `mail.nateksoft.com` — se for o do mail, o bloco exato não assumiu e o curinga ainda ganha), emissor Let's Encrypt, `notAfter` ~90 dias à frente; e nos headers: `strict-transport-security: max-age=63072000` (do `next.config.ts`), `x-content-type-options: nosniff`, **um único** `content-security-policy` com `nonce-`, e **nenhum** `x-powered-by`.

⚠️ **Dois headers `content-security-policy` na resposta** significa que algum `add_header` de CSP entrou no bloco do CRM. O navegador aplicaria a **interseção** das duas políticas e a aplicação quebraria de um jeito difícil de diagnosticar. O teste da Tarefa 4 deveria ter impedido: **pare e reporte**.

🔍 Se este ambiente não alcançar a internet pública, marque **NÃO VERIFICADO** e entregue os dois comandos ao dono.

**COMO REVERTER:** só leitura.

- [ ] **Step 5: Relatar**

Sem commit. Reporte: o `diff` de uma linha do Step 3, as respostas de n8n e Evolution **antes e depois** de cada um dos dois reloads, a diferença 200/404 do Step 2, e o `subject` do certificado.

---

### Task 11: 🖥️🔑 Ativação, verificação final, e a PARADA para auditoria

🖥️ **TOCA A VPS: SIM** (só configuração de terceiros e leitura).
🔑 **AÇÃO DO DONO: SIM** — ações **3** (jwks), **4** (webhook) e **6** (aprovar a auditoria).
**DEPENDE DE DNS: SIM.**

**Files:**
- Modify: `docs/ESTADO.md` (só os números medidos)

- [ ] **Step 1: 🔑 Ação do dono — o `jwks_url` do Supabase**

O CRM publica `https://crm.nateksoft.com/api/jwks`. O projeto Supabase `uzumzfxjcxrbxaucvfsr` precisa apontar o JWT de terceiros para lá.

Prove primeiro que o endpoint responde:

```bash
curl -s --max-time 15 https://crm.nateksoft.com/api/jwks
```

Esperado: um JSON com `keys` contendo **uma** chave EC P-256 com `kid`, `x`, `y` — e **sem** `d`. ⚠️ **Se `d` aparecer, PARE IMEDIATAMENTE:** `d` é o componente **privado**, e publicá-lo entrega a assinatura de qualquer token. Isso seria incidente de segurança, não item de deploy.

Entregue ao dono: painel Supabase → Authentication → JWT / third-party auth → `jwks_url` = `https://crm.nateksoft.com/api/jwks`.

⚠️ **A troca leva até 30 minutos** para o Supabase notar quando o registro é por `jwks_url` (registrado no `.env.example`). Não conclua "não funciona" antes disso.

**COMO REVERTER:** remover o registro no painel do Supabase. Consequência: o caminho do navegador ao Supabase (Ciclo 1b) deixa de autenticar; o painel continua funcionando pelo caminho do Prisma.

- [ ] **Step 2: 🔑 Ação do dono — a URL de webhook na Evolution**

A URL é gerada pela tela **Configurações → Conexões** do CRM, como ADMIN, e é mostrada **UMA vez**. Ela não é montada à mão, e este plano **não** a inventa.

Entregue ao dono: cadastrar/conferir a conexão no CRM, copiar a URL, colar no painel da Evolution.

⚠️ A URL contém o token do webhook. **Não a cole no relatório, no log nem em mensagem nenhuma.**

**COMO REVERTER:** remover o webhook no painel da Evolution. Consequência: o WhatsApp para de receber mensagem. Nada mais.

- [ ] **Step 3: 🖥️ Medir o `$remote_addr` da Evolution — o item aberto da Decisão 5**

Com o webhook do Step 2 ativo, provoque **uma** mensagem real de WhatsApp e observe:

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  tail -20 /var/log/nginx/access.log | grep "api/whatsapp/evolution" || echo "nenhum webhook no log ainda"
'
```

Registre **qual IP** aparece. Ele é o `$remote_addr` que vira `X-Real-IP` e, portanto, a chave do balde de 600 req/60 s do webhook.

**A conclusão a escrever no relatório**, escolhendo uma:
- Se for **um IP só** (o gateway do docker, `172.x`, ou o IP público da própria máquina): **todas as empresas dividem um balde de 600/min**. Documente o número e o limite; não é bloqueador para o porte atual.
- Se por algum motivo variar: registre o que se observou, sem teorizar.

⚠️ **Não altere nada por causa desta medição.** Ela fecha um 🔍 NÃO VERIFICADO e alimenta a auditoria — mudar limite de taxa é decisão de outro ciclo.

**COMO REVERTER:** só leitura.

- [ ] **Step 4: 🖥️ O percurso completo, ponta a ponta**

Com uma conexão de WhatsApp ativa, mande **uma** mensagem de um número real e meça:

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  journalctl -u n8necrm-worker --since "5 min ago" --no-pager | tail -30
  cd /opt/n8necrm/current
  set -a; . /etc/n8necrm/n8necrm.env; set +a
  sudo -u n8necrm --preserve-env ./node_modules/.bin/tsx scripts/fila-saude.ts
'
```

Esperado: uma linha `drenagem: 1 processados, 0 falhados, 0 mortos` no journal do worker, resposta chegando ao WhatsApp em **~8-10 s**, e a vigia dizendo `OK ... prontos=0`.

🔍 Se não houver conexão de WhatsApp pareada — que é o estado registrado em `docs/ESTADO.md` —, marque **NÃO VERIFICADO** e entregue estes comandos ao dono. **Não fabrique conversa sintética no banco compartilhado.**

**COMO REVERTER:** só leitura.

- [ ] **Step 5: 🖥️ A varredura final da borda**

```bash
for caminho in /login / /api/jwks /api/queues/whatsapp-turn /_next/static/nao-existe; do
  printf "%-34s " "$caminho"
  curl -s -o /dev/null -w "%{http_code}\n" --max-time 15 "https://crm.nateksoft.com$caminho"
done
printf "%-34s " "POST tick (sem segredo)"
curl -s -o /dev/null -w "%{http_code}\n" -X POST --max-time 15 https://crm.nateksoft.com/api/queues/whatsapp-turn
printf "%-34s " "/leads (sem sessao)"
curl -s -o /dev/null -w "%{http_code}\n" --max-time 15 https://crm.nateksoft.com/leads
printf "%-34s " "porta 3000 direta"
curl -s -o /dev/null -w "%{http_code}\n" --max-time 10 http://76.13.224.40:3000/login
```

Esperado: `/login` **200**; `/` **307**; `/api/jwks` **200**; `/api/queues/whatsapp-turn` **404** (GET e POST); `/_next/static/nao-existe` **404**; `/leads` **307** para `/login`; **porta 3000 direta: `000`** (recusada).

⚠️ **Qualquer código diferente de `000` na porta 3000 direta é falha de segurança**, e com `ufw` inativo não há segunda linha. Pare e reporte.

⚠️ **`/leads` devolvendo 200 sem sessão seria vazamento de dado de lead.** Pare e reporte.

**COMO REVERTER:** só leitura.

- [ ] **Step 6: 🖥️ Comparação final com a linha de base**

```bash
ssh -i ~/.ssh/claude_notifier_ed25519 root@76.13.224.40 '
  echo "=== containers (comparar com a Tarefa 7, Step 2) ==="
  docker ps --format "{{.Names}}\t{{.Status}}"
  echo "=== units do CRM ==="
  systemctl is-active n8necrm-web n8necrm-worker n8necrm-saude.timer
  systemctl --failed --no-pager
  echo "=== vizinhos ==="
  curl -s -o /dev/null -w "n8n:%{http_code} "       --max-time 15 https://n8n.nateksoft.com/
  curl -s -o /dev/null -w "evolution:%{http_code}\n" --max-time 15 https://evolution.nateksoft.com/
  echo "=== recursos ==="
  free -h | head -2; df -h / | tail -1; uptime
  echo "=== releases em disco ==="
  ls -1dt /opt/n8necrm/releases/*/ ; readlink -f /opt/n8necrm/current
  echo "=== nginx ==="
  nginx -t 2>&1 | tail -2
  ls -la /etc/nginx/sites-enabled/
  echo "=== backups deixados ==="
  ls -la /root/nateksoft.conf.bak-* /root/nginx-sites-enabled-*.tgz 2>&1
'
```

Esperado: os **cinco** containers com o mesmo tempo de vida **crescendo** desde a Tarefa 7; três units do CRM `active`; **`systemctl --failed` vazio**; n8n e Evolution nos mesmos códigos; disco e memória com folga; `sites-enabled` com os arquivos anteriores **mais** `crm.nateksoft.com`; e os backups presentes.

⚠️ Se `systemctl --failed` listar `n8necrm-saude`, **a fila está parada** — investigue antes de concluir qualquer coisa.

- [ ] **Step 7: Atualizar `docs/ESTADO.md` só com o que foi MEDIDO**

Acrescentar uma seção com os números **realmente obtidos**: duração e pico de memória do build (Tarefa 8, Step 3); a latência ponta a ponta (Step 4, se medida); o `$remote_addr` da Evolution (Step 3); a data de expiração do certificado. **Nada de estimativa.** O que não foi medido entra como 🔍 **NÃO VERIFICADO** com o comando.

- [ ] **Step 8: Commit**

```
chore(deploy): os numeros medidos na VPS, e nao os estimados

Build, latencia, remote_addr da Evolution e validade do certificado saem
da execucao real. O que nao foi medido entra como NAO VERIFICADO com o
comando -- este projeto ja registrou o custo de "ok" presumido.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

- [ ] **Step 9: O relatório, e a PARADA**

Escrever o relatório cobrindo, item a item:

**As sete decisões**, cada uma com o que foi medido e o que continua sendo aposta.

**Todo passo que tocou a VPS**, com o comando de reversão que ficou disponível — e **onde cada backup está**.

**A comparação com a linha de base** da Tarefa 7 Step 2, item a item: containers, nginx, n8n, Evolution, portas, disco.

**Todo item 🔍 NÃO VERIFICADO**, com o comando que um humano roda. No mínimo estes, que este plano produz por construção:

| | O que não deu para provar aqui | Comando do humano |
| --- | --- | --- |
| NV1 | Duração e pico de memória do `next build` nos 2 vCPU | Tarefa 8, Step 3 (`/usr/bin/time -v`) |
| NV2 | Porta 3000 recusada **de fora** da VPS | Tarefa 8, Step 5, rodado de outra máquina |
| NV3 | O percurso WhatsApp completo, se não houver conexão pareada | Tarefa 11, Step 4 |
| NV4 | Latência ponta a ponta com o worker | do `criadoEm` da mensagem ao da resposta |
| NV5 | Que o certificado renova de fato aos 60 dias | `certbot renew --dry-run` |
| NV6 | Que o worker reiniciado no meio de um turno não duplica resposta | `systemctl kill -s SIGKILL n8necrm-worker` durante um turno, e conferir se o cliente recebe duas respostas |
| NV7 | Comportamento com dois workers simultâneos | herdado do Ciclo 2d; não se aplica aqui (há **um** worker) |

**As ações do dono ainda abertas**, na ordem da tabela "Ações do dono".

**A resposta escrita** da pergunta que a Tarefa 2 apurou: `turno.ts` grava a mensagem de saída antes ou depois do envio, e o que isso significa para NV6.

Depois disso, **PARE**.

O `AGENTS.md` é explícito: nenhuma branch é integrada sem a **Fase 1** da skill `auditoria-seguranca` sobre a superfície que a branch mexeu. **E a superfície aqui é grande e é de produção**, não de código:

- uma origem pública nova, servindo dado de lead na internet;
- uma variável (`AUTH_URL`/`AUTH_TRUST_HOST`) que muda como a sessão é validada;
- o IP de todo rate limit e de todo `AuditLog` passando a vir de um cabeçalho;
- uma rota recusada na borda, cuja segunda camada é uma linha de nginx;
- segredos de produção num arquivo de disco;
- e uma edição no arquivo de nginx que sustenta dois serviços de terceiros.

Rode a Fase 1, entregue o relatório, e **não corrija nada** antes da aprovação do dono.

**Nenhum push. Nenhum PR. Nenhum merge.**

---

## Auto-revisão deste plano

Feita depois de escrever as onze tarefas, comparando com a medição da VPS e do repositório com olhos frescos. **O que foi encontrado está corrigido acima**, não listado como pendência.

### 1. Cobertura do que o dono pediu

| Pedido | Tarefa que entrega |
| --- | --- |
| Docker ou systemd, com o custo do recusado | Decisão 1; implementada em 3, 5, 7, 8 |
| `output: "standalone"` — ou por que não | Decisão 2; `next.config.ts` **não** é modificado por tarefa nenhuma |
| Onde o `next build` roda | Decisão 3; implementada em 5 (`nice`, release novo) e medida em 8 |
| O worker: reinício, liveness, morte no meio do turno | Decisão 4; implementada em 2 (vigia) e 3 (units); NV6 no relatório |
| `IP_CABECALHO_CONFIAVEL`: valor e linha do nginx | Decisão 5; implementada em 4 e provada em 8 (Step 5) e 10 |
| Segredos: onde, permissão, não vazar | Decisão 6; implementada em 5 e 7; **provada** em 7 (Steps 5 e 6) |
| Como se atualiza, e onde entra o migrate | Decisão 7; implementada em 5 e travada por teste |
| Risco: mexer no nginx derruba os vizinhos | 9 (Step 2) e 10 (Steps 1 e 3) — backup, `nginx -t`, verificação **depois** |
| Risco: `/api/queues/whatsapp-turn` alcançável | 4 (`return 404`), provado em 10 (Step 2) |
| Risco: o banco é o Supabase remoto | Global Constraints; 8 (Step 1) mede antes de migrar |
| Risco: portas 6543/5432 | Global Constraints; **checado** no `deploy.sh` (Tarefa 5) |
| Risco: `--conditions=react-server` | 3 (unit + teste), 8 (Step 4 nomeia o erro exato) |
| Marcar o que toca a VPS e o que depende do dono | legenda + tabela de ordem + cabeçalho de cada tarefa |
| Ordem: nada de DNS antes do que não depende | tabela de ordem; Tarefas 1–8 sem DNS |
| Como reverter, escrito no passo | todo passo 🖥️ das Tarefas 7–11 |
| Um lugar só para "e se o nome for outro" | seção própria, com dez entradas |

**Nada do pedido ficou sem tarefa.**

### 2. Varredura de placeholders

Nenhum "TBD", "configure apropriadamente" ou "similar à Tarefa N". Cada arquivo criado está **por inteiro**. Cinco pontos mandam **ler o que já existe** em vez de repetir, e os cinco são deliberados:

- **Tarefa 1, Step 2**: o nome da variável de texto em `supabase-jwt-chave.test.ts` — o plano não transcreveu aquele arquivo, e adivinhar o nome produziria um teste que não compila.
- **Tarefa 2, Step 1**: os nomes dos campos de `TurnoJob` como o Prisma os expõe, e a pergunta sobre `turno.ts`, que é **investigação**, não transcrição.
- **Tarefa 6, Step 2 e 3**: as seções de `ESTADO.md` e `CLAUDE.md` a substituir são nomeadas pelo título exato.
- **Tarefa 10, Step 3**: a linha do `frame-ancestors` é transcrita **antes e depois**, e o passo exige `diff` provando **uma** linha.
- **Tarefa 11, Step 2**: a URL de webhook é gerada pela tela e mostrada uma vez — inventá-la aqui seria escrever uma URL que não funciona.

### 3. Consistência de nomes que atravessam tarefas

Conferida de ponta a ponta:

- `/opt/n8necrm/{repo,releases,current,deploy.sh}` — idêntico em 5, 6, 7, 8, 11.
- `/etc/n8necrm/n8necrm.env` — idêntico em 3 (units), 5 (scripts), 6 (docs), 7 (bootstrap), 8, 10, 11.
- `n8necrm-web`, `n8necrm-worker`, `n8necrm-saude`, `n8necrm-saude.timer` — idênticos em 3, 5, 6, 7, 8, 11.
- Usuário `n8necrm` — criado em 7 (bootstrap), usado em 3 (units) e 5 (`chown`).
- `127.0.0.1:3000` — unit (3), `upstream` (4), fumaça (5), prova (8).
- `medirSaudeDaFila` / `SaudeDaFila` / `LIMIAR_FILA_PARADA_MS` (2) → consumidas por `scripts/fila-saude.ts` (2) e pela unit (3).
- `FILA_SAUDE_ALERTA_URL` — script (2), `.env.example` (2), modelo (5), docs (6), tabela de segredos (Decisão 6).
- `AUTH_URL` / `AUTH_TRUST_HOST` — `.env.example` (1), modelo (5), docs (6), `CLAUDE.md` (6), Step 4 da 7.
- `crm.nateksoft.com` — nos dez lugares da seção "se o dono escolher outro nome", **e em nenhum outro**.
- Códigos de saída da vigia (`0/1/2`) — script (2), comentário da unit (3), docs (6), Step 6 da 8.

### 4. Ordem — nenhuma tarefa usa algo que uma posterior cria

| Tarefa | Depende de | Cria para |
| --- | --- | --- |
| 1 `AUTH_URL`, `engines` | — | 5 (o `deploy.sh` checa o Node 22), 7 (o dono preenche) |
| 2 Vigia | — | 3 (a unit a executa), 5 (o modelo a lista) |
| 3 Units | 2 (`scripts/fila-saude.ts`) | 5 (`bootstrap.sh` as instala) |
| 4 nginx | — | 9 (fase 1), 10 (definitiva) |
| 5 Scripts | 2, 3 | 7, 8 |
| 6 Docs | 1, 2, 3, 4, 5 | 11 |
| 7 Bootstrap | 1–6 **publicadas** | 8 |
| 8 Primeiro release | 7 | 9, 10 |
| 9 Porta 80 e cert | 4, 8, **DNS** | 10 |
| 10 Porta 443 e CSP | 4, 9 | 11 |
| 11 Ativação | 10 | — |

**Cinco ordens foram corrigidas nesta revisão:**

1. **A Tarefa 4 (nginx) estava antes da 3 (units)** numa primeira redação. O `upstream` de `crm.nateksoft.com.conf` aponta para `127.0.0.1:3000`, que é decisão **da unit** (`-H 127.0.0.1 -p 3000`). Escrever a borda antes do que ela serve faria um subagente isolado escolher a porta sozinho e as duas divergirem. A 3 subiu.
2. **A Tarefa 2 (vigia) estava depois da 3 (units)**, e a unit `n8necrm-saude.service` executa `scripts/fila-saude.ts`. Uma unit que aponta para um script inexistente passa em `systemd-analyze verify` e falha só na primeira execução — silenciosamente, porque é `oneshot`. A 2 subiu.
3. **O certificado estava na mesma tarefa que o bloco 443.** Isso é impossível, e a impossibilidade só apareceu na medição: `nginx -t` **falha** com um `ssl_certificate` inexistente, e o certificado não sai enquanto o nginx não responder ao ACME — que hoje cai no `return 404` do curinga. Virou a fase 1 (Tarefa 9) e a definitiva (Tarefa 10), com o motivo escrito nos dois arquivos.
4. **A edição do `frame-ancestors` estava junto com a instalação do bloco 443**, no mesmo passo. São dois arquivos com riscos **completamente diferentes**: um novo que não afeta ninguém, e o que sustenta n8n e Evolution. Fundidos, um rollback teria de desfazer os dois. Foram separados em Steps 1 e 3 da Tarefa 10, com backup e verificação de vizinho **em cada um**.
5. **A Tarefa 8 (primeiro release) estava depois do nginx.** Isso juntaria "a aplicação não sobe" e "o nome não chega" numa investigação só. Ela subiu para antes de tudo que depende de DNS — e virou o argumento central da ordem: **o CRM é provado funcionando em `127.0.0.1:3000` antes de qualquer nome resolver.**

### 5. Nove problemas encontrados e corrigidos nesta revisão

1. **`AUTH_URL`/`AUTH_TRUST_HOST` não estavam no plano.** A primeira redação listava os segredos do `.env.example` e parava ali — que é exatamente o que o pedido do dono mandava fazer. A leitura do `playwright.config.ts` revelou a variável escondida numa configuração de teste. **Sem esta correção, o deploy inteiro terminaria com um CRM que sobe, responde e falha em todo login.** Virou a Tarefa 1, a primeira de todas.
2. **`certbot --nginx` estava no plano.** É o comando que qualquer tutorial ensina. A leitura do `nateksoft.conf` mostrou marcadores `# managed by Certbot` **dentro** dele: `--nginx` reescreveria o arquivo que mantém n8n e Evolution de pé — o risco que o dono nomeou explicitamente, reintroduzido pelo caminho mais óbvio. Virou `certonly --webroot`, com proibição escrita em três lugares.
3. **O desafio ACME teria falhado.** A primeira redação instalava um bloco de porta 80 e pedia o certificado no mesmo passo, presumindo que o webroot padrão bastava. A medição da precedência (`*.nateksoft.com` com `return 404` ganha do `default_server` sem `server_name`) mostrou que não. Entraram a fase 1, a **sonda** do desafio antes de pedir o certificado, e o `--dry-run` antes da emissão real — as três para não queimar cota da Let's Encrypt em tentativa cega.
4. **`npm ci --omit=dev` estava no `deploy.sh`.** Parece a escolha certa em produção, e aqui quebra **duas** coisas: `next build` precisa das devDependencies, e o worker precisa do `tsx` **em runtime**, porque `scripts/fila-worker.ts` não faz parte do build do Next. A segunda quebra seria silenciosa até o primeiro `systemctl restart`. Virou `npm ci` completo, com o motivo no comentário.
5. **A vigia ia consultar `prisma.turnoJob` direto de um script novo.** Isso exigiria uma **exceção nova** de prisma cru no `eslint.config.mjs`, para a mesma justificativa que `fila/postgres.ts` já carrega — e a catraca daquele arquivo gira num sentido só. A função foi para dentro de `postgres.ts`, e o script só a chama. Zero exceções novas.
6. **A vigia alarmava com a fila vazia.** A primeira redação comparava `prontos > 0` com um limiar. Fila vazia é o estado **normal** de um CRM pequeno de madrugada, e uma vigia que dá alarme falso é desligada na primeira semana — depois disso ela não protege mais nada. A regra virou a **idade do mais velho**, com `null` explicitamente não sendo falha, e com um caso de teste para isso.
7. **`StartLimitIntervalSec=0` não estava nas units.** O padrão do systemd (5 reinícios em 10 s → `failed`, para sempre) transformaria um soluço de 30 s no banco num WhatsApp permanentemente mudo — precisamente o modo de falha que o `.env.example` chama de pior possível, e que o dono nomeou no pedido. Entrou nas duas units permanentes, com caso de teste, porque é a linha que uma edição futura mais provavelmente apagaria por parecer supérflua.
8. **Duas mensagens de erro do `deploy.sh` continham crase dentro de aspas duplas.** Em shell, crase é **substituição de comando**: `falhar "... \`prisma migrate\` PENDURA ..."` tentaria **executar** `prisma migrate` ao montar a mensagem de erro — no exato momento em que o script já detectou que a `DIRECT_URL` está errada, que é quando `prisma migrate` pendura. A mensagem que explica o travamento causaria o travamento. Virou aspas simples nas duas, com o aviso escrito no comentário ao lado.
9. **A edição do `frame-ancestors` se enrolava no aninhamento de aspas.** A primeira redação casava `frame-ancestors 'self' http://localhost:3000"` dentro de um `sed` dentro de aspas duplas dentro das aspas simples de um `ssh` — três níveis, com um `'"'"'` para cada apóstrofo de `'self'`. Frágil de escrever e impossível de conferir de olho, num passo em que o erro derruba n8n e Evolution. Corrigido medindo: `http://localhost:3000` aparece **exatamente uma vez** no arquivo (`grep -c` → `1`, linha 65), então o padrão não precisa conter apóstrofo nenhum. O passo agora **prova a unicidade antes de editar** e **conta as linhas do diff depois**, em vez de confiar em qualquer uma das duas coisas.

### 6. Tarefas que dependem de ação do dono

**Três das onze**, e a tabela "Ações do dono" as lista com o que cada uma trava:

- **Tarefa 7** — **os valores dos segredos**. A tarefa roda até o Step 3 sozinha e para no Step 4.
- **Tarefas 9 e 10** — **o registro A de DNS**. A Tarefa 9 tem uma parada explícita no Step 1 que **proíbe contorno**, porque tentar emitir sem DNS queima cota da Let's Encrypt.
- **Tarefa 11** — **`jwks_url`, webhook da Evolution, e a aprovação da auditoria**. As duas primeiras são de ativação: sem elas o CRM está no ar e funcional, só sem o caminho do navegador ao Supabase e sem receber WhatsApp.

**A Tarefa 7 tem uma quarta dependência, e ela não é de valor, é de processo:** o Step 1 é uma parada obrigatória porque o `bootstrap.sh` clona de `origin/main`, e o `AGENTS.md` proíbe integrar antes da auditoria. O plano **não resolve isso sozinho** — apresenta as duas saídas ao dono e espera. Escrever "faça push" ali seria o plano autorizando o que o `AGENTS.md` proíbe.

### 7. O que este plano deliberadamente NÃO faz

| | Por quê |
| --- | --- |
| **Não cria endpoint de saúde** | Rota nova é superfície nova numa origem pública. `/login` já exercita o mesmo caminho (processo de pé, Next servindo, roteador respondendo). O que ela não prova está escrito no comentário da fumaça. |
| **Não ativa `ufw`** | Mexer em firewall numa máquina com cinco containers de pé e um nginx no host é um ciclo próprio, com sua própria janela de risco. O bind em `127.0.0.1` fecha a exposição que **este** deploy criaria. Fica registrado como ação do dono em `docs/DEPLOY.md`. |
| **Não toca no `docker-compose.yml` dos vizinhos** | Precedente registrado: um `docker-compose` v1 tirou o n8n do ar por ~90 s. O CRM não precisa de nada de lá. |
| **Não configura backup do Supabase** | O banco é gerenciado e remoto; backup dele é decisão de plano do Supabase, não de deploy da VPS. |
| **Não cria pipeline de CI** | Não há `.github/` neste repositório, e criar um mudaria como o projeto inteiro é integrado. É ciclo próprio. |
| **Não altera `next.config.ts`** | Decisão 2. O único arquivo de configuração de build que este plano **não** toca, e isso é resultado, não omissão. |

