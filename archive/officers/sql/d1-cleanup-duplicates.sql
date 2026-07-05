-- Cleanup script to remove duplicate records from D1 database

-- Clean up duplicate officer_abilities
-- Keep the first occurrence of each unique combination
DELETE FROM officer_abilities 
WHERE id NOT IN (
    SELECT MIN(id) 
    FROM officer_abilities 
    GROUP BY officer_id, ability_id, ability_type
);

-- Clean up duplicate ability_values
DELETE FROM ability_values 
WHERE id NOT IN (
    SELECT MIN(id) 
    FROM ability_values 
    GROUP BY ability_id, rank
);

-- Clean up duplicate officer_translations
DELETE FROM officer_translations 
WHERE id NOT IN (
    SELECT MIN(id) 
    FROM officer_translations 
    GROUP BY officer_id, key
);

-- Clean up duplicate officer_stats
DELETE FROM officer_stats 
WHERE id NOT IN (
    SELECT MIN(id) 
    FROM officer_stats 
    GROUP BY officer_id, level
);

-- Clean up duplicate officer_ranks
DELETE FROM officer_ranks 
WHERE id NOT IN (
    SELECT MIN(id) 
    FROM officer_ranks 
    GROUP BY officer_id, rank
);

-- Clean up duplicate officer_traits
DELETE FROM officer_traits 
WHERE id NOT IN (
    SELECT MIN(id) 
    FROM officer_traits 
    GROUP BY officer_id, trait_id
);
