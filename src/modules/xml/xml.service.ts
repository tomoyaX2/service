import { Injectable } from '@nestjs/common';
import * as xmlBuilder from 'xmlbuilder';
import * as moment from 'moment';
import * as fs from 'fs';
import { LogService } from '../log/log.service';
import axios from 'axios';

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

  generateXmlFromExistedAlbums = async () => {
    const perPage = 5764;
    const { data } = await axios.get<{
      data: { id: string }[];
      total: number;
    }>(`${process.env.CLIENT_SERVER_URL}/albums?page=1&perPage=${perPage}`);
    this.init();
    for (const item of data.data) {
      this.builder = this.builder
        .ele('url')
        .ele('loc', `${process.env.CLIENT_URL}/album/${item.id}/`)
        .up()
        .ele('lastmod', moment(new Date()).format('YYYY-MM-DD'))
        .up()
        .up();
    }
    const xml = this.builder.end({ pretty: true });
    fs.writeFile('public/sitemap.xml', xml, (err) => {
      if (err) {
        this.logService.saveLog(`${err}, err write xml file`);
      }
    });
    this.builder = null;
  };
}
