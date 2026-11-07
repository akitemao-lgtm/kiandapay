// Chamado pelo Render Cron Job (render.yaml → kiandapay-cron) a cada 5 minutos.
// Expira pedidos, envia lembretes e repete o Purchase do Meta que tenha falhado.
const url = process.env.CRON_URL;
const secret = process.env.CRON_SECRET;
if (!url || !secret) {
  console.error("CRON_URL e CRON_SECRET são obrigatórios");
  process.exit(1);
}

try {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(60_000),
  });
  console.log(res.status, await res.text());
  process.exit(res.ok ? 0 : 1);
} catch (e) {
  console.error("Falha ao chamar o cron:", e);
  process.exit(1);
}
