import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import * as puppeteer from 'puppeteer';
import { ExpectedTypes } from 'src/shared/enums/ExpectedTypes';
import { HitomiFields } from 'src/shared/enums/HitomiFields';
import { getSelectors, groupBySelector } from 'src/shared/selectors';
import { LogService } from '../log/log.service';
import axios from 'axios';
import { FileService } from '../file/file.service';
import { v4 as uuidv4 } from 'uuid';
import { chunkArray } from 'src/shared/utils';
import { XmlService } from '../xml/xml.service';

const expectedClassNames = [
  ExpectedTypes.ArtistCG,
  ExpectedTypes.Doujinshi,
  ExpectedTypes.Manga,
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
    private readonly xmlService: XmlService,
  ) {}
  init = async (): Promise<void> => {
    this.isStopped = false;
    this.xmlService.init();
    this.fileService.initS3();
    const browser = await puppeteer.launch();
    this.browser = browser;
    const page = await browser.newPage();

    const htmlData = await this.parsePage({
      page,
      url: this.hostUrl,
      selector: 'img.lazyload',
    });
    const lastPageIndex = this.getPagesAmount(htmlData);
    const pages = Array.from(Array(lastPageIndex).keys());
    for (const pageIndex of pages) {
      if (this.isStopped) {
        return;
      }
      await this.logService.createLogFile(`hitomi`);
      this.logService.saveLog(`${pageIndex + 1}/${lastPageIndex} page`);
      const htmlData = await this.parsePage({
        page,
        url: this.hostUrl + `/?page=${pageIndex + 1}`,
        selector: 'img.lazyload',
      });
      await this.processData(
        page,
        this.isStopped ? '' : htmlData,
        pageIndex + 1,
      );
      if (pageIndex + 1 === lastPageIndex) {
        this.xmlService.finishXml();
        await browser.close();
      }
    }
  };

  processData = async (
    page: puppeteer.Page,
    htmlData: string,
    currentPageIndex: number,
  ) => {
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
      const isDuplicate = await this.findDuplicate(detailsData);
      if (detailsData && !isDuplicate) {
        const imagesPaths = [];
        let imageIndex = 0;
        const albumId = uuidv4();
        for (const image of detailsData.images) {
          if (this.isStopped) {
            return;
          }
          imageIndex++;
          const path = await this.fileService.uploadImage(
            image,
            albumId,
            imageIndex,
            detailsData.images.length,
          );
          imagesPaths.push(path);
        }
        const downloadPath = await this.fileService.buildAlbumArchive({
          albumId,
          imagesPaths,
        });
        detailsData.downloadPath = downloadPath;
        if (process.env.ENABLE_POST_ALBUMS === 'true') {
          const isRequestOversized = imagesPaths.length > 100;
          const album = await axios.post(
            `${process.env.CLIENT_SERVER_URL}/albums/scrapper-album`,
            {
              albumData: isRequestOversized
                ? { ...detailsData, images: [] }
                : { ...detailsData, images: imagesPaths },
              currentPageIndex,
              albumPath: `images/${albumId}`,
              albumIndex,
            },
          );
          this.xmlService.appendUrl(
            `${process.env.CLIENT_URL}/albums/${album.data}`,
          );

          if (isRequestOversized) {
            for (const chunk of chunkArray(imagesPaths)) {
              await axios.post(
                `${process.env.CLIENT_SERVER_URL}/albums/scrapper-album-images`,
                {
                  images: chunk,
                  albumId: album.data,
                },
              );
            }
          }
        }
      }
    }
  };

  findDuplicate = async (
    detailsData: Record<HitomiFields, any>,
  ): Promise<boolean> => {
    if (detailsData) {
      const dataToCheck = {} as Record<string, { name: string } | string>;
      if (detailsData.languages?.length && detailsData.title[0]) {
        dataToCheck.language = { name: detailsData.languages[0] };
        dataToCheck.name = detailsData.title[0];
        const { data: isDuplicate } = await axios.post(
          `${process.env.CLIENT_SERVER_URL}/albums/find-duplicate`,
          dataToCheck,
        );
        return isDuplicate;
      }
    }
    return false;
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

  getPagesAmount = (htmlData: string) => {
    const $ = cheerio.load(htmlData);
    const pagesList = $('.page-container ul li');
    const lastPageData = pagesList[pagesList.length - 1];
    return parseInt($(lastPageData).children('a').text());
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
    this.xmlService.finishXml();

    this.browser.close();
  };
}
