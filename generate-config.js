// Script to generate wrangler configuration with environment variables
require('dotenv').config();
const fs = require('fs');
const path = require('path');

function generateWranglerConfig() {
  // Worker script name on Cloudflare. Changing this creates a new Worker on deploy;
  // existing installs should set WORKER_NAME in .env to keep their current name.
  const workerName = process.env.WORKER_NAME || 'stfc-tools';

  const configTemplate = {
    "$schema": "node_modules/wrangler/config-schema.json",
    "name": workerName,
    "main": "src/index.ts",
    "compatibility_date": "2025-07-26",
    "compatibility_flags": [
      "global_fetch_strictly_public"
    ],
    "assets": {
      "directory": "./public"
    },
    "observability": {
      "enabled": true
    },
    "vars": {
      "ENVIRONMENT": "development"
    },
    "triggers": {
      "crons": [
        "*/5 * * * *",
        "0 */6 * * *",
        "0 6 * * *",
        "30 * * * *"
      ]
    },
    "kv_namespaces": [],
    "d1_databases": [
      {
        "binding": "STFC_DB",
        "database_name": process.env.D1_DATABASE_NAME || "stfc-officers",
        "database_id": process.env.D1_DATABASE_ID || "4db56efc-e108-466e-9c82-22e892ee2baa"
      }
    ],
    "r2_buckets": [],
    "durable_objects": {
      "bindings": [
        {
          "name": "DISCORD_GATEWAY",
          "class_name": "DiscordGateway"
        },
        {
          "name": "STFC_SESSION",
          "class_name": "StfcSession"
        }
      ]
    },
    "migrations": [
      {
        "tag": "v1",
        "new_sqlite_classes": ["DiscordGateway"]
      },
      {
        "tag": "v2",
        "new_sqlite_classes": ["StfcSession"]
      }
    ]
  };

  // Optional CPU limit (Paid Workers only)
  const cpuMs = Number(process.env.CPU_MS);
  
  if (!Number.isNaN(cpuMs) && cpuMs > 0) {
    configTemplate.limits = {
      cpu_ms: cpuMs
    };
  }

  if (process.env.WORKER_URL) {
    configTemplate.vars.WORKER_URL = process.env.WORKER_URL;
  }

  if (process.env.DISCORD_APPLICATION_ID) {
    configTemplate.vars.DISCORD_APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
  }

  if (process.env.KV_NAMESPACE_ID) {
    const kvNamespace = {
      "binding": "SYSTEM_DATA",
      "id": process.env.KV_NAMESPACE_ID
    };

    if (process.env.KV_NAMESPACE_PREVIEW_ID && process.env.KV_NAMESPACE_PREVIEW_ID !== 'preview-id-placeholder') {
      kvNamespace.preview_id = process.env.KV_NAMESPACE_PREVIEW_ID;
    }

    configTemplate.kv_namespaces.push(kvNamespace);
  }

  if (process.env.R2_BUCKET_NAME) {
    configTemplate.r2_buckets.push({
      "binding": "VERIFICATION_ASSETS",
      "bucket_name": process.env.R2_BUCKET_NAME
    });
  }

  // Optional Workers AI — only when explicitly enabled (avoids surprise usage).
  // Also requires guild dm_ai_enabled + env DM_AI_ENABLED=true at runtime.
  if (String(process.env.ENABLE_WORKERS_AI || '').toLowerCase() === 'true') {
    configTemplate.ai = { binding: 'AI' };
    console.log('📝 Workers AI binding enabled (ENABLE_WORKERS_AI=true)');
  }

  if (process.env.DM_AI_ENABLED) {
    configTemplate.vars.DM_AI_ENABLED = process.env.DM_AI_ENABLED;
  }
  if (process.env.DM_AI_DAILY_LIMIT) {
    configTemplate.vars.DM_AI_DAILY_LIMIT = process.env.DM_AI_DAILY_LIMIT;
  }
  if (process.env.ADMIN_WEB_ORIGIN) {
    configTemplate.vars.ADMIN_WEB_ORIGIN = process.env.ADMIN_WEB_ORIGIN;
  }
  if (process.env.DISCORD_CLIENT_ID) {
    configTemplate.vars.DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
  }

  const outputPath = path.join(__dirname, 'wrangler.json');
  fs.writeFileSync(outputPath, JSON.stringify(configTemplate, null, 2));

  // Wrangler prefers wrangler.jsonc over wrangler.json; a leftover empty
  // jsonc (common from editors / old templates) causes ValueExpected parse errors.
  const jsoncPath = path.join(__dirname, 'wrangler.jsonc');
  if (fs.existsSync(jsoncPath)) {
    fs.unlinkSync(jsoncPath);
    console.log('🧹 Removed wrangler.jsonc so Wrangler uses generated wrangler.json');
  }

  console.log('✅ Generated wrangler.json with environment-specific configuration');
  console.log(`📝 Worker name: ${workerName}${process.env.WORKER_NAME ? '' : ' (default; set WORKER_NAME to override)'}`);
  console.log(`📝 KV Namespace ID: ${process.env.KV_NAMESPACE_ID || 'Not set'}`);
  console.log(`📝 R2 Bucket: ${process.env.R2_BUCKET_NAME || 'Not set'}`);
}

if (require.main === module) {
  generateWranglerConfig();
}

module.exports = { generateWranglerConfig };
