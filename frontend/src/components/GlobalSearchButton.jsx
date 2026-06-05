// GlobalSearchButton.jsx — always-visible "Find by Photo" entry point.
//
// Why: the reverse-image-search feature is implemented as a modal that
// lives inside the MediaManager page. Outside of /media, there's no
// discoverable way to find it (no sidebar link, no top bar). This
// component floats a small button in the bottom-right of every page
// (except /login) so the feature is reachable from anywhere.
//
// The button mounts its own <LookupModal />. When the user picks a
// match, the modal closes, the URL navigates to /media?open=<id>,
// and MediaManager reads the query param after its media list
// loads, then opens the lightbox at the matching item.

import { useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FiCamera } from 'react-icons/fi';
import LookupModal from './LookupModal';

export default function GlobalSearchButton() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // useCallback must run unconditionally on every render — declare
  // it before any early return.
  const handlePickMatch = useCallback((match) => {
    setOpen(false);
    // The lightbox lives inside MediaManager. We pass the media_id
    // through the URL; MediaManager's useEffect resolves it after
    // `media` finishes loading and clears the param. If the user is
    // already on /media, that effect runs on the next media load —
    // i.e. immediately on remount of the route's data fetch.
    const target = match?.media_id
      ? `/media?open=${encodeURIComponent(match.media_id)}`
      : '/media';
    navigate(target);
  }, [navigate]);

  // Don't render the FAB on the login page — it would be visually
  // noisy and offers no value (no media to find).
  if (location.pathname === '/login') return null;

  return (
    <>
      {/* Floating action button. Bottom-right so it doesn't collide
          with the per-page page-header actions, and `pb-16 md:pb-0`
          on the layout (App.jsx) leaves a mobile nav strip — we
          add a small bottom offset so the FAB sits above it. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Find a video frame by uploading a still photo"
        aria-label="Find by photo"
        className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-30 flex items-center gap-2 px-4 py-3 text-xs font-mono uppercase tracking-widest text-amber-100 bg-amber-500/20 hover:bg-amber-500/30 ring-1 ring-amber-400/40 backdrop-blur-md rounded-full shadow-lg shadow-amber-500/10 transition-colors"
      >
        <FiCamera size={14} />
        <span className="hidden sm:inline">Find by Photo</span>
      </button>

      <LookupModal
        open={open}
        onClose={() => setOpen(false)}
        onPickMatch={handlePickMatch}
      />
    </>
  );
}
