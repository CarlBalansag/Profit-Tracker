// Every page you can go to, with the words people might type for it.
export function pageList({ hasCashoutAccess = false, scheduleC = false } = {}) {
  return [
    { label: 'Dashboard', to: '/', group: 'Today', words: 'home overview profit' },
    { label: 'To-Do', to: '/todos', group: 'Today', words: 'tasks attention reminders' },
    { label: 'Calendar', to: '/calendar', group: 'Today', words: 'dates schedule' },
    { label: 'Add Transaction', to: '/add-transaction', group: 'Sell & Buy', words: 'purchase buy log new' },
    { label: 'Record Sale', to: '/add-sale', group: 'Sell & Buy', words: 'sell sold new' },
    { label: 'Transactions', to: '/transactions', group: 'Sell & Buy', words: 'history purchases sales' },
    { label: 'Inventory', to: '/inventory', group: 'Sell & Buy', words: 'stock on hand unsold' },
    { label: 'Email Automation', to: '/automation', group: 'Sell & Buy', words: 'email import orders' },
    { label: 'Shipping', to: '/shipping', group: 'Ship', words: 'labels tracking ship' },
    { label: 'Statuses', to: '/statuses', group: 'Ship', words: 'status pipeline workflow' },
    { label: 'Cash Flow', to: '/cashflow', group: 'Money', words: 'cash owed payout money' },
    { label: 'Credit Card', to: '/creditcard', group: 'Money', words: 'cards cashback points bills' },
    ...(hasCashoutAccess ? [{ label: 'Cashout', to: '/cashout', group: 'Money', words: 'deals eb la p4d' }] : []),
    { label: 'Analytics', to: '/analytics', group: 'Money', words: 'charts insights trends roi' },
    { label: 'Goals', to: '/goals', group: 'Money', words: 'targets' },
    { label: 'Expenses', to: '/expenses', group: 'Books', words: 'costs subscriptions' },
    { label: 'Receipts', to: '/receipts', group: 'Books', words: 'proof attachments' },
    { label: 'Invoices', to: '/invoices', group: 'Books', words: 'bill buyer pdf' },
    { label: 'Tax Exempt', to: '/tax-exempt', group: 'Books', words: 'resale certificate sales tax' },
    ...(scheduleC ? [{ label: 'Schedule C', to: '/schedule-c', group: 'Books', words: 'tax irs' }] : []),
    { label: 'Settings', to: '/settings', group: 'Account', words: 'preferences options' },
    { label: 'Data Setup', to: '/settings', state: { tab: 'datasetup' }, group: 'Account', words: 'vendors marketplaces cards accounts' },
    { label: 'Activity', to: '/activity', group: 'Account', words: 'log history undo' },
    { label: 'Guide', to: '/guide', group: 'Account', words: 'help how to' },
  ];
}
