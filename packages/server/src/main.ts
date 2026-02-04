import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import * as bodyParser from 'body-parser';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['verbose'],
  });

  app.setBaseViewsDir(join(__dirname, 'views'));
  app.setViewEngine('hbs');

  // currently we are saving images to S3 via JSON bodies posted
  // TODO: integrate multer
  app.use(bodyParser.json({ limit: '10mb' }));

  app.enableCors({
    "origin": (origin, callback) => {
      // Allow: no origin (server-to-server), *.ownthedoge.com, *.vercel.app, *.cucked.me, localhost
      if (!origin ||
          /\.ownthedoge\.com$/.test(origin) ||
          /\.vercel\.app$/.test(origin) ||
          /\.doge\.cucked\.me$/.test(origin) ||
          /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
        callback(null, true);
      } else {
        console.log(`CORS blocked origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    "methods": 'GET,HEAD,PUT,PATCH,POST,DELETE',
    "preflightContinue": false,
    "allowedHeaders": 'Content-Type, Accept',
    "optionsSuccessStatus": 204
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  await app.listen(app.get(ConfigService).get('PORT'));
}
bootstrap();
