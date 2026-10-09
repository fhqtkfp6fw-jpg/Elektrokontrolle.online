'use strict';
/* ============================================================
   Mängelbehebung – Elektrokontrolle online (Etappe L)

   Ohne Anmeldung: der Zugangscode steht im Link hinter dem «#»
   (…/behebung/#k=…). Dieser Teil der Adresse geht nie an einen Server.
   Die App spricht ausschliesslich mit der Edge Function «behebung» –
   die prüft den Code bei jedem Schritt und entscheidet, was erlaubt ist.

   Alles wird SOFORT auf dem Server gespeichert (Text kurz verzögert,
   Status und Fotos sofort). Wer den Link auf einem anderen Gerät öffnet,
   sieht denselben Stand. Ohne Verbindung sind die Eingaben gesperrt.
   ============================================================ */

const FN_URL = String(SUPABASE_URL).trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '') + '/functions/v1/behebung';
const TEXT_VERZOEGERUNG = 800;   // ms nach dem letzten Tastendruck
const FOTO_MAX_PX = 1600;

const Z = {
  code: '',
  daten: null,          // Antwort von «laden»
  rm: {},               // mangel_id → { status, text, fotos: [{pfad,url}], geaendert_am }
  laufend: 0,           // offene Speichervorgänge
  textTimer: {},        // mangel_id → Timer
  galerien: {},         // galerie-id → [{ url, titel }]
  linkTimer: null
};

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const datum = ts => ts ? new Date(ts).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const zeit = ts => ts ? new Date(ts).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }) : '';
const istHeute = ts => ts && new Date(ts).toDateString() === new Date().toDateString();
const wann = ts => !ts ? '' : (istHeute(ts) ? 'heute ' : datum(ts) + ' ') + zeit(ts);

/* ---------- Server ---------- */

async function rufen(aktion, mehr) {
  let r;
  try {
    r = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
      body: JSON.stringify(Object.assign({ aktion, code: Z.code }, mehr || {}))
    });
  } catch (e) {
    const f = new Error('Keine Verbindung zum Server.');
    f.art = 'netz';
    throw f;
  }
  let d;
  try { d = await r.json(); } catch (e) { d = { fehler: 'Unerwartete Antwort des Servers (' + r.status + ').' }; }
  if (!r.ok || d.fehler) {
    const f = new Error(d.fehler || ('Fehler ' + r.status));
    f.art = d.art || '';
    throw f;
  }
  return d;
}

function stand(art, text) {
  const el = $('#speicherstand');
  el.className = 'stand ' + (art || '');
  el.textContent = text || '';
}

/* ---------- Start ---------- */

function codeAusText(t) {
  t = String(t || '').trim();
  const m = t.match(/[#&?]k=([0-9a-f]{40})/i) || t.match(/^([0-9a-f]{40})$/i);
  return m ? m[1].toLowerCase() : '';
}

function start() {
  Z.code = codeAusText(location.hash);
  if (!Z.code) return zeigeEingabe();
  laden();
}

function zeigeEingabe(fehlertext) {
  $('#inhalt').innerHTML = `
    <div class="card">
      <h1>Mängelbehebung</h1>
      <div class="hint">Öffne den Link aus dem Kontrollbericht oder scanne den QR-Code. Du kannst den
        Link auch hier einfügen.</div>
      ${fehlertext ? `<div class="banner fehler" style="margin-top:12px">${esc(fehlertext)}</div>` : ''}
      <textarea id="codeeingabe" placeholder="Link oder Zugangscode einfügen" autocapitalize="none"
        autocomplete="off" spellcheck="false" style="min-height:64px"></textarea>
      <button class="btn primary voll" id="codeok">Bericht öffnen</button>
    </div>`;
  $('#codeok').addEventListener('click', () => {
    const c = codeAusText($('#codeeingabe').value);
    if (!c) return zeigeEingabe('Das ist kein gültiger Link oder Zugangscode.');
    history.replaceState(null, '', '#k=' + c);
    Z.code = c;
    laden();
  });
}

async function laden(still) {
  if (!still) $('#inhalt').innerHTML = '<div class="leer">Bericht wird geladen …</div>';
  try {
    const d = await rufen('laden');
    if (still && Z.daten) return linksAuffrischen(d);
    Z.daten = d;
    Z.rm = {};
    (d.rueckmeldungen || []).forEach(r => { Z.rm[r.mangel_id] = r; });
    zeichnen();
  } catch (e) {
    if (still) return;           // stilles Auffrischen: beim nächsten Mal wieder
    if (['ungueltig', 'widerrufen', 'abgelaufen'].includes(e.art)) return zeigeHinweis('⛔', e.message);
    zeigeHinweis('⚡', e.message, true);
  }
}

function zeigeHinweis(zeichen, text, nochmal) {
  $('#inhalt').innerHTML = `<div class="card" style="text-align:center;padding:28px 18px">
      <div style="font-size:40px">${zeichen}</div>
      <p style="font-size:17px">${esc(text)}</p>
      ${nochmal ? '<button class="btn primary" id="nochmal">Nochmals versuchen</button>' : ''}
    </div>`;
  const n = $('#nochmal');
  if (n) n.addEventListener('click', () => laden());
}

/* ---------- Anzeige ---------- */

const gesperrt = () => !Z.daten || Z.daten.zustand !== 'offen' || !navigator.onLine;
const rmVon = id => Z.rm[id] || (Z.rm[id] = { mangel_id: id, status: null, text: '', fotos: [], geaendert_am: null });

// Reihenfolge wie im Kontrollbericht: nach Anlage, dann «Allgemein»
function gruppiert(typ) {
  const d = Z.daten;
  const pos = (d.positionen || []).filter(p => p.typ === typ);
  const anlagen = d.anlagen || [];
  const gruppen = anlagen.map(a => ({
    titel: (a.name || 'Anlage ohne Name') + (a.zaehler_nr ? ' – Zähler ' + a.zaehler_nr : ''),
    liste: pos.filter(p => p.anlage_id === a.id)
  }));
  const ohne = pos.filter(p => !p.anlage_id || !anlagen.some(a => a.id === p.anlage_id));
  gruppen.push({ titel: 'Allgemein', liste: ohne });
  return gruppen.filter(g => g.liste.length);
}

function zeichnen() {
  const d = Z.daten;
  const k = d.kopf || {};
  if (d.zustand === 'ueberarbeitung') {
    $('#inhalt').innerHTML = `${kopfKarte(k)}
      <div class="banner info">🛠 <b>Der Kontrollbericht wird gerade überarbeitet.</b> Bitte später nochmals
        öffnen – deine bisherigen Rückmeldungen bleiben erhalten.</div>`;
    return;
  }

  Z.galerien = {};
  let nr = 0;
  const maengelHtml = gruppiert('mangel').map(g => `
      <div class="anlage">${esc(g.titel)}</div>
      ${g.liste.map(p => positionHtml(p, ++nr)).join('')}`).join('');
  const infoGruppen = gruppiert('info');
  const infosHtml = infoGruppen.map(g => `
      <div class="anlage">${esc(g.titel)}</div>
      ${g.liste.map(p => positionHtml(p, null)).join('')}`).join('');

  const u = d.unterschrift;
  $('#inhalt').innerHTML = `
    ${kopfKarte(k)}
    ${u ? `<div class="banner ok">✅ <b>Unterschrieben</b> von ${esc(u.name)} (${esc(u.mail)}, per Mail bestätigt)
          am ${esc(datum(u.am))} um ${esc(zeit(u.am))}. Rückmeldungen und Fotos sind gesperrt.</div>`
      : `<div class="banner info">Beantworte jeden Mangel mit <b>✓ behoben</b> oder <b>✗ nicht behoben</b>,
          schreib dazu, was gemacht wurde, und füge Fotos hinzu. <b>Alles wird sofort gespeichert</b> –
          du kannst jederzeit unterbrechen und später oder auf einem anderen Gerät weitermachen.</div>`}
    ${nr ? '<div id="fortschritt"><div class="balken"><i></i></div><span class="txt"></span></div>' : ''}
    ${nr ? `<h2>Mängel</h2>${maengelHtml}` : '<div class="card">Im Bericht sind keine Mängel aufgeführt.</div>'}
    ${infosHtml ? `<h2>Informationen</h2><div class="hint" style="margin:-4px 0 8px">Keine Mängel – nur zur
        Kenntnis. Eine Bemerkung ist freiwillig.</div>${infosHtml}` : ''}
    ${unterschriftHtml()}`;

  fortschritt();
  sperreAnzeigen();
  linkTimerSetzen();
}

function kopfKarte(k) {
  const d = Z.daten || {};
  const e = k.eigentuemer || {};
  const f = d.firma || {};
  const eig = [e.name, e.name2, e.strasse, [e.plz, e.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const kontrolleure = (d.kontrolleure || []).map(p => `${esc(p.name)}${p.telefon
      ? ` · <a href="tel:${esc(p.telefon.replace(/\s+/g, ''))}">${esc(p.telefon)}</a>` : ''}${p.mail
      ? ` · <a href="mailto:${esc(p.mail)}">${esc(p.mail)}</a>` : ''}`).join('<br>');
  const ber = (d.bericht_unterschriften || []).map(u => `${esc(u.name)}, ${esc(datum(u.am))}`).join(' · ');
  return `<div class="card">
      <h1>${esc(k.strasse || 'Adresse unbekannt')}</h1>
      <div style="font-size:17px">${esc([k.plz, k.ort].filter(Boolean).join(' '))}</div>
      <div class="zeile">
        ${k.auftrag_nr || k.auftrag_bez ? `<div><div class="lbl">Auftrag</div>${esc([k.auftrag_nr, k.auftrag_bez].filter(Boolean).join(' '))}</div>` : ''}
        ${eig ? `<div><div class="lbl">Auftraggeber</div>${esc(eig)}</div>` : ''}
      </div>
      ${f.name || kontrolleure ? `<div class="zeile"><div><div class="lbl">Kontrolle durch</div>
          ${esc(f.name || '')}${f.telefon ? ` · <a href="tel:${esc(f.telefon.replace(/\s+/g, ''))}">${esc(f.telefon)}</a>` : ''}
          ${kontrolleure ? '<br>' + kontrolleure : ''}</div></div>` : ''}
      ${ber ? `<div class="hint">Kontrollbericht unterschrieben: ${ber}</div>` : ''}
      ${d.gueltig_bis ? `<div class="hint">Dieser Link gilt bis ${esc(datum(d.gueltig_bis))}.</div>` : ''}
    </div>`;
}

function positionHtml(p, nr) {
  const rm = rmVon(p.id);
  const istMangel = p.typ === 'mangel';
  const kontrollGal = 'k-' + p.id, eigenGal = 'b-' + p.id;
  Z.galerien[kontrollGal] = p.fotos.map((f, i) => ({ url: f.url, pfad: f.pfad,
    titel: (nr ? nr + '. ' : '') + (p.ort || '') + ' – Foto Kontrolle ' + (i + 1) }));
  Z.galerien[eigenGal] = rm.fotos.map((f, i) => ({ url: f.url, pfad: f.pfad,
    titel: (nr ? nr + '. ' : '') + (p.ort || '') + ' – Foto Behebung ' + (i + 1) }));
  const zustand = !istMangel ? '' : (rm.status || 'offen');
  return `<div class="card pos ${zustand}" id="p-${p.id}" data-id="${p.id}" data-typ="${p.typ}">
      <div class="kopfzeile">${nr ? nr + '.&nbsp; ' : 'ℹ️ '}${esc(p.ort || '–')}</div>
      ${p.text ? `<div class="text">${esc(p.text)}</div>` : ''}
      ${p.fotos.length ? `<div class="fotolabel">Foto Kontrolle</div>
        <div class="fotos">${fotosHtml(p.fotos, kontrollGal, false)}</div>` : ''}
      <div class="rm">
        <div class="rm-titel">${istMangel ? 'Deine Rückmeldung' : 'Bemerkung (freiwillig)'}</div>
        ${istMangel ? `<div class="wahl">
            <button class="ja ${rm.status === 'behoben' ? 'an' : ''}" data-status="behoben">✓ behoben</button>
            <button class="nein ${rm.status === 'nicht_behoben' ? 'an' : ''}" data-status="nicht_behoben">✗ nicht behoben</button>
          </div>` : ''}
        <textarea class="rmtext" placeholder="${istMangel
          ? 'Was wurde gemacht? z.B. «Steckdose ersetzt, Anschluss nachgezogen»' : 'Bemerkung'}">${esc(rm.text)}</textarea>
        <div class="fotolabel eigenlabel" ${rm.fotos.length ? '' : 'hidden'}>Foto Behebung</div>
        <div class="fotos eigene">${fotosHtml(rm.fotos, eigenGal, true)}</div>
        <label class="btn voll fotoknopf">📷 Foto hinzufügen
          <input type="file" accept="image/*" multiple class="dateiwahl"></label>
        <div class="zuletzt">${rm.geaendert_am ? 'Zuletzt gespeichert: ' + esc(wann(rm.geaendert_am)) : ''}</div>
      </div>
    </div>`;
}

function fotosHtml(liste, gal, eigene) {
  return liste.map((f, i) => `<div class="foto" role="button" tabindex="0" data-gal="${gal}" data-i="${i}">
      <img loading="lazy" data-pfad="${esc(f.pfad)}" src="${esc(f.url)}" alt="Foto ${i + 1}">
      ${eigene ? `<button class="weg" data-pfad="${esc(f.pfad)}" aria-label="Foto entfernen">✕</button>` : ''}
    </div>`).join('');
}

function unterschriftHtml() {
  const d = Z.daten;
  if (d.unterschrift) {
    const u = d.unterschrift;
    return `<div class="card"><h2 style="margin-top:0">Unterschrift</h2>
        ${u.bild ? `<img src="${esc(u.bild)}" alt="Unterschrift" style="max-width:260px;max-height:110px;display:block">` : ''}
        <div><b>${esc(u.name)}</b> · ${esc(u.mail)} (per Mail bestätigt)</div>
        <div class="hint">${esc(datum(u.am))}, ${esc(zeit(u.am))}</div></div>`;
  }
  return `<div class="card" id="unterschrift"><h2 style="margin-top:0">Unterschreiben</h2>
      <div class="hint">Wenn alle Mängel beantwortet sind, unterschreibst du hier. Zur Bestätigung bekommst du
        einen Code per Mail. Danach sind deine Rückmeldungen gesperrt.</div>
      <button class="btn primary voll" id="btnSign" disabled>✍️ Mängelbehebung unterschreiben</button>
      <div class="hint" id="signhinweis" style="margin-top:6px"></div></div>`;
}

function fortschritt() {
  const maengel = (Z.daten.positionen || []).filter(p => p.typ === 'mangel');
  const fertig = maengel.filter(p => (Z.rm[p.id] || {}).status).length;
  const f = $('#fortschritt');
  if (f) {
    f.querySelector('i').style.width = (maengel.length ? Math.round(100 * fertig / maengel.length) : 0) + '%';
    f.querySelector('.txt').textContent = fertig === maengel.length
      ? '✓ alle ' + maengel.length + ' beantwortet'
      : fertig + ' von ' + maengel.length + ' beantwortet';
  }
  const b = $('#btnSign');
  if (b) {
    b.disabled = fertig < maengel.length || gesperrt();
    $('#signhinweis').textContent = fertig < maengel.length
      ? 'Noch ' + (maengel.length - fertig) + ' Mangel/Mängel ohne ✓ oder ✗.' : '';
  }
}

function sperreAnzeigen() {
  const zu = gesperrt();
  $('#offline').hidden = navigator.onLine;
  document.body.classList.toggle('gesperrt', zu);
  $$('.wahl button, textarea.rmtext, .dateiwahl, .fotoknopf, .foto .weg').forEach(el => {
    if (el.classList.contains('fotoknopf')) el.hidden = zu;
    else el.disabled = zu;
  });
  fortschritt();
}

/* ---------- Speichern ---------- */

function zuletztAnzeigen(id, text, fehler) {
  const el = document.querySelector(`#p-${CSS.escape(id)} .zuletzt`);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('fehler', !!fehler);
}

async function speichern(id, werte) {
  Z.laufend++;
  stand('laeuft', '● Speichert …');
  zuletztAnzeigen(id, 'Speichert …');
  try {
    const r = await rufen('rueckmeldung', Object.assign({ mangel_id: id }, werte));
    rmVon(id).geaendert_am = r.geaendert_am;
    zuletztAnzeigen(id, '✓ Gespeichert um ' + zeit(r.geaendert_am));
    Z.laufend--;
    if (!Z.laufend) stand('ok', '✓ Gespeichert');
  } catch (e) {
    Z.laufend--;
    stand('fehler', '⚠️ Nicht gespeichert');
    zuletztAnzeigen(id, '⚠️ Nicht gespeichert: ' + e.message, true);
    nachFehler(e);
  }
}

// Hat sich der Zustand auf dem Server geändert (unterschrieben, Bericht in Überarbeitung)?
function nachFehler(e) {
  if (['unterschrieben', 'ueberarbeitung', 'ungueltig', 'widerrufen', 'abgelaufen'].includes(e.art)) {
    alert(e.message);
    laden();
  }
}

function textSpaeter(id, wert) {
  clearTimeout(Z.textTimer[id]);
  zuletztAnzeigen(id, '…');
  Z.textTimer[id] = setTimeout(() => { delete Z.textTimer[id]; speichern(id, { text: wert }); }, TEXT_VERZOEGERUNG);
}

function textSofort(id, wert) {
  if (!Z.textTimer[id]) return;
  clearTimeout(Z.textTimer[id]);
  delete Z.textTimer[id];
  speichern(id, { text: wert });
}

/* ---------- Fotos ---------- */

function verkleinern(datei) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(datei);
    const img = new Image();
    img.onload = () => {
      const f = Math.min(1, FOTO_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * f);
      c.height = Math.round(img.naturalHeight * f);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Das Bild konnte nicht gelesen werden.')); };
    img.src = url;
  });
}

function eigeneFotosZeichnen(id) {
  const karte = document.getElementById('p-' + id);
  if (!karte) return;
  const rm = rmVon(id);
  const gal = 'b-' + id;
  const nrTxt = karte.querySelector('.kopfzeile').textContent.replace(/\s+/g, ' ').trim();
  Z.galerien[gal] = rm.fotos.map((f, i) => ({ url: f.url, pfad: f.pfad, titel: nrTxt + ' – Foto Behebung ' + (i + 1) }));
  karte.querySelector('.fotos.eigene').innerHTML = fotosHtml(rm.fotos, gal, true)
    + (karte._hochladen ? '<div class="foto laedt">⏳ wird hochgeladen …</div>'.repeat(karte._hochladen) : '');
  karte.querySelector('.eigenlabel').hidden = !rm.fotos.length && !karte._hochladen;
  sperreAnzeigen();
}

async function fotosHochladen(id, dateien) {
  const karte = document.getElementById('p-' + id);
  karte._hochladen = (karte._hochladen || 0) + dateien.length;
  eigeneFotosZeichnen(id);
  for (const datei of dateien) {
    Z.laufend++;
    stand('laeuft', '● Foto wird hochgeladen …');
    try {
      const daten = await verkleinern(datei);
      const r = await rufen('foto_hochladen', { mangel_id: id, daten });
      rmVon(id).fotos.push({ pfad: r.pfad, url: r.url });
      rmVon(id).geaendert_am = new Date().toISOString();
      zuletztAnzeigen(id, '✓ Foto gespeichert um ' + zeit(new Date()));
      Z.laufend--;
      if (!Z.laufend) stand('ok', '✓ Gespeichert');
    } catch (e) {
      Z.laufend--;
      stand('fehler', '⚠️ Foto nicht gespeichert');
      zuletztAnzeigen(id, '⚠️ Foto nicht gespeichert: ' + e.message, true);
      nachFehler(e);
    }
    karte._hochladen--;
    eigeneFotosZeichnen(id);
  }
}

async function fotoEntfernen(id, pfad) {
  if (!confirm('Dieses Foto entfernen?')) return;
  Z.laufend++;
  stand('laeuft', '● Speichert …');
  try {
    await rufen('foto_entfernen', { mangel_id: id, pfad });
    const rm = rmVon(id);
    rm.fotos = rm.fotos.filter(f => f.pfad !== pfad);
    eigeneFotosZeichnen(id);
    zuletztAnzeigen(id, '✓ Foto entfernt um ' + zeit(new Date()));
    Z.laufend--;
    if (!Z.laufend) stand('ok', '✓ Gespeichert');
  } catch (e) {
    Z.laufend--;
    stand('fehler', '⚠️ Nicht gespeichert');
    zuletztAnzeigen(id, '⚠️ ' + e.message, true);
    nachFehler(e);
  }
}

// Foto-Links gelten eine Stunde – rechtzeitig still erneuern, ohne neu zu zeichnen
function linksAuffrischen(d) {
  const neu = {};
  (d.positionen || []).forEach(p => p.fotos.forEach(f => { neu[f.pfad] = f.url; }));
  (d.rueckmeldungen || []).forEach(r => (r.fotos || []).forEach(f => { neu[f.pfad] = f.url; }));
  Object.values(Z.galerien).forEach(g => g.forEach(f => { if (neu[f.pfad]) f.url = neu[f.pfad]; }));
  Object.values(Z.rm).forEach(r => r.fotos.forEach(f => { if (neu[f.pfad]) f.url = neu[f.pfad]; }));
  (Z.daten.positionen || []).forEach(p => p.fotos.forEach(f => { if (neu[f.pfad]) f.url = neu[f.pfad]; }));
  $$('img[data-pfad]').forEach(img => { const u = neu[img.dataset.pfad]; if (u) img.src = u; });
  linkTimerSetzen();
}

function linkTimerSetzen() {
  clearTimeout(Z.linkTimer);
  const s = (Z.daten && Z.daten.foto_links_gueltig_s) || 3600;
  Z.linkTimer = setTimeout(() => laden(true), Math.max(60, s - 300) * 1000);
}

/* ---------- Bedienung (ein Zuhörer für alles) ---------- */

document.addEventListener('click', e => {
  const t = e.target;
  const karte = t.closest('.pos');
  const id = karte && karte.dataset.id;

  const weg = t.closest('.foto .weg');
  if (weg) { e.stopPropagation(); if (!gesperrt()) fotoEntfernen(id, weg.dataset.pfad); return; }

  const foto = t.closest('.foto[data-gal]');
  if (foto) return bvOeffnen(foto.dataset.gal, Number(foto.dataset.i));

  const wahl = t.closest('.wahl button');
  if (wahl && id && !gesperrt()) {
    const rm = rmVon(id);
    rm.status = rm.status === wahl.dataset.status ? null : wahl.dataset.status;   // nochmals tippen = zurücknehmen
    karte.querySelectorAll('.wahl button').forEach(b => b.classList.toggle('an', b.dataset.status === rm.status));
    karte.classList.remove('offen', 'behoben', 'nicht_behoben');
    karte.classList.add(rm.status || 'offen');
    fortschritt();
    speichern(id, { status: rm.status });
    return;
  }

  if (t.closest('#fortschritt')) {
    const offen = $$('.pos[data-typ="mangel"]').find(k => !(Z.rm[k.dataset.id] || {}).status);
    (offen || $('#unterschrift') || document.body).scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  if (t.closest('#btnSign')) {
    alert('Die Unterschrift mit Bestätigung per Mail wird gerade eingerichtet. Deine Rückmeldungen sind '
      + 'gespeichert – du kannst den Link später wieder öffnen und dann unterschreiben.');
  }
});

document.addEventListener('keydown', e => {
  const foto = e.target.closest && e.target.closest('.foto[data-gal]');
  if (foto && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); bvOeffnen(foto.dataset.gal, Number(foto.dataset.i)); }
});

document.addEventListener('input', e => {
  if (!e.target.matches('textarea.rmtext')) return;
  const id = e.target.closest('.pos').dataset.id;
  rmVon(id).text = e.target.value;
  textSpaeter(id, e.target.value);
});

document.addEventListener('focusout', e => {
  if (!e.target.matches || !e.target.matches('textarea.rmtext')) return;
  const id = e.target.closest('.pos').dataset.id;
  textSofort(id, e.target.value);
});

document.addEventListener('change', e => {
  if (!e.target.matches('.dateiwahl')) return;
  const id = e.target.closest('.pos').dataset.id;
  const dateien = Array.from(e.target.files || []);
  e.target.value = '';
  if (dateien.length && !gesperrt()) fotosHochladen(id, dateien);
});

window.addEventListener('online', () => { sperreAnzeigen(); laden(true); });
window.addEventListener('offline', sperreAnzeigen);
window.addEventListener('hashchange', () => { const c = codeAusText(location.hash); if (c && c !== Z.code) { Z.code = c; laden(); } });

// Nichts Ungespeichertes verlieren: beim Verlassen noch offene Texte senden
window.addEventListener('pagehide', () => {
  Object.keys(Z.textTimer).forEach(id => {
    const ta = document.querySelector(`#p-${CSS.escape(id)} textarea.rmtext`);
    if (ta) textSofort(id, ta.value);
  });
});
window.addEventListener('beforeunload', e => {
  if (Z.laufend || Object.keys(Z.textTimer).length) { e.preventDefault(); e.returnValue = ''; }
});

/* ============================================================
   Vollbild-Ansicht: zwei Finger zoomen, ein Finger verschieben
   (gezoomt) oder wischen (nicht gezoomt), doppelt tippen = zoomen,
   nach unten wischen = schliessen
   ============================================================ */

const BV = { liste: [], i: 0, s: 1, tx: 0, ty: 0, finger: new Map(), eins: null, zwei: null, letzterTipp: 0 };

function bvOeffnen(gal, i) {
  const liste = (Z.galerien[gal] || []).filter(f => f.url);
  if (!liste.length) return;
  BV.liste = liste;
  BV.i = Math.max(0, Math.min(i, liste.length - 1));
  $('#bildansicht').hidden = false;
  document.body.style.overflow = 'hidden';
  history.pushState({ bildansicht: true }, '', location.href);   // «Zurück» schliesst die Ansicht
  bvZeigen();
}

function bvSchliessen(ausVerlauf) {
  if ($('#bildansicht').hidden) return;
  $('#bildansicht').hidden = true;
  document.body.style.overflow = '';
  $('#bv-bild').removeAttribute('src');
  if (!ausVerlauf && history.state && history.state.bildansicht) history.back();
}

function bvZeigen() {
  const f = BV.liste[BV.i];
  BV.s = 1; BV.tx = 0; BV.ty = 0;
  const img = $('#bv-bild');
  img.style.transition = 'none';
  bvSetzen();
  img.src = f.url;
  $('#bv-zahl').textContent = BV.liste.length > 1 ? (BV.i + 1) + ' / ' + BV.liste.length : '';
  $('#bv-titel').textContent = f.titel || '';
  $('#bv-zurueck').hidden = BV.liste.length < 2;
  $('#bv-weiter').hidden = BV.liste.length < 2;
}

function bvSetzen() {
  $('#bv-bild').style.transform = `translate(${BV.tx}px, ${BV.ty}px) scale(${BV.s})`;
}

function bvBlaettern(r) {
  if (BV.liste.length < 2) return;
  BV.i = (BV.i + r + BV.liste.length) % BV.liste.length;
  bvZeigen();
}

// Zoomen um einen Punkt p (Bildschirm): der Punkt unter den Fingern bleibt stehen
function bvZoom(sNeu, px, py, basis) {
  const b = $('#bv-buehne').getBoundingClientRect();
  const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
  const s0 = basis ? basis.s : BV.s, tx0 = basis ? basis.tx : BV.tx, ty0 = basis ? basis.ty : BV.ty;
  const ax = basis ? basis.mx : px, ay = basis ? basis.my : py;   // Ankerpunkt beim Start
  sNeu = Math.max(1, Math.min(5, sNeu));
  BV.tx = px - cx - (ax - cx - tx0) * sNeu / s0;
  BV.ty = py - cy - (ay - cy - ty0) * sNeu / s0;
  BV.s = sNeu;
  if (BV.s <= 1.01) { BV.s = 1; BV.tx = 0; BV.ty = 0; }
  bvSetzen();
}

(function bvBedienung() {
  const buehne = $('#bv-buehne');
  const img = $('#bv-bild');
  const abstand = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  buehne.addEventListener('pointerdown', e => {
    try { buehne.setPointerCapture(e.pointerId); } catch (x) { /* manche Browser: ohne Capture weiter */ }
    BV.finger.set(e.pointerId, { x: e.clientX, y: e.clientY });
    img.style.transition = 'none';
    const f = [...BV.finger.values()];
    if (f.length === 1) {
      BV.eins = { x: e.clientX, y: e.clientY, tx: BV.tx, ty: BV.ty, zeit: Date.now() };
      BV.zwei = null;
    } else if (f.length === 2) {
      BV.zwei = { d: abstand(f[0], f[1]), mx: (f[0].x + f[1].x) / 2, my: (f[0].y + f[1].y) / 2,
                  s: BV.s, tx: BV.tx, ty: BV.ty };
      BV.eins = null;
    }
  });

  buehne.addEventListener('pointermove', e => {
    if (!BV.finger.has(e.pointerId)) return;
    BV.finger.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const f = [...BV.finger.values()];
    if (f.length >= 2 && BV.zwei) {
      const mx = (f[0].x + f[1].x) / 2, my = (f[0].y + f[1].y) / 2;
      bvZoom(BV.zwei.s * abstand(f[0], f[1]) / BV.zwei.d, mx, my, BV.zwei);
    } else if (f.length === 1 && BV.eins) {
      const dx = e.clientX - BV.eins.x, dy = e.clientY - BV.eins.y;
      if (BV.s > 1) { BV.tx = BV.eins.tx + dx; BV.ty = BV.eins.ty + dy; }
      else { BV.tx = dx; BV.ty = Math.max(0, dy) * 0.6; }       // Wischen andeuten
      bvSetzen();
    }
  });

  const loslassen = e => {
    if (!BV.finger.has(e.pointerId)) return;
    BV.finger.delete(e.pointerId);
    const rest = [...BV.finger.values()];
    if (rest.length === 1) {               // von zwei auf einen Finger: ohne Sprung weiter verschieben
      BV.eins = { x: rest[0].x, y: rest[0].y, tx: BV.tx, ty: BV.ty, zeit: 0 };
      BV.zwei = null;
      return;
    }
    if (rest.length) return;
    const start = BV.eins;
    BV.eins = null;
    if (BV.zwei) { BV.zwei = null; return; }
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    const tipp = Math.abs(dx) < 10 && Math.abs(dy) < 10 && Date.now() - start.zeit < 300;
    img.style.transition = 'transform .2s';
    if (tipp) {
      const jetzt = Date.now();
      if (jetzt - BV.letzterTipp < 320) {           // doppelt tippen
        BV.letzterTipp = 0;
        if (BV.s > 1) { BV.s = 1; BV.tx = 0; BV.ty = 0; bvSetzen(); }
        else bvZoom(2.5, e.clientX, e.clientY);
      } else BV.letzterTipp = jetzt;
      return;
    }
    if (BV.s > 1) return;                            // gezoomt: nur verschoben
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      bvBlaettern(dx < 0 ? 1 : -1);
    } else if (dy > 120 && Math.abs(dy) > Math.abs(dx)) {
      bvSchliessen();
    } else { BV.tx = 0; BV.ty = 0; bvSetzen(); }
  };
  buehne.addEventListener('pointerup', loslassen);
  buehne.addEventListener('pointercancel', loslassen);

  buehne.addEventListener('wheel', e => {            // PC: Mausrad zoomt
    e.preventDefault();
    img.style.transition = 'none';
    bvZoom(BV.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
  }, { passive: false });

  $('#bv-zu').addEventListener('click', () => bvSchliessen());
  $('#bv-zurueck').addEventListener('click', () => bvBlaettern(-1));
  $('#bv-weiter').addEventListener('click', () => bvBlaettern(1));
  document.addEventListener('keydown', e => {
    if ($('#bildansicht').hidden) return;
    if (e.key === 'Escape') bvSchliessen();
    if (e.key === 'ArrowRight') bvBlaettern(1);
    if (e.key === 'ArrowLeft') bvBlaettern(-1);
  });
  window.addEventListener('popstate', () => bvSchliessen(true));
})();

/* ---------- los ---------- */

start();
