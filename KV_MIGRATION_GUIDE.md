# KV Migration Guide

This guide walks you through migrating from the hard-coded CSV data to Cloudflare KV storage.

## Prerequisites

- Cloudflare account with Workers enabled
- Wrangler CLI installed and authenticated
- Node.js and npm

## Step-by-Step Migration

### 1. Create KV Namespaces

Create the production namespace:
```bash
wrangler kv namespace create "SYSTEM_DATA"
```

Create the preview namespace for local development:
```bash
wrangler kv namespace create "SYSTEM_DATA" --preview
```

Save the namespace IDs returned by these commands.

### 2. Update Configuration

Edit `wrangler.jsonc` and replace the placeholder IDs:

```jsonc
"kv_namespaces": [
  {
    "binding": "SYSTEM_DATA",
    "id": "your-actual-production-namespace-id",
    "preview_id": "your-actual-preview-namespace-id"
  }
]
```

### 3. Migrate Data

Generate the KV bulk upload file:
```bash
npm run migrate-kv
```

This creates `kv-bulk-upload.json` with all system data formatted for KV storage.

### 4. Upload Data

Upload to production:
```bash
npm run kv:upload
```

For preview/local development:
```bash
wrangler kv bulk put --binding SYSTEM_DATA --preview kv-bulk-upload.json
```

### 5. Update Commands

Register the new Discord commands (including the table command):
```bash
npm run register-commands
```

### 6. Deploy

Deploy the updated worker:
```bash
npm run deploy
```

## Verification

Test the migration by checking the systems endpoint:
```bash
curl https://your-worker.workers.dev/systems
```

Test a coordinate lookup:
```bash
curl https://your-worker.workers.dev/lookup?message="[[TEST] Player S:73559 X:1 Y:1]"
```

## Data Structure

The KV storage uses the following key structure:

- `system:{systemId}` - Individual system records as JSON
- `system:index` - Array of all system IDs

Example system record:
```json
{
  "systemName": "Nidox",
  "systemId": "73559",
  "level": "30",
  "warpRange": "1",
  "warpRangeSH": "1",
  "factionId": "-1"
}
```

## Benefits of KV Storage

1. **Performance**: Fast edge-based lookups
2. **Scalability**: No bundle size impact from large data arrays
3. **Flexibility**: Easy to update data without redeployment
4. **Global**: Data replicated across Cloudflare's edge network

## Adding New Systems

To add new systems after migration:

1. Add entries to `system-data.csv`
2. Run `npm run migrate-kv` to regenerate the bulk upload file
3. Run `npm run kv:upload` to update KV storage
4. No worker redeployment needed!

## Troubleshooting

- **KV namespace not found**: Ensure namespace IDs are correct in `wrangler.jsonc`
- **Data not updating**: Check you're uploading to the correct namespace (production vs preview)
- **Worker errors**: Check the worker logs in Cloudflare dashboard
