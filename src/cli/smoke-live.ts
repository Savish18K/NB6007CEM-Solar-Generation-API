// Checks a live deployment end to end and prints PASS/FAIL for each check.
//   SMOKE_PASSWORD=<SEED_USER_PASSWORD> npm run smoke:live -- https://<project>.vercel.app
// Set SMOKE_METER and SMOKE_DEVICE_SECRET as well to include the device write checks.
const base = (process.argv[2] ?? process.env.SMOKE_BASE_URL ?? '').replace(/\/$/, '');
const password = process.env.SMOKE_PASSWORD ?? '';
if (!base || !password) {
  console.error('usage: SMOKE_PASSWORD=... npm run smoke:live -- https://<project>.vercel.app');
  process.exit(2);
}

type Res = { status: number; headers: Headers; body: any; text: string };
async function call(method: string, path: string, headers: Record<string, string> = {}, body?: unknown): Promise<Res> {
  const res = await fetch(base + path, {
    method,
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: res.status, headers: res.headers, body: parsed, text };
}
const basic = (id: string, secret: string) => ({ Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` });
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let failures = 0;
async function check(name: string, fn: () => Promise<string | void>) {
  try {
    const detail = await fn();
    console.log(`PASS  ${name}${detail ? `  (${detail})` : ''}`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL  ${name}  -> ${(err as Error).message}`);
  }
}
function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const isErrorBody = (b: any) => b && typeof b.code === 'number' && typeof b.message === 'string' && typeof b.description === 'string' && Array.isArray(b.error);

console.log(`Smoke test of ${base} at ${new Date().toISOString()}\n`);
let national = '';

await check('served over HTTPS', async () => { expect(base.startsWith('https://'), 'base URL is not https://'); });
await check('GET /health reports the database up', async () => {
  const r = await call('GET', '/health');
  expect(r.status === 200 && r.body?.database === 'ok', `status ${r.status} ${r.text}`);
});
await check('Swagger UI and OpenAPI document are live', async () => {
  const spec = await call('GET', '/openapi.json');
  expect(spec.status === 200 && String(spec.body?.openapi).startsWith('3.1'), `openapi.json ${spec.status}`);
  const docs = await fetch(`${base}/docs/`, { headers: { Accept: 'text/html' } });
  expect(docs.status === 200 && (docs.headers.get('content-type') ?? '').includes('text/html'), `/docs ${docs.status}`);
  return `${Object.keys(spec.body.paths).length} paths documented`;
});
await check('no token -> 401 with WWW-Authenticate and the error body', async () => {
  const r = await call('GET', '/provinces');
  expect(r.status === 401 && r.headers.get('www-authenticate')?.startsWith('Bearer') && isErrorBody(r.body), `status ${r.status}`);
});
await check('national analyst obtains a token (POST /tokens, Basic auth)', async () => {
  const r = await call('POST', '/tokens', basic('national.analyst', password));
  expect(r.status === 200 && r.body?.token_type === 'Bearer', `status ${r.status} ${r.text}`);
  national = r.body.access_token;
  return `scope ${r.body.scope}`;
});
await check('seed data present: 9 provinces, 25 districts, >=20 substations, >=200 installations', async () => {
  const counts = await Promise.all(['/provinces', '/districts', '/grid-substations', '/installations'].map(async (p) => (await call('GET', `${p}?page-size=1`, bearer(national))).body?.count));
  expect(counts[0] === 9 && counts[1] === 25 && counts[2] >= 20 && counts[3] >= 200, `counts ${counts.join('/')}`);
  return counts.join(' / ');
});
await check('installation composite embeds the latest reading', async () => {
  const r = await call('GET', '/installations/si-0001', bearer(national));
  expect(r.status === 200 && r.body?.last_reading?.timestamp, `status ${r.status}`);
  const ageMin = (Date.now() - Date.parse(r.body.last_reading.timestamp)) / 60_000;
  return `latest reading ${r.body.last_reading.timestamp} (${ageMin.toFixed(0)} min old)`;
});
await check('history: >= 1 week of readings, pagination links, both sort orders', async () => {
  const desc = await call('GET', '/installations/si-0001/readings?page-size=2', bearer(national));
  const asc = await call('GET', '/installations/si-0001/readings?page-size=2&sort=timestamp', bearer(national));
  expect(desc.status === 200 && desc.body.count >= 7 * 96, `count ${desc.body?.count}`);
  expect(desc.body.next && desc.body.previous === null, 'links wrong on page 1');
  const page2 = await call('GET', desc.body.next, bearer(national));
  expect(page2.status === 200 && page2.body.previous, 'next link did not resolve');
  expect(Date.parse(desc.body.results[0].timestamp) > Date.parse(asc.body.results[0].timestamp), 'sort orders not distinct');
  return `${desc.body.count} readings`;
});
await check('time-window and jurisdiction filtering', async () => {
  const to = new Date(Math.floor(Date.now() / 900_000) * 900_000);
  const from = new Date(to.getTime() - 3_600_000);
  const r = await call('GET', `/districts/lk-11/readings?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`, bearer(national));
  expect(r.status === 200 && r.body.results.every((x: any) => Date.parse(x.timestamp) >= from.getTime() && Date.parse(x.timestamp) < to.getTime()), `status ${r.status}`);
  const f = await call('GET', '/installations?district-id=lk-11&page-size=1', bearer(national));
  expect(f.status === 200 && f.body.count > 0, 'district filter returned nothing');
  return `${r.body.count} readings in lk-11 in the last hour`;
});
await check('conditional GET -> 304 with an empty body', async () => {
  const first = await call('GET', '/provinces/lk-1', bearer(national));
  const again = await call('GET', '/provinces/lk-1', { ...bearer(national), 'If-None-Match': first.headers.get('etag') ?? '' });
  expect(again.status === 304 && again.text === '', `status ${again.status}`);
});
await check('district generation summary', async () => {
  const r = await call('GET', '/districts/lk-11/generation-summary', bearer(national));
  expect(r.status === 200 && typeof r.body?.today_energy_kwh === 'number', `status ${r.status}`);
  return `${r.body.current_total_power_kw} kW now, ${r.body.today_energy_kwh} kWh today, ${r.body.installations_reporting}/${r.body.installations_total} reporting`;
});
await check('jurisdiction: Colombo district analyst is refused Kandy (403)', async () => {
  const t = await call('POST', '/tokens', basic('colombo.analyst', password));
  const r = await call('GET', '/districts/lk-21/readings', bearer(t.body.access_token));
  expect(r.status === 403 && r.body?.code === 403002, `status ${r.status}`);
});
await check('read-only analyst cannot write readings (403)', async () => {
  const r = await call('POST', '/installations/si-0001/readings', bearer(national), { timestamp: new Date().toISOString(), power_kw: 1, energy_kwh: 1, voltage_v: 230 });
  expect(r.status === 403 && r.body?.code === 403001, `status ${r.status}`);
});
await check('error contract on an unknown resource (404)', async () => {
  const r = await call('GET', '/installations/si-9999999', bearer(national));
  expect(r.status === 404 && isErrorBody(r.body), `status ${r.status}`);
});

if (process.env.SMOKE_METER && process.env.SMOKE_DEVICE_SECRET) {
  await check('device ingests a reading: 201 + Location that resolves', async () => {
    const t = await call('POST', '/tokens', basic(process.env.SMOKE_METER!, process.env.SMOKE_DEVICE_SECRET!));
    expect(t.status === 200, `device token ${t.status}`);
    const inst = t.body.scope === 'installation-write' ? await (async () => {
      const lookup = await call('GET', `/installations?page-size=500`, bearer(national));
      return lookup.body.results.find((i: any) => i.meter_id === process.env.SMOKE_METER)?.installation_id;
    })() : null;
    expect(inst, 'installation for meter not found');
    const last = await call('GET', `/installations/${inst}/last-known-reading`, bearer(national));
    const r = await call('POST', `/installations/${inst}/readings`, bearer(t.body.access_token), {
      timestamp: new Date(Date.now() - 60_000).toISOString(), power_kw: last.body.power_kw, energy_kwh: last.body.energy_kwh + 0.001, voltage_v: 231,
    });
    expect(r.status === 201 && r.headers.get('location'), `status ${r.status} ${r.text}`);
    const g = await call('GET', r.headers.get('location')!, bearer(national));
    expect(g.status === 200, `Location GET ${g.status}`);
    const other = await call('POST', `/installations/${inst === 'si-0002' ? 'si-0003' : 'si-0002'}/readings`, bearer(t.body.access_token), { timestamp: new Date().toISOString(), power_kw: 1, energy_kwh: 1, voltage_v: 230 });
    expect(other.status === 403, `cross-installation write returned ${other.status}`);
    return `created ${r.headers.get('location')}`;
  });
} else {
  console.log('SKIP  device write checks (set SMOKE_METER and SMOKE_DEVICE_SECRET to include them)');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
