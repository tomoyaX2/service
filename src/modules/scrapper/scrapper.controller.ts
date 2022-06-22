import { Controller, Get } from '@nestjs/common';
import { ScrapperService } from './scrapper.service';

@Controller('scrapper')
export class ScrapperController {
  constructor(private readonly scrapperService: ScrapperService) {}

  @Get('start')
  init(): void {
    this.scrapperService.init();
  }

  @Get('stop')
  stop(): void {
    this.scrapperService.stopScrapper();
  }
}
