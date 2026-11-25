import { useEffect, useMemo, useRef, useState } from 'react';
import { artworkCandidates, resolveArtwork } from '../../utils/cardArtwork';
import { useCardPage } from './context';

// Artwork for one card, loaded when the card comes near the screen.
export function useArtwork(card, eager = false) {
  const { catalogById } = useCardPage();
  const ref = useRef(null);
  const [state, setState] = useState({ status: 'waiting', art: null, for: null });
  const candidates = useMemo(() => artworkCandidates(card, catalogById), [card, catalogById]);
  const key = candidates.map((c) => c.src).join('|');

  useEffect(() => {
    let live = true;
    const start = () => resolveArtwork(candidates).then((art) => { if (live) setState({ status: art ? 'art' : 'fallback', art, for: key }); });
    const el = ref.current;
    if (eager || !el || typeof IntersectionObserver === 'undefined') { start(); return () => { live = false; }; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { observer.disconnect(); start(); }
    }, { rootMargin: '300px' });
    observer.observe(el);
    return () => { live = false; observer.disconnect(); };
    // `key` stands for the candidate list, which is rebuilt on every data load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, eager]);

  if (!candidates.length) return { ref, status: 'fallback', art: null };
  return state.for === key ? { ref, ...state } : { ref, status: 'loading', art: null };
}
