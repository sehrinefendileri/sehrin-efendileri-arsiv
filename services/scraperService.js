import axios from 'axios';
import * as cheerio from 'cheerio';
import { env } from '../config/env.js';
import { parseNumber } from '../utils/parser.js';
import { normalizeText } from '../utils/textUtils.js';

function extractHeaders($, table) {
  const headers = {};
  table.find('tr').each((_, row) => {
    if (headers.nick !== undefined) return;
    $(row).find('td, th').each((i, el) => {
      const text = normalizeText($(el).text());
      if (text.includes('sira')) headers.sira = i;
      if (text.includes('nick')) headers.nick = i;
      if (text.includes('oldurme')) headers.oldurme = i;
      if (text.includes('headshot')) headers.headshot = i;
      if (text.includes('olumler')) headers.olumler = i;
      if (text.includes('mermiler')) headers.mermiler = i;
      if (text.includes('hedef')) headers.hedef_tutturma = i;
    });
  });
  return headers;
}
export async function fetchPlayers() {
  const response = await axios.get(env.panelUrl, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } });
  const $ = cheerio.load(response.data);
  const table = $('table#table1').first();
  if (!table.length) throw new Error('Panel Tablosu bulunamadı');
  const headers = extractHeaders($, table);
  const players = []; let totalKills = 0;
  table.find('tr').each((i, el) => {
    const cols = $(el).find('td');
    if (cols.length < 5) return;
    const nick = $(cols[headers.nick]).text().trim();
    if (!nick || nick.toUpperCase() === 'NICK' || nick === '---') return;
    const currentKills = parseNumber($(cols[headers.oldurme]).text());
    players.push({
      sira: parseNumber($(cols[headers.sira]).text()) || i, nick, oldurme: currentKills,
      olumler: $(cols[headers.olumler]).text().trim(),
      mermiler: parseNumber($(cols[headers.mermiler]).text()),
      headshot: $(cols[headers.headshot]).text().trim(),
      hedef_tutturma: $(cols[headers.hedef_tutturma]).text().trim(), updated_at: new Date()
    });
    totalKills += currentKills;
  });
  return { players, totalKills };
}
