ALTER TABLE "User"
ADD COLUMN "username" TEXT;

WITH normalized AS (
  SELECT
    id,
    LOWER(REGEXP_REPLACE(SPLIT_PART(email, '@', 1), '[^a-zA-Z0-9._-]', '', 'g')) AS base_username
  FROM "User"
),
ranked AS (
  SELECT
    id,
    CASE
      WHEN COALESCE(base_username, '') = '' THEN 'user'
      ELSE base_username
    END AS sanitized_username,
    ROW_NUMBER() OVER (
      PARTITION BY CASE
        WHEN COALESCE(base_username, '') = '' THEN 'user'
        ELSE base_username
      END
      ORDER BY id
    ) AS duplicate_index
  FROM normalized
)
UPDATE "User" AS target
SET "username" = CASE
  WHEN ranked.duplicate_index = 1 THEN LEFT(ranked.sanitized_username, 40)
  ELSE LEFT(ranked.sanitized_username, 32) || '-' || ranked.duplicate_index::TEXT
END
FROM ranked
WHERE target.id = ranked.id;

ALTER TABLE "User"
ALTER COLUMN "username" SET NOT NULL;

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
