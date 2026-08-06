-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "iaAtiva" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "iaPausadaEm" TIMESTAMP(3),
ADD COLUMN     "iaPausadaPorId" TEXT;

-- CreateTable
CREATE TABLE "BotConfig" (
    "id" TEXT NOT NULL DEFAULT 'bot-config',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "personaNome" TEXT NOT NULL,
    "personaPapel" TEXT NOT NULL,
    "regras" TEXT[],
    "faq" TEXT NOT NULL DEFAULT '',
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "atualizadoPorId" TEXT,

    CONSTRAINT "BotConfig_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_iaPausadaPorId_fkey" FOREIGN KEY ("iaPausadaPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotConfig" ADD CONSTRAINT "BotConfig_atualizadoPorId_fkey" FOREIGN KEY ("atualizadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- O Prisma não emite RLS nem REVOKE para modelo novo. A migração
-- 20260802000000_revoke_default_privileges_future_tables cobre os GRANTs
-- automáticos de objetos futuros (suspensório), mas ALTER DEFAULT PRIVILEGES
-- não liga RLS -- isso continua sendo por tabela, à mão (cinto). Mesmo par de
-- linhas que a migração da Fatia 1 escreveu para Conversation/WhatsappMessage.
--
-- Vale especialmente para esta tabela: ela guarda o prompt do agente, que é o
-- ativo comercial da fatia. Sem RLS, é leitura pública pela API PostgREST.
ALTER TABLE "BotConfig" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "BotConfig" FROM anon, authenticated;
