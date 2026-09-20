import { BadRequestException, Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import type {
  ObjectMediaMetadata,
  ObjectProcessingInput,
  ObjectProcessingResult,
  ObjectProcessor,
} from './object-processor.types';

const execFileAsync = promisify(execFile);

@Injectable()
export class AudioObjectProcessor implements ObjectProcessor {
  readonly name = 'audio';

  supports(kind: ObjectProcessingInput['objectKind']): boolean {
    return kind === 'audio';
  }

  async process(input: ObjectProcessingInput): Promise<ObjectProcessingResult> {
    const media = await readAudioMetadata(input.buffer, input.mimeType, input.extension);
    return {
      processor: 'audio',
      processorVersion: '1.1.0',
      capabilities: ['inspect', 'play', 'download', 'voice_clone_source'],
      contentSummary: null,
      parsedContent: null,
      media,
      metadata: { inspectedAt: new Date().toISOString() },
    };
  }
}

async function readAudioMetadata(buffer: Buffer, mimeType: string, extension: string): Promise<ObjectMediaMetadata> {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    throw new BadRequestException('AUDIO_DECODE_FAILED');
  }
  const format = audioFormat(buffer, mimeType, extension);
  if (!format) throw new BadRequestException('AUDIO_INPUT_UNSUPPORTED_FORMAT');
  const ffprobe = await probeWithFfprobe(buffer, extension || format);
  if (ffprobe) {
    return { format, ...ffprobe, ...(ffprobe.codec ? {} : { codec: fallbackCodec(format) }) };
  }
  if (format === 'wav') return { format, codec: 'pcm', ...readWav(buffer) };
  return { format, codec: fallbackCodec(format) };
}

function audioFormat(buffer: Buffer, mimeType: string, extension: string): string | null {
  const mime = String(mimeType ?? '').toLowerCase();
  const ext = String(extension ?? '').toLowerCase().replace(/^\./, '');
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE') return 'wav';
  if (buffer.toString('ascii', 0, 3) === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) return 'mp3';
  if (buffer.toString('ascii', 0, 4) === 'fLaC') return 'flac';
  if (buffer.toString('ascii', 0, 4) === 'OggS') {
    return buffer.includes(Buffer.from('OpusHead')) ? 'opus' : 'ogg';
  }
  if (buffer.length > 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return 'm4a';
  if (buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0) return 'aac';
  const declared = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'].includes(ext) ? ext : null;
  if (declared && mime.startsWith('audio/')) return declared;
  return null;
}

async function probeWithFfprobe(buffer: Buffer, extension: string): Promise<ObjectMediaMetadata | null> {
  const directory = await mkdtemp(join(tmpdir(), 'seekmore-audio-'));
  const filePath = join(directory, `probe.${safeExtension(extension)}`);
  try {
    await writeFile(filePath, buffer);
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      filePath,
    ], { maxBuffer: 1024 * 1024 });
    const payload = JSON.parse(String(stdout || '{}'));
    const streams = Array.isArray(payload.streams) ? payload.streams : [];
    const audioStream = streams.find((item) => item && item.codec_type === 'audio') || {};
    const format = payload.format && typeof payload.format === 'object' ? payload.format : {};
    const durationSeconds = numberValue(audioStream.duration ?? format.duration);
    const sampleRate = integerValue(audioStream.sample_rate);
    const channels = integerValue(audioStream.channels);
    const bitrate = integerValue(audioStream.bit_rate ?? format.bit_rate);
    const codec = textValue(audioStream.codec_name);
    return {
      ...(durationSeconds && durationSeconds > 0 ? { durationMs: Math.round(durationSeconds * 1000) } : {}),
      ...(sampleRate ? { sampleRate } : {}),
      ...(channels ? { channels } : {}),
      ...(bitrate ? { bitrate } : {}),
      ...(codec ? { codec } : {}),
    };
  } catch {
    return null;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

function safeExtension(value: string): string {
  const normalized = String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized || 'audio';
}

function fallbackCodec(format: string): string {
  return format === 'wav' ? 'pcm' : format;
}

function readWav(buffer: Buffer): Pick<ObjectMediaMetadata, 'durationMs' | 'sampleRate' | 'channels' | 'bitrate'> {
  if (buffer.length < 44) throw new BadRequestException('AUDIO_DECODE_FAILED');
  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const byteRate = buffer.readUInt32LE(28);
  let dataSize = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const chunk = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (chunk === 'data') { dataSize = Math.min(size, buffer.length - offset - 8); break; }
    offset += 8 + size + (size % 2);
  }
  return {
    ...(sampleRate > 0 ? { sampleRate } : {}),
    ...(channels > 0 ? { channels } : {}),
    ...(byteRate > 0 ? { bitrate: byteRate * 8 } : {}),
    ...(byteRate > 0 && dataSize > 0 ? { durationMs: Math.round((dataSize / byteRate) * 1000) } : {}),
  };
}

function integerValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function numberValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function textValue(value: unknown): string | undefined {
  const output = String(value ?? '').trim();
  return output || undefined;
}
