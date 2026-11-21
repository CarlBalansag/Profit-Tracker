-- The AI guide version the AI using each API key last pulled with the
-- get_ai_guide MCP tool. Additive; NULL means it has never pulled the guide.
ALTER TABLE "ApiKey" ADD COLUMN "ai_guide_version" TEXT;
