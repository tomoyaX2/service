import { Body, Controller, Get, Post } from '@nestjs/common';
import { ScrapperService } from './scrapper.service';
import { VideoService } from './video/video.service';
import { ScrapSingleDto } from './scrapper.dto';
import { HAnimeDetailsService } from './video/hanime-details';
import { HeantaiHeavenDetailsService } from './video/hentaiheaven-details';

@Controller('scrapper')
export class ScrapperController {
  constructor(
    private readonly scrapperService: ScrapperService,
    private readonly videoService: VideoService,
    private readonly hanimeDetailService: HAnimeDetailsService,
    private readonly HeantaiHeavenDetails: HeantaiHeavenDetailsService,
  ) {}

  @Get('start-manga')
  initManga(): void {
    this.scrapperService.initManga();
  }

  @Get('start-video')
  initVideo(): void {
    this.videoService.init();
  }

  @Get('hanime/details')
  initVideoDetails(): void {
    this.hanimeDetailService.initCollectVideoContent();
  }

  @Post('hanime/scrap-video')
  initHhVideoDetails(@Body() body: ScrapSingleDto) {
    this.hanimeDetailService.processSingleUrl(body.url, body.videoUrl);
  }

  @Post('hetaiheaven/scrap-video')
  initHHVideoDetails(@Body() body: ScrapSingleDto): void {
    this.HeantaiHeavenDetails.processSingleUrl(body.url, body.videoUrl);
  }

  @Get('stop')
  stop(): void {
    this.scrapperService.stopScrapper();
  }
}
