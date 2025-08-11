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
    "vars": {
      "ENVIRONMENT": "development"
    },
    "kv_namespaces": []
  };

  // Add KV namespace if environment variables are set
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

  const outputPath = path.join(__dirname, 'wrangler.json');
  fs.writeFileSync(outputPath, JSON.stringify(configTemplate, null, 2));
  
  console.log('✅ Generated wrangler.json with environment-specific configuration');
  console.log(`📝 KV Namespace ID: ${process.env.KV_NAMESPACE_ID || 'Not set'}`);
  console.log(`📝 Preview ID: ${process.env.KV_NAMESPACE_PREVIEW_ID || 'Not set'}`);
}

if (require.main === module) {
  generateWranglerConfig();
}

module.exports = { generateWranglerConfig };
