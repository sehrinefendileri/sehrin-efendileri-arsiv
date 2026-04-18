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

// SUPABASE BAĞLANTISI
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

const PANEL_URL = "https://panel25.oyunyoneticisi.com/rank/index.php?ip=95.173.173.81";

// STATİK DOSYALARI DIŞARI AÇ (bg.jpg ve index.html için)
app.use(express.static(path.join(__dirname, 'public')));

let isRunning = false;

// --- ANA MOTOR: PANELİ TARAR ---
async function startMonitoring() {
    if (isRunning) return;
    isRunning = true;

    try {
        console.log("🔍 Panel verileri taranıyor...");
        const response = await axios.get(PANEL_URL, { timeout: 15000 });
        const $ = cheerio.load(response.data);
        const players = [];
        let currentTotalKills = 0;

        $('table#table1 tr').each((i, el) => {
            if (i === 0) return;
            const cols = $(el).find('td');
            if (cols.length > 5) {
                const nick = $(cols[1]).text().trim();
                const kills = parseInt($(cols[2]).text()) || 0;
                const hsRaw = $(cols[3]).text();
                const deaths = parseInt($(cols[4]).text()) || 0;
                const accRaw = $(cols[6]).text();
                const hsPercent = parseFloat(hsRaw.match(/\(([^%]+)%/)?.[1]) || 0;
                const accuracy = parseFloat(accRaw.match(/\(([^%]+)%/)?.[1]) || 0;

                players.push({
                    nick,
                    total_kills: kills,
                    total_deaths: deaths,
                    hs_percent: hsPercent,
                    accuracy,
                    updated_at: new Date() // TZ ayarı sayesinde Türkiye saatiyle kaydedilir
                });
                currentTotalKills += kills;
            }
        });

        if (!players.length) return;

        // Reset Kontrolü
        const { data: log } = await supabase.from('system_log').select('*').limit(1).maybeSingle();
        const lastTotal = log?.total_kills_sum || 0;

        if (lastTotal > 1000 && currentTotalKills < (lastTotal * 0.4) && players.length < 5) {
            console.log("⚠️ RESET ALGILANDI! Otomatik arşiv başlatılıyor...");
            await archiveTheWeek();
        }

        // Güncel verileri bas
        await supabase.from('players').upsert(players, { onConflict: 'nick' });
        await supabase.from('system_log').upsert({ id: 1, total_kills_sum: currentTotalKills, last_fetch: new Date() });

        console.log(`✅ Veri Güncellendi | Toplam Kill: ${currentTotalKills}`);
    } catch (error) {
        console.error("❌ Hata:", error.message);
    } finally {
        isRunning = false;
    }
}

// --- ARŞİVLEME: TOP 15'İ MÜHÜRLER ---
async function archiveTheWeek() {
    try {
        console.log("📁 Arşivleme işlemi başladı...");
        const { data: top15 } = await supabase.from('players').select('*').order('total_kills', { ascending: false }).limit(15);
        
        if (!top15 || top15.length === 0) return false;

        const { data: lastArchive } = await supabase.from('weekly_top15').select('week_end').order('week_end', { ascending: false }).limit(1).maybeSingle();
        
        let startDate = new Date();
        if (lastArchive) {
            startDate = new Date(lastArchive.week_end);
            startDate.setDate(startDate.getDate() + 1);
        }

        const archiveRows = top15.map((p, i) => ({
            week_start: startDate.toISOString().split('T')[0],
            week_end: new Date().toISOString().split('T')[0],
            rank: i + 1,
            nick: p.nick,
            kills: p.total_kills,
            deaths: p.total_deaths,
            hs_percent: p.hs_percent,
            accuracy: p.accuracy
        }));

        const { error: insertError } = await supabase.from('weekly_top15').insert(archiveRows);
        if (insertError) throw insertError;

        // Arşivden sonra mevcut oyuncu tablosunu temizle (reset sonrası yeni hafta başlar)
        await supabase.from('players').delete().neq('nick', '---');
        console.log("📁 Arşiv başarıyla tamamlandı ve mühürlendi.");
        return true;
    } catch (err) {
        console.error("❌ Arşivleme Hatası:", err.message);
        return false;
    }
}

// 3 Dakikada bir çalıştır
cron.schedule('*/3 * * * *', startMonitoring);

// WEB SAYFASI YÖNLENDİRMESİ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`🚀 Sunucu ${port} portunda aktif`);
    startMonitoring();
    
    // 🔥 DİKKAT: Alttaki satır şu anki verileri direkt arşive basar. 
    // Sitede podyumu gördükten sonra bu satırı silip tekrar kaydedin!
    archiveTheWeek(); 
});
