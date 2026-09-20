import 'dotenv/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import * as bodyParser from 'body-parser';
import { AppModule } from './app.module';
import { httpSecurityConfig } from './common/config/security.config';
import { JwtGuard } from './common/guards/jwt.guard';
import { PrismaService } from '../prisma/prisma.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  try {
    const security = httpSecurityConfig();
    const app = await NestFactory.create(AppModule, {
      logger: ['log', 'error', 'warn', 'debug', 'verbose'],
    });

    app.enableShutdownHooks();
    app.setGlobalPrefix('api');
    app.use(bodyParser.json({ limit: security.jsonLimit }));
    app.use(bodyParser.urlencoded({ limit: security.urlEncodedLimit, extended: true }));
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
    }));

    app.enableCors({
      origin(origin, callback) {
                                                                              
                                                                                   
        if (!origin || (origin === 'null' && process.env.NODE_ENV === 'production') || security.allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error('CORS origin is not allowed'), false);
      },
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id', 'x-seekmore-trace-id'],
      credentials: true,
      maxAge: 600,
    });

    const reflector = app.get(Reflector);
    const jwtService = app.get(JwtService);
    const prisma = app.get(PrismaService);
    app.useGlobalGuards(new JwtGuard(reflector, jwtService, prisma));

    await app.listen(security.port, security.host);
    const url = await app.getUrl();
    logger.log(`Nest listening at ${url} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
    logger.log(`Global prefix: /api; health: ${url}/api/health`);
    logger.log('Private storage is only accessible through authenticated controllers.');
  } catch (error) {
    logger.error('Nest bootstrap failed', error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}

void bootstrap();
