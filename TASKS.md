# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat-ai-guide | AI guide: copy buttons on Settings > AI Assistant + get_ai_guide MCP tool (per-key version) | shared/aiGuide.mjs, profit-tracker-app/src/components/Settings/ (ApiKeys, AiGuideCopy), profit-tracker-api/routes/mcp.js, profit-tracker-api/routes/apiKeys.js, profit-tracker-api/services/apiKeys.js, profit-tracker-api/prisma/ (ApiKey.ai_guide_version migration), profit-tracker-api/test/ (aiGuide, mcpAiGuide), AGENTS.md | In progress | 2026-11-20 |
