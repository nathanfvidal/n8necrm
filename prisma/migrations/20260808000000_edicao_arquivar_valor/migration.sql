-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "arquivadoEm" TIMESTAMP(3),
ALTER COLUMN "valorEstimado" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "LeadNote" ADD COLUMN     "editadoEm" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Lead_arquivadoEm_idx" ON "Lead"("arquivadoEm");

