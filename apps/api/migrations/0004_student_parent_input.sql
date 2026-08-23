ALTER TABLE parents ADD COLUMN phone_normalized TEXT;

UPDATE parents
SET phone_normalized = CASE
  WHEN substr(replace(replace(replace(replace(replace(phone,'+',''),' ',''),'-',''),'(',''),')',''),1,2) = '62'
    THEN '0' || substr(replace(replace(replace(replace(replace(phone,'+',''),' ',''),'-',''),'(',''),')',''),3)
  WHEN substr(replace(replace(replace(replace(replace(phone,'+',''),' ',''),'-',''),'(',''),')',''),1,1) = '8'
    THEN '0' || replace(replace(replace(replace(replace(phone,'+',''),' ',''),'-',''),'(',''),')','')
  ELSE replace(replace(replace(replace(replace(phone,'+',''),' ',''),'-',''),'(',''),')','')
END
WHERE phone IS NOT NULL AND trim(phone) <> '';

CREATE UNIQUE INDEX idx_parents_phone_normalized
ON parents(phone_normalized)
WHERE phone_normalized IS NOT NULL;
