export default async function handler(req, res) {
  try {
    const now = new Date().toISOString();
    console.log("[CRON] Worker läuft – Zeit:", now);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, time: now });
  } catch (err) {
    console.error("[CRON] Fehler im Worker:", err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
