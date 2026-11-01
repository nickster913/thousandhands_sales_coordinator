import { env } from "./config/env";
import { prisma } from "./lib/db";
import { logger } from "./lib/logger";
import { createApp } from "./app";

async function main() {
  await prisma.$connect();
  logger.info("Database connected");

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info("Server listening", { port: env.PORT, env: env.NODE_ENV, publicBaseUrl: env.PUBLIC_BASE_URL });
  });

  const shutdown = (signal: string) => {
    logger.info("Shutting down", { signal });
    server.close(() => {
      prisma.$disconnect().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("unhandledRejection", (err) => logger.error("Unhandled rejection", { err }));
  // Unprocessed webhook events are replayed on startup, so exiting and letting the platform restart is safe.
  process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception, exiting", { err });
    process.exit(1);
  });
}

main().catch((err) => {
  logger.error("Fatal startup error", { err });
  process.exit(1);
});
