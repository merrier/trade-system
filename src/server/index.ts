import { CronJob } from "cron";
import dotenv from "dotenv";
import { createApp } from "./app.js";
import { prisma } from "./db.js";
import { runPostCloseIngest } from "./repository.js";

dotenv.config();

const port = Number(process.env.PORT ?? 8787);
const app = createApp(prisma);

const cronExpression = process.env.POST_CLOSE_CRON ?? "0 30 16 * * 1-5";
const job = new CronJob(
  cronExpression,
  async () => {
    app.log.info("running scheduled post-close ingest");
    try {
      await runPostCloseIngest(prisma);
      app.log.info("post-close ingest finished");
    } catch (error) {
      app.log.error(error, "post-close ingest failed");
    }
  },
  null,
  true,
  "Asia/Shanghai"
);

const shutdown = async () => {
  job.stop();
  await app.close();
  await prisma.$disconnect();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ host: "0.0.0.0", port });
console.log(`API server listening on http://localhost:${port}`);
