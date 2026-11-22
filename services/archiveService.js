import crypto from 'crypto';
import { supabase } from '../config/database.js';
import { getWeekRange } from '../utils/dateUtils.js';
import { parseNumber } from '../utils/parser.js';
import { sendTelegramMessage } from './telegramService.js';
import { sendArchiveEmail } from './emailService.js';
import { logErrorToDb } from './errorLogService.js';

export async function archiveTheWeek(snapshot, oldKills, newKills) {
  try {
    const weekRange = getWeekRange();
    const cleanSnapshot = snapshot.filter(p => p.nick !== '---')
      .sort((a,b) => (b.oldurme - parseNumber(b.olumler)) - (a.oldurme - parseNumber(a.olumler))).slice(0,15);
    const weekId = crypto.createHash('md5').update(cleanSnapshot.map(p => p.nick + p.oldurme).join('|') + oldKills).digest('hex');
    const { data: exists, error: existsErr } = await supabase.from('weekly_top15').select('week_id').eq('week_id', weekId).maybeSingle();
    if (existsErr) throw existsErr;
    if (exists) { console.log('ℹ️ Bu hafta zaten arşivlenmiş.'); return; }
    const rows = cleanSnapshot.map((p,i) => ({ week_id: weekId, week_start: weekRange.start, week_end: weekRange.end, sira: i+1, nick: p.nick, oldurme: p.oldurme, olumler: p.olumler, mermiler: p.mermiler, headshot: p.headshot, hedef_tutturma: p.hedef_tutturma }));
    const { error: arcErr } = await supabase.from('weekly_top15').insert(rows);
    if (arcErr) throw arcErr;
    const { error: deleteErr } = await supabase.from('players').delete().neq('nick','---');
    if (deleteErr) throw deleteErr;
    const { error: logErr } = await supabase.from('system_log').upsert({ id: 1, total_kills_sum: newKills });
    if (logErr) throw logErr;
    await sendArchiveEmail(weekRange);
    await sendTelegramMessage(`🏆 HAFTALIK ARŞİV BAŞARILI\n\n${weekRange.start}\n-\n${weekRange.end}`);
    console.log('🏆 ARŞİV BAŞARILI');
  } catch (err) { await logErrorToDb('ARCHIVE', err); }
}
