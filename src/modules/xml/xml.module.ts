import { Module } from '@nestjs/common';
import { LogModule } from '../log/log.module';
import { XmlService } from './xml.service';

@Module({
  imports: [LogModule],
  controllers: [],
  providers: [XmlService],
  exports: [XmlService],
})
export class XmlModule {}
