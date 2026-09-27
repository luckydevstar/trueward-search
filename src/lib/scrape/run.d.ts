import type { Db } from "../db";

/**
 * Types for run.js, which stays JavaScript.
 *
 * The scraper and its seven sources are working code with no framework ties;
 * annotating 700 lines of them would change no behaviour. This describes the
 * surface the TypeScript side actually touches — without it, TS infers a
 * union across the source modules and loses `enabled`, which only some of
 * them declare.
 */
export type Source = {
  name: string;
  label: string;
  /** Absent means always on. Adzuna, for instance, needs API keys. */
  enabled?: () => boolean;
  disabledReason?: string;
  fetchJobs(context: {
    known: Set<string>;
    prefilter: (job: unknown, options?: { checkLocation?: boolean }) => { ok: boolean; reason?: string };
    reject: (job: unknown, reason: string) => Promise<void> | void;
    log: (message: string) => void;
  }): Promise<unknown[]>;
};

export type Run = {
  source: string;
  started_at: string | null;
  finished_at: string | null;
  fetched: number;
  accepted: number;
  inserted: number;
  error: string | null;
};

export const SOURCES: Source[];
export function isRunning(db: Db): Promise<boolean>;
export function runSource(db: Db, source: Source): Promise<Run>;
export function runAll(db: Db, names?: string[]): Promise<Run[]>;
