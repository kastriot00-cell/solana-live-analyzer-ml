import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-storage";  // wichtig für localstorage-Modelle

const STORAGE_KEY = "solana_ml_model_v1";
const META_KEY = "solana_ml_meta_v1";

// Feature builder: from an array of candles [{price,...}] produce X (features) and y (label: next return sign)
export function buildDataset(prices, indicators, window = 24) {
  if (!prices || prices.length < window + 2) return null;
  const X = [];
  const y = [];

  for (let i = window; i < prices.length - 1; i++) {
    const slice = prices.slice(i - window, i + 1);
    const px = slice.map(v => v.price);
    const ret = (prices[i + 1].price - prices[i].price) / prices[i].price; // next return
    const label = ret > 0 ? 1 : 0;

    const lastInd = indicators[i];
    const feats = [
      normalize(px),
      lastInd.rsi || 0,
      lastInd.ma20 || prices[i].price,
      lastInd.ma50 || prices[i].price,
      lastInd.macd || 0
    ];
    X.push(feats.flat());
    y.push(label);
  }

  return { X: tf.tensor2d(X), y: tf.tensor1d(y, "int32") };
}

function normalize(arr) {
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  return arr.map(v => (v - min) / (max - min + 1e-6));
}

// Model speichern
export async function saveModel(model, meta = {}) {
  await model.save(`localstorage://${STORAGE_KEY}`);
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

// Model laden
export async function loadModel() {
  try {
    const model = await tf.loadLayersModel(`localstorage://${STORAGE_KEY}`);
    const meta = JSON.parse(localStorage.getItem(META_KEY)) || {};
    return { model, meta };
  } catch (err) {
    console.warn("Kein gespeichertes Modell gefunden:", err.message);
    return null;
  }
}
