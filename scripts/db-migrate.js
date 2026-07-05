#!/usr/bin/env node
require('dotenv').config();
const { execSync } = require('child_process');

const dbName = process.env.D1_DATABASE_NAME || 'stfc-officers';
const target = process.argv.includes('--local') ? '--local' : '--remote';
const file = 'migrations/001_guild_schema.sql';

console.log(`Applying ${file} to D1 database "${dbName}" (${target})...`);
execSync(`npx wrangler d1 execute ${dbName} ${target} --file=${file}`, { stdio: 'inherit' });
