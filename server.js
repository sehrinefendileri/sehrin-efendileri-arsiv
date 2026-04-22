import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import cron from 'node-cron';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';

dotenv.config();

// 🛡️ 1. GÜVENLİK: ENV Kontrolü (ChatGPT'nin son uyarısı)
const requiredEnv = ['SUPABASE_URL', 'SUPABASE_KEY', 'X_API_KEY', 'EMAIL_PASS'];
requiredEnv.forEach(key => {
    if (!process.env[key]) {
        console.error(`❌ KRİTİK HATA: Environment Variable [${key}] eksik!`);
        process.exit(1); // Sistem eksik anahtarla çalışmasın, kapansın.
    }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 10000;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const PANEL_URL = "https://panel25.oyunyoneticisi.com/rank/index.php?ip=95.173.173.81";

// 🛡️ 2. GÜVENLİK: Rate Limit
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 30,
    message: { error: "Çok fazla istek gönderildi!" }
});

// 🛡️ 3. GÜVENLİK: Nihai Middleware (Bekçi)
app.use((req, res, next) => {
    // /status ile başlamayan tüm GET isteklerini statik dosya olarak değerlendir
    const isApiRequest = req.path.startsWith('/status');
    
    if (req.method === 'GET' && !isApiRequest) {
        return next();
    }
    
    // API veya durum kontrolü için X_API_KEY doğrula
    const apiKey = req.headers['x-api-key'];
    if (apiKey === process.env.X_API_KEY) {
        return next();
    }

    return res.status(403).json({ error: "Erişim Reddedildi: Geçersiz veya eksik anahtar." });
});

// Rate limit sadece /status için aktif
app.use('/status', limiter);

app.use(express.static(path.join(__dirname, 'public')));

const transporter = nodemailer.createTransport({
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    auth: { user: "leventistemi@hotmail.com", pass: process.env.EMAIL_PASS }
});

let isRunning = false;
let isArchiving = false;
let suspiciousFlag = false;
let lastGoodSnapshot = [];

// ======================
// YARDIMCI ARAÇLAR
// ======================

function normalizeText(text) {
    return text.toLowerCase().trim()
        .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
        .replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g');
}

function parseNumber(str) {
    if (!str) return 0;
    const parsed = parseInt(String(str).trim().replace(/\./g, ''), 10);
    return isNaN(parsed) ? 0 : parsed;
}

function parsePercent(str) {
    if (!str) return 0;
    const match = String(str).match(/\(([\d.]+)%\)/);
    return match ? parseFloat(match[1]) : 0;
}

function getWeekRange() {
    const d = new Date();
    d.setHours(d.getHours() - 24);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return {
        start: monday.toISOString().split('T')[0],
        end: sunday.toISOString().split('T')[0]
    };
}

function extractHeaders($, table) {
    const headers = {};
    table.find('tr').each((_, row) => {
        if (headers.nick !== undefined) return;
        $(row).find('td, th').each((i, el) => {
            const text = normalizeText($(el).text());
            if (text.includes('nick')) headers.nick = i;
            if (text.includes('oldurme') || text.includes('kill')) headers.kills = i;
            if (text.includes('olum') || text.includes('death')) headers.deaths = i;
            if (text.includes('mermi') || text.includes('damage')) headers.damage = i;
            if (text.includes('headshot') || text.includes('hs')) headers.hs = i;
            if (text.includes('hedef') || text.includes('acc')) headers.acc = i;
            if (text.includes('sira') || text.includes('rank')) headers.rank = i;
        });
    });
    return headers;
}

// ======================
// ANA İŞLEM MERKEZİ
// ======================

async function startMonitoring() {
    if (isRunning || isArchiving) return;
    isRunning = true;
    try {
        const response = await axios.get(PANEL_URL, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(response.data);
        const table = $('table#table1').first();
        if (!table.length) throw new Error("Panel Tablosu bulunamadı");

        const headers = extractHeaders($, table);
        const players = [];
        let totalKills = 0;

        table.find('tr').each((i, el) => {
            const cols = $(el).find('td');
            if (cols.length < 5) return;
            const nick = $(cols[headers.nick]).text().trim();
            if (!nick || nick.toUpperCase() === 'NICK' || nick === '---') return;

            const kills = parseNumber($(cols[headers.kills]).text());
            players.push({
                rank: parseNumber($(cols[headers.rank]).text()) || i,
                nick,
                total_kills: kills,
                total_deaths: parseNumber($(cols[headers.deaths]).text()),
                total_damage: parseNumber($(cols[headers.damage]).text()),
                hs_percent: parsePercent($(cols[headers.hs]).text()),
                accuracy: parsePercent($(cols[headers.acc]).text()),
                updated_at: new Date()
            });
            totalKills += kills;
        });

        const { data: log, error: logErr } = await supabase.from('system_log').select('*').eq('id', 1).maybeSingle();
        if (logErr) throw logErr;

        if (lastGoodSnapshot.length === 0) {
            const { data: dbPlayers } = await supabase.from('players').select('*');
            if (dbPlayers) lastGoodSnapshot = dbPlayers;
        }

        if (!log) {
            await supabase.from('system_log').upsert({ id: 1, total_kills_sum: totalKills });
            return;
        }

        const isReset = log.total_kills_sum > 2000 && totalKills < (log.total_kills_sum * 0.30);
        
        if (isReset) {
            if (!suspiciousFlag) { suspiciousFlag = true; return; }
            isArchiving = true;
            if (lastGoodSnapshot.length >= 5) await archiveTheWeek(lastGoodSnapshot, log.total_kills_sum, totalKills);
            suspiciousFlag = false;
            isArchiving = false;
        } else {
            suspiciousFlag = false;
            lastGoodSnapshot = players.map(p => ({ ...p }));
            await supabase.from('players').upsert(players, { onConflict: 'nick' });
            await supabase.from('system_log').upsert({ id: 1, total_kills_sum: totalKills, last_fetch: new Date() });
            console.log(`✅ Güncellendi. Oyuncu: ${players.length}, Toplam Kill: ${totalKills}`);
        }
    } catch (err) { console.error("❌ Hata:", err.message); } finally { isRunning = false; }
}

async function archiveTheWeek(snapshot, oldKills, newKills) {
    try {
        const weekRange = getWeekRange();
        const cleanSnapshot = snapshot.filter(p => p.nick !== '---').slice(0, 15);
        const weekId = crypto.createHash('md5').update(cleanSnapshot.map(p => p.nick + p.total_kills).join('|') + oldKills).digest('hex');
        
        const { data: exists } = await supabase.from('weekly_top15').select('week_id').eq('week_id', weekId).maybeSingle();
        if (exists) return;

        const rows = cleanSnapshot.map((p, i) => ({
            week_id: weekId, week_start: weekRange.start, week_end: weekRange.end,
            rank: i + 1, nick: p.nick, kills: p.total_kills, deaths: p.total_deaths,
            mermiler: p.total_damage, hs_percent: p.hs_percent, accuracy: p.accuracy
        }));

        const { error: arcErr } = await supabase.from('weekly_top15').insert(rows);
        if (arcErr) throw arcErr;

        await supabase.from('players').delete().neq('nick', '---');
        await supabase.from('system_log').upsert({ id: 1, total_kills_sum: newKills });

        transporter.sendMail({
            from: '"Arşiv" <leventistemi@hotmail.com>',
            to: "leventistemi@hotmail.com",
            subject: `🛡️ Hafta Mühürlendi: ${weekRange.start}`,
            text: `${weekRange.start} - ${weekRange.end} başarıyla arşivlendi.`
        }).catch(() => {});
        console.log("🏆 ARŞİV BAŞARILI");
    } catch (err) { console.error("❌ Arşiv Hatası:", err.message); }
}

// YOLLAR
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.get('/status', (req, res) => { res.json({ ok: true, running: isRunning, archiving: isArchiving, time: new Date() }); });

// BAŞLATMA
cron.schedule('*/3 * * * *', () => { if (!isRunning && !isArchiving) startMonitoring(); });
app.listen(port, () => { console.log("🚀 SERVER LIVE"); setTimeout(startMonitoring, 5000); });
