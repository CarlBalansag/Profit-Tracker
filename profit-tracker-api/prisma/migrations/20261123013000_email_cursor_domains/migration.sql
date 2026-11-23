-- Sender domains each folder cursor has already searched, so a newly added
-- sender is searched over the whole window once.
ALTER TABLE "EmailFolderCursor" ADD COLUMN "domains" TEXT[] DEFAULT ARRAY[]::TEXT[];
