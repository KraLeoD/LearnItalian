# Parla – Meine Sätze

Eine kleine Sprachlern-App: deutsche Alltagssätze eingeben, ins Italienische übersetzen, einmalig als Audio erzeugen und später suchen, ordnen und mitsprechen.

## Architektur

Das npm-Workspace enthält:

- `apps/web`: Expo 54, React Native Web und React Native Paper (Material Design 3). Der Web-Export nutzt nur die same-origin `/api`.
- `apps/api`: Fastify und TypeScript. Der Server stellt API, Expo-Dateien und gespeichertes MP3-Audio bereit.
- SQLite speichert Einträge, Kategorien, monatliche Zeichenzähler und undurchsichtige Audio-Referenzen. MP3-Dateien liegen unter `${DATA_DIR}/audio`.
- Kleine Provider-Interfaces kapseln Azure Translator und Azure Speech. Deterministische Mock-Provider ermöglichen Entwicklung und Tests ohne Azure.

So entstehen ein Image, ein Prozess, ein PVC und einfache Backups. SQLite passt zum persönlichen Dienst, erfordert hier aber genau ein Replikat. Horizontale Skalierung würde später eine Multi-Writer-Datenbank und gemeinsamen/Object-Storage erfordern.

## Installieren und lokal starten

Voraussetzung: Node.js 20+ und npm 10+ (im Codespace vorhanden).

```bash
npm ci
cp .env.example .env
set -a
source .env
set +a
npm run dev
```

Auf einem lokalen Rechner öffnest du `http://localhost:8081`. `.env` startet ohne Azure im Mock-Modus.

In GitHub Codespaces ist der einfachste Weg ein same-origin Start über den weitergeleiteten Port 8080 (ohne Hot Reload):

```bash
npm ci
npm run build
PROVIDER_MODE=mock DATA_DIR=./data NODE_ENV=production npm start
```

Öffne danach Port 8080 im Bereich **Ports** und lasse seine Sichtbarkeit privat. Für Hot Reload mit zwei weitergeleiteten Ports müssen `DEV_ORIGIN` auf die 8081-URL und `EXPO_PUBLIC_API_URL` auf die 8080-URL des Codespaces gesetzt werden. `EXPO_PUBLIC_API_URL` ist nur eine nicht-geheime Adresse; Azure-Schlüssel dürfen niemals `EXPO_PUBLIC_`-Variablen sein.

Einzelne Prozesse und Produktionsbuild:

```bash
npm run dev:api
npm run dev:web
npm run build
PROVIDER_MODE=mock DATA_DIR=./data NODE_ENV=production npm start
# http://localhost:8080
```

## Azure konfigurieren

Setze ausschließlich serverseitig:

```dotenv
PROVIDER_MODE=azure
AZURE_TRANSLATOR_KEY=...
AZURE_TRANSLATOR_ENDPOINT=https://api.cognitive.microsofttranslator.com
AZURE_TRANSLATOR_REGION=westeurope
AZURE_SPEECH_KEY=...
AZURE_SPEECH_REGION=westeurope
AZURE_SPEECH_VOICE=it-IT-ElsaNeural
```

`AZURE_SPEECH_ENDPOINT` kann alternativ einen vollständigen Speech-Endpunkt enthalten. Schlüssel werden nur beim Serverstart gelesen, nicht geloggt, nicht über die API ausgegeben und nie in Expo gebündelt. Das Ändern von Schlüsseln in der unauthentifizierten Oberfläche wird absichtlich nicht unterstützt.

`AZURE_SPEECH_VOICE` ist die Standardstimme. In der Oberfläche kann pro Erstellung zwischen den italienischen Standard-Neural-Stimmen gewählt werden; HD/Dragon-Stimmen werden bewusst nicht angeboten. Im Modus „Mehrere Sätze“ steht jeder deutsche Satz in einer eigenen Zeile. Die App speichert und zeigt die Übersetzungen einzeln, erzeugt aber eine gemeinsame Audiodatei in derselben Reihenfolge.

Provider-Aufrufe haben Timeout und höchstens einen Retry bei Netzwerk-/5xx-Fehlern. Fehlerhafte Requests, Authentifizierungsfehler und 429 werden nicht wiederholt. SSML wird XML-sicher escaped; Azure Speech liefert MP3.

## Kontingentschutz

`TRANSLATION_MONTHLY_CHAR_LIMIT` und `SPEECH_MONTHLY_CHAR_LIMIT` begrenzen die pro UTC-Kalendermonat gesendeten Zeichen. SQLite reserviert sie atomar. Audio wird über Text, Sprache, Provider, Stimme und Sprechparameter gehasht und wiederverwendet; Abspielen und Cache-Treffer zählen nicht. Gleiche parallele Erstellungen werden zusammengeführt, die UI sperrt den Button, und `GENERATION_REQUESTS_PER_MINUTE` drosselt Generierungsaufrufe je Client-IP.

Die internen Zähler sind nur eine Schutzfunktion. Azure-Portal und Azure-Kontingentanzeigen bleiben maßgeblich.

## Testen und bauen

Tests führen keine Azure-Anfragen aus:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Abgedeckt sind Eingabevalidierung, Konfiguration/Secrets, Translator-Antworten, SSML/Speech-Requests, Audio-Cache, Monatslimits, Kategorie-Löschung ohne Satzverlust, partielle Speech-Fehler und Dateipfadsicherheit.

## Docker

Das Multi-Stage-Image läuft als UID/GID `10001`, bindet `0.0.0.0:8080`, schreibt dauerhaft nur nach `/data` und verarbeitet SIGTERM im Node-Prozess.

```bash
docker build --platform linux/amd64 -t meine-saetze:local .
docker volume create meine-saetze-data
docker run --rm -p 8080:8080 \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  -v meine-saetze-data:/data \
  -e PROVIDER_MODE=mock \
  meine-saetze:local
```

Mit Docker Compose startet die gleiche gehärtete Konfiguration mit einem benannten Volume und Mock-Providern:

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f app
```

Die App ist unter `http://localhost:8080` erreichbar. Beenden, ohne persistente Sätze und Audios zu löschen:

```bash
docker compose down
```

Für Azure setze in der nicht versionierten `.env` mindestens `PROVIDER_MODE=azure`, `AZURE_TRANSLATOR_KEY`, `AZURE_SPEECH_KEY` und die Regionen. Compose liest `.env` nur zur Laufzeit-Interpolation; die Werte werden nicht in das Image gebaut:

```bash
docker compose up --build -d
```

Ein absichtliches vollständiges Löschen einschließlich SQLite-Daten und Audio ist mit `docker compose down --volumes` möglich. Erstelle vorher ein Backup, wenn die Daten noch gebraucht werden.

Für Azure Schlüssel nur zur Laufzeit einspeisen. Das Image enthält keine Zugangsdaten. `.github/workflows/docker-build.yaml` baut ohne QEMU ausschließlich `linux/amd64` und veröffentlicht Branch-, Tag- und SHA-Tags in GHCR.

## Kubernetes

Passe zuerst das Image in `deploy/kustomize/base/deployment.yaml` an:

```bash
kubectl create namespace language-app
kubectl -n language-app create secret generic language-app-azure \
  --from-literal=translator-key='AZURE_TRANSLATOR_KEY' \
  --from-literal=speech-key='AZURE_SPEECH_KEY'
kubectl -n language-app apply -k deploy/kustomize/base
kubectl -n language-app rollout status deployment/language-app
kubectl -n language-app port-forward service/language-app 8080:80
```

Optionalen Ingress nach Anpassung von Host, Klasse und TLS anwenden:

```bash
kubectl -n language-app apply -f deploy/examples/ingress.yaml
```

Der Pod nutzt `runAsNonRoot`, UID/GID 10001, read-only Root, keine Capabilities, `RuntimeDefault`-Seccomp, Ressourcenlimits und HTTP-Probes. `/tmp` ist ein begrenztes `emptyDir`, `/data` ein 2-GiB-`ReadWriteOnce`-PVC. `Recreate` plus ein Replikat verhindern parallele SQLite-Schreiber.

Das Secret kann durch Sealed Secrets, External Secrets, Helm oder manuell erzeugt werden; Sealed Secrets ist keine Voraussetzung. `deploy/examples/secret.example.yaml` enthält nur Platzhalter und darf nie mit echten Werten committed werden.

## Backup und Restore

Alles Dauerhafte liegt in `/data`: `app.sqlite` (ggf. mit `-wal`/`-shm`) und `audio/`. Einfacher konsistenter Offline-Weg:

```bash
kubectl -n language-app scale deployment/language-app --replicas=0
# PVC-Snapshot erstellen oder den gesamten PVC-Inhalt kopieren.
kubectl -n language-app scale deployment/language-app --replicas=1
```

Zum Restore die App stoppen, den vollständigen Inhalt in einen leeren PVC zurückspielen, Eigentum für UID/GID 10001 sicherstellen und wieder auf 1 skalieren. CSI-VolumeSnapshots sind ideal. Nur die SQLite-Hauptdatei während des Betriebs zu kopieren ist wegen WAL nicht ausreichend.

## Azure-Schlüssel rotieren

```bash
kubectl -n language-app create secret generic language-app-azure \
  --from-literal=translator-key='NEUER_TRANSLATOR_KEY' \
  --from-literal=speech-key='NEUER_SPEECH_KEY' \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n language-app rollout restart deployment/language-app
kubectl -n language-app rollout status deployment/language-app
```

Nach erfolgreichem Healthcheck den alten Azure-Schlüssel widerrufen.

## Sicherheitsgrenzen und MVP-Limits

Es gibt absichtlich keine Anmeldung, Benutzer, Sessions oder Berechtigungstrennung. Jeder mit Netzwerkzugriff kann alle Sätze lesen/ändern und Kontingent verbrauchen. Die App gehört in ein vertrauenswürdiges Netz oder hinter TLS und einen authentifizierenden Ingress/Proxy (z. B. Authentik). Daten sind nicht anwendungsseitig verschlüsselt; nutze bei Bedarf verschlüsselten Storage und sichere Backups.

Weitere Grenzen: nur Deutsch → Italienisch, höchstens 500 Suchresultate, keine Mehrbenutzerfähigkeit/horizontale Skalierung. Verwaiste Cache-Audios werden nach dem letzten Satz nicht automatisch bereinigt; für den kleinen Datensatz ist das einfacher und sicherer.
