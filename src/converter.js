import { promises as fs } from "fs";
import { join, basename, dirname } from "path";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";
import archiver from "archiver";
import { v4 as uuidv4 } from "uuid";
import { createWriteStream } from "fs";
import { OCRProcessor } from "./ocr.js";
import os from "os";

class PDFConverter {
  constructor() {
    this.tempDir = null;
    this.ocrProcessor = null;
    this.supportedFormats = {
      epub: {
        mimeType: "application/epub+zip",
        extension: ".epub",
        name: "EPUB",
      },
      mobi: {
        mimeType: "application/x-mobipocket-ebook",
        extension: ".mobi",
        name: "MOBI",
      },
      pdf: {
        mimeType: "application/pdf",
        extension: ".pdf",
        name: "PDF",
      },
      azw3: {
        mimeType: "application/vnd.amazon.ebook",
        extension: ".azw3",
        name: "AZW3",
      },
    };
  }

  async convert(inputPath, outputPath, settings = {}, progressCallback = null) {
    const startTime = Date.now();

    // Default settings
    const config = {
      imageQuality: settings.imageQuality ?? 85,
      imageMaxWidth: settings.imageMaxWidth ?? 1200,
      preserveAnnotations: settings.preserveAnnotations !== false,
      optimizeForKindle: settings.optimizeForKindle !== false,
      includeMetadata: settings.includeMetadata !== false,
      compressionLevel: settings.compressionLevel ?? "balanced",
      grayscale: settings.grayscale ?? false,
      enableOCR: settings.enableOCR ?? false,
      ocrLanguages: settings.ocrLanguages ?? ["eng"],
      autoDetectScanned: settings.autoDetectScanned !== false,
      outputFormat: settings.outputFormat ?? "epub",
      ...settings,
    };

    // Validate output format
    if (!this.supportedFormats[config.outputFormat]) {
      throw new Error(`Unsupported output format: ${config.outputFormat}`);
    }

    const formatInfo = this.supportedFormats[config.outputFormat];

    // Apply sync optimization settings
    this.applySyncOptimization(config);

    // Estimate file size and adjust compression if needed
    await this.optimizeForSyncTarget(config, inputPath);

    let pdfDoc = null;
    try {
      // Create temporary directory
      this.tempDir = join(os.tmpdir(), `J.A.S.O.N._${uuidv4()}`);
      await fs.mkdir(this.tempDir, { recursive: true });

      progressCallback?.({ progress: 5, stage: "Loading PDF..." });

      // Load PDF using pdfjs-dist for metadata and text
      const pdfBuffer = await fs.readFile(inputPath);
      pdfDoc = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;
      const numPages = pdfDoc.numPages;

      progressCallback?.({ progress: 10, stage: "Analyzing document..." });

      // Check if OCR is needed
      let ocrResults = null;
      if (config.enableOCR || config.autoDetectScanned) {
        const needsOCR = await this.checkIfNeedsOCR(pdfDoc, config);

        if (needsOCR) {
          progressCallback?.({ progress: 15, stage: "Performing OCR..." });
          ocrResults = await this.performOCR(inputPath, config, (progress) =>
            progressCallback?.({
              progress: 15 + progress.progress * 0.1,
              stage: "OCR Processing...",
            })
          );
        }
      }

      progressCallback?.({ progress: 25, stage: "Extracting metadata..." });

      // Extract metadata
      const metadata = await this.extractMetadata(pdfDoc, basename(inputPath, ".pdf"));

      // Create EPUB structure
      const epubDir = join(this.tempDir, "epub");
      await this.createEPUBStructure(epubDir);

      progressCallback?.({ progress: 30, stage: "Preparing e-book structure..." });

      // Convert PDF pages to images using sharp
      const images = await this.convertPagesToImages(inputPath, numPages, epubDir, config, (p) => {
        // Map image conversion progress from 30% to 70%
        const imageProgress = 30 + p * 0.4;
        progressCallback?.({
          progress: imageProgress,
          stage: p < 50 ? "Converting pages..." : "Optimizing images...",
        });
      });

      progressCallback?.({ progress: 75, stage: "Generating content..." });

      // Extract text content (use OCR results if available, otherwise from pdfjs)
      const textContent = ocrResults
        ? ocrResults.pages.map((p) => p.text)
        : await this.extractTextContent(pdfDoc);

      // Generate EPUB content files
      await this.generateContentFiles(epubDir, images, textContent, metadata, config);

      progressCallback?.({ progress: 80, stage: "Creating output file..." });

      // Create output file based on format
      const outputFilePath =
        outputPath || join(dirname(inputPath), basename(inputPath, ".pdf") + formatInfo.extension);

      let finalOutputPath;

      // Route to format-specific converter
      switch (config.outputFormat) {
        case "epub":
          progressCallback?.({ progress: 82, stage: "Creating EPUB..." });
          finalOutputPath = await this.convertToEPUB(epubDir, outputFilePath, config);
          break;
        case "mobi":
          progressCallback?.({ progress: 82, stage: "Creating MOBI..." });
          finalOutputPath = await this.convertToMOBI(epubDir, outputFilePath, config);
          break;
        case "pdf":
          progressCallback?.({ progress: 82, stage: "Creating optimized PDF..." });
          finalOutputPath = await this.convertToPDF(epubDir, outputFilePath, config, images);
          break;
        case "azw3":
          progressCallback?.({ progress: 82, stage: "Creating AZW3..." });
          finalOutputPath = await this.convertToAZW3(epubDir, outputFilePath, config);
          break;
        default:
          throw new Error(`Conversion method not implemented for format: ${config.outputFormat}`);
      }

      progressCallback?.({ progress: 90, stage: "Optimizing for device..." });

      // Optimize for Kindle if needed
      if (
        config.optimizeForKindle &&
        (config.outputFormat === "epub" || config.outputFormat === "mobi")
      ) {
        await this.optimizeForKindle(finalOutputPath);
      }

      // Get output file size
      const stats = await fs.stat(finalOutputPath);
      const inputStats = await fs.stat(inputPath);

      progressCallback?.({ progress: 100, stage: "Complete!" });

      const endTime = Date.now();

      return {
        success: true,
        outputPath: finalOutputPath,
        outputSize: stats.size,
        inputSize: inputStats.size,
        compressionRatio: ((1 - stats.size / inputStats.size) * 100).toFixed(2),
        conversionTime: endTime - startTime,
        pageCount: images.length,
        format: formatInfo.name,
      };
    } catch (error) {
      console.error("Conversion failed:", error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  async extractMetadata(pdfDoc, defaultTitle) {
    const data = await pdfDoc.getMetadata();
    const info = data.info || {};
    return {
      title: info.Title || defaultTitle,
      author: info.Author || "Unknown Author",
      subject: info.Subject || "",
      keywords: info.Keywords || "",
      creator: info.Creator || "J.A.S.O.N. Converter",
      producer: info.Producer || "",
      creationDate: info.CreationDate || new Date().toISOString(),
      modificationDate: info.ModDate || new Date().toISOString(),
      pageCount: pdfDoc.numPages || 0,
    };
  }

  async extractTextContent(pdfDoc) {
    const pages = [];
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item) => item.str).join(" ");
      pages.push(pageText.trim());
    }
    return pages;
  }

  async createEPUBStructure(epubDir) {
    const dirs = [
      epubDir,
      join(epubDir, "META-INF"),
      join(epubDir, "OEBPS"),
      join(epubDir, "OEBPS", "images"),
      join(epubDir, "OEBPS", "css"),
      join(epubDir, "OEBPS", "text"),
    ];
    await Promise.all(dirs.map((dir) => fs.mkdir(dir, { recursive: true })));

    await fs.writeFile(join(epubDir, "mimetype"), "application/epub+zip");

    const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
    await fs.writeFile(join(epubDir, "META-INF", "container.xml"), containerXml);
  }

  async convertPagesToImages(pdfPath, numPages, epubDir, config, progressCallback) {
    const images = [];
    const density = 150; // Standard DPI for good quality on e-readers

    const conversionPromises = [];
    for (let i = 1; i <= numPages; i++) {
      conversionPromises.push(async () => {
        const optimizedPath = join(
          epubDir,
          "OEBPS",
          "images",
          `page_${String(i).padStart(3, "0")}.jpg`
        );
        let sharpInstance = sharp(pdfPath, { page: i - 1, density });

        if (config.grayscale) {
          sharpInstance = sharpInstance.grayscale();
        }

        let quality = config.imageQuality;
        if (config.compressionLevel === "maximum") {
          quality = Math.min(quality, 70);
        } else if (config.compressionLevel === "minimum") {
          quality = Math.max(quality, 90);
        }

        await sharpInstance
          .resize(config.imageMaxWidth, null, {
            withoutEnlargement: true,
            fit: "inside",
          })
          .jpeg({
            quality,
            progressive: true,
            optimizeScans: true,
            mozjpeg: true,
          })
          .toFile(optimizedPath);

        images[i - 1] = {
          id: `page_${String(i).padStart(3, "0")}`,
          href: `images/page_${String(i).padStart(3, "0")}.jpg`,
          mediaType: "image/jpeg",
        };
        progressCallback?.((i / numPages) * 100);
      });
    }

    // Run conversions with memory-optimized concurrency
    const concurrency = config.concurrency || Math.max(1, Math.floor(os.cpus().length / 2));
    const chunkSize = config.chunkSize || 10;

    // Process in chunks to manage memory usage
    for (let i = 0; i < conversionPromises.length; i += chunkSize) {
      const chunk = conversionPromises.slice(i, i + chunkSize).map((p) => p());

      // For high concurrency, process chunks sequentially
      // For low concurrency, process within chunk in parallel
      if (concurrency > 1) {
        // Process multiple chunks in parallel
        const parallelChunks = [];
        for (let j = 0; j < chunk.length; j += concurrency) {
          parallelChunks.push(chunk.slice(j, j + concurrency));
        }
        await Promise.all(parallelChunks.map((chunkGroup) => Promise.all(chunkGroup)));
      } else {
        // Process sequentially for low memory mode
        await Promise.all(chunk);
      }
    }

    progressCallback?.(100);
    return images.filter(Boolean); // Filter out any empty slots if errors occurred
  }

  async generateContentFiles(epubDir, images, textContent, metadata, config) {
    const uuid = uuidv4();
    const contentOpf = this.generateContentOPF(uuid, metadata, images, config);
    const tocNcx = this.generateTOCNCX(uuid, metadata, images);
    const css = this.generateCSS(config);
    const navXhtml = this.generateNavXHTML(metadata, images);

    await Promise.all([
      fs.writeFile(join(epubDir, "OEBPS", "content.opf"), contentOpf),
      fs.writeFile(join(epubDir, "OEBPS", "toc.ncx"), tocNcx),
      fs.writeFile(join(epubDir, "OEBPS", "css", "style.css"), css),
      fs.writeFile(join(epubDir, "OEBPS", "nav.xhtml"), navXhtml),
      ...images.map((image, i) => {
        const html = this.generatePageHTML(image, textContent[i] || "", i + 1, metadata, config);
        return fs.writeFile(
          join(epubDir, "OEBPS", "text", `page_${String(i + 1).padStart(3, "0")}.xhtml`),
          html
        );
      }),
    ]);
  }

  generateContentOPF(uuid, metadata, images, config) {
    const manifestItems = images
      .map(
        (img, i) => `
    <item id="${img.id}" href="${img.href}" media-type="${img.mediaType}"/>
    <item id="page_${String(i + 1).padStart(3, "0")}" href="text/page_${String(i + 1).padStart(3, "0")}.xhtml" media-type="application/xhtml+xml"/>`
      )
      .join("");
    const spineItems = images
      .map((img, i) => `    <itemref idref="page_${String(i + 1).padStart(3, "0")}"/>`)
      .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${this.escapeXml(metadata.title)}</dc:title>
    <dc:creator>${this.escapeXml(metadata.author)}</dc:creator>
    <dc:language>en</dc:language>
    <dc:date>${metadata.creationDate}</dc:date>
    <dc:publisher>J.A.S.O.N. Converter</dc:publisher>
    <meta property="dcterms:modified">${new Date().toISOString().split(".")[0] + "Z"}</meta>
    ${config.optimizeForKindle ? '<meta name="fixed-layout" content="true"/>' : ""}
    ${config.preserveAnnotations ? '<meta name="RegionMagnification" content="true"/>' : ""}
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="css/style.css" media-type="text/css"/>
${manifestItems}
  </manifest>
  <spine toc="ncx">
${spineItems}
  </spine>
</package>`;
  }

  generateTOCNCX(uuid, metadata, images) {
    const navPoints = images
      .map(
        (img, i) => `
    <navPoint id="navPoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>Page ${i + 1}</text></navLabel>
      <content src="text/page_${String(i + 1).padStart(3, "0")}.xhtml"/>
    </navPoint>`
      )
      .join("");

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${uuid}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="${images.length}"/>
    <meta name="dtb:maxPageNumber" content="${images.length}"/>
  </head>
  <docTitle><text>${this.escapeXml(metadata.title)}</text></docTitle>
  <navMap>${navPoints}</navMap>
</ncx>`;
  }

  generateNavXHTML(metadata, images) {
    const navItems = images
      .map(
        (img, i) =>
          `        <li><a href="text/page_${String(i + 1).padStart(3, "0")}.xhtml">Page ${i + 1}</a></li>`
      )
      .join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>${this.escapeXml(metadata.title)}</title>
  <meta charset="UTF-8"/>
</head>
<body>
  <nav epub:type="toc">
    <h1>Table of Contents</h1>
    <ol>${navItems}</ol>
  </nav>
</body>
</html>`;
  }

  generateCSS(config) {
    return `body, html { margin: 0; padding: 0; }
.page-container { width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; position: relative; }
.page-image { max-width: 100%; max-height: 100%; object-fit: contain; }
.page-text { position: absolute; top: 0; left: 0; width: 100%; height: 100%; color: transparent; z-index: -1; overflow: hidden; font-size: 1px; }
${config.preserveAnnotations ? ".annotation-layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }" : ""}`;
  }

  generatePageHTML(image, textContent, pageNum, metadata, config) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>${this.escapeXml(metadata.title)} - Page ${pageNum}</title>
  <link rel="stylesheet" type="text/css" href="../css/style.css"/>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, height=device-height, initial-scale=1.0"/>
</head>
<body>
  <div class="page-container">
    <img class="page-image" src="../${image.href}" alt="Page ${pageNum}"/>
    ${config.includeMetadata ? `<div class="page-text" aria-hidden="true">${this.escapeXml(textContent)}</div>` : ""}
    ${config.preserveAnnotations ? '<div class="annotation-layer"></div>' : ""}
  </div>
</body>
</html>`;
  }

  async convertToEPUB(epubDir, outputPath, config) {
    // eslint-disable-next-line no-unused-vars
    console.log("Convert to EPUB config:", config); // Placeholder for future EPUB-specific options
    await this.packageEPUB(epubDir, outputPath);
    return outputPath;
  }

  async convertToMOBI(epubDir, outputPath, config) {
    // eslint-disable-next-line no-unused-vars
    console.log("Convert to MOBI config:", config); // Placeholder for future MOBI-specific options
    // First create EPUB, then convert to MOBI
    const tempEpubPath = outputPath.replace(".mobi", ".epub");
    await this.packageEPUB(epubDir, tempEpubPath);

    try {
      // Try to convert EPUB to MOBI using calibre if available
      await this.convertEPUBToMOBI(tempEpubPath, outputPath);
      // Clean up temporary EPUB
      await fs.unlink(tempEpubPath).catch(() => {});
      return outputPath;
    } catch (error) {
      console.warn("MOBI conversion failed, falling back to EPUB:", error.message);
      // Rename EPUB to MOBI as fallback (it's still readable on most devices)
      await fs.rename(tempEpubPath, outputPath);
      return outputPath;
    }
  }

  async convertToPDF(epubDir, outputPath, config, images) {
    // For PDF output, create an optimized PDF from the images
    try {
      const { PDFDocument } = await import("pdf-lib");
      const pdfDoc = await PDFDocument.create();

      for (const image of images) {
        const imagePath = join(epubDir, "OEBPS", image.href);
        const imageBuffer = await fs.readFile(imagePath);

        let pdfImage;
        if (image.mediaType === "image/jpeg") {
          pdfImage = await pdfDoc.embedJpg(imageBuffer);
        } else {
          // Convert to JPEG first
          const jpegBuffer = await sharp(imageBuffer).jpeg().toBuffer();
          pdfImage = await pdfDoc.embedJpg(jpegBuffer);
        }

        const page = pdfDoc.addPage([pdfImage.width, pdfImage.height]);
        page.drawImage(pdfImage, {
          x: 0,
          y: 0,
          width: pdfImage.width,
          height: pdfImage.height,
        });
      }

      const pdfBytes = await pdfDoc.save();
      await fs.writeFile(outputPath, pdfBytes);
      return outputPath;
    } catch (error) {
      console.warn("PDF creation failed:", error.message);
      throw new Error(`PDF conversion failed: ${error.message}`);
    }
  }

  async convertToAZW3(epubDir, outputPath, config) {
    // eslint-disable-next-line no-unused-vars
    console.log("Convert to AZW3 config:", config); // Placeholder for future AZW3-specific options
    // AZW3 conversion is similar to MOBI but requires different tools
    // For now, fall back to EPUB format with AZW3 extension
    const tempEpubPath = outputPath.replace(".azw3", ".epub");
    await this.packageEPUB(epubDir, tempEpubPath);

    try {
      // Try to convert using calibre if available
      await this.convertEPUBToAZW3(tempEpubPath, outputPath);
      await fs.unlink(tempEpubPath).catch(() => {});
      return outputPath;
    } catch (error) {
      console.warn("AZW3 conversion failed, using EPUB format:", error.message);
      await fs.rename(tempEpubPath, outputPath);
      return outputPath;
    }
  }

  async packageEPUB(epubDir, outputPath) {
    return new Promise((resolve, reject) => {
      const output = createWriteStream(outputPath);
      const archive = archiver("zip", { zlib: { level: 9 } });
      output.on("close", resolve);
      archive.on("error", reject);
      archive.pipe(output);
      archive.append("application/epub+zip", { name: "mimetype", store: true });
      archive.directory(join(epubDir, "META-INF"), "META-INF");
      archive.directory(join(epubDir, "OEBPS"), "OEBPS");
      archive.finalize();
    });
  }

  async convertEPUBToMOBI(epubPath, mobiPath) {
    // Try to use calibre's ebook-convert command
    const { spawn } = await import("child_process");
    return new Promise((resolve, reject) => {
      const process = spawn("ebook-convert", [epubPath, mobiPath], {
        stdio: "inherit",
      });

      process.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ebook-convert failed with code ${code}`));
        }
      });

      process.on("error", (error) => {
        reject(new Error(`Failed to start ebook-convert: ${error.message}`));
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        process.kill();
        reject(new Error("MOBI conversion timed out"));
      }, 300000);
    });
  }

  async convertEPUBToAZW3(epubPath, azw3Path) {
    // Similar to MOBI conversion but targeting AZW3
    const { spawn } = await import("child_process");
    return new Promise((resolve, reject) => {
      const process = spawn("ebook-convert", [epubPath, azw3Path], {
        stdio: "inherit",
      });

      process.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ebook-convert failed with code ${code}`));
        }
      });

      process.on("error", (error) => {
        reject(new Error(`Failed to start ebook-convert: ${error.message}`));
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        process.kill();
        reject(new Error("AZW3 conversion timed out"));
      }, 300000);
    });
  }

  async optimizeForKindle(epubPath) {
    const stats = await fs.stat(epubPath);
    const maxSize = 650 * 1024 * 1024; // 650MB
    if (stats.size > maxSize) {
      console.warn(
        `Warning: File size (${(stats.size / 1024 / 1024).toFixed(2)}MB) exceeds Kindle Send to Kindle limit.`
      );
    }
    return true;
  }

  escapeXml(text) {
    return text.replace(
      /[<>&"']/g,
      (c) =>
        ({
          "<": "&lt;",
          ">": "&gt;",
          "&": "&amp;",
          '"': "&quot;",
          "'": "&apos;",
        })[c]
    );
  }

  async cleanup() {
    if (this.tempDir) {
      await fs
        .rm(this.tempDir, { recursive: true, force: true })
        .catch((err) => console.error("Error cleaning up temp dir:", err));
      this.tempDir = null;
    }
    if (this.ocrProcessor) {
      await this.ocrProcessor.terminate().catch(() => {});
      this.ocrProcessor = null;
    }
  }

  async checkIfNeedsOCR(pdfDoc, config) {
    if (!config.autoDetectScanned && !config.enableOCR) return false;

    let textLength = 0;
    const numPagesToCheck = Math.min(pdfDoc.numPages, 5); // Check first 5 pages
    for (let i = 1; i <= numPagesToCheck; i++) {
      const page = await pdfDoc.getPage(i);
      const content = await page.getTextContent();
      textLength += content.items.map((item) => item.str).join("").length;
    }
    const avgTextPerPage = textLength / numPagesToCheck;
    return avgTextPerPage < 100; // Threshold for considering a PDF scanned
  }

  async performOCR(pdfPath, config, progressCallback) {
    try {
      if (!this.ocrProcessor) this.ocrProcessor = new OCRProcessor();

      const ocrProgress = (p) => progressCallback?.(15 + p.progress * 0.05);
      await this.ocrProcessor.initialize(config.ocrLanguages, ocrProgress);

      const results = await this.ocrProcessor.processPDF(
        pdfPath,
        { languages: config.ocrLanguages },
        ocrProgress
      );

      console.log(`OCR completed with ${results.averageConfidence.toFixed(1)}% confidence`);
      return results;
    } catch (error) {
      console.error("OCR processing failed:", error);
      return null;
    }
  }

  applySyncOptimization(config) {
    // Apply sync-specific optimizations
    if (config.optimizeForSync) {
      // Aggressive compression for sync optimization
      config.compressionLevel = "maximum";

      // Reduce image quality for smaller file sizes
      if (config.imageQuality > 70) {
        config.imageQuality = Math.max(50, config.imageQuality - 20);
      }

      // Enable grayscale for additional size reduction
      config.grayscale = true;

      // Use more aggressive image resizing
      if (config.imageMaxWidth > 1000) {
        config.imageMaxWidth = Math.max(800, config.imageMaxWidth - 200);
      }

      console.log("Applied sync optimization settings for faster device syncing");
    }

    // Apply memory optimization settings
    this.applyMemoryOptimization(config);
  }

  applyMemoryOptimization(config) {
    const memoryMode = config.memoryOptimization || "auto";

    switch (memoryMode) {
      case "low-memory":
        // Use minimal memory by processing in smaller chunks
        config.chunkSize = 5; // Process 5 pages at a time
        config.concurrency = 1; // Single threaded processing
        console.log("Using low memory mode - slower but uses less RAM");
        break;
      case "high-performance":
        // Maximize performance with higher memory usage
        config.chunkSize = 20; // Process more pages at once
        config.concurrency = os.cpus().length;
        console.log("Using high performance mode - faster but uses more RAM");
        break;
      case "balanced":
      default:
        // Balanced approach
        config.chunkSize = 10;
        config.concurrency = Math.max(1, Math.floor(os.cpus().length / 2));
        console.log("Using balanced memory mode");
        break;
    }
  }

  async optimizeForSyncTarget(config, inputPath) {
    if (!config.optimizeForSync || config.syncTargetSize === "no-limit") {
      return;
    }

    try {
      // Get input file size
      const inputStats = await fs.stat(inputPath);
      const inputSizeMB = inputStats.size / (1024 * 1024);

      // Determine target size
      let targetSizeMB;
      switch (config.syncTargetSize) {
        case "10":
          targetSizeMB = 10;
          break;
        case "25":
          targetSizeMB = 25;
          break;
        case "50":
          targetSizeMB = 50;
          break;
        case "auto":
        default:
          // Auto mode: aim for 70% reduction or 50MB max, whichever is smaller
          targetSizeMB = Math.min(inputSizeMB * 0.3, 50);
          break;
      }

      // If input is already smaller than target, no need for aggressive optimization
      if (inputSizeMB <= targetSizeMB) {
        console.log(`Input file (${inputSizeMB.toFixed(1)}MB) is already smaller than target size`);
        return;
      }

      // Calculate required compression ratio
      const requiredRatio = targetSizeMB / inputSizeMB;
      console.log(
        `Optimizing for ${targetSizeMB}MB target (input: ${inputSizeMB.toFixed(1)}MB, ratio: ${(requiredRatio * 100).toFixed(1)}%)`
      );

      // Apply aggressive optimization based on required compression ratio
      if (requiredRatio < 0.3) {
        // Need very aggressive compression
        config.imageQuality = Math.max(30, config.imageQuality - 30);
        config.imageMaxWidth = Math.max(600, config.imageMaxWidth - 400);
        config.compressionLevel = "maximum";
        console.log("Applying very aggressive optimization for large files");
      } else if (requiredRatio < 0.5) {
        // Need moderate compression
        config.imageQuality = Math.max(50, config.imageQuality - 20);
        config.imageMaxWidth = Math.max(800, config.imageMaxWidth - 200);
        console.log("Applying moderate optimization for medium files");
      }
    } catch (error) {
      console.warn("Could not optimize for sync target:", error.message);
    }
  }
}

export { PDFConverter };
