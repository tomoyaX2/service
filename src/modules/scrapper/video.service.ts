import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { LogService } from '../log/log.service';
import { FileService } from '../file/file.service';
import * as puppeteer from 'puppeteer';
import axios from 'axios';
import * as chromeLauncher from 'chrome-launcher';
import * as util from 'util';
import * as request from 'request';
import * as uuid from 'uuid';
import { exec } from 'child_process';

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
  constructor(
    private readonly logService: LogService,
    private readonly fileService: FileService,
  ) {}

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

    const lastPageIndex = 41;
    const pages = Array.from(Array(lastPageIndex).keys()).reverse();
    for (const pageIndex of pages) {
      const htmlData = await axios.get(
        `${process.env.VIDEO_SCRAPPER_HOST}/hentai-series/page/${pageIndex}`,
        // `${process.env.VIDEO_SCRAPPER_HOST}/series`,
      );
      const videosToParse = this.selectVideosToParse({
        htmlData: htmlData.data,
      });

      for (const video of videosToParse) {
        try {
          const pageData = await this.readVideoPage(video);
          switch (pageData?.state) {
            case 'uploaded': {
              await axios.post(
                `${process.env.CLIENT_SERVER_URL}/videos/scrapper-video`,
                pageData,
              );
              console.log('posted video');
              break;
            }
            case 'updated': {
              await axios.post(
                `${process.env.CLIENT_SERVER_URL}/videos/${pageData.id}`,
                pageData,
              );
              console.log(
                `url with title ${pageData?.title} present and episodes are full`,
              );
              break;
            }
            case 'skipped': {
              console.log(`url with title ${pageData?.title} was skipped`);
              break;
            }
            case 'failed': {
              console.log(`url with title ${pageData?.title} failed`);
              break;
            }
          }
        } catch (e) {
          console.log(e?.message, e?.response, 'top level error');
        }
      }
    }
  };

  readVideoPage = async ({ url, title }: { url: string; title: string }) => {
    console.log('reading: ', url, title);

    const videoTempId = uuid.v4();
    const result = {
      id: videoTempId,
      title,
      episodes: [],
      type: 'subtitles',
      state: 'uploaded',
      studios: [],
    } as Video;
    try {
      const {
        data: { data },
      } = await axios.post(
        `${process.env.CLIENT_SERVER_URL}/videos/search`,
        {
          page: 1,
          perPage: 1,
          title,
        },
        { timeout: 10000 },
      );
      const exists = data[0];
      const htmlData = await axios.get(url);
      const $ = cheerio.load(htmlData.data);
      const coverUrl = $('div.sheader div.poster img').attr('data-src');
      if (!exists) {
        const videoCoverImage = await this.fileService.uploadVideoCoverImage({
          id: result.id,
          imageUrl: coverUrl,
        });
        result.coverImageUrl = videoCoverImage.url;
        await $('#info1 div').map((index, element) => {
          const className = $(element).attr('class');
          switch (className) {
            case 'wp-content': {
              result.description = $(element).children('p').text();
              break;
            }
            case 'custom_fields': {
              const label = $(element).children('b.variante').text();
              if (label === 'Original title') {
                result.originalTitle = $(element).children('span.valor').text();
              }
              if (label === 'Studio') {
                $(element)
                  .children('span')
                  .children('div')
                  .children('div')
                  .children('a')
                  .map((_, el) => {
                    result.studios.push($(el).text());
                    return $(el).text();
                  });
              }
              if (label === 'First air date') {
                result.releaseDate = $(element).children('span.valor').text();
              }
              break;
            }
          }
        });
        result.type = 'subtitles'; //subtitles, original, voiced(single), voiced(many)
        result.language = 'english'; //english, russian, japanese
        result.tags = $('div.sgeneros a')
          .map((i, item) => $(item).text().toLowerCase())
          .get();
      }
      const episodesList = $('div.content div.items article')
        .map((i, item) => {
          const episode = $(item).find('a').attr('href');
          return episode;
        })
        .get()
        .reverse();
      let episodeIndex = 1;
      const hasLostEpisodes = exists?.episodes?.length !== episodesList.length;
      if (exists && hasLostEpisodes) {
        for (const episode of exists[0]?.episodes ?? []) {
          console.log('remove episode', episode);
          await this.fileService.removeEpisode(episode.url);
          await axios.delete(
            `${
              process.env.CLIENT_SERVER_URL
            }/episodes?episodeIds=${exists.episodes
              .map((el) => el.id)
              .join(',')}`,
          );
        }
      }
      if (!exists || hasLostEpisodes) {
        for (const episode of episodesList) {
          const htmlData = await axios.get(episode);
          const $episodeReader = cheerio.load(htmlData.data);
          const iframeUrl = $episodeReader(
            'div.play-box-shortcode iframe',
          ).attr('src');
          const page = await this.browser.newPage();
          await page.setRequestInterception(true);
          let m3u8Src = '';
          page.on('request', (request) => {
            if (request.url().endsWith('.m3u8')) {
              m3u8Src = request
                .url()
                .replace('playlist.m3u8', '720p/720p.m3u8');
              request.abort();
            } else {
              request.continue();
            }
          });
          await page.goto(iframeUrl);
          let videoSrc = '';
          await page.waitForTimeout(3000);
          const iframeHtmlData = await page.evaluate(
            () => document.querySelector('*').outerHTML,
          );
          const $iframeReader = cheerio.load(iframeHtmlData);
          const type1 = $iframeReader('video.jw-video').attr('src');
          const type2 = $iframeReader('video.vjs-tech').attr('src');
          videoSrc = type1 ?? type2;
          await page.waitForTimeout(3000);

          page.close();

          if (!!videoSrc || !!m3u8Src) {
            const video = await this.fileService.downloadVideo({
              url: videoSrc,
              m3u8Src: m3u8Src,
              id: result.id,
              episodeIndex,
            });
            result.episodes = [
              ...result.episodes,
              {
                url: video.url,
                name: `Episode - ${episodeIndex}`,
                availableQuality: video.availableQuality,
              },
            ];
            console.log(`finished ${episodeIndex} of ${episodesList.length}`);
          } else {
            console.log(`skip ${episodeIndex} of ${episodesList.length}`);
          }
          episodeIndex++;
        }
        if (!result.episodes?.length) {
          return { ...result, state: 'failed' };
        }
        if (hasLostEpisodes) {
          console.log(exists, 'exists');

          return {
            id: exists.id,
            episodes: result.episodes,
            title: result.title,
            state: 'updated',
          };
        }
      }
      if (!hasLostEpisodes && exists) {
        return { ...result, state: 'skipped' };
      }
      return result;
    } catch (e) {
      console.log(e?.message || e, 'error parse');

      return { ...result, state: 'failed' };
    }
  };

  selectVideosToParse = ({ htmlData }: { htmlData: string }) => {
    const $ = cheerio.load(htmlData);
    const listContentClass = 'div.animation-3 article';
    const videoUrls = $(listContentClass)
      .map((i, item) => {
        return {
          url: $(item).find('div.poster a').attr('href'),
          title: $(item).find('div.data h3 a').text(),
        };
      })
      .get();

    return videoUrls.reverse();
  };

  parsePage = async ({
    url,
    selector,
    click,
  }: {
    url: string;
    selector?: string;
    click?: string;
  }) => {
    try {
      if (this.isStopped) {
        return;
      }
      const page = await this.browser.newPage();
      page.setJavaScriptEnabled(false);

      await page.goto(url);
      if (!!click) {
        page.click(click);
      }
      if (!!selector) {
        await page.waitForSelector(selector);
      }
      const htmlData = await page.evaluate(
        () => document.querySelector('*').outerHTML,
      );
      page.close();
      return htmlData;
    } catch (e) {}
  };

  stopVideoScrapper = async () => {
    this.isStopped = true;
  };
}
