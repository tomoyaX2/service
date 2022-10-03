import { Controller, Get } from '@nestjs/common';
import { XmlService } from './xml.service';

@Controller('xml')
export class XmlController {
  constructor(private readonly xmlService: XmlService) {}

  @Get('generate-xml')
  init(): Promise<void> {
    return this.xmlService.generateXmlFromExistedAlbums();
  }
}
