# simple-pseudo-random-file

Generates and writes files filled with pseudorandom bytes of a requested size, for exercising storage and transfer paths in tests.

## Usage

```js
import { writeRandomFile, createWriter } from 'simple-pseudo-random-file';

// One-shot: writes 1 MiB of pseudorandom bytes and resolves to 1048576.
const bytes = await writeRandomFile('blob.bin', 1024 * 1024);
console.log(bytes);

// Reusable writer, useful when generating many files in one directory.
// The directory must already exist; the writer does not create it.
const writer = createWriter({ directory: '.', chunkSize: 4096 });
await writer.write('small.bin', 128);
await writer.write('large.bin', 8 * 1024 * 1024);
```

Exported names: `writeRandomFile(filePath, size, options?)`, `createWriter(options?)`, and `DEFAULT_CHUNK_SIZE`.

## Why this exists

Storage and transfer tests need payloads of a known size whose contents cannot be compressed or deduplicated by accident. Filling a buffer with a repeated byte makes gzip and deduplicating filesystems look far better than they are; a real filesystem benchmark wants bytes that look random. The trade-off is that the output is **not reproducible**: the generator uses `Math.random()` and there is no seed. If you need byte-for-byte identical fixtures across runs, hash the produced file once and commit that hash instead — we do not offer a seeded mode because it would invite tests to depend on exact byte sequences, which is a maintenance trap.

## Edge cases you will hit

- The writer opens with `'w'`, so an existing file at the target path is truncated. Writing 10 bytes over a 4 KiB file leaves a 10-byte file.
- `size` must be a non-negative integer; `size: 0` is valid and produces an empty file.
- If `filePath` is absolute (leading `/`, or a Windows drive prefix), the configured `directory` is ignored and the absolute path is used verbatim. Relative paths are joined to `directory`.
- `chunkSize` must be a positive integer; it controls the largest buffer allocated at once, so lowering it bounds peak memory for very large files.
