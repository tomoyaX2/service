import { Injectable } from '@nestjs/common';
import * as xmlBuilder from 'xmlbuilder';
import * as moment from 'moment';
import * as fs from 'fs';
import { LogService } from '../log/log.service';

// const requestedItems = [
//   'tags',
//   'series',
//   'languages',
//   'group',
//   'author',
//   'type',
// ];

@Injectable()
export class XmlService {
  constructor(private readonly logService: LogService) {}
  builder;
  init() {
    if (process.env.ACTIVE_XML_BUILD !== 'true') {
      return;
    }
    this.builder = xmlBuilder
      .create('urlset', {
        encoding: 'UTF-8',
        version: '1.0',
      })
      .att('xmlns', 'http://www.sitemaps.org/schemas/sitemap/0.9');
  }

  appendUrl(url: string) {
    if (process.env.ACTIVE_XML_BUILD !== 'true') {
      return;
    }
    console.log(url, 'url');
    this.builder = this.builder
      .ele('url')
      .ele('loc', url)
      .up()
      .ele('lastmod', moment(new Date()).format('YYYY-MM-DD'))
      .up()
      .up();
  }

  // async writeRequestedItemsToXml(page: number, link: string) {
  //   if (process.env.ACTIVE_XML_BUILD !== 'true') {
  //     return;
  //   }
  //   const perPage = 200;
  //   const {
  //     data: { total: totalTags, data },
  //   } = await axios.get(
  //     `${process.env.CLIENT_SERVER_URL}/${link}?page=${page}&perPage=${perPage}&withAlbums=false`,
  //   );
  //   const names = data.map((el) => el.name.split(' ').join('_'));
  //   for (const name of names) {
  //     this.appendUrl(`${process.env.CLIENT_URL}/${link}/${name}`);
  //   }
  //   if (page * perPage < totalTags) {
  //     await this.writeRequestedItemsToXml(page + 1, link);
  //   }
  // }

  async finishXml() {
    if (process.env.ACTIVE_XML_BUILD !== 'true') {
      return;
    }
    // for (const link of requestedItems) {
    //   await this.writeRequestedItemsToXml(0, link);
    // }
    const xml = this.builder.end({ pretty: true });
    fs.writeFile('public/sitemap.xml', xml, (err) => {
      if (err) {
        this.logService.saveLog(`${err}, err write xml file`);
      }
    });
    this.builder = null;
  }
}
