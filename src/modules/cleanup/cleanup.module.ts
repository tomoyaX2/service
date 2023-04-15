import { Module, OnModuleInit } from '@nestjs/common';
import { CleanupService } from './cleanup.service';
import { CleanupController } from './cleanup.controller';

@Module({
  controllers: [CleanupController],
  providers: [CleanupService],
  exports: [CleanupService],
})
export class CleanupModule implements OnModuleInit {
  constructor(private cleanupService: CleanupService) {}

  onModuleInit() {
    this.cleanupService.init();
  }
}
