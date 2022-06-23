import { Injectable } from '@nestjs/common';
import * as archiver from 'archiver';
import axios from 'axios';
import * as fs from 'fs';
import * as sharp from 'sharp';
import { LogService } from '../log/log.service';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { S3 } from '@aws-sdk/client-s3';

@Injectable()
export class FileService {
  constructor(private logService: LogService) {}
  s3Client: S3;

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

  // async requestAlbumUrlToDownload(albumId: string): Promise<string> {
  //   const { data } = await axios.get(
  //     `${process.env.CLIENT_SERVER_URL}/albums/${albumId}`,
  //   );

  //   const bucketParams = {
  //     Bucket: 'scrapper-images-data',
  //     Key: `${process.env.CDN_URL}/${data.downloadPath}`,
  //   };

  //   const url = await getSignedUrl(
  //     this.s3Client,
  //     new GetObjectCommand(bucketParams),
  //     { expiresIn: 15 * 60 },
  //   ); // Adjustable expiration.

  //   return url;
  // }

  async buildAlbumArchive({
    albumId,
    imagesPaths,
  }: {
    albumId: string;
    imagesPaths: string[];
  }): Promise<string> {
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

      for (const image of imagesPaths) {
        if (image) {
          const fileName = `/${100000 + imageIndex}.png`;
          //   const filePath = tempAlbumImagesPath + fileName;
          const webpBuffer = await sharp(
            image.replace('/images', 'public').replace(process.env.CDN_URL, ''),
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
      if (!fs.existsSync('public')) {
        fs.mkdirSync('public');
      }
      if (!fs.existsSync(`public/${albumId}`)) {
        fs.mkdirSync(`public/${albumId}`);
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
      await this.s3Client.send(new PutObjectCommand(bucketParams));
      const PNGBase64 = Buffer.from(response.data, 'binary').toString('base64');
      const tempPath = `public/${albumId}/${10000 + currentCount}.webp`;
      await fs.writeFile(tempPath, PNGBase64, 'base64', (err) => {
        if (err) throw err;
        this.logService.saveLog(
          `File ${currentCount}/${total}. Original URL: ${originalUrl}, current URL: ${returnPath}`,
        );
      });
      const result = `${process.env.CDN_URL}/${returnPath}`;
      return result;
    } catch (e) {
      this.logService.saveLog(
        `ERROR HAPPENED, ${imageUrl}, ${referer}, ${JSON.stringify(e)}`,
        'warn',
      );
    }
  }
}
