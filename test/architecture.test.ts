import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

async function typescriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return typescriptFiles(path);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  }));
  return nested.flat();
}

test("domain and application do not depend on infrastructure or HTTP frameworks", async () => {
  const domainFiles = await typescriptFiles(join(process.cwd(), "src/domain"));
  const applicationFiles = await typescriptFiles(join(process.cwd(), "src/application"));
  const domainSources = await Promise.all(domainFiles.map((file) => readFile(file, "utf8")));
  const applicationSources = await Promise.all(applicationFiles.map((file) => readFile(file, "utf8")));

  assert.ok(domainSources.every((source) =>
    !/from\s+["'][^"']*(infrastructure|express|fastify|node:http|prisma|mongoose|sequelize|typeorm|knex|pg|mysql2|sqlite)/i.test(source),
  ));
  assert.ok(applicationSources.every((source) => !/from\s+["'][^"']*infrastructure/i.test(source)));
});
