// How an email order's number is shown. Cash-out check notices keep their
// check number as "CHECK 1185".
export const orderRef = (n) => (/^CHECK\s/i.test(n) ? `Check #${n.replace(/^CHECK\s*/i, '')}` : `#${n}`);
