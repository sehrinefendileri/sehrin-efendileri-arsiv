import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import cron from 'node-cron';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import crypto from 'crypto'; // 🛡️ Yeni: week_id oluşturmak için

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 10000;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const PANEL_URL = "https://panel25.oyunyoneticisi.com/rank/index.php?ip=95.173.173.81";

// 🛡️ HOTMAIL BİLDİRİM
const transporter = nodemailer.createTransport({
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    auth: { user: "leventistemi@hotmail.com", pass: process.env.EMAIL_PASS },
    tls: { ciphers: 'SSLv3' }
});

let isRunning = false;

// 🛡️ Yeni: Aynı haftayı mühürlemeyi engelleyen benzersiz ID üretici
function generateWeekId(players) {
    const raw = players.slice(0, 5).map(p => p.nick + p.total_kills).join('|');
    return crypto.createHash('md5').update(raw).digest('hex');
}

async function startMonitoring() {
    if (isRunning) return;
    isRunning = true;

    try {
        const response = await axios.get(PANEL_URL, { timeout: 15000 });
        const $ = cheerio.load(response.data);
        const table = $('table#table1');
        
        // 🛡️ SÜTUN SENSÖRÜ
        const firstRowText = table.find('tr').first().text().toUpperCase();
        if (table.length > 0 && (!firstRowText.includes('SIRA') || !firstRowText.includes('NICK'))) {
             throw new Error("KRİTİK: Panel yapısı değişmiş!");
        }

        if (table.length === 0 || table.find('tr').length <= 1) {
            const { data: log } = await supabase.from('system_log').select('*').limit(1).maybeSingle();
            if (log && log.total_kills_sum > 500) await archiveTheWeek([]);
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
                const nick = $(cols[headers.nick]).text().trim();
                const kills = parseInt($(cols[headers.kills]).text()) || 0;
                if (!nick || kills < 0) return;

                players.push({
                    rank: parseInt($(cols[headers.rank]).text()) || i,
                    nick,
                    total_kills: kills,
                    total_deaths: parseInt($(cols[headers.deaths]).text()) || 0,
                    mermiler: parseInt($(cols[headers.bullets]).text()) || 0,
                    hs_percent: $(cols[headers.hs]).text().match(/\(([^%]+)%/)?.[1] || "0",
                    accuracy: $(cols[headers.acc]).text().match(/\(([^%]+)%/)?.[1] || "0",
                    updated_at: new Date()
                });
                currentTotalKills += kills;
            }
        });

        const { data: log } = await supabase.from('system_log').select('*').limit(1).maybeSingle();
        
        // 🔥 RESET TESPİTİ VE ARŞİVLEME
        if (log && log.total_kills_sum > 1000 && currentTotalKills < (log.total_kills_sum * 0.35)) {
            await archiveTheWeek(players); // Veriyi gönderiyoruz
        }

        await supabase.from('players').upsert(players, { onConflict: 'nick' });
        await supabase.from('system_log').upsert({ id: 1, total_kills_sum: currentTotalKills, last_fetch: new Date() });

    } catch (error) {
        console.error("❌", error.message);
    } finally { isRunning = false; }
}

async function archiveTheWeek(currentPlayers) {
    try {
        // Arşivlenecek veriyi 'players' tablosundan çek (En son temiz veri)
        const { data: top15 } = await supabase.from('players').select('*').order('rank', { ascending: true }).limit(15);
        if (!top15 || top15.length < 5) return;

        const weekId = generateWeekId(top15);

        // 🛡️ DUPLICATE KONTROLÜ
        const { data: exists } = await supabase.from('weekly_top15').select('week_id').eq('week_id', weekId).limit(1);
        if (exists && exists.length > 0) return;

        const { data: lastArchive } = await supabase.from('weekly_top15').select('week_end').order('week_end', { ascending: false }).limit(1).maybeSingle();
        
        let startDate = lastArchive ? new Date(lastArchive.week_end) : new Date("2026-04-13");
        if (lastArchive) startDate.setDate(startDate.getDate() + 1);

        let endDate = new Date();
        endDate.setDate(endDate.getDate() - 1);

        const archiveRows = top15.map(p => ({
            week_id: weekId, // 🛡️ Benzersiz hafta ID
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

        const { error } = await supabase.from('weekly_top15').insert(archiveRows);
        if (!error) {
            await supabase.from('players').delete().neq('nick', '---');
            await supabase.from('system_log').upsert({ id: 1, total_kills_sum: 0 });
            console.log("✅ Hafta Mühürlendi!");
        }
    } catch (err) { console.error("Arşiv Hatası:", err.message); }
}

cron.schedule('*/3 * * * *', startMonitoring);
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(port, () => startMonitoring());
