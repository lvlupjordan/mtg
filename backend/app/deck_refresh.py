"""Deck-level refresh.

Refreshing a deck rebuilds everything derived from its Moxfield list — the
composition AND the Commander bracket — in one operation. This is what the deck
page's Refresh button triggers.

Kept separate from ``composition.get_composition`` on purpose: a refresh now
affects more than the composition, and the composition read/build path is also
used by the background tagger (which should NOT recompute brackets on every tag
pass). The single composition build hands its already-fetched Moxfield data
(entries/commanders/bracket) straight to the bracket step, so a refresh fetches
Moxfield only once.
"""
import logging

from sqlalchemy.orm import Session

from app import composition, bracket

log = logging.getLogger("composition.refresh")


def refresh_deck(db: Session, deck) -> dict:
    """Rebuild composition + recompute bracket for a deck; return the fresh
    composition payload (which carries the bracket fields). If another build is
    already in progress the composition build returns a `building` status and the
    bracket step is skipped — the caller polls until it settles."""
    composition.ensure_table(db)
    if not deck.moxfield_url:
        raise ValueError("No Moxfield URL set for this deck")

    resp, ctx = composition.run_build(db, deck)
    if ctx is None:
        return resp  # another build holds the lock; response is a building status

    # Recompute the bracket from the same Moxfield data (best-effort, hash-gated).
    try:
        wrote = bracket.compute_and_store(
            db, deck.id, ctx["entries"], ctx["commanders"], ctx["mox_bracket"], deck.commander)
        if wrote:
            resp = composition.get_composition(db, deck)  # re-read snapshot with fresh bracket
    except Exception as e:
        log.warning("bracket compute failed during refresh deck=%s: %s", deck.id, e)

    return resp
