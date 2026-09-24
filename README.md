# Zerfallsrechner (Nuclicalc)

Progressive Web App zur Berechnung radioaktiver Zerfallsreihen. Reines HTML/CSS/JavaScript, keine Build-Tools, keine externen Bibliotheken; läuft nach dem ersten Aufruf vollständig offline.

**Online:** https://axthedragon.github.io/Nuclicalc/

- Eingabe: Gemisch aus Nukliden mit Menge als Atomzahl, mol, Masse (g, mg, µg, ng) oder Aktivität (Bq bis TBq), dazu Zeitpunkt und Zeitbereich (s, min, h, d, a).
- Alle Tochternuklide werden automatisch bis zu den stabilen Endnukliden eingesammelt, inklusive Verzweigungen.
- Ausgabe: Tabelle mit Atomzahl, Masse und Aktivität aller Nuklide zum gewählten Zeitpunkt sowie ein Zeitverlaufsdiagramm (Canvas, logarithmische Zeitachse, Aktivität/Atome/Masse, y-Achse log oder linear).

## Aufbau

```
index.html            Oberfläche
css/style.css         Gestaltung (mobil zuerst, Hell-/Dunkelmodus)
js/decay.js           Rechenkern (Browser und Node)
js/format.js          Zahlen-/Zeitformatierung und Eingabe-Parser (deutsch)
js/chart.js           Diagramm mit logarithmischer Zeitachse
js/app.js             Oberflächenlogik
data/nuclides.json    Nukliddaten
manifest.json, sw.js  PWA (Installierbarkeit, Offline-Cache)
icons/                App-Icons (erzeugt mit scripts/make_icons.js)
scripts/import_iaea.js  Import aus der IAEA-Nuklidkarte (CSV)
tests/                Unit-Tests (Node, ohne Framework)
.github/workflows/pages.yml  Tests und Deployment auf GitHub Pages
```

Lokal starten (der Service Worker und `fetch` brauchen einen Webserver, `file://` reicht nicht):

```sh
python3 -m http.server 8000   # dann http://localhost:8000 öffnen
npm test                      # Unit-Tests (nur Node ≥ 18 nötig, keine Pakete)
```

## Rechenverfahren

Für die n beteiligten Nuklide gilt dN/dt = A·N mit

- A[i][i] = −λᵢ, λᵢ = ln 2 / T½,ᵢ (stabil: λ = 0)
- A[j][i] = bᵢ→ⱼ · λᵢ für jede Tochter j mit Verzweigungsanteil b

Lösung: **N(t) = exp(A·t)·N(0)**, Aktivität **Aᵢ = λᵢ·Nᵢ**.

Das Matrixexponential wird per Skalierung und Quadrieren mit Padé-Näherung (Grad 3 bis 13, nach Higham 2005) berechnet. Damit es auch bei Halbwertszeiten stabil bleibt, die um mehr als 20 Größenordnungen auseinanderliegen (Th-232: 4·10¹⁷ s, Po-212: 3·10⁻⁷ s):

1. Die Nuklide werden topologisch sortiert (Mutter vor Tochter), A ist dann untere Dreiecksmatrix.
2. Die Diagonale von exp(A·t) ist exakt exp(−λᵢt). Sie wird nach der Padé-Näherung und nach jedem Quadrierschritt exakt eingesetzt (Al-Mohy & Higham 2009). Ohne diesen Schritt ginge die Information 1 − 10⁻²⁴ in doppelter Genauigkeit verloren, und langlebige Mütter würden scheinbar nicht zerfallen.
3. Die übrigen Einträge einer Spalte sind alle proportional zu λ der Mutter und bleiben relativ genau; A ist außerhalb der Diagonale nichtnegativ, das Quadrieren daher frei von Auslöschung.
4. Unabhängige Ketten (z. B. Cs-137 und Sr-90 im selben Gemisch) werden als getrennte Blöcke gerechnet.

Es gibt keine Zeitschrittverfahren; jeder Zeitpunkt wird direkt berechnet.

Die Tests (`tests/decay.test.js`) prüfen Einzelzerfall gegen die analytische Lösung, Zweierketten gegen die Bateman-Formel (auch mit T½ = 10¹⁷ s neben 10⁻⁶ s), Verzweigung (Summe der Töchter = Verlust der Mutter), stabile Endnuklide, das allgemeine expm gegen eine Taylorreihe sowie am Datensatz Atomzahlerhaltung und säkulares Gleichgewicht der U-238-Reihe.

## Datenformat (`data/nuclides.json`)

```json
{
  "meta": { "source": "…" },
  "nuclides": {
    "Bi-212": {
      "halfLife": 3633,
      "stable": false,
      "mass": 211.991286,
      "decays": [
        {"mode": "B-", "branch": 0.6406, "daughter": "Po-212"},
        {"mode": "A",  "branch": 0.3594, "daughter": "Tl-208"}
      ]
    },
    "Pb-208": { "halfLife": null, "stable": true, "mass": 207.976652, "decays": [] }
  }
}
```

| Feld | Bedeutung |
|---|---|
| Schlüssel | Nuklidname `Symbol-Massenzahl`, Isomere mit `m` (z. B. `Tc-99m`) |
| `halfLife` | Halbwertszeit in Sekunden (`null` bei stabilen Nukliden); 1 a = 365,25 d |
| `stable` | `true` für stabile Nuklide |
| `mass` | Atommasse in u (für Umrechnung Masse ↔ Atomzahl; fehlt sie, wird die Massenzahl verwendet) |
| `decays[].mode` | Zerfallsart: `A` (α), `B-` (β⁻), `EC` (Elektroneneinfang/β⁺), `IT` (isomerer Übergang), `SF` (Spontanspaltung), … |
| `decays[].branch` | Verzweigungsanteil 0…1; die Summe je Nuklid soll 1 sein |
| `decays[].daughter` | Tochternuklid oder `null` (z. B. Spontanspaltung: der Zweig verlässt die Kette) |

Der Startdatensatz umfasst 86 Nuklide: die natürlichen Zerfallsreihen von U-238, U-235, Th-232 und Np-237 (inkl. kleiner Nebenzweige wie Po-218 → At-218, Bi-210 → Tl-206, Po-215 → At-215) sowie Cs-137 (über Ba-137m), Sr-90, I-131, Co-60, Mo-99 → Tc-99m, K-40, C-14, H-3 mit ihren Töchtern. Die Werte sind gerundete NUBASE2020/ENSDF- bzw. AME2020-Werte, von Hand erfasst und nicht amtlich geprüft. Spontanspaltungszweige (z. B. U-238, 5·10⁻⁷) sind im Startdatensatz weggelassen. Bi-209 ist mit T½ = 2·10¹⁹ a als radioaktiv geführt.

## Datensatz erweitern

### Mit dem Import-Skript (IAEA LiveChart of Nuclides)

```sh
# direkt herunterladen (benötigt Internetzugang zu nds.iaea.org)
node scripts/import_iaea.js --download

# nur bestimmte Nuklide mit allen Töchtern übernehmen
node scripts/import_iaea.js --download --roots Pu-239,Am-241,Sr-89
```

Das Skript holt die Grundzustände über die LiveChart-API
`https://nds.iaea.org/relnsd/v1/data?fields=ground_states&nuclides=all`, berechnet die Töchter aus den Zerfallsarten (α, β⁻, β⁺/EC, p, n, β⁻n, Clusterzerfälle …), normiert die Verzweigungsanteile und fügt die Nuklide in `data/nuclides.json` ein.

- Standardmäßig bleiben **vorhandene Einträge unverändert** und nur neue Nuklide kommen hinzu. So bleiben die von Hand gepflegten Isomere (Pa-234m, Ba-137m, Tc-99m) erhalten; die CSV enthält nur Grundzustände. Mit `--overwrite` werden vorhandene Einträge ersetzt.
- `--dry-run` zeigt nur die Zusammenfassung, `--output datei.json` schreibt woandershin.
- Töchter, die nicht in der CSV stehen, und Spontanspaltung werden als Zweig ohne Tochter (`"daughter": null`) gespeichert.

### CSV manuell einspielen

In der Sitzung, in der dieses Projekt entstand, war der Zugriff auf `nds.iaea.org` gesperrt; das Skript wurde deshalb nur mit einer Beispiel-CSV (`tests/fixtures/livechart_sample.csv`) getestet. So spielen Sie die CSV von Hand ein:

1. Im Browser öffnen: <https://nds.iaea.org/relnsd/v1/data?fields=ground_states&nuclides=all> – der Browser speichert die Datei (z. B. als `ground_states.csv`).
   Alternativ: `curl -A "Mozilla/5.0" -o ground_states.csv "https://nds.iaea.org/relnsd/v1/data?fields=ground_states&nuclides=all"` (die API verlangt einen User-Agent).
2. Importieren:
   ```sh
   node scripts/import_iaea.js --input ground_states.csv --roots Pu-239,Am-241
   ```
   Ohne `--roots` werden alle rund 3 400 Grundzustände übernommen (die Datei wird dann einige hundert kB groß, die App bleibt aber schnell, weil nur die benötigten Ketten gerechnet werden).
3. `npm test` ausführen (prüft u. a., dass jede Tochter vorhanden ist und die Zweige sich zu 1 summieren).
4. In `sw.js` die Versionsnummer `CACHE` erhöhen, damit installierte Apps die neuen Daten laden.
5. Committen und nach `main` pushen – der Workflow veröffentlicht die Seite neu.

Das Skript liest die Spalten über ihre Namen (`z`, `n`, `symbol`, `half_life`, `unit_hl`, `half_life_sec`, `decay_1`, `decay_1_%`, … , `atomic_mass` in µu). Sollte die IAEA das Format ändern, meldet es „Unerwartetes CSV-Format“.

### Von Hand

Einträge im obigen Format ergänzen. Für Isomere, die aus der CSV nicht hervorgehen, den Zweig der Mutter aufteilen (Beispiel Cs-137: 94,7 % → Ba-137m, 5,3 % → Ba-137).

## Deployment (GitHub Pages)

`.github/workflows/pages.yml` führt bei jedem Push und Pull Request die Tests aus und veröffentlicht bei Pushes auf `main` die Seite (nur die App-Dateien, ohne Tests und Skripte).

Einmalig nötig: im Repository unter **Settings → Pages → Build and deployment → Source** „**GitHub Actions**“ auswählen. Danach ist die App unter https://axthedragon.github.io/Nuclicalc/ erreichbar und lässt sich auf dem Smartphone über „Zum Startbildschirm hinzufügen“ bzw. „App installieren“ installieren.

## Grenzen

- Nur Grundzustände und die im Datensatz gepflegten Isomere; keine Neutronenaktivierung, keine Spaltproduktausbeuten.
- Aktivität meint Zerfälle pro Sekunde des jeweiligen Nuklids, keine Emissionsraten einzelner Strahlungsarten.
- Keine Gewähr für die Richtigkeit der Daten; für sicherheitsrelevante Anwendungen amtliche Daten verwenden.
