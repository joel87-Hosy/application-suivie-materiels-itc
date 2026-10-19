#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const clientFiles = [path.join(root, 'index.html'), ...walk(path.join(root, 'assets'))
  .filter(file => file.endsWith('.js'))];
const sqlFiles = walk(path.join(root, 'supabase', 'migrations'))
  .filter(file => file.endsWith('.sql'));

const rpcNames = new Set();
const tableNames = new Set();
const authMethods = new Set();
const edgePaths = new Set();
for (const file of clientFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\brpc\(\s*(['"])([a-z_][a-z0-9_]*)\1/gi)) rpcNames.add(match[2]);
  for (const match of source.matchAll(/\bbind\([\s\S]{0,500}?['"]([a-z_][a-z0-9_]*)['"]/gi)) {
    if (match[1].startsWith('create_manager_') || match[1].startsWith('receive_manager_')) rpcNames.add(match[1]);
  }
  for (const match of source.matchAll(/\.from\(\s*(['"])([a-z_][a-z0-9_]*)\1/gi)) tableNames.add(match[2]);
  for (const match of source.matchAll(/\.auth\.([a-z][a-z0-9_]*)/gi)) authMethods.add(match[1]);
  for (const match of source.matchAll(/\/functions\/v1\/([a-z0-9_-]+)/gi)) edgePaths.add(match[1]);
}

const sqlFunctionNames = new Set();
for (const file of sqlFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)/gi)) sqlFunctionNames.add(match[1]);
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function section(title, values) {
  console.log(`\n${title} (${values.length})`);
  for (const value of values) console.log(`  ${value}`);
}

console.log(`Client files scanned: ${clientFiles.length}`);
console.log(`SQL migrations scanned: ${sqlFiles.length}`);
section('RPC names found at call sites', [...rpcNames].sort());
section('Tables accessed with string literals', [...tableNames].sort());
section('Supabase Auth methods', [...authMethods].sort());
section('Supabase Edge Function paths', [...edgePaths].sort());
section('SQL function names defined in migrations', [...sqlFunctionNames].sort());

