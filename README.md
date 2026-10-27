# Bernstein-Alarm

Zeigt für Pegel an der deutschen Nordseeküste, wann sich die Bernsteinsuche am **Strand** und im **Watt** lohnt, und schickt dir eine **Telegram-Nachricht**, sobald nach einem erhöhten Hochwasser oder einem auflandigen Sturm gute Zeitfenster anstehen.

- **Strand:** von Hochwasser bis 2 Stunden danach
- **Watt:** von 1 Stunde nach Hochwasser bis 1 Stunde vor Niedrigwasser
- Jedes Fenster zeigt: Tag oder Nacht (UV-Lampe), Wind, Nebel/Sicht, Regen, Wellen, Wasserstand über dem mittleren Hochwasser (MHW)

---

## So funktioniert es

```
 jede Stunde bei GitHub (GitHub Actions)
 ┌─────────────────────────────────────────────┐
 │ scripts/update.mjs                          │
 │  1. Gezeiten + Wasserstandsvorhersage (BSH) │
 │  2. Wind, Sicht, Regen, Wellen (Open-Meteo) │
 │  3. Bewertung  ← lib/bernstein.js           │
 │  4. Telegram-Nachricht, wenn es sich lohnt  │
 └───────────────┬─────────────────────────────┘
                 │ veröffentlicht
                 ▼
 Web-App auf GitHub Pages (index.html, app.js)
 Karte, Suche, Zeitfenster – rechnet mit derselben lib/bernstein.js
```

Alles läuft kostenlos bei GitHub. Du brauchst keinen eigenen Server.

### Ein paar Begriffe

| Begriff | Bedeutung |
|---|---|
| **Repository (Repo)** | Ein Projektordner bei GitHub, inklusive aller früheren Versionen. |
| **Commit** | Eine gespeicherte Änderung mit einer kurzen Beschreibung („Commit-Message“). Jeder Commit ist ein Schnappschuss, zu dem man zurückkehren kann. |
| **GitHub Actions** | GitHub führt auf Zuruf oder nach Zeitplan Programme für dich aus. Hier: jede Stunde `scripts/update.mjs`. Die Anleitung dafür steht in `.github/workflows/bernstein.yml`. |
| **GitHub Pages** | GitHub stellt eine Webseite aus deinem Repo ins Internet, unter `https://DEINNAME.github.io/bernstein-alarm/`. |
| **Secret** | Ein geheimer Wert (z. B. das Telegram-Passwort deines Bots), den nur die Actions sehen, nicht die Öffentlichkeit. |

---

## Einrichtung Schritt für Schritt

### 1. Repository anlegen

1. Auf [github.com](https://github.com) einloggen, oben rechts auf **+** → **New repository**.
2. Name: `bernstein-alarm`. Sichtbarkeit: **Public**. GitHub Pages ist für öffentliche Repos kostenlos, deine Telegram-Daten bleiben trotzdem geheim.
3. Keine Häkchen bei README, .gitignore oder Lizenz setzen. Auf **Create repository** klicken.

### 2. Dateien hochladen

1. Im neuen, leeren Repo auf den Link **uploading an existing file** klicken.
2. Die ZIP-Datei entpacken und den **Inhalt** des Ordners `bernstein-alarm` in das Browserfenster ziehen. Gemeint sind die Dateien und Unterordner, nicht der Ordner selbst.
   - **Wichtig:** Der Ordner `.github` beginnt mit einem Punkt und ist auf dem Mac versteckt. Im Finder blendest du ihn mit `Cmd + Shift + .` ein. Unter Windows ist er normal sichtbar.
3. Unten bei „Commit changes“ als Beschreibung eintragen:
   ```
   Erste Version des Bernstein-Alarms
   ```
   Dann auf **Commit changes** klicken.
4. Prüfen: Im Repo muss es den Ordner `.github/workflows` mit der Datei `bernstein.yml` geben. Falls er fehlt: **Add file** → **Create new file**, als Namen `.github/workflows/bernstein.yml` eintippen (die Schrägstriche legen die Ordner an) und den Inhalt der Datei hineinkopieren.

### 3. GitHub Pages einschalten

**Settings** (Reiter oben im Repo) → links **Pages** → bei „Source“ **GitHub Actions** auswählen.

### 4. Den Job das erste Mal starten

1. Reiter **Actions**. Falls GitHub fragt, ob Workflows aktiviert werden sollen: bestätigen.
2. Links **Bernstein-Alarm** anklicken → rechts **Run workflow** → **Run workflow**.
3. Nach 1–2 Minuten sollte ein grüner Haken erscheinen. Ein Klick auf den Lauf zeigt das Protokoll (Log) jedes Schritts.
4. Deine Web-App: `https://DEINNAME.github.io/bernstein-alarm/`

Ab jetzt läuft der Job jede Stunde von selbst.

### 5. Telegram einrichten

1. In Telegram den Kontakt **@BotFather** öffnen und `/newbot` senden. Einen Namen und einen Benutzernamen (endet auf `bot`) vergeben. BotFather antwortet mit einem **Token**, etwa `123456789:AAF…`. Das Token wie ein Passwort behandeln.
2. Im Repo: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
   - Name: `TELEGRAM_BOT_TOKEN`, Wert: das Token
3. In Telegram deinem neuen Bot irgendetwas schreiben, z. B. „Hallo“.
4. **Actions** → **Bernstein-Alarm** → **Run workflow**, bei „Was soll zusätzlich passieren?“ **chat-id-anzeigen** wählen. Im Log des Schritts „Daten holen, bewerten, benachrichtigen“ steht deine Chat-ID, eine Zahl.
5. Zweites Secret anlegen: Name `TELEGRAM_CHAT_ID`, Wert: diese Zahl.
6. Zum Testen noch einmal **Run workflow** mit **telegram-test**. Jetzt sollte eine Nachricht ankommen.

---

## Orte und Einstellungen ändern

Alles steht in **`config.json`**. Datei im Repo anklicken, dann oben rechts auf das **Stift-Symbol** klicken, ändern und **Commit changes** wählen. Danach baut der Job die Web-App sofort neu.

Die **Kennung** eines Pegels findest du in der Web-App: Pegel anklicken, sie steht unter dem Namen und auch hinten in der Adresszeile nach dem `#`.

Beispiel für einen weiteren Ort:

```json
{
  "name": "Wilhelmshaven",
  "station": "wilhelmshaven_alter_vorhafen",
  "auflandig": { "von": 270, "bis": 30 }
}
```

`auflandig` gibt an, aus welchen Richtungen (in Grad, woher der Wind kommt) der Wind für diesen Ort auflandig ist: 0 = Nord, 90 = Ost, 180 = Süd, 270 = West. `von: 270, bis: 30` heißt also West über Nord bis Nordnordost.

Passende Commit-Message, wenn du einen Ort hinzufügst:
```
Ort Wilhelmshaven hinzugefügt
```

| Einstellung | Standard | Bedeutung |
|---|---|---|
| `schwellen.ereignisAbCm` | 75 | Ab so viel cm über MHW zählt ein Hochwasser als Ereignis |
| `schwellen.starkAbCm` | 150 | Ab hier zählt das Hochwasser mit voller Stärke |
| `schwellen.sturmAbBft` | 7 | Auflandiger Wind ab dieser Beaufort-Stärke zählt als Sturm … |
| `schwellen.sturmMinStunden` | 6 | … wenn er mindestens so viele Stunden anhält |
| `schwellen.gefahrBoeenBft` | 9 | Böen ab hier: Warnung und Abwertung |
| `abklingen.vollTage` | 2 | So viele Tage nach dem Ereignis bleibt die Chance voll |
| `abklingen.abklingTage` | 3 | Danach sinkt sie über so viele Tage auf null |
| `bonus.zweiPhasen` | true | Bonus, wenn der Wind nach dem Ereignis nachlässt oder ablandig dreht |
| `fenster.*` | 2 / 1 / 1 | Länge der Strand- und Watt-Fenster in Stunden |
| `standardAuflandig` | 225–360 | Auflandiger Bereich für alle Pegel ohne eigene Angabe (SW bis N) |
| `benachrichtigung.abBewertung` | 0.5 | Telegram ab „gut“ (0.5); mit 0.75 nur bei „sehr gut“ |
| `benachrichtigung.vorlaufTage` | 3 | Nur Fenster in den nächsten x Tagen melden |

`config.json` muss gültiges JSON bleiben: Texte in Anführungszeichen, Kommas zwischen Einträgen, kein Komma nach dem letzten Eintrag. Wenn etwas nicht stimmt, schlägt der Job mit einer Fehlermeldung fehl und GitHub schickt dir eine E-Mail.

---

## Wie bewertet wird

1. **Ereignisse finden**
   - Hochwasser mit mindestens `ereignisAbCm` über dem mittleren Hochwasser, gemessen oder vom BSH vorhergesagt.
   - Auflandiger Wind ab `sturmAbBft` über mindestens `sturmMinStunden`.
2. **Grundchance:** Das stärkste Ereignis vor dem Fenster zählt. Ein Hochwasser von +0,75 m ergibt 0,5, eines von +1,5 m oder mehr ergibt 1,0. Die Chance bleibt `vollTage` lang voll und klingt danach ab.
3. **Zwei-Phasen-Bonus:** +0,1, wenn der Wind im Fenster nachgelassen hat (unter 4 Bft) oder ablandig weht.
4. **Abwertungen und Warnungen**
   - Sturmböen
   - Im Watt: Nebel, starker Wind, und ein Niedrigwasser, das hoch bleibt (dann fällt das Watt kaum trocken)
5. **Stufen:** ab 0,75 „sehr gut“, ab 0,5 „gut“, ab 0,25 „mittel“.

Ein Telegram-Hinweis kommt einmal pro Ereignis und noch einmal, falls die Chance später auf eine höhere Stufe steigt.

## Gut zu wissen

- **Zeitplan:** GitHub führt stündliche Jobs manchmal mit einigen Minuten Verspätung aus. Für diesen Zweck spielt das keine Rolle.
- **60-Tage-Regel:** In Repos ohne jede Aktivität pausiert GitHub zeitgesteuerte Jobs nach 60 Tagen und schickt vorher eine E-Mail. Ein Klick im Reiter **Actions** schaltet sie wieder ein. Das kann im ruhigen Sommer passieren, weil dann kaum Ereignisse gespeichert werden.
- **Ordner `state/`:** Hier merkt sich der Job vergangene Hochwasser und bereits verschickte Meldungen. Er committet diese Dateien selbst, mit der Nachricht „Zustand aktualisiert“.
- **Selbsttest ohne Internet:** `node tests/selbsttest.mjs` (benötigt Node.js 20 oder neuer). Er spielt den ganzen Ablauf mit nachgebauten Daten durch.

## Datenquellen und Lizenzen

- Gezeiten, Wasserstandsvorhersagen und Messkurven: [BSH](https://www.bsh.de), OGC-API `WaterLevelForecast`, CC BY 4.0
- Wetter und Wellen: [Open-Meteo](https://open-meteo.com) mit Modellen des Deutschen Wetterdienstes, CC BY 4.0
- Karte: © [OpenStreetMap](https://www.openstreetmap.org/copyright)-Mitwirkende

**Sicherheit:** Die Bewertung ist eine Orientierung, keine Garantie. Im Watt immer selbst die Gezeiten und Priele im Blick behalten, bei Nebel nicht hinausgehen und jemandem Bescheid sagen, wo du bist.
