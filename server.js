import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import cron from 'node-cron';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 10000;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const PANEL_URL = "https://panel25.oyunyoneticisi.com/rank/index.php?ip=95.173.173.81";

// 🛡️ GÜVENLİK: HOTMAIL ARIZA BİLDİRİM SİSTEMİ
const transporter = nodemailer.createTransport({
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    auth: {
        user: "leventistemi@hotmail.com",
        pass: process.env.EMAIL_PASS // Render panelindeki ojitndihybseodjg şifresi
    },
    tls: { ciphers: 'SSLv3' }
});

let lastMailTime = 0;
const sendAlertMail = async (errorMsg) => {
    const now = Date.now();
    if (!process.env.EMAIL_PASS || now - lastMailTime < 3600000) return;

    try {
        await transporter.sendMail({
            from: '"Şehrin Efendileri ARŞİV" <leventistemi@hotmail.com>',
            to: "leventistemi@hotmail.com",
            subject: "⚠️ ARŞİV SİSTEMİ ARIZA BİLDİRİMİ",
            text: `Merhaba Levent,\n\nArşiv sisteminde kritik bir sorun algılandı.\n\nHata Detayı: ${errorMsg}\n\nZaman: ${new Date().toLocaleString("tr-TR")}`
        });
        lastMailTime = now;
        console.log("📧 Arıza maili Hotmail üzerinden gönderildi.");
    } catch (e) { console.error("📧 Mail gönderme hatası:", e.message); }
};

app.use(express.static(path.join(__dirname, 'public')));

let isRunning = false;

async function startMonitoring() {
    if (isRunning) return;
    isRunning = true;

    try {
        const response = await axios.get(PANEL_URL, { timeout: 15000 });
        const $ = cheerio.load(response.data);
        const table = $('table#table1');
        
        // 🛡️ GÜVENLİK SENSÖRÜ: Panel Yapısı Kontrolü
        const firstRowText = table.find('tr').first().text().toUpperCase();
        if (table.length > 0 && (!firstRowText.includes('SIRA') || !firstRowText.includes('NICK') || !firstRowText.includes('ÖLDÜRME'))) {
             throw new Error("KRİTİK: OyunYöneticisi panel sütun yerlerini değiştirmiş! Arşiv durduruldu.");
        }

        // Panel boşsa veya sadece başlık varsa (Reset anı)
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
                const nick = $(cols[headers.nick]).text().trim();
                const kills = parseInt($(cols[headers.kills]).text()) || 0;
                
                // 🛡️ GÜVENLİK: İmkansız Veri Filtresi (Sanity Check)
                if (!nick || kills < 0 || kills > 250000) return;

                const panelRank = parseInt($(cols[headers.rank]).text()) || i;
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

        // 🛡️ GÜVENLİK: Yetersiz Veri Kontrolü
        if (players.length < 5 && currentTotalKills > 0) return;

        // Reset Algılama (Eski toplam kill'in %20'sinin altına düşerse haftayı mühürle)
        const { data: log } = await supabase.from('system_log').select('*').limit(1).maybeSingle();
        if (log && log.total_kills_sum > 1000 && currentTotalKills < (log.total_kills_sum * 0.2)) {
            await archiveTheWeek();
        }

        // Güncel verileri 'players' tablosuna yaz
        await supabase.from('players').upsert(players, { onConflict: 'nick' });
        
        // Log tablosunu güncelle
        await supabase.from('system_log').upsert({ id: 1, total_kills_sum: currentTotalKills, last_fetch: new Date() });

    } catch (error) {
        console.error("❌ Hata:", error.message);
        if (error.message.includes("KRİTİK")) sendAlertMail(error.message);
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
            startDate = new Date("2026-04-13"); // İlk başlangıç tarihi
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
        console.log("✅ Hafta başarıyla mühürlendi ve arşive eklendi.");
    } catch (err) { console.error("❌ Arşiv Hatası:", err.message); }
}

// 3 dakikada bir paneli kontrol et
cron.schedule('*/3 * * * *', startMonitoring);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(port, () => { 
    console.log(`🚀 Şehrin Efendileri Arşiv Sistemi ${port} portunda aktif.`); 
    startMonitoring(); 
});
