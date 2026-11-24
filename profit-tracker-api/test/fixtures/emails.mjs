// Synthetic store emails (no real customer data) shaped like the stores' own
// layouts: HTML tables for money lines, labels and amounts in separate cells.
// `auth`: the Authentication-Results line the mailbox provider adds on arrival.
// By default Gmail's, saying the email really came from its From domain;
// pass a string for another verdict, or null for none.
export const passingAuth = (from) => {
  const domain = String(from).replace(/^.*@/, '').replace(/[>\s"]/g, '');
  return `mx.google.com; dkim=pass header.i=@${domain}; spf=pass smtp.mailfrom=bounce@${domain}; dmarc=pass (p=REJECT) header.from=${domain}`;
};
export function mime({ from, subject, html, text, date = 'Mon, 02 Mar 2026 10:00:00 +0000', id = `<${Math.random().toString(36).slice(2)}@example.test>`, auth = passingAuth(from) }) {
  const boundary = 'b1_qa';
  const parts = [];
  if (text) parts.push(`--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}\r\n`);
  if (html) parts.push(`--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}\r\n`);
  return Buffer.from([
    ...(auth ? [`Authentication-Results: ${auth}`] : []),
    `From: ${from}`, `To: buyer@example.test`, `Subject: ${subject}`, `Date: ${date}`, `Message-ID: ${id}`,
    'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    ...parts, `--${boundary}--`, '',
  ].join('\r\n'));
}

const rows = (pairs) => `<table>${pairs.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`;

export const FIXTURES = {
  amazonOrder: {
    merchant: 'amazon',
    raw: mime({
      from: '"Amazon.com" <auto-confirm@amazon.com>',
      subject: 'Your Amazon.com order of "Nintendo Switch 2 Console" and 1 more item',
      html: `<p>Hello,</p><p>Thanks for your order.</p><p>Order #<a href="https://www.amazon.com/x">112-1234567-7654321</a></p>
        ${rows([['Nintendo Switch 2 Console', '$449.99'], ['Qty: 1', ''], ['Mario Kart World', '$79.99'], ['Qty: 2', '']])}
        ${rows([['Item(s) Subtotal:', '$609.97'], ['Shipping &amp; Handling:', '$0.00'], ['Promotion Applied:', '-$20.00'], ['Estimated tax to be collected:', '$47.20'], ['Order Total:', '$637.17']])}
        <p>Paid with Visa ending in 4242</p><p><a href="x">Unsubscribe</a></p>`,
    }),
    expect: { items: [{ name: 'Nintendo Switch 2 Console', quantity: 1, total: '449.99' }, { name: 'Mario Kart World', quantity: 2, total: '79.99' }], kind: 'order', order_number: '112-1234567-7654321', total: '637.17', subtotal: '609.97', tax: '47.20', shipping: '0.00', discount: '20.00', payment_hint: 'Visa 4242', status: 'extracted' },
  },
  amazonShipped: {
    merchant: 'amazon',
    raw: mime({
      from: 'Amazon.com <shipment-tracking@amazon.com>',
      subject: 'Shipped: "Nintendo Switch 2 Console"',
      html: `<p>Your package is on the way.</p><p>Order # 112-1234567-7654321</p><p>Carrier: UPS, Tracking number: 1Z999AA10123456784</p>`,
    }),
    expect: { kind: 'shipped', order_number: '112-1234567-7654321', tracking_numbers: ['1Z999AA10123456784'] },
  },
  amazonCancelled: {
    merchant: 'amazon',
    raw: mime({
      from: 'Amazon.com <order-update@amazon.com>',
      subject: 'Your Amazon.com order #112-7777777-1111111 has been canceled',
      html: '<p>We have canceled your order as you requested. Thanks for your order.</p>',
    }),
    expect: { kind: 'cancelled', order_number: '112-7777777-1111111' },
  },
  walmartOrder: {
    merchant: 'walmart',
    raw: mime({
      from: 'Walmart <help@walmart.com>',
      subject: 'Thanks for your order',
      html: `<h1>We got your order!</h1><p>Order number: 2000123-45678901</p>
        ${rows([['2 x Pokemon Booster Bundle', '$59.94'], ['Subtotal', '$59.94'], ['Delivery', 'Free'], ['Tax', '$4.80'], ['Total', '$64.74']])}
        <p>Mastercard ****5555</p>`,
    }),
    expect: { kind: 'order', order_number: '2000123-45678901', total: '64.74', subtotal: '59.94', tax: '4.80', payment_hint: 'Mastercard 5555',
      items: [{ name: 'Pokemon Booster Bundle', quantity: 2, total: '59.94' }] },
  },
  walmartPickup: {
    merchant: 'walmart',
    raw: mime({ from: 'Walmart <help@walmart.com>', subject: 'Your order is ready for pickup', html: '<p>Order# 2000123-45678901 is ready.</p>' }),
    expect: { kind: 'pickup', order_number: '2000123-45678901' },
  },
  bestBuyOrder: {
    merchant: 'bestbuy',
    raw: mime({
      from: 'Best Buy <BestBuyInfo@emailinfo.bestbuy.com>',
      subject: 'Thanks for your order, QA',
      html: `<p>Order Number: BBY01-806123456789</p>${rows([['Subtotal', '$299.99'], ['Estimated Sales Tax', '$24.75'], ['Total', '$324.74']])}<p>Payment: American Express ending in 1009</p>`,
    }),
    expect: { kind: 'order', order_number: 'BBY01-806123456789', total: '324.74', tax: '24.75', payment_hint: 'Amex 1009' },
  },
  targetSchemaOrg: {
    merchant: 'target',
    raw: mime({
      from: 'Target <orders@oe.target.com>',
      subject: 'Thanks for your order!',
      html: `<script type="application/ld+json">${JSON.stringify({
        '@context': 'http://schema.org', '@type': 'Order', orderNumber: '912003456789', orderStatus: 'http://schema.org/OrderProcessing',
        priceCurrency: 'USD', price: '105.97',
        acceptedOffer: [
          { '@type': 'Offer', itemOffered: { '@type': 'Product', name: 'LEGO Star Wars Set' }, price: '49.99', priceCurrency: 'USD', eligibleQuantity: { '@type': 'QuantitativeValue', value: 2 } },
        ],
      })}</script><p>Order #912003456789</p>${rows([['Subtotal', '$99.98'], ['Tax', '$5.99'], ['Total', '$105.97']])}`,
    }),
    expect: { kind: 'order', order_number: '912003456789', total: '105.97',
      items: [{ name: 'LEGO Star Wars Set', quantity: 2, unit_price: '49.99', total: '99.98' }], parserIncludes: 'schema.org' },
  },
  appleOrder: {
    merchant: 'apple',
    raw: mime({
      from: 'Apple Store <order_acknowledgment@orders.apple.com>',
      subject: "We're processing your order W1234567890",
      html: `${rows([['Subtotal', '$999.00'], ['Shipping', 'FREE'], ['Estimated Tax', '$82.42'], ['Order Total', '$1,081.42']])}`,
    }),
    expect: { kind: 'order', order_number: 'W1234567890', total: '1081.42', tax: '82.42', shipping: '0.00' },
  },
  ebaySale: {
    merchant: 'ebay',
    raw: mime({
      from: 'eBay <ebay@ebay.com>',
      subject: 'You made the sale for Pokemon Charizard Card',
      html: `<p>Order number: 12-34567-89012</p>${rows([['Sold for', '$250.00'], ['Total', '$262.50']])}`,
    }),
    expect: { kind: 'sale', order_number: '12-34567-89012', total: '262.50' },
  },
  stockxSale: {
    merchant: 'stockx',
    raw: mime({ from: 'StockX <noreply@stockx.com>', subject: 'You Sold Your Item! Jordan 1 Retro', html: '<p>Order number: 12345678-87654321</p><p>Total Payout: $180.00</p>' }),
    expect: { kind: 'sale', order_number: '12345678-87654321' },
  },
  paypalReceived: {
    merchant: 'paypal',
    raw: mime({ from: 'service@paypal.com', subject: "You've got money", html: '<p>You received $45.00 USD from A Buyer.</p><p>Transaction ID: 1AB23456CD789012E</p>' }),
    expect: { kind: 'sale', order_number: '1AB23456CD789012E' },
  },
  uspsDelivered: {
    merchant: 'usps',
    raw: mime({ from: 'USPS <auto-reply@usps.com>', subject: 'USPS Delivered: Tracking Number 9400111899223344556677', text: 'Your item was delivered in or at the mailbox at 2:14 pm.' }),
    expect: { kind: 'delivered', tracking_numbers: ['9400111899223344556677'], order_number: null },
  },
  amazonMarketing: {
    merchant: 'amazon',
    raw: mime({ from: 'Amazon.com <store-news@amazon.com>', subject: 'Black Friday deals are here: up to 50% off', html: '<p>Shop now. Limited time.</p><p>Unsubscribe</p>' }),
    expect: { status: 'ignored' },
  },
  pirateShipReceipt: {
    merchant: 'pirateship',
    raw: mime({ from: 'Pirate Ship <support@pirateship.com>', subject: 'Your Pirate Ship receipt', html: `${rows([['3 USPS Ground Advantage labels', '$14.37'], ['Total', '$14.37']])}<p>Visa ending in 4242</p>` }),
    expect: { kind: 'receipt', total: '14.37', payment_hint: 'Visa 4242' },
  },
  // "Total Fee" and "Total Tax" come before the real "Total".
  lowesOrder: {
    merchant: 'lowes',
    raw: mime({ from: "Lowe's <orders@lowes.com>", subject: 'Thanks for Your Order! #300900000000000001', html: `<p>Order # 300900000000000001</p>${rows([['Subtotal (1 item)', '$45.98'], ['Savings', '($5.99)'], ['Delivery', '$0.00'], ['Total Fee', '$0.00'], ['Total Tax', '$4.02'], ['Total', '$50.00']])}` }),
    expect: { kind: 'order', order_number: '300900000000000001', total: '50.00', subtotal: '45.98', tax: '4.02' },
  },
  // Carriers send ads and account mail too: without a tracking number it isn't a shipment.
  fedexOffer: {
    merchant: 'fedex',
    raw: mime({ from: 'FedEx <fedex@fedex.com>', subject: 'Your November offers are here!', html: '<p>Save on your next shipment. Delivered right to your inbox.</p>' }),
    expect: { kind: 'other', status: 'ignored', tracking_numbers: [] },
  },
  fedexCode: {
    merchant: 'fedex',
    raw: mime({ from: 'FedEx <noreply@fedex.com>', subject: 'Your FedEx verification code: 123456', text: 'Your code is 123456.' }),
    expect: { kind: 'other', status: 'ignored' },
  },
  // The body offers "cancel your order"; the subject says what it is. The
  // order number is written without its dash.
  walmartCurbside: {
    merchant: 'walmart',
    raw: mime({ from: 'Walmart <help@walmart.com>', subject: 'Thanks for your curbside pickup order, Sam', html: `<p>Order number: 200012300000001</p><p>Need to make changes? You can cancel your order until 2pm.</p>${rows([['Total', '$113.73']])}` }),
    expect: { kind: 'order', order_number: '2000123-00000001', total: '113.73', status: 'extracted' },
  },
  // A store ad that happens to say "Delivered": nothing to link by.
  costcoAd: {
    merchant: 'costco',
    raw: mime({ from: 'Costco <online@costco.com>', subject: 'NEW Member-Only Savings Start Today!', html: '<p>$79.99 Delivered</p><p>After $20 OFF</p>' }),
    expect: { status: 'ignored' },
  },
  lowesOrderChange: {
    merchant: 'lowes',
    raw: mime({ from: "Lowe's <orders@lowes.com>", subject: 'Order Change to Order #300900000000000001', html: `<p>Order # 300900000000000001</p>${rows([['Subtotal', '$0.00'], ['Total', '$0.00']])}` }),
    expect: { order_number: '300900000000000001', total: null, subtotal: null },
  },
  walmartCode: {
    merchant: 'walmart',
    raw: mime({ from: 'Walmart <help@walmart.com>', subject: 'Your verification code is 555000', text: 'Use 555000 to sign in. Your order history is waiting.' }),
    expect: { kind: 'other', status: 'ignored' },
  },
};

// A minimal one-page PDF with the given lines of text (Helvetica), for the
// PDF invoice tests. Built byte by byte so no PDF library is needed.
export function makePdf(lines) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const text = `BT /F1 12 Tf 14 TL 72 720 Td ${lines.map((l, i) => (i === 0 ? `(${esc(l)}) Tj` : `T* (${esc(l)}) Tj`)).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

// An email with an HTML body and a PDF attached.
export function mimeWithPdf({ from, subject, html, pdf, filename = 'invoice.pdf', date = 'Tue, 03 Mar 2026 09:01:00 +0000', id = `<${Math.random().toString(36).slice(2)}@example.test>`, auth = passingAuth(from) }) {
  const b = 'mixed_qa';
  const pdfB64 = pdf.toString('base64').replace(/.{76}/g, '$&\r\n');
  return Buffer.from([
    ...(auth ? [`Authentication-Results: ${auth}`] : []),
    `From: ${from}`, 'To: buyer@example.test', `Subject: ${subject}`, `Date: ${date}`, `Message-ID: ${id}`,
    'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${b}"`, '',
    `--${b}`, 'Content-Type: text/html; charset=utf-8', '', html, '',
    `--${b}`, `Content-Type: application/pdf; name="${filename}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${filename}"`, '', pdfB64, '',
    `--${b}--`, '',
  ].join('\r\n'));
}
