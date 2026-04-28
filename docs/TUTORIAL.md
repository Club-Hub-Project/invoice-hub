# Invoice Hub — Tutorial

## Was ist der Invoice Hub?

Der Invoice Hub vereinfacht die Rechnungsstellung nach Veranstaltungen (Camps, Turniere, Kurse). Du ladest eine CSV mit Teilnehmernamen hoch, die App gleicht diese mit deinen Webling-Mitgliedern ab und erstellt Rechnungsentwürfe. Nach Prüfung buchst du sie mit einem Klick in Webling und erhältst einen fertigen E-Mail-Text.

## Schritt-für-Schritt

### 1. Einstellungen konfigurieren

Beim ersten Aufruf gehst du zu **Einstellungen** und trägst ein:

- **Standard-Buchungsperiode** — wähle das aktuelle Geschäftsjahr aus der Dropdown-Liste (kommt direkt aus Webling)
- **Soll-Konto / Haben-Konto** — die Buchungskonten fur Forderungen und Ertrag
- **Zahlungsziel** — wie viele Tage nach Rechnungsdatum (Standard: 30 Tage)
- **Bankverbindung** — mehrzeilig, erscheint im E-Mail-Text
- **Twint-Nummer** — optional, für mobile Zahlungen

Diese Werte gelten als Standard. Du kannst sie pro Event überschreiben.

### 2. Event erstellen

Klicke auf **Events** > **+ Neuer Event**.

Fülle aus:
- **Name** (Pflicht): z.B. "Sommer-Camp 2026"
- **Datum**: Veranstaltungsdatum
- **Betrag**: Standardbetrag in CHF (kann pro Mitglied abweichen, wenn in der CSV eine Betrag-Spalte vorhanden ist)
- **Beschreibung**: optional

Unter "Webling-Buchung" kannst du die globalen Einstellungen für diesen Event überschreiben.

### 3. CSV erstellen und hochladen

Erstelle eine CSV-Datei mit den Teilnehmern. Minimal:

```csv
Vorname;Name
Max;Muster
Anna;Schmidt
```

Oder mit E-Mail und individuellem Betrag:

```csv
Vorname;Name;E-Mail;Betrag
Max;Muster;max@example.com;95
Anna;Schmidt;anna@example.com;120
```

**Exporttipp aus Excel/Numbers:** Speichern als CSV (mit Semikolon als Trennzeichen, Standard in der Schweiz). Die App erkennt Semikolon und Komma automatisch.

Dann:
1. Klicke auf **CSV hochladen**
2. Wähle den Event aus
3. Ziehe die CSV in den Upload-Bereich oder klicke zum Auswählen

### 4. Zuordnung prüfen

Die App gleicht jeden Namen mit Webling-Mitgliedern ab:

| Symbol | Bedeutung |
|---|---|
| ✅ Grün | Eindeutig einem Mitglied zugeordnet |
| ⚠️ Gelb | Mehrere mögliche Treffer - bitte manuell auswählen |
| ❌ Rot | Kein Treffer gefunden |

Bei gelben Zeilen: wähle das korrekte Mitglied aus der Dropdown-Liste.
Bei roten Zeilen: diese werden beim Import übersprungen. Prüfe den Namen in der CSV.

### 5. Rechnungen erstellen

Klicke auf **X Rechnung(en) erstellen**.

Die Rechnungsentwürfe werden gespeichert und du wirst automatisch zur **Rechnungen**-Ansicht weitergeleitet.

### 6. Rechnungen prüfen und buchen

In der **Rechnungen**-Ansicht siehst du alle Entwürfe mit:
- Mitglied, Event, Betrag, Rechnungsdatum
- Status: "Entwurf" oder "Gebucht"

**Einzeln buchen:** Klicke auf ✅ in der Zeile des Entwurfs.

**Alle buchen:** Klicke auf **"Alle Entwürfe buchen"**. Ein Klick erstellt alle Webling-Debitoreneinträge.

Nach dem Buchen erscheint die Webling-Debitor-ID in der Detailansicht.

### 7. E-Mail-Text abrufen

Klicke auf 📧 bei einer gebuchten Rechnung. Ein Fenster öffnet sich mit einem fertigen deutschen E-Mail-Text:

```
Betreff: Rechnung - Sommer-Camp 2026

Liebe/r Max,

vielen Dank für deine Teilnahme an "Sommer-Camp 2026".

Anbei die Rechnung:
  Betrag:              CHF 120.00
  Rechnungsdatum:      15.07.2026
  Zahlbar bis:         15.08.2026
  Verwendungszweck:    Sommer-Camp 2026 - Max Muster

Bankverbindung:
  Taekwondo Bern
  IBAN: CH00 0000 0000 0000 0000 0
  Bank: PostFinance

Twint: +41 79 000 00 00

Bei Fragen stehen wir dir gerne zur Verfügung.

Freundliche Grüsse
Taekwondo Bern
```

Klicke auf **Kopieren** und füge den Text in dein E-Mail-Programm ein.

## Tipps

- **Buchungsperiode fehlt?** Die Webling API muss eine aktive Periode haben. Prüfe in Webling unter Buchhaltung > Perioden.
- **Kein Treffer bei der Suche?** Die Suche geht durch alle Webling-Mitglieder (inkl. Schnupperer). Tippfehler im Namen sind häufig die Ursache.
- **Individueller Betrag**: Füge eine Spalte `Betrag` in der CSV hinzu. Dieser Wert überschreibt den Event-Betrag für dieses Mitglied.
- **Entwürfe löschen**: Klicke auf 🗑 in der Rechnungszeile. Gebuchte Rechnungen können nicht gelöscht werden (nur in Webling direkt).
