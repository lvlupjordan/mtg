// Per-deck Commander-bracket runner. Reads one deck's inputs as JSON on stdin,
// runs the vendored scrollvault engine (bracket.js) headlessly in jsdom on OUR
// data — no Scryfall, no live scrollvault (land-legality.json is served from
// disk) — and writes {bracket, power, clock, detail} as JSON on stdout.
//
// This is the exact logic validated at 21/21 vs scrollvault in the offline
// batch (see ~/claude/mtg/bracket-port/engine.cjs), lifted into the request
// path. Input shape (built by app/bracket.py):
//   { name, entries:[{name,count}], commander, commanders:[..], raw:{name:card},
//     est, combos, tough_matters, mox_bracket }
process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const bracketSrc = fs.readFileSync(path.join(__dirname, 'bracket.js'), 'utf8');
const landLegality = fs.readFileSync(path.join(__dirname, 'land-legality.json'), 'utf8');

function findPower(o) { // dig for a "power X out of 10" score in the verdict
  if (!o || typeof o !== 'object') return null;
  for (const k of Object.keys(o)) { if (/power/i.test(k) && typeof o[k] === 'number' && o[k] <= 10.001) return o[k]; }
  for (const k of Object.keys(o)) { const v = findPower(o[k]); if (v != null) return v; }
  return null;
}

async function analyze(d) {
  const dom = new JSDOM(
    '<!DOCTYPE html><body><textarea id="decklistInput"></textarea><input id="commanderInput"></body>',
    { url: 'https://scrollvault.net/tools/commander-bracket/', runScripts: 'outside-only' }
  );
  const win = dom.window, doc = win.document;
  const stubs = {}, og = doc.getElementById.bind(doc);
  doc.getElementById = id => og(id) || (stubs[id] || (stubs[id] = doc.createElement('div')));
  const oqs = doc.querySelector.bind(doc);
  doc.querySelector = s => { try { return oqs(s) || doc.createElement('div') } catch (e) { return doc.createElement('div') } };
  win.requestAnimationFrame = cb => setTimeout(cb, 0);
  win.scrollTo = () => {};
  // Serve land-legality from disk; everything else the engine tries is stubbed.
  win.fetch = async (u) => {
    u = String(u);
    if (u.includes('land-legality')) return new win.Response(landLegality, { status: 200 });
    return new win.Response('{}', { status: 200 });
  };
  doc.getElementById('decklistInput').value = d.entries.map(e => `${e.count} ${e.name}`).join('\n');
  doc.getElementById('commanderInput').value = d.commander;

  try { win.eval(bracketSrc); } catch (e) { return null; }

  // Our card data (no Scryfall). Toughness-as-damage improvement: when the deck
  // runs a "combat damage equal to toughness" enabler, pre-boost each creature's
  // power to max(power,toughness) so the goldfish sim clocks walls correctly.
  win.lookupCards = async () => {
    const cm = {};
    for (const k of Object.keys(d.raw)) {
      const raw = d.raw[k];
      const t = win.trimScryfallCard(raw);
      if (d.tough_matters && /creature/i.test(raw.type_line || '')) {
        const p = parseInt(t.power, 10), tg = parseInt(t.toughness, 10);
        if (!isNaN(p) && !isNaN(tg) && tg > p) t.power = String(tg);
      }
      cm[raw.name.toLowerCase()] = t;
    }
    return cm;
  };
  // Commander Spellbook bracket estimate. The one enrichment we replicate from
  // scrollvault's proxy: a combo floors as "two-card" only if it has exactly 2
  // card-uses total (definitelyTwoCard || (arguablyTwoCard && relevant)).
  win.fetchSpellbookBracket = async () => {
    try {
      for (const c of (d.est.combos || [])) {
        const uses = (c.combo && c.combo.uses) || [];
        const cards = uses.filter(u => u.card).length, tmpl = uses.filter(u => !u.card).length;
        const two = (cards === 2 && tmpl === 0);
        // Only a GENUINE infinite counts toward the two-card-infinite floor.
        // Commander Spellbook's "Near-infinite ..." results are big-but-finite and
        // often conditional (e.g. Rionya + Terror of the Peaks scales with the
        // instants/sorceries you've cast that turn — two cards alone do ~5 damage),
        // yet CS still flags them definitelyTwoCard. A produced feature is a real
        // infinite only if its name starts with "Infinite" (excludes "Near-infinite").
        const produces = (c.combo && c.combo.produces) || [];
        const trulyInfinite = produces.some(f =>
          ((f && f.feature && f.feature.name) || '').toLowerCase().startsWith('infinite'));
        c.definitelyTwoCard = two && trulyInfinite && (c.definitelyTwoCard || (c.arguablyTwoCard && c.relevant));
      }
    } catch (e) {}
    return win.normalizeSpellbookEstimate(d.est);
  };
  win.fetchSpellbookCombos = async () => {
    // Same gate on the find-my-combos path: a two-card combo that produces only a
    // "Near-infinite ..." (finite) result shouldn't count as a two-card-infinite
    // floor, so drop those from what the engine sees. Genuine infinites and any
    // non-two-card combos pass through untouched.
    try {
      const res = d.combos && d.combos.results;
      if (res && Array.isArray(res.included)) {
        res.included = res.included.filter(c => {
          const uses = c.uses || [];
          const cards = uses.filter(u => u.card).length, tmpl = uses.filter(u => !u.card).length;
          if (!(cards === 2 && tmpl === 0)) return true;   // only gate two-card combos
          return (c.produces || []).some(f =>
            ((f && f.feature && f.feature.name) || '').toLowerCase().startsWith('infinite'));
        });
      }
    } catch (e) {}
    return d.combos;
  };

  let cap = null;
  if (typeof win.determineBracket === 'function') {
    const o = win.determineBracket;
    win.determineBracket = function (a) { const r = o.apply(this, arguments); cap = { r, a }; return r; };
  }
  try { await win.analyzeDeck(); } catch (e) {}
  await new Promise(r => setTimeout(r, 1500));
  if (!cap) return null;

  const r = cap.r, a = cap.a;
  const combos = (a.twoCardComboDetails || []).concat(a.fmcTwoCardInfiniteFloor || [])
    .map(c => ({ cards: c.cardNames, produces: c.producesText }))
    .filter(c => c.cards && c.cards.length);
  const detail = {
    floorReasons: (r.floorReasons || []).map(f => f.text || f),
    gameChangers: a.gameChangerNames || [],
    combos,
    altWins: ((a.altWins && a.altWins.cards) || []).map(c => c.name),
    tag: a.spellbookTag,
  };
  return {
    bracket: r.bracket && r.bracket.num,
    power: findPower(r),
    clock: a.goldfishClock && a.goldfishClock.median,
    detail,
  };
}

(async () => {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  let out = null;
  try {
    const d = JSON.parse(input);
    out = await analyze(d);
  } catch (e) {
    process.stderr.write('run.cjs error: ' + (e && e.message) + '\n');
  }
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
})();
