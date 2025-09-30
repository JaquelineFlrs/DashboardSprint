
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const SUPABASE_URL = 'https://peeagzvflrzibavfnqyc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlZWFnenZmbHJ6aWJhdmZucXljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkxOTc2NTUsImV4cCI6MjA3NDc3MzY1NX0.AmvYrGOlhEkv2QYzrqKdUz_nAD1bKTh8vqVZCNsg100';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(async function() {
  // Load KPIs
  try {
    const { data } = await supabase.from('vw_kpis').select('*').limit(1).single();
    if (data) {
      document.getElementById('kpiTotal').textContent = new Intl.NumberFormat('es-MX').format(data.horas_sprint);
      document.getElementById('kpiPendientes').textContent = new Intl.NumberFormat('es-MX').format(data.horas_pendientes);
      document.getElementById('kpiTerminadas').textContent = new Intl.NumberFormat('es-MX').format(data.horas_terminadas);
      document.getElementById('kpiAvance').textContent = (data.avance*100).toFixed(0)+'%';
    }
  } catch (e) { console.error(e); }
})();
