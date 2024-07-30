import { Injectable } from '@nestjs/common';
import { LogService } from '../../log/log.service';
import { FileService } from '../../file/file.service';
import * as puppeteer from 'puppeteer';
import axios from 'axios';
import * as chromeLauncher from 'chrome-launcher';
import * as util from 'util';
import * as request from 'request';
import { selectVideoReferencesToParse, extractTitlesData } from '../utils';
import * as uuid from 'uuid';
import * as rimraf from 'rimraf';

interface Video {
  id: string;
  title: string;
  coverImageUrl: string;
  description: string;
  releaseDate: string;
  type: string;
  state: string;
  language: string;
  tags: string[];
  originalTitle: string;
  studios: string[];
  episodes: { url: string; name: string; availableQuality: string[] }[];
}
@Injectable()
export class VideoService {
  browser: puppeteer.Browser;
  hostUrl = process.env.SCRAPPER_HOST;
  isStopped = false;
  index = 0;
  videoDetailsRetryCounter = 0;
  constructor(
    private readonly logService: LogService,
    private readonly fileService: FileService,
  ) {}

  uplaodEpisodeToVideoById = async (
    url: string,
    videoId: string,
    episodeIndex: number,
  ) => {
    this.fileService.initS3();

    const videoTempId = uuid.v4();
    const currentVideo = await axios.get(
      `${process.env.CLIENT_SERVER_URL}/videos/${videoId}`,
    );
    const existsEpisode = currentVideo.data.episodes.find(
      (el) => el.name === `Episode: ${episodeIndex}`,
    );
    console.log(existsEpisode, 'exists');
    if (existsEpisode) {
      await this.fileService.removeVideo(existsEpisode.url);
      console.log('removed');
      await this.fileService.replaceVideo({
        url,
        episodeIndex,
        replaceUrl: existsEpisode.url.replace(`${process.env.CDN_URL}/`, ''),
        id: currentVideo.data.id,
      });
      console.log('replaced');
    } else {
      const video = await this.fileService.downloadVideo({
        url,
        id: currentVideo.data.id,
        episodeIndex,
      });
      console.log('downloaded', video);
      if (video) {
        await axios.patch(
          `${process.env.CLIENT_SERVER_URL}/videos/${currentVideo.data.id}`,
          {
            title: currentVideo.data.title,
            releaseDate: currentVideo.data.releaseDate,
            episodes: [
              {
                ...video,
                name: `Episode: ${episodeIndex}`,
              },
            ],
          },
        );
      }
    }
    rimraf(`public/videos/${videoTempId}`, () => null);
  };

  init = async (): Promise<void> => {
    this.isStopped = false;
    this.fileService.initS3();
    const chrome = await chromeLauncher.launch({
      chromeFlags: ['--headless'],
      logLevel: 'info',
      port: 9000,
    });
    const resp = await util.promisify(request)(
      `http://127.0.0.1:${chrome.port}/json/version`,
    );

    const { webSocketDebuggerUrl } = JSON.parse(resp.body);
    const browser = await puppeteer.connect({
      browserWSEndpoint: webSocketDebuggerUrl,
    });
    this.browser = browser;

    const lastPageIndex = 16;
    const pages = Array.from(Array(lastPageIndex).keys()).reverse();
    for (const pageIndex of pages) {
      const titlesToParse = await selectVideoReferencesToParse({
        url: `${process.env.VIDEO_SCRAPPER_HOST}/page/${pageIndex}`,
        // `${process.env.VIDEO_SCRAPPER_HOST}/series`,
      });

      const titlesMap = await extractTitlesData(titlesToParse);

      for (const title of titlesMap.keys()) {
        const { data: exists } = await axios.post(
          `${process.env.CLIENT_SERVER_URL}/videos/search-title`,
          { title },
          { timeout: 10000 },
        );
        if (!exists) {
          const videoTempId = uuid.v4();
          const result = {
            id: videoTempId,
            title: title,
            episodes: [],
            type: 'subtitles',
            state: 'uploaded',
            language: 'english',
            studios: [],
          } as Video;
          const currentTitleVideos = titlesMap.get(title).videos;
          for (const currentTitleVideo of currentTitleVideos) {
            console.log(
              `downloading: ${currentTitleVideo.url}, episode index: ${currentTitleVideo.episodeIndex}`,
            );
            const video = await this.fileService.downloadVideo({
              url: currentTitleVideo.url,
              id: videoTempId,
              episodeIndex: currentTitleVideo.episodeIndex,
            });
            if (video) {
              result.episodes.push({
                ...video,
                name: `Episode: ${currentTitleVideo.episodeIndex}`,
              });
            }
          }
          if (!!result.episodes.length) {
            try {
              await axios.post(
                `${process.env.CLIENT_SERVER_URL}/videos/scrapper-video`,
                result,
              );
              console.log('was published');
            } catch (e) {
              console.log(e);
            }
          }
          rimraf(`public/videos/${videoTempId}`, () => null);
        } else {
          console.log(exists.title, 'ecxists');
        }
      }
    }
  };

  stopVideoScrapper = async () => {
    this.isStopped = true;
  };
}
