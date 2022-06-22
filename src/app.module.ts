import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ScrapperModule } from './modules/scrapper/scrapper.module';
import { LogModule } from './modules/log/log.module';
import { FileModule } from './modules/file/file.module';
import { XmlModule } from './modules/xml/xml.module';

// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config();

@Module({
  imports: [ScrapperModule, LogModule, FileModule, XmlModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
