#!/usr/bin/env node
// Imports Matt's CSV into all.csv by looking up Scryfall IDs
const fs = require('fs');
const https = require('https');

const INPUT = './mtgcb-collection-2026-02-14.csv';
const OUTPUT = './all.csv';
const OWNER = 'matt';
const BATCH_SIZE = 75;
const DELAY_MS = 110;

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current.trim()); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current.trim());
  return result;
}

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
        catch (e) { reject(new Error(`Parse error: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function escapeCSV(val) {
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

async function main() {
  const csvText = fs.readFileSync(INPUT, 'utf-8');
  const rows = parseCSV(csvText);
  console.log(`Read ${rows.length} rows from Matt's CSV`);

  // Build identifiers for Scryfall collection lookup (set + collector_number)
  const identifiers = rows.map(r => ({
    set: r['Edition'].toLowerCase(),
    collector_number: r['Collector Number'],
  }));

  // Batch lookup
  const scryfallCards = new Map(); // "set:num" -> scryfall card
  const batches = Math.ceil(identifiers.length / BATCH_SIZE);

  for (let i = 0; i < batches; i++) {
    const batch = identifiers.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    console.log(`Scryfall batch ${i + 1}/${batches} (${batch.length} cards)...`);

    try {
      const result = await fetchJSON('https://api.scryfall.com/cards/collection', { identifiers: batch });
      if (result.data) {
        for (const card of result.data) {
          const key = `${card.set}:${card.collector_number}`;
          scryfallCards.set(key, card);
        }
      }
      if (result.not_found && result.not_found.length > 0) {
        console.warn(`  ${result.not_found.length} not found`);
      }
    } catch (err) {
      console.error(`  Error: ${err.message}`);
    }

    if (i < batches - 1) await sleep(DELAY_MS);
  }

  console.log(`Resolved ${scryfallCards.size} Scryfall cards`);

  // Build all.csv rows
  const newLines = [];
  let matched = 0, missed = 0;

  for (const row of rows) {
    const set = row['Edition'].toLowerCase();
    const num = row['Collector Number'];
    const key = `${set}:${num}`;
    const card = scryfallCards.get(key);

    if (!card) {
      console.warn(`  Missing: ${row['Name']} (${set} #${num})`);
      missed++;
      continue;
    }

    matched++;
    const qty = parseInt(row['Count']) || 1;
    const foil = (row['Foil'] || '').toLowerCase() === 'foil' ? 'foil' : 'normal';
    const condition = (row['Condition'] || 'near_mint').toLowerCase().replace(/\s+/g, '_') || 'near_mint';
    const price = row['Purchase Price'] || '0';

    // Format: Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency,Owner
    const csvRow = [
      escapeCSV(card.name),
      card.set.toUpperCase(),
      escapeCSV(card.set_name),
      card.collector_number,
      foil,
      card.rarity,
      qty,
      '', // ManaBox ID
      card.id,
      price,
      'false',
      'false',
      condition,
      'en',
      'EUR',
      OWNER,
    ].join(',');

    newLines.push(csvRow);
  }

  console.log(`\nMatched: ${matched}, Missed: ${missed}`);

  // Append to all.csv
  const existing = fs.readFileSync(OUTPUT, 'utf-8').trimEnd();
  fs.writeFileSync(OUTPUT, existing + '\n' + newLines.join('\n') + '\n');
  console.log(`Appended ${newLines.length} rows to ${OUTPUT}`);
}

main().catch(console.error);
