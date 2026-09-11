import { useCallback, useEffect, useState } from 'react';
import type { Artist, Track } from '@/src/core/types';
import {
  addTrackToLibrary,
  isFavorite,
  isFollowingArtist,
  isInLibrary,
  followArtist,
  removeFromLibrary,
  toggleFavorite,
  unfollowArtist,
} from '@/src/db/repos/library';

/** Tracks whether one item is saved/liked, with optimistic toggling. */
export function useSavedState(type: 'track' | 'album' | 'artist' | 'playlist', id: string | null) {
  const [saved, setSaved] = useState(false);
  const [liked, setLiked] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void Promise.all([isInLibrary(type, id), isFavorite(type, id)]).then(([inLibrary, favorite]) => {
      if (cancelled) return;
      setSaved(inLibrary);
      setLiked(favorite);
    });
    return () => {
      cancelled = true;
    };
  }, [type, id]);

  const toggleSaved = useCallback(
    async (track?: Track) => {
      if (!id) return false;
      if (saved) {
        await removeFromLibrary(type, id);
        setSaved(false);
        return false;
      }
      if (track) await addTrackToLibrary(track);
      setSaved(true);
      return true;
    },
    [id, saved, type],
  );

  const toggleLiked = useCallback(
    async (track?: Track) => {
      if (!id) return false;
      const next = await toggleFavorite(type, id);
      setLiked(next);
      if (next && track) {
        await addTrackToLibrary(track);
        setSaved(true);
      }
      return next;
    },
    [id, type],
  );

  return { saved, liked, toggleSaved, toggleLiked };
}

export function useFollowState(artist: Artist | null | undefined) {
  const [following, setFollowing] = useState(false);

  useEffect(() => {
    if (!artist) return;
    let cancelled = false;
    void isFollowingArtist(artist.id).then((value) => {
      if (!cancelled) setFollowing(value);
    });
    return () => {
      cancelled = true;
    };
  }, [artist]);

  const toggle = useCallback(async () => {
    if (!artist) return false;
    if (following) {
      await unfollowArtist(artist.id);
      setFollowing(false);
      return false;
    }
    await followArtist(artist);
    setFollowing(true);
    return true;
  }, [artist, following]);

  return { following, toggle };
}
