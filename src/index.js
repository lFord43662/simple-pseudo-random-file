// Public entry point for simple-pseudo-random-file.
//
// Keeping the re-exports in one place means consumers only ever import from the
// package root, and the internal module layout (core.js) stays free to change.
export { createWriter, writeRandomFile, DEFAULT_CHUNK_SIZE } from './core.js';
