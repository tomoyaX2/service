import { Controller, Get, Param } from '@nestjs/common';
import { ScrapperService } from './scrapper.service';
import { VideoService } from './video.service';

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

  @Get('stop')
  stop(): void {
    this.scrapperService.stopScrapper();
  }
}
