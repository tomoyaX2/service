import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { LogService } from '../../log/log.service';
import { FileService } from '../../file/file.service';
import * as puppeteer from 'puppeteer';
import axios from 'axios';
import * as chromeLauncher from 'chrome-launcher';
import * as util from 'util';
import * as request from 'request';
import * as fs from 'fs';

@Injectable()
export class HAnimeDetailsService {
  browser: puppeteer.Browser;
  hostUrl = process.env.SCRAPPER_HOST;
  isStopped = false;
  index = 0;
  videoDetailsRetryCounter = 0;
  constructor(private readonly fileService: FileService) {}

  initCollectVideoContent = async () => {
    this.isStopped = false;
    this.fileService.initS3();
    const chrome = await chromeLauncher.launch({
      chromeFlags: ['--headless'],
      logLevel: 'info',
      port: 9001,
    });
    const resp = await util.promisify(request)(
      `http://127.0.0.1:${chrome.port}/json/version`,
    );

    const { webSocketDebuggerUrl } = JSON.parse(resp.body);
    const browser = await puppeteer.connect({
      browserWSEndpoint: webSocketDebuggerUrl,
    });
    this.browser = browser;
    await this.startDetailsScrapping();
  };

  startDetailsScrapping = async () => {
    const page = await this.browser.newPage();
    await page.goto(process.env.HANIME_DETAILS_SCRAPPER_HOST + '/search');
    await page.waitForTimeout(1000);
    const htmlData = await page.evaluate(
      () => document.querySelector('*').outerHTML,
    );
    const $ = cheerio.load(htmlData);
    const paginationItems = $('ul.pagination li')
      .map((index, item) => {
        const pageNumberItem = $(item).find('button.pagination__item').text();
        return pageNumberItem;
      })
      .get();
    const lastPage = paginationItems[paginationItems.length - 2]; // real last page is located on this index, count strats from 0

    const pageIndexes = Array.from({ length: parseInt(lastPage) }).map(
      (_, index) => index,
    );
    const skippedMap = new Map();
    for (const pageIndex of pageIndexes) {
      if (pageIndex === 0) {
        await this.collectEpisodes($, skippedMap);
      } else {
        const [paginationItem] = await page.$x(
          `//button[contains(., '${pageIndex + 1}')]`,
        );
        await paginationItem.click();
        await page.waitForTimeout(3000);
        const htmlData = await page.evaluate(
          () => document.querySelector('*').outerHTML,
        );
        const $ = cheerio.load(htmlData);
        await this.collectEpisodes($, skippedMap);
      }
    }
    console.log('finished', skippedMap.keys());
  };

  collectEpisodes = async (
    $: cheerio.CheerioAPI,
    skippedMap: Map<any, any>,
  ) => {
    const episodeLinks = $('div.search-result a.search-result__item')
      .map(
        (index, item) =>
          `${process.env.HANIME_DETAILS_SCRAPPER_HOST + $(item).attr('href')}`,
      )
      .get();
    console.log(episodeLinks, 'episodeLinks');
    const page = await this.browser.newPage();
    try {
      for (const episodeLink of episodeLinks) {
        await page.goto(episodeLink);
        await page.waitForTimeout(1000);
        const episodeHtmlData = await page.evaluate(
          () => document.querySelector('*').outerHTML,
        );
        const detailsData = await this.collectEpisodeData(episodeHtmlData);
        const { data: existsVideo } = await axios.post(
          `${process.env.CLIENT_SERVER_URL}/videos/search-title`,
          { title: detailsData.title },
        );
        if (!!existsVideo) {
          let uploadedCoverUrl = '';
          const currentEpisode = existsVideo.episodes?.find(
            (el) => el.name === `Episode: ${detailsData.episodeIndex}`,
          );
          if (!currentEpisode?.id) {
            console.log('no episode');
          } else if (currentEpisode?.id && !currentEpisode?.coverUrl) {
            const imageData = await this.fileService.uploadVideoCoverImage({
              imageUrl: detailsData.coverUrl,
              id: existsVideo.id,
              episodeIndex: detailsData.episodeIndex,
            });
            uploadedCoverUrl = imageData.url;
            await axios.post(
              `${process.env.CLIENT_SERVER_URL}/episodes/${currentEpisode?.id}/update-cover`,
              { coverUrl: uploadedCoverUrl },
            );
          } else {
            console.log(
              `${detailsData.title} episode ${detailsData.episodeIndex} has uploaded coverUrl`,
            );
          }
          await axios.patch(
            `${process.env.CLIENT_SERVER_URL}/videos/${existsVideo.id}/update-tags`,
            { tags: detailsData.tags },
          );

          if (detailsData.episodeIndex === '1') {
            const dataToSend = {} as any;
            if (detailsData.title) {
              dataToSend.title = detailsData.title;
            }
            if (detailsData.releaseDate) {
              dataToSend.releaseDate = detailsData.releaseDate;
            }
            if (detailsData.coverUrl) {
              dataToSend.coverImageUrl = uploadedCoverUrl;
            }
            await axios.patch(
              `${process.env.CLIENT_SERVER_URL}/videos/${existsVideo.id}`,
              dataToSend,
            );
          }
        } else {
          console.log(
            'was skipped',
            JSON.stringify({ title: detailsData.title }),
          );
          await fs.appendFileSync(
            'public/skipped.json',
            JSON.stringify({ title: detailsData.title }) + ', ',
          );
          skippedMap.set(detailsData.title, true);
        }
      }
      await page.close();
    } catch (e) {
      console.log(e, 'e');
      await page.close();

      if (this.videoDetailsRetryCounter < 5) {
        this.videoDetailsRetryCounter++;
        await this.collectEpisodes($, skippedMap);
      } else {
        this.videoDetailsRetryCounter = 0;
      }
    }
  };

  collectEpisodeData = async (episodeHtmlData: string) => {
    const $ = cheerio.load(episodeHtmlData);
    const titleText = $('h1.tv-title').text();
    const title = titleText.substring(0, titleText.length - 2);
    const episodeIndex = titleText.substring(
      titleText.length - 1,
      titleText.length,
    );
    const tags = $('div.hvpi-summary div.hvpis-text a')
      .map((index, item) => {
        return $(item).find('div.btn__content').text();
      })
      .get();
    const coverUrl = $('div.hvpi-cover-container img').attr('src');
    console.log(coverUrl, 'cover');
    let releaseDate = '';
    let brand = '';
    $('div.hvpim-brand-censor div.flex div.hvpimbc-item').map((index, item) => {
      const label = $(item).find('div.hvpimbc-header').text();
      const text = $(item).find('div.hvpimbc-text').text();
      const brandLabel = $(item).find('a.hvpimbc-text').text();
      if (label === 'Release Date') {
        releaseDate = text;
      }
      if (label === 'Brand') {
        brand = brandLabel;
      }
    });

    return { title, tags, coverUrl, releaseDate, brand, episodeIndex };
  };

  processSingleUrl = async (url: string, videoUrl: string) => {
    try {
      this.fileService.initS3();
      const chrome = await chromeLauncher.launch({
        chromeFlags: ['--headless'],
        logLevel: 'info',
        port: 9002,
      });
      const resp = await util.promisify(request)(
        `http://127.0.0.1:${chrome.port}/json/version`,
      );
      const videoId = videoUrl.split('/')[4];
      const { webSocketDebuggerUrl } = JSON.parse(resp.body);
      const browser = await puppeteer.connect({
        browserWSEndpoint: webSocketDebuggerUrl,
      });
      this.browser = browser;
      const page = await this.browser.newPage();
      await page.goto(url);
      await page.waitForTimeout(1000);
      const episodeHtmlData = await page.evaluate(
        () => document.querySelector('*').outerHTML,
      );
      const detailsData = await this.collectEpisodeData(episodeHtmlData);

      const { data: existsVideo } = await axios.get(
        `${process.env.CLIENT_SERVER_URL}/videos/${videoId}`,
      );
      let uploadedCoverUrl = '';
      const currentEpisode = existsVideo.episodes?.find(
        (el) => el.name === `Episode: ${detailsData.episodeIndex}`,
      );

      if (currentEpisode?.id && !currentEpisode?.coverUrl) {
        const imageData = await this.fileService.uploadVideoCoverImage({
          imageUrl: detailsData.coverUrl,
          id: existsVideo.id,
          episodeIndex: detailsData.episodeIndex,
        });
        uploadedCoverUrl = imageData.url;
        await axios.post(
          `${process.env.CLIENT_SERVER_URL}/episodes/${currentEpisode?.id}/update-cover`,
          { coverUrl: uploadedCoverUrl },
        );
      } else {
        console.log(
          `${detailsData.title} episode ${detailsData.episodeIndex} has uploaded coverUrl`,
        );
      }
      await axios.patch(
        `${process.env.CLIENT_SERVER_URL}/videos/${existsVideo.id}/update-tags`,
        { tags: detailsData.tags },
      );

      if (detailsData.episodeIndex === '1') {
        const dataToSend = {} as any;
        if (detailsData.title) {
          dataToSend.title = detailsData.title;
        }
        if (detailsData.releaseDate) {
          dataToSend.releaseDate = detailsData.releaseDate;
        }
        if (detailsData.coverUrl) {
          dataToSend.coverImageUrl = uploadedCoverUrl;
        }
        await axios.patch(
          `${process.env.CLIENT_SERVER_URL}/videos/${existsVideo.id}`,
          dataToSend,
        );
      }
      await page.close();
      console.log('finished');
    } catch (error) {
      console.log(error, 'errpr');
    }
  };
}
