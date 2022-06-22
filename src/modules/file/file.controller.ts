import {
  Controller,
  StreamableFile,
  Response,
  Get,
  Query,
} from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { FileService } from './file.service';

@Controller('file')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @ApiQuery({
    name: 'albumId',
    type: String,
    required: true,
  })
  @Get()
  async requestAlbumToDownload(
    @Response({ passthrough: true }) res,
    @Query('albumId') albumId: string,
  ): Promise<StreamableFile> {
    const { file, name } = await this.fileService.requestAlbumToDownload(
      albumId,
    );
    res.set({
      'Content-Disposition': `attachment; filename="${name}"`,
    });
    return new StreamableFile(file);
  }
}
