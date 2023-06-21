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
import {
  addLeadingZeros,
  executeCommand,
  removeQualityIndexFromUrl,
} from './utils';
import * as rimraf from 'rimraf';

const supportedQuality = ['480p', '720p', '1080p'];

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

  downloadVideo = async ({
    url,
    id,
    episodeIndex,
    m3u8Src,
  }: {
    url: string;
    m3u8Src?: string;
    id: string;
    episodeIndex: number;
  }) => {
    console.log(`downloading: ${url}`);
    const episodeId = uuid.v4();
    const videoPath = `public/videos/${id}`;
    const availableQuality = [];
    let returnUrl = '';
    let episodePath = `${videoPath}/${episodeId}.mp4`;
    const returnPath = `videos/${id}/episode-${episodeIndex}.mp4`;

    if (!fs.existsSync(videoPath)) {
      fs.mkdirSync(videoPath, { recursive: true });
    }
    const finished = promisify(stream.finished);
    const qualityEnabled = supportedQuality.some((qualityLevel) =>
      url?.endsWith(`${qualityLevel}.mp4`),
    );
    if (qualityEnabled) {
      const clearUrl = removeQualityIndexFromUrl(url);
      for (const quality of supportedQuality) {
        try {
          const response = await axios.get(
            clearUrl.replace('.mp4', `${quality}.mp4`),
            {
              responseType: 'stream',
            },
          );
          episodePath = episodePath.replace('.mp4', `-${quality}.mp4`);
          console.log(`uploading ${quality} version`);
          const writeStream = fs.createWriteStream(episodePath);

          response.data.pipe(writeStream);
          await finished(writeStream);
          const returnPath = `videos/${id}/episode-${episodeIndex}-${quality}.mp4`;
          returnUrl = `${process.env.CDN_URL}/${returnPath}`;
          const bucketParams = {
            Bucket: 'scrapper-images-data',
            Key: returnPath,
            Body: fs.createReadStream(episodePath),
            ACL: 'public-read',
          };

          await this.s3Client.putObject(bucketParams);
          availableQuality.push(quality);
        } catch (e) {
          console.log(`Quality: ${quality} doesn't exist`);
        }
      }
    } else {
      if (m3u8Src) {
        console.log('download m3u8 list');
        const m3u8SrcPath = `${videoPath}/paths.m3u8`;
        const ffmpegPathsToCombine = `paths.txt`;

        const m3u8SrcFragmentsPath = `fragments`;
        if (!fs.existsSync(m3u8SrcFragmentsPath)) {
          fs.mkdirSync(m3u8SrcFragmentsPath, { recursive: true });
        }
        const m3u8SrcPathStream = fs.createWriteStream(m3u8SrcPath);
        await fs.writeFileSync(ffmpegPathsToCombine, '');
        const response = await axios.get(m3u8Src, {
          responseType: 'stream',
        });

        response.data.pipe(m3u8SrcPathStream);
        await finished(m3u8SrcPathStream);
        const data = fs.readFileSync(m3u8SrcPath, 'utf8');
        const regexp = /720p_.*\.ts/g;
        const allFragmentsAmount = [...data.matchAll(regexp)].length - 1;
        const allFragmentsIndexes = Array.from({
          length: allFragmentsAmount + 1,
        }).map((_, index) =>
          addLeadingZeros(index, `${allFragmentsAmount}`.length),
        );
        for (const fragment of allFragmentsIndexes) {
          const m3u8FragmentPath = `${m3u8SrcFragmentsPath}/${fragment}.mp4`;
          await fs.appendFileSync(
            ffmpegPathsToCombine,
            `file ${m3u8FragmentPath}\n`,
          );
        }
        const promises = allFragmentsIndexes.map(async (fragment) => {
          const m3u8FragmentPath = `${m3u8SrcFragmentsPath}/${fragment}.mp4`;
          const writeStream = fs.createWriteStream(m3u8FragmentPath);
          const urlToGet = m3u8Src.replace('720p.m3u8', `720p_${fragment}.ts`);
          const response = await axios.get(urlToGet, {
            responseType: 'stream',
          });

          response.data.pipe(writeStream);
          await finished(writeStream);
        });
        await Promise.all(promises);
        await executeCommand(
          `ffmpeg -f concat -safe 0 -i paths.txt -c copy public/${returnPath}`,
        );
        console.log('executed');
        rimraf('fragments', () => null);
        rimraf('paths.txt', () => null);

        return { url: returnUrl, availableQuality };
      } else {
        const writeStream = fs.createWriteStream(episodePath);
        console.log(url, 'url');
        const response = await axios.get(url, {
          responseType: 'stream',
        });
        console.log(`uploading default version`);

        response.data.pipe(writeStream);
        await finished(writeStream);
        returnUrl = `${process.env.CDN_URL}/${returnPath}`;
        console.log(returnUrl, 'returnUrl');
        const bucketParams = {
          Bucket: 'scrapper-images-data',
          Key: returnPath,
          Body: fs.createReadStream(episodePath),
          ACL: 'public-read',
        };

        await this.s3Client.putObject(bucketParams);
      }
      rimraf(videoPath, () => null);

      return {
        url: returnUrl,
        availableQuality,
      };
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

        this.s3Client.putObject(bucketParams);
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
  }: {
    imageUrl: string;
    id: string;
  }) => {
    try {
      if (!fs.existsSync(`public/videos/${id}`)) {
        fs.mkdirSync(`public/videos/${id}`, { recursive: true });
      }
      const response = await axios.get<string>(imageUrl, {
        responseType: 'arraybuffer',
      });
      const returnPath = `videos/${id}/cover.webp`;
      const bucketParams = {
        Bucket: 'scrapper-images-data',
        Key: returnPath,
        Body: response.data,
        ACL: 'public-read',
      };
      await this.s3Client.send(new PutObjectCommand(bucketParams));
      const PNGBase64 = Buffer.from(response.data, 'binary').toString('base64');
      const tempPath = `public/videos/${id}/cover.webp`;
      await fs.writeFile(tempPath, PNGBase64, 'base64', (err) => {
        if (err) throw err;
        this.retryCounter = 0;
      });
      const url = `${process.env.CDN_URL}/${returnPath}`;
      return { url };
    } catch (e) {
      this.retryCounter++;
      if (this.retryCounter < 5) {
        await this.uploadVideoCoverImage({ imageUrl, id });
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
      await this.s3Client.send(new PutObjectCommand(bucketParams));
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
          `ERROR HAPPENED, ${imageUrl}, ${referer}, ${JSON.stringify(e)}`,
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

  removeEpisode = async (url: string) => {
    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: 'scrapper-images-data',
        Key: url.replace(`${process.env.CDN_URL}/`, ''),
      }),
    );
  };
}
