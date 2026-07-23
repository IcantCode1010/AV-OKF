WITH first_user_messages AS (
  SELECT DISTINCT ON ("sessionId")
    "sessionId",
    regexp_replace(trim("content"), '[[:space:]]+', ' ', 'g') AS "content"
  FROM "ChatMessage"
  WHERE "role" = 'user' AND trim("content") <> ''
  ORDER BY "sessionId", "createdAt", "id"
)
UPDATE "ChatSession" AS session
SET "title" = CASE
  WHEN char_length(message."content") <= 72 THEN message."content"
  ELSE rtrim(left(message."content", 69)) || '...'
END
FROM first_user_messages AS message
WHERE session."id" = message."sessionId"
  AND session."title" = 'New chat';
