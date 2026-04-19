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

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 10000;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const PANEL_URL = "https://panel25.oyunyoneticisi.com/rank/index.php?ip=95.173.173.81";

app.use(express.static(__dirname));
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

/* =========================
   PARSERLAR (KUSURSUZ)
========================= */
function parseNumber(str) {
    if (!str) return 0;
    const parsed = parseInt(String(str).trim(), 10);
    return isNaN(parsed) ? 0 : parsed;
}

function parsePercent(str) {
    if (!str) return 0;
    const match = String(str).match(/\(([\d.]+)%\)/);
    return match ? parseFloat(match[1]) : 0;
}

/* =========================
   HEADER MAPPING (TERMİNATÖR MODU)
========================= */
function extractHeaders($, table) {
    const headers = {};
    
    // Sadece 1. satıra değil, başlıkları bulana kadar tüm satırlara bakar
    table.find('tr').each((rowIndex, row) => {
        if (headers.nick !== undefined) return; // Başlıkları bulduysak aramayı bırak

        $(row).find('td, th').each((i, el) => {
            // Türkçe karakterleri kökten temizleyip sıfır hata bırakıyoruz
            let text = $(el).text().toLowerCase()
                .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
                .replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').trim();
            
            if (text.includes('nick')) headers.nick = i;
            if (text.includes('oldurme') || text.includes('kill')) headers.kills = i;
            if (text.includes('olumler') || text.includes('death')) headers.deaths = i;
            if (text.includes('mermi') || text.includes('damage')) headers.damage = i;
            if (text.includes('headshot') || text.includes('hs')) headers.hs = i;
            if (text.includes('hedef') || text.includes('acc')) headers.acc = i;
            if (text.includes('sira') || text.includes('rank')) headers.rank = i;
        });
    });

    return headers;
}

function generateWeekId(players, totalKills) {
    const raw = players.map(p => p.nick + p.total_kills).join('|') + totalKills;
    return crypto.createHash('md5').update(raw).digest('hex');
}

/* =========================
   MAIN LOOP
========================= */
async function startMonitoring() {
    if (isRunning || isArchiving) return;
    isRunning = true;

    try {
        console.log("🔍 Panel taranıyor...");
        const response = await axios.get(PANEL_URL, {
            timeout: 25000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });

        const $ = cheerio.load(response.data);
        const table = $('table#table1').first();
        if (table.length === 0) throw new Error("Tablo bulunamadı!");

        const headers = extractHeaders($, table);
        if (headers.nick === undefined || headers.kills === undefined || headers.damage === undefined) {
            throw new Error("Kritik sütunlar (Nick, Kill veya Mermi) bulunamadı. Panel yapısı değişmiş!");
        }

        const players = [];
        let currentTotalKills = 0;
        let currentTotalDamage = 0;

        table.find('tr').each((i, el) => {
            const cols = $(el).find('td');
            if (cols.length < 5) return; // Eksik sütunlu satırları geç

            const nick = $(cols[headers.nick]).text().trim();
            // Eğer okuduğu satır "NICK" başlığıysa (header satırıysa) kaydetmeden geç
            if (!nick || nick.length < 2 || nick.toUpperCase() === 'NICK') return;

            const rankVal = parseNumber($(cols[headers.rank]).text());
            const killsVal = parseNumber($(cols[headers.kills]).text());
            const deathsVal = parseNumber($(cols[headers.deaths]).text());
            const mermiVal = parseNumber($(cols[headers.damage]).text());
            const hsVal = parsePercent($(cols[headers.hs]).text());
            const accVal = parsePercent($(cols[headers.acc]).text());

            players.push({
                rank: rankVal || i,
                nick: nick,
                total_kills: killsVal,
                total_deaths: deathsVal,
                total_damage: mermiVal,
                hs_percent: hsVal,
                accuracy: accVal,
                updated_at: new Date()
            });
            
            currentTotalKills += killsVal;
            currentTotalDamage += mermiVal;
        });

        if (players.length === 0) {
            console.log("⚠️ Tablodan hiç oyuncu çıkarılamadı!");
            return;
        }

        if (currentTotalDamage > 0 && currentTotalDamage < currentTotalKills) {
            throw new Error("Veri Mantık Hatası: Toplam mermi sayısı öldürme sayısından az.");
        }

        if (lastGoodSnapshot.length === 0) {
            lastGoodSnapshot = players.map(p => ({ ...p }));
        }

        const { data: log } = await supabase.from('system_log').select('*').limit(1).maybeSingle();
        if (!log) {
            await supabase.from('system_log').upsert({ id: 1, total_kills_sum: currentTotalKills });
            return;
        }

        const isHardDrop = log.total_kills_sum > 2000 && currentTotalKills < (log.total_kills_sum * 0.30);
        if (isHardDrop) {
            if (!suspiciousFlag) {
                console.log("⚠️ Şüpheli düşüş, bekleniyor...");
                suspiciousFlag = true;
                return;
            }
            console.log("🏛️ RESET TESPİT EDİLDİ");
            isArchiving = true;
            if (lastGoodSnapshot.length >= 5) {
                await archiveTheWeek(lastGoodSnapshot, log.total_kills_sum, currentTotalKills);
            }
            lastGoodSnapshot = players.map(p => ({ ...p }));
            suspiciousFlag = false;
            isArchiving = false;
            return;
        }

        suspiciousFlag = false;
        lastGoodSnapshot = players.map(p => ({ ...p }));

        const { error } = await supabase.from('players').upsert(players, { onConflict: 'nick' });
        if (error) throw error;

        await supabase.from('system_log').upsert({ 
            id: 1, 
            total_kills_sum: currentTotalKills, 
            last_fetch: new Date() 
        });

        console.log(`✅ ${players.length} oyuncu güncellendi`);

    } catch (err) {
        console.error("❌ Hata:", err.message);
    } finally {
        isRunning = false;
    }
}

/* =========================
   ARCHIVE
========================= */
async function archiveTheWeek(snapshotData, oldTotalKills, currentKills) {
    try {
        const weekId = generateWeekId(snapshotData, oldTotalKills);
        const { data: exists } = await supabase.from('weekly_top15').select('week_id').eq('week_id', weekId).limit(1);
        if (exists?.length > 0) return;

        const archiveRows = snapshotData.map((p, index) => ({
            week_id: weekId,
            rank: p.rank || index + 1, nick: p.nick, kills: p.total_kills, deaths: p.total_deaths,
            mermiler: p.total_damage, hs_percent: p.hs_percent, accuracy: p.accuracy
        }));

        const { error } = await supabase.from('weekly_top15').insert(archiveRows);
        if (!error) {
            await supabase.from('players').delete().neq('nick', '---');
            await supabase.from('system_log').upsert({ id: 1, total_kills_sum: currentKills });
            transporter.sendMail({
                from: '"Arşiv Botu" <leventistemi@hotmail.com>',
                to: "leventistemi@hotmail.com",
                subject: "🛡️ Hafta Mühürlendi!",
                text: `Haftalık arşiv başarıyla kaydedildi.\nWeek ID: ${weekId}`
            }).catch(() => {});
        }
    } catch (err) { console.error("❌ Arşiv Hatası:", err.message); }
}

cron.schedule('*/3 * * * *', () => {
    if (!isRunning && !isArchiving) startMonitoring();
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`🚀 Sistem aktif: ${port}`);
    setTimeout(startMonitoring, 5000);
});
