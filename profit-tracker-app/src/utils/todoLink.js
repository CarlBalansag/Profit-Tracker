// Where a to-do's "Open" goes (link built by the API, services/todos.js): a
// purchase or sale opens in the Transactions detail window, anything else is a
// page, optionally with router state (e.g. a Settings tab).
export function openTodoLink(navigate, link) {
  if (!link) return;
  if (link.kind === 'transaction') {
    navigate('/transactions', { state: { openTransaction: { inventoryId: link.inventoryId, saleId: link.saleId || null } } });
  } else if (link.kind === 'page') {
    navigate(link.to, link.state ? { state: link.state } : undefined);
  }
}
