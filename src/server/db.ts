import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

process.env.DATABASE_URL ??= "file:../data/trade-system.db";
fs.mkdirSync(path.resolve(process.cwd(), "data"), { recursive: true });

export const prisma = new PrismaClient();
