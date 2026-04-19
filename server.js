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

// Statik dosyalar
app.use(express.static(__dirname)); 
app.use(express.static(path.join(__dirname, 'public')));

const transporter = nodemailer.createTransport({
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    auth: { user: "leventistemi@hotmail.com", pass: process.env.EMAIL_PASS },
    tls: { ciphers: 'SSLv3' }
});

let isRunning = false;
let isArchiving = false;

function generateWeekId(players) {
    const raw = players.slice(0, 5).map(p => p.nick + p.total_kills).join('|');
    return crypto.createHash('md5').update(raw).digest('hex');
}

async function startMonitoring() {
    if (isRunning || isArchiving) return;
    isRunning = true; // 🛡️ Kilidi try bloğundan hemen önce koyduk

    try {
        console.log("🔍 Panel taranıyor...");
        const response = await axios.get(PANEL_URL, { 
            timeout: 25000, 
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        const $ = cheerio.load(response.data);
        const table = $('table#table1');
        
        if (table.length === 0) throw new Error("Panel tablosu bulunamadı!");

        const headers = {};
        table.find('tr').first().find('td, th').each((index, el) => {
            const text = $(el).text().toUpperCase().trim();
            if (text.includes('NICK')) headers.nick = index;
            if (text.includes('ÖLDÜRME')) headers.kills = index;
            if (text.includes('ÖLÜMLER')) headers.deaths = index;
            if (text.includes('MERMİLER')) headers.bullets = index;
            if (text.includes('HEADSHOT')) headers.hs = index;
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
                
                if (nick && nick !== "") {
                    players.push({
                        nick: nick,
                        total_kills: kills,
                        total_deaths: parseInt($(cols[headers.deaths]).text()) || 0,
                        total_damage: parseInt($(cols[headers.bullets]).text()) || 0,
                        hs_percent: parseFloat($(cols[headers.hs]).text().match(/\(([^%]+)%/)?.[1]) || 0,
                        accuracy: parseFloat($(cols[headers.acc]).text().match(/\(([^%]+)%/)?.[1]) || 0,
                        updated_at: new Date()
                    });
                    currentTotalKills += kills;
                }
            }
        });

        const { data: log } = await supabase.from('system_log').select('*').limit(1).maybeSingle();
        
        if (log && log.total_kills_sum > 1000 && currentTotalKills < (log.total_kills_sum * 0.3)) {
            isArchiving = true;
            await archiveTheWeek();
            isArchiving = false;
            isRunning = false; // 🛡️ Önemli: Arşivlemeden sonra kilidi aç
            return;
        }

        await supabase.from('players').upsert(players, { onConflict: 'nick' });
        await supabase.from('system_log').upsert({ id: 1, total_kills_sum: currentTotalKills, last_fetch: new Date() });
        console.log(`✅ ${players.length} Oyuncu güncellendi.`);

    } catch (error) {
        console.error("❌ Hata:", error.message);
    } finally { 
        isRunning = false; // 🛡️ Ne olursa olsun kilidi aç (Donmayı engeller)
    }
}

async function archiveTheWeek() {
    try {
        console.log("🏛️ Arşiv mühürleniyor...");
        const { data: top15 } = await supabase.from('players').select('*').order('total_kills', { ascending: false }).limit(15);
        if (!top15 || top15.length < 5) return;

        const weekId = generateWeekId(top15);
        const { data: exists } = await supabase.from('weekly_top15').select('week_id').eq('week_id', weekId).limit(1);
        if (exists && exists.length > 0) return;

        const { data: lastArchive } = await supabase.from('weekly_top15').select('week_end').order('week_end', { ascending: false }).limit(1).maybeSingle();
        
        let startDate = lastArchive ? new Date(lastArchive.week_end) : new Date("2026-04-13");
        if (lastArchive) startDate.setDate(startDate.getDate() + 1);

        let endDate = new Date();
        endDate.setDate(endDate.getDate() - 1);

        const archiveRows = top15.map((p, index) => ({
            week_id: weekId,
            week_start: startDate.toISOString().split('T')[0],
            week_end: endDate.toISOString().split('T')[0],
            rank: index + 1,
            nick: p.nick,
            kills: p.total_kills,
            deaths: p.total_deaths,
            mermiler: p.total_damage,
            hs_percent: p.hs_percent,
            accuracy: p.accuracy
        }));

        const { error } = await supabase.from('weekly_top15').insert(archiveRows);
        if (!error) {
            await supabase.from('players').delete().neq('nick', '---');
            await supabase.from('system_log').upsert({ id: 1, total_kills_sum: 0 });
            
            await transporter.sendMail({
                from: '"Arşiv Botu" <leventistemi@hotmail.com>',
                to: "leventistemi@hotmail.com",
                subject: "🛡️ Şehrin Efendileri: Hafta Mühürlendi!",
                text: `Haftalık arşiv başarıyla kaydedildi.\n\nID: ${weekId}\nBaşlangıç: ${startDate.toLocaleDateString()}\nBitiş: ${endDate.toLocaleDateString()}`
            });
        }
    } catch (err) { console.error("❌ Arşiv Hatası:", err.message); }
}

// Zamanlayıcı
cron.schedule('*/3 * * * *', startMonitoring);

// 🛡️ GÜVENLİ ANA SAYFA (Hafıza sızıntısı engellendi)
app.get('/', (req, res) => {
    const rootPath = path.join(__dirname, 'index.html');
    const publicPath = path.join(__dirname, 'public', 'index.html');
    
    res.sendFile(rootPath, (err) => {
        if (err) {
            res.sendFile(publicPath, (err2) => {
                if (err2) {
                    res.status(404).send("<h1>Arşiv Sayfası Yüklenemedi</h1><p>Dosyalar eksik veya sunucu hatası.</p>");
                }
            });
        }
    });
});

app.listen(port, () => {
    console.log(`🚀 Arşiv Sistemi ${port} portunda aktif.`);
    // 🛡️ İlk çalıştırmayı güvenli hale getirdik
    setTimeout(startMonitoring, 5000); 
});
