// Records one ChangeLog row per changed field. `client` is the transaction
// client the caller is already inside, so this commits/rolls back with it.
// `source` says where the edit came from: 'mcp' (default) or 'web'.
async function recordChanges(client, userId, tableName, recordId, changes, source = 'mcp') {
  if (!changes.length) return;
  const now = new Date();
  await client.changeLog.createMany({
    data: changes.map(({ field, oldValue, newValue }) => ({
      user_id: userId,
      table_name: tableName,
      record_id: recordId,
      field,
      old_value: oldValue === null || oldValue === undefined ? null : String(oldValue),
      new_value: newValue === null || newValue === undefined ? null : String(newValue),
      source,
      created_at: now,
    })),
  });
}

module.exports = { recordChanges };
