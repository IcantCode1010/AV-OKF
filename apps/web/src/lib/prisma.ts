import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  avOkfPrisma?: PrismaClient;
};

export function getPrisma() {
  if (!globalForPrisma.avOkfPrisma) {
    const connectionString =
      process.env.DATABASE_URL ??
      "postgresql://av_okf:av_okf@localhost:5432/av_okf";

    globalForPrisma.avOkfPrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString }),
    });
  }

  return globalForPrisma.avOkfPrisma;
}
