import * as tf from "@tensorflow/tfjs";

const STORAGE_KEY = "solana_ml_model_v1";
const META_KEY = "solana_ml_meta_v1";

// Feature builder: from an array of candles [{price, ...}] produce X (features) and y (label: next return sign)
export function buildDataset(prices, indicators, window=24) {
  if (!prices || prices.length < window + 2) return null;
  const X = [];
  const y = [];
  for (let i = window; i < prices.length - 1; i++) {
    const slice = prices.slice(i - window, i + 1); // window+1 points
    const px = slice.map(v => v);
    const ret = (prices[i+1] - prices[i]) / prices[i]; // next return
    const label = ret > 0 ? 1 : 0;

    // simple features: normalized prices in window, last RSI/MA/MACD
    const lastInd = indicators[i] || { rsi: 50, ma20: prices[i], ma50: prices[i], macd: 0 };
    const feats = [
      ...normalize(px),
      lastInd.rsi/100,
      (lastInd.ma20 || prices[i]) / prices[i],
      (lastInd.ma50 || prices[i]) / prices[i],
      (lastInd.macd || 0)
    ];
    X.push(feats);
    y.push(label);
  }
  return { X, y };
}

function normalize(arr) {
  const last = arr[arr.length - 1];
  return arr.map(v => (v / last) - 1); // relative to last price
}

export function buildModel(inputDim) {
  const m = tf.sequential();
  m.add(tf.layers.dense({ units: 64, activation: "relu", inputShape: [inputDim] }));
  m.add(tf.layers.dropout({ rate: 0.2 }));
  m.add(tf.layers.dense({ units: 32, activation: "relu" }));
  m.add(tf.layers.dropout({ rate: 0.2 }));
  m.add(tf.layers.dense({ units: 1, activation: "sigmoid" })); // probability up
  m.compile({ optimizer: tf.train.adam(0.001), loss: "binaryCrossentropy", metrics: ["accuracy"] });
  return m;
}

export async function trainOrUpdate(model, X, y, epochs=8, batchSize=32) {
  const xs = tf.tensor2d(X);
  const ys = tf.tensor2d(y, [y.length, 1]);
  const hist = await model.fit(xs, ys, { epochs, batchSize, verbose: 0, shuffle: true });
  xs.dispose(); ys.dispose();
  return hist.history;
}

export async function predictProba(model, feat) {
  const x = tf.tensor2d([feat]);
  const p = model.predict(x);
  const data = await p.data();
  x.dispose(); p.dispose();
  return data[0]; // probability of "up"
}

export async function saveModel(model, meta) {
  try {
    await model.save(tf.io.browserLocalStorage(STORAGE_KEY));
    localStorage.setItem(META_KEY, JSON.stringify(meta));
    return true;
  } catch {
    return false;
  }
}

export async function loadModel() {
  try {
    const m = await tf.loadLayersModel(tf.io.browserLocalStorage(STORAGE_KEY));
    const meta = JSON.parse(localStorage.getItem(META_KEY) || "{}");
    return { model: m, meta };
  } catch {
    return { model: null, meta: {} };
  }
}
