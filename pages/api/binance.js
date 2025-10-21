export default async function handler(req, res) {
  const { path } = req.query;
  if (!path) { res.setHeader("Access-Control-Allow-Origin","*"); res.status(400).json({error:"missing_path"}); return; }
  try {
    const up = await fetch(`https://api.binance.com/${path}`, { headers: { Accept: "application/json" }, next:{revalidate:0} });
    const body = await up.text();
    res.setHeader("Access-Control-Allow-Origin","*");
    res.setHeader("Content-Type", up.headers.get("content-type") || "application/json");
    res.status(up.status).send(body);
  } catch (e) {
    res.setHeader("Access-Control-Allow-Origin","*");
    res.status(500).json({error:"proxy_failed"});
  }
}
