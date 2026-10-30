import fs from 'fs';
import path from 'path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
}

interface InvoiceSpec {
  fileName: string;
  vendorName: string;
  vendorAddress: string[];
  vendorContact: string;
  customerName: string;
  customerAddress: string[];
  invoiceNumber: string;
  poReference: string;
  invoiceDate: string;
  dueDate: string;
  paymentTerms: string;
  currency: string;
  lineItems: LineItem[];
  subtotal: string;
  tax: string;
  totalAmountDue: string;
  statusNotice?: string;
  footerNote: string;
}

async function buildInvoicePdf(spec: InvoiceSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // Standard US Letter

  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Palette definitions
  const primaryDark = rgb(0.08, 0.13, 0.22); // Deep Navy Slate
  const accentBlue = rgb(0.12, 0.35, 0.72);  // Corporate Royal Blue
  const textDark = rgb(0.12, 0.14, 0.18);    // Rich Charcoal
  const textMuted = rgb(0.42, 0.46, 0.54);   // Neutral Gray
  const borderLight = rgb(0.86, 0.89, 0.93); // Crisp Table Border
  const bgHeader = rgb(0.95, 0.96, 0.98);    // Table Header Background
  const bgRowAlt = rgb(0.98, 0.99, 1.0);     // Subtle Alternate Row

  const marginX = 45;
  const contentWidth = 612 - marginX * 2; // 522pt width

  // 1. Top Decorative Brand Banner
  page.drawRectangle({
    x: 0,
    y: 784,
    width: 612,
    height: 8,
    color: accentBlue,
  });

  // 2. Header: Company Brand & Big "INVOICE" Title
  // Vendor Name
  page.drawText(spec.vendorName, {
    x: marginX,
    y: 742,
    size: 20,
    font: helveticaBold,
    color: primaryDark,
  });

  // Vendor Address
  let addrY = 724;
  for (const line of spec.vendorAddress) {
    page.drawText(line, {
      x: marginX,
      y: addrY,
      size: 9,
      font: helvetica,
      color: textMuted,
    });
    addrY -= 12;
  }
  page.drawText(spec.vendorContact, {
    x: marginX,
    y: addrY,
    size: 9,
    font: helvetica,
    color: textMuted,
  });

  // Large Right-Aligned "INVOICE"
  const invoiceTitle = 'INVOICE';
  const titleWidth = helveticaBold.widthOfTextAtSize(invoiceTitle, 26);
  page.drawText(invoiceTitle, {
    x: 612 - marginX - titleWidth,
    y: 738,
    size: 26,
    font: helveticaBold,
    color: primaryDark,
  });

  // Invoice Number Badge
  const invNumText = `# ${spec.invoiceNumber}`;
  const invNumWidth = helveticaBold.widthOfTextAtSize(invNumText, 11);
  page.drawText(invNumText, {
    x: 612 - marginX - invNumWidth,
    y: 718,
    size: 11,
    font: helveticaBold,
    color: accentBlue,
  });

  // Divider Line
  page.drawLine({
    start: { x: marginX, y: 675 },
    end: { x: 612 - marginX, y: 675 },
    thickness: 1,
    color: borderLight,
  });

  // 3. Metadata Section: Bill-To & Commercial Terms Grid
  // Left Column: Bill To
  page.drawText('BILLED TO:', {
    x: marginX,
    y: 655,
    size: 9,
    font: helveticaBold,
    color: textMuted,
  });
  page.drawText(spec.customerName, {
    x: marginX,
    y: 640,
    size: 11,
    font: helveticaBold,
    color: textDark,
  });
  let custY = 626;
  for (const line of spec.customerAddress) {
    page.drawText(line, {
      x: marginX,
      y: custY,
      size: 9,
      font: helvetica,
      color: textMuted,
    });
    custY -= 13;
  }

  // Right Column: Key Contractual Coordinates
  const metaColX = 350;
  const metaValX = 460;
  let metaY = 655;

  const metaRows: [string, string][] = [
    ['INVOICE DATE:', spec.invoiceDate],
    ['DUE DATE:', spec.dueDate],
    ['PURCHASE ORDER:', spec.poReference],
    ['PAYMENT TERMS:', spec.paymentTerms],
    ['CURRENCY:', spec.currency],
  ];

  for (const [label, val] of metaRows) {
    page.drawText(label, {
      x: metaColX,
      y: metaY,
      size: 8.5,
      font: helveticaBold,
      color: textMuted,
    });
    page.drawText(val, {
      x: metaValX,
      y: metaY,
      size: 9,
      font: label === 'PURCHASE ORDER' ? helveticaBold : helvetica,
      color: label === 'PURCHASE ORDER' ? accentBlue : textDark,
    });
    metaY -= 15;
  }

  // 4. Line Items Table
  const tableTopY = 560;
  const tableHeaderHeight = 24;

  // Header background rectangle
  page.drawRectangle({
    x: marginX,
    y: tableTopY - tableHeaderHeight,
    width: contentWidth,
    height: tableHeaderHeight,
    color: bgHeader,
  });

  // Header border
  page.drawRectangle({
    x: marginX,
    y: tableTopY - tableHeaderHeight,
    width: contentWidth,
    height: tableHeaderHeight,
    borderColor: borderLight,
    borderWidth: 1,
  });

  // Header Titles
  const colDescX = marginX + 12;
  const colQtyX = 330;
  const colUnitPriceX = 400;
  const colTotalX = 490;

  const headerY = tableTopY - 16;
  page.drawText('ITEM DESCRIPTION & SERVICE SPECIFICATION', {
    x: colDescX,
    y: headerY,
    size: 8.5,
    font: helveticaBold,
    color: primaryDark,
  });
  page.drawText('QTY', {
    x: colQtyX,
    y: headerY,
    size: 8.5,
    font: helveticaBold,
    color: primaryDark,
  });
  page.drawText('UNIT RATE', {
    x: colUnitPriceX,
    y: headerY,
    size: 8.5,
    font: helveticaBold,
    color: primaryDark,
  });
  page.drawText('AMOUNT', {
    x: colTotalX,
    y: headerY,
    size: 8.5,
    font: helveticaBold,
    color: primaryDark,
  });

  // Render Table Rows
  let currentY = tableTopY - tableHeaderHeight;
  const rowHeight = 32;

  spec.lineItems.forEach((item, index) => {
    currentY -= rowHeight;

    // Optional subtle alternate background
    if (index % 2 === 1) {
      page.drawRectangle({
        x: marginX,
        y: currentY,
        width: contentWidth,
        height: rowHeight,
        color: bgRowAlt,
      });
    }

    // Row bottom border
    page.drawLine({
      start: { x: marginX, y: currentY },
      end: { x: marginX + contentWidth, y: currentY },
      thickness: 1,
      color: borderLight,
    });

    // Outer side borders
    page.drawLine({
      start: { x: marginX, y: currentY },
      end: { x: marginX, y: currentY + rowHeight },
      thickness: 1,
      color: borderLight,
    });
    page.drawLine({
      start: { x: marginX + contentWidth, y: currentY },
      end: { x: marginX + contentWidth, y: currentY + rowHeight },
      thickness: 1,
      color: borderLight,
    });

    const textBaselineY = currentY + 11;

    // Item description
    page.drawText(item.description, {
      x: colDescX,
      y: textBaselineY,
      size: 9,
      font: helvetica,
      color: textDark,
    });

    // Quantity
    page.drawText(item.quantity.toString(), {
      x: colQtyX + 6,
      y: textBaselineY,
      size: 9,
      font: helvetica,
      color: textDark,
    });

    // Unit Price
    page.drawText(item.unitPrice, {
      x: colUnitPriceX + 4,
      y: textBaselineY,
      size: 9,
      font: helvetica,
      color: textDark,
    });

    // Total Price
    page.drawText(item.totalPrice, {
      x: colTotalX + 4,
      y: textBaselineY,
      size: 9.5,
      font: helveticaBold,
      color: textDark,
    });
  });

  // 5. Financial Summary Block (Right-Aligned)
  let summaryY = currentY - 25;
  const sumLabelX = 350;
  const sumValX = 490;

  // Subtotal
  page.drawText('SUBTOTAL:', {
    x: sumLabelX,
    y: summaryY,
    size: 9,
    font: helveticaBold,
    color: textMuted,
  });
  page.drawText(spec.subtotal, {
    x: sumValX,
    y: summaryY,
    size: 9.5,
    font: helveticaBold,
    color: textDark,
  });

  // Tax
  summaryY -= 18;
  page.drawText('TAX (0.00% B2B):', {
    x: sumLabelX,
    y: summaryY,
    size: 9,
    font: helveticaBold,
    color: textMuted,
  });
  page.drawText(spec.tax, {
    x: sumValX,
    y: summaryY,
    size: 9,
    font: helvetica,
    color: textMuted,
  });

  // Divider
  summaryY -= 10;
  page.drawLine({
    start: { x: sumLabelX, y: summaryY },
    end: { x: marginX + contentWidth, y: summaryY },
    thickness: 1,
    color: borderLight,
  });

  // Total Due Highlight Box
  summaryY -= 32;
  page.drawRectangle({
    x: sumLabelX - 8,
    y: summaryY - 6,
    width: contentWidth - (sumLabelX - marginX) + 8,
    height: 32,
    color: primaryDark,
  });

  page.drawText('TOTAL AMOUNT DUE:', {
    x: sumLabelX,
    y: summaryY + 6,
    size: 9.5,
    font: helveticaBold,
    color: rgb(0.9, 0.94, 1.0),
  });

  page.drawText(spec.totalAmountDue, {
    x: sumValX,
    y: summaryY + 5,
    size: 13,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });

  // 6. Status / Notice Callout Box if applicable (Left side below table)
  if (spec.statusNotice) {
    const noticeY = currentY - 80;
    page.drawRectangle({
      x: marginX,
      y: noticeY,
      width: 270,
      height: 48,
      color: rgb(0.98, 0.98, 0.98),
      borderColor: rgb(0.9, 0.9, 0.92),
      borderWidth: 1,
    });
    page.drawText('AUDIT CONFORMANCE NOTICE:', {
      x: marginX + 10,
      y: noticeY + 32,
      size: 7.5,
      font: helveticaBold,
      color: accentBlue,
    });
    page.drawText(spec.statusNotice, {
      x: marginX + 10,
      y: noticeY + 16,
      size: 8,
      font: helvetica,
      color: textDark,
    });
  }

  // 7. Payment Information & Footer
  const footerY = 90;
  page.drawLine({
    start: { x: marginX, y: footerY + 25 },
    end: { x: 612 - marginX, y: footerY + 25 },
    thickness: 1,
    color: borderLight,
  });

  page.drawText('REMITTANCE INSTRUCTIONS (ACH / WIRE):', {
    x: marginX,
    y: footerY + 12,
    size: 8,
    font: helveticaBold,
    color: textMuted,
  });
  page.drawText('Bank: Silicon Valley Commercial Bank  •  Routing: 121000358  •  Account: 9840219842', {
    x: marginX,
    y: footerY,
    size: 8,
    font: helvetica,
    color: textDark,
  });

  page.drawText(spec.footerNote, {
    x: marginX,
    y: footerY - 14,
    size: 7.5,
    font: helvetica,
    color: textMuted,
  });

  page.drawText(`Generated for ClearMatch Automated 3-Way AP Reconciliation Benchmarks • Document Trace: ${spec.invoiceNumber}`, {
    x: marginX,
    y: 35,
    size: 7,
    font: helvetica,
    color: textMuted,
  });

  return doc.save();
}

async function main() {
  console.log('[ClearMatch Synthetic Invoice Generator] Initializing PDF generation pipeline...');

  const outputDirs = [
    path.resolve(process.cwd(), 'public/synthetic-invoices'),
    path.resolve(process.cwd(), 'test-invoices'),
  ];

  // Ensure output directories exist
  for (const dir of outputDirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`[ClearMatch] Created directory: ${dir}`);
    }
  }

  // Common customer definition
  const customerName = 'ClearMatch Logistics & Tech Inc.';
  const customerAddress = [
    'Accounts Payable Division (AP-Dept)',
    '500 Market Street, Suite 200',
    'San Francisco, CA 94105 USA',
  ];

  const vendorName = 'Vertex Cloud Services LLC';
  const vendorAddress = [
    '100 Enterprise Way, Suite 400',
    'Austin, TX 78701 USA',
  ];
  const vendorContact = 'Email: billing@vertexcloud.io  •  Tel: +1 (512) 555-0199';

  // Specification 1: Clean Zero-Variance Match
  const specCleanMatch: InvoiceSpec = {
    fileName: 'vertex-clean-match-inv-2026-4401.pdf',
    vendorName,
    vendorAddress,
    vendorContact,
    customerName,
    customerAddress,
    invoiceNumber: 'INV-2026-4401',
    poReference: 'PO-2026-0104',
    invoiceDate: '2026-10-24',
    dueDate: '2026-11-23',
    paymentTerms: 'Net 30',
    currency: 'USD ($)',
    lineItems: [
      {
        description: 'Vertex Platform Enterprise Tier - Base Subscription (Monthly)',
        quantity: 1,
        unitPrice: '$850.00',
        totalPrice: '$850.00',
      },
      {
        description: 'Additional Provisioned Seats (Tier 1 Support)',
        quantity: 8,
        unitPrice: '$50.00',
        totalPrice: '$400.00',
      },
    ],
    subtotal: '$1,250.00',
    tax: '$0.00',
    totalAmountDue: '$1,250.00',
    statusNotice: 'Strict match with PO-2026-0104 authorized baseline (125,000¢).',
    footerNote: 'Terms: Net 30 days from invoice date. Vertex Cloud Services LLC is registered in Delaware, USA.',
  };

  // Specification 2: Seat Creep & Storage Overage Drift
  const specSeatCreepDrift: InvoiceSpec = {
    fileName: 'vertex-seat-creep-drift-inv-2026-4402.pdf',
    vendorName,
    vendorAddress,
    vendorContact,
    customerName,
    customerAddress,
    invoiceNumber: 'INV-2026-4402',
    poReference: 'PO-2026-0104',
    invoiceDate: '2026-10-25',
    dueDate: '2026-11-24',
    paymentTerms: 'Net 30',
    currency: 'USD ($)',
    lineItems: [
      {
        description: 'Vertex Platform Enterprise Tier - Base Subscription (Monthly)',
        quantity: 1,
        unitPrice: '$850.00',
        totalPrice: '$850.00',
      },
      {
        description: 'Additional Provisioned Seats (Tier 1 Support)',
        quantity: 8,
        unitPrice: '$54.50', // Creep: +$4.50 / seat (+3,600¢ total)
        totalPrice: '$436.00',
      },
      {
        description: 'Uncontracted Cloud Storage Overage (500GB)',
        quantity: 1,
        unitPrice: '$45.00', // Uncontracted unexpected item (+4,500¢)
        totalPrice: '$45.00',
      },
    ],
    subtotal: '$1,331.00',
    tax: '$0.00',
    totalAmountDue: '$1,331.00',
    statusNotice: 'Deliberate drift: +$81.00 (+8,100¢) vs PO-2026-0104 baseline ($1,250.00).',
    footerNote: 'Terms: Net 30 days from invoice date. Notice: Seat overage and cloud storage billed as provisioned.',
  };

  const invoicesToGenerate = [specCleanMatch, specSeatCreepDrift];

  for (const spec of invoicesToGenerate) {
    console.log(`[ClearMatch] Generating synthetic PDF: ${spec.fileName} (${spec.invoiceNumber})...`);
    const pdfBytes = await buildInvoicePdf(spec);

    for (const dir of outputDirs) {
      const targetFile = path.join(dir, spec.fileName);
      fs.writeFileSync(targetFile, pdfBytes);
      const stats = fs.statSync(targetFile);
      console.log(`  -> Wrote ${stats.size} bytes to ${targetFile}`);
    }
  }

  console.log('[ClearMatch] Synthetic invoice generation complete: 2 corporate invoice PDFs generated successfully.');
}

main().catch((err) => {
  console.error('[ClearMatch Generator Error]', err);
  process.exit(1);
});
