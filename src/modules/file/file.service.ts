import { Injectable } from '@nestjs/common';
import * as archiver from 'archiver';
import axios from 'axios';
import * as fs from 'fs';
import * as sharp from 'sharp';
import { LogService } from '../log/log.service';

@Injectable()
export class FileService {
  constructor(private logService: LogService) {}

  async requestAlbumToDownload(
    albumId: string,
  ): Promise<{ file: fs.ReadStream; name: string }> {
    const { data } = await axios.get(
      `${process.env.CLIENT_SERVER_URL}/albums/${albumId}`,
    );
    console.log(data.downloadPath);
    const file = await fs.createReadStream(`${data.downloadPath}`);
    return { file, name: data.name };
  }

  async buildAlbumArchive({
    albumId,
    imagesPaths,
    albumPath,
  }: {
    albumId: string;
    imagesPaths: string[];
    albumPath: string;
  }): Promise<string> {
    const zipPath = albumPath + `/${albumId}.zip`;
    let imageIndex = 1;
    if (!fs.existsSync(albumPath)) {
      fs.mkdirSync(albumPath);
    }
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip');

    output.on('end', function () {
      this.logService.saveLog('Data has been drained for ' + albumPath);
    });

    archive.pipe(output);

    for (const image of imagesPaths) {
      if (image) {
        const fileName = `/${100000 + imageIndex}.png`;
        //   const filePath = tempAlbumImagesPath + fileName;
        const webpBuffer = await sharp(image).toBuffer();
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
    return zipPath;
  }

  async writeImage(
    {
      imageUrl,
      referer,
      originalUrl,
    }: {
      imageUrl: string;
      referer: string;
      originalUrl: string;
    },
    albumPath: string,
    currentCount: number,
    total: number,
  ) {
    if (!fs.existsSync('public/images')) {
      fs.mkdirSync('public/images');
    }
    if (!fs.existsSync(albumPath)) {
      fs.mkdirSync(albumPath);
    }
    try {
      const response = await axios.get<string>(imageUrl, {
        responseType: 'arraybuffer',
        headers: {
          referer,
        },
      });
      const PNGBase64 = Buffer.from(response.data, 'binary').toString('base64');
      const path = `${albumPath}/${10000 + currentCount}.webp`;
      const returnPath = path;
      await fs.writeFile(path, PNGBase64, 'base64', (err) => {
        if (err) throw err;
        this.logService.saveLog(
          `File ${currentCount}/${total}. Original URL: ${originalUrl}, current URL: ${returnPath}`,
        );
      });
      return returnPath;
    } catch (e) {
      this.logService.saveLog(
        `ERROR HAPPENED, ${imageUrl}, ${referer}`,
        'warn',
      );
    }
  }
}
