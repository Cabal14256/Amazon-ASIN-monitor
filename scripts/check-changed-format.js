#!/usr/bin/env node

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SUPPORTED_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.less',
  '.md',
  '.scss',
  '.ts',
  '.tsx',
  '.vue',
  '.yaml',
  '.yml',
]);

const IGNORED_DIRECTORIES = new Set([
  '.umi',
  '.umi-production',
  'backups',
  'coverage',
  'dist',
  'node_modules',
]);

function normalizeRepositoryPath(filePath) {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}

function isSupportedFile(filePath) {
  const normalizedPath = normalizeRepositoryPath(filePath);
  if (!normalizedPath) return false;

  const segments = normalizedPath.split('/');
  if (
    segments.slice(0, -1).some((segment) => IGNORED_DIRECTORIES.has(segment))
  ) {
    return false;
  }

  return SUPPORTED_EXTENSIONS.has(
    path.posix.extname(normalizedPath).toLowerCase(),
  );
}

function parseChangedFiles(output) {
  return String(output || '')
    .split('\0')
    .map(normalizeRepositoryPath)
    .filter(isSupportedFile);
}

function validateCommitSha(value, label) {
  const sha = String(value || '').trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    throw new Error(`${label} must be a Git commit SHA`);
  }
  return sha;
}

function listChangedFiles(baseSha, headSha, runner = spawnSync) {
  const base = validateCommitSha(baseSha, 'CHANGED_FILES_BASE_SHA');
  const head = validateCommitSha(headSha, 'CHANGED_FILES_HEAD_SHA');
  const result = runner(
    'git',
    [
      'diff',
      '--no-renames',
      '--name-only',
      '--diff-filter=AM',
      '-z',
      `${base}...${head}`,
      '--',
    ],
    { encoding: 'utf8' },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `git diff failed: ${
        String(result.stderr || '').trim() || 'unknown error'
      }`,
    );
  }

  return parseChangedFiles(result.stdout);
}

function checkFormatting(files, runner = spawnSync) {
  if (files.length === 0) {
    console.log('No added or modified Prettier-supported files to check.');
    return 0;
  }

  console.log(`Checking formatting for ${files.length} changed file(s).`);
  const prettierCli = require.resolve('prettier/bin-prettier.js');
  const result = runner(
    process.execPath,
    [prettierCli, '--check', '--ignore-unknown', ...files],
    { stdio: 'inherit' },
  );

  if (result.error) throw result.error;
  return Number.isInteger(result.status) ? result.status : 1;
}

function main() {
  const baseSha = process.env.CHANGED_FILES_BASE_SHA;
  const headSha = process.env.CHANGED_FILES_HEAD_SHA;
  const files = listChangedFiles(baseSha, headSha);
  process.exitCode = checkFormatting(files);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Changed-file format check failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  checkFormatting,
  isSupportedFile,
  listChangedFiles,
  normalizeRepositoryPath,
  parseChangedFiles,
  validateCommitSha,
};
