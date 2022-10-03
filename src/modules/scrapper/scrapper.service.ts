import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import * as puppeteer from 'puppeteer';
import { ExpectedTypes } from 'src/shared/enums/ExpectedTypes';
import { HitomiFields } from 'src/shared/enums/HitomiFields';
import { getSelectors, groupBySelector } from 'src/shared/selectors';
import { LogService } from '../log/log.service';
import { FileService } from '../file/file.service';
import { v4 as uuidv4 } from 'uuid';
import {
  allowToParse,
  checkIfBannedTitle,
  extendDetailsData,
  findDuplicateTitle,
} from './utils';

const expectedClassNames = [
  ExpectedTypes.Manga,
  ExpectedTypes.Doujinshi,
  ExpectedTypes.ArtistCG,
  ExpectedTypes.GameCG,
];

const expectedFields = [
  HitomiFields.Title,
  HitomiFields.Author,
  HitomiFields.Group,
  HitomiFields.Languages,
  HitomiFields.Series,
  HitomiFields.Tags,
  HitomiFields.Images,
  HitomiFields.Type,
];

@Injectable()
export class ScrapperService {
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
    const browser = await puppeteer.launch();
    this.browser = browser;
    const page = await browser.newPage();

    const lastPageIndex = 60;
    const pages = Array.from(Array(lastPageIndex).keys()).reverse();
    for (const pageIndex of pages) {
      if (this.isStopped) {
        return;
      }
      await this.logService.createLogFile(`hitomi`);
      this.logService.saveLog(`${pageIndex}/${lastPageIndex} page`);
      const htmlData = await this.parsePage({
        page,
        url: this.hostUrl + `/?page=${pageIndex - 1}`,
        selector: 'img.lazyload',
      });
      await this.processData(page, this.isStopped ? '' : htmlData);
      if (pageIndex - 1 === 0) {
        await browser.close();
      }
    }
  };

  processData = async (page: puppeteer.Page, htmlData: string) => {
    try {
      if (this.isStopped) {
        return;
      }
      const urls = await this.generateUrlsToParse(htmlData);

      let albumIndex = 0;
      for (const url of urls) {
        if (this.isStopped) {
          return;
        }
        albumIndex++;
        this.logService.saveLog(`${albumIndex}/${urls.length} urls`);
        const detailsData = await this.collectDetailsData(page, url);
        const isDuplicate = await findDuplicateTitle(detailsData);
        const isBanned = await checkIfBannedTitle(detailsData);

        if (allowToParse({ detailsData, isDuplicate, isBanned })) {
          const imageData = [];
          let imageIndex = 0;
          const albumId = uuidv4();
          for (const image of detailsData.images) {
            if (this.isStopped) {
              return;
            }
            imageIndex++;
            const imageToUpload = await this.fileService.uploadImage(
              image,
              albumId,
              imageIndex,
              detailsData.images.length,
            );
            imageData.push(imageToUpload);
          }
          const downloadPath = await this.fileService.buildAlbumArchive({
            albumId,
            imageData,
          });
          const extendedDetailsData = extendDetailsData({
            downloadPath,
            imageData,
          });
          Object.assign(detailsData, extendedDetailsData);
        }
      }
    } catch (e) {
      console.log(e, 'e');
    }
  };

  generateUrlsToParse = async (htmlData: string) => {
    try {
      const urls = [];
      const $ = cheerio.load(htmlData);
      const groups = expectedClassNames.map((el) => $(el)); // array with grouped cheerio items
      for (const group of groups) {
        if (this.isStopped) {
          return;
        }
        for (const item of group) {
          const url = $(item).children('a').attr('href');
          urls.push(this.hostUrl + url);
        }
      }
      return urls;
    } catch (e) {
      return [];
    }
  };

  parsePage = async ({
    page,
    url,
    selector,
  }: {
    page: puppeteer.Page;
    url: string;
    selector: string;
  }) => {
    try {
      if (this.isStopped) {
        return;
      }
      await page.goto(url);
      await page.waitForSelector(selector);
      const htmlData = await page.evaluate(
        () => document.querySelector('*').outerHTML,
      );
      return htmlData;
    } catch (e) {}
  };

  collectDetailsData = async (
    page: puppeteer.Page,
    url: string,
  ): Promise<Record<string, any>> => {
    try {
      if (this.isStopped) {
        return;
      }
      const htmlData = await this.parsePage({
        page,
        url: `${url}#1`,
        selector: '.gallery-preview',
      });
      const $ = cheerio.load(htmlData);
      const fieldData = {} as Record<HitomiFields, any>;
      const bannedTags = process.env.BANNED_TAGS.split(',');
      const bannedTagsMap = new Map();
      for (const bannedTag of bannedTags) {
        bannedTagsMap.set(bannedTag, true);
      }
      for (const key of expectedFields) {
        const data = await groupBySelector(
          getSelectors[key],
          $,
          page,
          this.hostUrl,
        );
        if (key === HitomiFields.Tags) {
          const hasBannedTag = data.some((el) =>
            bannedTagsMap.has(el.toLowerCase()),
          );
          if (hasBannedTag) {
            this.logService.saveLog(`${fieldData.title[0]} has banned tag`);
            return null;
          }
        }
        fieldData[key] = data;
      }

      return fieldData;
    } catch (e) {}
  };

  stopScrapper = async () => {
    this.isStopped = true;

    this.browser.close();
  };
}
