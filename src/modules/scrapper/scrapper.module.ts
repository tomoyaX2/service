import { Module } from '@nestjs/common';
import { FileModule } from '../file/file.module';
import { LogModule } from '../log/log.module';
import { XmlModule } from '../xml/xml.module';
import { ScrapperController } from './scrapper.controller';
import { ScrapperService } from './scrapper.service';
import { VideoService } from './video/video.service';
import { HAnimeDetailsService } from './video/hanime-details';
import { HeantaiHeavenDetailsService } from './video/hentaiheaven-details';

@Module({
  imports: [LogModule, FileModule, XmlModule],
  controllers: [ScrapperController],
  providers: [
    ScrapperService,
    VideoService,
    HAnimeDetailsService,
    HeantaiHeavenDetailsService,
  ],
  exports: [ScrapperService, VideoService, HAnimeDetailsService],
})
export class ScrapperModule {}
