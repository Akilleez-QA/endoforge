import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EX_CONFIG = 78;
export const SUBSCRIPTIONS = Object.freeze(['max', 'pro', 'team']);
export const CACHE_MS = 30000;
export const MANAGED_SETTINGS = '/etc/claude-code/managed-settings.json';
const billingVariables = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_FOUNDRY_API_KEY', 'AWS_BEARER_TOKEN_BEDROCK', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
  'ANTHROPIC_PROFILE', 'ANTHROPIC_FEDERATION_RULE_ID'];
const off = new Set(['', '0', 'false', 'no', 'off']);
const bareOn = value => typeof value === 'string' && !off.has(value.trim().toLowerCase());
const strippedVariables = [...billingVariables, 'CLAUDE_CODE_SIMPLE', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_BEDROCK_BASE_URL', 'ANTHROPIC_VERTEX_BASE_URL', 'ANTHROPIC_VERTEX_PROJECT_ID', 'ANTHROPIC_FOUNDRY_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS',
  'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_REFRESH_TOKEN', 'CLAUDE_CODE_SKIP_BEDROCK_AUTH', 'CLAUDE_CODE_SKIP_VERTEX_AUTH', 'CLAUDE_CODE_SKIP_FOUNDRY_AUTH', 'CLAUDE_CODE_API_KEY_HELPER_TTL_MS'];
const strippedPattern = /^(ANTHROPIC_|CLAUDE_CODE_USE_|CLAUDE_CODE_OAUTH_|CLAUDE_CODE_SKIP_|CLAUDE_CODE_API_KEY|CLAUDE_CODE_SIMPLE$|AWS_BEARER_TOKEN_BEDROCK$)/;
const helperKeys = ['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport', 'otelHeadersHelper'];
const cache = new Map();

export class SubscriptionRefused extends Error {
  constructor(reason) {
    super(`claude -p refused (exit 78): ${reason}. Model calls must run on a claude.ai subscription login, never API billing.`);
    this.name = 'SubscriptionRefused';
    this.reason = reason;
    this.exitCode = EX_CONFIG;
    this.code = 'EX_CONFIG';
  }
}

const present = value => typeof value === 'string' && value !== '';
const readJson = path => {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return { absent: true };
    return { error: `${path} is unreadable (${error.code ?? 'error'})` };
  }
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: `${path} is not a JSON object` };
    return { value };
  } catch { return { error: `${path} is not valid JSON` }; }
};

function settingsProblem(path) {
  const { value, error, absent } = readJson(path);
  if (absent) return null;
  if (error) return error;
  return settingsValueProblem(path, value);
}

function settingsValueProblem(path, value) {
  const helper = helperKeys.find(key => value[key] !== undefined);
  if (helper) return `${path} sets ${helper}`;
  if (value.forceLoginMethod !== undefined && value.forceLoginMethod !== 'claudeai') return `${path} sets forceLoginMethod ${JSON.stringify(value.forceLoginMethod)}`;
  if (value.env !== undefined && (typeof value.env !== 'object' || value.env === null)) return `${path} has a malformed env block`;
  const variable = Object.keys(value.env ?? {}).find(name => name === 'CLAUDE_CODE_SIMPLE' ? bareOn(value.env[name]) : billingVariables.includes(name) || strippedPattern.test(name));
  if (variable) return `${path} sets ${variable} in env`;
  return null;
}

function inlineSettingsProblem(text, cwd) {
  if (!present(text)) return '--settings has no value';
  if (text.trimStart().startsWith('{')) {
    let value;
    try { value = JSON.parse(text); } catch { return '--settings JSON is not valid JSON'; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '--settings JSON is not a JSON object';
    return settingsValueProblem('--settings', value);
  }
  const path = resolve(cwd ?? process.cwd(), text);
  const { value, error, absent } = readJson(path);
  if (absent) return `--settings ${path} is unreadable (ENOENT)`;
  if (error) return `--settings ${error}`;
  return settingsValueProblem(`--settings ${path}`, value);
}

export function argumentProblem(args = [], cwd) {
  const list = Array.isArray(args) ? args.map(String) : [];
  for (let i = 0; i < list.length; i += 1) {
    const arg = list[i], at = arg.indexOf('='), flag = arg.startsWith('--') && at > 0 ? arg.slice(0, at) : arg;
    if (flag === '--bare') return '--bare never reads the claude.ai login (it authenticates only with ANTHROPIC_API_KEY or an apiKeyHelper), so it can bill only through an API key';
    if (flag === '--settings') {
      const problem = inlineSettingsProblem(flag === arg ? list[i + 1] : arg.slice(at + 1), cwd);
      if (problem) return problem;
      if (flag === arg) i += 1;
    }
  }
  return null;
}

function credentialProblem(configDir) {
  const path = join(configDir, '.credentials.json');
  const { value, error, absent } = readJson(path);
  if (absent) return { problem: `no claude.ai login in ${configDir} (.credentials.json is missing)` };
  if (error) return { problem: error };
  const oauth = value.claudeAiOauth;
  if (!oauth || typeof oauth !== 'object') return { problem: `${path} holds no claude.ai OAuth login` };
  if (!present(oauth.accessToken) && !present(oauth.refreshToken)) return { problem: `${path} holds no OAuth token` };
  if (!Array.isArray(oauth.scopes) || !oauth.scopes.includes('user:inference')) return { problem: `${path} lacks the user:inference scope` };
  if (!SUBSCRIPTIONS.includes(oauth.subscriptionType)) return { problem: `${path} records subscription type ${JSON.stringify(oauth.subscriptionType ?? null)}, not one of ${SUBSCRIPTIONS.join(', ')}` };
  return { subscriptionType: oauth.subscriptionType };
}

function accountProblem(path) {
  const { value, error, absent } = readJson(path);
  if (absent) return null;
  if (error) return error;
  if (value.primaryApiKey !== undefined) return `${path} stores an API key`;
  const billing = value.oauthAccount?.billingType;
  if (billing !== undefined && !(typeof billing === 'string' && billing.includes('subscription'))) return `${path} records billing type ${JSON.stringify(billing)}`;
  return null;
}

export function locate({ env = process.env, configDir, cwd } = {}) {
  const home = present(env.HOME) ? env.HOME : homedir();
  const explicit = configDir ?? (present(env.CLAUDE_CONFIG_DIR) ? env.CLAUDE_CONFIG_DIR : null);
  const dir = resolve(explicit ?? join(home, '.claude'));
  return { configDir: dir, account: explicit ? join(dir, '.claude.json') : join(home, '.claude.json'), cwd: cwd ? resolve(cwd) : null };
}

function prove({ env, configDir, account, cwd, managedSettings }) {
  const variable = billingVariables.find(name => present(env[name]));
  if (variable) return { ok: false, reason: `${variable} is set in the launch environment` };
  if (bareOn(env.CLAUDE_CODE_SIMPLE)) return { ok: false, reason: 'CLAUDE_CODE_SIMPLE is on in the launch environment, which is --bare: it never reads the claude.ai login, so it can bill only through an API key' };
  const settings = [join(configDir, 'settings.json'), join(configDir, 'settings.local.json'), managedSettings,
    ...(cwd ? [join(cwd, '.claude', 'settings.json'), join(cwd, '.claude', 'settings.local.json')] : [])].filter(Boolean);
  for (const path of settings) {
    const problem = settingsProblem(path);
    if (problem) return { ok: false, reason: problem };
  }
  const credential = credentialProblem(configDir);
  if (credential.problem) return { ok: false, reason: credential.problem };
  const problem = accountProblem(account);
  if (problem) return { ok: false, reason: problem };
  return { ok: true, configDir, subscriptionType: credential.subscriptionType };
}

export function subscriptionProof({ env = process.env, configDir, cwd, managedSettings = MANAGED_SETTINGS, now = Date.now(), args } = {}) {
  const where = locate({ env, configDir, cwd });
  const refused = argumentProblem(args, where.cwd);
  if (refused) return Object.freeze({ ok: false, reason: refused });
  const key = JSON.stringify([where, managedSettings, billingVariables.map(name => present(env[name])), bareOn(env.CLAUDE_CODE_SIMPLE)]);
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.result;
  const result = Object.freeze(prove({ env, ...where, managedSettings }));
  cache.set(key, { at: now, result });
  return result;
}

export function requireSubscription(options = {}) {
  const proof = subscriptionProof(options);
  if (!proof.ok) throw new SubscriptionRefused(proof.reason);
  return proof;
}

export const strippedNames = (env = {}) => [...new Set([...strippedVariables, ...Object.keys(env).filter(name => strippedPattern.test(name))])].sort();

export function subscriptionEnvironment(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !strippedPattern.test(name) && !strippedVariables.includes(name)));
}

export const unsetArguments = (env = process.env) => ['env', ...strippedNames(env).flatMap(name => ['-u', name])];

export const isClaudeCommand = command => typeof command === 'string' && /(^|\/)claude$/.test(command);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--config-dir');
  const proof = subscriptionProof({ configDir: at > 0 ? process.argv[at + 1] : undefined, cwd: process.cwd() });
  process.stdout.write(`${JSON.stringify(proof)}\n`);
  if (!proof.ok) process.stderr.write(`${new SubscriptionRefused(proof.reason).message}\n`);
  process.exitCode = proof.ok ? 0 : EX_CONFIG;
}
