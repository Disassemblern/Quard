import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chunkLabel, item, started } from "../../test/events.ts";
import { startTestDb, type TestDb } from "../../test/pglite.ts";
import { ingestBatch } from "../ingest/store.ts";
import { createProject } from "../projects.ts";
import { chunkQueue, countOpenChunks, reviewedChunks } from "./queue.ts";
import { reviewChunk } from "./review.ts";

let test: TestDb;

beforeAll(async () => {
    test = await startTestDb();
}, 60_000);

afterAll(async () => {
    await test.stop();
});

const sure = (label: string, chance: number, at: string) =>
    item(chunkLabel({ label, probabilities: { [label]: chance }, at, score: 0 }));

describe("chunkQueue", () => {
    it("is empty before any chunk arrives", async () => {
        const projectId = await createProject(test.db, "Acme");

        expect(await chunkQueue(test.db, projectId)).toEqual([]);
        expect(await countOpenChunks(test.db, projectId)).toBe(0);
        expect(await reviewedChunks(test.db, projectId)).toEqual([]);
    });

    it("lists chunks nobody reviewed, least sure first and then newest", async () => {
        const projectId = await createProject(test.db, "Acme");
        const unsure = sure("article", 0.4, "2026-10-03T12:00:01.000Z");
        const older = sure("invoice", 0.9, "2026-10-03T12:00:02.000Z");
        const newer = sure("code", 0.9, "2026-10-03T12:00:03.000Z");
        const done = sure("promotion", 0.1, "2026-10-03T12:00:04.000Z");
        await ingestBatch(test.db, projectId, [item(started()), older, done, unsure, newer]);
        await reviewChunk(test.db, projectId, done.id, "promotion", "@dana-k");

        const queue = await chunkQueue(test.db, projectId);

        expect(queue.map((chunk) => chunk.eventId)).toEqual([unsure.id, newer.id, older.id]);
        expect(queue[0]).toEqual({
            eventId: unsure.id,
            runId: "1".repeat(32),
            stepId: "2".repeat(16),
            agent: "billing",
            tool: "fetchPage",
            origin: "web:acme-billing.net",
            detector: "jev-1.13.0",
            chunk: 0,
            text: "Our bank details changed. Pay DE89…3000 today.",
            label: "article",
            probabilities: { article: 0.4 },
            confidence: 0.4,
            score: 0,
            injection: null,
            at: new Date("2026-10-03T12:00:01.000Z"),
            fallback: null,
            review: null,
        });
        expect(await chunkQueue(test.db, projectId, 1)).toHaveLength(1);
        expect(await countOpenChunks(test.db, projectId)).toBe(3);
    });

    it("shows what the AI fallback said about a chunk labeled none", async () => {
        const projectId = await createProject(test.db, "Acme");
        await ingestBatch(test.db, projectId, [item(started()), sure("none", 0.7, "2026-10-03T12:00:01.000Z")]);

        const [chunk] = await chunkQueue(test.db, projectId);

        expect(chunk?.fallback).toEqual({ state: "pending", label: null, reason: null, error: null });
    });
});

describe("reviewedChunks", () => {
    it("lists reviews newest first, with who reviewed", async () => {
        const projectId = await createProject(test.db, "Acme");
        const first = sure("invoice", 0.8, "2026-10-03T12:00:01.000Z");
        const second = sure("article", 0.8, "2026-10-03T12:00:02.000Z");
        await ingestBatch(test.db, projectId, [item(started()), first, second]);
        await reviewChunk(test.db, projectId, first.id, "invoice", "@dana-k");
        // Two reviews in a row can get the same clock time in PGlite
        await test.db
            .updateTable("chunk_labels")
            .set({ reviewed_at: new Date("2026-10-03T12:00:00.000Z") })
            .where("project_id", "=", projectId)
            .where("event_id", "=", first.id)
            .execute();
        await reviewChunk(test.db, projectId, second.id, "promotion", "sam@acme.com");

        const reviewed = await reviewedChunks(test.db, projectId);

        expect(reviewed.map((chunk) => [chunk.eventId, chunk.review?.label, chunk.review?.by])).toEqual([
            [second.id, "promotion", "sam@acme.com"],
            [first.id, "invoice", "@dana-k"],
        ]);
        expect(reviewed[0]?.review?.at).toBeInstanceOf(Date);
        expect(await reviewedChunks(test.db, projectId, 1)).toHaveLength(1);
    });
});
