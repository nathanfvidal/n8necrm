#!/usr/bin/env bash
#
# Instalacao de primeira vez do n8necrm nesta VPS. IDEMPOTENTE: rodar duas
# vezes nao quebra nada e nao sobrescreve o arquivo de ambiente.
#
# NAO instala nginx nem pede certificado -- isso depende de DNS e e feito
# depois. Este script para exatamente no ponto em que o CRM pode subir
# escutando so em 127.0.0.1, sem nome nenhum precisar resolver.
#
# NUNCA `set -x` aqui: este script toca o caminho do arquivo de segredos, e o
# rastreio iria para o journal, onde fica para sempre. Ha um caso de teste que
# afirma isso (tests/unit/deploy-script.test.ts).
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
# --system nao cria home nem entra na faixa de UID de gente. nologin porque
# este usuario nunca precisa entrar: quem faz deploy e o root, pelo deploy.sh.
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

# --- 3. Arquivo de ambiente, SEM sobrescrever --------------------------------
# -e e nao -f: um arquivo existente com os segredos ja preenchidos nao pode ser
# tocado por uma reexecucao. Este e o unico estado desta maquina que, se
# perdido, nao se recupera de lugar nenhum -- COFRE_CHAVE_MESTRA nao tem copia.
#
# Ele nasce VAZIO, e nao com o modelo copiado: um arquivo cheio de linhas
# VARIAVEL="" e um arquivo que o deploy.sh carrega com `set -a`, definindo cada
# variavel como string vazia. Vazia e DIFERENTE de ausente para varias delas
# (SENTRY_DEBUG, IP_CABECALHO_CONFIAVEL), e a que mais importa e SEED_PASSWORD,
# que prisma/seed.ts trata com || undefined justamente por causa disso.
if [ ! -e "$ENVFILE" ]; then
  install -m 0600 -o root -g root /dev/null "$ENVFILE"
  echo "$ENVFILE criado VAZIO -- preencher a mao."
  echo "     Inventario do que ele precisa: $BASE/repo/deploy/n8necrm.env.exemplo"
  echo "     O significado de cada variavel: $BASE/repo/.env.example"
else
  echo "$ENVFILE ja existe -- NAO foi tocado."
fi

# --- 4. Espelho do repositorio ----------------------------------------------
# Um clone so, reaproveitado por todo deploy. git archive extrai dele para cada
# release, entao nenhuma release carrega um .git inteiro.
if [ ! -d "$BASE/repo/.git" ]; then
  git clone "$REPO_URL" "$BASE/repo"
else
  git -C "$BASE/repo" remote set-url origin "$REPO_URL"
  git -C "$BASE/repo" fetch --prune origin
fi

# --- 5. Units do systemd ----------------------------------------------------
# Copia, e nao symlink para dentro do repo: um symlink faria o systemd carregar
# um arquivo que muda sozinho no git fetch seguinte, sem daemon-reload -- a
# unit em disco e a unit carregada divergiriam sem nada acusar.
install -m 0644 -o root -g root "$BASE/repo/deploy/systemd/n8necrm-web.service"    /etc/systemd/system/
install -m 0644 -o root -g root "$BASE/repo/deploy/systemd/n8necrm-worker.service" /etc/systemd/system/
install -m 0644 -o root -g root "$BASE/repo/deploy/systemd/n8necrm-saude.service"  /etc/systemd/system/
install -m 0644 -o root -g root "$BASE/repo/deploy/systemd/n8necrm-saude.timer"    /etc/systemd/system/
systemctl daemon-reload

# --- 6. O script de deploy --------------------------------------------------
# 0700: so o root le e executa. Ele nao carrega segredo, mas carrega o CAMINHO
# e a forma de carregar o arquivo que carrega.
install -m 0700 -o root -g root "$BASE/repo/deploy/deploy.sh" "$BASE/deploy.sh"

echo
echo "bootstrap concluido. NADA foi habilitado nem iniciado ainda."
echo "Proximo passo: preencher $ENVFILE e rodar $BASE/deploy.sh main"
