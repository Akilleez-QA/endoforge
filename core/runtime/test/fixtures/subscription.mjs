import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const syntheticLogin = (overrides = {}) => ({ claudeAiOauth: { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', expiresAt: 0, scopes: ['user:inference', 'user:profile'], subscriptionType: 'max', ...overrides } });

export function subscribedConfig(configDir, overrides) {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, '.credentials.json'), JSON.stringify(syntheticLogin(overrides)), { mode: 0o600 });
  return configDir;
}

export function subscribedHome(home, overrides) {
  subscribedConfig(join(home, '.claude'), overrides);
  return home;
}
