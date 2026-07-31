import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // Prisma 7 moveu a config de seed pra cá — o campo "prisma.seed" no
    // package.json (convenção do Prisma 5/6) não é mais lido pelo CLI
    // (`npx prisma db seed` avisa "No seed command configured" se só o
    // package.json tiver esse campo). Ver node_modules/@prisma/config/dist/index.d.ts
    // (MigrationsConfigShape.seed).
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
