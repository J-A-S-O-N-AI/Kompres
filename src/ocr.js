import { createWorker, PSM } from "tesseract.js";
// import { promises as fs } from "fs"; // Placeholder for future file operations
import sharp from "sharp";
// import os from "os"; // Placeholder for future OS-specific features

class OCRProcessor {
  constructor() {
    this.worker = null;
    this.initialized = false;
    this.currentLanguages = [];
    this.cancelled = false;
  }

  async initialize(languages = ["eng"], progressCallback = null) {
    try {
      if (this.worker && this.arraysEqual(this.currentLanguages, languages)) {
        return true;
      }
      if (this.worker) await this.terminate();

      this.worker = await createWorker({
        logger: (m) => progressCallback?.({ type: "ocr-log", ...m }),
        cacheMethod: "readOnly",
        workerPath: `file://${process.resourcesPath}/app.asar.unpacked/node_modules/tesseract.js/dist/worker.min.js`,
        langPath: process.resourcesPath,
      });

      const langString = languages.join("+");
      await this.worker.loadLanguage(langString);
      await this.worker.initialize(langString);

      await this.worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO_OSD,
      });

      this.currentLanguages = languages;
      this.initialized = true;
      progressCallback?.({
        type: "ocr-init",
        progress: 100,
        message: "OCR engine ready",
      });
      return true;
    } catch (error) {
      console.error("Error initializing OCR:", error);
      throw new Error(`Failed to initialize OCR: ${error.message}`);
    }
  }

  async processPDF(pdfPath, options = {}, progressCallback = null) {
    const { languages = ["eng"], density = 300 } = options;
    await this.initialize(languages, progressCallback);

    try {
      // First, get the number of pages in the PDF
      const numPages = await this.getPDFPageCount(pdfPath);

      const results = { pages: [], fullText: "", averageConfidence: 0 };
      let totalConfidence = 0;

      for (let i = 0; i < numPages; i++) {
        progressCallback?.({
          type: "ocr-page",
          current: i + 1,
          total: numPages,
          progress: ((i + 1) / numPages) * 100,
        });

        if (this.cancelled) break; // Allow cancellation

        try {
          // Extract page as image using Sharp
          const imageBuffer = await sharp(pdfPath, {
            page: i,
            density: density,
          })
            .png()
            .toBuffer();

          // Preprocess the image
          const preprocessedBuffer = await this.preprocessImage(imageBuffer);

          // Perform OCR
          const { data } = await this.worker.recognize(preprocessedBuffer);

          results.pages.push({
            pageNumber: i + 1,
            text: data.text,
            confidence: data.confidence,
          });
          results.fullText += data.text + "\n\n";
          totalConfidence += data.confidence;
        } catch (pageError) {
          console.error(`Error processing page ${i + 1}:`, pageError);
          // Add empty result for failed page
          results.pages.push({
            pageNumber: i + 1,
            text: "",
            confidence: 0,
          });
        }
      }

      results.averageConfidence = numPages > 0 ? totalConfidence / numPages : 0;
      return results;
    } catch (error) {
      console.error("Error processing PDF for OCR:", error);
      throw new Error(`Failed to process PDF for OCR: ${error.message}`);
    }
  }

  async getPDFPageCount(pdfPath) {
    try {
      // Try to get metadata from Sharp to determine page count
      const metadata = await sharp(pdfPath).metadata();
      return metadata.pages || 1;
    } catch (error) {
      console.warn("Could not determine PDF page count, defaulting to 1:", error.message);
      return 1;
    }
  }

  async preprocessImage(imageBuffer) {
    try {
      return await sharp(imageBuffer)
        .grayscale()
        .normalize()
        .sharpen({
          sigma: 1,
          flat: 1,
          jagged: 2,
        })
        .toBuffer();
    } catch (error) {
      console.warn("Image preprocessing failed, using original:", error.message);
      return imageBuffer;
    }
  }

  async terminate() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.initialized = false;
    }
    this.cancelled = false;
  }

  cancel() {
    this.cancelled = true;
  }

  arraysEqual(a, b) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((val, index) => val === b[index])
    );
  }
}

export { OCRProcessor };
