import { Controller, Get } from '@nestjs/common';
import { CleanupService } from './cleanup.service';

@Controller('cleanup')
export class CleanupController {
  constructor(private readonly cleanupService: CleanupService) {}

  @Get('')
  async cleanupDatabase() {
    // return this.cleanupService.cleanup();
  }
}
