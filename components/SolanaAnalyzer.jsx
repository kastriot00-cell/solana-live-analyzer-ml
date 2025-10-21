
import React, { useEffect, useRef, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { TrendingUp, TrendingDown, Activity, AlertCircle, Wifi, WifiOff, RefreshCw, Brain } from "lucide-react";
import { buildModel, buildDataset, trainOrUpdate, predictProba, saveModel, loadModel } from "./MLModel";

const Box = ({ children, style }) => (
  <div style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 16, padding: 16, ...style }}>{children}</div>
);

export default function SolanaAnalyzer() {
  const [priceData, setPriceData] = useState([]);
  const [currentPrice, setCurrentPrice] = useState(null);
  const [indicators, setIndicators] = useState({ rsi: 50, ma20: 0, ma50: 0, macd: 0 });
  const [signal, setSignal] = useState({ type: "HALTEN", confidence: 50, signals: ["🟡 Neutrale Marktsituation - Abwarten"], score: "Neutral" });
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState(null);
  const [priceChange24h, setPriceChange24h] = useState(0);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [apiStatus, setApiStatus] = useState("Verbinde…");

  // ML state
  const [mlReady, setMlReady] = useState(false);
  const [mlProba, setMlProba] = useState(null);
  const [mlDirection, setMlDirection] = useState("-");
  const [mlMetrics, setMlMetrics] = useState({ n: 0, acc: 0, brier: 0 });
  const [mlStatus, setMlStatus] = useState("ML lädt…");

  const wsRef = useRef(null);
  const intervalRef = useRef(null);
  const modelRef = useRef(null);

  // --- Indicators from priceData
  const calcRSI = (arr, period=14) => {
    if (!arr || arr.length < period + 1) return 50;
    let g=0,l=0;
    for (let i = arr.length - period; i < arr.length; i++) {
      const ch = arr[i] - arr[i-1];
      if (ch > 0) g += ch; else l += Math.abs(ch);
    }
    const ag = g/period, al = l/period;
    if (al === 0) return 100;
    const rs = ag/al; const r = 100 - 100/(1+rs);
    return Number(r.toFixed(2));
  };
  const calcMA = (arr, p) => {
    if (!arr || arr.length < p) return 0;
    const s = arr.slice(-p).reduce((a,b)=>a+b,0); return Number((s/p).toFixed(2));
  };
  const calcEMA = (arr, p) => {
    if (!arr || !arr.length) return 0;
    const k = 2 / (p+1); let ema = arr[0];
    for (let i=1;i<arr.length;i++) ema = arr[i]*k + ema*(1-k);
    return ema;
  };
  const calcMACD = (arr) => {
    if (!arr || arr.length < 26) return 0;
    const e12 = calcEMA(arr,12), e26 = calcEMA(arr,26);
    return Number((e12 - e26).toFixed(2));
  };

  const genSignal = (rsi, ma20, ma50, price, macd) => {
    const s=[]; let bull=0,bear=0;
    if (rsi<30){s.push("🟢 RSI überverkauft"); bull+=2;} else if (rsi>70){s.push("🔴 RSI überkauft"); bear+=2;} else if (rsi>=40 && rsi<=60){s.push("🟡 RSI neutral");}
    if (ma20>ma50){s.push("🟢 MA20>MA50 (Trend ↑)"); bull+=2;} else if (ma20<ma50){s.push("🔴 MA20<MA50 (Trend ↓)"); bear+=2;}
    if (price>ma20){s.push("🟢 Preis über MA20"); bull+=1;} else {s.push("🔴 Preis unter MA20"); bear+=1;}
    if (macd>0){s.push("🟢 MACD positiv"); bull+=1;} else {s.push("🔴 MACD negativ"); bear+=1;}
    const total = bull+bear || 1;
    if (bull>bear) return { type:"KAUFEN", confidence: Math.min(Math.round((bull/total)*100),85), signals:s, score:`${bull}/${total} bullish` };
    if (bear>bull) return { type:"VERKAUFEN", confidence: Math.min(Math.round((bear/total)*100),85), signals:s, score:`${bear}/${total} bearish` };
    return { type:"HALTEN", confidence:50, signals:["🟡 Neutrale Marktsituation - Abwarten"], score:"Neutral" };
  };

  const fetchFromBinance = async () => {
    try {
      setApiStatus("Versuche Binance API…");
      const t = await fetch(`/api/binance?path=api/v3/ticker/24hr?symbol=SOLUSDT`);
      if (!t.ok) throw new Error("ticker failed");
      const tj = await t.json();
      const price = parseFloat(tj.lastPrice);
      setCurrentPrice(price);
      setPriceChange24h(parseFloat(tj.priceChangePercent || 0));

      const k = await fetch(`/api/binance?path=api/v3/klines?symbol=SOLUSDT&interval=1h&limit=168`);
      if (!k.ok) throw new Error("klines failed");
      const kj = await k.json();
      const formatted = kj.map(r => ({ time: new Date(r[0]).toLocaleString("de-DE", { day:"2-digit", month:"2-digit", hour:"2-digit" }), price: parseFloat(r[4]), timestamp: r[0] }));
      setPriceData(formatted);
      const prices = formatted.map(d=>d.price);
      const rsi = calcRSI(prices);
      const ma20 = calcMA(prices,20);
      const ma50 = calcMA(prices,50);
      const macd = calcMACD(prices);
      setIndicators({ rsi, ma20, ma50, macd });
      setSignal(genSignal(rsi, ma20, ma50, price, macd));

      setIsLive(true);
      setError(null);
      setApiStatus("✅ Binance API verbunden");
      setLastUpdate(new Date().toLocaleTimeString("de-DE"));
      return true;
    } catch { setApiStatus("❌ Binance fehlgeschlagen"); return false; }
  };

  const fetchFromCoinGecko = async () => {
    try {
      setApiStatus("Versuche CoinGecko API…");
      const p = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true", { headers: { Accept:"application/json" }});
      if (!p.ok) throw new Error("cg price");
      const pj = await p.json();
      const price = Number(pj.solana.usd);
      setCurrentPrice(price);
      setPriceChange24h(Number(pj.solana.usd_24h_change || 0));

      const h = await fetch("https://api.coingecko.com/api/v3/coins/solana/market_chart?vs_currency=usd&days=7&interval=hourly");
      if (!h.ok) throw new Error("cg hist");
      const hj = await h.json();
      const formatted = hj.prices.map(([t,pr]) => ({ time: new Date(t).toLocaleString("de-DE",{ day:"2-digit", month:"2-digit", hour:"2-digit" }), price: Number(Number(pr).toFixed(2)), timestamp: t }));
      setPriceData(formatted);
      const prices = formatted.map(d=>d.price);
      const rsi = calcRSI(prices);
      const ma20 = calcMA(prices,20);
      const ma50 = calcMA(prices,50);
      const macd = calcMACD(prices);
      setIndicators({ rsi, ma20, ma50, macd });
      setSignal(genSignal(rsi, ma20, ma50, price, macd));

      setIsLive(true);
      setError(null);
      setApiStatus("✅ CoinGecko API verbunden");
      setLastUpdate(new Date().toLocaleTimeString("de-DE"));
      return true;
    } catch { setApiStatus("❌ CoinGecko fehlgeschlagen"); return false; }
  };

  const generateDemoData = () => {
    setApiStatus("⚠️ Demo-Modus aktiv");
    const base = 145;
    const data = []; let p = base;
    for (let i=0;i<168;i++){
      p = p + (Math.random()-0.48)*3;
      data.push({ time: new Date(Date.now()-(168-i)*3600000).toLocaleString("de-DE",{day:"2-digit",month:"2-digit",hour:"2-digit"}), price: Number(p.toFixed(2)), timestamp: Date.now()-(168-i)*3600000 });
    }
    setPriceData(data);
    const prices = data.map(d=>d.price);
    const cur = prices[prices.length-1];
    setCurrentPrice(cur);
    setPriceChange24h(Number(((Math.random()-0.5)*10).toFixed(2)));
    const rsi = calcRSI(prices), ma20=calcMA(prices,20), ma50=calcMA(prices,50), macd=calcMACD(prices);
    setIndicators({ rsi, ma20, ma50, macd });
    setSignal(genSignal(rsi,ma20,ma50,cur,macd));
    setIsLive(false);
    setError("Konnte keine Live-Daten laden. API-Limits/CORS.");
    setLastUpdate(new Date().toLocaleTimeString("de-DE"));
  };

  const fetchLiveData = async () => {
    setLoading(true);
    try {
      if (await fetchFromBinance()) return;
      if (await fetchFromCoinGecko()) return;
      generateDemoData();
    } finally { setLoading(false); }
  };

  // --- ML helpers ---
  const recomputeIndicatorsArray = () => {
    // Build per-candle indicator snapshots parallel to priceData
    const arr = priceData.map(d=>d.price);
    const out = arr.map((_,i)=>{
      const sub = arr.slice(0, i+1);
      return {
        rsi: calcRSI(sub),
        ma20: calcMA(sub,20),
        ma50: calcMA(sub,50),
        macd: calcMACD(sub)
      };
    });
    return out;
  };

  const trainMLIfPossible = async () => {
    try {
      const prices = priceData.map(d=>d.price);
      const inds = recomputeIndicatorsArray();
      const ds = buildDataset(prices, inds, 24);
      if (!ds || ds.X.length < 64) { setMlStatus("Zu wenige Daten für ML-Training"); return; }
      if (!modelRef.current) modelRef.current = buildModel(ds.X[0].length);

      setMlStatus("Trainiere ML…");
      const hist = await trainOrUpdate(modelRef.current, ds.X, ds.y, 10, 32);
      await saveModel(modelRef.current, { trainedAt: Date.now(), n: ds.y.length });

      // quick evaluation on last 100
      const nEval = Math.min(100, ds.X.length);
      let correct = 0;
      let brier = 0;
      for (let i = ds.X.length - nEval; i < ds.X.length; i++) {
        const proba = await predictProba(modelRef.current, ds.X[i]);
        const predUp = proba >= 0.5 ? 1 : 0;
        const trueY = ds.y[i];
        if (predUp === trueY) correct++;
        brier += (proba - trueY) * (proba - trueY);
      }
      setMlMetrics({ n: ds.y.length, acc: correct / nEval, brier: brier / nEval });
      setMlReady(true);
      setMlStatus("ML bereit");
    } catch (e) {
      setMlStatus("ML-Fehler");
    }
  };

  const updateLivePrediction = async () => {
    if (!mlReady || !modelRef.current || priceData.length < 26) return;
    const prices = priceData.map(d=>d.price);
    const inds = recomputeIndicatorsArray();
    const window = 24;
    const i = prices.length - 1;
    const slice = prices.slice(i - window, i + 1);
    const lastInd = inds[i];
    const feats = [
      ...slice.map(v => v / slice[slice.length-1] - 1),
      (lastInd.rsi || 50)/100,
      (lastInd.ma20 || prices[i]) / prices[i],
      (lastInd.ma50 || prices[i]) / prices[i],
      (lastInd.macd || 0),
    ];
    const proba = await predictProba(modelRef.current, feats);
    setMlProba(proba);
    setMlDirection(proba >= 0.5 ? "↑ steigt (Wahrsch.)" : "↓ fällt (Wahrsch.)");
  };

  useEffect(() => {
    (async () => {
      // Load saved model if present
      const { model } = await loadModel();
      if (model) { modelRef.current = model; setMlReady(true); setMlStatus("ML geladen"); }
      await fetchLiveData();

      wsRef.current = new WebSocket("wss://stream.binance.com:9443/ws/solusdt@trade");
      wsRef.current.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          const live = parseFloat(msg.p);
          if (!isNaN(live)) {
            setCurrentPrice(live);
            setIsLive(true);
            setApiStatus("🟢 Binance WebSocket live");
            setLastUpdate(new Date().toLocaleTimeString("de-DE"));
            setPriceData(prev => {
              if (!prev.length) return prev;
              const now = Date.now();
              const point = { time: new Date(now).toLocaleString("de-DE",{day:"2-digit",month:"2-digit",hour:"2-digit"}), price: live, timestamp: now };
              const last = prev[prev.length-1];
              const sameHour = new Date(last.timestamp).getHours() === new Date(now).getHours();
              const copy = prev.slice();
              if (sameHour) copy[copy.length-1] = point; else copy.push(point);
              return copy.slice(-168);
            });
          }
        } catch {}
      };
      wsRef.current.onerror = () => setApiStatus("❌ WebSocket Fehler");

      intervalRef.current = setInterval(fetchLiveData, 30000);
    })();
    return () => { if (wsRef.current) wsRef.current.close(); if (intervalRef.current) clearInterval(intervalRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // retrain when we have fresh candles
  useEffect(() => {
    if (priceData.length >= 100) {
      trainMLIfPossible().then(updateLivePrediction);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceData.length]);

  // update live prediction when price ticks
  useEffect(() => {
    updateLivePrediction();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPrice]);

  if (loading && !currentPrice) {
    return (
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"70vh" }}>
        <div style={{ color:"white", textAlign:"center" }}>
          <div style={{ marginBottom: 12 }}>Lade Live Solana Daten…</div>
          <div style={{ color:"#9ca3af", fontSize: 12 }}>{apiStatus}</div>
        </div>
      </div>
    );
  }

  const prices = priceData.map(d=>d.price);
  const rsiColor = indicators.rsi < 30 ? "#34d399" : indicators.rsi > 70 ? "#f87171" : "white";

  return (
    <div>
      <div style={{ textAlign:"center", marginBottom: 24 }}>
        <div style={{ display:"flex", gap:12, justifyContent:"center", alignItems:"center", flexWrap:"wrap" }}>
          <h1 style={{ color:"white", fontWeight:800, fontSize:36 }}>Solana Live Analyzer + ML</h1>
          {isLive ? <Wifi color="#34d399" size={28} /> : <WifiOff color="#f87171" size={28} />}
          <button onClick={()=>fetchLiveData()} style={{ background:"#7c3aed", color:"white", padding:"8px 12px", borderRadius:10, display:"flex", alignItems:"center", gap:8, border:"none", cursor:"pointer" }}>
            <RefreshCw size={16} /> Aktualisieren
          </button>
        </div>
        <p style={{ color:"#d1d5db", fontSize:12 }}>{apiStatus} • Letztes Update: {lastUpdate || "Lädt…"}</p>
      </div>

      <Box style={{ marginBottom: 16 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ color:"#d1d5db", fontSize:12, marginBottom:4 }}>SOL/USD {isLive ? "🟢 LIVE" : "🔴 DEMO"}</div>
            <div style={{ color:"white", fontWeight:800, fontSize:40 }}>{currentPrice != null ? `$${currentPrice.toFixed(2)}` : "-"}</div>
            <div style={{ display:"flex", gap:8, marginTop:8, alignItems:"center" }}>
              <span style={{ color: priceChange24h >= 0 ? "#34d399" : "#f87171", fontWeight:700 }}>
                {priceChange24h >= 0 ? "▲" : "▼"} {Math.abs(priceChange24h).toFixed(2)}%
              </span>
              <span style={{ color:"#9ca3af", fontSize:12 }}>24h</span>
            </div>
          </div>
          <Activity color="#a78bfa" size={42} />
        </div>
      </Box>

      <Box style={{ marginBottom: 16, border:"2px solid", borderColor: signal.type === "KAUFEN" ? "#34d399" : signal.type === "VERKAUFEN" ? "#f87171" : "#fbbf24", background: signal.type === "KAUFEN" ? "rgba(16,185,129,0.15)" : signal.type === "VERKAUFEN" ? "rgba(239,68,68,0.15)" : "rgba(234,179,8,0.15)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12 }}>
          {signal.type === "KAUFEN" ? <TrendingUp color="#34d399" size={28}/> : signal.type === "VERKAUFEN" ? <TrendingDown color="#f87171" size={28}/> : <AlertCircle color="#fbbf24" size={28}/>}
          <div>
            <div style={{ color:"white", fontWeight:800, fontSize:24 }}>{signal.type}</div>
            <div style={{ color:"#d1d5db", fontSize:14 }}>Konfidenz: {signal.confidence}% • {signal.score}</div>
          </div>
        </div>
        <div style={{ background:"rgba(0,0,0,0.25)", borderRadius:8, padding:12, color:"white", fontSize:14 }}>
          <div style={{ color:"#d1d5db", fontWeight:700, marginBottom:8 }}>Technische Analyse:</div>
          {signal.signals?.map((s,i)=><div key={i} style={{ marginBottom:4 }}>{s}</div>)}
        </div>
        <div style={{ color:"#9ca3af", fontSize:12, marginTop:8 }}>⚠️ Keine Finanzberatung.</div>
      </Box>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:12, marginBottom:16 }}>
        <Box>
          <div style={{ color:"#d1d5db", fontSize:12, marginBottom:4 }}>RSI (14)</div>
          <div style={{ fontSize:28, fontWeight:800, color: rsiColor }}>{indicators.rsi.toFixed ? indicators.rsi.toFixed(2) : indicators.rsi}</div>
          <div style={{ color:"#9ca3af", fontSize:12, marginTop:4 }}>{indicators.rsi < 30 ? "Überverkauft" : indicators.rsi > 70 ? "Überkauft" : "Neutral"}</div>
        </Box>
        <Box><div style={{ color:"#d1d5db", fontSize:12, marginBottom:4 }}>MA 20</div><div style={{ fontSize:28, fontWeight:800, color:"white" }}>${indicators.ma20.toFixed ? indicators.ma20.toFixed(2) : indicators.ma20}</div></Box>
        <Box><div style={{ color:"#d1d5db", fontSize:12, marginBottom:4 }}>MA 50</div><div style={{ fontSize:28, fontWeight:800, color:"white" }}>${indicators.ma50.toFixed ? indicators.ma50.toFixed(2) : indicators.ma50}</div></Box>
        <Box><div style={{ color:"#d1d5db", fontSize:12, marginBottom:4 }}>MACD</div><div style={{ fontSize:28, fontWeight:800, color: indicators.macd>0 ? "#34d399" : "#f87171" }}>{indicators.macd.toFixed ? indicators.macd.toFixed(2) : indicators.macd}</div></Box>
      </div>

      <Box style={{ marginBottom: 16 }}>
        <h3 style={{ color:"white", fontWeight:800, fontSize:18, marginBottom:12 }}>Preisverlauf (7 Tage) {isLive ? "🟢" : ""}</h3>
        <div style={{ width:"100%", height:360 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={priceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" />
              <XAxis dataKey="time" stroke="#fff" tick={{ fill:"#fff", fontSize:10 }} />
              <YAxis stroke="#fff" tick={{ fill:"#fff", fontSize:12 }} domain={["auto","auto"]} />
              <Tooltip contentStyle={{ backgroundColor:"#1a1a2e", border:"1px solid #ffffff40", borderRadius:8 }} />
              <Legend />
              <Line type="monotone" dataKey="price" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Preis (USD)" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Box>

      <Box>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
          <Brain size={20} color="#a5b4fc" /><div style={{ color:"white", fontWeight:700 }}>KI-Prognose (nächste Stunde)</div>
        </div>
        <div style={{ color:"#d1d5db", fontSize:14, marginBottom:8 }}>
          Status: {mlStatus} • {mlReady ? "bereit" : "nicht bereit"}
        </div>
        <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
          <Box><div style={{ color:"#d1d5db", fontSize:12 }}>Richtung</div><div style={{ color:"white", fontWeight:800, fontSize:22 }}>{mlDirection}</div></Box>
          <Box><div style={{ color:"#d1d5db", fontSize:12 }}>Wahrscheinlichkeit ↑</div><div style={{ color:"white", fontWeight:800, fontSize:22 }}>{mlProba != null ? (mlProba*100).toFixed(1) + "%" : "-"}</div></Box>
          <Box><div style={{ color:"#d1d5db", fontSize:12 }}>Eval-Accuracy (letzte 100)</div><div style={{ color:"white", fontWeight:800, fontSize:22 }}>{(mlMetrics.acc*100).toFixed(1)}%</div></Box>
          <Box><div style={{ color:"#d1d5db", fontSize:12 }}>Brier Score (letzte 100)</div><div style={{ color:"white", fontWeight:800, fontSize:22 }}>{mlMetrics.brier.toFixed(3)}</div></Box>
        </div>
        <div style={{ color:"#9ca3af", fontSize:12, marginTop:8 }}>
          Die KI wird bei neuen Kerzen nachtrainiert und vergleicht Prognose vs. Realität. Modell wird im Browser gespeichert.
        </div>
      </Box>
    </div>
  );
}
