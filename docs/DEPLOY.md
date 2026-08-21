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
| nginx do CRM | `/etc/nginx/sites-available/crm.nateksoft.com.conf` (symlink em `sites-enabled/`) |
| nginx de n8n e Evolution | `/opt/nateksoft/nginx/nateksoft.conf` — **não é do CRM** |
| Banco | Supabase **remoto** — o container `postgres` da VPS é do n8n |
| Fonte de verdade de tudo acima | este repositório, em `deploy/` |

Editar unit ou nginx direto na VPS produz uma máquina que diverge do
repositório sem ninguém notar. O caminho é editar aqui, comitar, e reinstalar.

## Atualizar

    ssh root@76.13.224.40
    /opt/n8necrm/deploy.sh main

O release anterior continua servindo durante o build inteiro. Se a fumaça
falhar, o próprio script devolve o symlink e reinicia.

## Reverter

    ls -1dt /opt/n8necrm/releases/*/
    ln -sfn /opt/n8necrm/releases/<anterior> /opt/n8necrm/current
    systemctl restart n8necrm-web n8necrm-worker

A **migração não volta** — o Prisma não tem migração de volta, e desfazer
schema automaticamente perderia dado. Por isso toda migração precisa ser
compatível com a versão anterior: entre `prisma migrate deploy` e o `restart`,
o código **antigo** roda contra o schema **novo**.

## Está no ar?

    systemctl status n8necrm-web n8necrm-worker n8necrm-saude.timer
    curl -sI https://crm.nateksoft.com/login | head -1
    journalctl -u n8necrm-worker -n 50 --no-pager

`systemctl status` responde "o processo existe", e não "está funcionando" —
ver a seção seguinte.

## O WhatsApp emudeceu

É o pior modo de falha deste projeto: mensagem entra, vira linha em `TurnoJob`,
ninguém responde, e nada acusa. A vigia responde em até 5 minutos sozinha, ou
sob demanda:

    systemctl start n8necrm-saude && systemctl status n8necrm-saude

`0` saudável · `1` fila parada · `2` não consegui perguntar ao banco.

Fila parada quase sempre é o worker: `journalctl -u n8necrm-worker -n 80`.

## Ações do dono ainda pendentes

- [ ] `FILA_SAUDE_ALERTA_URL` → webhook do n8n local (`127.0.0.1:5678`). Sem
      ela o alarme fica só em journald, onde ninguém está olhando.
- [ ] `jwks_url` do Supabase → `https://crm.nateksoft.com/api/jwks`
- [ ] URL de webhook no painel da Evolution
- [ ] Decidir se o repositório continua público
- [ ] Considerar `ufw` — hoje **inativo** (medido em 2026-08-21)

## As decisões, e o custo do que foi recusado

Estão em `docs/superpowers/plans/2026-08-21-n8necrm-deploy-vps.md`.
**Não as repita aqui** — duas cópias divergem, e a que alguém lê é sempre a
errada.
