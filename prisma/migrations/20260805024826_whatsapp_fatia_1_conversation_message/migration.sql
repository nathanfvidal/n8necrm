-- CreateEnum
CREATE TYPE "WhatsappDirecao" AS ENUM ('ENTRADA', 'SAIDA');

-- CreateEnum
CREATE TYPE "WhatsappAutor" AS ENUM ('CLIENTE', 'IA', 'HUMANO');

-- CreateEnum
CREATE TYPE "WhatsappTipo" AS ENUM ('TEXTO', 'AUDIO', 'IMAGEM', 'DOCUMENTO', 'STICKER', 'OUTRO');

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "waId" TEXT NOT NULL,
    "telefone" TEXT,
    "contactId" TEXT,
    "leadId" TEXT,
    "nomeExibicao" TEXT,
    "bufferSeq" INTEGER NOT NULL DEFAULT 0,
    "processandoAte" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "idExterno" TEXT NOT NULL,
    "direcao" "WhatsappDirecao" NOT NULL,
    "autor" "WhatsappAutor" NOT NULL,
    "tipo" "WhatsappTipo" NOT NULL,
    "texto" TEXT,
    "processadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_waId_key" ON "Conversation"("waId");

-- CreateIndex
CREATE INDEX "Conversation_processandoAte_idx" ON "Conversation"("processandoAte");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappMessage_idExterno_key" ON "WhatsappMessage"("idExterno");

-- CreateIndex
CREATE INDEX "WhatsappMessage_conversationId_direcao_processadoEm_idx" ON "WhatsappMessage"("conversationId", "direcao", "processadoEm");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappMessage" ADD CONSTRAINT "WhatsappMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mesmo padrão de
-- prisma/migrations/20260730212500_enable_rls_and_revoke_anon_grants/migration.sql:
-- toda tabela nova precisa repetir ENABLE ROW LEVEL SECURITY + REVOKE, à mão,
-- porque o Prisma não emite nenhum dos dois automaticamente para modelos
-- novos. A migração 20260802000000_revoke_default_privileges_future_tables
-- já ajustou ALTER DEFAULT PRIVILEGES para que toda tabela criada DEPOIS
-- dela nasça sem GRANT nenhum para anon/authenticated -- então o REVOKE
-- explícito abaixo é redundante em teoria (defesa em profundidade,
-- documentando a mesma garantia explicitamente por tabela, sem depender só
-- de lembrar que aquela outra migração existe). RLS habilitada, sem
-- nenhuma policy definida, continua sendo a única camada que NÃO é coberta
-- por ALTER DEFAULT PRIVILEGES -- por isso o ENABLE ROW LEVEL SECURITY
-- abaixo não é opcional.
--
-- Esta aplicação conecta como dono da tabela via DATABASE_URL (bypassa RLS,
-- FORCE ROW LEVEL SECURITY não está setado de propósito) -- a defesa aqui é
-- contra o gateway PostgREST do Supabase, que fica na frente deste mesmo
-- cluster Postgres independente de como esta aplicação conecta.
ALTER TABLE "Conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsappMessage" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "Conversation" FROM anon, authenticated;
REVOKE ALL ON TABLE "WhatsappMessage" FROM anon, authenticated;
