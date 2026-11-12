import { supabase } from '@/lib/supabase';
import { useAsync } from '@/src/hooks/use-async';

/**
 * Pulse News: updates written by Pulse's own editors, from inside the app.
 *
 * Only admins can write, and only admins see anything until the
 * "pulse_news_public" switch is turned on — then everyone sees the published
 * posts. The server enforces all of this (see migration 0008); the app only
 * asks.
 */

export type NewsRegion = 'kenya' | 'usa' | 'global';

export const REGIONS: { value: NewsRegion; label: string }[] = [
  { value: 'kenya', label: 'Kenya' },
  { value: 'usa', label: 'USA' },
  { value: 'global', label: 'Worldwide' },
];

export interface PulseNewsPost {
  id: string;
  title: string;
  body: string;
  region: NewsRegion;
  imageUrl: string | null;
  linkUrl: string | null;
  published: boolean;
  createdAt: number;
}

interface Row {
  id: string;
  title: string;
  body: string;
  region: NewsRegion;
  image_url: string | null;
  link_url: string | null;
  published: boolean;
  created_at: string;
}

const toPost = (row: Row): PulseNewsPost => ({
  id: row.id,
  title: row.title,
  body: row.body,
  region: row.region,
  imageUrl: row.image_url,
  linkUrl: row.link_url,
  published: row.published,
  createdAt: Date.parse(row.created_at),
});

function client() {
  if (!supabase) throw new Error('Pulse News needs the Pulse server. This build is not connected to one.');
  return supabase;
}

let adminMemo: { userId: string; value: boolean } | null = null;

/** Whether the signed-in account is a Pulse editor. */
export async function amAdmin(): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (!userId) return false;
  if (adminMemo?.userId === userId) return adminMemo.value;
  const { data: row } = await supabase.from('profiles').select('is_admin').eq('id', userId).maybeSingle();
  const value = !!(row as { is_admin?: boolean } | null)?.is_admin;
  adminMemo = { userId, value };
  return value;
}

export function useIsAdmin(): boolean {
  return useAsync(() => amAdmin().catch(() => false), []).data ?? false;
}

/** Whether everyone (not just editors) can see Pulse News right now. */
export async function isNewsPublic(): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.from('app_flags').select('value').eq('key', 'pulse_news_public').maybeSingle();
  return !!(data as { value?: boolean } | null)?.value;
}

export async function setNewsPublic(value: boolean): Promise<void> {
  const { error } = await client()
    .from('app_flags')
    .update({ value, updated_at: new Date().toISOString() })
    .eq('key', 'pulse_news_public');
  if (error) throw new Error(error.message);
}

/**
 * The posts to show. Readers get published posts once the switch is on;
 * editors get everything, drafts included. The server decides which.
 */
export async function listPulseNews(options: { region?: NewsRegion | 'all'; limit?: number } = {}): Promise<PulseNewsPost[]> {
  if (!supabase) return [];
  let query = supabase
    .from('news_posts')
    .select('id, title, body, region, image_url, link_url, published, created_at')
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 50);
  if (options.region && options.region !== 'all') query = query.eq('region', options.region);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(toPost);
}

export interface PostDraft {
  title: string;
  body: string;
  region: NewsRegion;
  imageUrl?: string | null;
  linkUrl?: string | null;
}

export async function createPost(draft: PostDraft): Promise<PulseNewsPost> {
  const db = client();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('Sign in first.');
  const { data, error } = await db
    .from('news_posts')
    .insert({
      author_id: auth.user.id,
      title: draft.title.trim(),
      body: draft.body.trim(),
      region: draft.region,
      image_url: draft.imageUrl?.trim() || null,
      link_url: draft.linkUrl?.trim() || null,
    })
    .select('id, title, body, region, image_url, link_url, published, created_at')
    .single();
  if (error) throw new Error(error.message);
  return toPost(data as Row);
}

export async function setPostPublished(id: string, published: boolean): Promise<void> {
  const { error } = await client()
    .from('news_posts')
    .update({ published, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deletePost(id: string): Promise<void> {
  const { error } = await client().from('news_posts').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
