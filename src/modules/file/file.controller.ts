import { Controller } from '@nestjs/common';
import { FileService } from './file.service';

@Controller('file')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  // @ApiQuery({
  //   name: 'albumId',
  //   type: String,
  //   required: true,
  // })
  // @Get()
  // async requestAlbumUrlToDownload(
  //   @Response({ passthrough: true }) res,
  //   @Query('albumId') albumId: string,
  // ): Promise<string> {
  //   const downloadUrl = await this.fileService.requestAlbumUrlToDownload(
  //     albumId,
  //   );
  //   return downloadUrl;
  // }
}
