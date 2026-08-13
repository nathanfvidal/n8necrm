-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "contactId" TEXT;

-- CreateIndex
CREATE INDEX "Task_responsavelId_concluidaEm_vencimento_idx" ON "Task"("responsavelId", "concluidaEm", "vencimento");

-- CreateIndex
CREATE INDEX "Task_leadId_concluidaEm_idx" ON "Task"("leadId", "concluidaEm");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
