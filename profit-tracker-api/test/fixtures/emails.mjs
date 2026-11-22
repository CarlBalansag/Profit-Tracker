// Synthetic store emails (no real customer data) shaped like the stores' own
// layouts: HTML tables for money lines, labels and amounts in separate cells.
export function mime({ from, subject, html, text, date = 'Mon, 02 Mar 2026 10:00:00 +0000', id = `<${Math.random().toString(36).slice(2)}@example.test>` }) {
  const boundary = 'b1_qa';
  const parts = [];
  if (text) parts.push(`--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}\r\n`);
  if (html) parts.push(`--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}\r\n`);
  return Buffer.from([
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
};
