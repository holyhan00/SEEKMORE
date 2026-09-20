import net from 'node:net';

export type CacheRespValue =
  | string
  | number
  | null
  | CacheRespValue[];

export async function sendCacheCommand(
  options: {
    host: '127.0.0.1';
    port: number;
    password: string;
  },
  command: string[],
  timeoutMs = 2_000,
): Promise<CacheRespValue> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: options.host,
      port: options.port,
    });
    let buffer = Buffer.alloc(0);
    let authenticated = false;
    let settled = false;

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(
        error instanceof Error
          ? error
          : new Error(String(error)),
      );
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.write(
        encodeCacheCommand([
          'AUTH',
          options.password,
        ]),
      );
    });
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([
        buffer,
        chunk,
      ]);

      try {
        while (buffer.length > 0) {
          const parsed = parseResp(
            buffer,
            0,
          );

          if (!parsed) return;

          buffer = buffer.subarray(
            parsed.offset,
          );

          if (!authenticated) {
            if (parsed.value !== 'OK') {
              fail(
                new Error(
                  `[ManagedCache] AUTH failed: ${JSON.stringify(parsed.value)}`,
                ),
              );
              return;
            }

            authenticated = true;
            socket.write(
              encodeCacheCommand(command),
            );
            continue;
          }

          settled = true;
          socket.end();
          resolve(parsed.value);
          return;
        }
      } catch (error) {
        fail(error);
      }
    });
    socket.once('timeout', () => {
      fail(
        new Error(
          '[ManagedCache] RESP command timed out.',
        ),
      );
    });
    socket.once('error', fail);
  });
}

export function encodeCacheCommand(
  parts: string[],
): Buffer {
  return Buffer.from(
    `*${parts.length}\r\n${parts.map((value) => {
      const text = String(value);
      return `$${Buffer.byteLength(text)}\r\n${text}\r\n`;
    }).join('')}`,
    'utf8',
  );
}

function parseResp(
  buffer: Buffer,
  offset: number,
): {
  value: CacheRespValue;
  offset: number;
} | null {
  if (offset >= buffer.length) return null;

  const marker = String.fromCharCode(
    buffer[offset],
  );
  const lineEnd = buffer.indexOf(
    '\r\n',
    offset + 1,
    'utf8',
  );

  if (lineEnd < 0) return null;

  const line = buffer.toString(
    'utf8',
    offset + 1,
    lineEnd,
  );
  let next = lineEnd + 2;

  if (marker === '+') {
    return {
      value: line,
      offset: next,
    };
  }

  if (marker === '-') {
    throw new Error(
      `[ManagedCache] RESP error: ${line}`,
    );
  }

  if (marker === ':') {
    return {
      value: Number(line),
      offset: next,
    };
  }

  if (marker === '$') {
    const length = Number(line);

    if (length === -1) {
      return {
        value: null,
        offset: next,
      };
    }

    if (
      buffer.length
      < next + length + 2
    ) {
      return null;
    }

    return {
      value: buffer.toString(
        'utf8',
        next,
        next + length,
      ),
      offset: next + length + 2,
    };
  }

  if (marker === '*') {
    const count = Number(line);

    if (count === -1) {
      return {
        value: null,
        offset: next,
      };
    }

    const values: CacheRespValue[] = [];

    for (
      let index = 0;
      index < count;
      index += 1
    ) {
      const parsed = parseResp(
        buffer,
        next,
      );

      if (!parsed) return null;

      values.push(parsed.value);
      next = parsed.offset;
    }

    return {
      value: values,
      offset: next,
    };
  }

  throw new Error(
    `[ManagedCache] Unsupported RESP marker: ${marker}`,
  );
}
