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
      // ── SETTINGS ──────────────────────────────────────────────
      if (path === '/api/settings' && request.method === 'GET') {
        const key = url.searchParams.get('key');
        if (!key) return err('key required');
        const row = await db.prepare('SELECT * FROM app_settings WHERE key = ?').bind(key).first();
        return json({ value: row ? row.value : null });
      }

      if (path === '/api/settings' && request.method === 'POST') {
        const body = await request.json();
        const { key, value } = body;
        if (!key) return err('key required');
        await db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(key, value, Date.now()).run();
        return json({ success: true });
      }

      // ── DAY TYPE ──────────────────────────────────────────────
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
        await db.prepare('INSERT INTO day_type_log (date, day_type, created_at) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET day_type = excluded.day_type').bind(date, dayType, Date.now()).run();
        return json({ success: true });
      }

      // ── WORKOUT HISTORY ───────────────────────────────────────
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

      // ── WORKOUT STATE ─────────────────────────────────────────
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

      if (path === '/api/workout-state' && request.method === 'POST') {
        const body = await request.json();
        await db.prepare(`INSERT INTO workout_state (id, checked_json, planned_exercises_json, loading_pattern_json, custom_exercises_json, name_overrides_json, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET checked_json = excluded.checked_json, planned_exercises_json = excluded.planned_exercises_json, loading_pattern_json = excluded.loading_pattern_json, custom_exercises_json = excluded.custom_exercises_json, name_overrides_json = excluded.name_overrides_json, updated_at = excluded.updated_at`).bind(
          JSON.stringify(body.checked || {}),
          JSON.stringify(body.plannedExercises || {}),
          JSON.stringify(body.loadingPattern || {}),
          JSON.stringify(body.customExercises || []),
          JSON.stringify(body.nameOverrides || {}),
          Date.now()
        ).run();
        return json({ success: true });
      }

      // ── MEAL LOG ──────────────────────────────────────────────
      if (path === '/api/meal-log' && request.method === 'GET') {
        const date = url.searchParams.get('date');
        if (date) {
          const row = await db.prepare('SELECT * FROM daily_meal_log WHERE date = ?').bind(date).first();
          if (!row) return json({ log: null });
          return json({ log: { date: row.date, dayType: row.day_type, meals: JSON.parse(row.meals_json) } });
        } else {
          const results = await db.prepare('SELECT * FROM daily_meal_log ORDER BY date DESC LIMIT 30').all();
          const logs = {};
          results.results.forEach(row => { logs[row.date] = { dayType: row.day_type, meals: JSON.parse(row.meals_json) }; });
          return json({ logs });
        }
      }

      if (path === '/api/meal-log' && request.method === 'POST') {
        const body = await request.json();
        const { date, dayType, meals } = body;
        if (!date || !dayType || !meals) return err('date, dayType, meals required');
        const now = Date.now();
        await db.prepare(`INSERT INTO daily_meal_log (date, day_type, meals_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(date) DO UPDATE SET day_type = excluded.day_type, meals_json = excluded.meals_json, updated_at = excluded.updated_at`).bind(date, dayType, JSON.stringify(meals), now, now).run();
        return json({ success: true });
      }

      // ── MEAL CHECKED ──────────────────────────────────────────
      if (path === '/api/meal-checked' && request.method === 'GET') {
        const date = url.searchParams.get('date');
        if (!date) return err('date required');
        const results = await db.prepare('SELECT * FROM meal_checked WHERE date = ?').bind(date).all();
        const checked = {};
        results.results.forEach(row => { checked[row.meal_key] = !!row.checked; });
        return json({ checked });
      }

      if (path === '/api/meal-checked' && request.method === 'POST') {
        const body = await request.json();
        const { date, mealKey, checked } = body;
        if (!date || mealKey === undefined) return err('date and mealKey required');
        await db.prepare(`INSERT INTO meal_checked (date, meal_key, checked) VALUES (?, ?, ?) ON CONFLICT(date, meal_key) DO UPDATE SET checked = excluded.checked`).bind(date, mealKey, checked ? 1 : 0).run();
        return json({ success: true });
      }

      // ── FOOD LIBRARY ──────────────────────────────────────────
      if (path === '/api/food-library' && request.method === 'GET') {
        const results = await db.prepare('SELECT * FROM food_library ORDER BY created_at DESC').all();
        return json({ foods: results.results });
      }

      if (path === '/api/food-library' && request.method === 'POST') {
        const body = await request.json();
        const { name, serving, protein, carbs, fat, fiber, sugar, sodium } = body;
        if (!name) return err('name required');
        await db.prepare('INSERT INTO food_library (name, serving, protein, carbs, fat, fiber, sugar, sodium, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(name, serving || '', protein||0, carbs||0, fat||0, fiber||0, sugar||0, sodium||0, Date.now()).run();
        return json({ success: true });
      }

      if (path.startsWith('/api/food-library/') && request.method === 'DELETE') {
        const id = path.split('/').pop();
        await db.prepare('DELETE FROM food_library WHERE id = ?').bind(id).run();
        return json({ success: true });
      }

      // ── REMINDERS ─────────────────────────────────────────────
      if (path === '/api/reminders' && request.method === 'GET') {
        const results = await db.prepare('SELECT * FROM reminder_settings').all();
        const settings = {};
        results.results.forEach(row => { settings[row.reminder_key] = { enabled: !!row.enabled, minsBefore: row.mins_before }; });
        return json({ settings });
      }

      if (path === '/api/reminders' && request.method === 'POST') {
        const body = await request.json();
        const { reminderKey, enabled, minsBefore } = body;
        if (!reminderKey) return err('reminderKey required');
        await db.prepare(`INSERT INTO reminder_settings (reminder_key, enabled, mins_before, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(reminder_key) DO UPDATE SET enabled = excluded.enabled, mins_before = excluded.mins_before, updated_at = excluded.updated_at`).bind(reminderKey, enabled ? 1 : 0, minsBefore || 5, Date.now()).run();
        return json({ success: true });
      }

      // ── WEIGHT LOG ────────────────────────────────────────────
      if (path === '/api/weight-log' && request.method === 'GET') {
        const results = await db.prepare('SELECT * FROM weight_log ORDER BY date ASC').all();
        return json({ entries: results.results });
      }

      if (path === '/api/weight-log' && request.method === 'POST') {
        const body = await request.json();
        const { date, weight, bmi } = body;
        if (!date || !weight) return err('date and weight required');
        await db.prepare(`INSERT INTO weight_log (date, weight, bmi, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(date) DO UPDATE SET weight = excluded.weight, bmi = excluded.bmi`).bind(date, weight, bmi || null, Date.now()).run();
        return json({ success: true });
      }

      // ── WEEK SCHEDULE ─────────────────────────────────────────
      if (path === '/api/week-schedule' && request.method === 'GET') {
        const row = await db.prepare("SELECT value FROM app_settings WHERE key = 'week_schedule'").first();
        return json({ schedule: row ? JSON.parse(row.value) : null });
      }

      if (path === '/api/week-schedule' && request.method === 'POST') {
        const body = await request.json();
        await db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('week_schedule', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(JSON.stringify(body), Date.now()).run();
        return json({ success: true });
      }

      return err('Not found', 404);
    } catch (e) {
      return err('Server error: ' + e.message, 500);
    }
  },
};
