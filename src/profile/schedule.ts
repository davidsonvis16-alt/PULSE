/**
 * A profile picture that follows the day.
 *
 * The listener splits the 24 hours into equal parts and gives each part a look:
 * a feeling, one of their own photos, or the picture from a news story. The
 * avatar shows whichever part of the day it is now, and the same schedule
 * repeats every day. A part left empty falls back to the ordinary avatar.
 *
 * Everything here is pure so it can be tested without a device.
 */

export interface Feeling {
  id: string;
  name: string;
  /** An Ionicons name, drawn in white on the feeling's own colours. */
  icon: string;
  /** Two colours for the badge's wash, light to deep. */
  colors: [string, string];
}

export const FEELINGS: Feeling[] = [
  { id: 'happy', name: 'Happy', icon: 'happy', colors: ['#FFD66B', '#F2A93B'] },
  { id: 'loved', name: 'In love', icon: 'heart', colors: ['#FF8FB1', '#E0447A'] },
  { id: 'hyped', name: 'Hyped', icon: 'flame', colors: ['#FFA24C', '#E5532B'] },
  { id: 'celebrating', name: 'Celebrating', icon: 'sparkles', colors: ['#D8FF52', '#8FC21F'] },
  { id: 'chill', name: 'Chill', icon: 'cafe', colors: ['#5FE0C6', '#1F9C84'] },
  { id: 'calm', name: 'Calm', icon: 'leaf', colors: ['#8EA6FF', '#4A66E0'] },
  { id: 'focused', name: 'Focused', icon: 'headset', colors: ['#B3A5FF', '#6B55E0'] },
  { id: 'nostalgic', name: 'Nostalgic', icon: 'time', colors: ['#E0B084', '#9C6B3F'] },
  { id: 'sleepy', name: 'Sleepy', icon: 'moon', colors: ['#6F7DB8', '#2E3766'] },
  { id: 'sad', name: 'Sad', icon: 'rainy', colors: ['#8CC8F2', '#3C7FB8'] },
  { id: 'moody', name: 'Moody', icon: 'cloudy', colors: ['#9AA1AD', '#555B66'] },
  { id: 'angry', name: 'Fired up', icon: 'flash', colors: ['#FF8A8A', '#D63C3C'] },
];

export function getFeeling(id: string | null | undefined): Feeling | undefined {
  return FEELINGS.find((f) => f.id === id);
}

export type AvatarLook =
  | { kind: 'feeling'; feelingId: string }
  /** A photo the listener picked, copied into Pulse's own storage. */
  | { kind: 'photo'; uri: string }
  /** The picture from a news story, remembered with the story it came from. */
  | { kind: 'news'; imageUrl: string; title: string; link: string };

export interface AvatarSchedule {
  enabled: boolean;
  /** One entry per part of the day, starting at midnight. */
  slots: (AvatarLook | null)[];
}

/** Ways to split the day. Each divides 24 hours into whole hours. */
export const SLOT_COUNTS = [1, 2, 3, 4, 6, 8, 12] as const;

export const DEFAULT_SCHEDULE: AvatarSchedule = { enabled: false, slots: [null, null, null, null] };

const DAY_MINUTES = 24 * 60;

function minutesIntoDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

/** Which part of the day `date` falls in, for a day split `count` ways. */
export function slotIndexAt(count: number, date: Date = new Date()): number {
  if (count <= 1) return 0;
  const index = Math.floor(minutesIntoDay(date) / (DAY_MINUTES / count));
  return Math.min(count - 1, Math.max(0, index));
}

/** When the current part of the day ends and the next look takes over. */
export function nextChangeAt(count: number, date: Date = new Date()): Date {
  const span = DAY_MINUTES / Math.max(1, count);
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  next.setMinutes((slotIndexAt(count, date) + 1) * span);
  return next;
}

function hourLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24;
  if (hour === 0) return 'Midnight';
  if (hour === 12) return 'Noon';
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

/** "6 AM – Noon", or "All day" when the day is not split. */
export function slotLabel(index: number, count: number): string {
  if (count <= 1) return 'All day';
  const span = DAY_MINUTES / count;
  return `${hourLabel(index * span)} – ${hourLabel((index + 1) * span)}`;
}

/** The look to show right now, or null for the ordinary avatar. */
export function lookAt(schedule: AvatarSchedule, date: Date = new Date()): AvatarLook | null {
  if (!schedule.enabled || schedule.slots.length === 0) return null;
  return schedule.slots[slotIndexAt(schedule.slots.length, date)] ?? null;
}

/**
 * Re-splits the day without losing what the listener already chose: each new
 * part takes the look that was showing when it starts. Splitting finer copies a
 * look into every part it covered; splitting coarser keeps the one at the start.
 */
export function resizeSlots(slots: (AvatarLook | null)[], count: number): (AvatarLook | null)[] {
  const oldCount = Math.max(1, slots.length);
  return Array.from({ length: count }, (_, index) => {
    const startMinute = (index * DAY_MINUTES) / count;
    const oldIndex = Math.min(oldCount - 1, Math.floor(startMinute / (DAY_MINUTES / oldCount)));
    return slots[oldIndex] ?? null;
  });
}

function validLook(value: unknown): AvatarLook | null {
  if (!value || typeof value !== 'object') return null;
  const look = value as Record<string, unknown>;
  if (look.kind === 'feeling' && getFeeling(look.feelingId as string)) {
    return { kind: 'feeling', feelingId: look.feelingId as string };
  }
  if (look.kind === 'photo' && typeof look.uri === 'string' && look.uri) {
    return { kind: 'photo', uri: look.uri };
  }
  if (look.kind === 'news' && typeof look.imageUrl === 'string' && look.imageUrl) {
    return {
      kind: 'news',
      imageUrl: look.imageUrl,
      title: typeof look.title === 'string' ? look.title : '',
      link: typeof look.link === 'string' ? look.link : '',
    };
  }
  return null;
}

/** Reads a stored schedule defensively: anything malformed becomes an empty part. */
export function normaliseSchedule(raw: unknown): AvatarSchedule {
  if (!raw || typeof raw !== 'object') return DEFAULT_SCHEDULE;
  const value = raw as { enabled?: unknown; slots?: unknown };
  const slots = Array.isArray(value.slots) ? value.slots.map(validLook) : [];
  const count = (SLOT_COUNTS as readonly number[]).includes(slots.length) ? slots.length : 0;
  return {
    enabled: value.enabled === true,
    slots: count ? slots : resizeSlots(slots, DEFAULT_SCHEDULE.slots.length),
  };
}
