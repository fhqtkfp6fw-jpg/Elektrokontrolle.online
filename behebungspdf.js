'use strict';
/* ============================================================
   PDF «Kontrollbericht – Mängelbehebung» (Etappe L)

   EINE Datei für beide Apps: die Behebungs-App (behebung/) und die
   Kontroll-App (Abschluss) erzeugen damit dasselbe PDF. Beide liefern die
   Daten im selben Aufbau, wie ihn die Edge Function «behebung» bei
   «laden» zurückgibt:

     { kopf, firma, kontrolleure, bericht_unterschriften, anlagen,
       positionen: [{ id, anlage_id, typ, ort, text, fotos: [{ pfad, url }] }],
       rueckmeldungen: [{ mangel_id, status, text, fotos, geaendert_am }],
       unterschrift: { name, firma, mail, am, pruefsumme } | null }

   optionen.fotoLaden(foto) → data-URL oder null (jede App lädt auf ihre Art).
   Braucht jspdf.min.js. Die Standardschrift kennt keine ✓/✗ – darum Text.
   ============================================================ */

async function behebungsPdf(d, optionen) {
  if (!window.jspdf) throw new Error('PDF-Bibliothek nicht geladen');
  const { jsPDF } = window.jspdf;
  const opt = optionen || {};
  const fotoLaden = opt.fotoLaden || behebungsPdfFotoUeberLink;

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 15, CW = W - 2 * M, OBEN = M + 9, UNTEN = 280;
  let y = M;
  const neueSeite = () => { doc.addPage(); y = OBEN; };
  const platz = h => { if (y + h > UNTEN) neueSeite(); };
  const wrap = (t, b) => doc.splitTextToSize(String(t || '–'), b);
  const datum = ts => ts ? new Date(ts).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  const zeit = ts => ts ? new Date(ts).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }) : '';

  const k = d.kopf || {};
  const adresse = [k.strasse, [k.plz, k.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const u = d.unterschrift;
  const rm = {};
  (d.rueckmeldungen || []).forEach(r => { rm[r.mangel_id] = r; });
  const maengel = (d.positionen || []).filter(p => p.typ === 'mangel');
  const zahl = s => maengel.filter(p => (rm[p.id] || {}).status === s).length;
  const behoben = zahl('behoben'), nicht = zahl('nicht_behoben'), offen = maengel.length - behoben - nicht;

  /* ---- Kopf ---- */
  const kopfOben = y;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('Kontrollbericht – Mängelbehebung', M + 3, y + 8);
  doc.setFontSize(10);
  const auftrag = 'Auftrag: ' + ([k.auftrag_nr, k.auftrag_bez].filter(Boolean).join(' ') || '–');
  if (doc.getTextWidth(auftrag) > 80) doc.setFontSize(8.5);
  doc.text(auftrag, W - M - 3, y + 8, { align: 'right' });
  y += 11;
  doc.setLineWidth(0.3); doc.line(M, y, W - M, y);
  y += 2.5;

  const L = M + 3, V = M + 45, VW = W - M - V - 3;
  const zeile = (lbl, wert, fett) => {
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(90);
    doc.text(lbl, L, y + 3.5);
    doc.setTextColor(0); doc.setFont('helvetica', fett === false ? 'normal' : 'bold');
    const z = wrap(wert, VW);
    doc.text(z, V, y + 3.5);
    y += z.length * 4 + 2.2;
  };
  const e = k.eigentuemer || {};
  zeile('Ort der Installation', adresse || '–');
  zeile('Auftraggeber', [e.name, e.name2, e.strasse, [e.plz, e.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '–');
  const f = d.firma || {};
  zeile('Kontrolle durch', [f.name, ...(d.kontrolleure || []).map(p => [p.name, p.telefon].filter(Boolean).join(', '))]
    .filter(Boolean).join('\n') || '–');
  zeile('Bericht unterschrieben', (d.bericht_unterschriften || [])
    .map(b => b.name + ', ' + datum(b.am)).join('\n') || '–');
  zeile('Mängelbehebung', u
    ? 'bestätigt am ' + datum(u.am) + ', ' + zeit(u.am) + ' durch ' + [u.name, u.firma].filter(Boolean).join(', ')
    : 'ENTWURF – noch nicht bestätigt');
  zeile('Stand der Mängel', maengel.length
    ? `${maengel.length} Mängel: ${behoben} behoben, ${nicht} nicht behoben${offen ? ', ' + offen + ' ohne Rückmeldung' : ''}`
    : 'keine Mängel');
  doc.rect(M, kopfOben, CW, y - kopfOben);
  y += 7;

  /* ---- Fotos: zwei nebeneinander, in brauchbarer Grösse ---- */
  const fotos = async (liste, titel, einzug) => {
    if (!(liste || []).length) return;
    const x0 = M + (einzug || 0), breite = W - M - x0;
    platz(10);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(110);
    doc.text(titel.toUpperCase(), x0, y + 3); doc.setTextColor(0);
    y += 5;
    const spalte = (breite - 4) / 2;
    let x = x0, hoechste = 0;
    for (const foto of liste) {
      let url = null;
      try { url = await fotoLaden(foto); } catch (err) { url = null; }
      let p = null;
      if (url) { try { p = doc.getImageProperties(url); } catch (err) { p = null; } }
      let w = spalte, h = p ? w * p.height / p.width : 12;
      if (h > 70) { h = 70; w = p ? h * p.width / p.height : w; }
      if (x > x0 && x + w > x0 + breite + 0.1) { y += hoechste + 3; x = x0; hoechste = 0; }
      if (y + h > UNTEN) { neueSeite(); x = x0; hoechste = 0; }
      if (p) doc.addImage(url, url.includes('image/png') ? 'PNG' : 'JPEG', x, y, w, h, undefined, 'FAST');
      else {
        doc.setDrawColor(180); doc.rect(x, y, w, h); doc.setDrawColor(0);
        doc.setFontSize(8); doc.setTextColor(120); doc.text('Foto nicht verfügbar', x + 3, y + 7); doc.setTextColor(0);
      }
      x += spalte + 4;
      hoechste = Math.max(hoechste, h);
    }
    y += hoechste + 4;
  };

  /* ---- Rückmeldung des Installateurs, eingerückt mit Farbbalken ---- */
  const rueckmeldung = async (p, istMangel) => {
    const r = rm[p.id] || {};
    const status = r.status === 'behoben' ? ['BEHOBEN', [21, 128, 61]]
      : r.status === 'nicht_behoben' ? ['NICHT BEHOBEN', [185, 28, 28]]
      : istMangel ? ['KEINE RÜCKMELDUNG', [140, 140, 140]] : null;
    if (!status && !r.text && !(r.fotos || []).length) return;
    const einzug = 6;
    const textZ = r.text ? wrap(r.text, CW - einzug - 6) : [];
    platz(8 + Math.min(textZ.length, 4) * 4.2);
    const oben = y, seiteOben = doc.internal.getNumberOfPages();
    doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.setTextColor(90); doc.text('Rückmeldung Installateur' + (r.geaendert_am ? ', ' + datum(r.geaendert_am) : '') + ':', M + einzug + 3, y + 4);
    if (status) {
      const lx = M + einzug + 3 + doc.getTextWidth('Rückmeldung Installateur' + (r.geaendert_am ? ', ' + datum(r.geaendert_am) : '') + ':') + 3;
      doc.setTextColor(...status[1]); doc.text(status[0], lx, y + 4);
    }
    doc.setTextColor(0);
    y += 6;
    if (textZ.length) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
      for (const z of textZ) { platz(5); doc.text(z, M + einzug + 3, y + 3); y += 4.2; }
      y += 1;
    }
    // Farbbalken links – lief der Text auf eine neue Seite, beginnt er dort oben
    const balkenOben = doc.internal.getNumberOfPages() === seiteOben ? oben : OBEN;
    doc.setFillColor(...(status ? status[1] : [140, 140, 140]));
    if (y > balkenOben) doc.rect(M + einzug, balkenOben, 1.2, y - balkenOben, 'F');
    await fotos(r.fotos, 'Fotos Behebung', einzug + 3);
  };

  /* ---- Positionen, nach Anlage gruppiert wie im Kontrollbericht ---- */
  const gruppen = typ => {
    const pos = (d.positionen || []).filter(p => p.typ === typ);
    const anlagen = d.anlagen || [];
    const g = anlagen.map(a => ({ titel: (a.name || 'Anlage ohne Name') + (a.zaehler_nr ? ' – Zähler ' + a.zaehler_nr : ''),
                                  liste: pos.filter(p => p.anlage_id === a.id) }));
    g.push({ titel: 'Allgemein', liste: pos.filter(p => !p.anlage_id || !anlagen.some(a => a.id === p.anlage_id)) });
    return g.filter(x => x.liste.length);
  };

  const abschnitt = async (titel, typ) => {
    const g = gruppen(typ);
    if (!g.length) return;
    platz(14);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text(titel, M, y + 5); y += 9;
    let nr = 0;
    for (const grp of g) {
      platz(14);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text(grp.titel, M, y + 4);
      doc.setLineWidth(0.2); doc.line(M, y + 5.5, W - M, y + 5.5);
      y += 9;
      for (const p of grp.liste) {
        const z = wrap(p.text || '–', CW - 5);
        platz(7 + Math.min(z.length, 4) * 4.3);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
        doc.text((typ === 'mangel' ? (++nr) + '.  ' : '') + (p.ort || '–'), M, y + 4); y += 6.5;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
        for (const zz of z) { platz(5); doc.text(zz, M + 5, y + 3.2); y += 4.3; }
        y += 1.5;
        await fotos(p.fotos, 'Fotos Kontrolle', 5);
        await rueckmeldung(p, typ === 'mangel');
        y += 4;
      }
    }
  };

  await abschnitt('Mängelliste', 'mangel');
  await abschnitt('Information', 'info');

  /* ---- Bestätigung ---- */
  platz(36);
  y += 3;
  doc.setLineWidth(0.3);
  const bOben = y;
  doc.setFillColor(235, 235, 235);
  doc.rect(M, y, CW, 8, 'FD');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('Bestätigung der Mängelbehebung', M + 3, y + 5.5);
  y += 8;
  doc.setFontSize(9.5);
  if (u) {
    const zeilen = [
      ['Bestätigt durch', [u.name, u.firma].filter(Boolean).join(', ')],
      ['Mailadresse', u.mail + '  (per Bestätigungscode an diese Adresse geprüft)'],
      ['Datum / Zeit', datum(u.am) + ', ' + zeit(u.am)]
    ];
    if (u.pruefsumme) zeilen.push(['Prüfsumme', u.pruefsumme.slice(0, 16) + '…']);
    y += 2;
    for (const [l, w] of zeilen) {
      doc.setFont('helvetica', 'normal'); doc.setTextColor(90); doc.text(l, M + 3, y + 4);
      doc.setTextColor(0); doc.setFont('helvetica', 'bold');
      const z = wrap(w, CW - 45); doc.text(z, M + 42, y + 4); y += z.length * 4.5 + 1;
    }
    y += 2;
  } else {
    y += 2;
    doc.setFont('helvetica', 'normal'); doc.setTextColor(185, 28, 28);
    doc.text(wrap('Entwurf – die Mängelbehebung ist noch nicht bestätigt. Die Bestätigung erfolgt in der '
      + 'Behebungs-App mit einem Code per Mail.', CW - 6), M + 3, y + 4);
    doc.setTextColor(0);
    y += 12;
  }
  doc.rect(M, bOben, CW, y - bOben);

  /* ---- Kopf und Fuss auf jeder Seite ---- */
  const n = doc.internal.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110);
    if (i > 1) {
      doc.text('Kontrollbericht – Mängelbehebung' + (k.auftrag_nr ? ' · Auftrag ' + k.auftrag_nr : ''), M, M + 2);
      doc.text(adresse, W - M, M + 2, { align: 'right' });
      doc.setDrawColor(200); doc.line(M, M + 4, W - M, M + 4); doc.setDrawColor(0);
    }
    if (!u) { doc.setTextColor(185, 28, 28); doc.text('ENTWURF', W / 2, 291, { align: 'center' }); doc.setTextColor(110); }
    doc.text((d.firma && d.firma.name) || '', M, 291);
    doc.text('Seite ' + i + ' von ' + n, W - M, 291, { align: 'right' });
    doc.setTextColor(0);
  }

  const dateiname = [k.auftrag_nr, 'Maengelbehebung', adresse].filter(Boolean).join('_')
    .replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() + (u ? '' : '_Entwurf');
  return { blob: doc.output('blob'), dateiname: dateiname + '.pdf' };
}

// Foto über seinen (zeitlich begrenzten) Link holen und fürs PDF verkleinern
async function behebungsPdfFotoUeberLink(foto) {
  if (!foto || !foto.url) return null;
  const antwort = await fetch(foto.url);
  if (!antwort.ok) return null;
  return behebungsPdfVerkleinern(await antwort.blob());
}

// Fotos fürs PDF auf 1100 px verkleinern – sonst wird die Datei bei vielen Fotos riesig
function behebungsPdfVerkleinern(quelle) {
  return new Promise(res => {
    const url = typeof quelle === 'string' ? quelle : URL.createObjectURL(quelle);
    const img = new Image();
    img.onload = () => {
      const f = Math.min(1, 1100 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * f); c.height = Math.round(img.naturalHeight * f);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      if (typeof quelle !== 'string') URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = () => { if (typeof quelle !== 'string') URL.revokeObjectURL(url); res(null); };
    img.src = url;
  });
}

// Herunterladen bzw. aufs Handy speichern (iOS: öffnet das Teilen-Menü, falls möglich)
async function behebungsPdfSpeichern(erg) {
  const datei = new File([erg.blob], erg.dateiname, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [datei] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
    try { await navigator.share({ files: [datei], title: erg.dateiname }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(erg.blob);
  const a = document.createElement('a');
  a.href = url; a.download = erg.dateiname;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
