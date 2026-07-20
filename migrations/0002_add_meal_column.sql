ALTER TABLE entries ADD COLUMN meal TEXT DEFAULT '';

UPDATE entries SET meal = CASE
  WHEN strftime('%H', created_at) BETWEEN '05' AND '09' THEN 'Breakfast'
  WHEN strftime('%H', created_at) BETWEEN '10' AND '14' THEN 'Lunch'
  WHEN strftime('%H', created_at) BETWEEN '17' AND '20' THEN 'Dinner'
  ELSE 'Snacks'
END WHERE meal = '';
