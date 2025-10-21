# Solana Live Analyzer + Online-Learning (TF.js)

Features:
- Binance WebSocket (tick-live)
- REST über Proxy `/api/binance` + Fallbacks
- KI-Modell (TensorFlow.js), das auf 1h-Kerzen trainiert
- Online-Lernen: bei neuen Kerzen wird nachtrainiert
- Self-Evaluation: Accuracy und Brier Score der letzten 100 Punkte
- Persistenz im Browser (localStorage)

## Start
```bash
npm install
npm run dev
```

## Deploy
Auf Vercel importieren. Fertig.

## Hinweise
- Das Modell lernt nur im Browser (Client-seitig). Für Produktionsbetrieb: Backend + Datenbank (z. B. Supabase) und Job zum täglichen Retraining.
- Ziel: Klassifikation "nächste Stunde ↑/↓".
