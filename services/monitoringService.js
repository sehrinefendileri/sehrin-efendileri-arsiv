import { supabase } from '../config/database.js';
import { fetchPlayers } from './scraperService.js';
import { archiveTheWeek } from './archiveService.js';
import { sendTelegramMessage } from './telegramService.js';
import { logErrorToDb } from './errorLogService.js';

// Kritik süreç durumu tek modülde tutulur; yeniden başlatmada bellek sıfırlanır.
let isRunning = false;
let isArchiving = false;
let suspiciousFlag = false;
let lastGoodSnapshot = [];
export function getMonitoringStatus() { return { running: isRunning, archiving: isArchiving }; }

export async function startMonitoring() {
  if (isRunning || isArchiving) return;
  isRunning = true;
  try {
    const { players, totalKills } = await fetchPlayers();
    const { data: log, error: logErr } = await supabase.from('system_log').select('*').eq('id',1).maybeSingle();
    if (logErr) throw logErr;
    if (lastGoodSnapshot.length === 0) {
      const { data: dbPlayers } = await supabase.from('players').select('*');
      if (dbPlayers) lastGoodSnapshot = dbPlayers;
    }
    if (!log) { await supabase.from('system_log').upsert({ id:1, total_kills_sum: totalKills }); return; }
    const isReset = log.total_kills_sum > 2000 && totalKills < (log.total_kills_sum * 0.30);
    if (isReset) {
      if (!suspiciousFlag) { suspiciousFlag = true; console.log('⚠️ Sıfırlama algılandı, teyit bekleniyor...'); return; }
      isArchiving = true; console.log('🛡️ Sıfırlama onaylandı. Arşivleme başlıyor...');
      if (lastGoodSnapshot.length >= 5) await archiveTheWeek(lastGoodSnapshot, log.total_kills_sum, totalKills);
      suspiciousFlag = false; isArchiving = false;
    } else {
      suspiciousFlag = false;
      lastGoodSnapshot = players.map(p => ({ ...p }));
      const { error: upsertErr } = await supabase.from('players').upsert(players, { onConflict:'nick' });
      if (upsertErr) { console.error('❌ Upsert Hatası:', upsertErr.message); await sendTelegramMessage(`🚨 PLAYER UPSERT HATASI\n\n${upsertErr.message}`); }
      const { error: systemErr } = await supabase.from('system_log').upsert({ id:1, total_kills_sum:totalKills, last_fetch:new Date() });
      if (systemErr) throw systemErr;
      console.log(`✅ Güncellendi. Oyuncu: ${players.length}, Toplam Kill: ${totalKills}`);
    }
  } catch (err) { await logErrorToDb('MONITOR', err); }
  finally { isRunning = false; }
}
