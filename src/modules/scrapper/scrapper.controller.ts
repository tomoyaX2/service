import { Body, Controller, Get, Post } from '@nestjs/common';
import { ScrapperService } from './scrapper.service';
import { VideoService } from './video.service';
import { ScrapSingleDto } from './scrapper.dto';

@Controller('scrapper')
export class ScrapperController {
  constructor(
    private readonly scrapperService: ScrapperService,
    private readonly videoService: VideoService,
  ) {}

  @Get('start-manga')
  initManga(): void {
    this.scrapperService.initManga();
  }

  @Get('start-video')
  initVideo(): void {
    this.videoService.init();
  }

  @Get('start-video-details')
  initVideoDetails(): void {
    this.videoService.initCollectVideoContent();
  }

  @Post('scrap-video')
  initHhVideoDetails(@Body() body: ScrapSingleDto) {
    this.videoService.processSingleUrl(body.url, body.videoId);
  }

  @Get('stop')
  stop(): void {
    this.scrapperService.stopScrapper();
  }
}
