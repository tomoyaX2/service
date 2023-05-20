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

interface Video {
  id: string;
  title: string;
  coverImageUrl: string;
  description: string;
  releaseDate: string;
  type: string;
  language: string;
  tags: string[];
  episodes: { url: string; name: string; availableQuality: string[] }[];
}

@Injectable()
export class VideoService {
  browser: puppeteer.Browser;
  hostUrl = process.env.SCRAPPER_HOST;
  isStopped = false;
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
      `http://localhost:${chrome.port}/json/version`,
    );

    const { webSocketDebuggerUrl } = JSON.parse(resp.body);
    const browser = await puppeteer.connect({
      browserWSEndpoint: webSocketDebuggerUrl,
    });
    this.browser = browser;
    const lastPageIndex = 43;
    const pages = Array.from(Array(lastPageIndex).keys()).reverse();

    for (const pageIndex of pages) {
      const htmlData = await axios.get(
        // `${process.env.VIDEO_SCRAPPER_HOST}/series/page/${pageIndex}`,
        `${process.env.VIDEO_SCRAPPER_HOST}/series`,
      );
      const videosToParse = this.selectVideosToParse({
        htmlData: htmlData.data,
      });
      for (const video of videosToParse) {
        const pageData = await this.readVideoPage(video);
        await axios.post(
          `${process.env.CLIENT_SERVER_URL}/videos/scrapper-video`,
          pageData,
        );
        console.log('posted album');
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
    } as Video;
    const htmlData = await axios.get(url);
    const $ = cheerio.load(htmlData.data);
    const coverUrl = $('div.sheader div.poster')
      .children('img')
      .attr('data-src');
    const videoCoverImage = await this.fileService.uploadVideoCoverImage({
      id: result.id,
      imageUrl: coverUrl,
    });
    result.coverImageUrl = videoCoverImage.url;
    result.description = $('div.wp-content p').text();
    result.releaseDate = $('div.extra span.date').text();
    result.type = 'subtitles'; //subtitles, original, voiced(single), voiced(many)
    result.language = 'english'; //english, russian, japanese
    result.tags = $('div.sgeneros a')
      .map((i, item) => $(item).text().toLowerCase())
      .get();
    const episodesList = $('ul.episodios li a');
    let episodeIndex = 1;
    for (const episode of [episodesList[0]]) {
      const episodeUrl = $(episode).attr('href');
      const htmlData = await axios.get(episodeUrl);
      const $episodeReader = cheerio.load(htmlData.data);
      const iframeUrl = $episodeReader('div.pframe iframe').attr('src');
      const page = await this.browser.newPage();
      await page.goto(iframeUrl);
      await page.waitForTimeout(3000);
      page.click('a.button4');
      await page.waitForTimeout(6000);
      page.click('div.jw-skip');
      await page.waitForTimeout(1000);
      const iframeHtmlData = await page.evaluate(
        () => document.querySelector('*').outerHTML,
      );
      const $iframeReader = cheerio.load(iframeHtmlData);
      const videoSrc = $iframeReader('video.jw-video').attr('src');
      page.close();
      const video = await this.fileService.downloadVideo({
        url: videoSrc,
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
      episodeIndex++;
    }
    return result;
  };

  selectVideosToParse = ({ htmlData }: { htmlData: string }) => {
    const $ = cheerio.load(htmlData);
    const listContentClass = '#archive-content article.tvshows';
    const videoUrls = $(listContentClass)
      .map((i, item) => {
        return {
          url: $(item).find('div.poster a').attr('href'),
          title: $(item).find('div.data strong h3 a').text(),
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
