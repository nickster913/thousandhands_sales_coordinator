// Creates (if needed) and resets the test database before `npm test`.
// Never touches a database whose name doesn't end in "_test".
import { spawnSync } from "node:child_process";

const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://thousandhands:thousandhands@localhost:5432/thousandhands_test?schema=public";

const dbName = new URL(url).pathname.replace(/^\//, "").split("?")[0];
if (!dbName.endsWith("_test")) {
  console.error(`Refusing to reset "${dbName}": TEST_DATABASE_URL must point at a database ending in _test.`);
  process.exit(1);
}

const win = process.platform === "win32";

const ensure = spawnSync(
  "docker",
  [
    "compose",
    "exec",
    "-T",
    "db",
    "psql",
    "-U",
    "thousandhands",
    "-d",
    "postgres",
    "-c",
    `SELECT 'CREATE DATABASE ${dbName}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='${dbName}')\\gexec`,
  ],
  { encoding: "utf8", shell: win },
);

if (ensure.status !== 0) {
  console.warn(
    `\n[test-db] Could not ensure ${dbName} exists (is Postgres running? \`npm run db:up\`).\n${ensure.stderr || ensure.stdout}\n`,
  );
}

const reset = spawnSync("npx", ["prisma", "migrate", "reset", "--force", "--skip-seed", "--skip-generate"], {
  env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
  encoding: "utf8",
  shell: win,
});

if (reset.status === 0) {
  console.log(`Test database ${dbName} reset.`);
} else {
  console.warn(
    `\n[test-db] Could not reset ${dbName} (is Postgres running? \`npm run db:up\`). DB tests will be skipped.\n${reset.stderr}\n`,
  );
}
