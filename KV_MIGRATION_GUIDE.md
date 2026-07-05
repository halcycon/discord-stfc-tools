# KV Migration Guide

This guide walks you through migrating from the hard-coded CSV data to Cloudflare KV storage using environment variables for configuration.

## Prerequisites

- Cloudflare account with Workers enabled
- Wrangler CLI installed and authenticated
- Node.js and npm

## Step-by-Step Migration

### 1. Set Up Environment Variables

Copy the environment template:
```bash
cp .env.template .env
```

### 2. Create KV Namespaces

Create the production namespace:
```bash
npm run kv:create
```

Create the preview namespace:
```bash
npm run kv:create-preview
```

### 3. Update Environment Configuration

Edit `.env` with the namespace IDs returned from the previous commands:

```env
# KV Namespace IDs
KV_NAMESPACE_ID=your-actual-production-namespace-id
KV_NAMESPACE_PREVIEW_ID=your-actual-preview-namespace-id
```

### 4. Generate Wrangler Configuration

Generate the wrangler.json from environment variables:
```bash
npm run generate-config
```

This creates `wrangler.json` with your specific namespace IDs (this file is gitignored).

### 5. Migrate Data

Generate the KV bulk upload file:
```bash
npm run migrate-kv
```

Upload to production:
```bash
npm run kv:upload
```

### 6. Update Commands

Register the new Discord commands:
```bash
npm run register-commands
```

### 7. Deploy

Deploy the worker (automatically generates config first):
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
