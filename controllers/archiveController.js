import { supabase } from '../config/database.js';

export async function getArchiveWeeks(req, res) {
  const { data, error } = await supabase
    .from('weekly_top15')
    .select('week_start, week_end')
    .order('week_end', { ascending: false });

  if (error) {
    return res.status(500).json({ error: 'Arşiv haftaları alınamadı.' });
  }

  const uniqueWeeks = [
    ...new Map(data.map(item => [item.week_start, item])).values()
  ];

  return res.json(uniqueWeeks);
}

export async function getArchiveWeek(req, res) {
  const { data, error } = await supabase
    .from('weekly_top15')
    .select('*')
    .eq('week_start', req.params.weekStart)
    .order('sira');

  if (error) {
    return res.status(500).json({ error: 'Arşiv verileri alınamadı.' });
  }

  return res.json(data);
}

export async function getChampions(req, res) {
  const { data, error } = await supabase
    .from('weekly_top15')
    .select('nick, week_start, week_end')
    .eq('sira', 1);

  if (error) {
    return res.status(500).json({ error: 'Şampiyon verileri alınamadı.' });
  }

  return res.json(data);
}