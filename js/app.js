// js/app.js (versión v7, simplificada y verificada)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const supabase = createClient(
  'https://peeagzvflrzibavfnqyc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlZWFnenZmbHJ6aWJhdmZucXljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkxOTc2NTUsImV4cCI6MjA3NDc3MzY1NX0.AmvYrGOlhEkv2QYzrqKdUz_nAD1bKTh8vqVZCNsg100'
);

// Utilidades
const $ = (id) => document.getElementById(id);
const fmt = {
  num: (x) => (x == null ? '—' : new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(x)),
  pct: (x) => (x == null ? '—' : (x * 100).toFixed(0) + '%'),
};

// ============================
// Navegación (sin modales)
// ============================
document.querySelectorAll('#sidebarNav .nav-item').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    const view = el.getAttribute('data-view');
    // estado activo
    document.querySelectorAll('#sidebarNav .nav-item').forEach((i) => {
      i.classList.remove('bg-gray-100', 'text-gray-900');
      i.classList.add('text-gray-700');
    });
    el.classList.add('bg-gray-100', 'text-gray-900');
    // toggle vistas
    ['dashboard', 'control', 'sprint', 'upload'].forEach((v) => {
      const sec = $('view-' + v);
      if (sec) sec.classList.toggle('hidden', v !== view);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});

// ============================
// Dashboard: Sprint + KPIs
// ============================
async function loadSprint() {
  const res = await supabase
    .from('sprint')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const s = res?.data;
  if (!s) return;
  $('sprintName').textContent = s.nombre;
  $('sprintDates').textContent =
    new Date(s.fecha_inicio).toLocaleDateString('es-MX') +
    ' – ' +
    new Date(s.fecha_fin).toLocaleDateString('es-MX');
  // Placeholder; si luego quieres, calculamos desde SQL
  $('diasRestantes').textContent = '—';
}

async function loadKpis() {
  const res = await supabase.from('vw_kpis').select('*').limit(1).maybeSingle();
  const d = res?.data;
  if (!d) return;
  $('kpiTotal').textContent = fmt.num(d.horas_sprint);
  $('kpiPendientes').textContent = fmt.num(d.horas_pendientes);
  $('kpiTerminadas').textContent = fmt.num(d.horas_terminadas);
  $('kpiAvance').textContent = fmt.pct(d.avance);
}

// ============================
// Burndown: gráfico + tabla
// ============================
async function loadBurndownChartAndTable() {
  const res = await supabase.from('burndown_diario').select('*').order('dia');
  const data = res?.data || [];
  if (data.length === 0) return;

  // --- Chart ---
  const labels = data.map((r) => 'Día ' + r.dia);
  const estimada = data.map((r) => r.estimacion);
  const real = data.map((r) => r.real);
  const completadas = data.map((r, i) => {
    if (i === 0) return 0;
    const prev = real[i - 1] != null ? real[i - 1] : real[i];
    const curr = real[i] != null ? real[i] : real[i - 1];
    const delta = (prev != null && curr != null) ? (prev - curr) : 0;
    return Math.max(0, delta);
  });

  const ctx = $('burndownChart').getContext('2d');
  if (window.__bdChart) window.__bdChart.destroy();
  window.__bdChart = new Chart(ctx, {
    data: {
      labels: labels,
      datasets: [
        { type: 'bar', label: 'Completadas (h)', data: completadas, borderWidth: 1 },
        { type: 'line', label: 'Estimación', data: estimada, tension: 0.25, borderWidth: 2, pointRadius: 2 },
        { type: 'line', label: 'Real', data: real, tension: 0.25, borderWidth: 2, pointRadius: 2 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' }, tooltip: { mode: 'index', intersect: false } },
      interaction: { mode: 'index', intersect: false },
      scales: { y: { beginAtZero: true } },
    },
  });

  // --- Tabla editable ---
  const tbody = $('bdBody');
  const fmtDate = (d) => new Date(d).toLocaleDateString('es-MX');

  tbody.innerHTML = data
    .map((r) => {
      const realVal = r.real == null ? '' : r.real;
      const manualAttr = r.manual_edit ? 'checked' : '';
      return (
        '<tr class="border-b last:border-0">' +
        '<td class="py-2 pr-4">' + r.dia + '</td>' +
        '<td class="py-2 pr-4">' + fmtDate(r.fecha) + '</td>' +
        '<td class="py-2 pr-4">' + fmt.num(r.estimacion) + '</td>' +
        '<td class="py-2 pr-4">' +
        '<input data-fecha="' + r.fecha + '" value="' + realVal + '" class="bd-real w-32 px-2 py-1 rounded border" placeholder="—" />' +
        '</td>' +
        '<td class="py-2 pr-4">' +
        '<label class="inline-flex items-center gap-2 text-sm">' +
        '<input type="checkbox" class="bd-manual" data-fecha="' + r.fecha + '" ' + manualAttr + ' />' +
        'Manual</label>' +
        '</td>' +
        '</tr>'
      );
    })
    .join('');

  // Cambios en "Real"
  tbody.querySelectorAll('.bd-real').forEach((inp) => {
    inp.addEventListener('change', async () => {
      const fecha = inp.getAttribute('data-fecha');
      const val = parseFloat(inp.value || '0');
      $('bdMsg').textContent = 'Guardando...';
      const resp = await supabase.rpc('set_burndown_manual', { p_fecha: fecha, p_real: val });
      $('bdMsg').textContent = resp.error ? 'Error: ' + resp.error.message : 'Guardado.';
      await loadKpis();
      await loadBurndownChartAndTable();
    });
  });

  // Toggle Manual
  tbody.querySelectorAll('.bd-manual').forEach((chk) => {
    chk.addEventListener('change', async () => {
      const fecha = chk.getAttribute('data-fecha');
      $('bdMsg').textContent = 'Actualizando...';
      let error = null;
      if (chk.checked) {
        const inputEl = tbody.querySelector('input.bd-real[data-fecha="' + fecha + '"]');
        const val = parseFloat(inputEl && inputEl.value ? inputEl.value : '0');
        const resp = await supabase.rpc('set_burndown_manual', { p_fecha: fecha, p_real: val });
        error = resp.error;
      } else {
        const resp = await supabase.rpc('unset_burndown_manual', { p_fecha: fecha });
        error = resp.error;
      }
      $('bdMsg').textContent = error ? 'Error: ' + error.message : 'Listo.';
      await loadKpis();
      await loadBurndownChartAndTable();
    });
  });

  // Recalcular desde cargas
  const btnRecalc = $('btnRecalc');
  if (btnRecalc) {
    btnRecalc.onclick = async () => {
      $('bdMsg').textContent = 'Reconstruyendo...';
      const resp = await supabase.rpc('reconstruir_burndown_sprint_activo');
      $('bdMsg').textContent = resp.error ? 'Error: ' + resp.error.message : 'Burndown reconstruido.';
      await loadKpis();
      await loadBurndownChartAndTable();
    };
  }
} // <— cierre OK

// ============================
// Avances
// ============================
async function loadPorLista() {
  const res = await supabase.from('vw_por_lista').select('*');
  const data = res?.data || [];
  const host = $('avanceListas');
  if (!host) return;
  host.innerHTML = '';
  data.forEach((l) => {
    const pct = l.asignadas > 0 ? l.terminadas / l.asignadas : 0;
    const wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="flex items-center justify-between mb-1">' +
      '<span class="font-medium">' + l.lista + '</span>' +
      '<span class="text-sm text-gray-600">' + fmt.pct(pct) + '</span>' +
      '</div>' +
      '<div class="w-full bg-gray-200 rounded-full h-2">' +
      '<div class="h-2 rounded-full ' +
      (pct > 0.6 ? 'bg-emerald-500' : pct > 0.4 ? 'bg-amber-500' : 'bg-blue-500') +
      '" style="width:' + (pct * 100).toFixed(0) + '%"></div></div>';
    host.appendChild(wrap);
  });
}

async function loadPorHistoria() {
  const res = await supabase.from('vw_por_historia').select('*');
  const data = res?.data || [];
  const host = $('avanceHU');
  if (!host) return;
  host.innerHTML = '';
  data.forEach((h) => {
    const pct = h.totales > 0 ? h.terminadas / h.totales : 0;
    const pill =
      pct >= 0.8
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : pct >= 0.5
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-blue-50 text-blue-700 border-blue-200';
    const row = document.createElement('div');
    row.className = 'p-3 rounded-lg border flex items-start justify-between';
    row.innerHTML =
      '<div><div class="font-medium">' +
      h.id_historia +
      ' · ' +
      h.historia +
      '</div><div class="text-xs text-gray-500">Lista: ' +
      h.lista +
      '</div></div><div class="text-sm"><span class="px-2 py-1 rounded-full border ' +
      pill +
      '">' +
      fmt.pct(pct) +
      ' <span class="text-gray-500">(' +
      fmt.num(h.totales) +
      'h totales · ' +
      fmt.num(h.abiertas) +
      'h abiertas)</span></span></div>';
    host.appendChild(row);
  });
}

async function loadPorPropietario() {
  const spr = await supabase
    .from('sprint')
    .select('horas_por_dia')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const horasPorDia = spr?.data?.horas_por_dia || 0;
  const diasRestText = $('diasRestantes').textContent;
  const diasRest = diasRestText === '—' ? 0 : parseInt(diasRestText, 10);
  const capPersona = horasPorDia * diasRest;

  const res = await supabase.from('vw_por_propietario').select('*');
  const data = res?.data || [];
  const host = $('avanceOwners');
  if (!host) return;
  host.innerHTML = '';
  data.forEach((o) => {
    const disponibles = capPersona;
    const ok = disponibles >= o.pendientes;
    const card = document.createElement('div');
    card.className = 'p-4 bg-gray-50 rounded-lg border';
    card.innerHTML =
      '<div class="font-semibold mb-2">' +
      o.propietario +
      '</div><div class="text-sm mb-2">Pendientes: <span class="' +
      (ok ? 'text-emerald-600' : 'text-rose-600') +
      '">' +
      fmt.num(o.pendientes) +
      'h</span> · Disponibles: ' +
      fmt.num(disponibles) +
      'h · ' +
      (ok ? 'OK' : 'No alcanza') +
      '</div>';
    host.appendChild(card);
  });
}

// ============================
// Control de subtareas (grid)
// ============================
async function loadControlSub() {
  const pageSizeSel = $('pageSize');
  const search = $('searchSub');
  const tbody = $('subBody');
  const count = $('countSub');
  const prev = $('prevSub');
  const next = $('nextSub');
  const pageLbl = $('pageSub');

  if (!pageSizeSel || !search || !tbody) return;

  let page = 1;
  let total = 0;

  function strip(s) {
    return (s || '').toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  }
  function rowHtml(r) {
    return (
      '<tr class="border-b last:border-0">' +
      '<td class="py-2 pr-4">' + r.id_subtarea + '</td>' +
      '<td class="py-2 pr-4">' + (r.titulo || '') + '</td>' +
      '<td class="py-2 pr-4">' + (r.estado || '') + '</td>' +
      '<td class="py-2 pr-4">' + (r.propietario || '') + '</td>' +
      '<td class="py-2 pr-4 text-center">' + (r.terminado_manual ? 'Sí' : 'No') + '</td>' +
      '<td class="py-2 pr-4 text-center">' + (r.visible ? 'Sí' : 'No') + '</td>' +
      '<td class="py-2 pr-4">' + (r.nombre_lista || '') + '</td>' +
      '</tr>'
    );
  }

  async function fetchPage() {
    const limit = parseInt(pageSizeSel.value, 10) || 50;
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const qstr = strip(search.value);

    if (qstr) {
      const all = await supabase.from('vw_control_subtareas').select('*');
      const arr = all?.data || [];
      const filtered = arr.filter((r) => strip(Object.values(r).join(' ')).includes(qstr));
      total = filtered.length;
      const slice = filtered.slice(from, to + 1);
      tbody.innerHTML = slice.map((r) => rowHtml(r)).join('');
      const maxPage = Math.max(1, Math.ceil(total / limit));
      if (pageLbl) pageLbl.textContent = page + ' / ' + maxPage;
      if (count) count.textContent = Math.min(total, to + 1) + ' de ' + total;
      return;
    }

    const res = await supabase
      .from('vw_control_subtareas')
      .select('*', { count: 'exact' })
      .order('id_subtarea')
      .range(from, to);

    const arr = res?.data || [];
    total = res?.count || 0;
    tbody.innerHTML = arr.map((r) => rowHtml(r)).join('');
    const maxPage = Math.max(1, Math.ceil(total / limit));
    if (pageLbl) pageLbl.textContent = page + ' / ' + maxPage;
    if (count) count.textContent = Math.min(total, to + 1) + ' de ' + total;
  }

  search.addEventListener('input', () => {
    page = 1;
    fetchPage();
  });
  pageSizeSel.addEventListener('change', () => {
    page = 1;
    fetchPage();
  });
  if (prev) {
    prev.addEventListener('click', () => {
      if (page > 1) {
        page -= 1;
        fetchPage();
      }
    });
  }
  if (next) {
    next.addEventListener('click', () => {
      const limit = parseInt(pageSizeSel.value, 10) || 50;
      const max = Math.max(1, Math.ceil(total / limit));
      if (page < max) {
        page += 1;
        fetchPage();
      }
    });
  }

  await fetchPage();
}

// ============================
// Registrar Sprint (sin modales)
// ============================
const btnSave = $('f_save');
if (btnSave) {
  btnSave.addEventListener('click', async () => {
    const nombre = $('f_nombre').value.trim();
    const horas_sprint = parseFloat($('f_hsprint').value || '0');
    const inicio = $('f_inicio').value;
    const fin = $('f_fin').value;
    const hxd = parseFloat($('f_hxd').value || '0');
    $('f_msg').textContent = 'Guardando...';

    const resp = await supabase.rpc('new_sprint', {
      p_nombre: nombre,
      p_inicio: inicio,
      p_fin: fin,
      p_horas_sprint: horas_sprint,
      p_horas_por_dia: hxd,
    });
    if (resp.error) {
      $('f_msg').textContent = 'Error: ' + resp.error.message;
      return;
    }
    $('f_msg').textContent = 'Sprint registrado. (Se borró info previa)';
    await supabase.rpc('reconstruir_burndown_sprint_activo');
    await initDashboard();
  });
}

// ============================
// Cargas CSV (sin modales)
// ============================
function parseCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => resolve(res.data),
      error: reject,
    });
  });
}

async function importHistorias(file) {
  const rows = await parseCSV(file);
  for (const r of rows) {
    const id_tarea_principal = (r.id_tarea_principal || r.id_historia || r['id historia'] || r['id'] || '').toString().trim();
    if (!id_tarea_principal) continue;
    const nombre_lista = (r.nombre_lista || r.lista || '') + '';
    const nombre_historia = (r.nombre_historia || r.historia || r.titulo || '') + '';
    const resp = await supabase.rpc('upsert_historia', {
      p_id_tarea_principal: id_tarea_principal,
      p_nombre_lista: nombre_lista,
      p_nombre_historia: nombre_historia,
    });
    if (resp.error) console.error('historia', id_tarea_principal, resp.error.message);
  }
}

function normFecha(v) {
  if (!v) return null;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) {
    const parts = v.split('/');
    const d = parts[0];
    const m = parts[1];
    const y = parts[2];
    return y + '-' + m + '-' + d;
  }
  return v;
}

async function importSub(file) {
  const rows = await parseCSV(file);
  for (const r of rows) {
    const p_id_subtarea = (r.id_subtarea || r.sub || r['id subtarea'] || r['id'] || '').toString().trim();
    const p_id_tarea_principal = (r.id_tarea_principal || r.historia || r['id historia'] || '').toString().trim();
    if (!p_id_subtarea || !p_id_tarea_principal) continue;
    const p_titulo = (r.titulo || r.descripcion || '') + '';
    const p_estado = (r.estado || '') + '';
    const p_propietario = (r.propietario || r.owner || '') + '';
    const p_duracion_txt = (r.duracion || r.duracion_txt || r['duración'] || '') + '';
    const p_fecha_terminacion = normFecha((r.fecha_terminacion || r['fecha terminacion'] || r['fecha_terminacion'] || '') + '');
    const resp = await supabase.rpc('upsert_subtarea', {
      p_id_subtarea,
      p_id_tarea_principal,
      p_titulo,
      p_estado,
      p_propietario,
      p_duracion_txt,
      p_fecha_terminacion,
    });
    if (resp.error) console.error('subtarea', p_id_subtarea, resp.error.message);
  }
}

const btnProcess = $('u_process');
if (btnProcess) {
  btnProcess.addEventListener('click', async () => {
    $('u_msg').textContent = 'Procesando CSVs...';
    try {
      const fh = $('fileHistorias').files[0];
      const fs = $('fileSub').files[0];
      if (fh) await importHistorias(fh);
      if (fs) await importSub(fs);
      await supabase.rpc('reconstruir_burndown_sprint_activo');
      $('u_msg').textContent = 'Importación completada y burndown actualizado.';
      await initDashboard();
    } catch (e) {
      $('u_msg').textContent = 'Error: ' + e.message;
    }
  });
}

const btnRecalcUpload = $('u_recalc');
if (btnRecalcUpload) {
  btnRecalcUpload.addEventListener('click', async () => {
    $('u_msg').textContent = 'Reconstruyendo...';
    const resp = await supabase.rpc('reconstruir_burndown_sprint_activo');
    $('u_msg').textContent = resp.error ? 'Error: ' + resp.error.message : 'Burndown actualizado.';
    await initDashboard();
  });
}

// ============================
// Init
// ============================
async function initDashboard() {
  await loadSprint();
  await loadKpis();
  await loadBurndownChartAndTable();
  await loadPorLista();
  await loadPorHistoria();
  await loadPorPropietario();
  await loadControlSub();
}
initDashboard();
