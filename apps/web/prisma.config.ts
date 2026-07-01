import { defineConfig } from "prisma/config";

export default defineConfig({
  datasource: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://av_okf:av_okf@localhost:5432/av_okf",
  },
  migrations: {
    path: "prisma/migrations",
  },
  schema: "prisma/schema.prisma",
});
