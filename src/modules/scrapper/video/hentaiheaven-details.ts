import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { LogService } from '../../log/log.service';
import { FileService } from '../../file/file.service';
import * as puppeteer from 'puppeteer';
import axios from 'axios';
import * as chromeLauncher from 'chrome-launcher';
import * as util from 'util';
import * as request from 'request';

@Injectable()
export class HeantaiHeavenDetailsService {
  browser: puppeteer.Browser;
  hostUrl = process.env.SCRAPPER_HOST;
  isStopped = false;
  index = 0;
  videoDetailsRetryCounter = 0;
  constructor(
    private readonly logService: LogService,
    private readonly fileService: FileService,
  ) {}

  collectEpisodeData = async (episodeHtmlData: string) => {
    const $ = cheerio.load(episodeHtmlData);
    const title = $(
      'div.container div.row div.col-12 div.post-title h1',
    ).text();
    const tags = $('div.genres-content a')
      .map((_, item) => {
        return $(item).text();
      })
      .get();
    const coverUrl = $(
      'div.tab-summary div.summary_image div.position-relative a img',
    ).attr('src');
    console.log(title, 'title');
    const brand = $('div.author-content a').text();

    return { title, tags, coverUrl, releaseDate: '2023', brand };
  };

  processSingleUrl = async (url: string, videoUrl: string) => {
    this.fileService.initS3();
    const chrome = await chromeLauncher.launch({
      // chromeFlags: ['--headless'],
      logLevel: 'info',
      port: 9000,
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
    await page.waitForTimeout(3000);
    const episodeHtmlData = await page.evaluate(
      () => document.querySelector('*').outerHTML,
    );

    const detailsData = await this.collectEpisodeData(episodeHtmlData);
    const { data: existsVideo } = await axios.get(
      `${process.env.CLIENT_SERVER_URL}/videos/${videoId}`,
    );
    let uploadedCoverUrl = '';
    const currentEpisode = existsVideo.episodes?.find(
      (el) => el.name === `Episode: 1`,
    );

    // if (currentEpisode?.id && !currentEpisode?.coverUrl) {
    const imageData = await this.fileService.uploadVideoCoverImage({
      imageUrl: detailsData.coverUrl,
      id: existsVideo.id,
      episodeIndex: '1',
    });
    uploadedCoverUrl = imageData.url;
    await axios.post(
      `${process.env.CLIENT_SERVER_URL}/episodes/${currentEpisode?.id}/update-cover`,
      { coverUrl: uploadedCoverUrl },
    );
    await axios.patch(
      `${process.env.CLIENT_SERVER_URL}/videos/${existsVideo.id}/update-tags`,
      { tags: detailsData.tags },
    );
    console.log(uploadedCoverUrl, 'uploadedCoverUrl', detailsData);

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
    await page.close();
    await chrome.kill();
    console.log('finished');
  };
}
