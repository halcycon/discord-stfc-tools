import type { D1Database } from '@cloudflare/workers-types';

export interface OfficerSearchResult {
  id: number;
  name: string;
  faction: string;
  class: string;
  rarity: string;
  art_id: number;
}

export interface OfficerDetails {
  id: number;
  name: string;
  faction: string;
  class: string;
  rarity: string;
  art_id: number;
  synergy_id: number;
  max_rank: number;
  description?: string;
  flavor_text?: string;
  ability?: {
    name: string;
    description: string;
    art_id: number;
  };
  captain_ability?: {
    name: string;
    description: string;
    art_id: number;
  };
  synergy_officers?: Array<{
    id: number;
    name: string;
    art_id: number;
    synergy_bonus: number;
  }>;
  ranks?: Array<{
    rank: number;
    max_level: number;
    shards_required: number;
    costs: string;
  }>;
}

/**
 * Search for officers by name
 */
export async function searchOfficers(db: D1Database, query: string, limit: number = 10): Promise<OfficerSearchResult[]> {
  try {
    // Search for officers preferring full names over short names
    const nameQuery = `
      SELECT DISTINCT 
        ot.officer_id,
        ot.text as name,
        ot.key as name_key,
        o.faction,
        o.class,
        o.rarity,
        o.art_id
      FROM officer_translations ot
      JOIN officers o ON o.id = ot.officer_id
      WHERE ot.key LIKE '%officer_name_%' 
        AND LOWER(ot.text) LIKE LOWER(?)
      ORDER BY 
        CASE WHEN ot.key LIKE '%officer_name_short_%' THEN 2 ELSE 1 END,
        ot.text
      LIMIT ?
    `;
    
    const result = await db.prepare(nameQuery).bind(`%${query}%`, limit * 2).all();
    
    // Deduplicate by officer_id, preferring full names
    const officerMap = new Map<number, any>();
    
    result.results?.forEach((row: any) => {
      const officerId = row.officer_id;
      const isShortName = row.name_key.includes('_short_');
      
      if (!officerMap.has(officerId) || !isShortName) {
        officerMap.set(officerId, row);
      }
    });
    
    // Convert to array and limit
    const uniqueOfficers = Array.from(officerMap.values()).slice(0, limit);
    
    return uniqueOfficers.map((row: any) => ({
      id: row.officer_id,
      name: row.name,
      faction: getFactionName(row.faction),
      class: getClassName(row.class),
      rarity: row.rarity,
      art_id: row.art_id
    }));
    
  } catch (error) {
    console.error('Error searching officers:', error);
    return [];
  }
}

/**
 * Get detailed officer information
 */
export async function getOfficerDetails(db: D1Database, officerId: number): Promise<OfficerDetails | null> {
  try {
    // Get basic officer info with synergy_id and max_rank
    const officerQuery = `
      SELECT id, art_id, faction, class, rarity, synergy_id, max_rank
      FROM officers 
      WHERE id = ?
    `;
    
    const officerResult = await db.prepare(officerQuery).bind(officerId).first();
    if (!officerResult) return null;
    
    // Cast to expected types
    const officer = officerResult as any;
    
    // Get officer name and descriptions
    const translationsQuery = `
      SELECT key, text
      FROM officer_translations
      WHERE officer_id = ?
    `;
    
    const translationsResult = await db.prepare(translationsQuery).bind(officerId).all();
    const translations = translationsResult.results || [];
    
    // Parse translations
    let name = '';
    let description = '';
    let flavor_text = '';
    
    translations.forEach((t: any) => {
      if (t.key.includes('officer_name_') && !t.key.includes('_short_')) {
        name = t.text;
      } else if (t.key.includes('officer_tooltip_description_') && !t.key.includes('_short_')) {
        description = t.text;
      } else if (t.key.includes('officer_flavor_text_')) {
        flavor_text = t.text;
      }
    });
    
    // Get abilities
    const abilitiesQuery = `
      SELECT ability_type, ability_id, art_id, loca_id
      FROM officer_abilities
      WHERE officer_id = ?
    `;
    
    const abilitiesResult = await db.prepare(abilitiesQuery).bind(officerId).all();
    const abilities = abilitiesResult.results || [];
    
    // Build the result
    const details: OfficerDetails = {
      id: officer.id as number,
      name,
      faction: getFactionName(officer.faction as number),
      class: getClassName(officer.class as number),
      rarity: officer.rarity as string,
      art_id: officer.art_id as number,
      synergy_id: officer.synergy_id || 0,
      max_rank: officer.max_rank || 5,
      description: stripHtmlTags(description),
      flavor_text: stripHtmlTags(flavor_text)
    };
    
    // Add abilities with proper descriptions
    for (const ability of abilities) {
      if (ability.ability_type === 'ability') {
        // Get ability description from translations
        const abilityDescQuery = `
          SELECT text 
          FROM officer_translations
          WHERE officer_id = ? 
            AND (key LIKE '%officer_ability_desc_%' OR key LIKE '%officer_tooltip_description_%')
            AND key NOT LIKE '%_short_%'
          LIMIT 1
        `;
        
        const abilityDescResult = await db.prepare(abilityDescQuery).bind(officerId).first();
        
        details.ability = {
          name: 'Officer Ability',
          description: stripHtmlTags(abilityDescResult?.text as string || 'Ability description not available'),
          art_id: (ability as any).art_id
        };
      } else if (ability.ability_type === 'captain_ability') {
        // Get captain ability description from translations
        const capAbilityDescQuery = `
          SELECT text 
          FROM officer_translations
          WHERE officer_id = ? 
            AND (key LIKE '%officer_ability_desc_%' OR key LIKE '%captain_%' OR key LIKE '%officer_tooltip_description_%')
            AND key NOT LIKE '%_short_%'
          LIMIT 1
        `;
        
        const capAbilityDescResult = await db.prepare(capAbilityDescQuery).bind(officerId).first();
        
        details.captain_ability = {
          name: 'Captain Ability',
          description: stripHtmlTags(capAbilityDescResult?.text as string || 'Captain ability description not available'),
          art_id: (ability as any).art_id
        };
      }
    }
    
    // Get synergy officers if this officer has synergy_id (with timeout protection)
    if (officer.synergy_id) {
      try {
        const synergyQuery = `
          SELECT DISTINCT o.id, ot.text as name, o.art_id
          FROM officers o
          JOIN officer_translations ot ON ot.officer_id = o.id
          WHERE o.synergy_id = ? 
            AND o.id != ?
            AND ot.key LIKE '%officer_name_%' 
            AND ot.key NOT LIKE '%_short_%'
          LIMIT 3
        `;
        
        const synergyResult = await db.prepare(synergyQuery).bind(officer.synergy_id, officerId).all();
        details.synergy_officers = synergyResult.results?.map((row: any) => ({
          id: row.id,
          name: row.name,
          art_id: row.art_id,
          synergy_bonus: 20.0 // Default synergy bonus - this might be more complex in real data
        })) || [];
      } catch (error) {
        console.warn('Failed to load synergy officers:', error);
        details.synergy_officers = [];
      }
    }
    
    // Get rank progression data (simplified)
    try {
      const ranksQuery = `
        SELECT rank, max_level, shards_required
        FROM officer_ranks
        WHERE officer_id = ?
        ORDER BY rank
        LIMIT 5
      `;
      
      const ranksResult = await db.prepare(ranksQuery).bind(officerId).all();
      details.ranks = ranksResult.results?.map((row: any) => ({
        rank: row.rank,
        max_level: row.max_level,
        shards_required: row.shards_required,
        costs: '' // Simplified for performance
      })) || [];
    } catch (error) {
      console.warn('Failed to load ranks:', error);
      details.ranks = [];
    }
    
    return details;
    
  } catch (error) {
    console.error('Error getting officer details:', error);
    return null;
  }
}

/**
 * Get all officers (for testing/debugging)
 */
export async function getAllOfficers(db: D1Database, limit: number = 50): Promise<OfficerSearchResult[]> {
  try {
    const query = `
      SELECT DISTINCT 
        ot.officer_id,
        ot.text as name,
        ot.key as name_key,
        o.faction,
        o.class,
        o.rarity,
        o.art_id
      FROM officer_translations ot
      JOIN officers o ON o.id = ot.officer_id
      WHERE ot.key LIKE '%officer_name_%'
      ORDER BY 
        CASE WHEN ot.key LIKE '%officer_name_short_%' THEN 2 ELSE 1 END,
        ot.text
      LIMIT ?
    `;
    
    const result = await db.prepare(query).bind(limit * 2).all();
    
    // Deduplicate by officer_id, preferring full names
    const officerMap = new Map<number, any>();
    
    result.results?.forEach((row: any) => {
      const officerId = row.officer_id;
      const isShortName = row.name_key.includes('_short_');
      
      if (!officerMap.has(officerId) || !isShortName) {
        officerMap.set(officerId, row);
      }
    });
    
    // Convert to array and limit
    const uniqueOfficers = Array.from(officerMap.values()).slice(0, limit);
    
    return uniqueOfficers.map((row: any) => ({
      id: row.officer_id,
      name: row.name,
      faction: getFactionName(row.faction),
      class: getClassName(row.class),
      rarity: row.rarity,
      art_id: row.art_id
    }));
    
  } catch (error) {
    console.error('Error getting all officers:', error);
    return [];
  }
}

// Helper functions
function getFactionName(factionId: number): string {
  const factions: Record<number, string> = {
    2064723306: 'Federation',
    1789521276: 'Klingon',
    3582419853: 'Romulan',
    745935963: 'Augment',
    2974107707: 'Independent'
  };
  return factions[factionId] || `Faction ${factionId}`;
}

function getClassName(classId: number): string {
  const classes: Record<number, string> = {
    1: 'Command',
    2: 'Engineering',
    3: 'Science'
  };
  return classes[classId] || `Class ${classId}`;
}

function stripHtmlTags(text: string): string {
  if (!text) return '';
  return text
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/\n+/g, ' ') // Replace newlines with spaces
    .trim();
}
