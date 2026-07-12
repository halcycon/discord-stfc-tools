// Script to generate wrangler configuration with environment variables
require('dotenv').config();
const fs = require('fs');
const path = require('path');

function generateWranglerConfig() {
  const configTemplate = {
    "$schema": "node_modules/wrangler/config-schema.json",
    "name": "stfc-tools",
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
    "limits": {
      "cpu_ms": 300000
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
        "new_classes": ["DiscordGateway"]
      },
      {
        "tag": "v2",
        "new_classes": ["StfcSession"]
      }
    ]
  };

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

  const outputPath = path.join(__dirname, 'wrangler.json');
  fs.writeFileSync(outputPath, JSON.stringify(configTemplate, null, 2));

  console.log('✅ Generated wrangler.json with environment-specific configuration');
  console.log(`📝 KV Namespace ID: ${process.env.KV_NAMESPACE_ID || 'Not set'}`);
  console.log(`📝 R2 Bucket: ${process.env.R2_BUCKET_NAME || 'Not set'}`);
}

if (require.main === module) {
  generateWranglerConfig();
}

module.exports = { generateWranglerConfig };
