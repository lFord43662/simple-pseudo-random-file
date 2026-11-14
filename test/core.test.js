import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWriter, writeRandomFile, DEFAULT_CHUNK_SIZE } from '../src/index.js';

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'sprf-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('writeRandomFile writes exactly the requested number of bytes', async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, 'out.bin');
    const written = await writeRandomFile(target, 1234);
    assert.equal(written, 1234);
    const bytes = await readFile(target);
    assert.equal(bytes.length, 1234);
  });
});

test('writeRandomFile handles a zero-byte file', async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, 'empty.bin');
    const written = await writeRandomFile(target, 0);
    assert.equal(written, 0);
    const info = await stat(target);
    assert.equal(info.size, 0);
  });
});

test('writeRandomFile truncates an existing file', async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, 'shrink.bin');
    await writeRandomFile(target, 4096);
    await writeRandomFile(target, 10);
    const info = await stat(target);
    assert.equal(info.size, 10);
  });
});

test('writeRandomFile produces different content on successive calls', async () => {
  await withTempDir(async (dir) => {
    const a = join(dir, 'a.bin');
    const b = join(dir, 'b.bin');
    await writeRandomFile(a, 256);
    await writeRandomFile(b, 256);
    const left = await readFile(a);
    const right = await readFile(b);
    assert.notDeepEqual(left, right);
  });
});

test('createWriter honours a custom chunk size smaller than the file', async () => {
  await withTempDir(async (dir) => {
    const writer = createWriter({ directory: dir, chunkSize: 7 });
    const written = await writer.write('chunked.bin', 100);
    assert.equal(written, 100);
    const bytes = await readFile(join(dir, 'chunked.bin'));
    assert.equal(bytes.length, 100);
  });
});

test('createWriter joins the configured directory with a relative path', async () => {
  await withTempDir(async (dir) => {
    const writer = createWriter({ directory: dir });
    await writer.write('nested.bin', 32);
    const bytes = await readFile(join(dir, 'nested.bin'));
    assert.equal(bytes.length, 32);
  });
});

test('createWriter accepts an absolute path and ignores the directory', async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, 'absolute.bin');
    const writer = createWriter({ directory: '/definitely/not/here' });
    await writer.write(target, 16);
    const info = await stat(target);
    assert.equal(info.size, 16);
  });
});

test('createGenerator rejects a non-positive chunk size', () => {
  assert.throws(() => createWriter({ chunkSize: 0 }), RangeError);
  assert.throws(() => createWriter({ chunkSize: -1 }), RangeError);
  assert.throws(() => createWriter({ chunkSize: 1.5 }), RangeError);
});

test('write rejects a negative size', async () => {
  await withTempDir(async (dir) => {
    const writer = createWriter({ directory: dir });
    await assert.rejects(() => writer.write('bad.bin', -1), RangeError);
  });
});

test('write rejects a non-integer size', async () => {
  await withTempDir(async (dir) => {
    const writer = createWriter({ directory: dir });
    await assert.rejects(() => writer.write('bad.bin', 1.25), RangeError);
  });
});

test('write rejects an empty file path', async () => {
  await withTempDir(async (dir) => {
    const writer = createWriter({ directory: dir });
    await assert.rejects(() => writer.write('', 8), TypeError);
  });
});

test('DEFAULT_CHUNK_SIZE is a positive integer', () => {
  assert.equal(Number.isInteger(DEFAULT_CHUNK_SIZE), true);
  assert.ok(DEFAULT_CHUNK_SIZE > 0);
});
