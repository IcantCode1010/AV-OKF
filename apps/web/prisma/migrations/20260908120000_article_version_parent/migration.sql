CREATE OR REPLACE FUNCTION allocate_article_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM id FROM "KnowledgeArticle" WHERE id = NEW."articleId" FOR UPDATE;
 SELECT COALESCE(MAX("version"), 0) + 1 INTO NEW."version" FROM "KnowledgeArticleRevision" WHERE "articleId" = NEW."articleId";
 IF NEW."parentRevisionId" IS NULL THEN
  SELECT id INTO NEW."parentRevisionId" FROM "KnowledgeArticleRevision" WHERE "articleId" = NEW."articleId" ORDER BY "version" DESC LIMIT 1;
 ELSIF NOT EXISTS (SELECT 1 FROM "KnowledgeArticleRevision" WHERE id=NEW."parentRevisionId" AND "articleId"=NEW."articleId") THEN
  RAISE EXCEPTION 'article_parent_revision_mismatch';
 END IF;
 RETURN NEW;
END;
$$;
