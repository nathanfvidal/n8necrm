#!/usr/bin/env bash
#
# Atualiza o n8necrm nesta VPS.
#
#     /opt/n8necrm/deploy.sh [ref]     (padrao: main)
#
# A ORDEM E A DECISAO deste arquivo:
#
#   checagens -> ambiente -> fetch -> extrai -> npm ci -> BUILD ->
#   MIGRATE -> troca o symlink -> restart -> fumaca -> (falhou? volta) -> poda
#
# O release ANTERIOR continua SERVINDO durante o build inteiro. Build que falha
# nao derruba nada.
#
# DUAS REGRAS DE ESCRITA DESTE ARQUIVO, as duas com caso de teste em
# tests/unit/deploy-script.test.ts:
#
#   1. NUNCA `set -x`. Este script carrega /etc/n8necrm/n8necrm.env no proprio
#      ambiente, e o rastreio imprimiria cada segredo no journal.
#   2. NENHUMA crase fora de comentario. Dentro de aspas duplas a crase e
#      substituicao de comando: uma mensagem de erro citando o migrate do
#      Prisma entre crases EXECUTARIA o migrate ao montar a mensagem. O defeito
#      existiu numa redacao anterior deste arquivo.
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
[ "$MODO" = "600" ] || falhar "$ENVFILE esta com modo $MODO; tem de ser 600. Corrija com: chmod 600 $ENVFILE"

# Sem Docker, o runtime e o do host: um apt upgrade pode ter trocado o Node
# debaixo da aplicacao sem rebuild nenhum. O engines do package.json so AVISA;
# esta linha FALHA.
NODE_MAJOR=$(node -v | sed 's/^v\([0-9]*\).*/\1/')
[ "$NODE_MAJOR" = "22" ] || falhar "Node major e $NODE_MAJOR; este projeto exige 22 (ver engines no package.json)."

# Cada release carrega node_modules inteiro e o .next. Encher o disco desta
# maquina derrubaria n8n, Evolution e Postgres junto.
LIVRE_GB=$(df --output=avail -BG "$BASE" | tail -1 | tr -dc '0-9')
[ "$LIVRE_GB" -ge "$DISCO_MINIMO_GB" ] || falhar "so ha ${LIVRE_GB}G livres em $BASE; sao necessarios ${DISCO_MINIMO_GB}G."

# --- 2. Carrega o ambiente --------------------------------------------------
# set -a exporta tudo o que for definido a seguir. Sem ele as variaveis
# ficariam locais ao shell, e nem o build do Next nem o migrate do Prisma as
# veriam.
#
# O build PRECISA delas: src/lib/env.ts valida DATABASE_URL e AUTH_SECRET, e o
# build do Next avalia modulos alcancaveis. Isso e uma trava a favor -- ambiente
# errado derruba o BUILD, que nao esta servindo ninguem, e nao a producao.
set -a
# shellcheck disable=SC1090
. "$ENVFILE"
set +a

[ -n "${DATABASE_URL:-}" ] || falhar "DATABASE_URL vazia em $ENVFILE."
[ -n "${DIRECT_URL:-}" ]   || falhar "DIRECT_URL vazia em $ENVFILE. Sem ela o migrate do Prisma PENDURA sem imprimir nada."
[ -n "${AUTH_SECRET:-}" ]  || falhar "AUTH_SECRET vazia em $ENVFILE."
# Sem estas duas o CRM sobe, responde, desenha o formulario e recusa TODO login
# com UntrustedHost -- e nada na tela diz isso.
[ -n "${AUTH_URL:-}" ]        || falhar "AUTH_URL vazia em $ENVFILE. Sem ela TODO login falha com UntrustedHost."
[ -n "${AUTH_TRUST_HOST:-}" ] || falhar "AUTH_TRUST_HOST vazia em $ENVFILE. Sem ela TODO login falha com UntrustedHost."
# Sem ela o WhatsApp inteiro fica desligado: o webhook nao decifra a apikey da
# conexao e o envio nao monta o gateway. Nao existe fallback para texto puro.
[ -n "${COFRE_CHAVE_MESTRA:-}" ] || falhar "COFRE_CHAVE_MESTRA vazia em $ENVFILE. Sem ela o WhatsApp inteiro nao funciona."

# A confusao mais cara deste projeto, checada em vez de lembrada: trocar as
# duas portas faz o migrate do Prisma ficar PENDURADO sem imprimir uma linha --
# parece lentidao, e falha.
case "$DATABASE_URL" in *:6543*) ;; *) falhar "DATABASE_URL nao aponta para a porta 6543 (transaction pooler)." ;; esac
case "$DIRECT_URL"   in *:5432*) ;; *) falhar "DIRECT_URL nao aponta para a porta 5432 (session pooler)." ;; esac

# --- 3. Resolve o commit ----------------------------------------------------
git -C "$REPO" fetch --prune origin
COMMIT=$(git -C "$REPO" rev-parse "origin/$REF") || falhar "ref '$REF' nao existe em origin."
CURTO=${COMMIT:0:7}
NOVO="$RELEASES/$(date -u +%Y%m%d%H%M%S)-$CURTO"

echo "==> release: $NOVO  (origin/$REF = $COMMIT)"

# --- 4. Extrai -------------------------------------------------------------
# git archive e nao git clone: nenhuma release carrega um .git proprio, e o
# conteudo extraido e exatamente a arvore daquele commit -- sem estado de
# working tree, sem branch, sem nada que possa divergir depois.
mkdir -p "$NOVO"
git -C "$REPO" archive "$COMMIT" | tar -x -C "$NOVO"

# --- 5. Guarda anti-.env ----------------------------------------------------
# Duas fontes de verdade para segredo. E o pior caso e silencioso: o Next
# carrega o .env do diretorio de trabalho, entao a VPS passaria a rodar com
# valores que ninguem sabe de onde vieram.
if [ -e "$NOVO/.env" ]; then
  rm -rf "$NOVO"
  falhar "o commit $CURTO contem um .env versionado. Duas fontes de verdade para segredo, e o Next leria ESSE em vez de $ENVFILE, em silencio."
fi

# --- 6. Dependencias --------------------------------------------------------
# COM devDependencies, de proposito: o build do Next precisa delas, e o worker
# precisa do tsx EM RUNTIME (scripts/fila-worker.ts nao faz parte do build).
# --omit=dev aqui produziria um build que falha e, se passasse, um worker que
# nao sobe.
#
# npm ci roda o postinstall (prisma generate) sozinho.
cd "$NOVO"
npm ci --no-audit --no-fund

# --- 7. Build ---------------------------------------------------------------
# nice -n 10: a maquina tem 2 vCPU e cinco containers de pe (n8n, o worker do
# n8n, Evolution, Postgres, Redis). Qualquer coisa que eles precisem de CPU tem
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
# com a versao anterior -- e a disciplina expande, migra, contrai. Migracao
# destrutiva derruba o CRM nesta janela.
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
# endpoint de saude neste projeto e nao foi criado um -- rota nova e superficie
# nova, e /login ja exercita o mesmo caminho (processo de pe, Next servindo,
# roteador respondendo).
#
# O QUE ESTA FUMACA NAO PROVA, dito em voz alta: que o banco responde, que o
# login funciona (AUTH_URL aponta para a origem publica, entao um POST vindo de
# 127.0.0.1 seria recusado de proposito) e que o worker esta drenando. Quem
# prova o worker e n8necrm-saude, em ate 5 minutos.
echo "==> fumaca: GET http://127.0.0.1:3000/login"
OK=0
CODIGO=000
for _ in $(seq 1 30); do
  CODIGO=$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/login 2>/dev/null || echo 000)
  if [ "$CODIGO" = "200" ]; then OK=1; break; fi
  sleep 2
done

if [ "$OK" -ne 1 ]; then
  echo "FUMACA FALHOU (ultimo codigo: $CODIGO). Revertendo o symlink." >&2
  if [ -n "$ANTERIOR" ] && [ -d "$ANTERIOR" ]; then
    ln -sfn "$ANTERIOR" "$ATUAL"
    systemctl restart n8necrm-web n8necrm-worker
    echo "revertido para $ANTERIOR. ATENCAO: a MIGRACAO nao foi revertida." >&2
  else
    echo "NAO HA release anterior para voltar -- este e o primeiro deploy." >&2
  fi
  echo "Diagnostico: journalctl -u n8necrm-web -n 80 --no-pager" >&2
  exit 1
fi

# --- 12. Worker de pe -------------------------------------------------------
# is-active responde so "o processo existe" -- e e por isso que a vigia
# n8necrm-saude existe, perguntando ao banco. Mas failed AQUI e informacao
# imediata e barata, e nao custa esperar 5 minutos por ela.
systemctl is-active --quiet n8necrm-worker || {
  echo "AVISO: n8necrm-worker NAO esta ativo. O WhatsApp nao vai responder." >&2
  echo "       journalctl -u n8necrm-worker -n 50 --no-pager" >&2
}

# --- 13. Poda ---------------------------------------------------------------
# Mantem as 3 mais novas. A ordenacao e por mtime e nao por nome, e o guard do
# readlink garante que a release EM USO nunca entra na lista -- mesmo que o
# relogio da maquina tenha andado para tras entre dois deploys.
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
echo "  A MIGRACAO nao volta junto -- o Prisma nao tem migracao de volta."
