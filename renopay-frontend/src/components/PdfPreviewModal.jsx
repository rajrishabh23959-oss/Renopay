import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import * as pdfjsLib from "pdfjs-dist";
import { downloadOrSharePdf } from "../lib/download";

import pdfWorker from "pdfjs-dist/build/pdf.worker.min.js?url";

// Configure pdfjs worker locally
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
} catch (e) {
  console.warn("Could not set PDF worker URL", e);
}

export function PdfPreviewModal({ isOpen, onClose, pdfBlob, title = "PDF Preview", filename = "document.pdf", loading = false }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [renderLoading, setRenderLoading] = useState(false);
  const [renderError, setRenderError] = useState(null);
  const containerRef = useRef(null);
  const canvasRefs = useRef([]);

  useEffect(() => {
    if (pdfBlob) {
      const url = URL.createObjectURL(pdfBlob);
      setBlobUrl(url);
      return () => {
        URL.revokeObjectURL(url);
        setBlobUrl(null);
      };
    } else {
      setBlobUrl(null);
    }
  }, [pdfBlob]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  // Render PDF pages on canvas when modal opens and pdfBlob is present
  useEffect(() => {
    if (!isOpen || !pdfBlob) {
      setNumPages(0);
      setRenderError(null);
      return;
    }

    let isMounted = true;
    setRenderLoading(true);
    setRenderError(null);

    async function loadAndRender() {
      try {
        const arrayBuffer = await pdfBlob.arrayBuffer();
        if (!isMounted) return;

        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdfDoc = await loadingTask.promise;
        if (!isMounted) return;

        setNumPages(pdfDoc.numPages);
        canvasRefs.current = canvasRefs.current.slice(0, pdfDoc.numPages);

        // Wait for canvas elements to mount
        setTimeout(async () => {
          if (!isMounted) return;
          const containerWidth = containerRef.current?.clientWidth
            ? Math.min(containerRef.current.clientWidth - 32, 760)
            : 550;

          const dpr = Math.min(window.devicePixelRatio || 1, 2);

          for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
            if (!isMounted) return;
            const page = await pdfDoc.getPage(pageNum);
            const canvas = canvasRefs.current[pageNum - 1];
            if (!canvas) continue;

            const unscaledViewport = page.getViewport({ scale: 1 });
            const targetWidth = Math.max(containerWidth, 320);
            const scale = (targetWidth / unscaledViewport.width);
            const viewport = page.getViewport({ scale: scale * dpr });

            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.style.width = `${viewport.width / dpr}px`;
            canvas.style.height = `${viewport.height / dpr}px`;

            const ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            await page.render({
              canvasContext: ctx,
              viewport: viewport,
            }).promise;
          }
          if (isMounted) setRenderLoading(false);
        }, 80);
      } catch (err) {
        console.error("PDF Canvas rendering error:", err);
        if (isMounted) {
          setRenderError(err.message || "Could not render PDF directly.");
          setRenderLoading(false);
        }
      }
    }

    loadAndRender();

    return () => {
      isMounted = false;
    };
  }, [isOpen, pdfBlob]);

  if (!isOpen) return null;

  const handleDownload = async () => {
    if (!pdfBlob) return;
    await downloadOrSharePdf(pdfBlob, filename);
  };

  const handleOpenNewTab = () => {
    if (blobUrl) {
      const a = document.createElement("a");
      a.href = blobUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try { document.body.removeChild(a); } catch (_) {}
      }, 500);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/70 backdrop-blur-md animate-fade-in" role="dialog" aria-modal="true" aria-label={title}>
      {/* Backdrop click */}
      <button type="button" aria-label="Close modal overlay" className="absolute inset-0 w-full h-full cursor-default bg-transparent border-0" onClick={onClose} tabIndex={-1} />

      {/* Modal Window — uses theme-aware colors */}
      <div className="relative z-10 w-full max-w-4xl h-[92vh] max-h-[880px] bg-surf border border-line rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-3.5 sm:px-4 py-3 border-b border-line bg-card shrink-0">
          <div className="flex items-center gap-2 sm:gap-2.5 overflow-hidden">
            <span className="text-xl shrink-0">📄</span>
            <div className="min-w-0">
              <h3 className="text-[13px] sm:text-[14px] font-bold text-textLight leading-tight truncate">{title}</h3>
              <div className="flex items-center gap-2">
                <p className="text-[10px] sm:text-[11px] text-muted font-mono truncate max-w-[140px] sm:max-w-[240px]">{filename}</p>
                {numPages > 0 && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/20">
                    {numPages} {numPages === 1 ? "page" : "pages"}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              onClick={handleOpenNewTab}
              disabled={!blobUrl || loading}
              className="px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-[12px] font-semibold bg-bg border border-line text-textLight hover:border-accent transition-colors disabled:opacity-40 flex items-center gap-1"
              title="Open in new browser tab"
            >
              <span>↗</span>
              <span className="hidden sm:inline">New Tab</span>
            </button>

            <button
              onClick={handleDownload}
              disabled={!pdfBlob || loading}
              className="px-3 sm:px-3.5 py-1.5 rounded-lg text-[11px] sm:text-[12px] font-bold bg-accent text-white shadow-accentGlow hover:brightness-110 transition-all disabled:opacity-40 flex items-center gap-1.5"
            >
              <span>⬇</span>
              <span>Download</span>
            </button>

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-textLight hover:bg-line/40 text-lg transition-colors ml-0.5"
              aria-label="Close modal"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div
          ref={containerRef}
          className="flex-1 bg-bg p-2 sm:p-4 relative overflow-y-auto overflow-x-hidden flex flex-col items-center"
        >
          {loading || renderLoading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg/90 z-20">
              <div className="w-10 h-10 border-[3px] border-accent/30 border-t-accent rounded-full animate-spin" />
              <p className="text-sm font-semibold text-textLight">
                {loading ? "Generating document…" : "Rendering PDF…"}
              </p>
              <p className="text-xs text-muted">Please wait a moment</p>
            </div>
          ) : null}

          {renderError ? (
            <div className="flex flex-col items-center justify-center my-auto p-6 text-center max-w-sm">
              <div className="w-12 h-12 rounded-full bg-warn/10 border border-warn/20 flex items-center justify-center text-2xl mb-3">
                ⚠️
              </div>
              <h4 className="text-sm font-bold text-textLight mb-1">Direct preview unavailable</h4>
              <p className="text-xs text-muted mb-4">
                Your browser blocked the inline preview. You can still download or open the PDF directly.
              </p>
              <div className="flex gap-2.5">
                <button
                  onClick={handleDownload}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-accent text-white shadow-accentGlow"
                >
                  Download PDF
                </button>
                {blobUrl && (
                  <button
                    onClick={handleOpenNewTab}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-card border border-line text-textLight hover:border-accent transition-colors"
                  >
                    Open in Tab
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="w-full flex flex-col items-center gap-4 py-2">
              {numPages === 0 && !loading && !renderLoading && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center text-3xl mb-4">
                    📄
                  </div>
                  <p className="text-sm font-semibold text-textLight mb-1">No PDF loaded</p>
                  <p className="text-xs text-muted">Use "View PDF" to generate your statement</p>
                </div>
              )}
              {Array.from({ length: numPages }).map((_, idx) => (
                <div
                  key={idx}
                  className="w-full flex flex-col items-center bg-white rounded-xl shadow-lg overflow-hidden border border-line/30"
                  style={{ maxWidth: "760px" }}
                >
                  {/* Page number label */}
                  <div className="w-full flex items-center justify-between px-3 py-1.5 bg-card border-b border-line/30">
                    <span className="text-[10px] font-semibold text-muted">Page {idx + 1} of {numPages}</span>
                    <span className="text-[10px] text-muted font-mono truncate max-w-[160px]">{filename}</span>
                  </div>
                  <canvas
                    ref={(el) => (canvasRefs.current[idx] = el)}
                    className="block w-full max-w-full"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer with page count and download hint */}
        {numPages > 0 && !renderError && (
          <div className="shrink-0 border-t border-line px-4 py-2 flex items-center justify-between bg-card">
            <span className="text-[11px] text-muted">
              {numPages} page{numPages !== 1 ? "s" : ""} • RenoPay Statement
            </span>
            <button
              onClick={handleDownload}
              disabled={!pdfBlob}
              className="text-[11px] font-semibold text-accent hover:underline disabled:opacity-40"
            >
              Save to device ↓
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
