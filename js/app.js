// app.js — Sprint Admin (UUID + no_mostrar + duracion_h)
// Requiere: Tailwind (CDN o build), Chart.js, PapaParse (CDN), index.html con los IDs usados abajo.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// === Config Supabase (tu URL y anon key) ===
const supabase = createClient(
  'https://peeagzvflrzibavfnqyc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlZWFnenZmbHJ6aWJhdmZucXljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkxOTc2NTUsImV4cCI6MjA3NDc3MzY1NX0.AmvYrGOlhEkv2QYzrqKdUz_nAD1bKTh8vqVZCNsg100'
);

// === Utils ===
const $ = (id) => document.getElementById(id);
const fmt = {
  num: (x) => (x == null ? '—' : new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(x)),
  pct: (x) => (x == null ? '—' : (x * 100).toFixed(0) + '%'),
};
const todayISO = () => new Date().toISOString().slice(0, 10);

// Días hábiles (JS) entre dos fechas, excluyendo sáb-dom.
// *No* descuenta festivos; el server ya descuenta festivos para el burndown.
// Esto es solo para mostrar "días restantes" en el UI y capacidad por persona.
function businessDaysJS(fromDate, toDate) {
  if (!fromDate || !toDate) return 0;
  const d1 = new Date(fromDate);
  const d2 = new Date(toDate);
  if (d2 < d1) return 0;
  let count = 0;
  for (let d = new Date(d1); d <= d2; d.setDate(d.getDate() + 1)) {
    const day = d.getDay(); // 0=Dom, 6=Sáb
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

// === Navegación entre vistas (menu: dashboard / control / sprint / upload) ===
document.querySelectorAll('#sidebarNav .nav-item').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    const view = el.getAttribute('data-view');
    document.querySelectorAll('#sidebarNav .nav-item').forEach((i) => {
      i.classList.remove('bg-gray-100', 'text-gray-900');
      i.classList.add('text-gray-700');
    });
    el.classList.add('bg-gray-100', 'text-gray-900');
    ['dashboard', 'control', 'sprint', 'upload'].forEach((v) => {
      const sec = $('view-' + v);
      if (sec) sec.classList.toggle('hidden', v !== view);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});

// === Dashboard: header + KPIs ===
async function loadSprint() {
  const { data, error } = await supabase
    .from('sprint')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('loadSprint', error.message);
    return null;
  }
  if (!data) return null;

  // Header
  const inicio = new Date(data.fecha_inicio);
  const fin = new Date(data.fecha_fin);
  const hoy = new Date(todayISO());
  $('sprintName') && ($('sprintName').textContent = data.nombre);
  $('sprintDates') &&
    ($('sprintDates').textContent = `${inicio.toLocaleDateString('es-MX')} – ${fin.toLocaleDateString('es-MX')}`);

  // Días hábiles restantes (hoy..fin)
  const dIni = hoy > fin ? fin : hoy;
  const diasRest = businessDaysJS(dIni, fin);
  $('diasRestantes') && ($('diasRestantes').textContent = diasRest);

  // Card "Al día de hoy" (si existe en el HTML)
  if ($('horasFaltantes') || $('horasPendCard') || $('riesgoCard')) {
    const horasRest = diasRest * (data.horas_por_dia || 0);
    $('horasFaltantes') && ($('horasFaltantes').textContent = fmt.num(horasRest));
    $('fechaFin') && ($('fechaFin').textContent = fin.toLocaleDateString('es-MX'));
    $('diasRestCard') && ($('diasRestCard').textContent = diasRest);
    $('hrsPorDia') && ($('hrsPorDia').textContent = data.horas_por_dia || 0);

    // Para riesgo, ocupamos horas pendientes reales; lo actualizamos tras loadKpis/loadBurndown
  }

  return { sprint: data, diasRest };
}

async function loadKpis() {
  const { data, error } = await supabase.from('vw_kpis').select('*').limit(1).maybeSingle();
  if (error) {
    console.error('loadKpis', error.message);
    return null;
  }
  if (!data) return null;

  $('kpiTotal') && ($('kpiTotal').textContent = fmt.num(data.horas_sprint));
  $('kpiPendientes') && ($('kpiPendientes').textContent = fmt.num(data.horas_pendientes));
  $('kpiTerminadas') && ($('kpiTerminadas').textContent = fmt.num(data.horas_terminadas));
  $('kpiAvance') && ($('kpiAvance').textContent = fmt.pct(data.avance));

  // Actualiza card "Al día de hoy"
  if ($('horasPendCard') || $('riesgoCard')) {
    const horasPend = data.horas_pendientes || 0;
    $('horasPendCard') && ($('horasPendCard').textContent = fmt.num(horasPend));

    // Para riesgo necesitamos horasRestantes: toma del header renderizado si existiese
    const diasRestTxt = $('diasRestCard') ? $('diasRestCard').textContent : '0';
    const hxdTxt = $('hrsPorDia') ? $('hrsPorDia').textContent : '0';
    const horasRestantes = (parseFloat(diasRestTxt || '0') || 0) * (parseFloat(hxdTxt || '0') || 0);
    const riskText = `${fmt.num(horasPend)}h > ${fmt.num(horasRestantes)}h → ${horasPend > horasRestantes ? 'No alcanza' : 'OK'}`;
    if ($('riesgoCard')) {
      $('riesgoCard').textContent = riskText;
      $('riesgoCard').className = horasPend > horasRestantes ? 'text-rose-600 font-bold' : 'text-emerald-600 font-bold';
    }
  }

  return data;
}

// === Burndown (gráfico + tabla editable) ===
async function loadBurndownChartAndTable() {
  const { data, error } = await supabase.from('burndown_diario').select('*').order('dia');
  if (error) {
    console.error('loadBurndown', error.message);
    return;
  }
  const rows = data || [];
  if (rows.length === 0) {
    // limpia chart y tabla
    if (window.__bdChart) {
      window.__bdChart.destroy();
      window.__bdChart = null;
    }
    const tbody = $('bdBody');
    if (tbody) tbody.innerHTML = '';
    return;
  }

  // Chart datasets
  const labels = rows.map((r) => `Día ${r.dia}`);
  const estimada = rows.map((r) => r.estimacion);
  const real = rows.map((r) => r.real);
  // Barras "Completadas (h)" = diferencia positiva entre real anterior y actual
  const completadas = rows.map((r, i) => {
    if (i === 0) return 0;
    const p = real[i - 1] ?? real[i];
    const c = real[i] ?? real[i - 1];
    const d = p != null && c != null ? p - c : 0;
    return Math.max(0, d);
  });

  const chartEl = $('burndownChart');
  if (chartEl) {
    const ctx = chartEl.getContext('2d');
    if (window.__bdChart) window.__bdChart.destroy();
    window.__bdChart = new Chart(ctx, {
      data: {
        labels,
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
  }

  // Tabla editable
  const tbody = $('bdBody');
  if (tbody) {
    const fmtDate = (d) => new Date(d).toLocaleDateString('es-MX');
    tbody.innerHTML = rows
      .map((r) => {
        const realVal = r.real == null ? '' : r.real;
        const manualAttr = r.manual_edit ? 'checked' : '';
        return `
          <tr class="border-b last:border-0">
            <td class="py-2 pr-4">${r.dia}</td>
            <td class="py-2 pr-4">${fmtDate(r.fecha)}</td>
            <td class="py-2 pr-4">${fmt.num(r.estimacion)}</td>
            <td class="py-2 pr-4">
              <input data-fecha="${r.fecha}" value="${realVal}" class="bd-real w-32 px-2 py-1 rounded border" placeholder="—" />
            </td>
            <td class="py-2 pr-4">
              <label class="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" class="bd-manual" data-fecha="${r.fecha}" ${manualAttr} />
                Manual
              </label>
            </td>
          </tr>`;
      })
      .join('');

    // Edición del valor real (guarda y recarga)
    tbody.querySelectorAll('.bd-real').forEach((inp) => {
      inp.addEventListener('change', async () => {
        const fecha = inp.getAttribute('data-fecha');
        const val = parseFloat(inp.value || '0');
        $('bdMsg') && ($('bdMsg').textContent = 'Guardando...');
        const { error: err } = await supabase.rpc('set_burndown_manual', { p_fecha: fecha, p_real: val });
        $('bdMsg') && ($('bdMsg').textContent = err ? 'Error: ' + err.message : 'Guardado.');
        await loadKpis();
        await loadBurndownChartAndTable();
      });
    });

    // Toggle manual_edit on/off
    tbody.querySelectorAll('.bd-manual').forEach((chk) => {
      chk.addEventListener('change', async () => {
        const fecha = chk.getAttribute('data-fecha');
        $('bdMsg') && ($('bdMsg').textContent = 'Actualizando...');
        let err = null;
        if (chk.checked) {
          const inputEl = tbody.querySelector(`input.bd-real[data-fecha="${fecha}"]`);
          const val = parseFloat((inputEl && inputEl.value) ? inputEl.value : '0');
          const resp = await supabase.rpc('set_burndown_manual', { p_fecha: fecha, p_real: val });
          err = resp.error;
        } else {
          const resp = await supabase.rpc('unset_burndown_manual', { p_fecha: fecha });
          err = resp.error;
        }
        $('bdMsg') && ($('bdMsg').textContent = err ? 'Error: ' + err.message : 'Listo.');
        await loadKpis();
        await loadBurndownChartAndTable();
      });
    });
  }

  // Botón "Reconstruir burndown"
  const btnRecalc = $('btnRecalc');
  if (btnRecalc) {
    btnRecalc.onclick = async () => {
      $('bdMsg') && ($('bdMsg').textContent = 'Reconstruyendo...');
      const { error: e1 } = await supabase.rpc('reconstruir_burndown_sprint_activo');
      if (e1) {
        $('bdMsg') && ($('bdMsg').textContent = 'Error: ' + e1.message);
        return;
      }
      // Después de reconstruir, escribe el "real" de hoy con el corte actual
      const { error: e2 } = await supabase.rpc('actualizar_burndown_con_pendientes', { p_fecha: todayISO() });
      $('bdMsg') && ($('bdMsg').textContent = e2 ? 'Error: ' + e2.message : 'Burndown reconstruido.');
      await loadKpis();
      await loadBurndownChartAndTable();
    };
  }
}

// === Avance por lista ===
async function loadPorLista() {
  const { data, error } = await supabase.from('vw_por_lista').select('*');
  if (error) {
    console.error('vw_por_lista', error.message);
    return;
  }
  const host = $('avanceListas');
  if (!host) return;
  host.innerHTML = '';
  (data || []).forEach((l) => {
    const pct = l.asignadas > 0 ? l.terminadas / l.asignadas : 0;
    const bar = document.createElement('div');
    bar.innerHTML = `
      <div class="flex items-center justify-between mb-1">
        <span class="font-medium">${l.lista}</span>
        <span class="text-sm text-gray-600">${fmt.pct(pct)}</span>
      </div>
      <div class="w-full bg-gray-200 rounded-full h-2">
        <div class="h-2 rounded-full ${pct > 0.6 ? 'bg-emerald-500' : pct > 0.4 ? 'bg-amber-500' : 'bg-blue-500'}" style="width:${(pct * 100).toFixed(0)}%"></div>
      </div>`;
    host.appendChild(bar);
  });
}

// === Avance por historia ===
async function loadPorHistoria() {
  const { data, error } = await supabase.from('vw_por_historia').select('*');
  if (error) {
    console.error('vw_por_historia', error.message);
    return;
  }
  const host = $('avanceHU');
  if (!host) return;
  host.innerHTML = '';
  (data || []).forEach((h) => {
    const pct = h.totales > 0 ? h.terminadas / h.totales : 0;
    const pill =
      pct >= 0.8
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : pct >= 0.5
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-blue-50 text-blue-700 border-blue-200';
    const row = document.createElement('div');
    row.className = 'p-3 rounded-lg border flex items-start justify-between';
    row.innerHTML = `
      <div>
        <div class="font-medium">${h.id_historia} · ${h.historia}</div>
        <div class="text-xs text-gray-500">Lista: ${h.lista}</div>
      </div>
      <div class="text-sm">
        <span class="px-2 py-1 rounded-full border ${pill}">
          ${fmt.pct(pct)} <span class="text-gray-500">(${fmt.num(h.totales)}h totales · ${fmt.num(h.abiertas)}h abiertas)</span>
        </span>
      </div>`;
    host.appendChild(row);
  });
}

// === Avance por participante (capacidad = horas_por_dia * días hábiles restantes) ===
async function loadPorPropietario() {
  // Sprint para capacidad por persona
  const spr = await supabase.from('sprint').select('fecha_fin, horas_por_dia').order('created_at', { ascending: false }).limit(1).maybeSingle();
  const fin = spr.data ? new Date(spr.data.fecha_fin) : null;
  const hoy = new Date(todayISO());
  const diasRest = fin ? businessDaysJS(hoy > fin ? fin : hoy, fin) : 0;
  const capPersona = (spr.data?.horas_por_dia || 0) * diasRest;

  const { data, error } = await supabase.from('vw_por_propietario').select('*');
  if (error) {
    console.error('vw_por_propietario', error.message);
    return;
  }
  const host = $('avanceOwners');
  if (!host) return;
  host.innerHTML = '';
  (data || []).forEach((o) => {
    const disponibles = capPersona;
    const ok = disponibles >= o.pendientes;
    const card = document.createElement('div');
    card.className = 'p-4 bg-gray-50 rounded-lg border';
    card.innerHTML = `
      <div class="font-semibold mb-2">${o.propietario}</div>
      <div class="text-sm mb-2">
        Pendientes: <span class="${ok ? 'text-emerald-600' : 'text-rose-600'}">${fmt.num(o.pendientes)}h</span>
        · Disponibles: ${fmt.num(disponibles)}h · ${ok ? 'OK' : 'No alcanza'}
      </div>`;
    host.appendChild(card);
  });
}

// === Control de Subtareas (tabla: búsqueda + paginación) ===
async function loadControlSub() {
  const pageSizeSel = $('pageSize'),
    search = $('searchSub'),
    tbody = $('subBody'),
    count = $('countSub'),
    prev = $('prevSub'),
    next = $('nextSub'),
    pageLbl = $('pageSub');
  if (!pageSizeSel || !search || !tbody || !count || !prev || !next || !pageLbl) return;

  let page = 1,
    total = 0;

  function strip(s) {
    return (s || '').toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  }
  function rowHtml(r) {
    return `<tr class="border-b last:border-0">
      <td class="py-2 pr-4">${r.id_subtarea}</td>
      <td class="py-2 pr-4">${r.titulo || ''}</td>
      <td class="py-2 pr-4">${r.estado || ''}</td>
      <td class="py-2 pr-4">${r.propietario || ''}</td>
      <td class="py-2 pr-4 text-center">${r.terminado_manual ? 'Sí' : 'No'}</td>
      <td class="py-2 pr-4 text-center">${r.visible ? 'Sí' : 'No'}</td>
      <td class="py-2 pr-4">${r.nombre_lista || ''}</td>
    </tr>`;
  }

  async function fetchPage() {
    const limit = parseInt(pageSizeSel.value, 10) || 50,
      from = (page - 1) * limit,
      to = from + limit - 1;
    const qstr = strip(search.value);

    if (qstr) {
      const all = await supabase.from('vw_control_subtareas').select('*');
      const filtered = (all.data || []).filter((r) => strip(Object.values(r).join(' ')).includes(qstr));
      total = filtered.length;
      const slice = filtered.slice(from, to + 1);
      tbody.innerHTML = slice.map((r) => rowHtml(r)).join('');
      const max = Math.max(1, Math.ceil(total / limit));
      pageLbl.textContent = `${page} / ${max}`;
      count.textContent = `${Math.min(total, to + 1)} de ${total}`;
      return;
    }

    const { data, count: c, error } = await supabase.from('vw_control_subtareas').select('*', { count: 'exact' }).order('id_subtarea').range(from, to);
    if (error) {
      console.error('vw_control_subtareas', error.message);
      return;
    }
    total = c || 0;
    tbody.innerHTML = (data || []).map((r) => rowHtml(r)).join('');
    const max = Math.max(1, Math.ceil(total / limit));
    pageLbl.textContent = `${page} / ${max}`;
    count.textContent = `${Math.min(total, to + 1)} de ${total}`;
  }

  search.addEventListener('input', () => {
    page = 1;
    fetchPage();
  });
  pageSizeSel.addEventListener('change', () => {
    page = 1;
    fetchPage();
  });
  prev.addEventListener('click', () => {
    if (page > 1) {
      page--;
      fetchPage();
    }
  });
  next.addEventListener('click', () => {
    const limit = parseInt(pageSizeSel.value, 10) || 50;
    const max = Math.max(1, Math.ceil(total / limit));
    if (page < max) {
      page++;
      fetchPage();
    }
  });

  await fetchPage();
}

// === Registro de Sprint (sin modales) ===
const btnSave = $('f_save');
if (btnSave) {
  btnSave.addEventListener('click', async () => {
    const nombre = $('f_nombre').value.trim();
    const hs = parseFloat($('f_hsprint').value || '0');
    const ini = $('f_inicio').value;
    const fin = $('f_fin').value;
    const hxd = parseFloat($('f_hxd').value || '0');
    $('f_msg') && ($('f_msg').textContent = 'Guardando...');

    const { error } = await supabase.rpc('new_sprint', {
      p_nombre: nombre,
      p_inicio: ini,
      p_fin: fin,
      p_horas_sprint: hs,
      p_horas_por_dia: hxd,
    });
    if (error) {
      $('f_msg') && ($('f_msg').textContent = 'Error: ' + error.message);
      return;
    }

    // Reconstruir burndown y setear "real" del día (corte actual)
    const r1 = await supabase.rpc('reconstruir_burndown_sprint_activo');
    if (r1.error) {
      $('f_msg') && ($('f_msg').textContent = 'Error: ' + r1.error.message);
      return;
    }
    const r2 = await supabase.rpc('actualizar_burndown_con_pendientes', { p_fecha: todayISO() });
    $('f_msg') &&
      ($('f_msg').textContent = r2.error ? 'Sprint creado, pero error en burndown: ' + r2.error.message : 'Sprint registrado y burndown listo.');

    // Refresca dashboard
    await initDashboard();
  });
}

// === Cargas CSV (sin modales) ===
function parseCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, { header: true, skipEmptyLines: true, complete: (res) => resolve(res.data), error: reject });
  });
}

async function importHistorias(file) {
  const rows = await parseCSV(file);
  for (const r of rows) {
    const id = (r.id_tarea_principal || r.id_historia || r['id historia'] || r['id'] || '').toString().trim();
    if (!id) continue;
    const lista = (r.nombre_lista || r.lista || '') + '';
    const hist = (r.nombre_historia || r.historia || r.titulo || '') + '';
    const { error } = await supabase.rpc('upsert_historia', {
      p_id_tarea_principal: id,
      p_nombre_lista: lista,
      p_nombre_historia: hist,
    });
    if (error) console.error('upsert_historia', id, error.message);
  }
}

function normFecha(v) {
  if (!v) return null;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) {
    const [d, m, y] = v.split('/');
    return `${y}-${m}-${d}`;
  }
  return v;
}

async function importSub(file) {
  const rows = await parseCSV(file);
  for (const r of rows) {
    const sid = (r.id_subtarea || r.sub || r['id subtarea'] || r['id'] || '').toString().trim();
    const hid = (r.id_tarea_principal || r.historia || r['id historia'] || '').toString().trim();
    if (!sid || !hid) continue;
    const tit = (r.titulo || r.descripcion || '') + '';
    const est = (r.estado || '') + '';
    const own = (r.propietario || r.owner || '') + '';
    const dur = (r.duracion || r.duracion_txt || r['duración'] || '') + '';
    const f = normFecha((r.fecha_terminacion || r['fecha terminacion'] || r['fecha_terminacion'] || '') + '');

    const { error } = await supabase.rpc('upsert_subtarea', {
      p_id_subtarea: sid,
      p_id_tarea_principal: hid,
      p_titulo: tit,
      p_estado: est,
      p_propietario: own,
      p_duracion_txt: dur,
      p_fecha_terminacion: f,
    });
    if (error) console.error('upsert_subtarea', sid, error.message);
  }
}

// Botones de carga y recálculo
const btnProcess = $('u_process');
if (btnProcess) {
  btnProcess.addEventListener('click', async () => {
    $('u_msg') && ($('u_msg').textContent = 'Procesando CSVs...');
    try {
      const fh = $('fileHistorias')?.files?.[0];
      const fs = $('fileSub')?.files?.[0];
      if (fh) await importHistorias(fh);
      if (fs) await importSub(fs);

      // Reconstruye burndown (mantiene estimación N+1) y escribe real del día (corte actual)
      const r1 = await supabase.rpc('reconstruir_burndown_sprint_activo');
      if (r1.error) throw new Error(r1.error.message);
      const r2 = await supabase.rpc('actualizar_burndown_con_pendientes', { p_fecha: todayISO() });
      if (r2.error) throw new Error(r2.error.message);

      $('u_msg') && ($('u_msg').textContent = 'Importación completada y burndown actualizado.');
      await initDashboard();
    } catch (e) {
      $('u_msg') && ($('u_msg').textContent = 'Error: ' + e.message);
    }
  });
}

const btnRecalcUpload = $('u_recalc');
if (btnRecalcUpload) {
  btnRecalcUpload.addEventListener('click', async () => {
    $('u_msg') && ($('u_msg').textContent = 'Reconstruyendo...');
    const r1 = await supabase.rpc('reconstruir_burndown_sprint_activo');
    if (r1.error) {
      $('u_msg') && ($('u_msg').textContent = 'Error: ' + r1.error.message);
      return;
    }
    const r2 = await supabase.rpc('actualizar_burndown_con_pendientes', { p_fecha: todayISO() });
    $('u_msg') && ($('u_msg').textContent = r2.error ? 'Error: ' + r2.error.message : 'Burndown actualizado.');
    await initDashboard();
  });
}

// === Init ===
async function initDashboard() {
  // Orden: sprint (calcula días), KPIs (usa real del día), burndown, avances, control.
  await loadSprint();
  await loadKpis();
  await loadBurndownChartAndTable();
  await loadPorLista();
  await loadPorHistoria();
  await loadPorPropietario();
  await loadControlSub();
}

initDashboard();
