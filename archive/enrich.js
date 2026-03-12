#!/usr/bin/env node
// Enriches CSV card data with Scryfall API metadata
// Outputs cards.json for the frontend app

const fs = require('fs');
const https = require('https');

const CSV_PATH = './all.csv';
const OUTPUT_PATH = './public/cards.json';
const BATCH_SIZE = 75; // Scryfall collection endpoint limit
const DELAY_MS = 100; // Be nice to the API

// Oracle tags to fetch from Scryfall tagger
const ORACLE_TAGS_TO_FETCH = [
  'card-advantage', 'removal', 'board-wipe', 'spot-removal',
  'ramp', 'mana-dork', 'draw', 'tutor', 'counterspell',
  'lifegain', 'life-drain', 'burn', 'token-maker',
  'recursion', 'reanimation', 'mill', 'sacrifice-outlet',
  'blink', 'etb', 'evasion', 'pump', 'anthem',
  'discard', 'stax', 'tax', 'protection', 'haste-enabler',
  'land-destruction', 'graveyard-hate', 'combat-trick',
  'cantrip', 'treasure-maker', 'impulse-draw', 'looting',
  'bounce', 'copy', 'modal', 'landfall', 'proliferate',
  'equipment', 'aura', 'finisher', 'self-mill', 'aristocrats',
  'mana-fixing', 'fetch-land', 'extra-turn',
];

function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => obj[h] = values[i] || '');
    return obj;
  });
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

function fetchJSON(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(body);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'MTGCollectionApp/1.0',
        'Accept': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Failed to parse response: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function fetchGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'MTGCollectionApp/1.0', 'Accept': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Failed to parse: ${data.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchOracleTagIds(tag, oracleToCardIds) {
  // Fetch all oracle IDs matching a tag, then map back to collection card IDs.
  // Uses oracle_id so different printings still match.
  const matchingIds = new Set();
  const collectionOracleIds = new Set(oracleToCardIds.keys());
  let url = `https://api.scryfall.com/cards/search?q=oracletag%3A${encodeURIComponent(tag)}&order=name&unique=cards&format=json`;
  let page = 0;

  while (url) {
    page++;
    try {
      const result = await fetchGet(url);
      if (!result.data) break;

      for (const card of result.data) {
        const oid = card.oracle_id;
        if (oid && collectionOracleIds.has(oid)) {
          for (const cid of oracleToCardIds.get(oid)) {
            matchingIds.add(cid);
          }
        }
      }

      // Continue if there are more pages
      url = result.has_more ? result.next_page : null;
      if (url) await sleep(DELAY_MS);
    } catch (err) {
      // 404 means no results for this tag
      if (err.message && err.message.includes('404')) break;
      console.warn(`  Warning fetching tag "${tag}" page ${page}: ${err.message}`);
      break;
    }
  }
  return matchingIds;
}

async function main() {
  console.log('Reading CSV...');
  const csvText = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = parseCSV(csvText);
  console.log(`Parsed ${rows.length} rows from CSV`);

  // Deduplicate by Scryfall ID + owner, summing quantities
  const byKey = new Map();
  for (const row of rows) {
    const id = row['Scryfall ID'];
    if (!id) continue;
    const owner = (row['Owner'] || 'unknown').trim().toLowerCase();
    const key = `${id}::${owner}`;
    if (byKey.has(key)) {
      const existing = byKey.get(key);
      existing.quantity += parseInt(row['Quantity']) || 1;
      if (row['Foil'] === 'foil') existing.foil = true;
    } else {
      byKey.set(key, {
        scryfallId: id,
        owner: owner,
        quantity: parseInt(row['Quantity']) || 1,
        foil: row['Foil'] === 'foil',
        condition: row['Condition'] || 'near_mint',
        setCode: row['Set code'] || '',
        setName: row['Set name'] || '',
        collectorNumber: row['Collector number'] || '',
        purchasePrice: parseFloat(row['Purchase price']) || 0,
        currency: row['Purchase price currency'] || 'EUR',
      });
    }
  }

  // Group ownership info by Scryfall ID for merging into single card entries
  const byScryfall = new Map();
  for (const entry of byKey.values()) {
    if (!byScryfall.has(entry.scryfallId)) {
      byScryfall.set(entry.scryfallId, { ...entry, owners: [{ name: entry.owner, quantity: entry.quantity, foil: entry.foil, condition: entry.condition }] });
    } else {
      const existing = byScryfall.get(entry.scryfallId);
      existing.quantity += entry.quantity;
      existing.owners.push({ name: entry.owner, quantity: entry.quantity, foil: entry.foil, condition: entry.condition });
      if (entry.foil) existing.foil = true;
    }
  }

  const cards = Array.from(byScryfall.values());
  console.log(`${cards.length} unique cards to enrich`);

  // Batch fetch from Scryfall
  const enriched = [];
  const batches = Math.ceil(cards.length / BATCH_SIZE);

  for (let i = 0; i < batches; i++) {
    const batch = cards.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    const identifiers = batch.map(c => ({ id: c.scryfallId }));

    console.log(`Fetching batch ${i + 1}/${batches} (${batch.length} cards)...`);

    try {
      const result = await fetchJSON('https://api.scryfall.com/cards/collection', {
        identifiers,
      });

      if (result.data) {
        for (const card of result.data) {
          const csvData = byScryfall.get(card.id);
          if (!csvData) continue;

          // Handle double-faced cards
          const imageUris = card.image_uris || (card.card_faces && card.card_faces[0].image_uris) || {};
          const oracleText = card.oracle_text || (card.card_faces ? card.card_faces.map(f => f.oracle_text).join('\n// ') : '');
          const manaCost = card.mana_cost || (card.card_faces ? card.card_faces.map(f => f.mana_cost).filter(Boolean).join(' // ') : '');
          const typeLine = card.type_line || '';
          const power = card.power || (card.card_faces && card.card_faces[0].power) || null;
          const toughness = card.toughness || (card.card_faces && card.card_faces[0].toughness) || null;

          enriched.push({
            id: card.id,
            oracleId: card.oracle_id || null,
            name: card.name,
            manaCost: manaCost,
            cmc: card.cmc || 0,
            typeLine: typeLine,
            oracleText: oracleText,
            colors: card.colors || [],
            colorIdentity: card.color_identity || [],
            keywords: card.keywords || [],
            power: power,
            toughness: toughness,
            rarity: card.rarity || '',
            setCode: csvData.setCode,
            setName: csvData.setName,
            collectorNumber: csvData.collectorNumber,
            imageSmall: imageUris.small || '',
            imageNormal: imageUris.normal || '',
            imageLarge: imageUris.large || imageUris.normal || '',
            imageArtCrop: imageUris.art_crop || '',
            quantity: csvData.quantity,
            foil: csvData.foil,
            condition: csvData.condition,
            purchasePrice: csvData.purchasePrice,
            currency: csvData.currency,
            owners: csvData.owners,
            legalities: card.legalities || {},
            producedMana: card.produced_mana || [],
            layout: card.layout || 'normal',
            // For double-faced cards, store back face image
            backImage: (card.card_faces && card.card_faces[1] && card.card_faces[1].image_uris)
              ? card.card_faces[1].image_uris.normal : null,
          });
        }
      }

      if (result.not_found && result.not_found.length > 0) {
        console.warn(`  ${result.not_found.length} cards not found in this batch`);
      }
    } catch (err) {
      console.error(`  Error fetching batch ${i + 1}:`, err.message);
    }

    if (i < batches - 1) await sleep(DELAY_MS);
  }

  // Fetch oracle tags from Scryfall tagger
  console.log(`\nFetching oracle tags for ${ORACLE_TAGS_TO_FETCH.length} tags...`);
  // Build oracle_id → [card IDs] map so different printings still match
  const oracleToCardIds = new Map();
  for (const c of enriched) {
    if (!c.oracleId) continue;
    if (!oracleToCardIds.has(c.oracleId)) oracleToCardIds.set(c.oracleId, []);
    oracleToCardIds.get(c.oracleId).push(c.id);
  }
  const cardTags = new Map(); // id -> [tag, tag, ...]

  for (const tag of ORACLE_TAGS_TO_FETCH) {
    process.stdout.write(`  otag:${tag}...`);
    const ids = await fetchOracleTagIds(tag, oracleToCardIds);
    console.log(` ${ids.size} matches`);
    for (const id of ids) {
      if (!cardTags.has(id)) cardTags.set(id, []);
      cardTags.get(id).push(tag);
    }
    await sleep(DELAY_MS);
  }

  // Attach tags to enriched cards
  for (const card of enriched) {
    card.oracleTags = cardTags.get(card.id) || [];
  }

  const taggedCount = enriched.filter(c => c.oracleTags.length > 0).length;
  console.log(`Tagged ${taggedCount}/${enriched.length} cards with oracle tags`);

  // Sort by name
  enriched.sort((a, b) => a.name.localeCompare(b.name));

  // Ensure output directory exists
  if (!fs.existsSync('./public')) fs.mkdirSync('./public');

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(enriched, null, 0));
  console.log(`\nDone! Wrote ${enriched.length} enriched cards to ${OUTPUT_PATH}`);

  // Stats
  const totalQuantity = enriched.reduce((s, c) => s + c.quantity, 0);
  const totalValue = enriched.reduce((s, c) => s + (c.purchasePrice * c.quantity), 0);
  console.log(`Total cards (with duplicates): ${totalQuantity}`);
  console.log(`Estimated collection value: €${totalValue.toFixed(2)}`);
}

main().catch(console.error);
