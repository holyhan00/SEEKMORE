import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { jwtAccessConfig } from '../../common/config/security.config';
import { SystemAgentModule } from '../agent/system/systemagent.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

const access = jwtAccessConfig();

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: access.secret,
      signOptions: {
        expiresIn: access.expiresIn as never,
        issuer: access.issuer,
        audience: access.audience,
      },
    }),
    SystemAgentModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
