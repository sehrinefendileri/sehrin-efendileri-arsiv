import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import cron from 'node-cron';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 10000;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const PANEL_URL = "https://panel25.oyunyoneticisi.com/rank/index.php?ip=95.173.173.81";

app.use(express.static(path.join(__dirname, 'public')));

let isRunning = false;

async function startMonitoring() {
    if (isRunning) return;
    isRunning = true;

    try {
        const response = await axios.get(PANEL_URL, { timeout: 15000 });
        const $ = cheerio.load(response.data);
        const table = $('table#table1');
        
        if (table.length === 0 || table.find('tr').length <= 1) {
            const { data: log } = await supabase.from('system_log').select('*').limit(1).maybeSingle();
            if (log && log.total_kills_sum > 500) await archiveTheWeek();
            return;
        }

        const headers = {};
        table.find('tr').first().find('td, th').each((index, el) => {
            const text = $(el).text().toUpperCase().trim();
            if (text.includes('SIRA')) headers.rank = index;
            if (text.includes('NICK')) headers.nick = index;
            if (text.includes('ÖLDÜRME')) headers.kills = index;
            if (text.includes('HEADSHOT')) headers.hs = index;
            if (text.includes('ÖLÜMLER')) headers.deaths = index;
            if (text.includes('MERMİLER')) headers.bullets = index;
            if (text.includes('HEDEF TUTTURMA')) headers.acc = index;
        });

        const players = [];
        let currentTotalKills = 0;

        table.find('tr').each((i, el) => {
            if (i === 0) return;
            const cols = $(el).find('td');
            if (cols.length > 5) {
                const panelRank = parseInt($(cols[headers.rank]).text()) || i;
                const nick = $(cols[headers.nick]).text().trim();
                const kills = parseInt($(cols[headers.kills]).text()) || 0;
                const hsRaw = $(cols[headers.hs]).text();
                const deaths = parseInt($(cols[headers.deaths]).text()) || 0;
                const mermiler = parseInt($(cols[headers.bullets]).text()) || 0;
                const accRaw = $(cols[headers.acc]).text();
                
                const hsPercent = hsRaw.match(/\(([^%]+)%/)?.[1] || "0";
                const accuracy = accRaw.match(/\(([^%]+)%/)?.[1] || "0";

                players.push({
                    rank: panelRank,
                    nick,
                    total_kills: kills,
                    total_deaths: deaths,
                    mermiler,
                    hs_percent: hsPercent,
                    accuracy,
                    updated_at: new Date()
                });
                currentTotalKills += kills;
            }
        });

        const { data: log } = await supabase.from('system_log').select('*').limit(1).maybeSingle();
        if (log && log.total_kills_sum > 1000 && currentTotalKills < (log.total_kills_sum * 0.2)) {
            await archiveTheWeek();
        }

        await supabase.from('players').upsert(players, { onConflict: 'nick' });
        await supabase.from('system_log').upsert({ id: 1, total_kills_sum: currentTotalKills, last_fetch: new Date() });

    } catch (error) {
        console.error("❌ Hata:", error.message);
    } finally {
        isRunning = false;
    }
}

async function archiveTheWeek() {
    try {
        const { data: top15 } = await supabase.from('players').select('*').order('rank', { ascending: true }).limit(15);
        if (!top15 || top15.length < 5) return;

        const { data: lastArchive } = await supabase.from('weekly_top15').select('week_end').order('week_end', { ascending: false }).limit(1).maybeSingle();
        
        let startDate = new Date();
        if (lastArchive) {
            startDate = new Date(lastArchive.week_end);
            startDate.setDate(startDate.getDate() + 1);
        } else {
            startDate = new Date("2026-04-13"); 
        }

        let endDate = new Date(); 
        endDate.setDate(endDate.getDate() - 1); 

        const archiveRows = top15.map((p) => ({
            week_start: startDate.toISOString().split('T')[0],
            week_end: endDate.toISOString().split('T')[0],
            rank: p.rank,
            nick: p.nick,
            kills: p.total_kills,
            deaths: p.total_deaths,
            mermiler: p.mermiler,
            hs_percent: p.hs_percent,
            accuracy: p.accuracy
        }));

        await supabase.from('weekly_top15').insert(archiveRows);
        await supabase.from('players').delete().neq('nick', '---');
        await supabase.from('system_log').upsert({ id: 1, total_kills_sum: 0, last_fetch: new Date() });
    } catch (err) { console.error("❌ Arşiv Hatası:", err.message); }
}

cron.schedule('*/3 * * * *', startMonitoring);
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(port, () => { startMonitoring(); });
