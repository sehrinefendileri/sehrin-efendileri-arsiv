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

// 🛡️ 1. GÜVENLİK: ENV Kontrolü
const requiredEnv = ['SUPABASE_URL', 'SUPABASE_KEY', 'X_API_KEY', 'EMAIL_PASS'];
requiredEnv.forEach(key => {
    if (!process.env[key]) {
        console.error(`❌ KRİTİK HATA: Environment Variable [${key}] eksik!`);
        process.exit(1); 
    }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

// 🛡️ PROXY AYARI: Render üzerindeki Rate Limit uyarısını çözen kritik satır
app.set('trust proxy', 1);

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
    const isApiRequest = req.path.startsWith('/status');
    
    if (req.method === 'GET' && !isApiRequest) {
        return next();
    }
    
    const apiKey = req.headers['x-api-key'];
    if (apiKey === process.env.X_API_KEY) {
        return next();
    }

    return res.status(403).json({ error: "Erişim Reddedildi: Geçersiz veya eksik anahtar." });
});

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
// YARDIMCI ARAÇLAR (Paneldeki Karışık Verileri Çözen Kısım)
// ======================

function normalizeText(text) {
    return text.toLowerCase().trim()
        .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
        .replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g');
}

function parseNumber(str) {
    if (!str) return 0;
    // "392 (38.43%)" gibi bir yapı gelirse sadece baştaki 392'yi alır
    const cleanStr = String(str).split('(')[0].trim();
    const parsed = parseInt(cleanStr.replace(/\./g, ''), 10);
    return isNaN(parsed) ? 0 : parsed;
}

function parsePercent(str) {
    if (!str) return 0;
    // Parantez içindeki yüzdeyi yakalar: "392 (38.43%)" -> 38.43
    const match = String(str).match(/\(([\d.]+)%\)/);
    if (match) return parseFloat(match[1]);
    
    // Parantez yoksa ama rakam varsa (Düz yüzde): "38.43" -> 38.43
    const directMatch = String(str).match(/([\d.]+)/);
    return directMatch ? parseFloat(directMatch[1]) : 0;
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
            // SENİN SUPABASE SÜTUN İSİMLERİNLE BİREBİR EŞLEŞME
            if (text === 'sira') headers.sira = i;
            if (text === 'nick') headers.nick = i;
            if (text === 'oldurme') headers.oldurme = i;
            if (text === 'headshot') headers.headshot = i;
            if (text === 'olumler') headers.olumler = i;
            if (text === 'mermiler') headers.mermiler = i;
            if (text.includes('hedef')) headers.hedef_tutturma = i;
        });
    });
    return headers;
}

// ======================
// ANA İŞLEM MERKEZİ (Canlı Takip)
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

            const kills = parseNumber($(cols[headers.oldurme]).text());
            players.push({
                sira: parseNumber($(cols[headers.sira]).text()) || i,
                nick: nick,
                oldurme: kills,
                olumler: parseNumber($(cols[headers.olumler]).text()),
                mermiler: parseNumber($(cols[headers.mermiler]).text()),
                headshot: parsePercent($(cols[headers.headshot]).text()),
                hedef_tutturma: parsePercent($(cols[headers.hedef_tutturma]).text()),
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
            // Canlı tabloyu (players) Türkçe sütunlarla günceller
            await supabase.from('players').upsert(players, { onConflict: 'nick' });
            await supabase.from('system_log').upsert({ id: 1, total_kills_sum: totalKills, last_fetch: new Date() });
            console.log(`✅ Güncellendi. Oyuncu: ${players.length}, Toplam Kill: ${totalKills}`);
        }
    } catch (err) { console.error("❌ Hata:", err.message); } finally { isRunning = false; }
}

// ======================
// ARŞİVLEME (Mühürleme)
// ======================

async function archiveTheWeek(snapshot, oldKills, newKills) {
    try {
        const weekRange = getWeekRange();
        const cleanSnapshot = snapshot.filter(p => p.nick !== '---').slice(0, 15);
        const weekId = crypto.createHash('md5').update(cleanSnapshot.map(p => p.nick + p.oldurme).join('|') + oldKills).digest('hex');
        
        const { data: exists } = await supabase.from('weekly_top15').select('week_id').eq('week_id', weekId).maybeSingle();
        if (exists) return;

        const rows = cleanSnapshot.map((p, i) => ({
            week_id: weekId, week_start: weekRange.start, week_end: weekRange.end,
            sira: i + 1, nick: p.nick, oldurme: p.oldurme, olumler: p.olumler,
            mermiler: p.mermiler, headshot: p.headshot, hedef_tutturma: p.hedef_tutturma
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

// BAŞLATMA (Her 3 Dakikada Bir)
cron.schedule('*/3 * * * *', () => { if (!isRunning && !isArchiving) startMonitoring(); });
app.listen(port, () => { console.log("🚀 SERVER LIVE"); setTimeout(startMonitoring, 5000); });
