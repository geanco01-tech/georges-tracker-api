function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function err(message, status = 400) {
  return json({ error: message }, status);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const db = env.DB;

    try {
      if (path === '/api/day-type' && request.method === 'GET') {
        const date = url.searchParams.get('date');
        if (!date) return err('date required');
        const row = await db.prepare('SELECT * FROM day_type_log WHERE date = ?').bind(date).first();
        return json({ dayType: row ? row.day_type : null });
      }

      if (path === '/api/day-type' && request.method === 'POST') {
        const body = await request.json();
        const { date, dayType } = body;
        if (!date || !dayType) return err('date and dayType required');
        await db.prepare(
          'INSERT INTO day_type_log (date, day_type, created_at) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET day_type = excluded.day_type'
        ).bind(date, dayType, Date.now()).run();
        return json({ success: true });
      }

      if (path === '/api/workout-history' && request.method === 'GET') {
        const exerciseId = url.searchParams.get('exerciseId');
        let results;
        if (exerciseId) {
          results = await db.prepare('SELECT * FROM workout_history WHERE exercise_id = ? ORDER BY date').bind(exerciseId).all();
        } else {
          results = await db.prepare('SELECT * FROM workout_history ORDER BY date').all();
        }
        return json({ history: results.results });
      }

      if (path === '/api/workout-history' && request.method === 'POST') {
        const body = await request.json();
        const { exerciseId, date, sets } = body;
        if (!exerciseId || !date) return err('exerciseId and date required');
        const existing = await db.prepare('SELECT id FROM workout_history WHERE exercise_id = ? AND date = ?').bind(exerciseId, date).first();
        const fields = ['set1','reps1','set2','reps2','set3','reps3','set4','reps4','set5','reps5','set6','reps6'];
        const values = fields.map(f => sets[f] !== undefined ? sets[f] : null);
        if (existing) {
          await db.prepare(`UPDATE workout_history SET ${fields.map(f => f + ' = ?').join(', ')} WHERE id = ?`).bind(...values, existing.id).run();
        } else {
          await db.prepare(`INSERT INTO workout_history (exercise_id, date, ${fields.join(', ')}, created_at) VALUES (?, ?, ${fields.map(()=>'?').join(', ')}, ?)`).bind(exerciseId, date, ...values, Date.now()).run();
        }
        return json({ success: true });
      }

      if (path === '/api/workout-state' && request.method === 'GET') {
        const row = await db.prepare('SELECT * FROM workout_state WHERE id = 1').first();
        if (!row) return json({ checked: {}, plannedExercises: {}, loadingPattern: {}, customExercises: [], nameOverrides: {} });
        return json({
          checked: JSON.parse(row.checked_json || '{}'),
          plannedExercises: JSON.parse(row.planned_exercises_json || '{}'),
          loadingPattern: JSON.parse(row.loading_pattern_json || '{}'),
          customExercises: JSON.parse(row.custom_exercises_json || '[]'),
          nameOverrides: JSON.parse(row.name_overrides_json || '{}'),
        });
      }

      if (path === '/api/workout-stat
