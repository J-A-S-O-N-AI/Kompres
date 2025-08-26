import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { Dropbox } from "dropbox";
import { promises as fs } from "fs";
import { basename } from "path";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import Store from "electron-store";

class CloudStorageManager {
  constructor() {
    this.store = new Store({ name: "cloud-storage" });
    this.providers = {
      googleDrive: null,
      dropbox: null,
      s3: null,
    };
    this.initialized = {
      googleDrive: false,
      dropbox: false,
      s3: false,
    };
    this.s3Bucket = null;
  }

  /**
   * Initialize cloud storage provider
   * @param {string} provider - Provider name ('googleDrive', 'dropbox', 's3')
   * @param {Object} credentials - Provider-specific credentials
   */
  async initialize(provider, credentials) {
    try {
      switch (provider) {
        case "googleDrive":
          await this.initializeGoogleDrive(credentials);
          break;
        case "dropbox":
          await this.initializeDropbox(credentials);
          break;
        case "s3":
          await this.initializeS3(credentials);
          break;
        default:
          throw new Error(`Unknown provider: ${provider}`);
      }
      return true;
    } catch (error) {
      console.error(`Error initializing ${provider}:`, error);
      throw error;
    }
  }

  /**
   * Initialize Google Drive
   * @param {Object} credentials - Google Drive credentials
   */
  async initializeGoogleDrive(credentials) {
    try {
      const { Storage } = await import("@google-cloud/storage");
      // Store credentials securely
      this.store.set("googleDrive.credentials", credentials);

      // Initialize Google Cloud Storage client
      this.providers.googleDrive = new Storage({
        projectId: credentials.projectId,
        keyFilename: credentials.keyFilename || undefined,
        credentials: credentials.keyFilename
          ? undefined
          : {
              client_email: credentials.client_email,
              private_key: credentials.private_key,
            },
      });

      // Verify connection
      const [buckets] = await this.providers.googleDrive.getBuckets();

      // Set default bucket if not set
      if (buckets && buckets.length > 0 && !this.store.get("googleDrive.defaultBucket")) {
        this.store.set("googleDrive.defaultBucket", buckets[0].name);
      }

      this.initialized.googleDrive = true;
      this.store.set("googleDrive.initialized", true);

      return true;
    } catch (error) {
      this.initialized.googleDrive = false;
      throw new Error(`Google Drive initialization failed: ${error.message}`);
    }
  }

  /**
   * Initialize Dropbox
   * @param {Object} credentials - Dropbox credentials
   */
  async initializeDropbox(credentials) {
    try {
      // Store credentials securely
      this.store.set("dropbox.credentials", {
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken || null,
        clientId: credentials.clientId || null,
        clientSecret: credentials.clientSecret || null,
      });

      // Initialize Dropbox client
      this.providers.dropbox = new Dropbox({
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        selectUser: credentials.selectUser,
      });

      // Verify connection
      const account = await this.providers.dropbox.usersGetCurrentAccount();

      this.initialized.dropbox = true;
      this.store.set("dropbox.initialized", true);
      this.store.set("dropbox.account", {
        name: account.result.name.display_name,
        email: account.result.email,
      });

      return true;
    } catch (error) {
      this.initialized.dropbox = false;
      throw new Error(`Dropbox initialization failed: ${error.message}`);
    }
  }

  /**
   * Initialize AWS S3
   * @param {Object} credentials - AWS S3 credentials
   */
  async initializeS3(credentials) {
    try {
      // Store credentials securely
      this.store.set("s3.credentials", {
        region: credentials.region,
        bucket: credentials.bucket,
      });

      // Initialize S3 client
      this.providers.s3 = new S3Client({
        region: credentials.region || "us-east-1",
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          sessionToken: credentials.sessionToken,
        },
      });

      // Store bucket name for operations
      this.s3Bucket = credentials.bucket;

      // Verify connection by listing objects
      const command = new ListObjectsV2Command({
        Bucket: this.s3Bucket,
        MaxKeys: 1,
      });
      await this.providers.s3.send(command);

      this.initialized.s3 = true;
      this.store.set("s3.initialized", true);

      return true;
    } catch (error) {
      this.initialized.s3 = false;
      throw new Error(`AWS S3 initialization failed: ${error.message}`);
    }
  }

  /**
   * Upload file to cloud storage
   * @param {string} provider - Provider name
   * @param {string} localPath - Local file path
   * @param {string} remotePath - Remote file path
   * @param {Object} options - Upload options
   * @param {Function} progressCallback - Progress callback
   */
  async uploadFile(provider, localPath, remotePath, options = {}, progressCallback = null) {
    if (!this.initialized[provider]) {
      throw new Error(`${provider} is not initialized`);
    }

    const fileStats = await fs.stat(localPath);
    const fileSize = fileStats.size;

    try {
      switch (provider) {
        case "googleDrive":
          return await this.uploadToGoogleDrive(
            localPath,
            remotePath,
            fileSize,
            options,
            progressCallback
          );
        case "dropbox":
          return await this.uploadToDropbox(
            localPath,
            remotePath,
            fileSize,
            options,
            progressCallback
          );
        case "s3":
          return await this.uploadToS3(localPath, remotePath, fileSize, options, progressCallback);
        default:
          throw new Error(`Unknown provider: ${provider}`);
      }
    } catch (error) {
      console.error(`Upload error for ${provider}:`, error);
      throw error;
    }
  }

  /**
   * Upload to Google Drive
   */
  async uploadToGoogleDrive(localPath, remotePath, fileSize, options, progressCallback) {
    const bucketName = options.bucket || this.store.get("googleDrive.defaultBucket");
    if (!bucketName) {
      throw new Error("No Google Cloud Storage bucket specified");
    }

    const bucket = this.providers.googleDrive.bucket(bucketName);
    const file = bucket.file(remotePath);

    let uploadedBytes = 0;

    // Track upload progress
    const stream = createReadStream(localPath);
    stream.on("data", (chunk) => {
      uploadedBytes += chunk.length;
      if (progressCallback) {
        progressCallback({
          provider: "googleDrive",
          bytesUploaded: uploadedBytes,
          totalBytes: fileSize,
          percentage: Math.round((uploadedBytes / fileSize) * 100),
        });
      }
    });

    // Upload with resumable upload for large files
    const uploadOptions = {
      resumable: fileSize > 5 * 1024 * 1024, // Resumable for files > 5MB
      metadata: {
        contentType: options.contentType || "application/epub+zip",
        metadata: {
          originalName: basename(localPath),
          uploadedAt: new Date().toISOString(),
          ...options.metadata,
        },
      },
    };

    // Use file.createWriteStream for progress tracking
    await new Promise((resolve, reject) => {
      const dest = file.createWriteStream(uploadOptions);
      stream.pipe(dest);
      dest.on("error", reject);
      dest.on("finish", resolve);
    });

    // Get public URL if requested
    let publicUrl = null;
    if (options.makePublic) {
      await file.makePublic();
      publicUrl = file.publicUrl();
    }

    return {
      success: true,
      provider: "googleDrive",
      remotePath,
      bucket: bucketName,
      publicUrl,
      size: fileSize,
    };
  }

  /**
   * Upload to Dropbox
   */
  async uploadToDropbox(localPath, remotePath, fileSize, options, progressCallback) {
    const contents = await fs.readFile(localPath);

    // Ensure remote path starts with /
    if (!remotePath.startsWith("/")) {
      remotePath = "/" + remotePath;
    }

    // Use upload session for large files
    if (fileSize > 150 * 1024 * 1024) {
      // 150MB
      return await this.uploadLargeFileToDropbox(localPath, remotePath, fileSize, progressCallback);
    }

    // Regular upload for smaller files
    const response = await this.providers.dropbox.filesUpload({
      path: remotePath,
      contents: contents,
      mode: { ".tag": "overwrite" },
      autorename: options.autorename || false,
      mute: options.mute || false,
    });

    // Create shared link if requested
    let shareLink = null;
    if (options.createShareLink) {
      try {
        const linkResponse = await this.providers.dropbox.sharingCreateSharedLinkWithSettings({
          path: remotePath,
          settings: {
            requested_visibility: { ".tag": "public" },
            audience: { ".tag": "public" },
          },
        });
        shareLink = linkResponse.result.url;
      } catch (error) {
        // Link might already exist
        const existingLinks = await this.providers.dropbox.sharingListSharedLinks({
          path: remotePath,
        });
        if (existingLinks.result.links.length > 0) {
          shareLink = existingLinks.result.links[0].url;
        }
      }
    }

    return {
      success: true,
      provider: "dropbox",
      remotePath: response.result.path_display,
      id: response.result.id,
      shareLink,
      size: response.result.size,
    };
  }

  /**
   * Upload large file to Dropbox using sessions
   */
  async uploadLargeFileToDropbox(localPath, remotePath, fileSize, progressCallback) {
    const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB chunks
    const fileHandle = await fs.open(localPath, "r");
    let offset = 0;
    let sessionId = null;

    try {
      while (offset < fileSize) {
        const chunkSize = Math.min(CHUNK_SIZE, fileSize - offset);
        const buffer = Buffer.alloc(chunkSize);
        await fileHandle.read(buffer, 0, chunkSize, offset);

        if (offset === 0) {
          // Start upload session
          const startResponse = await this.providers.dropbox.filesUploadSessionStart({
            contents: buffer,
            close: false,
          });
          sessionId = startResponse.result.session_id;
        } else if (offset + chunkSize >= fileSize) {
          // Finish upload session
          const cursor = {
            session_id: sessionId,
            offset: offset,
          };
          const commit = {
            path: remotePath,
            mode: { ".tag": "overwrite" },
            autorename: false,
            mute: false,
          };
          await this.providers.dropbox.filesUploadSessionFinish({
            cursor: cursor,
            commit: commit,
            contents: buffer,
          });
        } else {
          // Append to upload session
          const cursor = {
            session_id: sessionId,
            offset: offset,
          };
          await this.providers.dropbox.filesUploadSessionAppendV2({
            cursor: cursor,
            close: false,
            contents: buffer,
          });
        }

        offset += chunkSize;

        if (progressCallback) {
          progressCallback({
            provider: "dropbox",
            bytesUploaded: offset,
            totalBytes: fileSize,
            percentage: Math.round((offset / fileSize) * 100),
          });
        }
      }

      return {
        success: true,
        provider: "dropbox",
        remotePath,
        size: fileSize,
      };
    } finally {
      await fileHandle.close();
    }
  }

  /**
   * Upload to AWS S3
   */
  async uploadToS3(localPath, remotePath, fileSize, options, progressCallback) {
    const fileStream = createReadStream(localPath);
    const bucket = options.bucket || this.s3Bucket;

    if (!bucket) {
      throw new Error("No S3 bucket specified");
    }

    // Prepare upload parameters
    const uploadParams = {
      Bucket: bucket,
      Key: remotePath,
      Body: fileStream,
      ContentType: options.contentType || "application/epub+zip",
      ServerSideEncryption: options.encryption || "AES256",
      Metadata: {
        originalName: basename(localPath),
        uploadedAt: new Date().toISOString(),
        ...options.metadata,
      },
    };

    // Add ACL if specified
    if (options.acl) {
      uploadParams.ACL = options.acl;
    }

    // Upload with progress tracking
    let uploadedBytes = 0;
    fileStream.on("data", (chunk) => {
      uploadedBytes += chunk.length;
      if (progressCallback) {
        progressCallback({
          provider: "s3",
          bytesUploaded: uploadedBytes,
          totalBytes: fileSize,
          percentage: Math.round((uploadedBytes / fileSize) * 100),
        });
      }
    });

    const command = new PutObjectCommand(uploadParams);
    const response = await this.providers.s3.send(command);

    // Generate public URL if bucket is public
    let publicUrl = null;
    if (options.generateUrl) {
      const region = this.store.get("s3.credentials.region") || "us-east-1";
      // us-east-1 does not use region in URL
      if (region === "us-east-1") {
        publicUrl = `https://${bucket}.s3.amazonaws.com/${remotePath}`;
      } else {
        publicUrl = `https://${bucket}.s3.${region}.amazonaws.com/${remotePath}`;
      }
    }

    return {
      success: true,
      provider: "s3",
      remotePath,
      bucket,
      etag: response.ETag,
      versionId: response.VersionId,
      publicUrl,
      size: fileSize,
    };
  }

  /**
   * Download file from cloud storage
   * @param {string} provider - Provider name
   * @param {string} remotePath - Remote file path
   * @param {string} localPath - Local file path
   * @param {Object} options - Download options
   * @param {Function} progressCallback - Progress callback
   */
  async downloadFile(provider, remotePath, localPath, options = {}, progressCallback = null) {
    if (!this.initialized[provider]) {
      throw new Error(`${provider} is not initialized`);
    }

    try {
      switch (provider) {
        case "googleDrive":
          return await this.downloadFromGoogleDrive(
            remotePath,
            localPath,
            options,
            progressCallback
          );
        case "dropbox":
          return await this.downloadFromDropbox(remotePath, localPath, options, progressCallback);
        case "s3":
          return await this.downloadFromS3(remotePath, localPath, options, progressCallback);
        default:
          throw new Error(`Unknown provider: ${provider}`);
      }
    } catch (error) {
      console.error(`Download error for ${provider}:`, error);
      throw error;
    }
  }

  /**
   * Download from Google Drive
   */
  async downloadFromGoogleDrive(remotePath, localPath, options, progressCallback) {
    const bucketName = options.bucket || this.store.get("googleDrive.defaultBucket");
    if (!bucketName) {
      throw new Error("No Google Cloud Storage bucket specified");
    }

    const bucket = this.providers.googleDrive.bucket(bucketName);
    const file = bucket.file(remotePath);

    // Get file metadata for size
    const [metadata] = await file.getMetadata();
    const fileSize = parseInt(metadata.size);

    // Create write stream
    const writeStream = createWriteStream(localPath);
    let downloadedBytes = 0;

    // Download with progress tracking
    const readStream = file.createReadStream();

    readStream.on("data", (chunk) => {
      downloadedBytes += chunk.length;
      if (progressCallback) {
        progressCallback({
          provider: "googleDrive",
          bytesDownloaded: downloadedBytes,
          totalBytes: fileSize,
          percentage: Math.round((downloadedBytes / fileSize) * 100),
        });
      }
    });

    await pipeline(readStream, writeStream);

    return {
      success: true,
      provider: "googleDrive",
      localPath,
      size: fileSize,
    };
  }

  /**
   * Download from Dropbox
   */
  async downloadFromDropbox(remotePath, localPath, options, progressCallback) {
    // Ensure remote path starts with /
    if (!remotePath.startsWith("/")) {
      remotePath = "/" + remotePath;
    }

    // Get file metadata
    const metadata = await this.providers.dropbox.filesGetMetadata({ path: remotePath });
    const fileSize = metadata.result.size;

    // Download file
    const response = await this.providers.dropbox.filesDownload({ path: remotePath });

    // Save to local file
    // Dropbox SDK v10+ returns fileBinary as ArrayBuffer, convert to Buffer
    let fileBinary = response.result.fileBinary;
    if (fileBinary instanceof ArrayBuffer) {
      fileBinary = Buffer.from(fileBinary);
    }
    await fs.writeFile(localPath, fileBinary);

    if (progressCallback) {
      progressCallback({
        provider: "dropbox",
        bytesDownloaded: fileSize,
        totalBytes: fileSize,
        percentage: 100,
      });
    }

    return {
      success: true,
      provider: "dropbox",
      localPath,
      size: fileSize,
    };
  }

  /**
   * Download from AWS S3
   */
  async downloadFromS3(remotePath, localPath, options, progressCallback) {
    const bucket = options.bucket || this.s3Bucket;

    if (!bucket) {
      throw new Error("No S3 bucket specified");
    }

    // Get object
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: remotePath,
    });

    const response = await this.providers.s3.send(command);
    const fileSize = response.ContentLength;

    // Create write stream
    const writeStream = createWriteStream(localPath);
    let downloadedBytes = 0;

    // Track progress
    response.Body.on("data", (chunk) => {
      downloadedBytes += chunk.length;
      if (progressCallback) {
        progressCallback({
          provider: "s3",
          bytesDownloaded: downloadedBytes,
          totalBytes: fileSize,
          percentage: Math.round((downloadedBytes / fileSize) * 100),
        });
      }
    });

    await pipeline(response.Body, writeStream);

    return {
      success: true,
      provider: "s3",
      localPath,
      size: fileSize,
    };
  }

  /**
   * List files in cloud storage
   * @param {string} provider - Provider name
   * @param {string} path - Path to list
   * @param {Object} options - List options
   */
  async listFiles(provider, path = "", options = {}) {
    if (!this.initialized[provider]) {
      throw new Error(`${provider} is not initialized`);
    }

    switch (provider) {
      case "googleDrive":
        return await this.listGoogleDriveFiles(path, options);
      case "dropbox":
        return await this.listDropboxFiles(path, options);
      case "s3":
        return await this.listS3Files(path, options);
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * List Google Drive files
   */
  async listGoogleDriveFiles(prefix, options) {
    const bucketName = options.bucket || this.store.get("googleDrive.defaultBucket");
    if (!bucketName) {
      throw new Error("No Google Cloud Storage bucket specified");
    }

    const bucket = this.providers.googleDrive.bucket(bucketName);
    const [files] = await bucket.getFiles({
      prefix: prefix,
      maxResults: options.maxResults || 100,
      autoPaginate: false,
    });

    return files.map((file) => ({
      name: file.name,
      size: parseInt(file.metadata.size),
      lastModified: file.metadata.updated,
      contentType: file.metadata.contentType,
      provider: "googleDrive",
    }));
  }

  /**
   * List Dropbox files
   */
  async listDropboxFiles(path, options) {
    // Ensure path starts with /
    if (path && !path.startsWith("/")) {
      path = "/" + path;
    }

    const response = await this.providers.dropbox.filesListFolder({
      path: path || "",
      recursive: !!options.recursive,
      limit: options.maxResults || 100,
    });

    return response.result.entries.map((entry) => ({
      name: entry.path_display,
      size: entry.size || 0,
      lastModified: entry.server_modified,
      isFolder: entry[".tag"] === "folder",
      provider: "dropbox",
    }));
  }

  /**
   * List S3 files
   */
  async listS3Files(prefix, options) {
    const bucket = options.bucket || this.s3Bucket;

    if (!bucket) {
      throw new Error("No S3 bucket specified");
    }

    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: options.maxResults || 100,
    });

    const response = await this.providers.s3.send(command);

    return (response.Contents || []).map((item) => ({
      name: item.Key,
      size: item.Size,
      lastModified: item.LastModified,
      etag: item.ETag,
      provider: "s3",
    }));
  }

  /**
   * Delete file from cloud storage
   * @param {string} provider - Provider name
   * @param {string} remotePath - Remote file path
   * @param {Object} options - Delete options
   */
  async deleteFile(provider, remotePath, options = {}) {
    if (!this.initialized[provider]) {
      throw new Error(`${provider} is not initialized`);
    }

    switch (provider) {
      case "googleDrive": {
        const bucket = this.providers.googleDrive.bucket(
          options.bucket || this.store.get("googleDrive.defaultBucket")
        );
        await bucket.file(remotePath).delete();
        break;
      }
      case "dropbox": {
        if (!remotePath.startsWith("/")) {
          remotePath = "/" + remotePath;
        }
        await this.providers.dropbox.filesDeleteV2({ path: remotePath });
        break;
      }
      case "s3": {
        const deleteCommand = new DeleteObjectCommand({
          Bucket: options.bucket || this.s3Bucket,
          Key: remotePath,
        });
        await this.providers.s3.send(deleteCommand);
        break;
      }
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }

    return { success: true, provider, deletedPath: remotePath };
  }

  /**
   * Get provider status
   * @param {string} provider - Provider name
   */
  getProviderStatus(provider) {
    return {
      initialized: this.initialized[provider] || false,
      hasCredentials: this.store.has(`${provider}.credentials`),
      account: this.store.get(`${provider}.account`) || null,
    };
  }

  /**
   * Get all configured providers
   */
  getConfiguredProviders() {
    const providers = [];

    Object.keys(this.initialized).forEach((provider) => {
      if (this.store.has(`${provider}.credentials`)) {
        providers.push({
          name: provider,
          initialized: this.initialized[provider],
          account: this.store.get(`${provider}.account`),
        });
      }
    });

    return providers;
  }

  /**
   * Clear provider credentials
   * @param {string} provider - Provider name
   */
  clearProviderCredentials(provider) {
    this.store.delete(`${provider}.credentials`);
    this.store.delete(`${provider}.initialized`);
    this.store.delete(`${provider}.account`);
    this.initialized[provider] = false;
    this.providers[provider] = null;
  }
}

export { CloudStorageManager };
