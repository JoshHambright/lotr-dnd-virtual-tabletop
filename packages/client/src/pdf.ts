/**
 * Reading a map out of a PDF.
 *
 * Published adventures ship their maps as PDF pages, so refusing anything but
 * an image meant the most common source of a battle map had to be screenshotted
 * first — at whatever resolution the screen happened to be, which is exactly
 * the sort of thing that then will not line up to a grid.
 *
 * This module is loaded on demand. pdf.js is about a megabyte, and a table that
 * never opens a PDF should never pay for it, so nothing here may be imported
 * from a module that loads at startup.
 */

import type { PDFDocumentProxy } from 'pdfjs-dist'

export interface LoadedPdf {
  pageCount: number
  /** Rasterizes a page, scaled so its longest edge is about `maxEdge`. */
  renderPage(pageNumber: number, maxEdge: number): Promise<{ blob: Blob; width: number; height: number }>
  destroy(): void
}

export async function loadPdf(file: File): Promise<LoadedPdf> {
  // The legacy build, deliberately. The modern one calls
  // Map.prototype.getOrInsertComputed, which is new enough that current
  // Chromium does not have it — so the default build fails outright on
  // browsers people are actually using. Legacy is transpiled and polyfilled.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

  // The worker keeps parsing off the main thread; without it a large map locks
  // the interface while it renders.
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const data = new Uint8Array(await file.arrayBuffer())
  // Tearing down is the loading task's job, not the document's, and the task
  // is what owns the worker.
  const task = pdfjs.getDocument({ data })
  const document: PDFDocumentProxy = await task.promise

  return {
    pageCount: document.numPages,

    async renderPage(pageNumber, maxEdge) {
      const page = await document.getPage(Math.max(1, Math.min(document.numPages, pageNumber)))
      const base = page.getViewport({ scale: 1 })

      // Render at the size we actually want rather than rendering at 1:1 and
      // resampling: a vector map stays crisp when rasterized at final scale.
      const scale = Math.min(4, Math.max(0.5, maxEdge / Math.max(base.width, base.height)))
      const viewport = page.getViewport({ scale })

      const canvas = document_createCanvas(Math.round(viewport.width), Math.round(viewport.height))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('This browser cannot render PDFs')

      // Maps are often drawn on transparency; a white ground beats black.
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: context, viewport }).promise

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.92))
      page.cleanup()
      if (!blob) throw new Error('Could not read that page')

      return { blob, width: canvas.width, height: canvas.height }
    },

    destroy() {
      void task.destroy()
    },
  }
}

/** Named apart so the PDF document variable does not shadow the DOM one. */
function document_createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = globalThis.document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}
