import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.use(helmet());
  app.enableCors({ origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:4200' });
  app.enableShutdownHooks();
  await app.listen(process.env['PORT'] ?? 3000);
}

void bootstrap();
