import { supabase } from '@/lib/supabase';
import type { Freestyle } from '@/src/radio/freestyles';

/**
 * Songs of the Week.
 *
 * Every week the first twenty freestyles uploaded to Pulse Radio make the
 * ballot, and every listener picks a top five in order — five points for
 * first place down to one for fifth. Totals are public; who voted for what is
 * not. The server does the counting and every check (see migration 0006).
 */

export const BALLOT_SIZE = 20;
export const TOP_PICKS = 5;

export interface BallotEntry extends Freestyle {
  points: number;
  voters: number;
  /** Where this listener placed it, 1–5, or null. */
  myRank: number | null;
}

export interface Ballot {
  weekStart: string | null;
  entries: BallotEntry[];
}

export interface WeekResult {
  place: number;
  freestyle: Freestyle;
  points: number;
  voters: number;
}

function client() {
  if (!supabase) throw new Error('Voting needs the Pulse server. This build is not connected to one.');
  return supabase;
}

function freestyleOf(row: Record<string, unknown>): Freestyle {
  const handle = (row.handle as string | null) ?? null;
  return {
    id: row.id as string,
    userId: (row.user_id as string | undefined) ?? '',
    title: row.title as string,
    storagePath: row.storage_path as string,
    durationMs: row.duration_ms as number,
    createdAt: row.created_at ? new Date(row.created_at as string).getTime() : 0,
    artistName: (row.display_name as string | null) ?? (handle ? `@${handle}` : 'Someone on Pulse'),
    handle,
    avatarUrl: (row.avatar_url as string | null) ?? null,
  };
}

export async function fetchBallot(): Promise<Ballot> {
  const { data, error } = await client().rpc('radio_week_ballot');
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    weekStart: (rows[0]?.week_start as string | undefined) ?? null,
    entries: rows.map((row) => ({
      ...freestyleOf(row),
      points: Number(row.points ?? 0),
      voters: Number(row.voters ?? 0),
      myRank: row.my_rank == null ? null : Number(row.my_rank),
    })),
  };
}

/** Saves this listener's top five, first place first. Replaces any earlier picks. */
export async function submitVotes(freestyleIds: string[]): Promise<void> {
  const { error } = await client().rpc('submit_radio_votes', { picks: freestyleIds });
  if (error) throw new Error(error.message);
}

/** The Monday a week starts on, as the server counts weeks (UTC). */
export function weekStartOf(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - sinceMonday);
  return day.toISOString().slice(0, 10);
}

/** Last week's top five. */
export async function fetchLastWeekResults(now = new Date()): Promise<WeekResult[]> {
  const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const { data, error } = await client().rpc('radio_week_results', { week: weekStartOf(lastWeek) });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    place: Number(row.place),
    freestyle: freestyleOf(row),
    points: Number(row.points ?? 0),
    voters: Number(row.voters ?? 0),
  }));
}

/** Time left before the ballot closes: Sunday midnight, UTC. */
export function votingClosesIn(now = new Date()): number {
  const start = new Date(`${weekStartOf(now)}T00:00:00Z`).getTime();
  return start + 7 * 24 * 60 * 60 * 1000 - now.getTime();
}
