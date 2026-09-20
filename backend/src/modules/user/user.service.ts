                                           

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Plan, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '../../../prisma/prisma.service';

const SUPPORTED_UI_LOCALES = new Set(['zh-Hans', 'zh-Hant', 'en']);
const USER_AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const USER_AVATAR_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

@Injectable()
export class UserService {
  private readonly userStorageRoot = path.resolve(
    process.env.USER_STORAGE_DIR
      || path.join(process.cwd(), 'storage', 'users'),
  );

  constructor(private prisma: PrismaService) {}

  async updateUserPlan(userId: string, newPlan: Plan) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { plan: newPlan },
    });
  }

  async getUserProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        username: true,
        nickname: true,
        email: true,
        role: true,
        plan: true,
        preferredLanguage: true,
        avatarKey: true,
        avatarUpdatedAt: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('USER_NOT_FOUND');
    }

    return {
      ...user,
      avatarUrl: user.avatarKey
        ? '/api/user/avatar'
        : null,
    };
  }

  async getUserAvatar(
    userId: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarKey: true },
    });

    if (!user) {
      throw new UnauthorizedException('USER_NOT_FOUND');
    }

    const absolutePath = this.resolveUserAvatarPath(
      user.avatarKey,
    );

    if (!absolutePath) {
      throw new NotFoundException('USER_AVATAR_NOT_FOUND');
    }

    try {
      return {
        buffer: await fs.readFile(absolutePath),
        mimeType: this.avatarMimeType(absolutePath),
      };
    } catch {
      throw new NotFoundException('USER_AVATAR_NOT_FOUND');
    }
  }

  async updateUserProfile(
    userId: string,
    input: {
      username?: string;
    },
    avatarFile?: Express.Multer.File | null,
  ) {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        avatarKey: true,
      },
    });

    if (!current) {
      throw new UnauthorizedException('USER_NOT_FOUND');
    }

    const username = Object.prototype.hasOwnProperty.call(
      input,
      'username',
    )
      ? String(input.username ?? '').trim()
      : undefined;

    if (username !== undefined && !username) {
      throw new BadRequestException('USER_USERNAME_REQUIRED');
    }

    if (username && username.length > 255) {
      throw new BadRequestException('USER_USERNAME_TOO_LONG');
    }

    this.validateAvatarFile(avatarFile);

    const nextAvatarKey = avatarFile
      ? await this.persistUserAvatar(userId, avatarFile)
      : null;

    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          username:
            username !== undefined
              ? username
              : undefined,
          avatarKey:
            nextAvatarKey ?? undefined,
          avatarUpdatedAt:
            nextAvatarKey
              ? new Date()
              : undefined,
        },
      });
    } catch (error) {
      if (nextAvatarKey) {
        await this.removeAvatarKey(nextAvatarKey);
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2002'
      ) {
        throw new ConflictException('USER_USERNAME_TAKEN');
      }

      throw error;
    }

    if (
      nextAvatarKey
      && current.avatarKey
      && current.avatarKey !== nextAvatarKey
    ) {
      await this.removeAvatarKey(current.avatarKey);
    }

    return this.getUserProfile(userId);
  }

  async updateLocalizationPreferences(
    userId: string,
    input: {
      preferredLanguage?: string | null;
    },
  ) {
    const data: {
      preferredLanguage?: string | null;
    } = {};

    if (Object.prototype.hasOwnProperty.call(input, 'preferredLanguage')) {
      if (input.preferredLanguage == null || String(input.preferredLanguage).trim() === '') {
        data.preferredLanguage = null;
      } else {
        const locale = String(input.preferredLanguage).trim();
        if (!SUPPORTED_UI_LOCALES.has(locale)) {
          throw new BadRequestException('UNSUPPORTED_UI_LOCALE');
        }
        data.preferredLanguage = locale;
      }
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('LOCALIZATION_PREFERENCE_CHANGE_REQUIRED');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        preferredLanguage: true,
      },
    });
  }

  private validateAvatarFile(
    file?: Express.Multer.File | null,
  ): void {
    if (!file) {
      return;
    }

    if (!USER_AVATAR_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('USER_AVATAR_FORMAT_UNSUPPORTED');
    }

    if (file.size > USER_AVATAR_MAX_BYTES) {
      throw new BadRequestException('USER_AVATAR_TOO_LARGE');
    }

    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('USER_AVATAR_EMPTY');
    }
  }

  private async persistUserAvatar(
    userId: string,
    file: Express.Multer.File,
  ): Promise<string> {
    const dir = path.join(
      this.userStorageRoot,
      userId,
      'profile',
    );

    await fs.mkdir(dir, { recursive: true });

    const extension = this.avatarExtension(file.mimetype);
    const storedName = `avatar-${Date.now()}-${randomUUID()}${extension}`;
    const absolutePath = path.join(dir, storedName);

    await fs.writeFile(absolutePath, file.buffer);

    const stat = await fs.stat(absolutePath);
    if (!stat.isFile() || stat.size <= 0) {
      await fs.rm(absolutePath, { force: true }).catch(() => undefined);
      throw new BadRequestException('USER_AVATAR_WRITE_FAILED');
    }

    return path
      .join('storage', 'users', userId, 'profile', storedName)
      .replace(/\\/g, '/');
  }

  private resolveUserAvatarPath(
    storageKey?: string | null,
  ): string | null {
    const normalized = String(storageKey ?? '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');

    const prefix = 'storage/users/';
    if (!normalized.startsWith(prefix)) {
      return null;
    }

    const relative = normalized.slice(prefix.length);
    const absolute = path.resolve(this.userStorageRoot, relative);
    const rootPrefix = `${this.userStorageRoot}${path.sep}`;

    if (
      absolute !== this.userStorageRoot
      && !absolute.startsWith(rootPrefix)
    ) {
      return null;
    }

    return absolute;
  }

  private async removeAvatarKey(
    storageKey?: string | null,
  ): Promise<void> {
    const absolutePath = this.resolveUserAvatarPath(storageKey);
    if (!absolutePath) {
      return;
    }

    await fs.rm(absolutePath, { force: true }).catch(() => undefined);
  }

  private avatarExtension(mimeType: string): string {
    switch (mimeType) {
      case 'image/jpeg':
        return '.jpg';
      case 'image/webp':
        return '.webp';
      case 'image/png':
      default:
        return '.png';
    }
  }

  private avatarMimeType(absolutePath: string): string {
    switch (path.extname(absolutePath).toLowerCase()) {
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.webp':
        return 'image/webp';
      case '.png':
      default:
        return 'image/png';
    }
  }
}
