# Zeropunch – Konzept

Stand 2026-11-25 · Version 2026.11.25

## 1. Ziel

Eine Stempeluhr fürs Handy: ein Knopf, eine Liste der Zeiten. Der Server sieht nie eine Arbeitszeit
im Klartext und weiss nicht, wer man ist. Alles wird im Browser verschlüsselt, der Server lagert nur
unlesbare Pakete fester Grösse. Keine Mail-Adresse, kein echter Name.

## 2. Was «Zero Knowledge» hier heisst

Bedrohungsmodell: Der Betreiber, ein Angreifer mit einer Kopie der Datenbank oder jemand, der den
Verkehr mitliest, soll keine Arbeitszeiten, Notizen, Abwesenheiten oder Einstellungen erfahren und
ein Konto keiner Person zuordnen können. Nicht abgedeckt: ein Server, der bösartigen Code ausliefert
(siehe Grenzen).

| Der Server sieht | Der Server sieht nie |
|---|---|
| HMAC des Benutzernamens (Konto-Kennung); den Namen selbst nur im Durchgang beim Registrieren und Anmelden | den Benutzernamen gespeichert |
| HMAC von `authKey`, den verpackten Hauptschlüssel (gespeichert verschlüsselt unter `PEPPER`) | Passphrase, `wrapKey`, Hauptschlüssel |
| Pakete fester Grösse (379 Zeichen; anderes nimmt er nicht an) | Zeiten, Notizen, Abwesenheiten, Einstellungen |
| wann ein Paket ankommt (gespeichert nur als UTC-Tag des letzten Schreibens) | den Inhalt des Pakets |
| die IP-Adresse, nur kurz: als HMAC in Limit-Zählern, die nach spätestens zwei Tagen weg sind | – |

Die Datenbank hält pro Konto nur Tage, keine Uhrzeiten: Tag der Erstellung, Tag der letzten
angemeldeten Anfrage, die laufende Abgleich-Nummer `seq` und die Zahl der Pakete; pro Sitzung den Tag
der letzten Nutzung und den Ablauftag; pro Paket den Tag des letzten Schreibens und seine `seq`. Die
Zähler pro Konto (Anfragen, Schreibvorgänge, Fehlversuche) laufen unter einem eigenen HMAC der
Konto-Kennung und lassen sich ohne `PEPPER` keinem Konto zuordnen.

**Ehrliche Grenzen:**

1. **Der Code kommt vom Server.** Wie bei jeder Web-App mit Verschlüsselung im Browser muss man dem
   ausgelieferten JavaScript trauen. Abhilfe: kein Fremdcode, strenge CSP, kein Build-Schritt (was in
   `public/` steht, läuft), Quelltext öffentlich.
2. **Ankunftszeit.** Der Server sieht, wann ein verschlüsseltes Paket ankommt; wer live stempelt, verrät
   so ungefähr die Zeit. Wer ohne Netz puncht, verwischt das: das Paket geht erst beim nächsten Abgleich.
3. **Eine verlorene Passphrase ist verloren.** Kein Wiederherstellungs-Schlüssel, keine Hintertür, kein
   Zurücksetzen per Mail. Das unbenutzte Konto wird nach 61 Tagen gelöscht; bis dahin bleibt der Name
   vergeben.
4. **Benutzernamen sind nicht geheim.** Beim Registrieren erfährt man, ob ein Name vergeben ist. Deshalb
   kein echter Name.
5. **Raten offline.** Eine Kopie der Datenbank allein reicht nicht: Auth-Hashes sind HMACs unter
   `PEPPER`, das Schlüssel-Paket ist mit einem aus `PEPPER` abgeleiteten Schlüssel verschlüsselt. Wer
   Datenbank **und** `PEPPER` hat, kann raten, 600 000 PBKDF2-Runden pro Versuch.
6. **Sicherungen beim Datenbank-Anbieter:** Zurückspulen auf jede Minute der letzten bis zu 30 Tage.
   So lange kann der Betreiber Gelöschtes zurückholen.
7. **Der Hauptschlüssel wechselt nie.** Die Passphrase ändern verpackt ihn nur neu.
8. **Andere Instanzen.** Wer denselben Namen und dieselbe Passphrase bei einer fremden Instanz nutzt,
   gibt deren Betreiber den `authKey` für dieses Konto. Pro Instanz eine eigene Passphrase.
9. **Weglassen und Zurückdrehen.** Ein böswilliger Server kann Pakete nicht lesen oder fälschen, aber
   weglassen, einen alten Stand ausliefern oder Schreibvorgänge verwerfen; der Client merkt das nicht.

## 3. Aufbau

Ein kleines Serverless-Backend: eine Funktion für `/api/*` und einen täglichen Job, eine
SQL-Datenbank (SQLite), statische Dateien direkt mit den Sicherheits-Headern aus `public/_headers`.
Der Client ist HTML, CSS und ES-Module ohne Framework, ohne Build, ohne Abhängigkeit zur Laufzeit,
ohne CDN und ohne Schrift von aussen; installierbar (Service Worker), stempeln geht ohne Netz
(Ausgangskorb). Kein Hostname im Code: Origin-Prüfung und Links nehmen die Adresse aus der Anfrage
bzw. aus `location`.

Härtung: CSP `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:;
connect-src 'self'; …; frame-ancestors 'none'` (API und statische Dateien gleich, ein Test hält sie
gleich), HSTS, `Referrer-Policy: no-referrer`, keine CORS-Freigabe, `Origin`-Prüfung bei allem ausser
GET, http nur auf `localhost`. `PEPPER` ist ein Secret, nie in der Konfiguration.

## 4. Schlüssel und Pakete

### 4.1 Schlüssel ableiten

- **Benutzername:** 3–32 Zeichen aus `a–z 0–9 . _ -`, klein geschrieben.
- **Passphrase:** mindestens 6 Zeichen, NFC-normalisiert; unter 10 Zeichen warnt die App.
- Im Browser: `PBKDF2-SHA-256(Passphrase, Salz = SHA-256("zeropunch kdf v1|" + Benutzername), 600 000)`
  → 256 Bit → HKDF-SHA-256 (gleiches Salz) in zwei unabhängige Schlüssel:
  - `authKey` (Info `zeropunch auth v1`) geht zum Anmelden an den Server,
  - `wrapKey` (Info `zeropunch wrap v1`, AES-256-GCM) verlässt das Gerät nie.
- **Hauptschlüssel:** 256 Bit Zufall beim Registrieren, verpackt mit `wrapKey` (AES-GCM, AAD
  `zeropunch1|key|pass|<Benutzername>`) zu `{ v: 1, pass: {iv, ct} }`. Auf dem Gerät liegt er als
  nicht exportierbarer WebCrypto-Schlüssel in IndexedDB; im Alltag braucht es keine Passphrase.
- **Passphrase ändern:** mit der aktuellen Passphrase; der Hauptschlüssel wird neu verpackt, die Daten
  bleiben, alle anderen Sitzungen enden.

### 4.2 Server

- Konto-Kennung = `HMAC(PEPPER, Benutzername)`. Dazu `HMAC(PEPPER, authKey)` und das Schlüssel-Paket,
  verschlüsselt gespeichert (AES-GCM, Schlüssel per HKDF aus `PEPPER`, AAD = Konto-Kennung). Vergleiche
  in konstanter Zeit.
- Unbekannter Name und falsche Passphrase laufen denselben Weg (gleiche Abfragen, gleiche Zähler) und
  bekommen dieselbe Antwort `401 login_failed`.
- **Sitzung:** 256-Bit-Zufallstoken, auf dem Server nur als Hash; Cookie `__Host-zp` (HttpOnly, Secure,
  SameSite=Strict); 61 Tage gleitend, höchstens 20 pro Konto (die ältesten fallen weg).

### 4.3 Pakete

Ein Punch, eine Abwesenheit oder die Einstellungen = je ein Paket. Klartext eines Punches:

```json
{ "v": 1, "ts": 1795600000000, "tz": "Europe/Zurich", "note": "", "del": false, "mod": 1795600000000 }
```

- AES-256-GCM mit dem Hauptschlüssel, 12 Byte Zufalls-IV pro Schreibvorgang, Klartext mit Leerzeichen
  auf 256 Byte aufgefüllt; IV + Chiffrat + 16 Byte Prüfsumme = 379 Zeichen base64url.
- AAD `zeropunch1|rec|<Benutzername>|<Paket-ID>`: der Server kann Pakete weder vertauschen noch einem
  anderen Konto unterschieben. Paket-ID: 128 Bit Zufall vom Client.
- Ändern = gleiche ID neu schreiben, Löschen = Grabstein (`del: true`).
- **Abwesenheit:** `{ v, kind: "absence", day, type, half, note, ts, tz, del: true, gone, mod }`;
  `type` ist `vacation`, `sick`, `holiday` oder `other`, `ts` ist 12:00 des Tages und dient nur der
  Aufbewahrung. `del` ist immer `true`, damit ältere Clients sie als Grabstein übergehen; gelöscht ist
  sie, wenn `gone` gesetzt ist.
- **Einstellungen:** ein Paket mit fester ID (lauter Nullen), z. B. Wochensoll, Tageswechsel,
  Punch-Link ohne Rückfrage, Badge-Erinnerung.

## 5. Abgleich und Zeitrechnung

- **Abgleich:** fortlaufende Nummer `seq` pro Konto, der Client holt `?since=<seq>`. Konfliktregel:
  das grössere `mod` gewinnt (`mod` steigt pro Paket streng, auch bei falscher Uhr). Entscheiden tut
  der Client; ist die lokale Fassung neuer, bleibt sie im Ausgangskorb oder wird neu gesendet.
- Ein Paket, das der Server endgültig ablehnt (z. B. Konto voll), bleibt auf dem Gerät und wird als
  «nicht angenommen» gezeigt, mit «Nochmals senden» und «Verwerfen».
- **Falsche Geräte-Uhr:** der Server schickt beim Abgleich seine Zeit. Liegt die Uhr mehr als 12 h
  daneben, warnt die App und löscht nichts.
- **Paarbildung:** innerhalb des lokalen Tages (Zeitzone des Punches) in Reihenfolge: 1. drin,
  2. draussen, 3. drin … Tagessumme = Summe der Paare. Ein ungerader letzter Punch läuft heute bis jetzt
  und gilt an einem vergangenen Tag als offen. Jede Änderung paart den ganzen Tag neu, sichtbar und
  ohne stille Korrektur.
- **Nachtschichten** (Einstellung `dayStart`, Minuten nach Mitternacht, beim Einschalten 04:00): der
  logische Tag ist das lokale Datum von (Zeitpunkt − dayStart). Punches vor dem Tageswechsel zählen
  zum Vortag; eine Schicht über Mitternacht bleibt ein Tag. Gilt für Paare, Summen, Tageslimit,
  Blätter und Export; angezeigt wird immer die echte Uhrzeit.
- **Gutschrift einer Abwesenheit:** ganzer Werktag = Wochensoll / 5, halber Tag die Hälfte, Samstag
  und Sonntag nichts. Saldo = gearbeitet + Gutschrift − Soll; Abwesenheit und Punches am selben Tag
  zählen beide.

## 6. Grenzen und Missbrauchsschutz

- **App:** höchstens 12 Punches pro (logischem) Tag; eine Abwesenheit belegt einen dieser Plätze.
- **Server:** höchstens 100 Schreibvorgänge pro Konto und UTC-Tag (das Einstellungs-Paket hat ein
  eigenes Budget von 200), sonst `429 daily_limit`; das Paket wartet im Ausgangskorb bis zum nächsten
  Tag. Bewusst mehr als 12: Nachträge für mehrere Tage müssen in einem Zug gehen.
- 5000 Pakete pro Konto (12 × 396 = 4752 Punches plus Einstellungen passen), Paket genau 379 Zeichen,
  Schlüssel-Paket höchstens 4 KiB, Anfragen höchstens 8 KiB.
- 50 000 angemeldete Anfragen pro Konto und UTC-Tag (die App gleicht einmal pro Minute ab).
- **Pro Netz:** alle IP-Limits zählen pro IPv4-Adresse oder IPv6-/64 und bei IPv6 ein zweites Mal
  pro /48, zehnmal höher – wer ein /48 hat, vervielfacht die /64-Limits sonst 65 536-fach.
- **Rechenaufgabe (Proof of Work) beim Registrieren:** ein zustandsloses, mit `PEPPER` signiertes,
  10 Minuten gültiges Token; gesucht ist eine Zahl, so dass `SHA-256(Token + ":" + Zahl)` mit
  `POW_BITS` (Vorgabe 17) Null-Bits beginnt. Verbrauchte Tokens merkt sich der Server bis zum Ablauf.
  17 Bit: rund 0,2 s am Laptop, 1–1,5 s auf einem 4–6-mal langsameren Gerät (gemessen mit WebCrypto).
- **Grosszügig pro Netz:** hinter einer Büro- oder Mobilfunkadresse teilen sich viele Leute ein Netz;
  sie sollen sich nicht gegenseitig aussperren. Der Betreiber beobachtet dafür die Nutzung.
- **Registrieren:** 100 pro Netz und Tag (1000 pro /48), erst zählen, dann prüfen. Über 1000 pro Tag
  insgesamt wird die Aufgabe schwerer (+1 Bit pro Verdoppelung, höchstens +6), harte Obergrenze 5000.
  «Name vergeben» verbraucht die Aufgabe und zählt gegen 200 Proben pro Netz (2000 pro /48) und Tag.
- **Anmelden:** 300 Fehlversuche pro Netz und Stunde (3000 pro /48), danach `429` nur für dieses Netz.
  Ein Konto wird nie gesperrt: ab 20 Fehlversuchen pro Stunde von überall braucht jeder Versuch eine
  Rechenaufgabe (`428 pow_required`). Unbekannte Namen zählen und antworten genauso.
- **Passphrase ändern und Konto löschen:** 10 falsche aktuelle Passphrasen pro Sitzung und Stunde.
- Jeder Zähler, der sperrt, wird erst hochgezählt und dann geprüft (in einer Anweisung), auch bei
  vielen gleichzeitigen Anfragen kommen nie mehr als das Limit durch; ein Erfolg gibt seinen Platz zurück.
- Alle Zähler nutzen gehashte Kennungen; der tägliche Job löscht jede Zeile nach spätestens zwei Tagen.
- **Betreiber-Statistik** `GET /api/admin/stats` nur mit `STATS_TOKEN`, sonst `404`; nur Summen, nie
  eine Kennung oder Zeile eines Kontos.

## 7. Aufbewahrung und Löschen

- **13 Monate (396 Tage)** ab dem Punch, vom Client durchgesetzt: Älteres nimmt die App nicht an,
  Abgelaufenes wirft sie bei jedem Abgleich weg und löscht es auf dem Server hart, tageweise, damit
  der Zeitpunkt des Löschens nicht die Uhrzeit verrät. Die Zahl steht je einmal in
  `public/js/store.js` und `src/retention.js`.
- **Rückfallebene auf dem Server** (sieht keine Zeiten): ein täglicher Job löscht Pakete, die 396 Tage
  nicht geschrieben wurden (das Einstellungs-Paket lebt so lange wie das Konto), dazu abgelaufene
  Sitzungen, Zähler und Rechenaufgaben.
- **61 Tage ohne Nutzung:** der Job löscht das Konto samt Paketen und Sitzungen. Die Anmelde-Antwort
  nennt den bisherigen letzten Tag; wer länger als 30 Tage weg war, wird einmal darauf hingewiesen.
- **Konto löschen** geht jederzeit in den Einstellungen, bestätigt mit der Passphrase (der Server
  prüft sie wie beim Passphrase-Wechsel; die Sitzung allein genügt nicht). Von einem gelöschten Konto bleiben nur die
  Hashes seiner noch gültigen Sitzungen mit einem UTC-Tag, solange der Browser das Cookie noch haben
  kann (Ablauf der Sitzung plus 64 Tage). So bekommen die anderen Geräte `410 account_deleted` und
  löschen ihre lokale Kopie; «Alle Geräte abmelden», Passphrase-Wechsel und abgelaufene Sitzungen
  bleiben `401`.
- Export als CSV oder JSON; was man länger behalten will, muss man exportieren.

## 8. Bewusst nicht

- Kein Wiederherstellungs-Schlüssel, kein Zurücksetzen per Mail, keine Mail-Adresse.
- Keine Teams, keine Vorgesetzten-Sicht, kein Lohnexport.
- Kein Archiv über 13 Monate hinaus, kein verschlüsseltes Backup zum Einlesen.
- Kein Fremdcode, keine Tracker, keine Cookies ausser der Sitzung, keine Protokolle mit Namen oder IPs.
- Keine native App.

Selbst betreiben, Variablen und Tests: siehe [README.md](README.md), Abschnitt «Self-hosting».
