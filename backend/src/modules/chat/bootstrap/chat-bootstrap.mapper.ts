import { Injectable } from '@nestjs/common';
import type { ChatBootstrapResponse } from './chat-bootstrap.types';

@Injectable()
export class ChatBootstrapMapper {
  map(input: ChatBootstrapResponse): ChatBootstrapResponse {
    return JSON.parse(JSON.stringify(
      input,
      (_key, value) => {
        if (typeof value === 'bigint') return value.toString();
        if (value instanceof Date) return value.toISOString();
        return value;
      },
    )) as ChatBootstrapResponse;
  }
}
