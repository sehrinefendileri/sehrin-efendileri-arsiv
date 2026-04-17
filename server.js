import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import cron from 'node-cron';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

const PANEL_URL = "https://panel25.oyunyoneticisi.com/rank/index.php?ip=95.173.173.81";

// --- LOCK (çakışmayı engeller)
let isRunning = false;

// --- ANA MOTOR ---
async function startMonitoring() {
    if (isRunning) {
        console.log("⏳ Önceki işlem hâlâ çalışıyor, skip.");
        return;
    }

    isRunning = true;

    try {
        console.log("🔍 Veri çekiliyor...");

        const response = await axios.get(PANEL_URL, { timeout: 10000 });
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
                    updated_at: new Date()
                });

                currentTotalKills += kills;
            }
        });

        // --- SCRAPER FAIL SAFE
        if (!players.length) {
            console.log("⚠️ Veri çekilemedi, işlem iptal.");
            return;
        }

        // --- SON LOG
        const { data: log } = await supabase
            .from('system_log')
            .select('*')
            .limit(1)
            .maybeSingle();

        const lastTotal = log?.total_kills_sum || 0;

        // --- GELİŞMİŞ RESET ALGILAMA
        const isHardDrop = currentTotalKills < (lastTotal * 0.4);
        const playerDrop = players.length < 5;

        if (lastTotal > 1000 && isHardDrop && playerDrop) {
            console.log("⚠️ RESET ALGILANDI!");
            const archiveSuccess = await archiveTheWeek();

            if (!archiveSuccess) {
                console.log("❌ Arşiv başarısız, veri silinmeyecek.");
                return;
            }
        }

        // --- BULK UPSERT
        await supabase.from('players').upsert(players, {
            onConflict: 'nick'
        });

        // --- LOG UPDATE
        await supabase.from('system_log').upsert({
            id: 1,
            total_kills_sum: currentTotalKills,
            last_fetch: new Date()
        });

        console.log(`✅ OK | Kill: ${currentTotalKills} | Oyuncu: ${players.length}`);

    } catch (error) {
        console.error("❌ HATA:", {
            message: error.message,
            stack: error.stack,
            time: new Date()
        });
    } finally {
        isRunning = false;
    }
}

// --- ARŞİV ---
async function archiveTheWeek() {
    try {
        const { data: top15 } = await supabase
            .from('players')
            .select('*')
            .order('total_kills', { ascending: false })
            .limit(15);

        if (!top15 || top15.length === 0) {
            console.log("⚠️ Arşivlenecek veri yok.");
            return false;
        }

        const { data: lastArchive } = await supabase
            .from('weekly_top15')
            .select('week_end')
            .order('week_end', { ascending: false })
            .limit(1)
            .maybeSingle();

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

        const { error: insertError } = await supabase
            .from('weekly_top15')
            .insert(archiveRows);

        if (insertError) {
            console.error("❌ Arşiv insert hatası:", insertError);
            return false;
        }

        // --- SADECE INSERT BAŞARILIYSA DELETE
        const { error: deleteError } = await supabase
            .from('players')
            .delete()
            .neq('nick', '---');

        if (deleteError) {
            console.error("❌ Silme hatası:", deleteError);
            return false;
        }

        console.log("📁 Arşiv tamamlandı.");
        return true;

    } catch (err) {
        console.error("❌ Arşiv crash:", err);
        return false;
    }
}

// --- CRON ---
cron.schedule('*/3 * * * *', startMonitoring);

// --- SERVER ---
app.get('/', (req, res) => res.send('Bot aktif'));

app.listen(port, () => {
    console.log(`🚀 ${port} portunda çalışıyor`);
    startMonitoring();
});
