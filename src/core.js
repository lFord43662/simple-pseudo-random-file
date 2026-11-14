// Core implementation of the pseudo random file writer.
//
// Design note: we deliberately expose a *writer factory* rather than only a
// one-shot function. Callers who generate many files of the same size in a loop
// can build the writer once and reuse it, while callers who just want a file on
// disk get a thin convenience wrapper on top.

import { open } from 'node:fs/promises';

/**
 * Default number of bytes produced per write() call.
 *
 * 64 KiB keeps each syscall comfortably inside the range where sequential
 * writes stay fast without allocating a buffer proportional to the total file
 * size. For a multi-gigabyte file that matters: allocating the whole thing up
 * front is the single easiest way to OOM a test runner.
 */
export const DEFAULT_CHUNK_SIZE = 64 * 1024;

/**
 * Create a pseudo random byte generator.
 *
 * We use Math.random() rather than a seeded PRNG because the brief is about
 * producing *pseudorandom filler* for storage and transfer tests, not about
 * reproducibility. A seeded generator would need its own algorithm and would
 * invite callers to depend on exact byte sequences, which is a maintenance
 * trap we would rather avoid.
 *
 * @param {number} [chunkSize] bytes per generated chunk.
 * @returns {(size: number) => Buffer} function producing `size` random bytes.
 */
export function createGenerator(chunkSize = DEFAULT_CHUNK_SIZE) {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new RangeError(`chunkSize must be a positive integer, got ${chunkSize}`);
  }

  return function generate(size) {
    if (!Number.isInteger(size) || size < 0) {
      throw new RangeError(`size must be a non-negative integer, got ${size}`);
    }
    const out = Buffer.allocUnsafe(size);
    // Fill in bounded chunks so a huge `size` does not require a single giant
    // randomBytes call, and so we reuse the same code path for every size.
    for (let offset = 0; offset < size; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, size);
      fillRandom(out, offset, end);
    }
    return out;
  };
}

/**
 * Fill a byte range of `target` with pseudorandom bytes.
 *
 * Buffer.prototype.fill does not accept a callback, so we write the bytes
 * ourselves. Math.random() returns a float in [0, 1); multiplying by 256 and
 * flooring gives a uniform-ish byte. We mask with 0xff to guard against the
 * (rare, but possible) case where the float rounds to exactly 256.
 *
 * @param {Buffer} target
 * @param {number} start inclusive
 * @param {number} end exclusive
 */
function fillRandom(target, start, end) {
  for (let i = start; i < end; i += 1) {
    target[i] = Math.floor(Math.random() * 256) & 0xff;
  }
}

/**
 * Create a writer bound to a target directory and chunk size.
 *
 * The writer is stateful only in configuration; each writeRandomFile() call is
 * independent and safe to run sequentially. We do not attempt concurrent
 * writes to the same path — the caller owns that concern.
 *
 * @param {{directory?: string, chunkSize?: number}} [options]
 * @returns {{write: (filePath: string, size: number) => Promise<number>}}
 */
export function createWriter(options = {}) {
  const { directory = '.', chunkSize = DEFAULT_CHUNK_SIZE } = options;
  const generate = createGenerator(chunkSize);

  /**
   * Write `size` pseudorandom bytes to `filePath`.
   *
   * Returns the number of bytes written. We open with 'w' so an existing file
   * is truncated; appending random data to a stale file would silently produce
   * a larger artifact than the caller asked for.
   *
   * @param {string} filePath
   * @param {number} size
   * @returns {Promise<number>}
   */
  async function write(filePath, size) {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new TypeError('filePath must be a non-empty string');
    }
    if (!Number.isInteger(size) || size < 0) {
      throw new RangeError(`size must be a non-negative integer, got ${size}`);
    }

    const resolved = resolvePath(directory, filePath);
    const handle = await open(resolved, 'w');
    try {
      let remaining = size;
      while (remaining > 0) {
        const take = Math.min(remaining, chunkSize);
        const buf = generate(take);
        // write() may perform a partial write; loop until the buffer is
        // drained. This is the classic short-write edge case and it is cheap
        // to handle correctly.
        let written = 0;
        while (written < buf.length) {
          written += (await handle.write(buf, written, buf.length - written)).bytesWritten;
        }
        remaining -= take;
      }
    } finally {
      await handle.close();
    }
    return size;
  }

  return { write };
}

/**
 * Convenience wrapper: create a writer for `directory` and write one file.
 *
 * @param {string} filePath
 * @param {number} size
 * @param {{directory?: string, chunkSize?: number}} [options]
 * @returns {Promise<number>} bytes written
 */
export function writeRandomFile(filePath, size, options = {}) {
  return createWriter(options).write(filePath, size);
}

/**
 * Join a base directory with a caller-supplied path.
 *
 * We deliberately keep this trivial instead of pulling in path.join semantics
 * for absolute paths: if the caller passes an absolute filePath we honour it
 * as-is, because that is the least surprising behaviour for a test helper.
 *
 * @param {string} directory
 * @param {string} filePath
 * @returns {string}
 */
function resolvePath(directory, filePath) {
  if (filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath)) {
    return filePath;
  }
  if (directory === '.' || directory === '') {
    return filePath;
  }
  const sep = directory.endsWith('/') ? '' : '/';
  return `${directory}${sep}${filePath}`;
}
