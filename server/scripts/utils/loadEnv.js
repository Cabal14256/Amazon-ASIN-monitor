const fs = require('fs');
const path = require('path');

function parseEnvContent(content) {
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const cleaned = line.startsWith('export ') ? line.slice(7) : line;
    const separatorIndex = cleaned.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = cleaned.slice(0, separatorIndex).trim();
    let value = cleaned.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function loadEnv(envPath) {
  const resolvedPath = envPath
    ? path.resolve(envPath)
    : path.resolve(__dirname, '../.env');

  if (!fs.existsSync(resolvedPath)) {
    return { loaded: false, path: resolvedPath, usedDotenv: false };
  }

  try {
    // Prefer dotenv when available for full .env parsing support.
    // eslint-disable-next-line global-require
    const dotenv = require('dotenv');
    dotenv.config({ path: resolvedPath });
    return { loaded: true, path: resolvedPath, usedDotenv: true };
  } catch (error) {
    const content = fs.readFileSync(resolvedPath, 'utf8');
    parseEnvContent(content);
    return { loaded: true, path: resolvedPath, usedDotenv: false };
  }
}

module.exports = { loadEnv };
