export default async function handler(req, res) {
  console.log("Worker läuft! Zeit:", new Date().toISOString());
  return res.status(200).json({ ok: true, time: new Date().toISOString() });
}
