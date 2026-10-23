import { Controller, Get, Module } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('health')
  health() {
    return { status: 'ok' as const };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
