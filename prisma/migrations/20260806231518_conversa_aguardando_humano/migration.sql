-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "aguardandoHumanoDesde" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Conversation_aguardandoHumanoDesde_idx" ON "Conversation"("aguardandoHumanoDesde");
