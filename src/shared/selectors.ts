import { HitomiFields } from './enums/HitomiFields';
import { SelectorArgs, SelectorTypes } from './types';
import * as cheerio from 'cheerio';
import * as puppeteer from 'puppeteer';

export const getSelectors: Record<HitomiFields, SelectorArgs> = {
  [HitomiFields.Author]: {
    selector: 'h2 ul.comma-list li',
    type: SelectorTypes.List,
  },
  [HitomiFields.Group]: {
    selector: '#groups ul.comma-list li',
    type: SelectorTypes.List,
  },
  [HitomiFields.Languages]: {
    selector: '#language',
    type: SelectorTypes.List,
  },
  [HitomiFields.Series]: {
    selector: '#series ul.comma-list li',
    type: SelectorTypes.List,
  },
  [HitomiFields.Tags]: {
    selector: '#tags li',
    textFormatter: (text) => text.replace(' ♂', '').replace(' ♀', ''),
    type: SelectorTypes.List,
  },
  [HitomiFields.Title]: {
    selector: '#gallery-brand',
    type: SelectorTypes.String,
  },
  [HitomiFields.Images]: {
    selector: 'ul.thumbnail-list li',
    type: SelectorTypes.Images,
  },
  [HitomiFields.Type]: {
    selector: '#type',
    type: SelectorTypes.String,
  },
};

export const groupBySelector = async (
  { selector, textFormatter, type }: SelectorArgs,
  $: cheerio.CheerioAPI,
  page: puppeteer.Page,
  hostUrl: string,
) => {
  const items = [];
  switch (type) {
    case SelectorTypes.String: {
      items.push($(selector).text());
      break;
    }
    case SelectorTypes.List: {
      const list = $(selector);
      for (const item of list) {
        const result = textFormatter
          ? textFormatter($(item).children('a').text())
          : $(item).children('a').text();
        !!result && items.push(result);
      }
      break;
    }
    case SelectorTypes.Images: {
      const list = $(selector);
      const lastItem = $(list[list.length - 1])
        .children('div')
        .children('a')
        .attr('href');
      const badge = parseInt($(lastItem).children('.badge').text());
      const lastIndex =
        parseInt(lastItem.split('#')[1]) + (!isNaN(badge) ? badge : 0);

      const referer =
        hostUrl +
        $(list[0]).children('div').children('a').attr('href').replace('#1', '');
      const pageIndexes = Array.from(Array(lastIndex).keys());

      for (const pageIndex of pageIndexes) {
        await page.goto(referer + `#${pageIndex + 1}`);
        await page.waitForSelector('img.lillie');
        const htmlData = await page.evaluate(
          () => document.querySelector('*').outerHTML,
        );
        const image$ = cheerio.load(htmlData);

        const imageUrl = image$('img.lillie').attr('src');
        items.push({
          imageUrl,
          referer: referer.split('#')[0].replace('avif', 'webp'),
          originalUrl: referer + `#${pageIndex + 1}`,
        });
      }
      break;
    }
    default: {
    }
  }

  return items;
};
