import { Module } from '@nestjs/common';
import { LogModule } from '../log/log.module';
import { FileController } from './file.controller';
import { FileService } from './file.service';

@Module({
  imports: [LogModule],
  controllers: [FileController],
  providers: [FileService],
  exports: [FileService],
})
export class FileModule {}
