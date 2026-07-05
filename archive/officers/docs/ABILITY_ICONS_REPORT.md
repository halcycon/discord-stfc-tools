# Ability Icons Download Report

## Summary
Successfully downloaded ability icons from spocks.club for the Discord STFC Tools project.

## Results
- **Total art_ids found**: 372 unique ability art_ids extracted from officer data
- **Successfully downloaded**: 346 ability icons
- **Failed downloads**: 26 ability icons (404 errors from server)
- **Success rate**: 93.0%

## File Location
All successfully downloaded ability icons are stored in:
```
public/abilities/
```

## File Format
- Format: PNG images
- Average size: ~10-14KB per icon
- Naming convention: `{art_id}.png` (e.g., `1.png`, `123.png`, etc.)

## Failed Downloads
The following art_ids returned 404 errors and could not be downloaded:
- 110, 111, 112, 113, 114, 115, 116, 120, 121, 122
- 192, 260, 262, 286, 288, 305
- 801, 802, 803, 804, 805, 806, 807, 808
- 916, 921

These may be:
1. Placeholder art_ids that don't have corresponding images
2. New abilities that haven't been added to spocks.club yet
3. Discontinued or removed abilities

## Script Details
The download script (`fetch-ability-icons.js`):
- Extracts art_ids from `src/officerData.ts` using regex parsing
- Downloads from `https://spocks.club/img/abilities/{art_id}.png`
- Implements rate limiting (5 concurrent downloads with 1-second delays between batches)
- Skips existing files to avoid re-downloading
- Creates the `public/abilities/` directory automatically

## Usage
To re-run the download (e.g., after updating officer data):
```bash
node fetch-ability-icons.js
```

## Integration
The ability icons can now be used in the Discord bot by referencing:
```
public/abilities/{art_id}.png
```

Where `{art_id}` corresponds to the `art_id` field in the officer abilities data.
