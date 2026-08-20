-- Ciclo 2a, Task 1: a tabela de conexoes de canal, com a credencial CIFRADA.
--
-- Tabela NOVA e VAZIA. `NOT NULL` sem `DEFAULT` e seguro aqui porque nao ha
-- linha antiga e nao ha codigo publicado inserindo nela.
-- `tests/unit/migracoes-seguras.test.ts` isenta explicitamente coluna criada
-- dentro do proprio CREATE TABLE -- a isencao esta no analisador (`criadas.has`)
-- e tem caso proprio.
--
-- `Conversation`.`connectionId` e ADD COLUMN numa tabela que JA EXISTE -- por
-- isso ela e NULLABLE, sem NOT NULL e sem DEFAULT. E o unico jeito de nao
-- cair na regra que `migracoes-seguras` existe para travar: o codigo antigo
-- continua inserindo em "Conversation" sem essa coluna durante a janela de
-- deploy, e um NOT NULL ali quebraria toda ingestao de mensagem com 23502.
--
-- NENHUM backfill, de proposito. Conversa anterior a este ciclo fica com
-- connectionId NULO, e o envio resolve isso caindo na unica conexao ativa da
-- empresa (ou RECUSANDO, se houver mais de uma). Backfillar exigiria escolher
-- uma conexao para conversas que nasceram antes de existir conexao nenhuma --
-- chute com aparencia de dado.

-- CreateEnum
CREATE TYPE "CanalConexao" AS ENUM ('EVOLUTION', 'META_CLOUD');

-- CreateTable
CREATE TABLE "WhatsappConnection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "canal" "CanalConexao" NOT NULL,
    "nome" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "dominio" TEXT,
    "instancia" TEXT,
    "segredoCifrado" TEXT NOT NULL,
    "segredoUltimos4" TEXT NOT NULL,
    "segredoAtualizadoEm" TIMESTAMP(3) NOT NULL,
    "segredoAtualizadoPorId" TEXT,
    "webhookTokenHash" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappConnection_webhookTokenHash_key" ON "WhatsappConnection"("webhookTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappConnection_companyId_canal_instancia_key" ON "WhatsappConnection"("companyId", "canal", "instancia");

-- CreateIndex
CREATE INDEX "WhatsappConnection_companyId_idx" ON "WhatsappConnection"("companyId");

-- AddForeignKey
ALTER TABLE "WhatsappConnection" ADD CONSTRAINT "WhatsappConnection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappConnection" ADD CONSTRAINT "WhatsappConnection_segredoAtualizadoPorId_fkey" FOREIGN KEY ("segredoAtualizadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "connectionId" TEXT;

-- CreateIndex
CREATE INDEX "Conversation_connectionId_idx" ON "Conversation"("connectionId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "WhatsappConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A blindagem, e ela e obrigatoria em toda tabela nova deste projeto.
--
-- O Prisma nao emite RLS nem REVOKE. A migracao
-- 20260802000000_revoke_default_privileges_future_tables cobre os GRANTs
-- automaticos de objetos futuros (suspensorio), mas ALTER DEFAULT PRIVILEGES
-- NAO liga RLS -- isso continua sendo por tabela, a mao (cinto).
--
-- Sem estas duas linhas, tests/e2e/banco-blindado.spec.ts fica vermelho: ele
-- varre pg_class.relrowsecurity e information_schema.role_table_grants SEM
-- lista fixa de tabelas, entao uma tabela nova desprotegida aparece sozinha.
--
-- RLS LIGADA e ZERO politicas = default-deny. Nenhuma politica aqui: a
-- excecao NOMEADA para o Realtime e Ciclo 3. E esta tabela guarda credencial
-- cifrada -- e a ULTIMA que algum dia deveria ganhar politica de leitura.
ALTER TABLE "WhatsappConnection" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "WhatsappConnection" FROM anon, authenticated;
