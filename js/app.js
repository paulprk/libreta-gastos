import * as storage from './storage.js';
import * as cloud from './cloud.js';

const TZ = 'America/Argentina/Buenos_Aires';
let CATS = {
  gasto: ['Comida', 'Supermercado', 'Transporte', 'Servicios', 'Alquiler', 'Salud', 'Educación', 'Salidas', 'Ropa', 'Varios'],
  ingreso: ['Sueldo', 'Ventas', 'Transferencia', 'Cambio', 'Varios']
};
let CAT_COLORS = ['#E4572E', '#F3A712', '#2E86AB', '#7B61FF', '#A23B72', '#17A398', '#F25F5C', '#3D5A80', '#8D6A9F', '#8A94A6'];

let kind = 'gasto';
let cat = null;
let items = [];
let viewMonth = null;
let $ = function (id) { return document.getElementById(id); };

let partsFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function baParts(ts) {
  let o = {};
  partsFmt.formatToParts(new Date(ts)).forEach(function (p) { o[p.type] = p.value; });
  return o;
}
function monthKey(ts) { let p = baParts(ts); return p.year + '-' + p.month; }
function dayKey(ts) { let p = baParts(ts); return p.year + '-' + p.month + '-' + p.day; }
function timeTxt(ts) { let p = baParts(ts); return p.hour + ':' + p.minute; }
let dayFmt = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
let clockFmt = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function money(n) { return '$ ' + n.toLocaleString('es-AR', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function monthLabel(key) {
  let y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7));
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function shiftMonth(key, d) {
  let y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7)) - 1 + d;
  y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
  return y + '-' + String(m + 1).padStart(2, '0');
}

function tick() { $('clock').textContent = 'Hora de Buenos Aires: ' + clockFmt.format(new Date()); }
tick(); setInterval(tick, 30000);
viewMonth = monthKey(Date.now());

// --- Formulario ---
function renderCats() {
  let box = $('cats');
  box.innerHTML = '';
  CATS[kind].forEach(function (c) {
    let b = document.createElement('button');
    b.type = 'button';
    b.className = 'cat';
    b.textContent = c;
    b.setAttribute('aria-pressed', String(cat === c));
    b.addEventListener('click', function () { cat = cat === c ? null : c; renderCats(); });
    box.appendChild(b);
  });
}
function setKind(k) {
  kind = k; cat = null;
  $('kGasto').setAttribute('aria-pressed', String(k === 'gasto'));
  $('kIngreso').setAttribute('aria-pressed', String(k === 'ingreso'));
  $('form').className = 'card form-' + k;
  $('add').textContent = k === 'gasto' ? 'Agregar gasto' : 'Agregar ingreso';
  $('catsLabel').textContent = k === 'gasto' ? 'Tipo de gasto (si no elegís, va a Varios)' : 'Tipo de ingreso (si no elegís, va a Varios)';
  renderCats();
}
// Enfocar el monto dentro del mismo toque: así el celular abre el teclado numérico solo.
$('kGasto').addEventListener('click', function () { setKind('gasto'); $('monto').focus(); });
$('kIngreso').addEventListener('click', function () { setKind('ingreso'); $('monto').focus(); });

function parseAmount(s) {
  s = String(s).trim().replace(/\s|\$/g, '');
  if (!s) return NaN;
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  let n = Number(s);
  return n > 0 && isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

let undoTimer = null;
let undoState = null;
function hideUndo() {
  $('undoBar').hidden = true;
  undoState = null;
  clearTimeout(undoTimer);
}
function showUndo(text, label) {
  clearTimeout(undoTimer);
  $('undoText').textContent = text;
  $('undoBtn').textContent = label;
  $('undoBar').hidden = false;
  undoTimer = setTimeout(hideUndo, 15000);
}
// undo y redo devuelven una promesa con el texto a mostrar; se puede alternar entre los dos.
function offerUndo(text, undo, redo) {
  undoState = { undo: undo, redo: redo, next: 'undo' };
  showUndo(text, 'Deshacer');
}
let undoBusy = false;
$('undoBtn').addEventListener('click', function () {
  if (!undoState || undoBusy) return;
  const st = undoState;
  undoBusy = true;
  st[st.next]().then(function (done) {
    changed();
    st.next = st.next === 'undo' ? 'redo' : 'undo';
    showUndo(done, st.next === 'undo' ? 'Deshacer' : 'Rehacer');
  }).finally(function () { undoBusy = false; });
});
$('undoClose').addEventListener('click', hideUndo);

let msgTimer = null;
function say(t, err) {
  let m = $('msg');
  m.textContent = t;
  m.className = 'msg' + (err ? ' err' : '');
  clearTimeout(msgTimer);
  if (!err) msgTimer = setTimeout(function () { m.textContent = ''; }, 4000);
}

let saving = false;
function add() {
  if (saving) return;
  let n = parseAmount($('monto').value);
  if (isNaN(n)) { say('Escribí un monto mayor a 0 (por ejemplo 2500).', true); $('monto').focus(); return; }
  const typed = $('monto').value;
  const nota = $('nota').value.trim();
  $('monto').value = '';
  $('monto').focus();
  saving = true; $('add').disabled = true;
  storage.add({ tipo: kind, monto: n, categoria: cat || 'Varios', nota: nota }).then(function (item) {
    viewMonth = monthKey(item.ts);
    changed();
    say('');
    offerUndo((item.tipo === 'gasto' ? 'Gasto' : 'Ingreso') + ' de ' + money(item.monto) + ' guardado en ' + item.categoria + '.', function () {
      return storage.remove(item.id).then(function () { return 'Se quitó el ' + (item.tipo === 'gasto' ? 'gasto' : 'ingreso') + ' de ' + money(item.monto) + '.'; });
    }, function () {
      return storage.restore(item).then(function () { viewMonth = monthKey(item.ts); return 'Se volvió a guardar el ' + (item.tipo === 'gasto' ? 'gasto' : 'ingreso') + ' de ' + money(item.monto) + '.'; });
    });
    $('nota').value = ''; cat = null; renderCats();
  }, function () {
    if (!$('monto').value) $('monto').value = typed;
    say('No se pudo guardar: el dispositivo no tiene espacio. Descargá una copia de seguridad y liberá espacio.', true);
  }).then(function () { saving = false; $('add').disabled = false; });
}
$('add').addEventListener('click', add);
$('monto').addEventListener('keydown', function (e) { if (e.key === 'Enter') add(); });

// Puntos de miles mientras se escribe (600000 → 600.000) y coma para los centavos.
function formatAmountText(raw) {
  let s = String(raw).replace(/[^\d,]/g, '');
  const comma = s.indexOf(',');
  let int = comma >= 0 ? s.slice(0, comma) : s;
  let dec = comma >= 0 ? s.slice(comma + 1).replace(/,/g, '').slice(0, 2) : null;
  int = int.replace(/^0+(?=\d)/, '');
  if (int === '' && dec !== null) int = '0';
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return dec === null ? int : int + ',' + dec;
}
$('monto').addEventListener('beforeinput', function (e) {
  if (e.inputType === 'insertText' && e.data === '.') {
    e.preventDefault();
    const el = e.target;
    if (el.value.indexOf(',') >= 0) return;
    const pos = el.selectionStart ?? el.value.length;
    el.value = el.value.slice(0, pos) + ',' + el.value.slice(el.selectionEnd ?? pos);
    el.setSelectionRange(pos + 1, pos + 1);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
$('monto').addEventListener('input', function (e) {
  const el = e.target;
  const before = el.value;
  const caret = el.selectionStart ?? before.length;
  const keep = before.slice(0, caret).replace(/[^\d,]/g, '').length;
  const after = formatAmountText(before);
  if (after === before) return;
  el.value = after;
  let pos = 0, seen = 0;
  while (pos < after.length && seen < keep) {
    if (/[\d,]/.test(after[pos])) seen++;
    pos++;
  }
  try { el.setSelectionRange(pos, pos); } catch (err) { /* algunos navegadores no lo permiten */ }
});
$('nota').addEventListener('keydown', function (e) { if (e.key === 'Enter') add(); });

// --- Resumen, lista y gráficos ---
$('prev').addEventListener('click', function () { viewMonth = shiftMonth(viewMonth, -1); render(); });
$('next').addEventListener('click', function () { viewMonth = shiftMonth(viewMonth, 1); render(); });

function render() {
  let nowMonth = monthKey(Date.now());
  $('monthName').textContent = cap(monthLabel(viewMonth));
  $('next').disabled = viewMonth >= nowMonth;
  let month = items.filter(function (it) { return monthKey(it.ts) === viewMonth; }).sort(function (a, b) { return b.ts - a.ts; });
  let tin = 0, tout = 0;
  month.forEach(function (it) { if (it.tipo === 'ingreso') tin += it.monto; else tout += it.monto; });
  $('tIn').textContent = money(tin);
  $('tOut').textContent = money(tout);
  let bal = tin - tout;
  $('tBal').textContent = (bal < 0 ? '− ' : '') + money(Math.abs(bal));
  $('tBal').style.color = bal < 0 ? 'var(--red)' : bal > 0 ? 'var(--green)' : '';
  renderList(month);
  renderPies(month, tin, tout);
}

let pendingDel = null;
function renderList(month) {
  let list = $('list');
  list.innerHTML = '';
  if (!month.length) {
    let e = document.createElement('p');
    e.className = 'empty';
    e.textContent = 'No hay movimientos en ' + monthLabel(viewMonth) + '.';
    list.appendChild(e);
    return;
  }
  let groups = {};
  let order = [];
  month.forEach(function (it) { let k = dayKey(it.ts); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(it); });
  order.forEach(function (k) {
    let day = document.createElement('div');
    day.className = 'day';
    let h = document.createElement('div');
    h.className = 'day-h';
    let net = groups[k].reduce(function (s, it) { return s + (it.tipo === 'ingreso' ? it.monto : -it.monto); }, 0);
    let a = document.createElement('span'); a.textContent = cap(dayFmt.format(new Date(groups[k][0].ts)));
    let b = document.createElement('span'); b.className = 'num'; b.textContent = (net < 0 ? '− ' : '+ ') + money(Math.abs(net));
    h.append(a, b);
    day.appendChild(h);
    groups[k].forEach(function (it) {
      let row = document.createElement('div');
      row.className = 'row ' + it.tipo;
      let bar = document.createElement('span'); bar.className = 'bar';
      let info = document.createElement('div'); info.className = 'info';
      let c = document.createElement('span'); c.className = 'c'; c.textContent = it.categoria;
      let t = document.createElement('span'); t.className = 't'; t.textContent = timeTxt(it.ts) + ' hs' + (it.nota ? ' · ' + it.nota : '');
      info.append(c, t);
      let amt = document.createElement('span'); amt.className = 'amt num'; amt.textContent = (it.tipo === 'gasto' ? '− ' : '+ ') + money(it.monto);
      let del = document.createElement('button'); del.type = 'button'; del.className = 'del';
      let confirming = pendingDel === it.id;
      del.textContent = confirming ? '¿Borrar?' : 'Borrar';
      if (confirming) del.classList.add('confirm');
      del.setAttribute('aria-label', confirming ? 'Confirmar borrar este movimiento' : 'Borrar movimiento de ' + money(it.monto));
      del.addEventListener('click', function () {
        if (pendingDel !== it.id) { pendingDel = it.id; render(); setTimeout(function () { if (pendingDel === it.id) { pendingDel = null; render(); } }, 4000); return; }
        pendingDel = null;
        storage.remove(it.id).then(function () {
          changed();
          offerUndo('Borraste ' + (it.tipo === 'gasto' ? 'un gasto' : 'un ingreso') + ' de ' + money(it.monto) + '.', function () {
            return storage.restore(it).then(function () { viewMonth = monthKey(it.ts); return 'Se recuperó el movimiento de ' + money(it.monto) + '.'; });
          }, function () {
            return storage.remove(it.id).then(function () { return 'Se volvió a borrar el movimiento de ' + money(it.monto) + '.'; });
          });
        });
      });
      let cl = document.createElement('span'); cl.className = 'cloud';
      if (cloud.status().email) {
        cl.textContent = it.synced ? '✓' : '⏳';
        if (it.synced) cl.classList.add('ok');
        cl.title = it.synced ? 'Guardado en la nube' : 'Guardado en el teléfono; se sube a la nube cuando haya conexión';
        cl.setAttribute('aria-label', cl.title);
      }
      row.append(bar, info, amt, cl, del);
      day.appendChild(row);
    });
    list.appendChild(day);
  });
}

function pie(host, legend, slices) {
  host.innerHTML = '';
  legend.innerHTML = '';
  let total = slices.reduce(function (s, x) { return s + x.value; }, 0);
  let ns = 'http://www.w3.org/2000/svg';
  let svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 200 200');
  svg.setAttribute('role', 'img');
  if (!total) {
    let c0 = document.createElementNS(ns, 'circle');
    c0.setAttribute('cx', 100); c0.setAttribute('cy', 100); c0.setAttribute('r', 90);
    c0.setAttribute('fill', 'none'); c0.setAttribute('stroke', 'var(--line)'); c0.setAttribute('stroke-width', 2);
    svg.appendChild(c0);
    let tx = document.createElementNS(ns, 'text');
    tx.setAttribute('x', 100); tx.setAttribute('y', 105); tx.setAttribute('text-anchor', 'middle');
    tx.setAttribute('fill', 'var(--soft)'); tx.setAttribute('font-size', 14);
    tx.textContent = 'Sin datos';
    svg.appendChild(tx);
    svg.setAttribute('aria-label', 'Sin datos este mes');
    host.appendChild(svg);
    return;
  }
  let a0 = -Math.PI / 2;
  let shown = slices.filter(function (s) { return s.value > 0; });
  shown.forEach(function (s) {
    let frac = s.value / total;
    if (frac >= 0.9999) {
      let c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', 100); c.setAttribute('cy', 100); c.setAttribute('r', 90); c.setAttribute('fill', s.color);
      svg.appendChild(c);
    } else {
      let a1 = a0 + frac * Math.PI * 2;
      let p = document.createElementNS(ns, 'path');
      let x0 = 100 + 90 * Math.cos(a0), y0 = 100 + 90 * Math.sin(a0), x1 = 100 + 90 * Math.cos(a1), y1 = 100 + 90 * Math.sin(a1);
      p.setAttribute('d', 'M100,100 L' + x0 + ',' + y0 + ' A90,90 0 ' + (frac > 0.5 ? 1 : 0) + ',1 ' + x1 + ',' + y1 + ' Z');
      p.setAttribute('fill', s.color);
      p.setAttribute('stroke', 'var(--surface)');
      p.setAttribute('stroke-width', 2);
      svg.appendChild(p);
      a0 = a1;
    }
  });
  let hole = document.createElementNS(ns, 'circle');
  hole.setAttribute('cx', 100); hole.setAttribute('cy', 100); hole.setAttribute('r', 48); hole.setAttribute('fill', 'var(--surface)');
  svg.appendChild(hole);
  svg.setAttribute('aria-label', shown.map(function (s) { return s.label + ' ' + Math.round(s.value / total * 100) + '%'; }).join(', '));
  host.appendChild(svg);
  shown.forEach(function (s) {
    let r = document.createElement('div'); r.className = 'leg';
    let sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = s.color;
    let l = document.createElement('span'); l.textContent = s.label;
    let v = document.createElement('span'); v.className = 'num'; v.textContent = money(s.value);
    let pc = document.createElement('span'); pc.className = 'p num'; pc.textContent = Math.round(s.value / total * 100) + '%';
    r.append(sw, l, v, pc);
    legend.appendChild(r);
  });
}

function renderPies(month, tin, tout) {
  let css = getComputedStyle(document.documentElement);
  pie($('pie1'), $('leg1'), [
    { label: 'Ingresos', value: tin, color: css.getPropertyValue('--green').trim() },
    { label: 'Gastos', value: tout, color: css.getPropertyValue('--red').trim() }
  ]);
  let byCat = {};
  month.forEach(function (it) { if (it.tipo === 'gasto') byCat[it.categoria] = (byCat[it.categoria] || 0) + it.monto; });
  let slices = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; }).map(function (k) {
    let i = CATS.gasto.indexOf(k);
    return { label: k, value: byCat[k], color: CAT_COLORS[i >= 0 ? i : CAT_COLORS.length - 1] };
  });
  pie($('pie2'), $('leg2'), slices);
}

window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);

setKind('gasto');
render();

// Después de cualquier cambio: redibujar y pedir subirlo a la nube.
function changed() {
  items = storage.all();
  render();
  refreshSafety();
  cloud.requestSync();
}

// --- Nube: estado y cuenta ---
let pendingEmail = '';
function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'recién';
  const m = Math.round(s / 60);
  if (m < 60) return 'hace ' + m + ' min';
  const h = Math.round(m / 60);
  return 'hace ' + h + ' h';
}
function renderCloud() {
  const st = cloud.status();
  const chip = $('sync');
  const local = storage.isPersisted() ? 'Guardado en este teléfono' : 'Guardado en este navegador';
  let text = local, cls = 'sync';
  if (st.email) {
    if (st.state === 'offline') { text = st.pending ? 'Sin señal · ' + st.pending + ' por subir (guardado en el teléfono)' : 'Sin señal · todo guardado'; cls += ' wait'; }
    else if (st.state === 'error') { text = 'No se pudo subir · ' + st.pending + ' guardado en el teléfono'; cls += ' err'; }
    else if (st.pending) { text = '⏳ Subiendo ' + st.pending + '…'; cls += ' wait'; }
    else { text = '☁ Todo en la nube'; cls += ' ok'; }
  }
  chip.textContent = text;
  chip.className = cls;

  $('acctOff').hidden = st.state !== 'off';
  $('acctIn').hidden = !st.email;
  $('acctLogin').hidden = st.state === 'off' || Boolean(st.email);
  if (st.email) {
    $('acctInfo').textContent = 'Conectado como ' + st.email + '. '
      + (st.pending ? st.pending + ' cambio' + (st.pending === 1 ? '' : 's') + ' esperando subirse. ' : 'Todo está en la nube. ')
      + (st.lastSync ? 'Última sincronización: ' + ago(st.lastSync) + '.' : '');
  }
}
function acctMsg(t, err) {
  const m = $('acctMsg');
  m.textContent = t;
  m.className = 'msg' + (err ? ' err' : '');
}
$('acctLogin').addEventListener('submit', function (e) {
  e.preventDefault();
  const email = $('email').value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { acctMsg('Escribí un email válido.', true); return; }
  $('sendCodeBtn').disabled = true;
  acctMsg('Enviando el código…');
  cloud.sendCode(email).then(function () {
    pendingEmail = email;
    $('stepEmail').hidden = true;
    $('stepCode').hidden = false;
    $('code').focus();
    acctMsg('Te mandamos un código a ' + email + '. Escribilo acá (revisá también spam).');
  }, function (err) {
    const code = (err && err.code) || '';
    const text = String((err && err.message) || '');
    let m;
    if (code === 'over_email_send_rate_limit' || /rate limit|seconds/i.test(text)) m = 'Se pidieron demasiados códigos. Esperá un rato (hasta una hora) y probá de nuevo.';
    else if (code === 'email_address_not_authorized' || /not authorized/i.test(text)) m = 'El servidor de emails todavía no puede enviar a esta dirección. Hay que configurar el envío de emails (SMTP) en Supabase.';
    else if (code === 'validation_failed') m = 'Ese email no es válido. Revisalo.';
    else if (!navigator.onLine) m = 'No hay conexión. Probá cuando tengas señal.';
    else m = 'No se pudo enviar el código (' + (code || text || 'error desconocido') + ').';
    acctMsg(m, true);
  }).finally(function () { $('sendCodeBtn').disabled = false; });
});
$('verifyBtn').addEventListener('click', function () {
  const code = $('code').value.replace(/\D/g, '');
  if (code.length < 6) { acctMsg('El código tiene al menos 6 números.', true); return; }
  $('verifyBtn').disabled = true;
  cloud.verifyCode(pendingEmail, code).then(function () {
    acctMsg('¡Listo! Tus datos se están subiendo a la nube.');
    $('stepEmail').hidden = false; $('stepCode').hidden = true; $('code').value = '';
  }, function () {
    acctMsg('El código no es correcto o venció. Pedí uno nuevo.', true);
  }).finally(function () { $('verifyBtn').disabled = false; });
});
$('code').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('verifyBtn').click(); } });
$('changeEmail').addEventListener('click', function () { $('stepEmail').hidden = false; $('stepCode').hidden = true; acctMsg(''); $('email').focus(); });
$('syncBtn').addEventListener('click', function () { cloud.syncNow(); acctMsg('Sincronizando…'); setTimeout(function () { acctMsg(''); }, 2500); });
$('logoutBtn').addEventListener('click', function () {
  const p = cloud.status().pending;
  if (p && $('logoutBtn').dataset.confirm !== '1') {
    $('logoutBtn').dataset.confirm = '1';
    $('logoutBtn').textContent = '¿Cerrar igual? Hay ' + p + ' sin subir';
    setTimeout(function () { $('logoutBtn').dataset.confirm = ''; $('logoutBtn').textContent = 'Cerrar sesión'; }, 5000);
    return;
  }
  $('logoutBtn').dataset.confirm = ''; $('logoutBtn').textContent = 'Cerrar sesión';
  cloud.signOut().then(function () { acctMsg('Sesión cerrada. Tus datos siguen guardados en este teléfono.'); });
});

// --- Tus datos: estado, instalación y copias de seguridad ---
const DAY = 86400000;
function safeMsg(t, err) {
  const m = $('safeMsg');
  m.textContent = t;
  m.className = 'msg' + (err ? ' err' : '');
}

function refreshSafety() {
  renderCloud();
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const tip = $('installTip');
  if (!standalone) {
    tip.hidden = false;
    tip.innerHTML = ios
      ? '<b>Consejo:</b> instalala en el iPhone para que Safari nunca borre tus datos: tocá Compartir <b>⎋</b> y después <b>Agregar a pantalla de inicio</b>.'
      : '<b>Consejo:</b> instalala como app (menú del navegador → <b>Instalar</b> o <b>Agregar a pantalla de inicio</b>) para que tus datos queden protegidos.';
  } else {
    tip.hidden = true;
  }
  const last = storage.lastBackup();
  const warn = $('backupWarn');
  const count = items.length;
  if (!cloud.status().email && count >= 5 && (!last || Date.now() - last > 30 * DAY)) {
    warn.hidden = false;
    warn.textContent = last
      ? 'Hace más de 30 días que no descargás una copia de seguridad. Si perdés o reseteás el teléfono, sin copia se pierden los datos.'
      : 'Todavía no descargaste ninguna copia de seguridad. Te conviene tener una por si perdés o reseteás el teléfono.';
  } else {
    warn.hidden = true;
  }
  $('safeStatus').textContent = 'Todo se guarda automáticamente en este dispositivo apenas lo agregás (' + count + ' movimiento' + (count === 1 ? '' : 's') + ').'
    + (last ? ' Última copia de seguridad: ' + new Date(last).toLocaleDateString('es-AR', { timeZone: TZ }) + '.' : '');
}

$('exportBtn').addEventListener('click', function () {
  const blob = new Blob([storage.exportJson()], { type: 'application/json' });
  const p = baParts(Date.now());
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'libreta-gastos-' + p.year + '-' + p.month + '-' + p.day + '.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  safeMsg('Copia descargada. Guardala en un lugar seguro (por ejemplo, en Archivos o en Drive).');
  refreshSafety();
});
$('importBtn').addEventListener('click', function () { $('importFile').click(); });
$('importFile').addEventListener('change', function (e) {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  f.text().then(function (t) { return storage.importJson(t); }).then(function (n) {
    changed();
    safeMsg(n ? 'Se recuperaron ' + n + ' movimiento' + (n === 1 ? '' : 's') + '. Lo que ya tenías no se tocó.' : 'La copia no tenía movimientos nuevos: ya estaban todos.');
  }, function () {
    safeMsg('Ese archivo no es una copia de seguridad de la libreta.', true);
  });
});

if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) $('monto').focus();

storage.load().then(function (list) {
  items = list;
  render();
  refreshSafety();
  cloud.init({ onChange: function () { items = storage.all(); render(); refreshSafety(); }, onStatus: function () { renderCloud(); render(); } });
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(function () {});
}
