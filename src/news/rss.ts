/**
 * The news reader lives in `supabase/functions/_shared` so the app and the
 * server that sends push notifications parse feeds with the same code rather
 * than two copies that can drift apart.
 */
export * from '../../supabase/functions/_shared/rss';
