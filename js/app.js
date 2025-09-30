
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const supabase = createClient('https://peeagzvflrzibavfnqyc.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlZWFnenZmbHJ6aWJhdmZucXljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkxOTc2NTUsImV4cCI6MjA3NDc3MzY1NX0.AmvYrGOlhEkv2QYzrqKdUz_nAD1bKTh8vqVZCNsg100');

const $ = (id) => document.getElementById(id);
const fmt = {
  num: (x) => (x == null ? '—' : new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(x)),
  pct: (x) => (x == null ? '—' : (x * 100).toFixed(0) + '%'),
};

// ---------- Navegación entre vistas ----------
document.querySelectorAll('#sidebarNav .nav-item').forEach(el => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    const view = el.getAttribute('data-view');
    document.querySelectorAll('#sidebarNav .nav-item').forEach(i=>{ i.classList.remove('bg-gray-100','text-gray-900'); i.classList.add('text-gray-700'); });
    el.classList.add('bg-gray-100','text-gray-900');
    ['dashboard','control','sprint','upload'].forEach(v => { $('view-'+v).classList.toggle('hidden', v !== view); });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});

// ---------- Dashboard ----------
async function loadSprint() {
  const { data } = await supabase.from('sprint').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!data) return;
  const s = data;
  $('sprintName').textContent = s.nombre;
  $('sprintDates').textContent = new Date(s.fecha_inicio).toLocaleDateString('es-MX') + ' – ' + new Date(s.fecha_fin).toLocaleDateString('es-MX');
  // Días hábiles restantes: puedes exponer una vista específica si lo deseas; aquí dejamos placeholder.
  $('diasRestantes').textContent = '—';
}

async function loadKpis() {
  const { data } = await supabase.from('vw_kpis').select('*').limit(1).maybeSingle();
  if (!data) return;
  $('kpiTotal').textContent = fmt.num(data.horas_sprint);
  $('kpiPendientes').textContent = fmt.num(data.horas_pendientes);
  $('kpiTerminadas').textContent = fmt.num(data.horas_terminadas);
  $('kpiAvance').textContent = fmt.pct(data.avance);
}

async function loadBurndownChartAndTable() {
  const { data } = await supabase.from('burndown_diario').select('*').order('dia');
  if (!data) return;

  // Chart
  const labels = data.map(r => `Día ${r.dia}`);
  const estimada = data.map(r => r.estimacion);
  const real = data.map(r => r.real);
  const completadas = data.map((r,i) => (i===0?0:Math.max(0, (real[i-1] ?? real[i]) - (real[i] ?? real[i-1]))));
  const ctx = document.getElementById('burndownChart').getContext('2d');
  if (window.__bdChart) window.__bdChart.destroy();
  window.__bdChart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        { type:'bar', label:'Completadas (h)', data: completadas, borderWidth:1 },
        { type:'line', label:'Estimación', data: estimada, tension:0.25, borderWidth:2, pointRadius:2 },
        { type:'line', label:'Real', data: real, tension:0.25, borderWidth:2, pointRadius:2 },
      ]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{position:'bottom'}, tooltip:{mode:'index', intersect:false} }, interaction:{mode:'index', intersect:false}, scales:{ y:{ beginAtZero:true } } }
  });

  // Table
  const tbody = $('bdBody'); const fmtDate = (d) => new Date(d).toLocaleDateString('es-MX');
  tbody.innerHTML = data.map(r => `
    <tr class="border-b last:border-0">
      <td class="py-2 pr-4">${r.dia}</td>
      <td class="py-2 pr-4">${fmtDate(r.fecha)}</td>
      <td class="py-2 pr-4">${fmt.num(r.estimacion)}</td>
      <td class="py-2 pr-4">
        <input data-fecha="${r.fecha}" value="${r.real ?? ''}" class="bd-real w-32 px-2 py-1 rounded border" placeholder="—" />
      </td>
      <td class="py-2 pr-4">
        <label class="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" class="bd-manual" data-fecha="${r.fecha}" ${r.manual_edit ? 'checked':''} />
          Manual
        </label>
      </td>
    </tr>
  `).join('');

  // Wire inputs
  tbody.querySelectorAll('.bd-real').forEach(inp => {
    inp.addEventListener('change', async () => {
      const fecha = inp.getAttribute('data-fecha');
      const val = parseFloat(inp.value||'0');
      $('bdMsg').textContent = 'Guardando...';
      const { error } = await supabase.rpc('set_burndown_manual', { p_fecha: fecha, p_real: val });
      $('bdMsg').textContent = error ? ('Error: '+error.message) : 'Guardado.';
      await loadKpis();
      await loadBurndownChartAndTable();
    });
  });
  
  tbody.querySelectorAll('.bd-manual').forEach(chk => {
    chk.addEventListener('change', async () => {
      const fecha = chk.getAttribute('data-fecha');
      $('bdMsg').textContent = 'Actualizando...';
      let error = null;
      if (chk.checked) {
        const inputEl = tbody.querySelector(`input.bd-real[data-fecha="${fecha}"]`);
        const val = parseFloat((inputEl && inputEl.value) ? inputEl.value : '0');
        const resp = await supabase.rpc('set_burndown_manual', { p_fecha: fecha, p_real: val });
        error = resp.error;
      } else {
        const resp = await supabase.rpc('unset_burndown_manual', { p_fecha: fecha });
        error = resp.error;
      }
      $('bdMsg').textContent = error ? ('Error: ' + error.message) : 'Listo.';
      await loadKpis();
      await loadBurndownChartAndTable();
    });
  });

  // Recalcular

  $('btnRecalc').onclick = async () => {
    $('bdMsg').textContent = 'Reconstruyendo...';
    const { error } = await supabase.rpc('reconstruir_burndown_sprint_activo');
    $('bdMsg').textContent = error ? ('Error: '+error.message) : 'Burndown reconstruido.';
    await loadKpis();
    await loadBurndownChartAndTable();
  };
})

async function loadPorLista() {
  const { data } = await supabase.from('vw_por_lista').select('*');
  const host = $('avanceListas'); host.innerHTML='';
  (data||[]).forEach(l => {
    const pct = l.asignadas>0 ? (l.terminadas/l.asignadas) : 0;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="flex items-center justify-between mb-1">
        <span class="font-medium">${l.lista}</span>
        <span class="text-sm text-gray-600">${fmt.pct(pct)}</span>
      </div>
      <div class="w-full bg-gray-200 rounded-full h-2">
        <div class="h-2 rounded-full ${pct>0.6?'bg-emerald-500':pct>0.4?'bg-amber-500':'bg-blue-500'}" style="width:${(pct*100).toFixed(0)}%"></div>
      </div>`;
    host.appendChild(wrap);
  });
}

async function loadPorHistoria() {
  const { data } = await supabase.from('vw_por_historia').select('*');
  const host = $('avanceHU'); host.innerHTML='';
  (data||[]).forEach(h => {
    const pct = h.totales>0 ? (h.terminadas/h.totales) : 0;
    const pill = pct>=0.8 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : (pct>=0.5 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200');
    const row = document.createElement('div');
    row.className = 'p-3 rounded-lg border flex items-start justify-between';
    row.innerHTML = `<div><div class="font-medium">${h.id_historia} · ${h.historia}</div><div class="text-xs text-gray-500">Lista: ${h.lista}</div></div><div class="text-sm"><span class="px-2 py-1 rounded-full border ${pill}">${fmt.pct(pct)} <span class="text-gray-500">(${fmt.num(h.totales)}h totales · ${fmt.num(h.abiertas)}h abiertas)</span></span></div>`;
    host.appendChild(row);
  });
}

async function loadPorPropietario() {
  const spr = await supabase.from('sprint').select('horas_por_dia').order('created_at', { ascending:false }).limit(1).maybeSingle();
  const diasRest = ($('diasRestantes').textContent==='—') ? 0 : parseInt($('diasRestantes').textContent,10);
  const capPersona = (spr.data?.horas_por_dia || 0) * diasRest;
  const { data } = await supabase.from('vw_por_propietario').select('*');
  const host = $('avanceOwners'); host.innerHTML='';
  (data||[]).forEach(o => {
    const disponibles = capPersona;
    const ok = disponibles >= o.pendientes;
    const card = document.createElement('div');
    card.className = "p-4 bg-gray-50 rounded-lg border";
    card.innerHTML = `<div class="font-semibold mb-2">${o.propietario}</div><div class="text-sm mb-2">Pendientes: <span class="${ok?'text-emerald-600':'text-rose-600'}">${fmt.num(o.pendientes)}h</span> · Disponibles: ${fmt.num(disponibles)}h · ${ok?'OK':'No alcanza'}</div>`;
    host.appendChild(card);
  });
}

// ---------- Control de subtareas ----------
async function loadControlSub() {
  const pageSizeSel = $('pageSize'), search = $('searchSub'), tbody = $('subBody'), count = $('countSub'), prev=$('prevSub'), next=$('nextSub'), pageLbl=$('pageSub');
  let page=1, total=0;
  function strip(s){ return (s||'').toString().normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase(); }
  function rowHtml(r){
    return `<tr class="border-b last:border-0"><td class="py-2 pr-4">${r.id_subtarea}</td><td class="py-2 pr-4">${r.titulo||''}</td><td class="py-2 pr-4">${r.estado||''}</td><td class="py-2 pr-4">${r.propietario||''}</td><td class="py-2 pr-4 text-center">${r.terminado_manual?'Sí':'No'}</td><td class="py-2 pr-4 text-center">${r.visible?'Sí':'No'}</td><td class="py-2 pr-4">${r.nombre_lista||''}</td></tr>`;
  }
  async function fetchPage(){
    const limit = parseInt(pageSizeSel.value,10)||50, from=(page-1)*limit, to=from+limit-1;
    const qstr = strip(search.value);
    if (qstr) {
      const all = await supabase.from('vw_control_subtareas').select('*');
      const filtered = (all.data||[]).filter(r => strip(Object.values(r).join(' ')).includes(qstr));
      total = filtered.length; const slice = filtered.slice(from,to+1);
      tbody.innerHTML = slice.map(r => rowHtml(r)).join('');
      pageLbl.textContent = `${page} / ${Math.max(1, Math.ceil(total/limit))}`; count.textContent = `${Math.min(total,to+1)} de ${total}`;
      return;
    }
    const { data, count: c } = await supabase.from('vw_control_subtareas').select('*', { count:'exact' }).order('id_subtarea').range(from,to);
    total = c||0; tbody.innerHTML = (data||[]).map(r => rowHtml(r)).join('');
    pageLbl.textContent = `${page} / ${Math.max(1, Math.ceil(total/limit))}`; count.textContent = `${Math.min(total,to+1)} de ${total}`;
  }
  search.addEventListener('input', ()=>{page=1;fetchPage();});
  pageSizeSel.addEventListener('change', ()=>{page=1;fetchPage();});
  $('prevSub').addEventListener('click', ()=>{ if(page>1){page--;fetchPage();} });
  $('nextSub').addEventListener('click', ()=>{ const limit=parseInt(pageSizeSel.value,10)||50; const max=Math.max(1,Math.ceil(total/limit)); if(page<max){page++;fetchPage();} });
  await fetchPage();
}

// ---------- Registrar Sprint (sin modales) ----------
$('f_save').addEventListener('click', async () => {
  const nombre = $('f_nombre').value.trim();
  const horas_sprint = parseFloat($('f_hsprint').value||'0');
  const inicio = $('f_inicio').value;
  const fin = $('f_fin').value;
  const hxd = parseFloat($('f_hxd').value||'0');
  $('f_msg').textContent = 'Guardando...';
  const { error } = await supabase.rpc('new_sprint', {
    p_nombre: nombre, p_inicio: inicio, p_fin: fin, p_horas_sprint: horas_sprint, p_horas_por_dia: hxd
  });
  if (error) { $('f_msg').textContent = 'Error: ' + error.message; return; }
  $('f_msg').textContent = 'Sprint registrado. (Se borró info previa)';
  // reconstruye tabla de burndown vacía para el nuevo sprint
  await supabase.rpc('reconstruir_burndown_sprint_activo');
  await initDashboard();
});

// ---------- Cargas CSV (sin modales) ----------
function parseCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, { header: true, skipEmptyLines: true, complete: (res) => resolve(res.data), error: reject });
  });
}

async function importHistorias(file) {
  const rows = await parseCSV(file);
  for (const r of rows) {
    const id_tarea_principal = (r.id_tarea_principal || r.id_historia || r['id historia'] || r['id'])?.toString().trim();
    if (!id_tarea_principal) continue;
    const nombre_lista = (r.nombre_lista || r.lista || '')?.toString();
    const nombre_historia = (r.nombre_historia || r.historia || r.titulo || '')?.toString();
    const { error } = await supabase.rpc('upsert_historia', { p_id_tarea_principal: id_tarea_principal, p_nombre_lista: nombre_lista, p_nombre_historia: nombre_historia });
    if (error) console.error('historia', id_tarea_principal, error.message);
  }
}

function normFecha(v) {
  if (!v) return null;
  if (/\d{2}\/\d{2}\/\d{4}/.test(v)) { const [d,m,y]=v.split('/'); return `${y}-${m}-${d}`; }
  return v;
}

async function importSub(file) {
  const rows = await parseCSV(file);
  for (const r of rows) {
    const p_id_subtarea = (r.id_subtarea || r.sub || r['id subtarea'] || r['id'])?.toString().trim();
    const p_id_tarea_principal = (r.id_tarea_principal || r.historia || r['id historia'])?.toString().trim();
    if (!p_id_subtarea || !p_id_tarea_principal) continue;
    const p_titulo = (r.titulo || r.descripcion || '')?.toString();
    const p_estado = (r.estado || '')?.toString();
    const p_propietario = (r.propietario || r.owner || '')?.toString();
    const p_duracion_txt = (r.duracion || r.duracion_txt || r['duración'] || '')?.toString();
    const p_fecha_terminacion = normFecha((r.fecha_terminacion || r['fecha terminacion'] || r['fecha_terminacion'] || '')?.toString());
    const { error } = await supabase.rpc('upsert_subtarea', { p_id_subtarea, p_id_tarea_principal, p_titulo, p_estado, p_propietario, p_duracion_txt, p_fecha_terminacion });
    if (error) console.error('subtarea', p_id_subtarea, error.message);
  }
}

$('u_process').addEventListener('click', async () => {
  $('u_msg').textContent = 'Procesando CSVs...';
  try {
    const fh = $('fileHistorias').files[0];
    const fs = $('fileSub').files[0];
    if (fh) await importHistorias(fh);
    if (fs) await importSub(fs);
    // reconstruir burndown una sola vez al final
    await supabase.rpc('reconstruir_burndown_sprint_activo');
    $('u_msg').textContent = 'Importación completada y burndown actualizado.';
    await initDashboard();
  } catch (e) {
    $('u_msg').textContent = 'Error: ' + e.message;
  }
});

$('u_recalc').addEventListener('click', async () => {
  $('u_msg').textContent = 'Reconstruyendo...';
  const { error } = await supabase.rpc('reconstruir_burndown_sprint_activo');
  $('u_msg').textContent = error ? ('Error: '+error.message) : 'Burndown actualizado.';
  await initDashboard();
});

// ---------- Init dashboard ----------
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
