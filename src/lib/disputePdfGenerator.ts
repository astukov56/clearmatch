import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { formatCurrency } from './money';
import { PurchaseOrder, ReconciledInvoice } from './reconcile';
import {
  computeLineVarianceCents,
  formatDisputeLineDescription,
} from './disputeGenerator';

/**
 * Sanitizes strings to WinAnsi-safe ASCII characters for pdf-lib StandardFonts.
 */
function toWinAnsiSafe(text: string): string {
  return text
    .replace(/¢/g, 'c')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, '-')
    .replace(/×/g, 'x')
    .replace(/[^\x20-\x7E]/g, '');
}

/**
 * Truncates text to fit within a maximum character count.
 */
function truncateText(text: string, maxLength: number): string {
  const safe = toWinAnsiSafe(text);
  if (safe.length <= maxLength) return safe;
  return `${safe.slice(0, maxLength - 3)}...`;
}

/**
 * Generates a printable single-page corporate Accounts Payable Dispute Notice PDF
 * using pdf-lib (`PDFDocument`, `StandardFonts`, `rgb`).
 */
export async function generateDisputeNoticePdf(
  reconciliation: ReconciledInvoice,
  po: PurchaseOrder,
  policyName: string,
  operatorName = 'Accounts Payable Operator'
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // US Letter (8.5" x 11")
  const { width, height } = page.getSize();

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);
  const fontMonoBold = await pdfDoc.embedFont(StandardFonts.CourierBold);

  const issueDate = new Date().toISOString().split('T')[0];
  const poNumber = toWinAnsiSafe(po.po_number || reconciliation.po_number || 'UNKNOWN');
  const invoiceNumber = toWinAnsiSafe(reconciliation.invoice_number || 'UNKNOWN');
  const vendorName = toWinAnsiSafe(po.vendor_name || reconciliation.vendor_name || 'UNKNOWN');
  const traceId = toWinAnsiSafe(reconciliation.trace_id || `LOG-${poNumber}`);
  const activePolicy = toWinAnsiSafe(policyName || 'Strict Zero-Drift ($0.00)');
  const resolvedOperatorName = toWinAnsiSafe(
    operatorName && operatorName.trim().length > 0
      ? operatorName.trim()
      : 'Accounts Payable Operator'
  );

  const invoicedSubtotalCents =
    reconciliation.invoiced_subtotal_cents ??
    (reconciliation.line_items ?? []).reduce(
      (sum, item) => sum + item.invoiced_line_total_cents,
      0
    );

  const poSubtotalCents =
    typeof reconciliation.po_subtotal_cents === 'number'
      ? reconciliation.po_subtotal_cents
      : typeof po.subtotal_cents === 'number'
      ? po.subtotal_cents
      : invoicedSubtotalCents - reconciliation.total_variance_cents;

  const totalVarianceCents = reconciliation.total_variance_cents;
  const authorizedShortPayCents = poSubtotalCents;

  // Colors
  const slateHeaderBg = rgb(0.06, 0.08, 0.12);
  const white = rgb(1, 1, 1);
  const mutedLight = rgb(0.72, 0.78, 0.86);
  const darkText = rgb(0.09, 0.11, 0.15);
  const mutedText = rgb(0.4, 0.45, 0.52);
  const boxBg = rgb(0.97, 0.98, 0.99);
  const borderGray = rgb(0.84, 0.87, 0.91);
  const accentRose = rgb(0.75, 0.12, 0.24);
  const accentEmerald = rgb(0.05, 0.48, 0.34);

  const marginX = 42;
  const contentWidth = width - marginX * 2;

  // 1. Top Corporate Banner
  const bannerHeight = 68;
  const bannerBottomY = height - bannerHeight;
  page.drawRectangle({
    x: 0,
    y: bannerBottomY,
    width,
    height: bannerHeight,
    color: slateHeaderBg,
  });

  page.drawText('CLEAR MATCH // ACCOUNTS PAYABLE AUDIT DIVISION', {
    x: marginX,
    y: height - 28,
    size: 10,
    font: fontMonoBold,
    color: mutedLight,
  });

  page.drawText('FORMAL NOTICE OF INVOICE DISCREPANCY & SHORT-PAY ADJUSTMENT', {
    x: marginX,
    y: height - 48,
    size: 13,
    font: fontBold,
    color: white,
  });

  let cursorY = bannerBottomY - 22;

  // 2. Metadata Grid (2 Columns x 3 Rows)
  const metaHeight = 66;
  page.drawRectangle({
    x: marginX,
    y: cursorY - metaHeight,
    width: contentWidth,
    height: metaHeight,
    color: boxBg,
    borderColor: borderGray,
    borderWidth: 1,
  });

  const col1X = marginX + 12;
  const col2X = marginX + contentWidth / 2 + 10;

  const drawMetaPair = (label: string, value: string, x: number, y: number) => {
    page.drawText(label, {
      x,
      y,
      size: 8.5,
      font: fontBold,
      color: mutedText,
    });
    page.drawText(truncateText(value, 36), {
      x: x + 92,
      y,
      size: 9,
      font: fontMonoBold,
      color: darkText,
    });
  };

  drawMetaPair('TRACE ID:', traceId, col1X, cursorY - 18);
  drawMetaPair('ISSUE DATE:', issueDate, col2X, cursorY - 18);
  drawMetaPair('VENDOR NAME:', vendorName, col1X, cursorY - 36);
  drawMetaPair('INVOICE NO:', invoiceNumber, col2X, cursorY - 36);
  drawMetaPair('BASELINE PO:', poNumber, col1X, cursorY - 54);
  drawMetaPair('STP POLICY:', activePolicy, col2X, cursorY - 54);

  cursorY -= metaHeight + 20;

  // 3. Financial Summary Box
  page.drawText('FINANCIAL SUMMARY (INTEGER-CENT VERIFIED)', {
    x: marginX,
    y: cursorY,
    size: 9.5,
    font: fontBold,
    color: darkText,
  });

  cursorY -= 8;
  const finBoxHeight = 56;
  page.drawRectangle({
    x: marginX,
    y: cursorY - finBoxHeight,
    width: contentWidth,
    height: finBoxHeight,
    color: boxBg,
    borderColor: borderGray,
    borderWidth: 1,
  });

  const metricColWidth = contentWidth / 4;
  const metrics = [
    {
      label: 'CONTRACTED PO BASELINE',
      value: formatCurrency(poSubtotalCents, { useGrouping: true }),
      color: darkText,
    },
    {
      label: 'INVOICED SUBTOTAL',
      value: formatCurrency(invoicedSubtotalCents, { useGrouping: true }),
      color: darkText,
    },
    {
      label: 'DISPUTED VARIANCE',
      value: formatCurrency(totalVarianceCents, {
        showPositiveSign: true,
        useGrouping: true,
      }),
      color: totalVarianceCents !== 0 ? accentRose : accentEmerald,
    },
    {
      label: 'AUTHORIZED SHORT-PAY',
      value: formatCurrency(authorizedShortPayCents, { useGrouping: true }),
      color: accentEmerald,
    },
  ];

  metrics.forEach((m, idx) => {
    const cellX = marginX + idx * metricColWidth + 10;
    page.drawText(m.label, {
      x: cellX,
      y: cursorY - 20,
      size: 7.5,
      font: fontBold,
      color: mutedText,
    });
    page.drawText(toWinAnsiSafe(m.value), {
      x: cellX,
      y: cursorY - 40,
      size: 12,
      font: fontMonoBold,
      color: m.color,
    });
  });

  cursorY -= finBoxHeight + 22;

  // 4. Discrepant Line Items Table
  page.drawText('DISCREPANT LINE ITEMS BREAKDOWN', {
    x: marginX,
    y: cursorY,
    size: 9.5,
    font: fontBold,
    color: darkText,
  });

  cursorY -= 8;

  // Table Header
  const tableHeaderHeight = 20;
  page.drawRectangle({
    x: marginX,
    y: cursorY - tableHeaderHeight,
    width: contentWidth,
    height: tableHeaderHeight,
    color: slateHeaderBg,
  });

  const colDescX = marginX + 8;
  const colContractX = marginX + 245;
  const colInvoicedX = marginX + 355;
  const colVarianceX = marginX + 455;

  page.drawText('ITEM DESCRIPTION', {
    x: colDescX,
    y: cursorY - 13,
    size: 8,
    font: fontBold,
    color: white,
  });
  page.drawText('CONTRACTED', {
    x: colContractX,
    y: cursorY - 13,
    size: 8,
    font: fontBold,
    color: white,
  });
  page.drawText('INVOICED', {
    x: colInvoicedX,
    y: cursorY - 13,
    size: 8,
    font: fontBold,
    color: white,
  });
  page.drawText('VARIANCE', {
    x: colVarianceX,
    y: cursorY - 13,
    size: 8,
    font: fontBold,
    color: white,
  });

  cursorY -= tableHeaderHeight;

  const discrepantItems = (reconciliation.line_items ?? []).filter((item) => {
    const lineVarianceCents = computeLineVarianceCents(item);
    const statusStr = String(item.status);
    return (
      lineVarianceCents !== 0 ||
      item.variance_unit_price_cents !== 0 ||
      (statusStr !== 'MATCH' && statusStr !== 'MATCHED')
    );
  });

  const rowHeight = 22;
  if (discrepantItems.length === 0) {
    page.drawRectangle({
      x: marginX,
      y: cursorY - rowHeight,
      width: contentWidth,
      height: rowHeight,
      color: white,
      borderColor: borderGray,
      borderWidth: 0.75,
    });
    page.drawText('No line-item pricing or quantity discrepancies detected.', {
      x: colDescX,
      y: cursorY - 14,
      size: 8.5,
      font: fontRegular,
      color: mutedText,
    });
    cursorY -= rowHeight;
  } else {
    discrepantItems.slice(0, 8).forEach((item, idx) => {
      const lineVarianceCents = computeLineVarianceCents(item);
      const formattedDesc = truncateText(
        formatDisputeLineDescription(item.invoice_description, item.po_sku),
        42
      );
      const contractedText = `${item.expected_quantity} x ${formatCurrency(
        item.expected_unit_price_cents,
        { useGrouping: true }
      )}`;
      const invoicedText = `${item.invoiced_quantity} x ${formatCurrency(
        item.invoiced_unit_price_cents,
        { useGrouping: true }
      )}`;
      const varianceText = formatCurrency(lineVarianceCents, {
        showPositiveSign: true,
        useGrouping: true,
      });

      page.drawRectangle({
        x: marginX,
        y: cursorY - rowHeight,
        width: contentWidth,
        height: rowHeight,
        color: idx % 2 === 0 ? white : boxBg,
        borderColor: borderGray,
        borderWidth: 0.5,
      });

      page.drawText(formattedDesc, {
        x: colDescX,
        y: cursorY - 14,
        size: 8.5,
        font: fontRegular,
        color: darkText,
      });
      page.drawText(toWinAnsiSafe(contractedText), {
        x: colContractX,
        y: cursorY - 14,
        size: 8.5,
        font: fontMono,
        color: darkText,
      });
      page.drawText(toWinAnsiSafe(invoicedText), {
        x: colInvoicedX,
        y: cursorY - 14,
        size: 8.5,
        font: fontMono,
        color: darkText,
      });
      page.drawText(toWinAnsiSafe(varianceText), {
        x: colVarianceX,
        y: cursorY - 14,
        size: 8.5,
        font: fontMonoBold,
        color: lineVarianceCents !== 0 ? accentRose : darkText,
      });

      cursorY -= rowHeight;
    });
  }

  cursorY -= 22;

  // 5. Resolution Directive
  page.drawText('RESOLUTION DIRECTIVE', {
    x: marginX,
    y: cursorY,
    size: 9.5,
    font: fontBold,
    color: darkText,
  });

  cursorY -= 16;
  const directiveLines = [
    `1. Please issue a formal Credit Memo or revised invoice matching baseline contract ${poNumber} (${formatCurrency(poSubtotalCents, { useGrouping: true })}).`,
    `2. Pending receipt of revised billing, ClearMatch AP has authorized a Short-Pay Remittance of ${formatCurrency(authorizedShortPayCents, { useGrouping: true })} against Invoice #${invoiceNumber}.`,
    `3. Reference Audit Trace ID [${traceId}] on all revised billing documents and remittance correspondence.`,
  ];

  directiveLines.forEach((line) => {
    page.drawText(toWinAnsiSafe(line), {
      x: marginX,
      y: cursorY,
      size: 8.5,
      font: fontRegular,
      color: darkText,
    });
    cursorY -= 14;
  });

  // 6. Signature Block at Bottom (Operator Name strictly ABOVE the signature line)
  const sigBaseY = 92;
  page.drawText('Authorized Accounts Payable Representative:', {
    x: marginX,
    y: sigBaseY + 34,
    size: 9,
    font: fontBold,
    color: mutedText,
  });

  // Operator Name placed directly ABOVE the signature line
  page.drawText(resolvedOperatorName, {
    x: marginX,
    y: sigBaseY + 16,
    size: 11,
    font: fontMonoBold,
    color: darkText,
  });

  // Signature Line directly below operatorName
  page.drawText('________________________________________', {
    x: marginX,
    y: sigBaseY + 2,
    size: 10,
    font: fontMono,
    color: darkText,
  });

  // Label below the signature line
  page.drawText('Signature / Electronic Audit Stamp', {
    x: marginX,
    y: sigBaseY - 12,
    size: 8.5,
    font: fontRegular,
    color: mutedText,
  });

  return pdfDoc.save();
}

