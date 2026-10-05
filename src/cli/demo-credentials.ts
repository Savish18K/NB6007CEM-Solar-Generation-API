import { loadConfig, loadDotEnvIfPresent } from '../config.js';
import { deriveDeviceSecret } from '../auth/secrets.js';
import { buildInstallations, buildUsers } from '../seed/dataset.js';

// Prints the demo logins for the seeded accounts, to hand to markers. Run it with the same environment
// values as the deployment, and don't commit the output.
loadDotEnvIfPresent();
const config = loadConfig();
const users = buildUsers();
const installations = buildInstallations();
const sampleDevices = ['si-0001', 'si-0010', 'si-0055'].map((id) => installations.find((i) => i.installation_id === id)!);

console.log('Demo credentials for the seeded (synthetic) accounts. Get a token with POST /tokens using HTTP Basic auth.\n');
console.log('SLSEA users (read-clients):');
for (const u of users) {
  const where = u.role === 'national' ? 'national' : u.role === 'provincial' ? `province ${u.province_id}` : `district ${u.district_id}`;
  console.log(`  ${u.username.padEnd(18)} password: ${config.SEED_USER_PASSWORD}   (${u.role}, ${where})`);
}
console.log('\nMeters (write-clients); the identifier is the meter_id:');
for (const i of sampleDevices) {
  console.log(`  ${i.meter_id}  secret: ${deriveDeviceSecret(config.DEVICE_SECRET_SEED, i.meter_id)}   (installation ${i.installation_id}, district ${i.district_id})`);
}
console.log('\nBack-office administrator (installation CRUD):');
console.log(`  ${config.ADMIN_CLIENT_ID}  secret: ${config.ADMIN_CLIENT_SECRET}`);
