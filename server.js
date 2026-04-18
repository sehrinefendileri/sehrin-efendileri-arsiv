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

// STATİK DOSYALAR (public klasörü)
app.use(express.static(path.join(__dirname, 'public')));

let isRunning = false;

// --- ANA MOTOR: PANELİ AKILLI VE SADIK BİR ŞEKİLDE TARAR ---
async function startMonitoring() {
    if (isRunning) return;
    isRunning = true;

    try {
        console.log("🔍 Panel taranıyor (Oyun Yöneticisi hiyerarşisi korunuyor)...");
        const response = await axios.get(PANEL_URL, { timeout: 15000 });
        const $ = cheerio.load(response.data);
        
        const table = $('table#table1');
        
        // RESET/HATA DURUMU: Panelde veri yoksa veya sunucu kapalı uyarısı varsa
        if (table.length === 0 || table.find('tr').length <= 1) {
            console.log("⚠️ Panelde veri yok (Reset veya Sunucu Hatası). Arşiv kontrol ediliyor...");
            const { data: log } = await supabase.from('system_log').select('*').limit(1).maybeSingle();
            
            // Eğer veritabanında yüksek kill varken panel sıfırlanmışsa arşivi tetikle
            if (log && log.total_kills_sum > 500) { 
                console.log("🚨 Panel sıfırlanmış! Son hafta mühürleniyor...");
                await archiveTheWeek();
            }
            return;
        }

        // AKILLI SÜTUN BULUCU: Panel başlıklarını (SIRA, NICK vb.) birebir eşler
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
            if (i === 0) return; // Başlık satırını atla
            const cols = $(el).find('td');
            
            if (cols.length > 5) {
                // PANELDEKİ SIRA VERİSİNİ BİREBİR AL (Kendi hesaplamamızı yapmıyoruz)
                const panelRank = parseInt($(cols[headers.rank]).text()) || i;
                const nick = $(cols[headers.nick]).text().trim();
                const kills = parseInt($(cols[headers.kills]).text()) || 0;
                const hsRaw = $(cols[headers.hs]).text();
                const deaths = parseInt($(cols[headers.deaths]).text()) || 0;
                const mermiler = parseInt($(cols[headers.bullets]).text()) || 0;
                const accRaw = $(cols[headers.acc]).text();
                
                // Yüzdelik verileri ayıkla
                const hsPercent = hsRaw.match(/\(([^%]+)%/)?.[1] || "0";
                const accuracy = accRaw.match(/\(([^%]+)%/)?.[1] || "0";

                players.push({
                    rank: panelRank, // Orijinal panel sırası
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

        if (!players.length) return;

        // Reset Algılama (Sert düşüş kontrolü)
        const { data: log } = await supabase.from('system_log').select('*').limit(1).maybeSingle();
        if (log && log.total_kills_sum > 1000 && currentTotalKills < (log.total_kills_sum * 0.2)) {
            console.log("⚠️ Veri düşüşü algılandı, mühürleme başlatılıyor...");
            await archiveTheWeek();
        }

        // Canlı tabloyu güncelle
        await supabase.from('players').upsert(players, { onConflict: 'nick' });
        await supabase.from('system_log').upsert({ id: 1, total_kills_sum: currentTotalKills, last_fetch: new Date() });
        console.log(`✅ Panel İzleniyor | Toplam Kill: ${currentTotalKills}`);

    } catch (error) {
        console.error("❌ Panel İzleme Hatası:", error.message);
    } finally {
        isRunning = false;
    }
}

// --- ARŞİVLEME: PANELDEKİ SİRAYI (RANK) KORUYARAK MÜHÜRLER ---
async function archiveTheWeek() {
    try {
        console.log("📁 Arşivleme döngüsü başladı...");
        
        // PANELDEKİ RANK'A GÖRE SIRALI ÇEK (1, 2, 3...)
        const { data: top15 } = await supabase.from('players')
            .select('*')
            .order('rank', { ascending: true }) 
            .limit(15);
        
        if (!top15 || top15.length < 5) {
            console.log("❌ Arşivlenecek yeterli veri yok.");
            return;
        }

        const { data: lastArchive } = await supabase.from('weekly_top15').select('week_end').order('week_end', { ascending: false }).limit(1).maybeSingle();
        
        // TAKVİM ZİNCİRİ
        let startDate = new Date();
        if (lastArchive) {
            startDate = new Date(lastArchive.week_end);
            startDate.setDate(startDate.getDate() + 1);
        } else {
            // İlk kayıt için senin verdiğin tarih: 13 Nisan Pazartesi
            startDate = new Date("2026-04-13"); 
        }

        let endDate = new Date(); 
        // Reset Pazartesi yapıldığı için, mühürleme bitişini bir önceki gün (Pazar) yapıyoruz.
        endDate.setDate(endDate.getDate() - 1); 

        const archiveRows = top15.map((p) => ({
            week_start: startDate.toISOString().split('T')[0],
            week_end: endDate.toISOString().split('T')[0],
            rank: p.rank, // Paneldeki sıra birebir arşivlenir
            nick: p.nick,
            kills: p.total_kills,
            deaths: p.total_deaths,
            mermiler: p.mermiler,
            hs_percent: p.hs_percent,
            accuracy: p.accuracy
        }));

        const { error: insertError } = await supabase.from('weekly_top15').insert(archiveRows);
        if (insertError) throw insertError;

        // Temizlik: Canlı tabloyu ve logu sıfırla
        await supabase.from('players').delete().neq('nick', '---');
        await supabase.from('system_log').upsert({ id: 1, total_kills_sum: 0, last_fetch: new Date() });
        
        console.log("📁 HAFTA ARŞİVLENDİ VE MÜHÜRLENDİ!");

    } catch (err) { console.error("❌ Arşivleme İşlemi Başarısız:", err.message); }
}

// Periyot: 3 Dakika
cron.schedule('*/3 * * * *', startMonitoring);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(port, () => { 
    console.log(`🚀 Şehrin Efendileri Botu ${port} Portunda Aktif`); 
    startMonitoring(); 
});
