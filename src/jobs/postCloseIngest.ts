import "../server/db.js";
import { prisma } from "../server/db.js";
import { runPostCloseIngest } from "../server/repository.js";

const tradeDate = process.argv.find((arg) => arg.startsWith("--trade-date="))?.split("=")[1];

const result = await runPostCloseIngest(prisma, tradeDate);
console.log(
  JSON.stringify(
    {
      tradeDate: result.dataset.tradeDate,
      stocks: result.dataset.stocks.length,
      limitUps: result.dataset.limitUps.length,
      sectors: result.dataset.sectors.length,
      recommendations: result.recommendation.results.length,
      triggers: result.triggers.length
    },
    null,
    2
  )
);

await prisma.$disconnect();
