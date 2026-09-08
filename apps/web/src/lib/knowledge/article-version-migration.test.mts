import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";

test("migration preserves history and serializes concurrent article versions", {
 skip: !process.env.EFB_MIGRATION_TEST_DATABASE_URL,
}, async () => {
 const pool = new pg.Pool({connectionString: process.env.EFB_MIGRATION_TEST_DATABASE_URL});
 const schema = `efb_test_${randomUUID().replaceAll("-", "")}`;
 const setup = await pool.connect();
 try {
  await setup.query(`CREATE SCHEMA "${schema}"`);
  await setup.query(`SET search_path TO "${schema}"`);
  await setup.query(`CREATE TABLE "KnowledgeArticle" (id TEXT PRIMARY KEY);
   CREATE TABLE "KnowledgeArticleRevision" (id TEXT PRIMARY KEY, "articleId" TEXT NOT NULL REFERENCES "KnowledgeArticle"(id), "createdAt" TIMESTAMP NOT NULL);
   INSERT INTO "KnowledgeArticle" VALUES ('article');
   INSERT INTO "KnowledgeArticleRevision" VALUES ('old-1','article','2026-01-01'), ('old-2','article','2026-01-02');`);
  await setup.query(await readFile(new URL("../../../prisma/migrations/20260908000000_efb_classification_versions/migration.sql", import.meta.url), "utf8"));
  const old = await setup.query('SELECT id, "version", "parentRevisionId" FROM "KnowledgeArticleRevision" ORDER BY "version"');
  assert.deepEqual(old.rows, [{id:"old-1",version:1,parentRevisionId:null},{id:"old-2",version:2,parentRevisionId:"old-1"}]);
  await Promise.all(Array.from({length:8},async (_,i) => {
   const client = await pool.connect();
   try {
    await client.query(`SET search_path TO "${schema}"`);
    await client.query('INSERT INTO "KnowledgeArticleRevision" (id,"articleId","createdAt") VALUES ($1,$2,NOW())',[`new-${i}`,"article"]);
   } finally {client.release();}
  }));
  const versions = await setup.query('SELECT version FROM "KnowledgeArticleRevision" ORDER BY version');
  assert.deepEqual(versions.rows.map(r => r.version),[1,2,3,4,5,6,7,8,9,10]);
 } finally {
  // The only dropped schema is the randomly generated fixture schema above.
  await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  setup.release(); await pool.end();
 }
});
