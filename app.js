'use strict';

/* ============================================================
   Elektrokontrolle online – Plattform für mehrere Firmen
   Etappe 2: Anmeldung, Rollen, Firmen- und Benutzerverwaltung
   Datenbank: Supabase (Rechte serverseitig via RLS – siehe setup-plattform.sql)
   ============================================================ */

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Solange config.js noch nicht (richtig) ausgefüllt ist, darf createClient nicht
// aufgerufen werden – sonst bricht die ganze App ab. Fehlt die Datei ganz oder
// enthält sie einen Tippfehler (z.B. fehlende Anführungszeichen), sind die
// Variablen gar nicht definiert – das fangen wir hier ebenfalls ab.
const KONFIG_FEHLER = (typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_KEY === 'undefined')
  ? 'Die Datei <b>config.js</b> konnte nicht gelesen werden. Häufigste Ursache: die beiden Werte stehen '
    + 'nicht in Anführungszeichen. Richtig ist:<br><code>const SUPABASE_URL = \'https://…supabase.co\';</code>'
  : String(SUPABASE_URL).startsWith('HIER_')
    ? 'Die Datei <b>config.js</b> ist noch nicht ausgefüllt. Dort müssen die <b>Project URL</b> und der '
      + '<b>anon-Schlüssel</b> aus dem Supabase-Projekt eingetragen werden.'
    : null;
const KONFIGURIERT = !KONFIG_FEHLER;
const sb = KONFIGURIERT
  ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

/* ---------------- Zustand ---------------- */

const S = {
  view: 'kontrollen',
  profil: null,        // Zeile aus «benutzer» (mit Rolle und Status)
  firma: null,         // eigene Firma
  einstellungsBereich: 'grund',
  kontrolle: null
};

const istSuperadmin = () => S.profil && S.profil.rolle === 'superadmin';
const istAdmin = () => S.profil && (S.profil.rolle === 'admin' || S.profil.rolle === 'superadmin');

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('de-CH') + ' ' + d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
}

/* ---------------- Rückmeldungen ---------------- */

function setSaveState(cls, txt) {
  const el = $('#savestate');
  if (!el) return;
  el.className = cls;
  el.textContent = txt;
  if (cls === 'saved') setTimeout(() => { if (el.textContent === txt) el.textContent = ''; }, 2000);
}

function netzAnzeige() {
  // Die eigentliche Anzeige macht warteAnzeige() – sie kennt auch die
  // Zahl der noch nicht gesendeten Änderungen.
  if (typeof warteAnzeige === 'function') return warteAnzeige();
  const el = $('#netstate');
  if (!el) return;
  el.textContent = navigator.onLine ? '' : '⚡ offline';
  el.className = navigator.onLine ? '' : 'offline';
}
window.addEventListener('online', netzAnzeige);
window.addEventListener('offline', netzAnzeige);

function fehler(e) {
  const t = (e && e.message) ? e.message : String(e);
  alert('Es hat nicht geklappt:\n\n' + t);
  console.error(e);
}

/* ============================================================
   Anmeldung / Registrierung
   ============================================================ */

function authMeldung(txt, art) {
  const el = $('#authmsg');
  el.className = 'authmsg ' + (art || '');
  el.innerHTML = txt;
}

$$('#authtabs button').forEach(b => b.addEventListener('click', () => {
  const reg = b.classList.contains('t_reg');
  $$('#authtabs button').forEach(x => x.classList.toggle('on', x === b));
  $('#loginform').style.display = reg ? 'none' : '';
  $('#regform').style.display = reg ? '' : 'none';
  authMeldung('');
}));

$('#loginform').addEventListener('submit', async e => {
  e.preventDefault();
  authMeldung('Anmeldung läuft …');
  const { error } = await sb.auth.signInWithPassword({
    email: $('#l_mail').value.trim(),
    password: $('#l_pw').value
  });
  if (error) {
    authMeldung('Anmeldung fehlgeschlagen – E-Mail oder Passwort stimmt nicht.', 'fehler');
    return;
  }
  await nachAnmeldung();
});

// Passwort vergessen: Supabase schickt eine Mail mit einem Link zurück auf diese Seite
$('#l_forgot').addEventListener('click', async () => {
  const mail = $('#l_mail').value.trim();
  if (!mail) { $('#l_mail').focus(); return authMeldung('Bitte zuerst die E-Mail-Adresse eintragen.', 'fehler'); }
  authMeldung('Mail wird verschickt …');
  const { error } = await sb.auth.resetPasswordForEmail(mail, {
    redirectTo: location.href.split('#')[0].split('?')[0]
  });
  authMeldung(error
    ? 'Konnte nicht verschickt werden: ' + esc(error.message)
    : 'Wir haben dir eine E-Mail geschickt. Öffne den Link darin – danach kannst du hier ein neues '
      + 'Passwort setzen.', error ? 'fehler' : 'ok');
});

// Rückkehr aus der Passwort-Mail: neues Passwort setzen
sb && sb.auth.onAuthStateChange(async (ereignis) => {
  if (ereignis !== 'PASSWORD_RECOVERY') return;
  const neu = prompt('Neues Passwort eingeben (mindestens 6 Zeichen):');
  if (!neu) return;
  const { error } = await sb.auth.updateUser({ password: neu });
  if (error) return alert('Passwort konnte nicht geändert werden: ' + error.message);
  alert('Das Passwort wurde geändert.');
  await nachAnmeldung();
});

$('#regform').addEventListener('submit', async e => {
  e.preventDefault();
  authMeldung('Registrierung läuft …');
  const { error } = await sb.auth.signUp({
    email: $('#r_mail').value.trim(),
    password: $('#r_pw').value,
    options: {
      data: {
        firmen_code: $('#r_code').value.trim().toUpperCase(),
        name: $('#r_name').value.trim(),
        kuerzel: $('#r_kuerzel').value.trim().toUpperCase()
      }
    }
  });
  if (error) {
    authMeldung('Registrierung fehlgeschlagen: ' + esc(error.message), 'fehler');
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    authMeldung('Fast geschafft! Bitte bestätige zuerst die E-Mail, die wir dir geschickt haben, und melde dich dann an.', 'ok');
    return;
  }
  await nachAnmeldung();
});

async function profilLaden() {
  // getSession() liest die gespeicherte Anmeldung im Gerät – das geht auch
  // ohne Empfang. Erst die Profilzeile braucht die Datenbank.
  const { data: { session } } = await sb.auth.getSession();
  if (!session || !session.user) return null;
  if (navigator.onLine) {
    const { data, error } = await sb.from('benutzer').select('*').eq('id', session.user.id).maybeSingle();
    if (!error) {
      if (data) await ablageSchreiben('merker', data, 'profil');
      return data;
    }
    if (!istNetzproblem(error)) throw error;
  }
  // Ohne Verbindung: das zuletzt bekannte Profil verwenden
  const gemerkt = await ablageLesen('merker', 'profil');
  if (gemerkt && gemerkt.id === session.user.id) return gemerkt;
  return null;
}

async function nachAnmeldung() {
  let p;
  try {
    p = await profilLaden();
  } catch (e) {
    authMeldung('Profil konnte nicht geladen werden: ' + esc(e.message), 'fehler');
    return;
  }
  if (!p) {
    authMeldung(navigator.onLine
      ? 'Dein Konto wurde angelegt, aber es fehlt das Profil. Bitte melde dich beim Systemverwalter.'
      : 'Ohne Verbindung ist keine Anmeldung möglich. Melde dich einmal mit Empfang an – danach '
        + 'funktioniert die App auch offline.', 'fehler');
    return;
  }
  if (!p.firma_id) {
    authMeldung('Der eingegebene <b>Firmen-Code</b> war nicht gültig – dein Konto ist keiner Firma zugeordnet. '
      + 'Bitte lass dir den richtigen Code geben und melde dich beim Systemverwalter.', 'fehler');
    await sb.auth.signOut();
    return;
  }
  if (p.status === 'offen') {
    authMeldung('Deine Registrierung ist eingegangen. <b>Ein Administrator deiner Firma muss dich noch freischalten</b> – '
      + 'danach kannst du dich anmelden.', 'ok');
    await sb.auth.signOut();
    return;
  }
  if (p.status === 'gesperrt') {
    authMeldung('Dein Zugang wurde gesperrt. Bitte wende dich an deinen Administrator.', 'fehler');
    await sb.auth.signOut();
    return;
  }
  S.profil = p;
  if (navigator.onLine) {
    const { data: f } = await sb.from('firmen').select('*').eq('id', p.firma_id).maybeSingle();
    S.firma = f || null;
    if (f) await ablageSchreiben('merker', f, 'firma');
  } else {
    S.firma = (await ablageLesen('merker', 'firma')) || null;
  }
  $('#auth').style.display = 'none';
  $('#app').style.display = '';
  $('#userbtn').textContent = p.kuerzel || '👤';
  netzAnzeige();
  go(istSuperadmin() ? 'settings' : 'kontrollen');
}

async function abmelden() {
  if (!confirm('Wirklich abmelden?')) return;
  await sb.auth.signOut();
  location.reload();
}

/* ============================================================
   Navigation
   ============================================================ */

function go(view) {
  S.view = view;
  $$('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  render();
  window.scrollTo(0, 0);
}

$$('#tabbar button').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));
$('#userbtn').addEventListener('click', abmelden);

function render() {
  const v = $('#view');
  $('#ctxtitle').textContent = S.kontrolle ? '' : '';
  if (S.view === 'settings') return renderSettings();
  if (S.view === 'kontrollen') return renderKontrollen();
  if (!S.kontrolle) {
    v.innerHTML = `<div class="empty">Bitte zuerst unter <b>🗂 Kontrollen</b> eine Kontrolle öffnen
      oder eine neue anlegen.</div>`;
    return;
  }
  $('#ctxtitle').textContent = kontrolleTitel(S.kontrolle);
  // Nach dem Zeichnen die Sperre anwenden (die Renderer sind teils asynchron)
  const fertig = p => Promise.resolve(p).then(sperreAnwenden);
  if (S.view === 'kunde') return fertig(renderKunde());
  if (S.view === 'uv') return fertig(renderAnlagen());
  if (S.view === 'mess') return fertig(renderMess());
  if (S.view === 'fill') return fertig(renderFill());
  if (S.view === 'maengel') return fertig(renderMaengel());
  if (S.view === 'sicht') return fertig(renderSicht());
  if (S.view === 'export') return fertig(renderAbschluss());
  v.innerHTML = `<div class="empty">Dieser Bereich entsteht als Nächstes.</div>`;
}

/* ============================================================
   Reiter: Abschluss – Status, Unterschriften, Dokumente
   ============================================================ */

S.unterschriften = null;
S.berichtArt = 'kunde';      // «kunde» = ohne Notizen, «intern» = mit Notizen
S.arbeitszeit = null;
S.statusVerlauf = null;
S.csvKopf = false;

async function arbeitszeitLaden() {
  const data = await zeilenHolen('arbeitszeit', 'kontrolle_id', S.kontrolle.id, 'datum');
  S.arbeitszeit = data;
  paketNachfuehren();
  return data;
}

async function statusVerlaufLaden() {
  const data = await zeilenHolen('status_verlauf', 'kontrolle_id', S.kontrolle.id, 'gesetzt_am');
  S.statusVerlauf = data;
  paketNachfuehren();
  return data;
}

async function unterschriftenLaden() {
  const data = await zeilenHolen('unterschriften', 'kontrolle_id', S.kontrolle.id, 'gesetzt_am');
  S.unterschriften = data;
  paketNachfuehren();
  return data;
}

const istUnterzeichnet = () => (S.unterschriften || []).length > 0;
// Nur die Firma, welche die Kontrolle angelegt hat, darf Unterschriften entfernen
const istErstellerfirma = () => !!S.kontrolle && S.kontrolle.firma_id === S.profil.firma_id;

// Nach dem Unterschreiben sind alle Erfassungsfelder gesperrt. Ausnahmen:
// das Bemerkungsfeld, der Anlagen-Wechsel, das Lösen der Partnerfirma und
// der ganze Abschluss-Reiter (Dokumente, Bericht, Arbeitszeit, Unterschriften).
const SPERRE_FREI = ['k_bem', 'p_trennen'];

function sperreAnwenden() {
  const v = $('#view');
  if (!v || !S.kontrolle || !istUnterzeichnet()) return;
  if (!$('#sperrbanner')) {
    const banner = document.createElement('div');
    banner.id = 'sperrbanner';
    banner.className = 'robanner';
    banner.innerHTML = '🔒 <b>Unterschrieben – gesperrt.</b> Die Angaben sind nur noch lesbar. '
      + 'Zum Bearbeiten im Reiter 📤 Abschluss die Unterschriften entfernen (nur die Firma, welche die '
      + 'Kontrolle angelegt hat) oder dort eine <b>Kopie</b> erstellen.';
    v.insertBefore(banner, v.firstChild);
  }
  if (S.view === 'export') return;      // im Abschluss bleibt alles bedienbar
  v.querySelectorAll('input, textarea, select, button').forEach(el => {
    if (SPERRE_FREI.includes(el.id)) return;
    if (el.closest('.chips') && el.classList.contains('chip')) return;   // Anlagen-Wechsel
    el.disabled = true;
  });
}

async function renderAbschluss() {
  const v = $('#view');
  if (!S.anlagen) await anlagenLaden();
  if (!S.unterschriften || !S.team || !S.arbeitszeit || !S.statusVerlauf) {
    v.innerHTML = '<div class="empty">Wird geladen …</div>';
    if (!S.unterschriften) await unterschriftenLaden();
    if (!S.team) await teamLaden();
    if (!S.arbeitszeit) await arbeitszeitLaden();
    if (!S.statusVerlauf) await statusVerlaufLaden();
  }
  const k = S.kontrolle;
  const gesperrt = istUnterzeichnet();

  v.innerHTML = `<h2>Abschluss</h2>

    ${gesperrt ? `<div class="robanner" id="sperrbanner">🔒 <b>Diese Kontrolle ist unterschrieben und
      darum gesperrt.</b> Alle Angaben sind sichtbar, aber nicht mehr änderbar – ausser dem Feld
      «Bemerkungen» im Reiter Kunde.<br>
      ${istErstellerfirma()
        ? 'Zum Bearbeiten zuerst unten die Unterschriften entfernen – danach muss neu unterschrieben werden.'
        : 'Nur die Firma, welche die Kontrolle angelegt hat, kann die Unterschriften wieder entfernen.'}
      <div class="btnrow"><button class="btn small" id="btnKopie">📄 Kopie zum Bearbeiten erstellen</button></div>
      </div>` : ''}

    <div class="card">
      <h3 style="margin-top:0">Status</h3>
      <div class="chips" id="statusChips">
        ${STATUS_STUFEN.map(s => `<button class="chip ${k.status === s ? 'active' : ''}" data-s="${s}">${s}</button>`).join('')}
      </div>
      ${(S.statusVerlauf || []).length ? `<div class="hint" style="margin-top:12px">
        ${S.statusVerlauf.map(z => `<div class="verlaufzeile" data-vid="${z.id}">
            <b>${esc(z.status)}</b> – ${esc(fmtDate(z.gesetzt_am))}${z.kuerzel ? ' · ' + esc(z.kuerzel) : ''}
            <button class="iconbtn sv_del" title="Eintrag löschen">🗑</button>
          </div>`).join('')}
        </div>` : '<div class="hint" style="margin-top:12px">Noch kein Statuswechsel festgehalten.</div>'}
    </div>

    <div class="card">
      <h3 style="margin-top:0">Arbeitszeit</h3>
      <div class="hint">Eigene Einträge für diese Kontrolle – für die Abrechnung.
        ${S.arbeitszeit && S.arbeitszeit.length
          ? 'Summe: <b>' + S.arbeitszeit.reduce((s, z) => s + Number(z.stunden || 0), 0).toFixed(2) + ' h</b>'
          : ''}</div>
      <div class="row" style="align-items:flex-end;margin-top:10px">
        <div class="narrow" style="flex:0 0 150px"><label class="f">Datum</label>
          <input type="date" id="az_datum" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="narrow" style="flex:0 0 110px"><label class="f">Stunden</label>
          <input type="number" id="az_std" step="0.25" min="0" inputmode="decimal" placeholder="1.5"></div>
        <div><label class="f">Tätigkeit</label><input type="text" id="az_txt" placeholder="z.B. Kontrolle vor Ort"></div>
        <div class="narrow" style="flex:0 0 auto"><button class="btn primary" id="az_add">＋ Eintrag</button></div>
      </div>
      ${(S.arbeitszeit || []).length ? `<div class="hint" style="margin-top:12px">
        ${S.arbeitszeit.map(z => `<div class="verlaufzeile" data-azid="${z.id}">
            <b>${Number(z.stunden || 0).toFixed(2)} h</b> – ${esc(new Date(z.datum).toLocaleDateString('de-CH'))}
            ${z.kuerzel ? ' · ' + esc(z.kuerzel) : ''}${z.taetigkeit ? ' · ' + esc(z.taetigkeit) : ''}
            <button class="iconbtn az_del" title="Eintrag löschen">🗑</button>
          </div>`).join('')}
        </div>` : ''}
    </div>

    <div class="card">
      <h3 style="margin-top:0">Dokumente</h3>
      <div class="hint">Pro Anlage entstehen ein <b>Sicherheitsnachweis (SiNa)</b> und ein
        <b>${k.pv ? 'Mess- und Prüfprotokoll Photovoltaik' : 'Mess- und Prüfprotokoll'}</b>.
        Die Angaben stammen aus den Reitern Kunde, Anlagen, Sichtkontrolle und Messen sowie aus den
        Firmenangaben (⚙️ Optionen).</div>
      ${(S.anlagen || []).length ? (S.anlagen || []).map(a => `
        <div class="row" style="align-items:center;margin-top:10px" data-aid="${a.id}">
          <div style="flex:1;font-weight:600">${esc(a.name || 'Anlage ohne Name')}
            ${a.zaehler_nr ? `<span class="hint" style="display:inline">– Zähler ${esc(a.zaehler_nr)}</span>` : ''}</div>
          <button class="btn small" data-dok="sina">⬇︎ SiNa</button>
          <button class="btn small" data-dok="mpp">⬇︎ ${k.pv ? 'PV-MPP' : 'MPP'}</button>
          <button class="btn small" data-dok="csv">⬇︎ CSV</button>
        </div>`).join('')
        : '<div class="empty">Noch keine Anlage erfasst.</div>'}
      <label class="f" style="margin-top:12px">
        <input type="checkbox" id="csvKopf" ${S.csvKopf ? 'checked' : ''} style="width:auto;margin-right:8px">
        Kopfzeile im CSV einschliessen</label>
      <div class="hint">Das CSV enthält die Messtabelle der Anlage, mit Tabulator getrennt – wie in der
        Sync-Version.</div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Kontrolle als Datei</h3>
      <div class="hint">Sichert <b>diese Kontrolle</b> mit allen Anlagen, Messwerten, Mängeln und Fotos
        als Datei. Sie lässt sich im Reiter 🗂 Kontrollen über «Import» wieder einlesen – dabei entsteht
        immer eine <b>neue</b> Kontrolle, es wird nie etwas überschrieben.</div>
      <div class="btnrow">
        <button class="btn" id="btnKDatei">⬇︎ Kontrolle sichern</button>
        <button class="btn" id="btnKTeilen">📤 Teilen</button>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Kontrollbericht</h3>
      <div class="hint">Mängel und Informationen mit den erfassten <b>Fotos</b>, gruppiert nach Anlage.
        Anhaken, welche Anlagen <b>zusammen in einen Bericht</b> kommen – für Einzelberichte jeweils nur
        eine anwählen und erneut erstellen.</div>
      <div class="chips" id="berAnlagen" style="margin-top:10px">
        ${(S.anlagen || []).map(a => `<label class="chip"><input type="checkbox" class="ber_a" value="${a.id}" checked
            style="width:auto;margin-right:6px">${esc(a.name || 'Anlage ohne Name')}</label>`).join('')}
        <label class="chip"><input type="checkbox" id="ber_ohne" checked style="width:auto;margin-right:6px">Ohne Anlage / Allgemein</label>
      </div>
      <label class="f" style="margin-top:14px">Kontrolleure im Bericht</label>
      <div class="chips" id="berTeam">
        ${(S.team || []).map(p => `<label class="chip"><input type="checkbox" class="ber_p" value="${p.id}"
            ${(k.kontrolleure || []).includes(p.id) ? 'checked' : ''}
            style="width:auto;margin-right:6px">${esc(p.name || p.kuerzel)}</label>`).join('')
          || '<span class="hint">Keine freigeschalteten Mitarbeiter gefunden.</span>'}
      </div>
      <div class="hint">Erscheinen im Kopf unter «Kontrolle am / durch» mit Telefon und E-Mail.
        <b>Unterschreiben kann jede Person nur selbst</b> – und eine Unterschrift genügt.</div>

      <label class="f" style="margin-top:14px">Berichtsart</label>
      <div class="typtoggle" id="berArt">
        <button class="b_kunde ${S.berichtArt === 'intern' ? '' : 'on'}">Für den Kunden</button>
        <button class="b_intern ${S.berichtArt === 'intern' ? 'on' : ''}">Intern</button>
      </div>
      <div class="hint">${S.berichtArt === 'intern'
        ? 'Interner Bericht: enthält Mängel, Informationen UND Notizen – nicht für den Kunden bestimmt.'
        : 'Kundenbericht: enthält Mängel und Informationen, aber keine Notizen.'}</div>
      <div class="btnrow">
        <button class="btn primary" id="btnBericht">⬇︎ Kontrollbericht erstellen</button>
        <button class="btn" id="btnBerichtMail">✉️ Bericht per Mail senden</button>
      </div>
      <div class="hint">«Per Mail senden» erstellt das PDF und öffnet das Teilen-Menü – dort <b>Mail</b> wählen,
        der Bericht ist bereits angehängt. Die Adresse des Eigentümers
        <b>${esc((k.eig || {}).mail || '(keine E-Mail erfasst)')}</b> wird in die Zwischenablage kopiert.</div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Unterschriften</h3>
      ${gesperrt ? '' : `<div class="hint">Wähle aus, in welcher Eigenschaft du unterschreibst. Sobald
        unterschrieben ist, wird die Kontrolle gesperrt.</div>
      <div class="row" style="align-items:flex-end">
        <div class="narrow" style="flex:0 0 auto">
          <label class="f"><input type="checkbox" id="u_kb" checked style="width:auto;margin-right:8px">Kontrollberechtigter</label>
          <label class="f"><input type="checkbox" id="u_ub" style="width:auto;margin-right:8px">Unterschriftsberechtigter</label>
        </div>
        <div class="narrow" style="flex:0 0 auto"><button class="btn primary" id="btnSign">🖊 Jetzt unterschreiben</button></div>
      </div>`}
      ${(S.unterschriften || []).length ? `<div class="hint" style="margin-top:12px">
        ${S.unterschriften.map(u => `<b>${esc(u.name)}</b> – ${esc(u.rolle === 'kontrollberechtigt' ? 'Kontrollberechtigter' : 'Unterschriftsberechtigter')},
           ${esc(fmtDate(u.gesetzt_am))}${u.firma_id !== S.profil.firma_id ? ' <i>(Partnerfirma)</i>' : ''}`).join('<br>')}</div>
        ${istErstellerfirma()
          ? '<div class="btnrow"><button class="btn danger" id="btnUnsign">Alle Unterschriften entfernen</button></div>'
          : '<div class="hint">Entfernen kann nur die Firma, welche die Kontrolle angelegt hat.</div>'}`
        : '<div class="hint">Noch nicht unterschrieben. <b>Eine Unterschrift genügt</b>, um die Kontrolle abzuschliessen.</div>'}
    </div>`;

  const kopie = $('#btnKopie');
  if (kopie) kopie.addEventListener('click', async () => {
    if (!confirm('Eine Kopie dieser Kontrolle erstellen?\n\nDie Kopie gehört deiner Firma, ist wieder '
      + 'bearbeitbar und enthält keine Unterschriften. Diese Kontrolle bleibt unverändert.')) return;
    kopie.disabled = true;
    const { data, error } = await sb.rpc('kontrolle_kopieren', { k_id: k.id });
    kopie.disabled = false;
    if (error) return fehler(error);
    alert('Die Kopie wurde angelegt und wird jetzt geöffnet.');
    await kontrolleOeffnen(data);
  });

  $$('#statusChips .chip').forEach(c => c.addEventListener('click', async () => {
    if (gesperrt) return alert('Die Kontrolle ist unterschrieben – der Status kann nicht mehr geändert werden.');
    k.status = c.dataset.s;
    k.status_rank = STATUS_STUFEN.indexOf(k.status);
    feldSpeichern('kontrollen', k.id, 'status', k.status);
    feldSpeichern('kontrollen', k.id, 'status_rank', k.status_rank);
    // Wechsel mit Datum festhalten
    const zeile = await zeileAnlegen('status_verlauf', {
      kontrolle_id: k.id, status: k.status, kuerzel: S.profil.kuerzel || '',
      benutzer_id: S.profil.id, gesetzt_am: new Date().toISOString()
    });
    S.statusVerlauf.push(zeile);
    renderAbschluss();
  }));

  $$('.sv_del').forEach(b => b.addEventListener('click', async () => {
    const id = b.closest('.verlaufzeile').dataset.vid;
    if (!confirm('Diesen Eintrag aus dem Statusverlauf löschen?')) return;
    await zeileLoeschen('status_verlauf', id);
    S.statusVerlauf = S.statusVerlauf.filter(z => z.id !== id);
    renderAbschluss();
  }));

  $('#az_add').addEventListener('click', async () => {
    const stunden = Number($('#az_std').value.replace(',', '.'));
    if (!stunden || stunden <= 0) return alert('Bitte die Stunden eintragen (z.B. 1.5).');
    const zeile = await zeileAnlegen('arbeitszeit', {
      kontrolle_id: k.id, benutzer_id: S.profil.id, kuerzel: S.profil.kuerzel || '',
      datum: $('#az_datum').value || new Date().toISOString().slice(0, 10),
      stunden, taetigkeit: $('#az_txt').value.trim()
    });
    S.arbeitszeit.push(zeile);
    renderAbschluss();
  });

  $$('.az_del').forEach(b => b.addEventListener('click', async () => {
    const id = b.closest('.verlaufzeile').dataset.azid;
    if (!confirm('Diesen Arbeitszeit-Eintrag löschen?')) return;
    await zeileLoeschen('arbeitszeit', id);
    S.arbeitszeit = S.arbeitszeit.filter(z => z.id !== id);
    renderAbschluss();
  }));

  $('#csvKopf').addEventListener('change', e => { S.csvKopf = e.target.checked; });

  $$('.row[data-aid] button').forEach(b => b.addEventListener('click', async () => {
    const aid = b.closest('.row').dataset.aid;
    b.disabled = true;
    const alt = b.textContent;
    b.textContent = '⏳ …';
    try {
      if (b.dataset.dok === 'csv') {
        const a = (S.anlagen || []).find(x => x.id === aid);
        const { data: gruppen, error } = await sb.from('gruppen').select('*')
          .eq('anlage_id', aid).order('reihenfolge');
        if (error) throw error;
        const name = [k.auftrag_nr, 'Messwerte', a.name || 'Anlage', (k.strasse + ' ' + k.hausnr).trim()]
          .filter(Boolean).join('_').replace(/[\\/:*?"<>|]+/g, ' ');
        dateiSpeichern(name + '.csv', csvText(gruppen || [], !!S.csvKopf),
          'text/tab-separated-values;charset=utf-8');
      } else {
        await dokumentErzeugen(b.dataset.dok, aid);
      }
    } catch (e) { fehler(e); }
    b.disabled = false;
    b.textContent = alt;
  }));

  const kontrollDateiname = () => [k.auftrag_nr, 'Kontrolle', (k.strasse + ' ' + k.hausnr).trim(),
    (k.plz + ' ' + k.ort).trim()].filter(Boolean).join('_').replace(/[\\/:*?"<>|]+/g, ' ') + '.ekon';

  $('#btnKDatei').addEventListener('click', () => mitKnopf($('#btnKDatei'), async () => {
    const paket = await kontrolleSammeln(k.id, true);
    dateiSpeichern(kontrollDateiname(), JSON.stringify(paket), 'application/json');
  }, '⏳ wird gesammelt …'));

  $('#btnKTeilen').addEventListener('click', () => mitKnopf($('#btnKTeilen'), async () => {
    const paket = await kontrolleSammeln(k.id, true);
    const datei = new File([JSON.stringify(paket)], kontrollDateiname(), { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [datei] })) {
      await navigator.share({ files: [datei], title: kontrollDateiname() });
    } else {
      dateiSpeichern(kontrollDateiname(), JSON.stringify(paket), 'application/json');
      alert('Teilen wird hier nicht unterstützt – die Datei wurde stattdessen heruntergeladen.');
    }
  }, '⏳ wird gesammelt …'));

  $('#berArt .b_kunde').addEventListener('click', () => { S.berichtArt = 'kunde'; renderAbschluss(); });
  $('#berArt .b_intern').addEventListener('click', () => { S.berichtArt = 'intern'; renderAbschluss(); });
  $$('.ber_p').forEach(c => c.addEventListener('change', () => {
    k.kontrolleure = $$('.ber_p').filter(x => x.checked).map(x => x.value);
    feldSpeichern('kontrollen', k.id, 'kontrolleure', k.kontrolleure);
  }));

  const berichtWahl = () => {
    const anlageIds = $$('.ber_a').filter(c => c.checked).map(c => c.value);
    const ohneAnlage = $('#ber_ohne').checked;
    if (!anlageIds.length && !ohneAnlage) { alert('Bitte mindestens eine Anlage anhaken.'); return null; }
    return { anlageIds, ohneAnlage, intern: S.berichtArt === 'intern' };
  };
  const mitKnopf = async (knopf, arbeit, text) => {
    const alt = knopf.textContent;
    knopf.disabled = true;
    knopf.textContent = text;
    try { await arbeit(); }
    catch (e) { if (!e || e.name !== 'AbortError') fehler(e); }
    knopf.disabled = false;
    knopf.textContent = alt;
  };

  $('#btnBericht').addEventListener('click', () => {
    const wahl = berichtWahl();
    if (wahl) mitKnopf($('#btnBericht'), () => berichtPdf(wahl), '⏳ Bericht wird erstellt …');
  });

  $('#btnBerichtMail').addEventListener('click', () => {
    const wahl = berichtWahl();
    if (!wahl) return;
    mitKnopf($('#btnBerichtMail'), async () => {
      const { blob, dateiname } = await berichtPdf(Object.assign({ alsDatei: true }, wahl));
      const datei = new File([blob], dateiname + '.pdf', { type: 'application/pdf' });
      const adresse = [(k.strasse + ' ' + k.hausnr).trim(), (k.plz + ' ' + k.ort).trim()].filter(Boolean).join(', ');
      const mail = (k.eig || {}).mail || '';
      // Das Teilen-Menü kann keinen Empfänger vorgeben – darum in die Zwischenablage
      if (mail && navigator.clipboard) { try { await navigator.clipboard.writeText(mail); } catch (e) { /* egal */ } }
      if (navigator.canShare && navigator.canShare({ files: [datei] })) {
        await navigator.share({ files: [datei], title: 'Kontrollbericht ' + adresse });
        return;
      }
      // Ohne Teilen-Menü (meist am Rechner): herunterladen und Mail-Entwurf öffnen
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = dateiname + '.pdf';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
      const betreff = 'Kontrollbericht ' + adresse;
      const text = `Guten Tag\n\nIm Anhang erhalten Sie den Kontrollbericht zur elektrischen Anlage ${adresse}.\n\n`
        + `Freundliche Grüsse\n${S.profil.name || ''}\n${(S.firma || {}).name || ''}`;
      location.href = `mailto:${encodeURIComponent(mail)}?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(text)}`;
      alert('Teilen wird hier nicht unterstützt – das PDF wurde heruntergeladen und ein Mail-Entwurf geöffnet.\n'
        + 'Das PDF bitte von Hand anhängen.');
    }, '⏳ PDF wird erstellt …');
  });

  const sign = $('#btnSign');
  if (sign) sign.addEventListener('click', unterschreiben);
  const unsign = $('#btnUnsign');
  if (unsign) unsign.addEventListener('click', async () => {
    if (!confirm('Wirklich alle Unterschriften entfernen?\n\nDanach ist die Kontrolle wieder bearbeitbar '
      + 'und alle Beteiligten müssen neu unterschreiben.')) return;
    const namen = S.unterschriften.map(u => u.name).join(', ');
    await auftragEinreihen({ art: 'delete_wo', tabelle: 'unterschriften',
      spalte: 'kontrolle_id', wert: S.kontrolle.id });
    await auftragEinreihen({ art: 'insert', tabelle: 'unterschriften_log', werte: {
      kontrolle_id: S.kontrolle.id,
      beschreibung: 'Unterschriften entfernt (' + namen + ')',
      entfernt_von: S.profil.id
    } });
    S.unterschriften = [];
    paketNachfuehren();
    renderAbschluss();
  });
}

async function unterschreiben() {
  const rollen = [];
  if ($('#u_kb').checked) rollen.push('kontrollberechtigt');
  if ($('#u_ub').checked) rollen.push('unterschriftsberechtigt');
  if (!rollen.length) return alert('Bitte mindestens eine Eigenschaft anhaken.');

  const setzen = async bild => {
    const zeilen = rollen.map(r => ({
      kontrolle_id: S.kontrolle.id, dokument: 'kontrollbericht', rolle: r,
      firma_id: S.profil.firma_id, benutzer_id: S.profil.id,
      name: S.profil.name || S.profil.kuerzel, bild,
      pruefsumme: String(S.kontrolle.updated_at || '')
    }));
    const angelegt = [];
    for (const z of zeilen) angelegt.push(await zeileAnlegen('unterschriften', z));
    S.unterschriften = (S.unterschriften || []).concat(angelegt);
    renderAbschluss();
  };

  if (S.profil.unterschrift) {
    if (confirm('Deine hinterlegte Unterschrift verwenden?\n\n«Abbrechen» = jetzt neu unterschreiben.')) {
      return setzen(S.profil.unterschrift);
    }
  }
  // Neu zeichnen – der Dialog steckt im Unterschriftsfeld
  const box = document.createElement('div');
  document.body.appendChild(box);
  unterschriftsFeld(box, null, async bild => {
    box.remove();
    if (bild) await setzen(bild);
  });
  const knopf = box.querySelector('button');
  if (knopf) knopf.click();
}

/* ============================================================
   PDF: Sicherheitsnachweis (SiNa) – pro Anlage
   Aufbau wie der abgenommene Prototyp: aussen ein Rahmen, nur Trennlinien
   zwischen den Abteilen, eingeschriebene Werte fett, Ω → «MOhm».
   ============================================================ */

async function dokumentErzeugen(art, anlageId) {
  if (!window.jspdf) throw new Error('PDF-Bibliothek nicht geladen');
  const a = (S.anlagen || []).find(x => x.id === anlageId);
  if (!a) throw new Error('Anlage nicht gefunden');
  const { data: gruppen } = await sb.from('gruppen').select('*').eq('anlage_id', a.id).order('reihenfolge');
  let doc, bezeichnung;
  if (art === 'sina') {
    doc = sinaPdf(a, gruppen || []);
    bezeichnung = 'Sicherheitsnachweis';
  } else {
    const { data: sicht } = await sb.from('sichtkontrolle').select('*').eq('anlage_id', a.id);
    const abgehakt = {};
    (sicht || []).forEach(z => { abgehakt[z.punkt] = z.wert; });
    doc = S.kontrolle.pv ? pvPdf(a, gruppen || [], abgehakt) : mppPdf(a, gruppen || [], abgehakt);
    bezeichnung = S.kontrolle.pv ? 'Mess- und Prüfprotokoll PV' : 'Mess- und Prüfprotokoll';
  }
  const name = [S.kontrolle.auftrag_nr, bezeichnung, a.name || 'Anlage',
                (S.kontrolle.strasse + ' ' + S.kontrolle.hausnr).trim(),
                (S.kontrolle.plz + ' ' + S.kontrolle.ort).trim()]
    .filter(Boolean).join('_').replace(/[\\/:*?"<>|]+/g, ' ');
  doc.save(name + '.pdf');
}

/* ============================================================
   PDF: Kontrollbericht – Mängelliste mit Fotos, Informationen und
   (nur im internen Bericht) Notizen. Aufbau wie in der Sync-Version,
   damit die Kunden dasselbe Dokument erhalten wie bisher.
   Masseinheit hier mm (die Formular-PDFs rechnen in Punkt).
   ============================================================ */

// Ein Foto aus dem Dateispeicher als Data-URL holen (für jsPDF nötig)
async function fotoDatenUrl(pfad) {
  let data = await ablageLesen('fotos', pfad);
  if (!data) {
    if (!navigator.onLine) return null;
    const antwort = await sb.storage.from('fotos').download(pfad);
    data = antwort.data;
  }
  if (!data) return null;
  return await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(data);
  });
}

function berichtDateiname(anlagen, intern) {
  const k = S.kontrolle;
  const teil = anlagen.length ? anlagen.map(a => a.name || 'Anlage').join(', ') : 'Allgemein';
  const adr = [(k.strasse + ' ' + k.hausnr).trim(), (k.plz + ' ' + k.ort).trim()].filter(Boolean).join(', ');
  return [k.auftrag_nr, intern ? 'int. Kontrollbericht' : 'Kontrollbericht', teil, adr]
    .filter(Boolean).join('_').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

async function berichtPdf(wahl) {
  if (!window.jspdf) throw new Error('PDF-Bibliothek nicht geladen');
  const { jsPDF } = window.jspdf;
  const k = S.kontrolle, f = S.firma || {}, eig = k.eig || {};
  const G = await grundLaden();
  if (!S.maengel) await maengelLaden();
  if (!S.unterschriften) await unterschriftenLaden();

  const intern = !!wahl.intern;
  const anlagen = (S.anlagen || []).filter(a => wahl.anlageIds.includes(a.id));
  const ohneAnlage = m => !m.anlage_id || !(S.anlagen || []).some(a => a.id === m.anlage_id);
  const dabei = m => wahl.anlageIds.includes(m.anlage_id) || (wahl.ohneAnlage && ohneAnlage(m));
  const vomTyp = t => S.maengel.filter(m => (m.typ || 'mangel') === t && dabei(m));
  const maengel = vomTyp('mangel'), infos = vomTyp('info'), notizen = intern ? vomTyp('notiz') : [];

  const heute = new Date().toLocaleDateString('de-CH');
  // Wer hat kontrolliert: die im Abschluss angehakten Mitarbeiter. Ist niemand
  // angehakt, gelten die Unterzeichnenden, sonst die angemeldete Person.
  const team = await teamLaden();
  const gewaehlt = (k.kontrolleure || []).map(id => team.find(p => p.id === id)).filter(Boolean);
  const personen = gewaehlt.length
    ? gewaehlt.map(p => ({ name: p.name || p.kuerzel, tel: p.telefon, mail: p.mail }))
    : ((S.unterschriften || []).length
      ? S.unterschriften.map(u => ({ name: u.name, tel: '', mail: '' }))
      : [{ name: S.profil.name || S.profil.kuerzel, tel: S.profil.telefon, mail: S.profil.mail }]);
  // Unterschrieben wird immer persönlich – die Bilder kommen aus den Unterschriften
  const unterzeichner = (S.unterschriften || []).length
    ? S.unterschriften.map(u => ({ name: u.name, bild: u.bild }))
    : [];

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 15, CW = W - 2 * M, BOTTOM = 282;
  let y = M;
  const platz = h => { if (y + h > BOTTOM) { doc.addPage(); y = M; } };
  const wrap = (t, b) => doc.splitTextToSize(String(t || '–'), b);
  const bildArt = d => d.includes('image/png') ? 'PNG' : 'JPEG';

  /* ---- Kopf ---- */
  const kopfOben = y;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(intern ? 'Kontrollbericht (intern)' : 'Kontrollbericht', M + 3, y + 8);
  const auftragTitel = 'Auftrag: ' + ([k.auftrag_nr, k.auftrag_bez].filter(Boolean).join(' ') || '–');
  doc.setFontSize(10);
  if (doc.getTextWidth(auftragTitel) > 115) doc.setFontSize(8.5);
  doc.text(auftragTitel, W - M - 3, y + 8, { align: 'right' });
  doc.setFontSize(10);
  y += 11;
  doc.setLineWidth(0.3); doc.line(M, y, W - M, y);
  y += 2.5;

  const L1 = M + 3, V1 = M + 38, L2 = M + 100, V2 = M + 128;
  const V1W = L2 - V1 - 4, V2W = W - M - V2 - 3, L1W = V1 - L1 - 2;
  const kopfZeile = (l1, v1, l2, v2) => {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(90);
    const la = wrap(l1, L1W);
    doc.text(la, L1, y + 3.5);
    if (l2) doc.text(wrap(l2, V2 - L2 - 2), L2, y + 3.5);
    doc.setTextColor(0); doc.setFont('helvetica', 'bold');
    const a = wrap(v1, V1W), b = l2 ? wrap(v2, V2W) : [];
    doc.text(a, V1, y + 3.5);
    if (l2) doc.text(b, V2, y + 3.5);
    doc.setFont('helvetica', 'normal');
    y += Math.max(a.length, b.length, la.length) * 4 + 2.5;
  };
  const anlagenNamen = anlagen.map(a => (a.name || 'Anlage ohne Name') + (a.zaehler_nr ? ' (Zähler ' + a.zaehler_nr + ')' : ''))
    .concat(wahl.ohneAnlage && S.maengel.some(ohneAnlage) ? ['Allgemein'] : []);

  // Auftragnehmer mit der Bewilligungsnummer: als Kontrollorgan die K-Nummer,
  // als Elektro-Installateur die I-Nummer.
  const nummer = k.rolle_ersteller === 'installateur'
    ? (f.inst_bewilligung ? 'Inst.-Bew. ' + f.inst_bewilligung : '')
    : (f.kontroll_bewilligung ? 'Kontroll-Bew. ' + f.kontroll_bewilligung : '');
  kopfZeile('Auftraggeber (Eigentümer)',
    [eig.name, eig.strasse, [eig.plz, eig.ort].filter(Boolean).join(' ')].filter(Boolean).join('\n') || '–',
    'Auftragnehmer',
    [f.name, f.strasse, [f.plz, f.ort].filter(Boolean).join(' '), nummer].filter(Boolean).join('\n') || '–');
  kopfZeile('Ort der Installation',
    [(k.strasse + ' ' + k.hausnr).trim(), [k.plz, k.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '–',
    'Gebäudeart', k.gebaeudeart || '–');
  kopfZeile('Auftragsbezeichnung', k.auftrag_bez || '–', 'VNB', k.vnb || '–');
  kopfZeile('Kontrollumfang', k.kontrollumfang || '–', 'Anlage(n)', anlagenNamen.join(', ') || '–');
  kopfZeile('Kontrolle am / durch', heute + '\n' + personen.map(p => p.name).join('\n'),
    'Tel. / E-Mail',
    personen.map(p => [p.tel || f.telefon, p.mail].filter(Boolean).join(' · ') || '–').join('\n'));
  kopfZeile('Mängel',
    maengel.length ? `[X] Ja (${maengel.length})      [  ] Nein` : '[  ] Ja      [X] Nein', '', '');
  doc.rect(M, kopfOben, CW, y - kopfOben);
  y += 8;

  /* ---- Fotos eines Eintrags, zwei nebeneinander ---- */
  const fotosZeichnen = async pfade => {
    let x = M + 5, hoechste = 0;
    for (const pfad of (pfade || [])) {
      let d;
      try { d = await fotoDatenUrl(pfad); } catch (e) { d = null; }
      if (!d) continue;
      let p;
      try { p = doc.getImageProperties(d); } catch (e) { continue; }
      let w = 75, h = w * p.height / p.width;
      if (h > 75) { h = 75; w = h * p.width / p.height; }
      if (x > M + 5 && x + w > W - M) {          // passt nicht mehr daneben → neue Reihe
        y += hoechste + 4; x = M + 5; hoechste = 0;
      }
      if (y + h > BOTTOM) { doc.addPage(); y = M; x = M + 5; hoechste = 0; }
      doc.addImage(d, bildArt(d), x, y, w, h);
      x += w + 4;
      hoechste = Math.max(hoechste, h);
    }
    if (hoechste) y += hoechste + 4;
  };

  /* ---- Mängelliste ---- */
  platz(12);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text('Mängelliste', M, y + 5); y += 9;

  if (!maengel.length) {
    doc.setFontSize(10.5); doc.setFont('helvetica', 'normal');
    platz(8); doc.text('Keine Mängel festgestellt.', M, y + 4); y += 8;
  } else {
    const gruppen = [];
    for (const a of anlagen) {
      const ms = maengel.filter(m => m.anlage_id === a.id);
      if (ms.length) gruppen.push({ titel: (a.name || 'Anlage ohne Name') + (a.zaehler_nr ? ' – Zähler ' + a.zaehler_nr : ''), ms });
    }
    const ohne = maengel.filter(ohneAnlage);
    if (ohne.length) gruppen.push({ titel: 'Allgemein / ohne Anlage', ms: ohne });

    let nr = 0;
    for (const grp of gruppen) {
      platz(14);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text(grp.titel, M, y + 4);
      doc.setLineWidth(0.2); doc.line(M, y + 5.5, W - M, y + 5.5);
      y += 9;
      for (const m of grp.ms) {
        nr++;
        const zeilen = wrap(m.text || '–', CW - 10);
        platz(6 + Math.min(zeilen.length, 5) * 4.3);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
        doc.text(nr + '.  ' + (m.ort || '–'), M, y + 4); y += 6.5;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
        for (const z of zeilen) { platz(5); doc.text(z, M + 5, y + 3.2); y += 4.3; }
        y += 2;
        await fotosZeichnen(m.fotos);
        y += 2;
      }
    }
  }

  /* ---- Informationen und (nur intern) Notizen ---- */
  const anlageName = id => { const a = (S.anlagen || []).find(x => x.id === id); return a ? (a.name || 'Anlage ohne Name') : ''; };
  for (const teil of [{ titel: 'Information', items: infos }, { titel: 'Notizen (intern)', items: notizen }]) {
    if (!teil.items.length) continue;
    platz(14);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text(teil.titel, M, y + 5); y += 9;
    for (const m of teil.items) {
      const kopf = [anlageName(m.anlage_id), m.ort].filter(Boolean).join(' – ');
      const zeilen = wrap(m.text || '–', CW - 10);
      platz((kopf ? 6.5 : 0) + Math.min(zeilen.length, 5) * 4.3);
      if (kopf) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
        doc.text(kopf, M, y + 4); y += 6.5;
      }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      for (const z of zeilen) { platz(5); doc.text(z, M + 5, y + 3.2); y += 4.3; }
      y += 2;
      await fotosZeichnen(m.fotos);
      y += 2;
    }
  }

  /* ---- Datum und Unterschrift ---- */
  const bilder = unterzeichner.map(u => u.bild).filter(Boolean);
  platz(bilder.length ? 28 : 20);
  y += 5;
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.text('Datum', M + 2, y + 5);
  doc.setFont('helvetica', 'bold'); doc.text(heute, M + 18, y + 5);
  doc.setFont('helvetica', 'normal'); doc.text('Unterschrift', M + 78, y + 5);
  doc.setFont('helvetica', 'bold');
  const namen = (unterzeichner.length ? unterzeichner : personen).map(p => p.name).join(' / ');
  doc.text(namen || '–', M + 101, y + 5);
  doc.setFont('helvetica', 'normal');
  if (bilder.length) {
    let bx = M + 101;
    for (const b of bilder) {
      try {
        const p = doc.getImageProperties(b);
        const h = 14, w = Math.min(h * p.width / p.height, 40);
        if (bx + w > W - M) break;
        doc.addImage(b, bildArt(b), bx, y + 7, w, h);
        bx += w + 4;
      } catch (e) { /* Bild nicht lesbar – dann nur der Name */ }
    }
    y += 26;
  } else {
    doc.setLineWidth(0.3); doc.line(M + 101, y + 13, M + 168, y + 13);
    y += 18;
  }

  /* ---- Erledigungstext und Bestätigung (nur wenn Mängel) ---- */
  if (maengel.length) {
    doc.setFontSize(9.5);
    const erl = wrap(G.erledigungsText || '', CW - 8);
    const kopfTxt = wrap('Die Unterzeichnenden bestätigen, dass die Mängel gemäss Kontrollbericht nach NIV Art. 3 + 4 behoben wurden.', CW - 6);
    const kh = kopfTxt.length * 4.2 + 4;
    platz(erl.length * 4.2 + 8 + kh + 26 + 8);
    y += 3;
    doc.setLineWidth(0.25);
    doc.rect(M, y, CW, erl.length * 4.2 + 5);
    doc.text(erl, M + 4, y + 4.5);
    y += erl.length * 4.2 + 9;
    doc.setFillColor(235, 235, 235);
    doc.rect(M, y, CW, kh, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.text(kopfTxt, M + 3, y + 4.5);
    y += kh;
    const sp = CW / 3, zh = 26;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(60);
    for (let i = 0; i < 3; i++) doc.rect(M + i * sp, y, sp, zh);
    doc.text('Datum der Mängelbehebung', M + 2, y + 4);
    doc.text('Firmenstempel', M + sp + 2, y + 4);
    doc.text(wrap('Unterschrift fachkundige Person oder Elektro-Kontrolleur gemäss NIV Art. 27', sp - 4), M + 2 * sp + 2, y + 4);
    doc.setTextColor(0);
  }

  const dateiname = berichtDateiname(anlagen, intern);
  if (wahl.alsDatei) return { blob: doc.output('blob'), dateiname };
  doc.save(dateiname + '.pdf');
  return { dateiname };
}

// Mitarbeiter der eigenen Firma (freigeschaltet) – für die Kontrolleur-Auswahl
S.team = null;
async function teamLaden() {
  if (S.team) return S.team;
  const { data, error } = await sb.from('benutzer')
    .select('id,name,kuerzel,telefon,mail,status')
    .eq('firma_id', S.profil.firma_id).eq('status', 'frei').order('name');
  if (error) { fehler(error); return []; }
  S.team = data;
  return data;
}

/* ============================================================
   PDF: Mess- und Prüfprotokoll – Seite 1 Angaben und Prüflisten,
   Folgeseite(n) quer mit der Messtabelle
   ============================================================ */

/* PV-Protokoll: gleicher Aufbau wie das MPP, aber mit den PV-Angaben der Anlage
   (Module, Wechselrichter, Stränge) und der PV-Prüfliste. Die Kategorie 2
   entfällt, «Prüfergebnis Kategorie 1» heisst nur «Prüfergebnis». */
function pvPdf(a, gruppen, abgehakt) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const k = S.kontrolle, f = S.firma || {};
  const L = 39.6, R = 569.6, X1 = L + 6.8, MID = 304.6, X2 = MID + 8.4;
  const ZH = 12.6, ZL = 11.2, UNTEN = 790;
  const W = pdfWerkzeuge(doc, L, R);
  const pv = (a.sk_angaben || {}).pv || {};      // PV-Angaben hängen an der Anlage
  const wirInstallateur = k.rolle_ersteller === 'installateur';
  const eig = k.eig || {};
  const bew = wirInstallateur ? (f.inst_bewilligung || '') : (f.kontroll_bewilligung || '');

  const tabelle = (y, spalten, zeilen, titel) => {
    if (titel) W.label(X1, y + 10, titel, 7.5);
    let yy = y + (titel ? 14 : 0);
    const xs = [L];
    spalten.slice(0, -1).forEach(([b]) => xs.push(xs[xs.length - 1] + b));
    xs.push(R);
    W.line(L, yy, R, yy);
    spalten.forEach(([, kopf], i) => String(kopf).split('\n')
      .forEach((z, j) => W.label(xs[i] + 3, yy + 8 + j * 7, z, 6.2)));
    const kopfUnten = yy + 17;
    W.line(L, kopfUnten, R, kopfUnten);
    yy = kopfUnten;
    zeilen.forEach(zeile => {
      spalten.forEach(([, , schluessel], i) => {
        const v = zeile[schluessel];
        if (v) W.wert(xs[i] + 4, yy + 9, v, 7.5);
      });
      yy += 13;
      W.line(L, yy, R, yy, 0.25);
    });
    xs.forEach(x => W.line(x, y + (titel ? 14 : 0), x, yy));
    W.line(R, y + (titel ? 14 : 0), R, yy);
    return yy;
  };

  const blockSystem = y => {
    W.titel(X1, y + 11, 'Angaben zum installierten System', 8.5);
    let yy = y + 11 + ZL;
    W.label(X1, yy, 'Projekt'); W.wert(X1 + 50, yy, pv.projekt || a.name);
    yy += ZL;
    W.label(X1, yy, 'Nennleistung des Systems (bei STC)');
    W.wert(X1 + 190, yy, pv.kwdc || ''); W.label(X1 + 230, yy, 'kW DC');
    W.wert(X1 + 300, yy, pv.kvaac || ''); W.label(X1 + 335, yy, 'kVA AC');
    yy += ZL;
    W.label(X1, yy, 'Anlagenbeschrieb');
    let xs = X1 + 90;
    ['Flachdach', 'Schrägdach', 'Fassade', 'integriert', 'freistehend']
      .forEach(s => { xs += W.haken(xs, yy, s, pv.beschrieb === s) + 8; });
    yy += ZL;
    W.label(X1, yy, 'Ausrichtung'); W.wert(X1 + 60, yy, pv.ausrichtung || '');
    W.label(X1 + 160, yy, 'Neigung'); W.wert(X1 + 205, yy, pv.neigung || ''); W.label(X1 + 240, yy, '°');
    W.label(X1 + 260, yy, 'Anlagentyp');
    xs = X1 + 320;
    ['Netzverbund', 'Inselanlage'].forEach(s => { xs += W.haken(xs, yy, s, pv.typ === s) + 8; });
    yy += ZL;
    W.label(X1, yy, 'Kurzbeschrieb'); W.wert(X1 + 70, yy, pv.kurz || '');
    yy += ZL;
    W.label(X1, yy, 'Datum Inbetriebnahme'); W.wert(X1 + 110, yy, pv.inbetriebnahme || '');
    W.label(X1 + 200, yy, 'Montagezeitraum von'); W.wert(X1 + 310, yy, pv.montage_von || '');
    W.label(X1 + 380, yy, 'bis'); W.wert(X1 + 398, yy, pv.montage_bis || '');
    return yy + 6;
  };

  const blockModule = y => tabelle(y, [
    [40, 'Typ Nr.', 'typ'], [100, 'Hersteller', 'hersteller'], [100, 'Modultyp', 'modultyp'],
    [42, 'Pmpp\n[W]', 'pmpp'], [38, 'Umpp\n[V]', 'umpp'], [38, 'Impp\n[A]', 'impp'],
    [38, 'Uoc\n[V]', 'uoc'], [38, 'Isc\n[A]', 'isc'], [38, 'Irück\n[A]', 'irueck'],
    [0, 'Anzahl\n[St.]', 'anzahl']], pv.module || [], 'Angaben PV-Module') + 4;

  const blockWr = y => tabelle(y, [
    [40, 'Typ Nr.', 'typ'], [110, 'Hersteller', 'hersteller'], [110, 'Modell', 'modell'],
    [110, '(freies Feld)', 'frei'], [48, 'PAC\n[kVA]', 'pac'], [44, 'Galv.\nTrenn.', 'galv'],
    [0, 'Anzahl\n[St.]', 'anzahl']], pv.wr || [], 'Angaben Wechselrichter / Leistungsoptimierer') + 4;

  const blockStraenge = y => tabelle(y, [
    [56, 'Strang Nr.', 'nr'], [90, 'Modultyp Nr.', 'modultyp'], [100, 'Anz. Module je Strang', 'anzahl'],
    [96, 'Verschaltet auf WR Nr.', 'wr'], [70, 'Teilarray\n(S/O/N/W)', 'teilarray'],
    [56, 'Typ', 'typ'], [0, 'Querschnitt\n[mm2]', 'querschnitt']],
    pv.straenge || [], 'Angaben zum PV-Array und PV-Strang') + 4;

  const blockStrangmessung = y => tabelle(y, [
    [44, 'Strang Nr.', 'nr'], [44, 'Polarität\ngeprüft', 'polaritaet'], [44, 'Verpolung\nGAK', 'verpolung'],
    [62, 'UOC Gen. max', 'uocgen'], [52, 'ISC STC\nx 1.25', 'iscstc'], [44, 'UOC\n[V]', 'uoc'],
    [44, 'ISC\n[A]', 'isc'], [48, 'RISO\n[MOhm]', 'riso'], [44, 'Umpp\n[V]', 'umpp'],
    [44, 'Impp\n[A]', 'impp'], [0, 'RPA\n[Ohm]', 'rpa']],
    pv.strangmessungen || [], 'Funktionsprüfung und Messungen – Stränge') + 4;

  // Bausteine, die mit dem MPP übereinstimmen, werden dort wiederverwendet
  const gemeinsam = mppBloecke(W, doc, { L, R, X1, X2, MID, ZH, ZL }, a, abgehakt, eig, f, bew, wirInstallateur, SICHT_PV);

  const bloecke = [gemeinsam.parteien, gemeinsam.ort, gemeinsam.anlage, gemeinsam.pruefgrund,
                   gemeinsam.ergebnis, gemeinsam.unterschriften,
                   blockSystem, blockModule, blockWr, blockStraenge,
                   gemeinsam.liste('Sichtprüfung des Systems (Ziffer 5.2)'),
                   gemeinsam.geraete, blockStrangmessung];

  let seiten = 1;
  const kopf = nr => {
    let y = 25.5;
    W.line(L, y, R, y);
    W.titel(X1, y + 16, 'Mess- und Prüfprotokoll PV', 13);
    W.label(MID + 4, y + 16, 'Nummer'); W.wert(MID + 60, y + 16, k.auftrag_nr, 9);
    W.line(MID, y, MID, y + 22); W.line(R - 100, y, R - 100, y + 22);
    W.label(R - 90, y + 16, 'Seite'); W.wert(R - 70, y + 16, String(nr));
    return y + 22;
  };
  let y = kopf(1);
  W.trenner(y);
  const oben = 25.5;
  bloecke.forEach(fn => {
    W.trocken = true;
    const hoehe = fn(y) - y;
    W.trocken = false;
    if (y + hoehe > UNTEN) {
      W.line(L, oben, L, y); W.line(R, oben, R, y);
      doc.addPage(); seiten++;
      y = kopf(seiten); W.trenner(y);
    }
    y = fn(y);
    W.trenner(y);
  });
  W.line(L, oben, L, y); W.line(R, oben, R, y);

  messtabelleQuer(doc, k, a, f, gruppen, wirInstallateur, () => ++seiten);
  seitenzahlen(doc, seiten, 'M+P PV 2020');
  return doc;
}

/* Gemeinsame Bausteine für MPP und PV-Protokoll. Jede Funktion zeichnet ab y
   und gibt die Unterkante zurück – so lassen sie sich frei aneinanderreihen. */
function mppBloecke(W, doc, M, a, abgehakt, eig, f, bew, wirInstallateur, sichtListe) {
  const { L, R, X1, X2, MID, ZH, ZL } = M;
  const k = S.kontrolle;
  const G = S.grund || GRUND_STANDARD;

  const parteien = y => {
    const partei = (x0, y0, titel, d, rollen, gewaehlt, mitBew) => {
      W.titel(x0, y0 + 12, titel, 9);
      let xs = x0 + 96, yr = y0 + 12;
      rollen.forEach((r, i) => {
        if (i === 3) { xs = x0 + 96; yr += ZL; }
        xs += W.haken(xs, yr, r, gewaehlt === r) + 12;
      });
      let yy = yr + ZH;
      const zeilen = [['Name', d.name], ['Strasse, Nr.', d.strasse], ['PLZ / Ort', null], ['Tel.-Nr.', d.tel]];
      if (mitBew) zeilen.push(['Bewilligungs-Nr.', d.bew]);
      zeilen.forEach(([lbl, v]) => {
        W.label(x0, yy, lbl);
        if (lbl === 'PLZ / Ort') { W.wert(x0 + 66, yy, d.plz); W.wert(x0 + 108, yy, d.ort); }
        else W.wert(x0 + 66, yy, v);
        yy += ZH;
      });
      return yy - ZH + 6;
    };
    const u1 = partei(X1, y, 'Auftraggeber',
      { name: eig.name, strasse: eig.strasse, plz: eig.plz, ort: eig.ort, tel: eig.tel },
      ['Eigentümer', 'Verwaltung', 'Stromk.', 'Installateur'], 'Eigentümer');
    const u2 = partei(X2, y, 'Auftragnehmer',
      { name: f.name, strasse: f.strasse, plz: f.plz, ort: f.ort, tel: f.telefon, bew },
      ['Elektro-Installateur', 'Kontrollorgan'],
      wirInstallateur ? 'Elektro-Installateur' : 'Kontrollorgan', true);
    const ende = Math.max(u1, u2);
    W.line(MID, y, MID, ende);
    return ende;
  };

  const ort = y => {
    W.titel(X1, y + 12, 'Ort der Installation');
    W.label(X1 + 118, y + 12, 'VNB Objekt-Nr.'); W.wert(X1 + 178, y + 12, k.vnb_objekt_nr);
    W.label(X2, y + 12, 'EGID'); W.wert(X2 + 66, y + 12, k.egid);
    let yy = y + 12 + ZH + 1;
    W.label(X1, yy, 'Strasse, Nr.'); W.wert(X1 + 66, yy, k.strasse); W.wert(X1 + 186, yy, k.hausnr);
    W.label(X2, yy, 'Gebäudeart'); W.wert(X2 + 66, yy, k.gebaeudeart);
    yy += ZH;
    W.label(X1, yy, 'PLZ / Ort'); W.wert(X1 + 66, yy, k.plz); W.wert(X1 + 108, yy, k.ort);
    W.label(X2, yy, 'Bemerkung'); W.wert(X2 + 66, yy, k.bemerkung);
    yy += ZH;
    W.label(X1, yy, 'Gemeinde / Parz. Nr.'); W.wert(X1 + 108, yy, (k.gemeinde + '  ' + k.parz_nr).trim());
    return yy + 6;
  };

  const anlage = y => {
    W.titel(X1, y + 12, 'Anlage');
    W.label(X2, y + 12, 'Nutzung und Kontrollperiode(n)');
    W.label(R - 30, y + 12, 'Jahre');
    let yy = y + 12 + ZH + 1;
    W.wert(X2, yy, a.periode2_txt); W.rechts(R - 14, yy, a.periode);
    const n2 = (a.sk_angaben || {}).nutzung2;
    if (n2 || a.periode2) { W.wert(X2, yy + ZH, n2 || ''); W.rechts(R - 14, yy + ZH, a.periode2); }
    W.label(X1, yy, 'Stockw., Lage'); W.wert(X1 + 66, yy, a.stockwerk);
    yy += ZH;
    W.label(X1, yy, 'Stromkunde'); W.wert(X1 + 66, yy, a.stromkunde);
    yy += ZH;
    W.label(X1, yy, 'Zähler-Nr.'); W.wert(X1 + 66, yy, a.zaehler_nr);
    W.label(X2, yy, 'Inst.-Anzeige Nr./ Jahr');
    const KA0 = k.kontrollart || {};
    W.wert(X2 + 92, yy, KA0.anzeige_nr || ''); W.txt(X2 + 140, yy, KA0.anzeige_nr ? '/' : '');
    W.wert(X2 + 148, yy, KA0.anzeige_jahr || '');
    return yy + 6;
  };

  const pruefgrund = y => {
    const P = k.pruefgrund || {}, KA = k.kontrollart || {}, CK = X1 + 118;
    W.titel(X1, y + 12, 'Prüfgrund');
    W.titel(CK, y + 12, 'Durchgeführte Kontrolle');
    W.titel(X2, y + 12, 'Kontrollumfang / ausgeführte Installation');
    let yy = y + 12 + ZH + 1;
    const oben = yy;
    W.haken(X1, yy, 'Neuanlage', P.neuanlage); W.haken(CK, yy, 'Schlusskontrolle (NIV Art. 14)', KA.sk);
    yy += ZH;
    W.haken(X1, yy, 'Bestehende Anlage', P.bestehend); W.haken(CK, yy, 'Schlusskontrolle (NIV Art. 7/9)', KA.sk79);
    yy += ZH;
    W.haken(X1 + 12, yy, 'Änderung', P.aenderung); W.haken(CK, yy, 'Abnahmekontrolle (AK)', KA.ak);
    yy += ZH;
    W.haken(X1 + 12, yy, 'Erweiterung', P.erweiterung); W.haken(CK, yy, 'Periodische Kontrolle (PK)', KA.pk);
    yy += ZH;
    W.kasten(X1, yy - 5.6, !!P.freitext); W.txt(X1 + 10, yy, P.freitext || '', 7.5);
    yy += ZH;
    W.label(X1, yy, 'Datum der Kontrolle SK'); W.wert(X1 + 108, yy, KA.datum_sk || '');
    W.label(X2, yy, 'Datum der Kontrolle AK/PK'); W.wert(X2 + 150, yy, KA.datum_akpk || '');
    W.umbruch(k.kontrollumfang, R - X2 - 10, 8.5, true).forEach((z, i) => {
      if (oben + i * ZH < yy - ZH + 1) W.wert(X2, oben + i * ZH, z);
    });
    return yy + 6;
  };

  // Prüfpunkte aus dem Reiter Sichtkontrolle, zweispaltig
  const liste = titel => y => {
    W.titel(X1, y + 11, titel, 9);
    let yy = y + 11 + ZL;
    const punkte = sichtListe.filter(([s]) => s !== 'gruppe');
    const haelfte = Math.ceil(punkte.length / 2);
    punkte.forEach(([schluessel, text], i) => {
      const links = i < haelfte;
      const x = links ? X1 : X2;
      const zeileY = yy + (links ? i : i - haelfte) * ZL;
      W.kasten(x, zeileY - 5.6, abgehakt[schluessel] === 'ok');
      W.umbruch(text, (links ? MID - 14 : R - 6) - x - 12, 6.6).slice(0, 1)
        .forEach(z => W.txt(x + 10, zeileY, z, 6.6));
    });
    return yy + haelfte * ZL + 2;
  };

  const geraete = y => {
    W.titel(X1, y + 11, 'Verwendete Messgeräte nach', 8.5);
    W.wert(X1 + 148, y + 11, 'SN EN 61557');
    W.titel(X2, y + 11, 'Prüfung durchgeführt nach', 8.5);
    let yy = y + 11 + ZL;
    W.label(X1, yy, '(Fabrikat und Typ)');
    const geraeteliste = (k.messgeraete || G.messgeraete || '').split('\n').filter(Boolean);
    geraeteliste.forEach((g, i) => W.wert(X1, yy + (i + 1) * ZL, g));
    const normen = k.pv
      ? ['NIV', 'SN EN 62446-1', 'SNR 464022 Blitzschutz', 'NIN SN 411000:2025']
      : ['NIV', 'SN EN 61439', 'Werkvorschriften (TAB)', 'NIN SN 411000:2025'];
    normen.forEach((n, i) => W.haken(X2 + (i % 2) * 150, yy + Math.floor(i / 2) * ZL, n, i === 0 || i === 3));
    return yy + Math.max(geraeteliste.length + 1, 2) * ZL + 6;
  };

  const ergebnis = y => {
    W.titel(X1, y + 11, 'Prüfergebnis', 8.5);
    if (k.pv) W.label(X1 + 76, y + 11, '(Ziffer 6 der SN EN 62446-1)');
    else W.titel(X1 + 148, y + 11, 'Messungen', 8.5);
    const yy = y + 11 + ZL;
    W.haken(X1, yy, 'keine Mängel festgestellt', (S.maengel || []).filter(istMangel).length === 0);
    W.txt(X1 + 148, yy, k.pv
      ? 'Die Funktionsprüfungen und Messungen sind bei jeder PVA zwingend vorzunehmen.'
      : 'Die Messungen auf den Folgeseiten sind Bestandteil dieses Dokuments.', 7.5);
    return yy + 6;
  };

  const unterschriften = y => {
    W.titel(X1, y + 12, 'Unterschrift Auftragnehmer', 9);
    W.label(X2, y + 12, 'Gegenzeichnung', 9);
    const yy = y + 12 + ZH;
    const heute = new Date().toLocaleDateString('de-CH');
    const u = (S.unterschriften || []).find(z => z.rolle === 'kontrollberechtigt');
    W.label(X1, yy, 'Datum'); W.wert(X1 + 34, yy, u ? heute : '');
    W.label(X1, yy + ZH, 'Kontrollberechtigter');
    if (u && u.bild) { try { doc.addImage(u.bild, 'PNG', X1, yy + 18, 100, 32); } catch (e) { /* Bild nicht lesbar */ } }
    W.wert(X1, yy + 52, u ? u.name : '');
    W.line(X1, yy + 56, X1 + 200, yy + 56, 0.3);
    W.txt(X1, yy + 63, 'Vorname Name (Blockschrift)', 5, false, true);
    W.label(X2 + 150, yy, 'Datum');
    W.line(X2 + 150, yy + 56, R - 6, yy + 56, 0.3);
    W.txt(X2 + 150, yy + 63, 'Vorname Name (Blockschrift)', 5, false, true);
    W.line(MID, y, MID, yy + 68);
    return yy + 68;
  };

  return { parteien, ort, anlage, pruefgrund, liste, geraete, ergebnis, unterschriften };
}

/* Messtabelle im Querformat – eigene Seite(n), bricht bei vielen Zeilen um */
function messtabelleQuer(doc, k, a, f, gruppen, wirInstallateur, seiteGezaehlt) {
  doc.addPage('a4', 'landscape');
  seiteGezaehlt();
  const QL = 28, QR = 813.89, QX = QL + 6.8, ZH = 12.6;
  const Q = pdfWerkzeuge(doc, QL, QR);
  let qy = 25;
  Q.line(QL, qy, QR, qy);
  Q.titel(QX, qy + 16, (k.pv ? 'Mess- und Prüfprotokoll PV' : 'Mess- und Prüfprotokoll') + ' – Messungen', 11);
  Q.label(QR - 240, qy + 16, 'Nr.'); Q.wert(QR - 200, qy + 16, k.auftrag_nr);
  let yy = qy + 22;
  Q.line(QL, yy, QR, yy);
  Q.label(QX, yy + 12, wirInstallateur ? 'Elektro-Installateur:' : 'Kontrollorgan:');
  Q.wert(QX + 130, yy + 12, (f.name || '') + (f.ort ? ', ' + f.ort : ''));
  Q.label(QR - 240, yy + 12, 'Netzbetreiberin:'); Q.wert(QR - 160, yy + 12, k.vnb);
  yy += ZH + 4;
  Q.label(QX, yy + 12, 'Ort der Installation:');
  Q.wert(QX + 130, yy + 12, (k.strasse + ' ' + k.hausnr).trim() + ',  ' + k.ort);
  Q.label(QR - 240, yy + 12, 'Anlage:'); Q.wert(QR - 160, yy + 12, a.name);
  yy += ZH + 6;
  Q.line(QL, yy, QR, yy);
  Q.line(QL, qy, QL, yy); Q.line(QR, qy, QR, yy);

  const SP = [[30, 'Strom-\nkreis', 'Nr.', 'nr'], [140, 'Ort / Anlageteil', 'Bezeichnung', 'bez'],
              [38, 'Leitung / Kabel', 'Art\nTyp', 'art'], [50, '', 'Leiteranz./\nQuer.[mm²]', 'leiter'],
              [46, 'Überstrom-\nschutzeinr.', 'Art\nCharakt.', 'charakt'], [30, '', 'IN\n[A]', 'in_a'],
              [44, 'Messungen (gemessener Wert)', 'IK Anf.\n[A]', 'ik_anf_pe'], [44, '', 'IK Ende\n[A]', 'ik_end_pe'],
              [44, '', 'IK Anf.\n[A]', 'ik_anf_n'], [44, '', 'IK Ende\n[A]', 'ik_end_n'],
              [48, '', 'RISO [MOhm]\nILeck [mA]', 'riso'], [48, '', 'Leitfähigk.\nSchutzl.[Ohm]', 'rlo'],
              [38, 'Fehlerstromschutz (RCD)', 'IN/Typ\n[A]', 'rcd_in'], [34, '', 'IdN\n[mA]', 'idn'],
              [56, '', 'Auslösezeit\n[ms / ok]', 'ausl'], [0, 'Weiteres', 'Drehfeld', 'weiteres']];
  const GG = [0, 1, 2, 4, 6, 12, 15];
  const xs = [QL];
  SP.slice(0, -1).forEach(([b]) => xs.push(xs[xs.length - 1] + b));
  xs.push(QR);

  const tabellenkopf = yStart => {
    Q.line(QL, yStart, QR, yStart);
    SP.forEach(([, k1], i) => {
      if (!k1) return;
      const naechste = GG.find(g => g > i);
      const gb = (naechste !== undefined ? xs[naechste] : QR) - xs[i] - 4;
      Q.umbruch(k1, gb, 5.6, true).forEach((z, j) => Q.txt(xs[i] + 2, yStart + 8 + j * 6.5, z, 5.6, true));
    });
    const spaltenOben = yStart + 22;
    GG.forEach(i => Q.line(xs[i], yStart, xs[i], spaltenOben));
    Q.line(QR, yStart, QR, spaltenOben);
    Q.line(QL, spaltenOben, QR, spaltenOben);
    SP.forEach(([, , k2], i) => String(k2).split('\n')
      .forEach((z, j) => Q.txt(xs[i] + 2, spaltenOben + 7 + j * 6, z, 5.4, false, true)));
    const kopfUnten = spaltenOben + 16;
    Q.line(QL, kopfUnten, QR, kopfUnten);
    return { kopfUnten, spaltenOben };
  };

  let { kopfUnten, spaltenOben } = tabellenkopf(yy + 8);
  let zy = kopfUnten;
  gruppen.forEach(g => {
    if (zy + 14 > 560) {
      xs.forEach(x => Q.line(x, spaltenOben, x, zy));
      Q.line(QR, spaltenOben, QR, zy);
      doc.addPage('a4', 'landscape');
      seiteGezaehlt();
      const neu = tabellenkopf(40);
      kopfUnten = neu.kopfUnten; spaltenOben = neu.spaltenOben;
      zy = kopfUnten;
    }
    SP.forEach(([, , , feld], i) => {
      const v = g[feld];
      if (!v) return;
      let size = 6.5;
      const platz = xs[i + 1] - xs[i] - 4;
      while (Q.breite(v, size, true) > platz && size > 4.6) size -= 0.3;
      Q.txt(xs[i] + 2, zy + 10, v, size, true);
    });
    zy += 14;
    Q.line(QL, zy, QR, zy, 0.25);
  });
  xs.forEach(x => Q.line(x, spaltenOben, x, zy));
  Q.line(QR, spaltenOben, QR, zy);
}

/* Seitenzahlen und Fusszeilen – erst am Schluss, wenn die Gesamtzahl feststeht */
function seitenzahlen(doc, seiten, formularname) {
  for (let i = 1; i <= seiten; i++) {
    doc.setPage(i);
    const quer = doc.internal.pageSize.getWidth() > doc.internal.pageSize.getHeight();
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(100);
    doc.text(formularname, quer ? 28 : 39.6, quer ? 575 : 820);
    doc.text('Elektrokontrolle online', (quer ? 813.89 : 569.6) - 110, quer ? 575 : 820);
    doc.setFontSize(7.5);
    doc.text('Seite ' + i + ' von ' + seiten, (quer ? 813.89 : 569.6) - 60, quer ? 40 : 20);
    doc.setTextColor(0);
  }
}

function mppPdf(a, gruppen, abgehakt) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const k = S.kontrolle, f = S.firma || {};
  const M = { L: 39.6, R: 569.6, X1: 46.4, MID: 304.6, X2: 313, ZH: 12.6, ZL: 11.2 };
  const { L, R, X1, MID } = M;
  const UNTEN = 790;
  const W = pdfWerkzeuge(doc, L, R);
  const wirInstallateur = k.rolle_ersteller === 'installateur';
  const eig = k.eig || {};
  const bew = wirInstallateur ? (f.inst_bewilligung || '') : (f.kontroll_bewilligung || '');

  const B = mppBloecke(W, doc, M, a, abgehakt, eig, f, bew, wirInstallateur, SICHT_STANDARD);
  const bloecke = [B.parteien, B.ort, B.anlage, B.pruefgrund,
                   B.liste('Sichtprüfung, Funktionsprüfung und Dokumentation'),
                   B.geraete, B.ergebnis, B.unterschriften];

  let seiten = 1;
  const kopf = nr => {
    let y = 25.5;
    W.line(L, y, R, y);
    W.titel(X1, y + 16, 'Mess- und Prüfprotokoll', 13);
    W.label(MID + 4, y + 16, 'Nummer'); W.wert(MID + 60, y + 16, k.auftrag_nr, 9);
    W.line(MID, y, MID, y + 22); W.line(R - 100, y, R - 100, y + 22);
    W.label(R - 90, y + 16, 'Seite'); W.wert(R - 70, y + 16, String(nr));
    return y + 22;
  };

  let y = kopf(1);
  W.trenner(y);
  const oben = 25.5;
  bloecke.forEach(fn => {
    W.trocken = true;
    const hoehe = fn(y) - y;
    W.trocken = false;
    if (y + hoehe > UNTEN) {
      W.line(L, oben, L, y); W.line(R, oben, R, y);
      doc.addPage(); seiten++;
      y = kopf(seiten); W.trenner(y);
    }
    y = fn(y);
    W.trenner(y);
  });
  W.line(L, oben, L, y); W.line(R, oben, R, y);

  messtabelleQuer(doc, k, a, f, gruppen, wirInstallateur, () => ++seiten);
  seitenzahlen(doc, seiten, 'M+P 2018 V2');
  return doc;
}

/* Gemeinsame Zeichenwerkzeuge für alle Formulare.
   «trocken» = nur messen, nichts zeichnen – damit lässt sich vorab prüfen,
   ob ein Block noch auf die Seite passt. */
function pdfWerkzeuge(doc, L, R) {
  const GRAU = 100;
  const w = {
    trocken: false,
    line(x0, y0, x1, y1, dicke = 0.4) {
      if (w.trocken) return;
      doc.setLineWidth(dicke); doc.setDrawColor(0); doc.line(x0, y0, x1, y1);
    },
    txt(x, y, s, size = 8.5, bold = false, grau = false) {
      if (w.trocken || s === null || s === undefined || s === '') return;
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      doc.setTextColor(grau ? GRAU : 0);
      doc.text(String(s), x, y);
      doc.setTextColor(0);
    },
    wert(x, y, s, size = 8.5) { w.txt(x, y, s, size, true); },
    label(x, y, s, size = 7.5) { w.txt(x, y, s, size, false, true); },
    titel(x, y, s, size = 10) { w.txt(x, y, s, size, true); },
    breite(s, size = 7.5, bold = false) {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      return doc.getTextWidth(String(s || ''));
    },
    kasten(x, y, an) {
      if (w.trocken) return;
      doc.setLineWidth(0.5); doc.setDrawColor(140);
      doc.rect(x, y, 6.4, 6.4);
      doc.setDrawColor(0);
      if (an) { w.line(x + 1.2, y + 1.2, x + 5.2, y + 5.2, 0.8); w.line(x + 1.2, y + 5.2, x + 5.2, y + 1.2, 0.8); }
    },
    haken(x, yb, s, an, size = 7.5) {
      w.kasten(x, yb - 5.6, an);
      w.txt(x + 10, yb, s, size);
      return 10 + w.breite(s, size);
    },
    trenner(y, dick) { w.line(L, y, R, y, dick ? 0.7 : 0.4); },
    rechts(xr, y, s, size = 8.5) {
      if (!s) return;
      w.txt(xr - w.breite(s, size, true), y, s, size, true);
    },
    umbruch(s, breite, size = 8.5, bold = false) {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      return doc.splitTextToSize(String(s || ''), breite);
    }
  };
  return w;
}

function sinaPdf(a, gruppen) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const k = S.kontrolle, f = S.firma || {};
  const L = 39.6, R = 569.6, X1 = L + 6.8, MID = 304.6, X2 = MID + 8.4, ZH = 12.6;
  const W = pdfWerkzeuge(doc, L, R);
  const { line, txt, wert, label, titel, kasten, haken, trenner, rechts } = {
    line: W.line, txt: W.txt, wert: W.wert, label: W.label, titel: W.titel,
    kasten: W.kasten, haken: W.haken, trenner: W.trenner, rechts: W.rechts
  };

  // Beteiligte je nach Rolle: unsere Firma steht im passenden Feld
  const wirInstallateur = k.rolle_ersteller === 'installateur';
  const uns = { name: f.name || '', strasse: f.strasse || '', plz: f.plz || '', ort: f.ort || '',
                tel: f.telefon || '', bew: wirInstallateur ? (f.inst_bewilligung || '') : (f.kontroll_bewilligung || '') };
  const leer = { name: '', strasse: '', plz: '', ort: '', tel: '', bew: '' };
  const inst = wirInstallateur ? uns : leer;
  const ko = wirInstallateur ? leer : uns;
  const eig = k.eig || {}, verw = k.verwaltung || {};

  let y = 25.5;
  line(L, y, R, y);
  txt(X1, y + 20, 'Sicherheitsnachweis Elektroinstallationen (SiNa)', 13.5, true);
  txt(X1, y + 31, 'gemäss Verordnung über elektrische Niederspannungsinstallationen (NIV, SR 734.27)', 8.5);
  label(R - 140, y + 40, 'Nummer'); wert(R - 100, y + 40, k.auftrag_nr, 9);
  y += 48.9;
  trenner(y);

  const adressblock = (x0, y0, titelTxt, d, mitBew) => {
    titel(x0, y0 + 12, titelTxt);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    const tw = doc.getTextWidth(titelTxt);
    label(x0 + tw + 14, y0 + 12, 'Tel.-Nr'); wert(x0 + tw + 46, y0 + 12, d.tel);
    let yy = y0 + 12 + ZH + 1;
    const zeilen = [['Name', d.name], ['Strasse, Nr.', d.strasse], ['PLZ / Ort', null]];
    if (mitBew) zeilen.push(['Bewilligungs-Nr.', d.bew]);
    zeilen.forEach(([lbl, v]) => {
      label(x0, yy, lbl);
      if (lbl === 'PLZ / Ort') { wert(x0 + 66, yy, d.plz); wert(x0 + 108, yy, d.ort); }
      else wert(x0 + 66, yy, v);
      yy += ZH;
    });
    return yy - ZH + 6;
  };

  let y0 = y;
  let u1 = adressblock(X1, y0, 'Eigentümer', { name: eig.name, strasse: eig.strasse, plz: eig.plz, ort: eig.ort, tel: eig.tel });
  let u2 = adressblock(X2, y0, 'Verwaltung', { name: verw.name, strasse: verw.strasse, plz: verw.plz, ort: verw.ort, tel: verw.tel });
  y = Math.max(u1, u2);
  line(MID, y0, MID, y);
  trenner(y);

  y0 = y;
  u1 = adressblock(X1, y0, 'Elektro-Installateur', inst, true);
  u2 = adressblock(X2, y0, 'Unabhängiges Kontrollorgan', ko, true);
  y = Math.max(u1, u2);
  line(MID, y0, MID, y);
  trenner(y);

  // Ort der Installation
  titel(X1, y + 12, 'Ort der Installation');
  label(X1 + 118, y + 12, 'VNB Objekt-Nr.'); wert(X1 + 178, y + 12, k.vnb_objekt_nr);
  label(X2, y + 12, 'EGID'); wert(X2 + 66, y + 12, k.egid);
  let yy = y + 12 + ZH + 1;
  label(X1, yy, 'Strasse, Nr.'); wert(X1 + 66, yy, k.strasse); wert(X1 + 186, yy, k.hausnr);
  label(X2, yy, 'Gebäudeart'); wert(X2 + 66, yy, k.gebaeudeart);
  yy += ZH;
  label(X1, yy, 'PLZ / Ort'); wert(X1 + 66, yy, k.plz); wert(X1 + 108, yy, k.ort);
  label(X2, yy, 'Bemerkung'); wert(X2 + 66, yy, k.bemerkung);
  yy += ZH;
  label(X1, yy, 'Gemeinde / Parz. Nr.'); wert(X1 + 108, yy, (k.gemeinde + '  ' + k.parz_nr).trim());
  y = yy + 6;
  line(L, y, R, y, 0.7);

  // Anlage
  titel(X1, y + 12, 'Anlage');
  label(X2, y + 12, 'Nutzung und Kontrollperiode(n)');
  label(R - 30, y + 12, 'Jahre');
  yy = y + 12 + ZH + 1;
  wert(X2, yy, a.periode2_txt); rechts(R - 14, yy, a.periode);
  if ((a.sk_angaben && a.sk_angaben.nutzung2) || a.periode2) {
    wert(X2, yy + ZH, (a.sk_angaben || {}).nutzung2 || ''); rechts(R - 14, yy + ZH, a.periode2);
  }
  label(X1, yy, 'Stockw., Lage'); wert(X1 + 66, yy, a.stockwerk);
  yy += ZH;
  label(X1, yy, 'Stromkunde'); wert(X1 + 66, yy, a.stromkunde);
  yy += ZH;
  label(X1, yy, 'Zähler-Nr.'); wert(X1 + 66, yy, a.zaehler_nr);
  y = yy + 6;
  trenner(y);

  // Prüfgrund / Kontrolle / Umfang
  const P = k.pruefgrund || {}, KA = k.kontrollart || {};
  const CK = X1 + 118;
  titel(X1, y + 12, 'Prüfgrund');
  titel(CK, y + 12, 'Durchgeführte Kontrolle');
  titel(X2, y + 12, 'Kontrollumfang / ausgeführte Installation');
  yy = y + 12 + ZH + 1;
  const umfangOben = yy;
  haken(X1, yy, 'Neuanlage', P.neuanlage); haken(CK, yy, 'Schlusskontrolle (NIV Art. 14)', KA.sk);
  yy += ZH;
  haken(X1, yy, 'Bestehende Anlage', P.bestehend); haken(CK, yy, 'Schlusskontrolle (NIV Art. 7/9)', KA.sk79);
  yy += ZH;
  haken(X1 + 12, yy, 'Änderung', P.aenderung); haken(CK, yy, 'Abnahmekontrolle (AK)', KA.ak);
  yy += ZH;
  haken(X1 + 12, yy, 'Erweiterung', P.erweiterung); haken(CK, yy, 'Periodische Kontrolle (PK)', KA.pk);
  yy += ZH;
  kasten(X1, yy - 5.6, !!P.freitext); txt(X1 + 10, yy, P.freitext || '', 7.5);
  yy += ZH;
  label(X1, yy, 'Datum der Kontrolle SK'); wert(X1 + 108, yy, KA.datum_sk || '');
  label(X2, yy, 'Datum der Kontrolle AK/PK'); wert(X2 + 150, yy, KA.datum_akpk || '');
  // Kontrollumfang mehrzeilig
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
  doc.splitTextToSize(String(k.kontrollumfang || ''), R - X2 - 10).forEach((z, i) => {
    if (umfangOben + i * ZH < yy - ZH + 1) wert(X2, umfangOben + i * ZH, z);
  });
  y = yy + 6;
  trenner(y);

  // Technische Angaben (Zuleitung = erste Gruppe)
  const zul = gruppen[0] || {};
  titel(X1, y + 12, 'Technische Angaben');
  label(X1 + 190, y + 12, 'Schutz-System');
  let xs = X1 + 250;
  ['TN-S', 'TN-C', 'TN-C-S'].forEach(s => { xs += haken(xs, y + 12, s, a.schutzsystem === s) + 22; });
  yy = y + 12 + ZH;
  label(X1, yy, 'Anschlussüberstromunterbrecher');
  label(X1 + 190, yy, 'Art, Charakteristik');
  label(R - 90, yy, 'IN'); label(R - 30, yy, 'A');
  yy += ZH + 2;
  txt(X1, yy, 'Überstrom-Schutzorgan am Anschlusspkt. d. Inst.', 7, true);
  wert(X1 + 208, yy, k.hak || '', 8);
  yy += 10;
  const sp = [[X1, 128, 'Art, Charakteristik', 'charakt'], [X1 + 128, 50, 'IN [A]', 'in_a'],
              [X1 + 178, 62, 'IK Anf. [A]', 'ik_anf_pe'], [X1 + 240, 62, 'IK Ende [A]', 'ik_end_pe'],
              [X1 + 302, 62, 'IK Anf. [A]', 'ik_anf_n'], [X1 + 364, 62, 'IK Ende [A]', 'ik_end_n'],
              [X1 + 426, 50, 'RISO [MOhm]', 'riso'], [X1 + 476, 47, 'ILeck [mA]', 'ileck']];
  const mitte = (x0, x1, s) => { doc.setFontSize(7.5); label((x0 + x1 - doc.getTextWidth(s)) / 2, yy, s); };
  mitte(sp[2][0], sp[3][0] + sp[3][1], 'L-PE');
  mitte(sp[4][0], sp[5][0] + sp[5][1], 'L-N');
  yy += 4;
  const tabOben = yy;
  line(L, yy, R, yy);
  sp.forEach(([x, , t]) => label(x + 3, yy + 9, t, 6.6));
  yy += 12;
  line(L, yy, R, yy);
  sp.forEach(([x, , , feld]) => wert(x + 4, yy + 10, zul[feld] || ''));
  yy += 14;
  line(L, yy, R, yy);
  sp.slice(1).forEach(([x]) => line(x, tabOben, x, yy));
  line(X1, tabOben, X1, yy);
  yy += ZH + 2;
  label(X1, yy, 'Besonderheiten');
  y = yy + 6;
  line(L, y, R, y, 0.7);

  // Bestätigung + Unterschriften
  txt(X1, y + 10, 'Die Unterzeichneten bestätigen, dass die Installationen gemäss NIV (insb. Art. 3 und 4) und den '
    + 'gültigen Normen geprüft wurden und den anerkannten Regeln d. Technik entsprechen.', 5.8, true);
  txt(X1, y + 17, 'Dieses Dokument bildet den Sicherheitsnachweis für die erwähnten elektrischen Installationen im Sinne '
    + 'der NIV und ist vom Eigentümer bis zur nächsten (periodischen) Kontrolle', 5.4, false, true);
  txt(X1, y + 23, 'aufzubewahren. Wer vorgeschriebene Kontrollen nicht oder in schwerwiegender Weise nicht korrekt ausführt '
    + 'oder Installationen mit gefährlichen Mängeln dem Eigentümer übergibt,', 5.4, false, true);
  txt(X1, y + 29, 'macht sich strafbar (NIV Art. 42 c).', 5.4, false, true);

  yy = y + 42;
  titel(X1, yy, 'Unterschriften Elektro-Installateur', 8);
  titel(X2, yy, 'Unterschriften unabhängiges Kontrollorgan', 8);
  yy += ZH;
  const heute = new Date().toLocaleDateString('de-CH');
  const felder = [[X1, 'kontrollberechtigt', !wirInstallateur], [X1 + 128, 'unterschriftsberechtigt', !wirInstallateur],
                  [X2, 'kontrollberechtigt', wirInstallateur], [X2 + 128, 'unterschriftsberechtigt', wirInstallateur]];
  felder.forEach(([x, rolle, fremd]) => {
    // «fremd» = Feld der anderen Partei: bleibt leer
    const u = fremd ? null : (S.unterschriften || []).find(z => z.rolle === rolle);
    label(x, yy, 'Datum'); wert(x + 34, yy, u ? heute : '');
    label(x, yy + ZH, rolle === 'kontrollberechtigt' ? 'Kontrollberechtigter' : 'Unterschriftsberechtigter');
    if (u && u.bild) {
      try { doc.addImage(u.bild, 'PNG', x, yy + 20, 100, 34); } catch (e) { /* Bild nicht lesbar */ }
    }
    wert(x, yy + 58, u ? u.name : '');
    line(x, yy + 62, x + 118, yy + 62, 0.3);
    txt(x, yy + 69, 'Vorname Name (Blockschrift)', 5, false, true);
  });
  line(MID, y + 36, MID, yy + 74);
  y = yy + 74;
  trenner(y);
  line(L, 25.5, L, y); line(R, 25.5, R, y);

  txt(L, 820, 'SiNa 2018 V2', 6.5, false, true);
  txt(R - 110, 820, 'Elektrokontrolle online', 6.5, false, true);
  return doc;
}

/* ============================================================
   Lokale Ablage (IndexedDB): geöffnete Kontrollen, Fotos und die
   Warteschlange der noch nicht gesendeten Änderungen.
   Damit lässt sich im Keller ohne Empfang weiterarbeiten – und nichts
   geht verloren, wenn die App zwischendurch geschlossen wird.
   ============================================================ */

const ABLAGE = { name: 'nivonline', version: 1, stores: ['pakete', 'auftraege', 'fotos', 'merker'] };
let ablageOffen = null;

function ablage() {
  if (ablageOffen) return ablageOffen;
  ablageOffen = new Promise((res, rej) => {
    const anfrage = indexedDB.open(ABLAGE.name, ABLAGE.version);
    anfrage.onupgradeneeded = () => {
      const db = anfrage.result;
      if (!db.objectStoreNames.contains('pakete')) db.createObjectStore('pakete', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('auftraege')) db.createObjectStore('auftraege', { keyPath: 'nr', autoIncrement: true });
      if (!db.objectStoreNames.contains('fotos')) db.createObjectStore('fotos');
      if (!db.objectStoreNames.contains('merker')) db.createObjectStore('merker');
    };
    anfrage.onsuccess = () => res(anfrage.result);
    anfrage.onerror = () => rej(anfrage.error);
  });
  return ablageOffen;
}

function ablageTun(store, modus, arbeit) {
  return ablage().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, modus);
    const anfrage = arbeit(t.objectStore(store));
    t.oncomplete = () => res(anfrage ? anfrage.result : undefined);
    t.onerror = () => rej(t.error);
  }));
}

const ablageLesen = (store, key) => ablageTun(store, 'readonly', s => s.get(key));
const ablageAlle = store => ablageTun(store, 'readonly', s => s.getAll());
const ablageSchreiben = (store, wert, key) => ablageTun(store, 'readwrite', s => s.put(wert, key));
const ablageWeg = (store, key) => ablageTun(store, 'readwrite', s => s.delete(key));

/* ============================================================
   Warteschlange: JEDE Änderung geht zuerst hierhin und wird dann
   der Reihe nach gesendet. Die Reihenfolge muss stimmen – ein
   «update» darf nie vor dem «insert» derselben Zeile ankommen.
   ============================================================ */

let sendeLaeuft = false;
let offeneAuftraege = 0;
let letzteFehlermeldung = 0;

// Zu welcher Kontrolle gehört ein Auftrag? Nötig, damit das Aufräumen nichts
// wegwirft, was noch nicht auf dem Server ist.
function auftragKontrolle(a) {
  if (a.k_id) return a.k_id;
  if (a.art === 'foto_hoch' && a.pfad) return String(a.pfad).split('/')[0];
  if (a.art === 'foto_weg' && (a.pfade || []).length) return String(a.pfade[0]).split('/')[0];
  if (a.tabelle === 'kontrollen') return a.id || (a.werte && a.werte.id) || null;
  const w = Array.isArray(a.werte) ? a.werte[0] : a.werte;
  if (w && w.kontrolle_id) return w.kontrolle_id;
  return (S.kontrolle && S.kontrolle.id) || null;
}

async function auftragEinreihen(auftrag) {
  auftrag.zeit = Date.now();
  auftrag.k_id = auftragKontrolle(auftrag);
  await ablageSchreiben('auftraege', auftrag);
  offeneAuftraege++;
  warteAnzeige();
  // Mit Verbindung ist der Auftrag danach erledigt, ohne kehrt es sofort zurück
  await warteschlangeSenden();
}

// Eine Kontrolle auch in der lokalen Ablage nachführen (Liste und Paket),
// damit die Anzeige ohne Verbindung stimmt
async function lokalKontrolleAendern(id, werte) {
  try {
    const p = await ablageLesen('pakete', id);
    if (p && p.kontrolle) { Object.assign(p.kontrolle, werte); await ablageSchreiben('pakete', p); }
    const liste = await ablageLesen('merker', 'liste');
    if (liste) {
      const zeile = liste.find(k => k.id === id);
      if (zeile) { Object.assign(zeile, werte); await ablageSchreiben('merker', liste, 'liste'); }
    }
  } catch (e) { console.warn('Lokale Ablage:', e); }
}

// Führt einen einzelnen Auftrag gegen die Datenbank aus
async function auftragAusfuehren(a) {
  if (a.art === 'insert') return sb.from(a.tabelle).insert(a.werte);
  if (a.art === 'update') return sb.from(a.tabelle).update(a.werte).eq('id', a.id);
  if (a.art === 'delete') return sb.from(a.tabelle).delete().eq('id', a.id);
  if (a.art === 'delete_wo') return sb.from(a.tabelle).delete().eq(a.spalte, a.wert);
  if (a.art === 'upsert') return sb.from(a.tabelle).upsert(a.werte, { onConflict: a.konflikt });
  if (a.art === 'foto_hoch') {
    const blob = await ablageLesen('fotos', a.pfad);
    if (!blob) return { error: null };                 // schon weg – nichts zu tun
    return sb.storage.from('fotos').upload(a.pfad, blob, { contentType: 'image/jpeg', upsert: true });
  }
  if (a.art === 'foto_weg') return sb.storage.from('fotos').remove(a.pfade);
  return { error: null };
}

// Netzprobleme sind kein Fehler des Auftrags – dann bleibt er liegen.
function istNetzproblem(fehlerObj) {
  if (!navigator.onLine) return true;
  const t = ((fehlerObj && fehlerObj.message) || '').toLowerCase();
  return t.includes('fetch') || t.includes('network') || t.includes('load failed') || t.includes('timeout');
}

async function warteschlangeSenden() {
  if (sendeLaeuft || !navigator.onLine || !sb) return;
  sendeLaeuft = true;
  const abgelehnt = [];
  try {
    let liste = await ablageAlle('auftraege');
    offeneAuftraege = liste.length;
    if (liste.length) setSaveState('saving', '● Sendet…');
    for (const a of liste.sort((x, y) => x.nr - y.nr)) {
      let antwort;
      try { antwort = await auftragAusfuehren(a); }
      catch (e) { antwort = { error: e }; }
      if (antwort && antwort.error) {
        if (istNetzproblem(antwort.error)) {
          setSaveState('error', '⚡ offline – wird nachgeholt');
          return;                                     // Rest bleibt in der Schlange
        }
        // Echter Fehler (z.B. fehlende Berechtigung): Auftrag entfernen,
        // sonst blockiert er alles Weitere. Gemeldet wird gesammelt am Schluss.
        await ablageWeg('auftraege', a.nr);
        offeneAuftraege = Math.max(0, offeneAuftraege - 1);
        warteAnzeige();
        abgelehnt.push((a.tabelle || 'Foto') + ': ' + (antwort.error.message || antwort.error));
        continue;
      }
      await ablageWeg('auftraege', a.nr);
      offeneAuftraege = Math.max(0, offeneAuftraege - 1);
    }
    warteAnzeige();
    if (liste.length && !abgelehnt.length) setSaveState('saved', '✓ Gespeichert');
  } finally {
    sendeLaeuft = false;
    if (abgelehnt.length) {
      setSaveState('error', '⚠️ ' + abgelehnt.length + ' nicht gespeichert');
      // Bei einer ganzen Reihe von Fehlern nicht jedes Mal einen Kasten zeigen
      const jetzt = Date.now();
      if (jetzt - letzteFehlermeldung < 10000) return;
      letzteFehlermeldung = jetzt;
      alert('Diese Änderungen konnten nicht gespeichert werden:\n\n'
        + abgelehnt.slice(0, 3).join('\n')
        + (abgelehnt.length > 3 ? '\n… und ' + (abgelehnt.length - 3) + ' weitere' : '')
        + '\n\nMeist liegt es daran, dass die Kontrolle inzwischen unterschrieben wurde oder '
        + 'jemand anders sie gelöscht hat.');
    }
  }
}

function warteAnzeige() {
  const el = $('#netstate');
  if (!el) return;
  if (!navigator.onLine) {
    el.textContent = offeneAuftraege ? `⚡ offline · ${offeneAuftraege} wartet` : '⚡ offline';
    el.className = 'offline';
  } else if (offeneAuftraege) {
    el.textContent = `↻ ${offeneAuftraege} wird gesendet`;
    el.className = 'wartend';
  } else {
    el.textContent = '';
    el.className = '';
  }
}

/* ============================================================
   Paket = die ganze Kontrolle im Gerät. Wird beim Öffnen gefüllt und
   nach jeder Änderung nachgeführt; ohne Empfang lesen wir daraus.
   ============================================================ */

let paketTimer = null;

function paketNachfuehren() {
  clearTimeout(paketTimer);
  paketTimer = setTimeout(paketJetztSchreiben, 800);
}

async function paketJetztSchreiben() {
  const k = S.kontrolle;
  if (!k) return;
  try {
    const p = (await ablageLesen('pakete', k.id)) || { id: k.id };
    p.kontrolle = k;
    if (S.anlagen) p.anlagen = S.anlagen;
    if (S.maengel) p.maengel = S.maengel;
    if (S.arbeitszeit) p.arbeitszeit = S.arbeitszeit;
    if (S.statusVerlauf) p.status_verlauf = S.statusVerlauf;
    if (S.unterschriften) p.unterschriften = S.unterschriften;
    // Gruppen und Sichtkontrolle kennen wir nur für die gewählte Anlage –
    // darum nur deren Zeilen ersetzen, der Rest bleibt stehen.
    if (S.gruppen && S.anlageId) {
      p.gruppen = (p.gruppen || []).filter(g => g.anlage_id !== S.anlageId).concat(S.gruppen);
    }
    if (S.sicht && S.anlageId) {
      p.sichtkontrolle = (p.sichtkontrolle || []).filter(z => z.anlage_id !== S.anlageId)
        .concat(Object.values(S.sicht));
    }
    p.zeit = Date.now();
    await ablageSchreiben('pakete', p);
    S.paket = p;
  } catch (e) { console.warn('Lokale Ablage:', e); }
}

/* ============================================================
   Aufräumen im Gerät: Kontrollen, die 30 Tage nicht angefasst wurden,
   und Fotos, die zu keiner Kontrolle mehr gehören.
   NIE angetastet wird, was noch nicht auf dem Server ist.
   ============================================================ */

const ABLAGE_TAGE = 30;

async function ablageAufraeumen(tage) {
  const grenze = Date.now() - (tage || ABLAGE_TAGE) * 86400000;
  const auftraege = await ablageAlle('auftraege');
  const nochUnterwegs = new Set(auftraege.map(auftragKontrolle).filter(Boolean));
  const fotosUnterwegs = new Set(auftraege.filter(a => a.art === 'foto_hoch').map(a => a.pfad));

  const pakete = await ablageAlle('pakete');
  const behalten = new Set();          // Fotopfade, die wir weiter brauchen
  let wegKontrollen = 0, wegFotos = 0, gehalten = 0;
  for (const p of pakete) {
    const zuAlt = (p.zeit || 0) < grenze;
    const offen = nochUnterwegs.has(p.id);
    const jetztOffen = S.kontrolle && S.kontrolle.id === p.id;
    if (zuAlt && !offen && !jetztOffen) {
      await ablageWeg('pakete', p.id);
      wegKontrollen++;
      continue;
    }
    if (zuAlt && offen) gehalten++;
    (p.maengel || []).forEach(m => (m.fotos || []).forEach(f => behalten.add(f)));
  }

  const alleFotos = await ablageTun('fotos', 'readonly', s => s.getAllKeys());
  for (const pfad of (alleFotos || [])) {
    if (behalten.has(pfad) || fotosUnterwegs.has(pfad)) continue;
    await ablageWeg('fotos', pfad);
    wegFotos++;
  }
  return { wegKontrollen, wegFotos, gehalten };
}

// Was liegt im Gerät? Für die Anzeige in den Optionen
async function ablageStand() {
  const pakete = await ablageAlle('pakete');
  const fotos = (await ablageTun('fotos', 'readonly', s => s.getAllKeys())) || [];
  const auftraege = await ablageAlle('auftraege');
  let platz = null;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const s = await navigator.storage.estimate();
      platz = s.usage;
    }
  } catch (e) { /* nicht überall verfügbar */ }
  const aelteste = pakete.reduce((m, p) => (m === null || (p.zeit || 0) < m) ? (p.zeit || 0) : m, null);
  return { kontrollen: pakete.length, fotos: fotos.length, auftraege: auftraege.length, platz, aelteste };
}

// Standardwerte der Tabellen – nötig, weil eine offline angelegte Zeile
// nicht vom Server zurückkommt und trotzdem vollständig sein muss.
const VORLAGEN = {
  anlagen: { reihenfolge: 0, name: '', zaehler_nr: '', stromkunde: '', stockwerk: '', periode: '',
             periode2_txt: '', periode2: '', schutzsystem: '', erder: '', asbest: '',
             sk_angaben: {}, geprueft_von: [] },
  gruppen: { reihenfolge: 0, nr: '', bez: '', art: '', leiter: '', charakt: '', in_a: '',
             ik_anf_pe: '', ik_end_pe: '', ik_anf_n: '', ik_end_n: '', riso: '', ileck: '',
             rlo: '', rcd_in: '', idn: '', ausl: '', weiteres: '' },
  maengel: { anlage_id: null, typ: 'mangel', reihenfolge: 0, ort: '', text: '', fotos: [] },
  arbeitszeit: { kuerzel: '', datum: '', stunden: 0, taetigkeit: '' },
  status_verlauf: { status: '', kuerzel: '' },
  unterschriften: { dokument: 'kontrollbericht', rolle: '', name: '', bild: null, pruefsumme: '' }
};

// Neue Zeile: die Kennung entsteht im Gerät, darum geht es auch ohne Empfang
async function zeileAnlegen(tabelle, werte) {
  const zeile = Object.assign({ id: crypto.randomUUID() }, VORLAGEN[tabelle] || {}, werte);
  await auftragEinreihen({ art: 'insert', tabelle, werte: zeile });
  paketNachfuehren();
  return zeile;
}

async function zeileLoeschen(tabelle, id) {
  await auftragEinreihen({ art: 'delete', tabelle, id });
  paketNachfuehren();
}

// Zeilen holen: mit Verbindung vom Server, ohne aus der lokalen Ablage
async function zeilenHolen(tabelle, spalte, wert, sortierFeld) {
  if (navigator.onLine) {
    let q = sb.from(tabelle).select('*').eq(spalte, wert);
    if (sortierFeld) q = q.order(sortierFeld);
    const { data, error } = await q;
    if (!error) return data || [];
    if (!istNetzproblem(error)) { fehler(error); return []; }
  }
  const p = S.paket || (S.kontrolle ? await ablageLesen('pakete', S.kontrolle.id) : null);
  const zeilen = (p && p[tabelle]) ? p[tabelle].filter(z => z[spalte] === wert) : [];
  return sortierFeld
    ? zeilen.slice().sort((a, b) => (a[sortierFeld] || 0) - (b[sortierFeld] || 0))
    : zeilen.slice();
}

// Die ganze Kontrolle in einem Rutsch holen und ablegen
async function paketVomServer(id, mitFotos) {
  const hole = async (tabelle) => {
    const { data, error } = await sb.from(tabelle).select('*').eq('kontrolle_id', id);
    if (error) throw error;
    return data || [];
  };
  const { data: kopf, error } = await sb.from('kontrollen').select('*').eq('id', id).single();
  if (error) throw error;
  const p = {
    id, kontrolle: kopf, zeit: Date.now(),
    anlagen: await hole('anlagen'),
    gruppen: await hole('gruppen'),
    maengel: await hole('maengel'),
    sichtkontrolle: await hole('sichtkontrolle'),
    arbeitszeit: await hole('arbeitszeit'),
    status_verlauf: await hole('status_verlauf'),
    unterschriften: await hole('unterschriften')
  };
  await ablageSchreiben('pakete', p);
  if (mitFotos) {
    for (const m of p.maengel) {
      for (const pfad of (m.fotos || [])) {
        if (await ablageLesen('fotos', pfad)) continue;
        const { data } = await sb.storage.from('fotos').download(pfad);
        if (data) await ablageSchreiben('fotos', data, pfad);
      }
    }
  }
  return p;
}

// S.* aus dem Paket füllen (Reihenfolge wie beim Server)
function ausPaketFuellen(p) {
  const nach = (liste, feld) => (liste || []).slice().sort((a, b) => (a[feld] || 0) - (b[feld] || 0));
  S.kontrolle = p.kontrolle;
  S.anlagen = nach(p.anlagen, 'reihenfolge');
  S.maengel = nach(p.maengel, 'reihenfolge');
  S.arbeitszeit = (p.arbeitszeit || []).slice();
  S.statusVerlauf = (p.status_verlauf || []).slice()
    .sort((a, b) => String(a.gesetzt_am).localeCompare(String(b.gesetzt_am)));
  S.unterschriften = (p.unterschriften || []).slice();
  S.gruppen = null;              // hängen an der gewählten Anlage
  S.sicht = null;
  if (!S.anlagen.some(a => a.id === S.anlageId)) S.anlageId = S.anlagen.length ? S.anlagen[0].id : null;
  S.paket = p;
}

/* ============================================================
   Speichern – feldweise, damit mehrere gleichzeitig arbeiten können
   ============================================================ */

const speicherWarteschlange = new Map();   // "tabelle:id" → {feld: wert}
let speicherTimer = null;

function feldSpeichern(tabelle, id, feld, wert) {
  const schluessel = tabelle + ':' + id;
  const paket = speicherWarteschlange.get(schluessel) || {};
  paket[feld] = wert;
  speicherWarteschlange.set(schluessel, paket);
  setSaveState('saving', '● Speichert…');
  clearTimeout(speicherTimer);
  speicherTimer = setTimeout(sammelSpeichern, 600);
}

// Nach kurzer Ruhe alles Gesammelte als Auftrag einreihen
async function sammelSpeichern() {
  if (!speicherWarteschlange.size) return;
  const offen = new Map(speicherWarteschlange);
  speicherWarteschlange.clear();
  for (const [schluessel, werte] of offen) {
    const i = schluessel.indexOf(':');
    await auftragEinreihen({ art: 'update', tabelle: schluessel.slice(0, i), id: schluessel.slice(i + 1), werte });
  }
  paketNachfuehren();
}

// Nachholen, sobald wieder Verbindung besteht
window.addEventListener('online', async () => {
  warteAnzeige();
  await warteschlangeSenden();
  if (!S.kontrolle) return;
  if (!S.kanal) echtzeitStarten(S.kontrolle.id);
  // Erst wenn nichts mehr aussteht, den Stand der anderen übernehmen
  if (offeneAuftraege) return;
  try {
    const p = await paketVomServer(S.kontrolle.id, false);
    const tippt = document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
    if (!tippt) { ausPaketFuellen(p); render(); }
  } catch (e) { /* dann eben beim nächsten Mal */ }
});
window.addEventListener('offline', warteAnzeige);
setInterval(() => { if (navigator.onLine) warteschlangeSenden(); }, 15000);
window.addEventListener('pagehide', () => { sammelSpeichern(); paketJetztSchreiben(); });

function bindeFeld(el, obj, feld, tabelle, nachher) {
  const ereignis = (el.type === 'checkbox' || el.tagName === 'SELECT') ? 'change' : 'input';
  el.addEventListener(ereignis, () => {
    const wert = el.type === 'checkbox' ? el.checked : el.value;
    obj[feld] = wert;
    feldSpeichern(tabelle, obj.id, feld, wert);
    if (nachher) nachher(wert);
  });
}

// Verschachtelte Angaben (Eigentümer, Verwaltung) liegen als JSON in einer Spalte
function bindeJsonFeld(el, obj, spalte, schluessel, tabelle) {
  el.addEventListener('input', () => {
    obj[spalte] = Object.assign({}, obj[spalte], { [schluessel]: el.value });
    feldSpeichern(tabelle, obj.id, spalte, obj[spalte]);
  });
}

/* ============================================================
   Reiter: Kunde / Auftrag
   ============================================================ */

function renderKunde() {
  const k = S.kontrolle;
  const eig = k.eig || {};
  const verw = k.verwaltung || {};
  const meineRolle = k.rolle_ersteller;
  const bewilligung = meineRolle === 'installateur'
    ? (S.firma && S.firma.inst_bewilligung) : (S.firma && S.firma.kontroll_bewilligung);

  $('#view').innerHTML = `<h2>Kunde &amp; Auftrag</h2>

  <div class="card">
    <h3 style="margin-top:0">Unsere Rolle bei dieser Kontrolle</h3>
    <div class="typtoggle" id="rollewahl">
      <button class="r_inst ${meineRolle === 'installateur' ? 'on' : ''}">Elektro-Installateur</button>
      <button class="r_kontr ${meineRolle === 'kontrollorgan' ? 'on' : ''}">Unabhängiges Kontrollorgan</button>
    </div>
    <div class="hint">Unsere Firma erscheint damit im entsprechenden Feld der Formulare – mit der
      ${meineRolle === 'installateur' ? 'Installationsbewilligung' : 'Kontrollbewilligung'}
      <b>${esc(bewilligung || '– in den Firmeneinstellungen noch nicht erfasst –')}</b>.</div>
    <label class="f" style="margin-top:14px">
      <input type="checkbox" id="k_pv" ${k.pv ? 'checked' : ''} style="width:auto;margin-right:8px">
      <b>Photovoltaik-Anlage</b> – erzeugt das PV-Protokoll statt des normalen Mess- und Prüfprotokolls
    </label>
  </div>

  <div class="card" id="partnerkarte">
    <h3 style="margin-top:0">Partnerfirma</h3>
    <div id="partnerbereich"><div class="hint">Wird geladen …</div></div>
  </div>

  <div class="card">
    <h3 style="margin-top:0">Auftrag</h3>
    <div class="row">
      <div class="narrow" style="flex:0 0 190px"><label class="f">Auftragsnummer</label>
        <input type="text" id="k_anr" value="${esc(k.auftrag_nr)}"></div>
      <div><label class="f">Auftragsbezeichnung</label>
        <input type="text" id="k_abez" value="${esc(k.auftrag_bez)}" placeholder="z.B. Periodische Kontrolle NIV 26"></div>
      <div class="narrow" style="flex:0 0 190px"><label class="f">Geplantes Kontrolldatum</label>
        <input type="date" id="k_plan" value="${esc(k.plan_datum || '')}"></div>
      <div class="narrow" style="flex:0 0 130px"><label class="f">Zugewiesen an</label>
        <input type="text" id="k_zug" autocapitalize="characters" value="${esc(k.zugewiesen)}" placeholder="Kürzel"></div>
    </div>
    <label class="f">Kontrollumfang / ausgeführte Installation</label>
    <input type="text" id="k_umfang" value="${esc(k.kontrollumfang)}" placeholder="z.B. Vollkontrolle">
  </div>

  <div class="card">
    <h3 style="margin-top:0">Ort der Installation</h3>
    <div class="row">
      <div style="flex:2"><label class="f">Strasse</label><input type="text" id="k_str" value="${esc(k.strasse)}"></div>
      <div class="narrow" style="flex:0 0 90px"><label class="f">Nr.</label><input type="text" id="k_nr" value="${esc(k.hausnr)}"></div>
      <div class="narrow" style="flex:0 0 110px"><label class="f">PLZ</label><input type="text" id="k_plz" inputmode="numeric" value="${esc(k.plz)}"></div>
      <div><label class="f">Ort</label><input type="text" id="k_ort" value="${esc(k.ort)}"></div>
    </div>
    <div class="row">
      <div><label class="f">Gebäudeart</label><input type="text" id="k_geb" value="${esc(k.gebaeudeart)}" placeholder="z.B. EFH, MFH"></div>
      <div><label class="f">VNB (Netzbetreiber)</label><input type="text" id="k_vnb" value="${esc(k.vnb)}" placeholder="z.B. BKW"></div>
      <div><label class="f">VNB Objekt-Nr.</label><input type="text" id="k_vnbnr" value="${esc(k.vnb_objekt_nr)}"></div>
    </div>
    <div class="row">
      <div><label class="f">Gemeinde</label><input type="text" id="k_gem" value="${esc(k.gemeinde)}"></div>
      <div class="narrow"><label class="f">Parz.-Nr.</label><input type="text" id="k_parz" value="${esc(k.parz_nr)}"></div>
      <div class="narrow"><label class="f">EGID</label><input type="text" id="k_egid" value="${esc(k.egid)}"></div>
    </div>
    <label class="f">Bemerkungen <span class="hint" style="display:inline">– bleibt auch nach dem Unterschreiben änderbar</span></label>
    <textarea id="k_bem">${esc(k.bemerkung)}</textarea>
  </div>

  <div class="card">
    <h3 style="margin-top:0">Eigentümer</h3>
    <div class="btnrow" style="margin-top:0"><button class="btn small" id="k_adrcopy">⤵ Adresse der Anlage übernehmen</button></div>
    <div class="row">
      <div><label class="f">Name</label><input type="text" id="e_name" value="${esc(eig.name || '')}"></div>
      <div><label class="f">Telefon</label><input type="text" id="e_tel" inputmode="tel" value="${esc(eig.tel || '')}"></div>
      <div><label class="f">E-Mail</label><input type="text" id="e_mail" inputmode="email" autocapitalize="none" value="${esc(eig.mail || '')}"></div>
    </div>
    <div class="row">
      <div style="flex:2"><label class="f">Strasse, Nr.</label><input type="text" id="e_str" value="${esc(eig.strasse || '')}"></div>
      <div class="narrow"><label class="f">PLZ</label><input type="text" id="e_plz" inputmode="numeric" value="${esc(eig.plz || '')}"></div>
      <div><label class="f">Ort</label><input type="text" id="e_ort" value="${esc(eig.ort || '')}"></div>
    </div>
  </div>

  <div class="card">
    <h3 style="margin-top:0">Verwaltung <span class="hint" style="display:inline">– nur falls vorhanden</span></h3>
    <div class="row">
      <div><label class="f">Name</label><input type="text" id="v_name" value="${esc(verw.name || '')}"></div>
      <div><label class="f">Telefon</label><input type="text" id="v_tel" inputmode="tel" value="${esc(verw.tel || '')}"></div>
    </div>
    <div class="row">
      <div style="flex:2"><label class="f">Strasse, Nr.</label><input type="text" id="v_str" value="${esc(verw.strasse || '')}"></div>
      <div class="narrow"><label class="f">PLZ</label><input type="text" id="v_plz" inputmode="numeric" value="${esc(verw.plz || '')}"></div>
      <div><label class="f">Ort</label><input type="text" id="v_ort" value="${esc(verw.ort || '')}"></div>
    </div>
  </div>`;

  // Einfache Felder
  const felder = {
    k_anr: 'auftrag_nr', k_abez: 'auftrag_bez', k_plan: 'plan_datum', k_zug: 'zugewiesen',
    k_umfang: 'kontrollumfang', k_str: 'strasse', k_nr: 'hausnr', k_plz: 'plz', k_ort: 'ort',
    k_geb: 'gebaeudeart', k_vnb: 'vnb', k_vnbnr: 'vnb_objekt_nr', k_gem: 'gemeinde',
    k_parz: 'parz_nr', k_egid: 'egid', k_bem: 'bemerkung'
  };
  for (const [id, feld] of Object.entries(felder)) {
    bindeFeld($('#' + id), k, feld, 'kontrollen', () => {
      if (['strasse', 'hausnr', 'plz', 'ort'].includes(feld)) $('#ctxtitle').textContent = kontrolleTitel(k);
    });
  }
  // Kürzel immer gross
  $('#k_zug').addEventListener('blur', e => {
    e.target.value = e.target.value.trim().toUpperCase();
    k.zugewiesen = e.target.value;
    feldSpeichern('kontrollen', k.id, 'zugewiesen', k.zugewiesen);
  });
  // Eigentümer / Verwaltung (JSON-Spalten)
  [['e_name', 'eig', 'name'], ['e_tel', 'eig', 'tel'], ['e_mail', 'eig', 'mail'],
   ['e_str', 'eig', 'strasse'], ['e_plz', 'eig', 'plz'], ['e_ort', 'eig', 'ort'],
   ['v_name', 'verwaltung', 'name'], ['v_tel', 'verwaltung', 'tel'],
   ['v_str', 'verwaltung', 'strasse'], ['v_plz', 'verwaltung', 'plz'], ['v_ort', 'verwaltung', 'ort']]
    .forEach(([id, spalte, schluessel]) => bindeJsonFeld($('#' + id), k, spalte, schluessel, 'kontrollen'));

  $('#k_adrcopy').addEventListener('click', () => {
    k.eig = Object.assign({}, k.eig, { strasse: (k.strasse + ' ' + k.hausnr).trim(), plz: k.plz, ort: k.ort });
    feldSpeichern('kontrollen', k.id, 'eig', k.eig);
    renderKunde();
  });
  $$('#rollewahl button').forEach(b => b.addEventListener('click', () => {
    k.rolle_ersteller = b.classList.contains('r_inst') ? 'installateur' : 'kontrollorgan';
    feldSpeichern('kontrollen', k.id, 'rolle_ersteller', k.rolle_ersteller);
    renderKunde();
  }));
  bindeFeld($('#k_pv'), k, 'pv', 'kontrollen');
  partnerBereich();
}

/* ============================================================
   Partnerfirma: einladen, suchen, Favoriten, Verknüpfung lösen
   ============================================================ */

async function partnerBereich() {
  const box = $('#partnerbereich');
  if (!box) return;
  const k = S.kontrolle;
  const fremd = k.firma_id !== S.profil.firma_id;

  if (k.partner_firma_id) {
    const { data: p } = await sb.from('firmen_suche').select('*').eq('id', k.partner_firma_id).maybeSingle();
    const { data: e } = await sb.from('firmen_suche').select('*').eq('id', k.firma_id).maybeSingle();
    const andere = fremd ? e : p;      // die jeweils andere Firma
    box.innerHTML = `<div class="hint">Diese Kontrolle wird von zwei Firmen gemeinsam bearbeitet.
        Beide sehen alle Änderungen und können unterschreiben.</div>
      <div class="card kcard" style="margin:10px 0">
        <div class="kinfo">
          <div class="kt">${esc((andere && andere.name) || 'Unbekannte Firma')}
            <span class="statusbadge sb-me">${fremd ? 'hat uns eingeladen' : 'eingeladen'}</span></div>
          <div class="ks">${esc(andere ? [andere.strasse, [andere.plz, andere.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '')}
            · Rolle: <b>${esc((fremd ? k.rolle_ersteller : k.partner_rolle) === 'installateur' ? 'Elektro-Installateur' : 'Unabhängiges Kontrollorgan')}</b></div>
        </div>
      </div>
      <div class="btnrow"><button class="btn danger small" id="p_trennen">Verknüpfung lösen</button></div>
      <div class="hint">Beim Lösen behält <b>jede Firma eine eigene, vollständige Kopie</b> – mit allen
        Anlagen, Messwerten, Mängeln und Unterschriften. Ab dann sind es zwei getrennte Kontrollen.</div>`;

    $('#p_trennen').addEventListener('click', async () => {
      if (!confirm('Verknüpfung wirklich lösen?\n\nBeide Firmen behalten je eine vollständige Kopie. '
        + 'Änderungen wirken sich danach nicht mehr gegenseitig aus.')) return;
      const { error } = await sb.rpc('kontrolle_trennen', { k_id: k.id });
      if (error) return fehler(error);
      k.partner_firma_id = null; k.partner_rolle = null;
      alert('Die Verknüpfung wurde gelöst. Beide Firmen haben nun eine eigene Kopie.');
      renderKunde();
    });
    return;
  }

  if (fremd) {
    box.innerHTML = '<div class="hint">Diese Kontrolle gehört einer anderen Firma – nur sie kann Partner einladen.</div>';
    return;
  }

  const gesuchteRolle = k.rolle_ersteller === 'installateur' ? 'kontrollorgan' : 'installateur';
  const { data: favs } = await sb.from('firma_favoriten')
    .select('partner_firma_id, firmen_suche!inner(*)').eq('firma_id', S.profil.firma_id)
    .then(r => ({ data: (r.data || []).map(x => x.firmen_suche) }))
    .catch(() => ({ data: [] }));

  box.innerHTML = `<div class="hint">Lade die Firma ein, die den anderen Teil übernimmt – bei uns als
      <b>${esc(k.rolle_ersteller === 'installateur' ? 'Elektro-Installateur' : 'Unabhängiges Kontrollorgan')}</b>
      wäre das ${gesuchteRolle === 'installateur' ? 'der Installateur' : 'das Kontrollorgan'}.
      Die eingeladene Firma kann die Kontrolle sofort mitbearbeiten.</div>
    ${(favs && favs.length) ? `<label class="f">Favoriten</label>
      <div class="chips" id="p_favs">${favs.map(f => `<button class="chip" data-fid="${f.id}">★ ${esc(f.name)}</button>`).join('')}</div>` : ''}
    <label class="f">Firma suchen</label>
    <div class="row" style="align-items:flex-end">
      <div><input type="text" id="p_suche" placeholder="Name der Firma, z.B. Käser"></div>
      <div class="narrow" style="flex:0 0 auto"><button class="btn" id="p_suchen">🔍 Suchen</button></div>
    </div>
    <div id="p_treffer"></div>`;

  const einladen = async (fid, name) => {
    if (!confirm(`«${name}» als Partnerfirma einladen?\n\nSie kann die Kontrolle danach sehen und mitbearbeiten.`)) return;
    const { error } = await sb.from('kontrollen')
      .update({ partner_firma_id: fid, partner_rolle: gesuchteRolle }).eq('id', k.id);
    if (error) return fehler(error);
    k.partner_firma_id = fid; k.partner_rolle = gesuchteRolle;
    // Als Favorit merken (Fehler hier sind unkritisch)
    await sb.from('firma_favoriten').upsert({ firma_id: S.profil.firma_id, partner_firma_id: fid });
    renderKunde();
  };

  const suchen = async () => {
    const t = $('#p_suche').value.trim();
    if (t.length < 2) return alert('Bitte mindestens zwei Buchstaben eingeben.');
    const { data, error } = await sb.from('firmen_suche').select('*')
      .ilike('name', '%' + t + '%').neq('id', S.profil.firma_id).limit(20);
    if (error) return fehler(error);
    $('#p_treffer').innerHTML = data.length
      ? data.map(f => `<div class="card kcard" data-fid="${f.id}">
          <div class="kinfo">
            <div class="kt">${esc(f.name)}</div>
            <div class="ks">${esc([f.strasse, [f.plz, f.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—')}
              ${f.inst_bewilligung ? ' · Inst. ' + esc(f.inst_bewilligung) : ''}
              ${f.kontroll_bewilligung ? ' · Kontr. ' + esc(f.kontroll_bewilligung) : ''}</div>
          </div>
          <button class="btn primary small">Einladen</button>
        </div>`).join('')
      : '<div class="empty">Keine Firma gefunden.</div>';
    $$('#p_treffer .kcard button').forEach(b => b.addEventListener('click', () => {
      const karte = b.closest('.kcard');
      einladen(karte.dataset.fid, karte.querySelector('.kt').textContent.trim());
    }));
  };
  $('#p_suchen').addEventListener('click', suchen);
  $('#p_suche').addEventListener('keydown', e => { if (e.key === 'Enter') suchen(); });
  $$('#p_favs .chip').forEach(c => c.addEventListener('click', () => einladen(c.dataset.fid, c.textContent.replace('★ ', ''))));
}

/* ============================================================
   Kontrollen – Liste, Suche, Papierkorb, neue Kontrolle
   ============================================================ */

const STATUS_STUFEN = ['Erfasst', 'Gemessen', 'Geschrieben', 'Abgerechnet', 'Abgeschlossen'];

S.suche = { text: '', status: '', nur_meine: false, papierkorb: false };

function kontrolleTitel(k) {
  const adr = [k.strasse + (k.hausnr ? ' ' + k.hausnr : ''),
               [k.plz, k.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return adr || 'Neue Kontrolle';
}

async function renderKontrollen() {
  const v = $('#view');
  if (istSuperadmin() && S.firma && S.firma.ist_superfirma) {
    v.innerHTML = `<div class="empty">Du bist als <b>Systemverwaltung</b> angemeldet – dieses Konto führt
      bewusst keine Kontrollen, sondern verwaltet die Firmen (⚙️ Optionen).<br><br>
      Zum Arbeiten brauchst du ein Konto bei einer normalen Firma.</div>`;
    return;
  }

  const F = S.suche;
  v.innerHTML = `<h2>Kontrollen</h2>
    <div class="btnrow" style="align-items:center">
      <button class="btn primary" id="btnNeu">＋ Neue Kontrolle</button>
      <button class="btn small" id="btnImport">⬆︎ Import</button>
      <button class="btn small ${F.papierkorb ? 'active' : ''}" id="btnPapierkorb">🗑 Papierkorb</button>
    </div>
    <div class="card">
      <div class="row" style="align-items:flex-end">
        <div style="flex:2"><label class="f">Suche (Strasse, PLZ, Ort, Auftrag, Eigentümer)</label>
          <input type="text" id="s_text" value="${esc(F.text)}" placeholder="z.B. Waldeckweg oder 3053"></div>
        <div class="narrow" style="flex:0 0 170px"><label class="f">Status</label>
          <select id="s_status"><option value="">– alle –</option>
            ${STATUS_STUFEN.map(s => `<option value="${s}" ${F.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select></div>
        <div class="narrow" style="flex:0 0 auto">
          <label class="f"><input type="checkbox" id="s_meine" ${F.nur_meine ? 'checked' : ''} style="width:auto;margin-right:6px">nur mir zugewiesen</label>
        </div>
      </div>
      <div class="hint" id="s_info"></div>
    </div>
    <div id="klist"><div class="empty">Wird geladen …</div></div>`;

  $('#btnNeu').addEventListener('click', neueKontrolle);
  $('#btnImport').addEventListener('click', kontrolleImportieren);
  $('#btnPapierkorb').addEventListener('click', () => { F.papierkorb = !F.papierkorb; renderKontrollen(); });
  $('#s_text').addEventListener('input', () => { F.text = $('#s_text').value; listeLaden(); });
  $('#s_status').addEventListener('change', () => { F.status = $('#s_status').value; listeLaden(); });
  $('#s_meine').addEventListener('change', () => { F.nur_meine = $('#s_meine').checked; listeLaden(); });
  listeLaden();
}

// Import: einzelne Kontrolle (.ekon) oder ganzes Firmen-Backup (.ekbackup)
async function kontrolleImportieren() {
  const datei = await dateiWaehlen('.ekon,.ekbackup,.json,application/json');
  if (!datei) return;
  let inhalt;
  try {
    inhalt = JSON.parse(await datei.text());
  } catch (e) { return alert('Die Datei konnte nicht gelesen werden – ist es eine Datei aus dieser App?'); }

  const pakete = inhalt.art === 'elektrokontrolle-online-backup' ? (inhalt.kontrollen || [])
    : inhalt.art === 'elektrokontrolle-online' ? [inhalt] : null;
  if (!pakete) return alert('Unbekannter Dateityp – erwartet wird eine Datei aus «Elektrokontrolle online».');
  if (!pakete.length) return alert('Die Datei enthält keine Kontrollen.');
  if (!confirm(`${pakete.length === 1 ? 'Eine Kontrolle' : pakete.length + ' Kontrollen'} einlesen?\n\n`
    + 'Es entstehen immer NEUE Kontrollen – bestehende werden nie überschrieben.')) return;

  setSaveState('saving', '● Wird eingelesen …');
  let fertig = 0;
  for (const paket of pakete) {
    try { await kontrolleEinspielen(paket); fertig++; }
    catch (e) { fehler(e); break; }
  }
  setSaveState('saved', '✓ Gespeichert');
  alert(fertig === pakete.length
    ? `${fertig} ${fertig === 1 ? 'Kontrolle wurde' : 'Kontrollen wurden'} eingelesen.`
    : `${fertig} von ${pakete.length} eingelesen – der Rest wurde abgebrochen.`);
  listeLaden();
}

let ladeTimer = null;
function listeLaden() {
  clearTimeout(ladeTimer);
  ladeTimer = setTimeout(listeJetztLaden, 250);
}

async function listeJetztLaden() {
  const F = S.suche;
  let q = sb.from('kontrollen')
    .select('id, firma_id, partner_firma_id, rolle_ersteller, pv, status, zugewiesen, auftrag_nr, auftrag_bez,'
          + ' strasse, hausnr, plz, ort, gebaeudeart, plan_datum, geloescht_am, updated_at, eig')
    .order('plan_datum', { ascending: true, nullsFirst: false })
    .limit(200);
  q = F.papierkorb ? q.not('geloescht_am', 'is', null) : q.is('geloescht_am', null);
  if (F.status) q = q.eq('status', F.status);
  if (F.nur_meine) q = q.eq('zugewiesen', S.profil.kuerzel);
  if (F.text.trim()) {
    const t = '%' + F.text.trim() + '%';
    q = q.or(`strasse.ilike.${t},plz.ilike.${t},ort.ilike.${t},auftrag_nr.ilike.${t},auftrag_bez.ilike.${t}`);
  }
  const box = $('#klist');
  if (!box) return;
  let data = null, offlineListe = false;
  if (navigator.onLine) {
    const antwort = await q;
    if (antwort.error && !istNetzproblem(antwort.error)) {
      box.innerHTML = `<div class="empty">Fehler beim Laden: ${esc(antwort.error.message)}</div>`;
      return;
    }
    data = antwort.data;
    if (data) await ablageSchreiben('merker', data, 'liste');
  }
  if (!data) {
    // Ohne Verbindung: die zuletzt gesehene Liste, ergänzt um alles,
    // was im Gerät liegt (auch offline neu angelegte Kontrollen).
    offlineListe = true;
    const gemerkt = (await ablageLesen('merker', 'liste')) || [];
    const pakete = await ablageAlle('pakete');
    const nachId = new Map(gemerkt.map(k => [k.id, k]));
    pakete.forEach(p => { if (p.kontrolle) nachId.set(p.id, p.kontrolle); });
    data = Array.from(nachId.values()).filter(k => F.papierkorb ? k.geloescht_am : !k.geloescht_am);
    if (F.status) data = data.filter(k => k.status === F.status);
    if (F.nur_meine) data = data.filter(k => k.zugewiesen === S.profil.kuerzel);
    if (F.text.trim()) {
      const t = F.text.trim().toLowerCase();
      data = data.filter(k => ['strasse', 'plz', 'ort', 'auftrag_nr', 'auftrag_bez']
        .some(f => String(k[f] || '').toLowerCase().includes(t)));
    }
  }
  const imGeraet = new Set((await ablageAlle('pakete')).map(p => p.id));

  const info = $('#s_info');
  if (info) info.textContent = data.length + (F.papierkorb ? ' Kontrolle(n) im Papierkorb'
    : ' Kontrolle(n)') + (data.length === 200 ? ' (nur die ersten 200)' : '')
    + (offlineListe ? ' · ⚡ ohne Verbindung: nur was im Gerät liegt' : '');

  if (!data.length) {
    box.innerHTML = `<div class="empty">${F.papierkorb ? 'Der Papierkorb ist leer.'
      : (F.text || F.status || F.nur_meine) ? 'Keine Kontrolle passt zur Suche.'
      : 'Noch keine Kontrolle erfasst. Tippe auf «＋ Neue Kontrolle».'}</div>`;
    return;
  }

  box.innerHTML = data.map(k => {
    const fremd = k.firma_id !== S.profil.firma_id;
    const tage = k.geloescht_am
      ? Math.max(0, 30 - Math.floor((Date.now() - new Date(k.geloescht_am)) / 86400000)) : null;
    return `<div class="card kcard ${k.status === 'Abgeschlossen' ? 'done' : ''}" data-id="${k.id}">
      <div class="kinfo">
        <div class="kt">${esc(kontrolleTitel(k))}
          ${k.status ? `<span class="statusbadge ${k.status === 'Abgeschlossen' ? 'sb-done' : ''}">${esc(k.status)}</span>` : ''}
          ${k.pv ? '<span class="statusbadge">☀️ PV</span>' : ''}
          ${fremd ? '<span class="statusbadge sb-me">geteilt mit uns</span>' : ''}
          ${k.partner_firma_id && !fremd ? '<span class="statusbadge sb-me">geteilt</span>' : ''}</div>
        <div class="ks">
          ${k.plan_datum ? '📅 <b>' + esc(new Date(k.plan_datum + 'T12:00:00').toLocaleDateString('de-CH')) + '</b> · ' : ''}
          ${k.auftrag_nr ? esc(k.auftrag_nr) + ' · ' : ''}${esc(k.gebaeudeart || '–')}
          ${k.eig && k.eig.name ? ' · ' + esc(k.eig.name) : ''}
          ${k.zugewiesen ? ' · 👤 ' + esc(k.zugewiesen) : ''}
          · geändert ${esc(fmtDate(k.updated_at))}
          ${tage !== null ? ` · <span style="color:var(--warn)">wird in ${tage} Tag(en) gelöscht</span>` : ''}
        </div>
      </div>
      ${k.geloescht_am
        ? `<button class="btn primary small" data-act="zurueck">↩︎ Wiederherstellen</button>`
        : `<button class="btn primary small" data-act="oeffnen">Öffnen</button>
           <button class="btn small" data-act="mitnehmen" title="Für die Arbeit ohne Empfang ins Gerät laden">${imGeraet.has(k.id) ? '✓ dabei' : '📥 Mitnehmen'}</button>
           <button class="btn danger small" data-act="loeschen">Löschen</button>`}
    </div>`;
  }).join('');

  $$('#klist .kcard button').forEach(b => b.addEventListener('click', async () => {
    const id = b.closest('.kcard').dataset.id;
    const act = b.dataset.act;
    if (act === 'oeffnen') return kontrolleOeffnen(id);
    if (act === 'mitnehmen') {
      if (!navigator.onLine) return alert('Zum Mitnehmen braucht es einmal eine Verbindung.');
      return offlineMitnehmen(id, b);
    }
    if (act === 'loeschen') {
      if (!confirm('Kontrolle in den Papierkorb legen?\n\nSie bleibt dort 30 Tage sichtbar und kann '
        + 'jederzeit wiederhergestellt werden.')) return;
      const werte = { geloescht_am: new Date().toISOString() };
      await auftragEinreihen({ art: 'update', tabelle: 'kontrollen', id, werte });
      await lokalKontrolleAendern(id, werte);
    } else {
      await auftragEinreihen({ art: 'update', tabelle: 'kontrollen', id, werte: { geloescht_am: null } });
      await lokalKontrolleAendern(id, { geloescht_am: null });
    }
    listeJetztLaden();
  }));
}

async function neueKontrolle() {
  const eigeneRolle = (S.firma && S.firma.kontroll_bewilligung) ? 'kontrollorgan' : 'installateur';
  // Die Kennung entsteht im Gerät – so lässt sich auch ohne Empfang eine
  // Kontrolle anlegen und sofort ausfüllen.
  const zeile = {
    id: crypto.randomUUID(),
    firma_id: S.profil.firma_id,
    rolle_ersteller: eigeneRolle,
    partner_firma_id: null, partner_rolle: null,
    pv: false, status: 'Erfasst', status_rank: 0,
    zugewiesen: S.profil.kuerzel, kontrolleure: [],
    auftrag_nr: '', auftrag_bez: '', kontrollumfang: '', plan_datum: null,
    pruefgrund: {}, kontrollart: {},
    strasse: '', hausnr: '', plz: '', ort: '', gebaeudeart: '', gemeinde: '',
    parz_nr: '', egid: '', vnb: '', vnb_objekt_nr: '', bemerkung: '',
    eig: {}, verwaltung: {}, hak: '', messgeraete: (S.grund && S.grund.messgeraete) || '',
    weitere: {}, geloescht_am: null, updated_at: new Date().toISOString()
  };
  await auftragEinreihen({ art: 'insert', tabelle: 'kontrollen', werte: zeile });
  S.kontrolle = zeile;
  S.anlagen = []; S.anlageId = null; S.gruppen = null; S.maengel = [];
  S.sicht = null; S.unterschriften = []; S.arbeitszeit = []; S.statusVerlauf = [];
  await paketJetztSchreiben();
  if (navigator.onLine) echtzeitStarten(zeile.id);
  go('kunde');
}

async function kontrolleOeffnen(id) {
  // Erst alles Ausstehende senden – sonst überschreibt der Server-Stand
  // eigene Änderungen, die noch in der Warteschlange liegen.
  await warteschlangeSenden();

  // Zuerst die Daten beschaffen und erst dann den Zustand wechseln –
  // sonst bliebe bei einem Fehlschlag eine halb geleerte Ansicht zurück.
  let p = null;
  if (navigator.onLine) {
    try { p = await paketVomServer(id, false); }
    catch (e) { if (!istNetzproblem(e)) return fehler(e); }
  }
  if (!p) {
    p = await ablageLesen('pakete', id);
    if (!p) return alert('Diese Kontrolle ist ohne Verbindung nicht verfügbar.\n\n'
      + 'Tipp: Kontrollen, die du unterwegs brauchst, vorher mit «📥 Mitnehmen» laden.');
    setSaveState('error', '⚡ offline – Stand vom ' + fmtDate(p.zeit));
  }
  S.anlageId = null;
  S.paket = null;
  ausPaketFuellen(p);
  if (navigator.onLine) echtzeitStarten(id);
  go('kunde');
}

// Kontrolle bewusst fürs Arbeiten ohne Empfang laden – mit allen Fotos
async function offlineMitnehmen(id, knopf) {
  const alt = knopf.textContent;
  knopf.disabled = true;
  knopf.textContent = '⏳ …';
  try {
    await paketVomServer(id, true);
    knopf.textContent = '✓ dabei';
    setTimeout(() => { knopf.textContent = alt; knopf.disabled = false; }, 2000);
  } catch (e) {
    knopf.textContent = alt; knopf.disabled = false;
    fehler(e);
  }
}

/* ============================================================
   Echtzeit: Änderungen der anderen erscheinen sofort,
   dazu die Anzeige, wer gerade mitarbeitet
   ============================================================ */

S.kanal = null;
S.mitarbeitende = [];

function echtzeitBeenden() {
  if (S.kanal) { sb.removeChannel(S.kanal); S.kanal = null; }
  S.mitarbeitende = [];
  praesenzZeigen();
}

function echtzeitStarten(kontrolleId) {
  echtzeitBeenden();
  const kanal = sb.channel('kontrolle:' + kontrolleId, {
    config: { presence: { key: S.profil.id } }
  });

  // 1. Datenänderungen – nur die dieser Kontrolle
  ['kontrollen', 'anlagen', 'gruppen', 'maengel', 'sichtkontrolle', 'unterschriften',
   'arbeitszeit', 'status_verlauf'].forEach(tabelle => {
    kanal.on('postgres_changes',
      { event: '*', schema: 'public', table: tabelle,
        filter: (tabelle === 'kontrollen' ? 'id=eq.' : 'kontrolle_id=eq.') + kontrolleId },
      nachricht => aenderungEingetroffen(tabelle, nachricht));
  });

  // 2. Wer ist gerade dabei?
  kanal.on('presence', { event: 'sync' }, () => {
    const zustand = kanal.presenceState();
    S.mitarbeitende = Object.values(zustand).flat()
      .filter(p => p.benutzer_id !== S.profil.id);
    praesenzZeigen();
  });

  kanal.subscribe(async status => {
    if (status === 'SUBSCRIBED') {
      await kanal.track({ benutzer_id: S.profil.id, kuerzel: S.profil.kuerzel, name: S.profil.name });
    }
  });
  S.kanal = kanal;
}

function praesenzZeigen() {
  let el = $('#praesenz');
  if (!el) {
    el = document.createElement('div');
    el.id = 'praesenz';
    const topbar = $('#topbar');
    if (topbar) topbar.insertBefore(el, $('#netstate'));
  }
  if (!S.mitarbeitende.length) { el.innerHTML = ''; el.title = ''; return; }
  const namen = S.mitarbeitende.map(p => p.name || p.kuerzel).join(', ');
  el.innerHTML = S.mitarbeitende.map(p => `<span class="wer">${esc(p.kuerzel || '?')}</span>`).join('');
  el.title = namen + (S.mitarbeitende.length === 1 ? ' arbeitet auch an dieser Kontrolle'
                                                  : ' arbeiten auch an dieser Kontrolle');
}

// Eine Änderung von jemand anderem ist eingetroffen
function aenderungEingetroffen(tabelle, nachricht) {
  const neu = nachricht.new || {};
  const alt = nachricht.eventType === 'DELETE' ? nachricht.old : null;
  // Eigene Änderungen ignorieren – die stehen schon auf dem Bildschirm
  if (neu.updated_by && neu.updated_by === S.profil.id) return;

  const uebernehmen = (liste, schluessel) => {
    if (!liste) return false;
    if (nachricht.eventType === 'DELETE') {
      const i = liste.findIndex(x => x.id === (alt && alt.id));
      if (i >= 0) { liste.splice(i, 1); return true; }
      return false;
    }
    const i = liste.findIndex(x => x.id === neu.id);
    if (i >= 0) {
      // Felder, die gerade bearbeitet werden, nicht überschreiben (Konflikt)
      const offen = speicherWarteschlange.get(schluessel + ':' + neu.id) || {};
      const konflikte = Object.keys(offen).filter(f => String(offen[f]) !== String(neu[f]));
      Object.keys(neu).forEach(f => { if (!(f in offen)) liste[i][f] = neu[f]; });
      if (konflikte.length) konfliktMerken(schluessel, neu, offen, konflikte);
    } else {
      liste.push(neu);
    }
    return true;
  };

  let neuZeichnen = false;
  if (tabelle === 'kontrollen' && S.kontrolle && neu.id === S.kontrolle.id) {
    Object.keys(neu).forEach(f => { if (f !== 'id') S.kontrolle[f] = neu[f]; });
    neuZeichnen = true;
  }
  if (tabelle === 'anlagen') neuZeichnen = uebernehmen(S.anlagen, 'anlagen') || neuZeichnen;
  if (tabelle === 'gruppen' && S.gruppen && neu.anlage_id === S.anlageId) {
    neuZeichnen = uebernehmen(S.gruppen, 'gruppen') || neuZeichnen;
  }
  if (tabelle === 'maengel') neuZeichnen = uebernehmen(S.maengel, 'maengel') || neuZeichnen;
  if (tabelle === 'sichtkontrolle' && S.sicht && neu.anlage_id === S.anlageId) {
    S.sicht[neu.punkt] = neu; neuZeichnen = true;
  }
  if (tabelle === 'unterschriften') { S.unterschriften = null; neuZeichnen = true; }
  if (tabelle === 'arbeitszeit') { S.arbeitszeit = null; neuZeichnen = true; }
  if (tabelle === 'status_verlauf') { S.statusVerlauf = null; neuZeichnen = true; }

  if (!neuZeichnen) return;
  // In der Messtabelle nur die betroffenen Felder auffrischen – sonst verliert
  // man beim Tippen den Cursor
  if (S.view === 'mess' && tabelle === 'gruppen' && nachricht.eventType === 'UPDATE') {
    Object.keys(neu).forEach(f => {
      const el = document.querySelector(`tr[data-gid="${neu.id}"] input[data-feld="${f}"]`);
      if (el && el !== document.activeElement && el.value !== String(neu[f] ?? '')) {
        el.value = neu[f] ?? '';
        el.classList.add('fremdaenderung');
        setTimeout(() => el.classList.remove('fremdaenderung'), 1500);
      }
    });
    return;
  }
  if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  render();
}

/* ---- Konflikte: gleiches Feld, verschiedene Werte ---- */

S.konflikte = [];

function konfliktMerken(tabelle, serverZeile, meine, felder) {
  felder.forEach(f => {
    S.konflikte.push({ tabelle, id: serverZeile.id, feld: f,
                       meiner: meine[f], anderer: serverZeile[f] });
  });
  konfliktZeigen();
}

function konfliktZeigen() {
  if (!S.konflikte.length || $('.konfliktbox')) return;
  const k = S.konflikte[0];
  const ov = document.createElement('div');
  ov.className = 'overlay konfliktbox';
  ov.innerHTML = `<div class="dialog">
    <h3>Gleiches Feld, zwei Werte</h3>
    <div class="dlgtext">Jemand anderes hat <b>${esc(feldName(k.feld))}</b> gleichzeitig geändert.<br><br>
      Dein Wert: <b>${esc(k.meiner || '(leer)')}</b><br>
      Anderer Wert: <b>${esc(k.anderer || '(leer)')}</b></div>
    <div class="btnrow">
      <button class="btn primary" data-w="meiner">Meinen behalten</button>
      <button class="btn" data-w="anderer">Den anderen übernehmen</button>
    </div></div>`;
  document.body.appendChild(ov);
  ov.querySelectorAll('button').forEach(b => b.addEventListener('click', async () => {
    S.konflikte.shift();
    if (b.dataset.w === 'meiner') {
      feldSpeichern(k.tabelle, k.id, k.feld, k.meiner);
    } else {
      const liste = { anlagen: S.anlagen, gruppen: S.gruppen, maengel: S.maengel }[k.tabelle];
      const zeile = (liste || []).find(x => x.id === k.id);
      if (zeile) zeile[k.feld] = k.anderer;
      const paket = speicherWarteschlange.get(k.tabelle + ':' + k.id);
      if (paket) { delete paket[k.feld]; if (!Object.keys(paket).length) speicherWarteschlange.delete(k.tabelle + ':' + k.id); }
    }
    ov.remove();
    render();
    konfliktZeigen();
  }));
}

const FELDNAMEN = {
  nr: 'Nr.', bez: 'Bezeichnung', art: 'Art/Typ', leiter: 'Leiter/Querschnitt', charakt: 'Charakteristik',
  in_a: 'In [A]', ik_anf_pe: 'IK Anfang L-PE', ik_end_pe: 'IK Ende L-PE', ik_anf_n: 'IK Anfang L-N',
  ik_end_n: 'IK Ende L-N', riso: 'RISO', rlo: 'Rlo', rcd_in: 'RCD In', idn: 'IΔN', ausl: 'Auslösezeit',
  weiteres: 'Weiteres', name: 'Name', zaehler_nr: 'Zählernummer', ort: 'Ort', text: 'Text'
};
const feldName = f => FELDNAMEN[f] || f;

/* ============================================================
   Anlagen (im Formular: UV / Schaltgerätekombination)
   ============================================================ */

S.anlagen = null;      // geladene Anlagen der aktuellen Kontrolle
S.anlageId = null;     // gerade gewählte Anlage
S.gruppen = null;      // Gruppen der gewählten Anlage

async function anlagenLaden() {
  const data = await zeilenHolen('anlagen', 'kontrolle_id', S.kontrolle.id, 'reihenfolge');
  S.anlagen = data;
  paketNachfuehren();
  if (!S.anlagen.some(a => a.id === S.anlageId)) S.anlageId = data.length ? data[0].id : null;
  return data;
}

const akt = () => (S.anlagen || []).find(a => a.id === S.anlageId) || null;

function anlagenChips(beimWechsel) {
  const html = `<div class="chips">
    ${(S.anlagen || []).map(a => `<button class="chip ${a.id === S.anlageId ? 'active' : ''}" data-aid="${a.id}">${esc(a.name || 'Anlage ohne Name')}</button>`).join('')}
    <button class="chip add" id="chipAdd">＋ Anlage</button></div>`;
  return {
    html,
    wire() {
      $$('.chip[data-aid]').forEach(c => c.addEventListener('click', () => {
        S.anlageId = c.dataset.aid; S.gruppen = null; beimWechsel();
      }));
      $('#chipAdd').addEventListener('click', async () => {
        const neueAnlage = await zeileAnlegen('anlagen', {
          kontrolle_id: S.kontrolle.id,
          reihenfolge: (S.anlagen || []).length,
          name: 'Anlage ' + ((S.anlagen || []).length + 1)
        });
        // Jede Anlage beginnt mit der Zuleitung als erster Messzeile
        await zeileAnlegen('gruppen', {
          anlage_id: neueAnlage.id, kontrolle_id: S.kontrolle.id, reihenfolge: 0, bez: 'Zuleitung'
        });
        S.anlagen.push(neueAnlage); S.anlageId = neueAnlage.id; S.gruppen = null;
        beimWechsel();
      });
    }
  };
}

async function renderAnlagen() {
  const v = $('#view');
  if (!S.anlagen) { v.innerHTML = '<div class="empty">Wird geladen …</div>'; await anlagenLaden(); }
  const k = S.kontrolle;
  const chips = anlagenChips(renderAnlagen);
  const a = akt();

  let html = `<h2>Anlagen</h2>
    <div class="card">
      <label class="f" style="margin-top:0">HAK (Hausanschlusskasten) – einer pro Gebäude</label>
      <input type="text" id="k_hak" value="${esc(k.hak)}" placeholder="z.B. DIII 60 A, IK 950 A">
    </div>
    ${chips.html}`;

  if (!a) {
    v.innerHTML = html + '<div class="empty">Noch keine Anlage. Tippe auf <b>＋ Anlage</b>.</div>';
    chips.wire();
    bindeFeld($('#k_hak'), k, 'hak', 'kontrollen');
    return;
  }

  const wahl = (id, feld, werte, titel) => `
    <div><label class="f">${titel}</label>
      <select id="${id}"><option value="">–</option>
        ${werte.map(w => `<option value="${w}" ${a[feld] === w ? 'selected' : ''}>${w}</option>`).join('')}
      </select></div>`;

  // Bei PV-Kontrollen kommt eine zusätzliche Karte mit den Anlagedaten dazu
  const pv = (a.sk_angaben || {}).pv || {};
  const pvKarte = !k.pv ? '' : `<div class="card">
    <h3 style="margin-top:0">☀️ Photovoltaik-Anlage</h3>
    <div class="hint">Diese Angaben erscheinen im PV-Protokoll.</div>
    <div class="row">
      <div><label class="f">Projekt</label><input type="text" id="pv_projekt" value="${esc(pv.projekt || '')}" placeholder="z.B. PV Anlage Musterweg 3"></div>
      <div class="narrow" style="flex:0 0 130px"><label class="f">Leistung [kW DC]</label><input type="text" id="pv_kwdc" inputmode="decimal" value="${esc(pv.kwdc || '')}"></div>
      <div class="narrow" style="flex:0 0 130px"><label class="f">Leistung [kVA AC]</label><input type="text" id="pv_kvaac" inputmode="decimal" value="${esc(pv.kvaac || '')}"></div>
    </div>
    <div class="row">
      <div><label class="f">Anlagenbeschrieb</label>
        <select id="pv_beschrieb"><option value="">–</option>
          ${['Flachdach', 'Schrägdach', 'Fassade', 'integriert', 'freistehend']
            .map(s => `<option value="${s}" ${pv.beschrieb === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div><label class="f">Anlagentyp</label>
        <select id="pv_typ"><option value="">–</option>
          ${['Netzverbund', 'Inselanlage'].map(s => `<option value="${s}" ${pv.typ === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div><label class="f">Ausrichtung</label><input type="text" id="pv_ausrichtung" value="${esc(pv.ausrichtung || '')}" placeholder="z.B. Ost / West"></div>
      <div class="narrow" style="flex:0 0 110px"><label class="f">Neigung [°]</label><input type="text" id="pv_neigung" inputmode="numeric" value="${esc(pv.neigung || '')}"></div>
    </div>
    <label class="f">Kurzbeschrieb</label>
    <input type="text" id="pv_kurz" value="${esc(pv.kurz || '')}" placeholder="z.B. Neue PV-Aufdachanlage mit 17 kVA">
    <div class="row">
      <div><label class="f">Datum Inbetriebnahme</label><input type="date" id="pv_inbetrieb" value="${esc(pv.inbetriebnahme || '')}"></div>
      <div><label class="f">Montage von</label><input type="date" id="pv_von" value="${esc(pv.montage_von || '')}"></div>
      <div><label class="f">Montage bis</label><input type="date" id="pv_bis" value="${esc(pv.montage_bis || '')}"></div>
    </div>
    ${pvTabelle('module', 'PV-Module', pv.module || [],
      [['typ', 'Typ Nr.', 60], ['hersteller', 'Hersteller', 0], ['modultyp', 'Modultyp', 0],
       ['pmpp', 'Pmpp [W]', 70], ['umpp', 'Umpp [V]', 70], ['impp', 'Impp [A]', 70],
       ['uoc', 'Uoc [V]', 70], ['isc', 'Isc [A]', 70], ['anzahl', 'Anzahl', 70]])}
    ${pvTabelle('wr', 'Wechselrichter', pv.wr || [],
      [['typ', 'Typ Nr.', 60], ['hersteller', 'Hersteller', 0], ['modell', 'Modell', 0],
       ['pac', 'PAC [kVA]', 80], ['anzahl', 'Anzahl', 70]])}
    ${pvTabelle('straenge', 'Stränge', pv.straenge || [],
      [['nr', 'Strang Nr.', 70], ['modultyp', 'Modultyp Nr.', 80], ['anzahl', 'Module je Strang', 90],
       ['wr', 'auf WR Nr.', 70], ['teilarray', 'Teilarray', 80], ['querschnitt', 'Quer. [mm²]', 80]])}
    ${pvTabelle('strangmessungen', 'Strangmessungen', pv.strangmessungen || [],
      [['nr', 'Strang', 60], ['uoc', 'UOC [V]', 70], ['isc', 'ISC [A]', 70], ['riso', 'RISO [MΩ]', 80],
       ['umpp', 'Umpp [V]', 70], ['impp', 'Impp [A]', 70], ['rpa', 'RPA [Ω]', 70]])}
  </div>`;

  html += `<div class="card">
    <div class="row">
      <div><label class="f">Name der Anlage</label><input type="text" id="a_name" value="${esc(a.name)}" placeholder="z.B. UV Wohnung EG"></div>
      <div><label class="f">Zählernummer</label><input type="text" id="a_zaehler" value="${esc(a.zaehler_nr)}"></div>
      <div><label class="f">Stromkunde</label><input type="text" id="a_kunde" value="${esc(a.stromkunde)}"></div>
      <div><label class="f">Stockwerk / Lage</label><input type="text" id="a_stock" value="${esc(a.stockwerk)}"></div>
    </div>
    <label class="f">Nutzung und Kontrollperiode(n) – zweite Zeile z.B. für Sch III</label>
    <div class="row">
      <div><input type="text" id="a_nutz1" value="${esc(a.periode2_txt ? a.periode2_txt : '')}" placeholder="Nutzung, z.B. Wohnung"></div>
      <div class="narrow" style="flex:0 0 110px"><input type="text" id="a_per1" value="${esc(a.periode)}" placeholder="Jahre"></div>
      <div><input type="text" id="a_nutz2" value="${esc(a.sk_angaben && a.sk_angaben.nutzung2 || '')}" placeholder="2. Nutzung (optional)"></div>
      <div class="narrow" style="flex:0 0 110px"><input type="text" id="a_per2" value="${esc(a.periode2)}" placeholder="Jahre"></div>
    </div>
    <div class="row">
      ${wahl('a_schutz', 'schutzsystem', ['TN-S', 'TN-C', 'TN-C-S', 'Sch III'], 'Schutzsystem')}
      ${wahl('a_erder', 'erder', ['Fundament', 'Tiefenerder', 'Banderder'], 'Erder')}
      ${wahl('a_asbest', 'asbest', ['Asbestfrei', 'Asbestverdacht'], 'Schaltgerätekombination')}
    </div>
    <div class="btnrow" style="margin-top:12px"><button class="btn danger small" id="a_del">Anlage löschen</button></div>
  </div>

  <div class="card">
    <h3 style="margin-top:0">Gruppen per Diktat erfassen</h3>
    <div class="hint">Sage pro Sicherungsgruppe <b>Nummer, dann Bezeichnung</b>, danach den Befehl
      <b>«neue Zeile»</b>. Beispiel: <i>«F1 Wohnen Essen Küche <b>neue Zeile</b> F2 Zimmer eins und zwei»</i>.
      Danach «Zeilen übernehmen» tippen – du kannst den Text vorher noch korrigieren.</div>
    <textarea id="diktat" placeholder="F1 Wohnen Essen Küche&#10;F2 Zimmer 1, Zimmer 2&#10;F3 Geschirrspüler"></textarea>
    <div class="btnrow"><button class="btn primary" id="btnDiktat">Zeilen übernehmen</button></div>
  </div>

  <div class="card">
    <h3 style="margin-top:0">Gruppen <span id="gcount" class="hint" style="display:inline"></span></h3>
    <div class="hint">Die erste Zeile ist die <b>Zuleitung</b> – ihr «IK Ende» wird beim Messen automatisch
      als «IK Anfang» der übrigen Gruppen übernommen.</div>
    <div id="glist"><div class="empty">Wird geladen …</div></div>
    <div class="btnrow"><button class="btn" id="btnAddG">＋ Zeile hinzufügen</button></div>
  </div>
  ${pvKarte}`;

  v.innerHTML = html;
  chips.wire();
  if (k.pv) pvVerdrahten(a);
  bindeFeld($('#k_hak'), k, 'hak', 'kontrollen');
  bindeFeld($('#a_name'), a, 'name', 'anlagen', () => renderAnlagenChipsNeu());
  bindeFeld($('#a_zaehler'), a, 'zaehler_nr', 'anlagen');
  bindeFeld($('#a_kunde'), a, 'stromkunde', 'anlagen');
  bindeFeld($('#a_stock'), a, 'stockwerk', 'anlagen');
  bindeFeld($('#a_per1'), a, 'periode', 'anlagen');
  bindeFeld($('#a_per2'), a, 'periode2', 'anlagen');
  bindeFeld($('#a_nutz1'), a, 'periode2_txt', 'anlagen');
  bindeFeld($('#a_schutz'), a, 'schutzsystem', 'anlagen');
  bindeFeld($('#a_erder'), a, 'erder', 'anlagen');
  bindeFeld($('#a_asbest'), a, 'asbest', 'anlagen');
  $('#a_nutz2').addEventListener('input', e => {
    a.sk_angaben = Object.assign({}, a.sk_angaben, { nutzung2: e.target.value });
    feldSpeichern('anlagen', a.id, 'sk_angaben', a.sk_angaben);
  });

  $('#a_del').addEventListener('click', async () => {
    if (!confirm(`Anlage «${a.name || 'ohne Name'}» mit allen Messzeilen löschen?`)) return;
    await zeileLoeschen('anlagen', a.id);
    S.anlagen = S.anlagen.filter(x => x.id !== a.id);
    S.anlageId = S.anlagen.length ? S.anlagen[0].id : null;
    S.gruppen = null;
    renderAnlagen();
  });

  $('#btnDiktat').addEventListener('click', async () => {
    const zeilen = diktatLesen($('#diktat').value);
    if (!zeilen.length) return alert('Keine Zeilen gefunden.');
    const start = (S.gruppen || []).length;
    const neu = zeilen.map((z, i) => ({
      anlage_id: a.id, kontrolle_id: S.kontrolle.id, reihenfolge: start + i, nr: z.nr, bez: z.bez
    }));
    for (const z of neu) await zeileAnlegen('gruppen', z);
    $('#diktat').value = '';
    S.gruppen = null;
    gruppenListe();
  });

  $('#btnAddG').addEventListener('click', async () => {
    await zeileAnlegen('gruppen', {
      anlage_id: a.id, kontrolle_id: S.kontrolle.id, reihenfolge: (S.gruppen || []).length
    });
    S.gruppen = null;
    gruppenListe();
  });

  gruppenListe();
}

/* ---- PV-Angaben: kleine Tabellen mit beliebig vielen Zeilen ---- */

function pvTabelle(schluessel, titel, zeilen, spalten) {
  return `<label class="f" style="margin-top:14px">${esc(titel)}</label>
    <div class="pvtab" data-pv="${schluessel}">
      <table class="mess">
        <thead><tr>${spalten.map(([, t, b]) => `<th ${b ? `style="width:${b}px"` : ''}>${esc(t)}</th>`).join('')}<th style="width:34px"></th></tr></thead>
        <tbody>
          ${zeilen.map((z, i) => `<tr data-i="${i}">
            ${spalten.map(([feld]) => `<td><input type="text" data-feld="${feld}" value="${esc(z[feld] || '')}"></td>`).join('')}
            <td><button class="iconbtn pvdel" title="Zeile löschen">🗑</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="btnrow"><button class="btn small pvadd" data-pv="${schluessel}">＋ Zeile</button></div>`;
}

function pvVerdrahten(a) {
  const holen = () => (a.sk_angaben || {}).pv || {};
  const setzen = neu => {
    a.sk_angaben = Object.assign({}, a.sk_angaben, { pv: Object.assign({}, holen(), neu) });
    feldSpeichern('anlagen', a.id, 'sk_angaben', a.sk_angaben);
  };
  const einfach = { pv_projekt: 'projekt', pv_kwdc: 'kwdc', pv_kvaac: 'kvaac', pv_beschrieb: 'beschrieb',
                    pv_typ: 'typ', pv_ausrichtung: 'ausrichtung', pv_neigung: 'neigung', pv_kurz: 'kurz',
                    pv_inbetrieb: 'inbetriebnahme', pv_von: 'montage_von', pv_bis: 'montage_bis' };
  Object.entries(einfach).forEach(([id, feld]) => {
    const el = $('#' + id);
    if (!el) return;
    const ereignis = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(ereignis, () => setzen({ [feld]: el.value }));
  });

  $$('.pvtab').forEach(tab => {
    const schluessel = tab.dataset.pv;
    tab.querySelectorAll('tbody tr').forEach(tr => {
      const i = Number(tr.dataset.i);
      tr.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => {
        const liste = (holen()[schluessel] || []).slice();
        liste[i] = Object.assign({}, liste[i], { [inp.dataset.feld]: inp.value });
        setzen({ [schluessel]: liste });
      }));
      tr.querySelector('.pvdel').addEventListener('click', () => {
        const liste = (holen()[schluessel] || []).slice();
        liste.splice(i, 1);
        setzen({ [schluessel]: liste });
        renderAnlagen();
      });
    });
  });
  $$('.pvadd').forEach(b => b.addEventListener('click', () => {
    const schluessel = b.dataset.pv;
    const liste = (holen()[schluessel] || []).concat([{}]);
    setzen({ [schluessel]: liste });
    renderAnlagen();
  }));
}

function renderAnlagenChipsNeu() {
  $$('.chip[data-aid]').forEach(c => {
    const a = (S.anlagen || []).find(x => x.id === c.dataset.aid);
    if (a) c.textContent = a.name || 'Anlage ohne Name';
  });
}

// Diktat: «F1 Wohnen Essen Küche» → {nr: 'F1', bez: 'Wohnen Essen Küche'}
function diktatLesen(text) {
  const out = [];
  for (let zeile of String(text).split(/\n+/)) {
    zeile = zeile.trim().replace(/[.,;:!]+$/, '').trim();
    if (!zeile) continue;
    zeile = zeile.replace(/^([A-Za-z]{1,2})\s+(\d)/, '$1$2');   // «F 1» → «F1»
    const m = zeile.match(/^(\S+)\s+(.+)$/);
    if (m && /\d/.test(m[1]) && m[1].length <= 8 && /^[A-Za-z0-9./-]+$/.test(m[1])) {
      out.push({ nr: m[1].toUpperCase(), bez: m[2].trim() });
    } else {
      out.push({ nr: '', bez: zeile });
    }
  }
  return out;
}

async function gruppenLaden() {
  const data = await zeilenHolen('gruppen', 'anlage_id', S.anlageId, 'reihenfolge');
  S.gruppen = data;
  paketNachfuehren();
  return data;
}

async function gruppenListe() {
  const box = $('#glist');
  if (!box) return;
  if (!S.gruppen) await gruppenLaden();
  const zaehler = $('#gcount');
  if (zaehler) zaehler.textContent = '(' + S.gruppen.length + ')';
  box.innerHTML = S.gruppen.map((g, i) => `
    <div class="gruppenrow" data-gid="${g.id}">
      ${i === 0 ? '<span class="zuleitung-tag">ZULEITUNG</span>' : ''}
      <input type="text" class="nr" value="${esc(g.nr)}" placeholder="Nr.">
      <input type="text" class="bez" value="${esc(g.bez)}" placeholder="Bezeichnung / Ort, Anlageteil">
      <button class="iconbtn up" title="nach oben">▲</button>
      <button class="iconbtn down" title="nach unten">▼</button>
      <button class="iconbtn del" title="löschen">🗑</button>
    </div>`).join('') || '<div class="empty">Noch keine Gruppen.</div>';

  $$('#glist .gruppenrow').forEach(row => {
    const g = S.gruppen.find(x => x.id === row.dataset.gid);
    bindeFeld(row.querySelector('.nr'), g, 'nr', 'gruppen');
    bindeFeld(row.querySelector('.bez'), g, 'bez', 'gruppen');
    row.querySelector('.del').addEventListener('click', async () => {
      if (g.bez && !confirm(`Zeile «${g.nr} ${g.bez}» löschen?`)) return;
      await zeileLoeschen('gruppen', g.id);
      S.gruppen = null; gruppenListe();
    });
    row.querySelector('.up').addEventListener('click', () => gruppeVerschieben(g.id, -1));
    row.querySelector('.down').addEventListener('click', () => gruppeVerschieben(g.id, 1));
  });
}

async function gruppeVerschieben(id, richtung) {
  const i = S.gruppen.findIndex(g => g.id === id);
  const j = i + richtung;
  if (i < 0 || j < 0 || j >= S.gruppen.length) return;
  const a = S.gruppen[i], b = S.gruppen[j];
  await auftragEinreihen({ art: 'update', tabelle: 'gruppen', id: a.id, werte: { reihenfolge: j } });
  await auftragEinreihen({ art: 'update', tabelle: 'gruppen', id: b.id, werte: { reihenfolge: i } });
  a.reihenfolge = j; b.reihenfolge = i;
  S.gruppen = null;
  gruppenListe();
}

/* ============================================================
   Reiter: Messen
   ============================================================ */

const MESS_SPALTEN = [
  { feld: 'nr', titel: 'Nr.', w: 4 },
  { feld: 'bez', titel: 'Ort / Anlageteil', w: 13, cls: 'wide' },
  { feld: 'art', titel: 'Art/ Typ', w: 5 },
  { feld: 'leiter', titel: 'Leiter/ Quer.', w: 6.5 },
  { feld: 'charakt', titel: 'Charakt.', w: 6 },
  { feld: 'in_a', titel: 'In [A]', w: 4.5, num: true },
  { feld: 'ik_anf_pe', titel: 'IK Anf. L-PE', w: 6, num: true },
  { feld: 'ik_end_pe', titel: 'IK Ende L-PE', w: 6, num: true },
  { feld: 'ik_anf_n', titel: 'IK Anf. L-N', w: 6, num: true },
  { feld: 'ik_end_n', titel: 'IK Ende L-N', w: 6, num: true },
  { feld: 'riso', titel: 'RISO [MΩ]', w: 5.5, num: true },
  { feld: 'rlo', titel: 'Rlo', w: 5.5 },
  { feld: 'rcd_in', titel: 'RCD In [A]', w: 5, num: true },
  { feld: 'idn', titel: 'IΔN [mA]', w: 5, num: true },
  { feld: 'ausl', titel: 'Ausl. [ms]', w: 5.5, num: true },
  { feld: 'weiteres', titel: 'Weiteres', w: 10.5, cls: 'wide' }
];

async function renderMess() {
  const v = $('#view');
  if (!S.anlagen) { v.innerHTML = '<div class="empty">Wird geladen …</div>'; await anlagenLaden(); }
  const chips = anlagenChips(renderMess);
  const a = akt();
  if (!a) {
    v.innerHTML = `<h2>Messwerte erfassen</h2>${chips.html}
      <div class="empty">Zuerst unter <b>🔌 Anlagen</b> eine Anlage anlegen.</div>`;
    chips.wire();
    return;
  }
  if (!S.gruppen) await gruppenLaden();
  if (!S.gruppen.length) {
    v.innerHTML = `<h2>Messwerte erfassen</h2>${chips.html}
      <div class="empty">Diese Anlage hat noch keine Gruppen – erfasse sie unter <b>🔌 Anlagen</b>.</div>`;
    chips.wire();
    return;
  }

  v.innerHTML = `<h2>Messwerte erfassen</h2>${chips.html}
    <div class="hint">Gelbe Zeile = Zuleitung. Trägst du dort <b>IK Ende</b> ein, wird der Wert automatisch
      als <b>IK Anfang</b> in die Gruppen darunter übernommen (nur leere bzw. gleich gebliebene Felder).</div>
    <div class="tablewrap"><table class="mess">
      <colgroup>${MESS_SPALTEN.map(c => `<col style="width:${c.w}%">`).join('')}</colgroup>
      <thead><tr>${MESS_SPALTEN.map(c => `<th class="${c.cls || ''}">${c.titel}</th>`).join('')}</tr></thead>
      <tbody>
        ${S.gruppen.map((g, i) => `<tr class="${i === 0 ? 'zuleitung' : ''}" data-gid="${g.id}">
          ${MESS_SPALTEN.map(c => `<td class="${c.cls || ''}"><input type="text" ${c.num ? 'inputmode="decimal"' : ''}
             data-feld="${c.feld}" value="${esc(g[c.feld])}"></td>`).join('')}
        </tr>`).join('')}
      </tbody></table></div>`;
  chips.wire();

  $$('table.mess input').forEach(inp => {
    const g = S.gruppen.find(x => x.id === inp.closest('tr').dataset.gid);
    const feld = inp.dataset.feld;
    inp.addEventListener('focus', () => inp.select && inp.select());
    inp.addEventListener('input', () => {
      const alt = g[feld];
      g[feld] = inp.value;
      feldSpeichern('gruppen', g.id, feld, inp.value);
      if (S.gruppen[0] === g && (feld === 'ik_end_pe' || feld === 'ik_end_n')) {
        ikUebernehmen(feld, alt, inp.value);
      }
    });
  });
}

/* ============================================================
   Grundeinstellungen der Firma (Vorgaben fürs Schnell-Ausfüllen)
   ============================================================ */

const GRUND_STANDARD = {
  kabelArten: ['TT', 'FE0', 'Cca'],
  draehte: ['2', '3', '5'],
  sicherungsArten: ['NH00', 'LS-B', 'LS-C', 'LS-D', 'DI', 'DII', 'DIII', 'FI LS-C', 'LS-L', 'LS-V'],
  ampere: ['6', '10', '13', '16', '20', '25', '32', '40', '50', '60', '63', '80', '100'],
  querschnitt: { '6': '1', '10': '1.5', '13': '1.5', '16': '2.5', '20': '4', '25': '6',
                 '32': '10', '40': '10', '50': '16', '60': '16', '63': '16', '80': '25', '100': '35' },
  risoDefault: '500', rloDefault: 'i.o.', idnDefault: '30',
  messgeraete: '', normen: [],
  erledigungsText: 'Die aufgeführten Mängel sind durch eine fachkundige Person oder eine kontrollberechtigte '
    + 'Person beheben zu lassen. Nach erfolgter Behebung ist die untenstehende Bestätigung zu datieren, zu '
    + 'stempeln und zu unterzeichnen und dieser Kontrollbericht an die ausführende Firma zurückzusenden.',
  // Fertigtexte für den Reiter Mängel – firmenweit gleich, nur der Admin ändert sie
  mangelTexte: [],
  infoTexte: []
};

S.grund = null;

async function grundLaden() {
  if (S.grund) return S.grund;
  const { data } = await sb.from('einstellungen').select('inhalt')
    .eq('firma_id', S.profil.firma_id).eq('schluessel', 'grund').maybeSingle();
  S.grund = Object.assign({}, GRUND_STANDARD, (data && data.inhalt) || {});
  return S.grund;
}

async function grundSpeichern() {
  const { error } = await sb.from('einstellungen')
    .upsert({ firma_id: S.profil.firma_id, schluessel: 'grund', inhalt: S.grund },
            { onConflict: 'firma_id,schluessel' });
  if (error) return fehler(error);
  setSaveState('saved', '✓ Gespeichert');
}

/* ============================================================
   Reiter: Schnell-Ausfüllen
   ============================================================ */

S.fillWahl = { kabel: null, draehte: null, sich: null, amp: null };
S.fillGid = null;

async function renderFill() {
  const v = $('#view');
  if (!S.anlagen) { v.innerHTML = '<div class="empty">Wird geladen …</div>'; await anlagenLaden(); }
  const G = await grundLaden();
  const chips = anlagenChips(() => { S.fillGid = null; renderFill(); });
  const a = akt();
  if (!a) {
    v.innerHTML = `<h2>Schnell-Ausfüllen</h2>${chips.html}<div class="empty">Zuerst unter <b>🔌 Anlagen</b> eine Anlage anlegen.</div>`;
    chips.wire(); return;
  }
  if (!S.gruppen) await gruppenLaden();
  if (!S.gruppen.length) {
    v.innerHTML = `<h2>Schnell-Ausfüllen</h2>${chips.html}<div class="empty">Diese Anlage hat noch keine Gruppen.</div>`;
    chips.wire(); return;
  }
  if (!S.fillGid || !S.gruppen.some(g => g.id === S.fillGid)) S.fillGid = S.gruppen[0].id;

  const knopfreihe = (titel, schluessel, werte) => `
    <div class="optlabel">${titel}</div>
    <div class="optbtns" data-key="${schluessel}">
      ${werte.map(w => `<button data-val="${esc(w)}" class="${S.fillWahl[schluessel] === w ? 'sel' : ''}">${esc(w)}</button>`).join('')}
    </div>`;

  v.innerHTML = `<h2>Schnell-Ausfüllen</h2>${chips.html}
    <div class="hint">Links Gruppe wählen → rechts die vier Eigenschaften antippen → <b>Übernehmen</b>.
      Die Auswahl bleibt für die nächste Gruppe stehen. Vorbefüllt werden Art/Typ, Leiter×Querschnitt,
      Charakteristik, In, RISO (${esc(G.risoDefault)}, leer bei 2 Drähten), Rlo (${esc(G.rloDefault)})
      und bei FI-Typen RCD In + ${esc(G.idnDefault)} mA.</div>
    <div class="filllayout">
      <div class="fillleft" id="fillleft"></div>
      <div class="fillright card">
        ${knopfreihe('1 · Kabelart', 'kabel', G.kabelArten)}
        ${knopfreihe('2 · Anzahl Drähte', 'draehte', G.draehte)}
        ${knopfreihe('3 · Art der Sicherung', 'sich', G.sicherungsArten)}
        ${knopfreihe('4 · Sicherungsgrösse [A]', 'amp', G.ampere)}
        <div class="btnrow" style="margin-top:16px">
          <button class="btn primary" id="btnApply" style="flex:1">✓ Übernehmen &amp; weiter</button>
          <button class="btn" id="btnSkip">Überspringen</button>
        </div>
      </div>
    </div>`;
  chips.wire();

  const linksZeichnen = () => {
    $('#fillleft').innerHTML = S.gruppen.map((g, i) => {
      const zus = [g.art, g.leiter, g.charakt, g.in_a ? g.in_a + 'A' : ''].filter(Boolean).join(' · ');
      return `<button class="fillgroup ${g.id === S.fillGid ? 'active' : ''}" data-gid="${g.id}">
        <span class="gnr">${esc(g.nr || (i === 0 ? 'Zul.' : '–'))}</span>${esc(g.bez)}
        <span class="gsum ${zus ? 'done' : ''}">${esc(zus || 'noch nicht ausgefüllt')}</span></button>`;
    }).join('');
    $$('#fillleft .fillgroup').forEach(b => b.addEventListener('click', () => {
      S.fillGid = b.dataset.gid; linksZeichnen();
    }));
    const aktiv = $('#fillleft .fillgroup.active');
    if (aktiv) aktiv.scrollIntoView({ block: 'nearest' });
  };
  linksZeichnen();

  $$('.optbtns').forEach(box => box.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const k = box.dataset.key;
    S.fillWahl[k] = (S.fillWahl[k] === b.dataset.val) ? null : b.dataset.val;
    box.querySelectorAll('button').forEach(x => x.classList.toggle('sel', x.dataset.val === S.fillWahl[k]));
  }));

  const weiter = () => {
    const i = S.gruppen.findIndex(g => g.id === S.fillGid);
    if (i < S.gruppen.length - 1) S.fillGid = S.gruppen[i + 1].id;
    linksZeichnen();
  };

  $('#btnApply').addEventListener('click', () => {
    const g = S.gruppen.find(x => x.id === S.fillGid);
    if (!g) return;
    const w = S.fillWahl, neu = {};
    if (w.kabel) neu.art = w.kabel;
    const qs = w.amp ? (G.querschnitt[w.amp] || '') : '';
    if (w.draehte || qs) neu.leiter = (w.draehte ? w.draehte + 'x' : '') + qs;
    if (w.sich) neu.charakt = w.sich;
    if (w.amp) neu.in_a = w.amp;
    neu.riso = (w.draehte === '2') ? '' : G.risoDefault;   // 2 Drähte: RISO bleibt leer
    neu.rlo = G.rloDefault;
    if (w.sich && w.sich.toUpperCase().includes('FI')) {
      neu.rcd_in = w.amp || ''; neu.idn = G.idnDefault;
    } else { neu.rcd_in = ''; neu.idn = ''; }
    Object.assign(g, neu);
    Object.entries(neu).forEach(([f, wert]) => feldSpeichern('gruppen', g.id, f, wert));
    weiter();
  });
  $('#btnSkip').addEventListener('click', weiter);
}

/* ============================================================
   Reiter: Mängel / Informationen / Notizen (mit Fotos)
   ============================================================ */

S.maengel = null;

async function maengelLaden() {
  const data = await zeilenHolen('maengel', 'kontrolle_id', S.kontrolle.id, 'reihenfolge');
  S.maengel = data;
  paketNachfuehren();
  return data;
}

const istMangel = m => (m.typ || 'mangel') === 'mangel';

async function renderMaengel() {
  const v = $('#view');
  if (!S.anlagen) await anlagenLaden();
  if (!S.maengel) { v.innerHTML = '<div class="empty">Wird geladen …</div>'; await maengelLaden(); }

  const G = await grundLaden();

  const anlagenWahl = aid => ['<option value="">– Anlage wählen –</option>']
    .concat((S.anlagen || []).map(a => `<option value="${a.id}" ${a.id === aid ? 'selected' : ''}>${esc(a.name || 'Anlage ohne Name')}</option>`)).join('');

  // Fertigtexte der Firma – je nach Art des Eintrags
  const bausteine = typ => typ === 'info' ? (G.infoTexte || []) : typ === 'mangel' ? (G.mangelTexte || []) : [];
  const bausteinWahl = typ => {
    const liste = bausteine(typ);
    if (!liste.length) return '';
    return `<select class="m_baustein"><option value="">＋ Textbaustein einsetzen …</option>${
      liste.map((t, i) => `<option value="${i}">${esc(t.length > 70 ? t.slice(0, 70) + '…' : t)}</option>`).join('')
    }</select>`;
  };

  let nr = 0;
  v.innerHTML = `<h2>Mängel (${S.maengel.filter(istMangel).length})</h2>
    <div class="btnrow">
      <button class="btn primary" id="mAdd">＋ Mangel</button>
      <button class="btn" id="iAdd">＋ Info</button>
      <button class="btn" id="nAdd">＋ Notiz</button>
    </div>
    <div class="hint">📝 <b>Notizen</b> sind nur für den internen Gebrauch – sie erscheinen nicht im
      Kontrollbericht für den Kunden, nur im internen Bericht.</div>
    ${S.maengel.length ? '' : '<div class="empty">Keine Mängel erfasst. Sehr schön! 🎉</div>'}
    ${S.maengel.map(m => {
      const typ = m.typ || 'mangel';
      if (typ === 'mangel') nr++;
      const titel = typ === 'notiz' ? 'Notiz (intern)' : typ === 'info' ? 'Info' : 'Mangel ' + nr;
      return `<div class="card mangelcard ${typ === 'info' ? 'infocard' : ''} ${typ === 'notiz' ? 'notizcard' : ''}" data-mid="${m.id}">
        <div class="row" style="align-items:flex-end">
          <div class="narrow" style="flex:0 0 auto">
            <label class="f">${titel}</label>
            <div class="typtoggle">
              <button class="t_m ${typ === 'mangel' ? 'on' : ''}">⚠️ Mangel</button>
              <button class="t_i ${typ === 'info' ? 'on' : ''}">ℹ️ Info</button>
              <button class="t_n ${typ === 'notiz' ? 'on' : ''}">📝 Notiz</button>
            </div>
          </div>
          <div><label class="f">Anlage</label><select class="m_anlage">${anlagenWahl(m.anlage_id)}</select></div>
          <div><label class="f">Ort (Zimmer, Anlageteil)</label><input type="text" class="m_ort" value="${esc(m.ort)}"></div>
        </div>
        <label class="f">${typ === 'notiz' ? 'Notiztext (intern)' : typ === 'info' ? 'Informationstext' : 'Mängeltext'}</label>
        ${bausteinWahl(typ)}
        <textarea class="m_text">${esc(m.text)}</textarea>
        <div class="btnrow">
          <label class="btn" style="display:inline-flex;align-items:center;gap:8px;cursor:pointer">📷 Foto aufnehmen / wählen
            <input type="file" class="m_foto" accept="image/*" capture="environment" multiple style="display:none">
          </label>
          <button class="btn danger small m_del">Löschen</button>
        </div>
        <div class="fotothumbs"></div>
      </div>`;
    }).join('')}`;

  const neu = async typ => {
    const zeile = await zeileAnlegen('maengel', {
      kontrolle_id: S.kontrolle.id, anlage_id: S.anlageId, typ,
      reihenfolge: S.maengel.length
    });
    S.maengel.push(zeile);
    renderMaengel();
  };
  $('#mAdd').addEventListener('click', () => neu('mangel'));
  $('#iAdd').addEventListener('click', () => neu('info'));
  $('#nAdd').addEventListener('click', () => neu('notiz'));

  for (const karte of $$('.mangelcard')) {
    const m = S.maengel.find(x => x.id === karte.dataset.mid);
    const typSetzen = async typ => {
      m.typ = typ;
      feldSpeichern('maengel', m.id, 'typ', typ);
      renderMaengel();
    };
    karte.querySelector('.t_m').addEventListener('click', () => typSetzen('mangel'));
    karte.querySelector('.t_i').addEventListener('click', () => typSetzen('info'));
    karte.querySelector('.t_n').addEventListener('click', () => typSetzen('notiz'));
    bindeFeld(karte.querySelector('.m_ort'), m, 'ort', 'maengel');
    bindeFeld(karte.querySelector('.m_text'), m, 'text', 'maengel');
    const wahl = karte.querySelector('.m_baustein');
    if (wahl) wahl.addEventListener('change', () => {
      const text = bausteine(m.typ || 'mangel')[Number(wahl.value)];
      wahl.value = '';
      if (text === undefined) return;
      const feld = karte.querySelector('.m_text');
      const fertig = text.replace(/\\n/g, '\n');
      feld.value = feld.value.trim() ? feld.value.trim() + '\n' + fertig : fertig;
      m.text = feld.value;
      feldSpeichern('maengel', m.id, 'text', m.text);
    });
    karte.querySelector('.m_anlage').addEventListener('change', e => {
      m.anlage_id = e.target.value || null;
      feldSpeichern('maengel', m.id, 'anlage_id', m.anlage_id);
    });
    karte.querySelector('.m_del').addEventListener('click', async () => {
      if (!confirm('Diesen Eintrag mit allen Fotos löschen?')) return;
      if (m.fotos && m.fotos.length) {
        await auftragEinreihen({ art: 'foto_weg', pfade: m.fotos.slice() });
        for (const pfad of m.fotos) await ablageWeg('fotos', pfad);
      }
      await zeileLoeschen('maengel', m.id);
      S.maengel = S.maengel.filter(x => x.id !== m.id);
      renderMaengel();
    });
    karte.querySelector('.m_foto').addEventListener('change', async e => {
      const dateien = Array.from(e.target.files);
      e.target.value = '';
      setSaveState('saving', '● Foto wird geladen…');
      for (const datei of dateien) {
        try {
          const blob = await fotoVerkleinern(datei);
          const pfad = `${S.kontrolle.id}/${crypto.randomUUID()}.jpg`;
          // Erst ins Gerät – so ist das Bild auch ohne Empfang sofort da
          await ablageSchreiben('fotos', blob, pfad);
          m.fotos = (m.fotos || []).concat(pfad);
          await auftragEinreihen({ art: 'foto_hoch', pfad });
          await auftragEinreihen({ art: 'update', tabelle: 'maengel', id: m.id, werte: { fotos: m.fotos } });
          paketNachfuehren();
        } catch (err) { setSaveState('error', '⚠️ Foto'); return fehler(err); }
      }
      setSaveState('saved', '✓ Gespeichert');
      bilderZeigen(karte, m);
    });
    bilderZeigen(karte, m);
  }
}

// Fotos werden auf 1600 px verkleinert – spart Speicher und Übertragung
function fotoVerkleinern(datei, maxKante = 1600, guete = 0.82) {
  return new Promise((res, rej) => {
    const bild = new Image();
    const url = URL.createObjectURL(datei);
    bild.onload = () => {
      let { width: w, height: h } = bild;
      if (Math.max(w, h) > maxKante) {
        const f = maxKante / Math.max(w, h);
        w = Math.round(w * f); h = Math.round(h * f);
      }
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(bild, 0, 0, w, h);
      URL.revokeObjectURL(url);
      cv.toBlob(b => b ? res(b) : rej(new Error('Bild konnte nicht umgewandelt werden')), 'image/jpeg', guete);
    };
    bild.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Bild konnte nicht gelesen werden')); };
    bild.src = url;
  });
}

// Pfad → { url, bis }. Die Adressen sind nur eine Stunde gültig; wir merken uns
// darum, wann sie ablaufen, und holen rechtzeitig eine neue (sonst bleibt das
// Bild nach längerem Arbeiten leer).
const bildAdressen = new Map();

async function bildAdresse(pfad, neu) {
  const alt = bildAdressen.get(pfad);
  if (!neu && alt && alt.bis > Date.now()) return alt.url;
  // Liegt das Bild im Gerät, brauchen wir gar keine Verbindung
  const eigen = await ablageLesen('fotos', pfad);
  if (eigen) {
    const url = URL.createObjectURL(eigen);
    bildAdressen.set(pfad, { url, bis: Date.now() + 50 * 60 * 1000 });
    return url;
  }
  if (!navigator.onLine) throw new Error('ohne Verbindung nicht verfügbar');
  const { data, error } = await sb.storage.from('fotos').createSignedUrl(pfad, 3600);
  if (error || !data) throw (error || new Error('Foto konnte nicht geladen werden'));
  bildAdressen.set(pfad, { url: data.signedUrl, bis: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}

async function bilderZeigen(karte, m) {
  const box = karte.querySelector('.fotothumbs');
  box.innerHTML = '';
  for (const pfad of (m.fotos || [])) {
    let url;
    try {
      url = await bildAdresse(pfad);
    } catch (e) {
      const hinweis = document.createElement('div');
      hinweis.className = 'hint';
      hinweis.textContent = '⚠️ Ein Foto konnte nicht geladen werden: ' + (e && e.message ? e.message : e);
      box.append(hinweis);
      continue;
    }
    const div = document.createElement('div');
    div.className = 'thumb';
    const img = document.createElement('img');
    img.src = url;
    // Abgelaufene Adresse: einmal eine frische holen
    img.addEventListener('error', async () => {
      if (img.dataset.neu) return;
      img.dataset.neu = '1';
      try { img.src = await bildAdresse(pfad, true); } catch (e) { /* bleibt leer */ }
    });
    const del = document.createElement('button');
    del.className = 'del'; del.textContent = '✕';
    del.addEventListener('click', async () => {
      if (!confirm('Foto löschen?')) return;
      m.fotos = m.fotos.filter(p => p !== pfad);
      await ablageWeg('fotos', pfad);
      await auftragEinreihen({ art: 'foto_weg', pfade: [pfad] });
      await auftragEinreihen({ art: 'update', tabelle: 'maengel', id: m.id, werte: { fotos: m.fotos } });
      paketNachfuehren();
      bilderZeigen(karte, m);
    });
    div.append(img, del);
    box.append(div);
  }
}

/* ============================================================
   Reiter: Sichtkontrolle (pro Anlage)
   ============================================================ */

const SICHT_STANDARD = [
  ['gruppe', 'Sichtprüfung'],
  ['auswahl', 'Richtige Auswahl und Anordnung der Betriebsmittel (Umgebungsbedingungen)'],
  ['basisschutz', 'Basisschutz (Schutz gegen direktes Berühren)'],
  ['unterlagen', 'Beachtung vom Hersteller mitgelieferte technische Unterlagen'],
  ['abschalt', 'Abschalt- und Trennvorrichtungen'],
  ['sicherheit', 'Sicherheitseinrichtungen / Anlage- und Revisionsschalter'],
  ['brand', 'Brandabschottung vorhanden'],
  ['verlegung', 'Leitungsverlegung (Bemessung / Anordnung / Kennzeichnung)'],
  ['kennzeichnung', 'Kennzeichnung der Stromkreise, Überstrom-Schutzeinricht. etc.'],
  ['zugang', 'Zugänglichkeit der Betriebsmittel'],
  ['spa', 'Schutzpotenzialausgleich'],
  ['spa_lokal', 'Zusätzlicher örtlicher Schutzpotenzialausgleich'],
  ['bus_anordnung', 'Anordnung der Busgeräte im Verteiler (Abstände)'],
  ['bus_leitungen', 'Busleitungen / Aktoren gemäss höchster Spannung'],
  ['schutzeinstellung', 'Auswahl und Einstellung von Schutz-/Überwachungseinrichtungen'],
  ['schaltplaene', 'Vorhandensein von Schaltplänen, Warn-, Verbotszeichen, Schemata, Legenden'],
  ['gruppe', 'Funktionsprüfung und Messung'],
  ['leitfaehigkeit', 'Leitfähigkeit des Schutzleiters, Schutzpotenzialausgleich'],
  ['abschaltung', 'Automatische Abschaltung im Fehlerfall'],
  ['drehfeld', 'Rechtsdrehfeld der Drehstromsteckdosen'],
  ['rcd', 'Funktion Fehlerstromschutzeinrichtung (RCD)'],
  ['spannungsfall', 'Spannungsfall eingehalten'],
  ['gruppe', 'Dokumentation'],
  ['doku', 'Anlagedokumentation übergeben'],
  ['schema', 'Schema vorhanden'],
  ['sk_ident', 'SK-Identifikation nach Herstellererklärung mit Stücknachweis'],
  ['sk_einbezogen', 'SK in die Schlusskontrolle miteinbezogen']
];

const SICHT_PV = [
  ['gruppe', 'Besichtigung Gleichstromseite'],
  ['pv_auswahl', 'Richtige Auswahl und Anordnung aller Systemkomponenten und Montagesysteme'],
  ['pv_dach', 'Dachbefestigungsteile und Kabeleinführung witterungsbeständig'],
  ['pv_bsm', 'Vorgaben BSM / STP eingehalten (Konstruktion / Material)'],
  ['pv_spa', 'Installierte Schutz- und SPA-Leiter parallel und nahe DC-Leitungen'],
  ['pv_ueberspannung', 'Installierte Überspannungs-Schutzeinrichtungen entsprechen dem Schutzkonzept'],
  ['pv_schleifen', 'Minimale Fläche der Leitungsschleifen sichergestellt'],
  ['pv_trennabstand', 'Trennungsabstände eingehalten'],
  ['pv_dauerbetrieb', 'Alle DC-Komponenten für Dauerbetrieb mit Umax/Imax ausgelegt'],
  ['pv_uocmax', 'PV-Module für Systemspannung bemessen (Uocmax)'],
  ['pv_trennvorrichtung', 'Trennvorrichtungen für PV-Arraystränge und Teilarrays vorhanden'],
  ['pv_dc_last', 'DC-Lasttrennschalter vorhanden'],
  ['gruppe', 'Besichtigung Wechselstromseite'],
  ['pv_anschluss', 'Anschluss aller Trenn- und Schalteinrichtungen korrekt'],
  ['pv_ac_last', 'AC-Lasttrennschalter vorhanden'],
  ['pv_rcd_b', 'RCD Typ B vorhanden'],
  ['pv_rcd_wr', 'Schutz durch RCD im WR eingebaut'],
  ['pv_na_schutz', 'Betriebs- und Schutzparameter WR gemäss separatem Blatt (NA-Schutz)'],
  ['gruppe', 'Aufschriften und Kennzeichnung'],
  ['pv_aufschriften', 'Alle Stromkreise, Schutzeinrichtungen, Schalter und Klemmen beschriftet'],
  ['pv_warn_wr', 'Warnhinweise auf WR (Typ B)'],
  ['pv_warn_dc', 'Warnhinweise Solar-DC (Typ C)'],
  ['pv_warn_sgk', 'Warnhinweise auf SGK / HAK (Typ A)'],
  ['pv_prinzipschema', 'Prinzipschema vor Ort vorhanden'],
  ['pv_abschaltverfahren', 'Abschaltverfahren vor Ort vorhanden'],
  ['pv_kontakt', 'Kontaktdaten Installateur vor Ort vorhanden']
];

S.sicht = null;

async function sichtLaden() {
  const data = await zeilenHolen('sichtkontrolle', 'anlage_id', S.anlageId);
  S.sicht = {};
  paketNachfuehren();
  data.forEach(z => { S.sicht[z.punkt] = z; });
  return S.sicht;
}

async function renderSicht() {
  const v = $('#view');
  if (!S.anlagen) { v.innerHTML = '<div class="empty">Wird geladen …</div>'; await anlagenLaden(); }
  const chips = anlagenChips(() => { S.sicht = null; renderSicht(); });
  const a = akt();
  if (!a) {
    v.innerHTML = `<h2>Sichtkontrolle</h2>${chips.html}
      <div class="empty">Zuerst unter <b>🔌 Anlagen</b> eine Anlage anlegen –
        die Sichtkontrolle wird pro Anlage erfasst.</div>`;
    chips.wire(); return;
  }
  if (!S.sicht) await sichtLaden();

  const liste = S.kontrolle.pv ? SICHT_PV : SICHT_STANDARD;
  const erledigt = liste.filter(([k]) => k !== 'gruppe' && S.sicht[k] && S.sicht[k].wert === 'ok').length;
  const gesamt = liste.filter(([k]) => k !== 'gruppe').length;

  v.innerHTML = `<h2>Sichtkontrolle</h2>${chips.html}
    <div class="hint">Wird <b>pro Anlage</b> erfasst und fliesst ins Mess- und Prüfprotokoll.
      Angetippt = geprüft und in Ordnung. ${S.kontrolle.pv ? '<b>PV-Anlage:</b> es erscheint die PV-Prüfliste.' : ''}</div>
    <div class="card"><b>${erledigt}</b> von ${gesamt} Punkten abgehakt
      <div class="btnrow" style="margin-top:10px">
        <button class="btn small" id="alleAn">Alle abhaken</button>
        <button class="btn small" id="alleAus">Alle zurücksetzen</button>
      </div></div>
    <div class="card">
      ${liste.map(([schluessel, text]) => schluessel === 'gruppe'
        ? `<h3>${esc(text)}</h3>`
        : `<label class="f sichtzeile" data-punkt="${schluessel}">
             <input type="checkbox" ${S.sicht[schluessel] && S.sicht[schluessel].wert === 'ok' ? 'checked' : ''}
                    style="width:auto;margin-right:10px">${esc(text)}</label>`).join('')}
    </div>`;
  chips.wire();

  $$('.sichtzeile input').forEach(el => el.addEventListener('change', async () => {
    const punkt = el.closest('.sichtzeile').dataset.punkt;
    await sichtSetzen(punkt, el.checked ? 'ok' : '');
    const kopf = $('.card b');
    if (kopf) kopf.textContent = liste.filter(([k]) => k !== 'gruppe' && S.sicht[k] && S.sicht[k].wert === 'ok').length;
  }));
  $('#alleAn').addEventListener('click', async () => { await alleSetzen(liste, 'ok'); renderSicht(); });
  $('#alleAus').addEventListener('click', async () => {
    if (!confirm('Alle Punkte dieser Anlage zurücksetzen?')) return;
    await alleSetzen(liste, ''); renderSicht();
  });
}

async function sichtSetzen(punkt, wert) {
  const zeile = { anlage_id: S.anlageId, kontrolle_id: S.kontrolle.id, punkt, wert };
  await auftragEinreihen({ art: 'upsert', tabelle: 'sichtkontrolle', werte: zeile,
    konflikt: 'anlage_id,punkt' });
  S.sicht[punkt] = Object.assign({ id: (S.sicht[punkt] || {}).id || crypto.randomUUID() }, zeile);
  paketNachfuehren();
}

async function alleSetzen(liste, wert) {
  const zeilen = liste.filter(([k]) => k !== 'gruppe')
    .map(([punkt]) => ({ anlage_id: S.anlageId, kontrolle_id: S.kontrolle.id, punkt, wert }));
  await auftragEinreihen({ art: 'upsert', tabelle: 'sichtkontrolle', werte: zeilen,
    konflikt: 'anlage_id,punkt' });
  zeilen.forEach(z => {
    S.sicht[z.punkt] = Object.assign({ id: (S.sicht[z.punkt] || {}).id || crypto.randomUUID() }, z);
  });
  paketNachfuehren();
}

// IK-Ende der Zuleitung als IK-Anfang in die übrigen Gruppen übernehmen
function ikUebernehmen(endFeld, alterWert, neuerWert) {
  const anfFeld = endFeld === 'ik_end_pe' ? 'ik_anf_pe' : 'ik_anf_n';
  S.gruppen.slice(1).forEach(g => {
    if (g[anfFeld] === '' || g[anfFeld] === alterWert) {
      g[anfFeld] = neuerWert;
      feldSpeichern('gruppen', g.id, anfFeld, neuerWert);
      const zeile = document.querySelector(`tr[data-gid="${g.id}"] input[data-feld="${anfFeld}"]`);
      if (zeile) zeile.value = neuerWert;
    }
  });
}

/* ============================================================
   Export und Import: Messwerte als CSV, ganze Kontrolle als Datei,
   Backup der ganzen Firma (nur Admin)
   ============================================================ */

const CSV_KOPF = ['Nr.', 'Bezeichnung', 'Art/Typ', 'Leiteranz./Quer. [mm2]', 'Art Charakt.', 'In [A]',
  'IK Anf. L-PE [A]', 'IK Ende L-PE [A]', 'IK Anf. L-N [A]', 'IK Ende L-N [A]',
  'RISO [MOhm]', 'Leitf. Schutzl.', 'RCD In/Typ [A]', 'IdN [mA]', 'Ausloesezeit [ms]'];

function csvText(gruppen, mitKopf) {
  const zeilen = mitKopf ? [CSV_KOPF.join('\t')] : [];
  for (const g of gruppen) {
    zeilen.push([g.nr, g.bez, g.art, g.leiter, g.charakt, g.in_a,
      g.ik_anf_pe, g.ik_end_pe, g.ik_anf_n, g.ik_end_n,
      g.riso, g.rlo, g.rcd_in, g.idn, g.ausl]
      .map(x => String(x ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t'));
  }
  return zeilen.join('\r\n');
}

function dateiSpeichern(name, inhalt, typ) {
  const blob = inhalt instanceof Blob ? inhalt : new Blob([inhalt], { type: typ || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
}

function blobZuText(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

// Alles, was zu einer Kontrolle gehört, in ein einziges Paket packen
async function kontrolleSammeln(id, mitFotos) {
  const hole = async (tabelle, spalte) => {
    const { data, error } = await sb.from(tabelle).select('*').eq(spalte || 'kontrolle_id', id);
    if (error) throw error;
    return data || [];
  };
  const { data: kopf, error } = await sb.from('kontrollen').select('*').eq('id', id).single();
  if (error) throw error;
  const paket = {
    art: 'elektrokontrolle-online', version: 1, erstellt: new Date().toISOString(),
    kontrolle: kopf,
    anlagen: await hole('anlagen'),
    gruppen: await hole('gruppen'),
    maengel: await hole('maengel'),
    sichtkontrolle: await hole('sichtkontrolle'),
    arbeitszeit: await hole('arbeitszeit'),
    status_verlauf: await hole('status_verlauf'),
    unterschriften: await hole('unterschriften'),
    fotos: {}
  };
  if (mitFotos !== false) {
    for (const m of paket.maengel) {
      for (const pfad of (m.fotos || [])) {
        if (paket.fotos[pfad]) continue;
        const { data } = await sb.storage.from('fotos').download(pfad);
        if (data) paket.fotos[pfad] = await blobZuText(data);
      }
    }
  }
  return paket;
}

// Ein Paket als NEUE Kontrolle der eigenen Firma anlegen (nichts wird überschrieben)
async function kontrolleEinspielen(paket) {
  const k = paket.kontrolle || {};
  const neu = {};
  // Nur bekannte Spalten übernehmen, IDs und Fremdschlüssel neu setzen
  ['rolle_ersteller', 'pv', 'status', 'status_rank', 'zugewiesen', 'kontrolleure', 'auftrag_nr',
   'auftrag_bez', 'kontrollumfang', 'plan_datum', 'pruefgrund', 'kontrollart', 'strasse', 'hausnr',
   'plz', 'ort', 'gebaeudeart', 'gemeinde', 'parz_nr', 'egid', 'vnb', 'vnb_objekt_nr', 'bemerkung',
   'eig', 'verwaltung', 'hak', 'messgeraete', 'weitere'].forEach(f => { if (k[f] !== undefined) neu[f] = k[f]; });
  neu.firma_id = S.profil.firma_id;
  neu.kontrolleure = [];          // Personen der fremden Firma gibt es hier nicht
  const { data: kopf, error } = await sb.from('kontrollen').insert(neu).select().single();
  if (error) throw error;

  const anlageNeu = {};           // alte Anlagen-ID → neue
  for (const a of (paket.anlagen || []).slice().sort((x, y) => (x.reihenfolge || 0) - (y.reihenfolge || 0))) {
    const zeile = { kontrolle_id: kopf.id };
    ['reihenfolge', 'name', 'zaehler_nr', 'stromkunde', 'stockwerk', 'periode', 'periode2_txt',
     'periode2', 'schutzsystem', 'erder', 'asbest', 'sk_angaben', 'geprueft_von']
      .forEach(f => { if (a[f] !== undefined) zeile[f] = a[f]; });
    const { data, error: e2 } = await sb.from('anlagen').insert(zeile).select().single();
    if (e2) throw e2;
    anlageNeu[a.id] = data.id;
  }

  const gruppen = (paket.gruppen || []).map(g => {
    const zeile = { kontrolle_id: kopf.id, anlage_id: anlageNeu[g.anlage_id] };
    ['reihenfolge', 'nr', 'bez', 'art', 'leiter', 'charakt', 'in_a', 'ik_anf_pe', 'ik_end_pe',
     'ik_anf_n', 'ik_end_n', 'riso', 'ileck', 'rlo', 'rcd_in', 'idn', 'ausl', 'weiteres']
      .forEach(f => { if (g[f] !== undefined) zeile[f] = g[f]; });
    return zeile;
  }).filter(z => z.anlage_id);
  if (gruppen.length) { const { error: e3 } = await sb.from('gruppen').insert(gruppen); if (e3) throw e3; }

  const sicht = (paket.sichtkontrolle || []).map(z => ({
    kontrolle_id: kopf.id, anlage_id: anlageNeu[z.anlage_id], punkt: z.punkt, wert: z.wert
  })).filter(z => z.anlage_id);
  if (sicht.length) { const { error: e4 } = await sb.from('sichtkontrolle').insert(sicht); if (e4) throw e4; }

  // Fotos zuerst neu hochladen, danach die Mängel mit den neuen Pfaden anlegen
  const fotoNeu = {};
  for (const [pfad, datenUrl] of Object.entries(paket.fotos || {})) {
    try {
      const blob = await (await fetch(datenUrl)).blob();
      const ziel = `${kopf.id}/${crypto.randomUUID()}.jpg`;
      const { error: e5 } = await sb.storage.from('fotos').upload(ziel, blob, { contentType: 'image/jpeg' });
      if (!e5) fotoNeu[pfad] = ziel;
    } catch (e) { /* einzelnes Foto überspringen */ }
  }
  const maengel = (paket.maengel || []).map(m => ({
    kontrolle_id: kopf.id,
    anlage_id: m.anlage_id ? (anlageNeu[m.anlage_id] || null) : null,
    typ: m.typ || 'mangel', reihenfolge: m.reihenfolge || 0,
    ort: m.ort || '', text: m.text || '',
    fotos: (m.fotos || []).map(p => fotoNeu[p]).filter(Boolean)
  }));
  if (maengel.length) { const { error: e6 } = await sb.from('maengel').insert(maengel); if (e6) throw e6; }

  const zeiten = (paket.arbeitszeit || []).map(z => ({
    kontrolle_id: kopf.id, benutzer_id: null, kuerzel: z.kuerzel || '',
    datum: z.datum, stunden: z.stunden, taetigkeit: z.taetigkeit || ''
  }));
  if (zeiten.length) await sb.from('arbeitszeit').insert(zeiten);

  const verlauf = (paket.status_verlauf || []).map(z => ({
    kontrolle_id: kopf.id, status: z.status, kuerzel: z.kuerzel || '',
    benutzer_id: null, gesetzt_am: z.gesetzt_am
  }));
  if (verlauf.length) await sb.from('status_verlauf').insert(verlauf);

  // Unterschriften werden bewusst NICHT übernommen – sie gelten nur für den
  // Stand, auf dem sie geleistet wurden.
  return kopf;
}

function dateiWaehlen(endung) {
  return new Promise(res => {
    const eingabe = document.createElement('input');
    eingabe.type = 'file';
    eingabe.accept = endung;
    eingabe.addEventListener('change', () => res(eingabe.files[0] || null));
    eingabe.click();
  });
}

/* ============================================================
   Optionen – vier Bereiche
   ============================================================ */

function renderSettings() {
  const v = $('#view');
  const bereiche = [
    ['grund', '🔧 Grundeinstellungen'],
    ['person', '👤 Mein Profil'],
    ['geraet', '💾 Speicher im Gerät']
  ];
  if (istAdmin() && !istSuperadmin()) bereiche.push(['firma', '🏢 Meine Firma'], ['team', '👥 Mitarbeiter']);
  if (istSuperadmin()) bereiche.push(['firmen', '🏢 Firmen verwalten'], ['supers', '🛡 Systemverwalter']);
  if (!bereiche.some(b => b[0] === S.einstellungsBereich)) S.einstellungsBereich = bereiche[0][0];

  v.innerHTML = `<h2>Optionen</h2>
    <div class="chips" id="optnav">
      ${bereiche.map(([k, t]) => `<button class="chip ${S.einstellungsBereich === k ? 'active' : ''}" data-b="${k}">${t}</button>`).join('')}
    </div>
    <div id="optbody"></div>`;
  $$('#optnav .chip').forEach(c => c.addEventListener('click', () => {
    S.einstellungsBereich = c.dataset.b;
    renderSettings();
  }));
  ({ grund: optGrund, person: optPerson, geraet: optGeraet, firma: optFirma, team: optTeam,
     firmen: optFirmen, supers: optSupers })[S.einstellungsBereich]();
}

/* ---- Grundeinstellungen der Firma ---- */
async function optGrund() {
  $('#optbody').innerHTML = '<div class="empty">Wird geladen …</div>';
  const G = await grundLaden();
  const feld = (id, titel, wert, hinweis) => `
    <label class="f">${titel}</label>
    ${hinweis ? `<div class="hint">${hinweis}</div>` : ''}
    <textarea id="${id}" spellcheck="false">${esc(wert)}</textarea>`;

  $('#optbody').innerHTML = `<div class="card">
    <h3 style="margin-top:0">Vorgaben fürs Schnell-Ausfüllen</h3>
    <div class="hint">Ein Wert pro Zeile. Diese Listen erscheinen im Reiter <b>⚡ Ausfüllen</b> als Knöpfe
      und gelten für die ganze Firma.</div>
    ${feld('g_kabel', 'Kabelarten', G.kabelArten.join('\n'))}
    ${feld('g_draehte', 'Anzahl Drähte', G.draehte.join('\n'), 'Bei «2» bleibt das RISO-Feld absichtlich leer.')}
    ${feld('g_sich', 'Sicherungsarten', G.sicherungsArten.join('\n'), 'Enthält ein Eintrag «FI», werden RCD In und IΔN automatisch gesetzt.')}
    ${feld('g_amp', 'Sicherungsgrössen [A]', G.ampere.join('\n'))}
    ${feld('g_qs', 'Querschnitt-Zuordnung (Ampere=mm²)',
        Object.entries(G.querschnitt).map(([a, q]) => `${a}=${q}`).join('\n'),
        'Format: 16=2.5 – bestimmt den Querschnitt hinter der Drahtzahl, z.B. 3x2.5.')}
    <div class="row">
      <div><label class="f">RISO Vorgabe [MΩ]</label><input type="text" id="g_riso" value="${esc(G.risoDefault)}"></div>
      <div><label class="f">Rlo Vorgabe</label><input type="text" id="g_rlo" value="${esc(G.rloDefault)}"></div>
      <div><label class="f">IΔN Vorgabe [mA]</label><input type="text" id="g_idn" value="${esc(G.idnDefault)}"></div>
    </div>
  </div>
  <div class="card">
    <h3 style="margin-top:0">Messgeräte</h3>
    <div class="hint">Voreinstellung für neue Kontrollen – eine Zeile pro Gerät. In der einzelnen Kontrolle
      kann sie überschrieben werden (z.B. wenn du ein Protokoll für jemand anderen erstellst).</div>
    <textarea id="g_geraete" spellcheck="false" placeholder="GMC M-Xtra BUBE Nr: 32113">${esc(G.messgeraete || '')}</textarea>
  </div>
  <div class="card">
    <h3 style="margin-top:0">Text zur Mängelerledigung</h3>
    <div class="hint">Erscheint im Kontrollbericht über der Bestätigung der Mängelbehebung – nur, wenn
      Mängel vorhanden sind.</div>
    <textarea id="g_erl" rows="4">${esc(G.erledigungsText || '')}</textarea>
  </div>
  <div class="card">
    <h3 style="margin-top:0">Textbausteine</h3>
    <div class="hint">Fertigtexte für den Reiter <b>⚠️ Mängel</b> – sie gelten für die ganze Firma und
      lassen sich dort mit einem Griff einsetzen. <b>Ein Baustein pro Zeile.</b>
      Sehr lange Texte dürfen mit <code>\\n</code> Zeilenumbrüche enthalten.</div>
    ${feld('g_mtexte', 'Mängeltexte', (G.mangelTexte || []).join('\n'))}
    ${feld('g_itexte', 'Informationstexte', (G.infoTexte || []).join('\n'))}
  </div>
  <div class="card">
    <div class="btnrow" style="margin-top:0">
      <button class="btn primary" id="g_save">Speichern</button>
      <button class="btn danger small" id="g_reset">Auf Standard zurücksetzen</button>
    </div>
    <div class="hint" style="margin-top:12px">App-Version: <b>Online 0.9</b></div>
  </div>`;

  // Ändern darf nur der Admin (die Datenbank lässt es ohnehin nur ihm zu)
  if (!istAdmin()) {
    $$('#optbody input, #optbody textarea').forEach(e => { e.disabled = true; });
    $('#g_save').closest('.btnrow').innerHTML =
      '<div class="hint">Diese Vorgaben gelten für die ganze Firma und können nur von einem '
      + '<b>Administrator</b> geändert werden.</div>';
    return;
  }

  const zeilen = t => t.split('\n').map(x => x.trim()).filter(Boolean);
  $('#g_save').addEventListener('click', async () => {
    S.grund.kabelArten = zeilen($('#g_kabel').value);
    S.grund.draehte = zeilen($('#g_draehte').value);
    S.grund.sicherungsArten = zeilen($('#g_sich').value);
    S.grund.ampere = zeilen($('#g_amp').value);
    const qs = {};
    zeilen($('#g_qs').value).forEach(z => {
      const m = z.match(/^([\d.]+)\s*=\s*([\d.]+)$/);
      if (m) qs[m[1]] = m[2];
    });
    S.grund.querschnitt = qs;
    S.grund.risoDefault = $('#g_riso').value.trim();
    S.grund.rloDefault = $('#g_rlo').value.trim();
    S.grund.idnDefault = $('#g_idn').value.trim();
    S.grund.messgeraete = $('#g_geraete').value.trim();
    S.grund.erledigungsText = $('#g_erl').value.trim();
    S.grund.mangelTexte = zeilen($('#g_mtexte').value);
    S.grund.infoTexte = zeilen($('#g_itexte').value);
    await grundSpeichern();
  });
  $('#g_reset').addEventListener('click', async () => {
    if (!confirm('Alle Vorgaben auf den Standard zurücksetzen?')) return;
    S.grund = JSON.parse(JSON.stringify(GRUND_STANDARD));
    await grundSpeichern();
    optGrund();
  });
}

/* ---- Speicher im Gerät ---- */
async function optGeraet() {
  $('#optbody').innerHTML = '<div class="empty">Wird geladen …</div>';
  const st = await ablageStand();
  const mb = z => z === null ? '–' : (z / 1048576).toFixed(1) + ' MB';

  $('#optbody').innerHTML = `<div class="card">
    <h3 style="margin-top:0">Was im Gerät liegt</h3>
    <div class="hint">Damit du auch ohne Empfang arbeiten kannst, behält die App geöffnete Kontrollen
      und deren Fotos im Gerät. Nach <b>${ABLAGE_TAGE} Tagen ohne Benutzung</b> werden sie automatisch
      entfernt – auf dem Server bleiben sie natürlich.</div>
    <table class="rpt" style="width:100%;margin-top:10px">
      <tr><td>Kontrollen im Gerät</td><td><b>${st.kontrollen}</b></td></tr>
      <tr><td>Fotos im Gerät</td><td><b>${st.fotos}</b></td></tr>
      <tr><td>Belegter Platz</td><td><b>${mb(st.platz)}</b></td></tr>
      <tr><td>Älteste Kontrolle</td><td><b>${st.aelteste ? esc(fmtDate(st.aelteste)) : '–'}</b></td></tr>
      <tr><td>Noch nicht gesendet</td><td><b>${st.auftraege
        ? st.auftraege + ' Änderung(en)' : 'alles gesendet ✓'}</b></td></tr>
    </table>
  </div>

  ${st.auftraege ? `<div class="card">
    <h3 style="margin-top:0">Noch nicht auf dem Server</h3>
    <div class="hint">${st.auftraege} Änderung(en) warten. Sie werden automatisch gesendet, sobald
      Verbindung besteht – <b>und beim Aufräumen nie gelöscht</b>. Du kannst es auch von Hand anstossen.</div>
    <div class="btnrow"><button class="btn primary" id="ge_senden">↻ Jetzt senden</button></div>
  </div>` : ''}

  <div class="card">
    <h3 style="margin-top:0">Aufräumen</h3>
    <div class="hint">Entfernt Kontrollen, die seit ${ABLAGE_TAGE} Tagen nicht mehr geöffnet wurden,
      und Fotos, die zu keiner Kontrolle im Gerät mehr gehören. Alles, was noch nicht auf dem Server
      ist, bleibt erhalten – ebenso die gerade geöffnete Kontrolle.</div>
    <div class="btnrow">
      <button class="btn" id="ge_raeumen">🧹 Jetzt aufräumen</button>
      <button class="btn danger small" id="ge_alles">Alles im Gerät entfernen</button>
    </div>
    <div class="hint" id="ge_stand"></div>
  </div>`;

  const senden = $('#ge_senden');
  if (senden) senden.addEventListener('click', async () => {
    senden.disabled = true;
    await warteschlangeSenden();
    optGeraet();
  });

  $('#ge_raeumen').addEventListener('click', async () => {
    const b = $('#ge_raeumen');
    b.disabled = true;
    const r = await ablageAufraeumen();
    $('#ge_stand').innerHTML = `Entfernt: <b>${r.wegKontrollen}</b> Kontrolle(n) und
      <b>${r.wegFotos}</b> Foto(s).`
      + (r.gehalten ? ` <b>${r.gehalten}</b> alte Kontrolle(n) wurden behalten, weil noch Änderungen
         auf das Senden warten.` : '');
    setTimeout(optGeraet, 2500);
  });

  $('#ge_alles').addEventListener('click', async () => {
    const stand = await ablageStand();
    if (stand.auftraege && !confirm(`Achtung: ${stand.auftraege} Änderung(en) sind noch NICHT auf dem `
      + 'Server. Wenn du jetzt alles entfernst, sind sie verloren.\n\nTrotzdem fortfahren?')) return;
    if (!stand.auftraege && !confirm('Alle Kontrollen und Fotos aus dem Gerät entfernen?\n\n'
      + 'Auf dem Server bleibt alles erhalten – ohne Empfang ist dann aber keine Kontrolle verfügbar.')) return;
    await ablageTun('pakete', 'readwrite', s => s.clear());
    await ablageTun('fotos', 'readwrite', s => s.clear());
    if (stand.auftraege) await ablageTun('auftraege', 'readwrite', s => s.clear());
    offeneAuftraege = 0;
    bildAdressen.clear();
    warteAnzeige();
    optGeraet();
  });
}

/* ---- Mein Profil ---- */
function optPerson() {
  const p = S.profil;
  $('#optbody').innerHTML = `<div class="card">
    <h3 style="margin-top:0">Mein Profil</h3>
    <div class="hint">Diese Angaben erscheinen auf den Berichten, die du erstellst.</div>
    <div class="row">
      <div class="narrow" style="flex:0 0 110px"><label class="f">Kürzel</label><input type="text" id="p_kuerzel" autocapitalize="characters" maxlength="4" value="${esc(p.kuerzel)}"></div>
      <div><label class="f">Vor- und Nachname</label><input type="text" id="p_name" value="${esc(p.name)}"></div>
    </div>
    <div class="row">
      <div><label class="f">Telefon</label><input type="text" id="p_tel" inputmode="tel" value="${esc(p.telefon)}"></div>
      <div><label class="f">E-Mail</label><input type="text" id="p_mail" inputmode="email" autocapitalize="none" value="${esc(p.mail)}"></div>
    </div>
    <div class="btnrow"><button class="btn primary" id="p_save">Speichern</button></div>
  </div>
  <div class="card">
    <h3 style="margin-top:0">Meine Unterschrift</h3>
    <div class="hint">Unterschreibe mit dem Finger oder dem Apple Pencil. Die Unterschrift wird nur mit deinem
      Konto verwendet – niemand kann in deinem Namen unterschreiben.</div>
    <div id="sigbox"></div>
  </div>
  <div class="card">
    <h3 style="margin-top:0">Konto</h3>
    <div class="hint">Angemeldet als <b>${esc(p.mail)}</b> · Rolle <b>${esc(p.rolle)}</b>
      · Firma <b>${esc(S.firma ? S.firma.name : '–')}</b></div>
    <div class="btnrow"><button class="btn danger" id="p_logout">Abmelden</button></div>
  </div>`;

  $('#p_save').addEventListener('click', async () => {
    setSaveState('saving', '● Speichert…');
    const werte = {
      kuerzel: $('#p_kuerzel').value.trim().toUpperCase(),
      name: $('#p_name').value.trim(),
      telefon: $('#p_tel').value.trim(),
      mail: $('#p_mail').value.trim()
    };
    const { error } = await sb.from('benutzer').update(werte).eq('id', p.id);
    if (error) { setSaveState('error', '⚠️ Fehler'); return fehler(error); }
    Object.assign(S.profil, werte);
    $('#userbtn').textContent = werte.kuerzel || '👤';
    setSaveState('saved', '✓ Gespeichert');
  });
  $('#p_logout').addEventListener('click', abmelden);
  unterschriftsFeld($('#sigbox'), p.unterschrift, async bild => {
    const { error } = await sb.from('benutzer').update({ unterschrift: bild }).eq('id', p.id);
    if (error) return fehler(error);
    S.profil.unterschrift = bild;
    setSaveState('saved', '✓ Unterschrift gespeichert');
  });
}

/* ---- Meine Firma (nur Admin) ---- */
function optFirma() {
  const f = S.firma;
  if (!f) return $('#optbody').innerHTML = '<div class="empty">Keine Firma zugeordnet.</div>';
  $('#optbody').innerHTML = `<div class="card">
    <h3 style="margin-top:0">Firmenangaben</h3>
    <div class="hint">Diese Angaben werden in SiNa, Mess- und Prüfprotokoll und Kontrollbericht eingesetzt.</div>
    <label class="f">Firmenname</label><input type="text" id="f_name" value="${esc(f.name)}">
    <div class="row">
      <div style="flex:2"><label class="f">Strasse, Nr.</label><input type="text" id="f_str" value="${esc(f.strasse)}"></div>
      <div class="narrow"><label class="f">PLZ</label><input type="text" id="f_plz" inputmode="numeric" value="${esc(f.plz)}"></div>
      <div><label class="f">Ort</label><input type="text" id="f_ort" value="${esc(f.ort)}"></div>
    </div>
    <div class="row">
      <div><label class="f">Telefon</label><input type="text" id="f_tel" inputmode="tel" value="${esc(f.telefon)}"></div>
      <div><label class="f">Installationsbewilligung</label><input type="text" id="f_inst" value="${esc(f.inst_bewilligung)}" placeholder="z.B. I-04005"></div>
      <div><label class="f">Kontrollbewilligung</label><input type="text" id="f_kontr" value="${esc(f.kontroll_bewilligung)}" placeholder="z.B. K-01298"></div>
    </div>
    <div class="hint">Je nachdem, welche Rolle du bei einer Kontrolle wählst (Installateur oder Kontrollorgan),
      erscheint die passende Bewilligungsnummer im richtigen Feld des Formulars.</div>
    <div class="btnrow"><button class="btn primary" id="f_save">Speichern</button></div>
  </div>
  <div class="card">
    <h3 style="margin-top:0">Firmen-Code für neue Mitarbeiter</h3>
    <div class="hint">Mit diesem Code registrieren sich deine Mitarbeiter selbst. Danach musst du sie unter
      <b>👥 Mitarbeiter</b> freischalten. Gib den Code nur intern weiter.</div>
    <div class="codebox" id="f_code">${esc(f.registrier_code)}</div>
    <div class="btnrow">
      <button class="btn" id="f_copy">📋 Code kopieren</button>
      <button class="btn danger small" id="f_newcode">Code neu erzeugen</button>
    </div>
  </div>
  ${istAdmin() ? `<div class="card">
    <h3 style="margin-top:0">Backup der ganzen Firma</h3>
    <div class="hint">Sichert <b>alle</b> Kontrollen der Firma samt Anlagen, Messwerten, Mängeln und
      Einstellungen in eine Datei. Fotos machen das Backup gross – bei vielen Kontrollen kann es
      einige Minuten dauern. Einspielen legt die Kontrollen <b>neu</b> an; bestehende bleiben unberührt.</div>
    <label class="f"><input type="checkbox" id="b_fotos" checked style="width:auto;margin-right:8px">Fotos mitsichern</label>
    <label class="f"><input type="checkbox" id="b_papierkorb" style="width:auto;margin-right:8px">auch gelöschte (Papierkorb) mitsichern</label>
    <div class="btnrow">
      <button class="btn primary" id="b_dl">⬇︎ Backup herunterladen</button>
      <button class="btn" id="b_up">⬆︎ Backup einspielen</button>
    </div>
    <div class="hint" id="b_stand"></div>
  </div>` : ''}`;

  $('#f_save').addEventListener('click', async () => {
    setSaveState('saving', '● Speichert…');
    const werte = {
      name: $('#f_name').value.trim(), strasse: $('#f_str').value.trim(),
      plz: $('#f_plz').value.trim(), ort: $('#f_ort').value.trim(),
      telefon: $('#f_tel').value.trim(),
      inst_bewilligung: $('#f_inst').value.trim(),
      kontroll_bewilligung: $('#f_kontr').value.trim()
    };
    const { error } = await sb.from('firmen').update(werte).eq('id', f.id);
    if (error) { setSaveState('error', '⚠️ Fehler'); return fehler(error); }
    Object.assign(S.firma, werte);
    setSaveState('saved', '✓ Gespeichert');
  });
  $('#f_copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(f.registrier_code); setSaveState('saved', '✓ Kopiert'); }
    catch (e) { alert('Code: ' + f.registrier_code); }
  });
  $('#f_newcode').addEventListener('click', async () => {
    if (!confirm('Neuen Firmen-Code erzeugen?\n\nDer bisherige Code funktioniert danach nicht mehr – '
      + 'bereits registrierte Mitarbeiter bleiben aber erhalten.')) return;
    const neu = 'F-' + Math.random().toString(36).slice(2, 10).toUpperCase();
    const { error } = await sb.from('firmen').update({ registrier_code: neu }).eq('id', f.id);
    if (error) return fehler(error);
    S.firma.registrier_code = neu;
    optFirma();
  });

  if (!istAdmin()) return;

  $('#b_dl').addEventListener('click', async () => {
    const knopf = $('#b_dl'), stand = $('#b_stand');
    knopf.disabled = true;
    try {
      let q = sb.from('kontrollen').select('id').eq('firma_id', f.id);
      if (!$('#b_papierkorb').checked) q = q.is('geloescht_am', null);
      const { data: liste, error } = await q;
      if (error) throw error;
      const mitFotos = $('#b_fotos').checked;
      const backup = {
        art: 'elektrokontrolle-online-backup', version: 1,
        erstellt: new Date().toISOString(),
        firma: { name: f.name, strasse: f.strasse, plz: f.plz, ort: f.ort, telefon: f.telefon,
                 inst_bewilligung: f.inst_bewilligung, kontroll_bewilligung: f.kontroll_bewilligung },
        einstellungen: null, kontrollen: []
      };
      const { data: einst } = await sb.from('einstellungen').select('*').eq('firma_id', f.id);
      backup.einstellungen = einst || [];
      for (let i = 0; i < liste.length; i++) {
        stand.textContent = `Kontrolle ${i + 1} von ${liste.length} …`;
        backup.kontrollen.push(await kontrolleSammeln(liste[i].id, mitFotos));
      }
      const name = 'Backup_' + (f.name || 'Firma').replace(/[\\/:*?"<>|]+/g, ' ') + '_'
        + new Date().toISOString().slice(0, 10) + '.ekbackup';
      dateiSpeichern(name, JSON.stringify(backup), 'application/json');
      stand.textContent = `Fertig: ${liste.length} ${liste.length === 1 ? 'Kontrolle' : 'Kontrollen'} gesichert.`;
    } catch (e) { stand.textContent = ''; fehler(e); }
    knopf.disabled = false;
  });

  $('#b_up').addEventListener('click', kontrolleImportieren);
}

/* ---- Mitarbeiter (nur Admin) ---- */
async function optTeam() {
  $('#optbody').innerHTML = '<div class="empty">Wird geladen …</div>';
  const { data, error } = await sb.from('benutzer').select('*').eq('firma_id', S.profil.firma_id).order('name');
  if (error) return fehler(error);
  const offen = data.filter(b => b.status === 'offen');
  const aktiv = data.filter(b => b.status !== 'offen');
  const zeile = b => `<div class="card kcard" data-id="${b.id}">
      <div class="kinfo">
        <div class="kt">${esc(b.kuerzel || '—')} · ${esc(b.name || b.mail)}
          ${b.id === S.profil.id ? '<span class="statusbadge sb-me">das bist du</span>' : ''}
          ${b.status === 'gesperrt' ? '<span class="statusbadge sb-lock">gesperrt</span>' : ''}</div>
        <div class="ks">${esc(b.mail)}${b.telefon ? ' · ' + esc(b.telefon) : ''} · Rolle <b>${esc(b.rolle)}</b></div>
      </div>
      ${b.status === 'offen'
        ? `<button class="btn primary small" data-act="frei">✓ Freischalten</button>
           <button class="btn danger small" data-act="ablehnen">Ablehnen</button>`
        : `<select class="rollewahl" data-id="${b.id}" ${b.id === S.profil.id || b.unantastbar ? 'disabled' : ''}>
             <option value="mitarbeiter" ${b.rolle === 'mitarbeiter' ? 'selected' : ''}>Mitarbeiter</option>
             <option value="admin" ${b.rolle === 'admin' ? 'selected' : ''}>Administrator</option>
           </select>
           <button class="btn small" data-act="pwmail" title="Mail zum Zurücksetzen des Passworts senden">🔑 Passwort</button>
           ${b.id === S.profil.id || b.unantastbar ? ''
             : `<button class="btn small" data-act="${b.status === 'gesperrt' ? 'entsperren' : 'sperren'}">${b.status === 'gesperrt' ? 'Entsperren' : 'Sperren'}</button>`}`}
    </div>`;

  $('#optbody').innerHTML = `
    ${offen.length ? `<div class="card"><h3 style="margin-top:0">Wartet auf Freischaltung (${offen.length})</h3>
      <div class="hint">Diese Personen haben sich mit eurem Firmen-Code registriert. Prüfe, ob du sie kennst,
        bevor du sie freischaltest.</div></div>${offen.map(zeile).join('')}` : ''}
    <div class="card"><h3 style="margin-top:0">Mitarbeiter (${aktiv.length})</h3>
      <div class="hint">Administratoren können Firmenangaben ändern, Mitarbeiter freischalten und Rollen vergeben.</div>
    </div>
    ${aktiv.map(zeile).join('') || '<div class="empty">Noch keine Mitarbeiter.</div>'}`;

  $$('#optbody .kcard button').forEach(b => b.addEventListener('click', async () => {
    const id = b.closest('.kcard').dataset.id;
    const act = b.dataset.act;
    if (act === 'pwmail') {
      const person = data.find(x => x.id === id);
      const mail = (person && person.mail) || '';
      if (!mail) return alert('Für diese Person ist keine E-Mail-Adresse hinterlegt.');
      if (!confirm(`Eine Mail zum Zurücksetzen des Passworts an ${mail} senden?\n\n`
        + 'Die Person setzt das neue Passwort selbst – du erfährst es nicht.')) return;
      b.disabled = true;
      const { error } = await sb.auth.resetPasswordForEmail(mail, {
        redirectTo: location.href.split('#')[0].split('?')[0]
      });
      b.disabled = false;
      return error ? fehler(error) : alert('Die Mail wurde verschickt.');
    }
    if (act === 'ablehnen' && !confirm('Diese Registrierung ablehnen?\nDie Person kann sich danach nicht anmelden.')) return;
    const werte = { frei: { status: 'frei' }, ablehnen: { status: 'gesperrt' },
                    sperren: { status: 'gesperrt' }, entsperren: { status: 'frei' } }[act];
    b.disabled = true;
    const { error } = await sb.from('benutzer').update(werte).eq('id', id);
    if (error) { b.disabled = false; return fehler(error); }
    optTeam();
  }));
  $$('#optbody .rollewahl').forEach(sel => sel.addEventListener('change', async () => {
    const { error } = await sb.from('benutzer').update({ rolle: sel.value }).eq('id', sel.dataset.id);
    if (error) return fehler(error);
    setSaveState('saved', '✓ Rolle geändert');
  }));
}

/* ---- Firmen verwalten (nur Superadmin) ---- */
async function optFirmen() {
  $('#optbody').innerHTML = '<div class="empty">Wird geladen …</div>';
  const { data: firmen, error } = await sb.from('firmen').select('*').order('name');
  if (error) return fehler(error);
  const { data: benutzer } = await sb.from('benutzer').select('firma_id, rolle, status');
  const zahl = (fid, filter) => (benutzer || []).filter(b => b.firma_id === fid && (!filter || filter(b))).length;

  $('#optbody').innerHTML = `<div class="card">
      <h3 style="margin-top:0">Neue Firma anlegen</h3>
      <div class="hint">Nach dem Anlegen bekommst du einen <b>Firmen-Code</b>. Wer sich damit als Erstes
        registriert, wird automatisch Administrator dieser Firma.</div>
      <div class="row">
        <div style="flex:2"><label class="f">Firmenname</label><input type="text" id="nf_name" placeholder="z.B. Elektro Muster AG"></div>
        <div class="narrow" style="flex:0 0 auto;align-self:flex-end"><button class="btn primary" id="nf_add">＋ Firma anlegen</button></div>
      </div>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Firmen (${firmen.filter(f => !f.ist_superfirma).length})</h3>
      <div class="hint">Die Mitarbeiterzahl dient der Abrechnung. Kontrollinhalte sind für die Systemverwaltung
        bewusst nicht einsehbar.</div>
    </div>
    ${firmen.filter(f => !f.ist_superfirma).map(f => `
      <div class="card kcard" data-id="${f.id}">
        <div class="kinfo">
          <div class="kt">${esc(f.name)} ${f.aktiv ? '' : '<span class="statusbadge sb-lock">gesperrt</span>'}</div>
          <div class="ks">${esc([f.strasse, [f.plz, f.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'keine Adresse')}
            · <b>${zahl(f.id, b => b.status === 'frei')}</b> aktive Mitarbeiter
            ${zahl(f.id, b => b.status === 'offen') ? '· ' + zahl(f.id, b => b.status === 'offen') + ' warten' : ''}
            · Code <code>${esc(f.registrier_code)}</code>
            · seit ${esc(new Date(f.erstellt_am).toLocaleDateString('de-CH'))}</div>
        </div>
        <button class="btn small" data-act="${f.aktiv ? 'sperren' : 'aktivieren'}">${f.aktiv ? 'Sperren' : 'Aktivieren'}</button>
      </div>`).join('') || '<div class="empty">Noch keine Firmen angelegt.</div>'}`;

  $('#nf_add').addEventListener('click', async () => {
    const name = $('#nf_name').value.trim();
    if (!name) return alert('Bitte den Firmennamen eingeben.');
    const code = 'F-' + Math.random().toString(36).slice(2, 10).toUpperCase();
    const { error } = await sb.from('firmen').insert({ name, registrier_code: code });
    if (error) return fehler(error);
    alert(`Firma «${name}» wurde angelegt.\n\nFirmen-Code: ${code}\n\n`
      + 'Gib diesen Code der Person, die dort Administrator werden soll – sie registriert sich damit selbst.');
    optFirmen();
  });
  $$('#optbody .kcard button').forEach(b => b.addEventListener('click', async () => {
    const id = b.closest('.kcard').dataset.id;
    const aktiv = b.dataset.act === 'aktivieren';
    if (!aktiv && !confirm('Firma sperren?\nNiemand aus dieser Firma kann sich dann mehr anmelden.')) return;
    const { error } = await sb.from('firmen').update({ aktiv }).eq('id', id);
    if (error) return fehler(error);
    optFirmen();
  }));
}

/* ---- Systemverwalter (nur Superadmin) ---- */
async function optSupers() {
  $('#optbody').innerHTML = '<div class="empty">Wird geladen …</div>';
  const { data: superfirma } = await sb.from('firmen').select('*').eq('ist_superfirma', true).maybeSingle();
  const { data, error } = await sb.from('benutzer').select('*').eq('rolle', 'superadmin').order('name');
  if (error) return fehler(error);

  $('#optbody').innerHTML = `<div class="card">
      <h3 style="margin-top:0">Systemverwalter</h3>
      <div class="hint">Wer sich mit dem Code unten registriert, wird Systemverwalter – muss aber von einem
        bestehenden Systemverwalter freigeschaltet werden. Das erste Konto ist <b>unantastbar</b> und kann
        nicht entfernt werden.</div>
      <div class="codebox">${esc(superfirma ? superfirma.registrier_code : '—')}</div>
      <div class="btnrow"><button class="btn danger small" id="s_newcode">Code neu erzeugen</button></div>
    </div>
    ${data.map(b => `<div class="card kcard" data-id="${b.id}">
      <div class="kinfo">
        <div class="kt">${esc(b.name || b.mail)}
          ${b.unantastbar ? '<span class="statusbadge sb-done">unantastbar</span>' : ''}
          ${b.id === S.profil.id ? '<span class="statusbadge sb-me">das bist du</span>' : ''}
          ${b.status === 'offen' ? '<span class="statusbadge sb-lock">wartet auf Freischaltung</span>' : ''}</div>
        <div class="ks">${esc(b.mail)}</div>
      </div>
      ${b.status === 'offen' ? '<button class="btn primary small" data-act="frei">✓ Freischalten</button>' : ''}
      ${!b.unantastbar && b.id !== S.profil.id ? '<button class="btn danger small" data-act="entfernen">Entfernen</button>' : ''}
    </div>`).join('')}`;

  $('#s_newcode').addEventListener('click', async () => {
    if (!confirm('Neuen Code für Systemverwalter erzeugen?')) return;
    const neu = 'SUPER-' + Math.random().toString(36).slice(2, 10).toUpperCase();
    const { error } = await sb.from('firmen').update({ registrier_code: neu }).eq('ist_superfirma', true);
    if (error) return fehler(error);
    optSupers();
  });
  $$('#optbody .kcard button').forEach(b => b.addEventListener('click', async () => {
    const id = b.closest('.kcard').dataset.id;
    if (b.dataset.act === 'entfernen') {
      if (!confirm('Diesen Systemverwalter entfernen?\nEr verliert damit alle Rechte.')) return;
      const { error } = await sb.from('benutzer').update({ status: 'gesperrt' }).eq('id', id);
      if (error) return fehler(error);
    } else {
      const { error } = await sb.from('benutzer').update({ status: 'frei' }).eq('id', id);
      if (error) return fehler(error);
    }
    optSupers();
  }));
}

/* ============================================================
   Unterschriftsfeld (zeichnen mit Finger oder Pencil)
   ============================================================ */

function unterschriftsFeld(box, vorhanden, aufSpeichern) {
  const zeigen = () => {
    box.innerHTML = vorhanden
      ? `<div class="sigpreview"><img src="${vorhanden}" alt="Unterschrift"></div>
         <div class="btnrow"><button class="btn" id="sig_neu">🖊 Neu unterschreiben</button>
         <button class="btn danger small" id="sig_del">Entfernen</button></div>`
      : `<div class="hint">Noch keine Unterschrift hinterlegt.</div>
         <div class="btnrow"><button class="btn primary" id="sig_neu">🖊 Jetzt unterschreiben</button></div>`;
    const neu = $('#sig_neu');
    if (neu) neu.addEventListener('click', zeichnen);
    const del = $('#sig_del');
    if (del) del.addEventListener('click', async () => {
      if (!confirm('Unterschrift entfernen?')) return;
      vorhanden = null;
      await aufSpeichern(null);
      zeigen();
    });
  };

  function zeichnen() {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="dialog sigdialog">
      <h3>Unterschreiben</h3>
      <div class="hint">Mit dem Finger oder dem Apple Pencil im Feld unterschreiben.</div>
      <canvas id="sigcanvas" class="sigcanvas"></canvas>
      <div class="btnrow">
        <button class="btn primary" id="sig_ok">✓ Übernehmen</button>
        <button class="btn" id="sig_clear">Nochmal</button>
        <button class="btn" id="sig_abbr">Abbrechen</button>
      </div></div>`;
    document.body.appendChild(ov);
    const cv = ov.querySelector('#sigcanvas');
    const skala = window.devicePixelRatio || 1;
    const b = cv.getBoundingClientRect();
    cv.width = b.width * skala; cv.height = b.height * skala;
    const ctx = cv.getContext('2d');
    ctx.scale(skala, skala);
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
    let zeichnend = false, leer = true, stiftAktiv = false;

    const pos = e => {
      const r = cv.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    cv.addEventListener('pointerdown', e => {
      // Wird der Pencil benutzt, ignorieren wir Finger/Handballen
      if (e.pointerType === 'pen') stiftAktiv = true;
      if (stiftAktiv && e.pointerType !== 'pen') return;
      zeichnend = true; leer = false;
      cv.setPointerCapture(e.pointerId);
      const [x, y] = pos(e);
      ctx.beginPath(); ctx.moveTo(x, y);
      e.preventDefault();
    });
    cv.addEventListener('pointermove', e => {
      if (!zeichnend) return;
      if (stiftAktiv && e.pointerType !== 'pen') return;
      const [x, y] = pos(e);
      ctx.lineTo(x, y); ctx.stroke();
      e.preventDefault();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
      cv.addEventListener(ev, () => { zeichnend = false; }));

    ov.querySelector('#sig_clear').addEventListener('click', () => {
      ctx.clearRect(0, 0, cv.width, cv.height); leer = true;
    });
    ov.querySelector('#sig_abbr').addEventListener('click', () => ov.remove());
    ov.querySelector('#sig_ok').addEventListener('click', async () => {
      if (leer) return alert('Bitte zuerst unterschreiben.');
      vorhanden = cv.toDataURL('image/png');
      ov.remove();
      await aufSpeichern(vorhanden);
      zeigen();
    });
  }

  zeigen();
}

/* ============================================================
   Vollbild + Start
   ============================================================ */

function initFullscreen() {
  const btn = $('#fsbtn');
  const root = document.documentElement;
  if (!(root.requestFullscreen || root.webkitRequestFullscreen)) { btn.style.display = 'none'; return; }
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  const paint = () => { btn.textContent = fsEl() ? '✕' : '⛶'; };
  btn.addEventListener('click', () => {
    try {
      const p = fsEl() ? (document.exitFullscreen || document.webkitExitFullscreen).call(document)
                       : (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* nicht erlaubt */ }
  });
  document.addEventListener('fullscreenchange', paint);
  document.addEventListener('webkitfullscreenchange', paint);
  paint();
}

async function init() {
  initFullscreen();
  if (!KONFIGURIERT) {
    authMeldung('⚠️ ' + KONFIG_FEHLER + '<br><br>Danach die Seite neu laden.', 'fehler');
    $('#loginform').querySelectorAll('input,button').forEach(e => e.disabled = true);
    $('#regform').querySelectorAll('input,button').forEach(e => e.disabled = true);
    return;
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // Was beim letzten Mal nicht mehr gesendet werden konnte, jetzt nachholen –
  // und danach still aufräumen (höchstens einmal am Tag).
  try {
    offeneAuftraege = (await ablageAlle('auftraege')).length;
    warteAnzeige();
    await warteschlangeSenden();
    const zuletzt = (await ablageLesen('merker', 'aufgeraeumt')) || 0;
    if (Date.now() - zuletzt > 86400000) {
      const r = await ablageAufraeumen();
      await ablageSchreiben('merker', Date.now(), 'aufgeraeumt');
      if (r.wegKontrollen || r.wegFotos) {
        console.log('Aufgeräumt:', r.wegKontrollen, 'Kontrollen,', r.wegFotos, 'Fotos');
      }
    }
  } catch (e) { console.warn('Lokale Ablage:', e); }
  const { data: { session } } = await sb.auth.getSession();
  if (session) await nachAnmeldung();
}

init();
