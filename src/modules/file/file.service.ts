import { Injectable } from '@nestjs/common';
import * as archiver from 'archiver';
import axios from 'axios';
import * as fs from 'fs';
import * as sharp from 'sharp';
import { LogService } from '../log/log.service';
import {
  DeleteObjectCommand,
  paginateListObjectsV2,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { S3 } from '@aws-sdk/client-s3';
import * as sizeOf from 'buffer-image-size';
import * as uuid from 'uuid';
import * as stream from 'stream';
import { promisify } from 'util';
import * as rimraf from 'rimraf';

@Injectable()
export class FileService {
  constructor(private logService: LogService) {}
  s3Client: S3;
  retryCounter = 0;

  initS3() {
    const s3Client = new S3({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION,
      credentials: {
        accessKeyId: process.env.SPACES_KEY,
        secretAccessKey: process.env.SPACES_SECRET,
      },
    });
    this.s3Client = s3Client;
  }

  replaceVideo = async ({
    url,
    id,
    episodeIndex,
    replaceUrl,
  }: {
    url: string;
    id: string;
    episodeIndex: number;
    replaceUrl: string;
  }) => {
    try {
      const episodeId = uuid.v4();
      const videoPath = `public/videos/${id}`;
      const availableQuality = [];
      const episodePath = `${videoPath}/${episodeId}.mp4`;
      console.log(episodePath, 'replaceUrl');

      if (!fs.existsSync(videoPath)) {
        fs.mkdirSync(videoPath, { recursive: true });
      }
      const finished = promisify(stream.finished);
      const writeStream = fs.createWriteStream(episodePath);
      const response = await axios.get(url, {
        responseType: 'stream',
      });

      response.data.pipe(writeStream);
      await finished(writeStream);
      const bucketParams = {
        Bucket: 'scrapper-images-data',
        Key: replaceUrl,
        Body: fs.createReadStream(episodePath),
        ACL: 'public-read',
      };

      await this.s3Client.putObject(bucketParams as any);
      return {
        url: replaceUrl,
        availableQuality,
      };
    } catch (e) {
      console.log(e.response ?? e, 'retry', this.retryCounter);
      if (e?.response?.status !== 404) {
        if (this.retryCounter < 3) {
          this.retryCounter++;
          return this.downloadVideo({
            url,
            id,
            episodeIndex,
          });
        } else {
          this.retryCounter = 0;
          return null;
        }
      }
    }
  };

  downloadVideo = async ({
    url,
    id,
    episodeIndex,
  }: {
    url: string;
    id: string;
    episodeIndex: number;
  }) => {
    try {
      const episodeId = uuid.v4();
      const videoPath = `public/videos/${id}`;
      const availableQuality = [];
      let returnUrl = '';
      const episodePath = `${videoPath}/${episodeId}.mp4`;
      const returnPath = `videos/${id}/episode-${episodeIndex}.mp4`;

      if (!fs.existsSync(videoPath)) {
        fs.mkdirSync(videoPath, { recursive: true });
      }
      const finished = promisify(stream.finished);
      const writeStream = fs.createWriteStream(episodePath);
      console.log('download start');
      const response = await axios.get(url, {
        responseType: 'stream',
      });

      response.data.pipe(writeStream);
      await finished(writeStream);
      returnUrl = `${process.env.CDN_URL}/${returnPath}`;
      console.log('download finish');
      const bucketParams = {
        Bucket: 'scrapper-images-data',
        Key: returnPath,
        Body: fs.createReadStream(episodePath),
        ACL: 'public-read',
      };

      await this.s3Client.putObject(bucketParams as any);
      console.log('uploaded');
      return {
        url: returnUrl,
        availableQuality,
      };
    } catch (e) {
      console.log(e.response ?? e, 'retry', this.retryCounter);
      if (e?.response?.status !== 404) {
        if (this.retryCounter < 3) {
          this.retryCounter++;
          return this.downloadVideo({
            url,
            id,
            episodeIndex,
          });
        } else {
          this.retryCounter = 0;
          return null;
        }
      }
    }
  };

  async buildAlbumArchive({
    albumId,
    imageData,
  }: {
    albumId: string;
    imageData: { url: string; width: string; height: string }[];
  }): Promise<string> {
    this.retryCounter = 0;
    try {
      if (!fs.existsSync('public')) {
        fs.mkdirSync('public');
      }
      if (!fs.existsSync(`public/${albumId}`)) {
        fs.mkdirSync(`public/${albumId}`);
      }
      const albumPath = `public/${albumId}`;
      const tempZipPath = albumPath + `/${albumId}.zip`;
      let imageIndex = 1;
      const output = fs.createWriteStream(tempZipPath);
      const archive = archiver('zip');
      const remoteZipPath = tempZipPath.replace('public', 'images');
      output.on('close', () => {
        this.logService.saveLog('Data has been drained for ' + albumPath);
        const bucketParams = {
          Bucket: 'scrapper-images-data',
          Key: remoteZipPath,
          Body: fs.createReadStream(tempZipPath),
          ACL: 'public-read',
        };

        this.s3Client.putObject(bucketParams as any);
      });

      archive.pipe(output);

      for (const image of imageData) {
        if (image) {
          const fileName = `/${100000 + imageIndex}.png`;
          //   const filePath = tempAlbumImagesPath + fileName;
          const webpBuffer = await sharp(
            image.url
              .replace('/images', 'public')
              .replace(process.env.CDN_URL, ''),
          ).toBuffer();
          //   await sharp(webpBuffer).toFile(filePath, (err) => {
          //     if (err) {
          //       this.logService.saveLog(`${JSON.stringify(err)}`);
          //     }
          //   });
          archive.append(webpBuffer, { name: fileName });
          imageIndex++;
        }
      }
      archive.finalize();
      const result = `${process.env.CDN_URL}/${remoteZipPath}`;
      return result;
    } catch (e) {
      console.log(e, 'e');
    }
  }

  uploadVideoCoverImage = async ({
    imageUrl,
    id,
    episodeIndex,
  }: {
    imageUrl: string;
    id: string;
    episodeIndex: string;
  }) => {
    try {
      const response = await axios.get<string>(imageUrl, {
        responseType: 'arraybuffer',
      });
      const returnPath = `videos/${id}/episode-${episodeIndex}.png`;
      const bucketParams = {
        Bucket: 'scrapper-images-data',
        Key: returnPath,
        Body: response.data,
        ACL: 'public-read',
      };
      await this.s3Client.send(new PutObjectCommand(bucketParams as any));
      const url = `${process.env.CDN_URL}/${returnPath}`;
      return { url };
    } catch (e) {
      this.retryCounter++;
      if (this.retryCounter < 5) {
        await this.uploadVideoCoverImage({ imageUrl, id, episodeIndex });
        this.logService.saveLog(
          `ERROR HAPPENED, ${imageUrl}, ${JSON.stringify(e)}`,
          'warn',
        );
      }
    }
  };

  async uploadImage(
    {
      imageUrl,
      referer,
      originalUrl,
    }: {
      imageUrl: string;
      referer: string;
      originalUrl: string;
    },
    albumId: string,
    currentCount: number,
    total: number,
  ) {
    try {
      if (!fs.existsSync(`public/${albumId}`)) {
        fs.mkdirSync(`public/${albumId}`, { recursive: true });
      }
      const response = await axios.get<string>(imageUrl, {
        responseType: 'arraybuffer',
        headers: {
          referer,
        },
      });
      const returnPath = `images/${albumId}/${10000 + currentCount}.webp`;

      const bucketParams = {
        Bucket: 'scrapper-images-data',
        Key: returnPath,
        Body: response.data,
        ACL: 'public-read',
      };

      const { width, height } = sizeOf(Buffer.from(response.data));
      await this.s3Client.send(new PutObjectCommand(bucketParams as any));
      const PNGBase64 = Buffer.from(response.data, 'binary').toString('base64');
      const tempPath = `public/${albumId}/${10000 + currentCount}.webp`;
      await fs.writeFile(tempPath, PNGBase64, 'base64', (err) => {
        if (err) throw err;
        this.logService.saveLog(
          `File ${currentCount}/${total}. Original URL: ${originalUrl}, current URL: ${returnPath}`,
        );
        this.retryCounter = 0;
      });
      const url = `${process.env.CDN_URL}/${returnPath}`;
      return { url, width, height };
    } catch (e) {
      this.retryCounter++;
      if (this.retryCounter < 5) {
        await this.uploadImage(
          {
            imageUrl,
            referer,
            originalUrl,
          },
          albumId,
          currentCount,
          total,
        );
        this.logService.saveLog(
          `ERROR HAPPENED, ${imageUrl}, ${referer}, ${e}`,
          'warn',
        );
      }
    }
  }

  cleanupStorage = async () => {
    this.initS3();
    const perPage = 5000; // get total pages to change this number
    const { data } = await axios.get<{
      data: { path: string }[];
      total: number;
    }>(`${process.env.CLIENT_SERVER_URL}/albums?page=1&perPage=${perPage}`);
    const currentPaths = new Map();
    for (const item of data.data) {
      currentPaths.set(item.path.split('/')[1], item);
    }
    const bucketParams = {
      Bucket: 'scrapper-images-data',
      Key: 'images',
    };
    const itemsList = paginateListObjectsV2(
      { client: this.s3Client, pageSize: 1000 },
      bucketParams,
    );
    for await (const items of itemsList) {
      for (const content of items.Contents) {
        const isValid = currentPaths.has(content.Key.split('/')[1]);
        if (!isValid && content.Key.startsWith('images')) {
          // avoid filtering anything, except album images
          await this.s3Client.send(
            new DeleteObjectCommand({
              Bucket: 'scrapper-images-data',
              Key: content.Key,
            }),
          );
        }
      }
    }
  };

  removeVideo = async (url: string) => {
    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: 'scrapper-images-data',
        Key: url.replace(`${process.env.CDN_URL}/`, ''),
      }),
    );
  };
}
