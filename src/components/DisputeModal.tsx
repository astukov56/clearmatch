'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface DisputeModalProps {
  isOpen: boolean;
  onClose: () => void;
  noticeText: string;
  invoiceNumber: string;
  poNumber?: string;
  vendorName: string;
}

export default function DisputeModal({
  isOpen,
  onClose,
  noticeText,
  invoiceNumber,
  poNumber,
  vendorName,
}: DisputeModalProps) {
  const [copied, setCopied] = useState(false);

  // Close modal on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const handleCopy = useCallback(async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(noticeText);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = noticeText;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [noticeText]);

  const handleDownloadTxt = useCallback(() => {
    const filename = `dispute-notice-${invoiceNumber || 'draft'}.txt`;
    const blob = new Blob([noticeText], { type: 'text/plain;charset=utf-8;' });

    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [noticeText, invoiceNumber]);

  if (!isOpen) return null;

  const subject = `DISPUTE: Invoice ${invoiceNumber || 'DRAFT'} - PO ${poNumber || 'UNKNOWN'}`;
  const mailtoHref = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
    noticeText
  )}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dispute-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white border border-neutral-300 rounded-lg shadow-xl max-w-3xl w-full flex flex-col max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3.5 bg-neutral-50/80">
          <div>
            <h3
              id="dispute-modal-title"
              className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-900 flex items-center gap-2"
            >
              <span className="w-2 h-2 rounded-full bg-rose-600 inline-block" />
              Vendor Dispute Notice — {invoiceNumber || 'Draft'}
            </h3>
            <p className="text-[11px] font-mono text-neutral-500 mt-0.5">
              Target Vendor: {vendorName} • Ready for Accounts Receivable dispatch
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="text-neutral-400 hover:text-neutral-700 font-mono text-sm p-1 rounded hover:bg-neutral-200/60 transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Content Body: Preformatted Monospace Notice */}
        <div className="p-4 sm:p-5 flex-1 overflow-y-auto bg-neutral-950">
          <pre className="font-mono text-[11px] sm:text-xs text-neutral-200 leading-relaxed whitespace-pre font-normal select-all overflow-x-auto">
            {noticeText}
          </pre>
        </div>

        {/* Action Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 px-5 py-3 bg-neutral-50">
          <span className="text-[11px] font-mono text-neutral-500 hidden sm:inline">
            Export or dispatch to vendor AP
          </span>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={mailtoHref}
              className="inline-flex items-center gap-1.5 font-mono text-xs px-3 py-1.5 rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-800 shadow-xs transition-colors cursor-pointer font-medium"
            >
              <span>✉</span>
              <span>Open in Email Client</span>
            </a>

            <button
              type="button"
              onClick={handleDownloadTxt}
              className="inline-flex items-center gap-1.5 font-mono text-xs px-3 py-1.5 rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-800 shadow-xs transition-colors cursor-pointer font-medium"
            >
              <span>⬇</span>
              <span>Download .txt</span>
            </button>

            <button
              type="button"
              onClick={handleCopy}
              className={`inline-flex items-center gap-1.5 font-mono text-xs px-3.5 py-1.5 rounded transition-all cursor-pointer font-medium ${
                copied
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-neutral-900 hover:bg-neutral-800 text-white shadow-xs'
              }`}
            >
              <span>{copied ? '✓' : '📋'}</span>
              <span>{copied ? 'Copied to Clipboard!' : 'Copy to Clipboard'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center font-mono text-xs px-3.5 py-1.5 rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-700 shadow-xs transition-colors cursor-pointer font-medium"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
