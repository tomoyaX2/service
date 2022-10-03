import { Module } from '@nestjs/common';
import { LogModule } from '../log/log.module';
import { XmlController } from './xml.controller';
import { XmlService } from './xml.service';

@Module({
  imports: [LogModule],
  controllers: [XmlController],
  providers: [XmlService],
  exports: [XmlService],
})
export class XmlModule {}
