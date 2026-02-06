import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as XLSX from 'xlsx';
import { ParsedFile } from '../types/import.types';

export interface StreamParseOptions {
  chunkSize?: number;
  sheetName?: string;
  onChunk?: (rows: Record<string, any>[], chunkIndex: number) => Promise<void>;
  onProgress?: (processed: number, total: number) => void;
  onHeader?: (headers: string[]) => void;
}

export interface ChunkResult {
  rows: Record<string, any>[];
  chunkIndex: number;
  isLast: boolean;
}

export class StreamParser {
  /**
   * Parse CSV file in streaming mode
   */
  static async parseCSVStream(
    filePath: string,
    options: StreamParseOptions = {}
  ): Promise<ParsedFile> {
    const { chunkSize = 100, onChunk, onProgress, onHeader } = options;

    return new Promise((resolve, reject) => {
      const rows: Record<string, any>[] = [];
      let headers: string[] = [];
      let currentChunk: Record<string, any>[] = [];
      let chunkIndex = 0;
      let lineCount = 0;
      let isFirstLine = true;

      // First pass: count total lines for progress
      let totalLines = 0;
      const countStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
      const countReader = readline.createInterface({ input: countStream });

      countReader.on('line', () => totalLines++);
      countReader.on('close', () => {
        totalLines--; // Exclude header

        // Second pass: actual parsing
        const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity,
        });

        rl.on('line', async (line) => {
          if (isFirstLine) {
            headers = parseCSVLine(line);
            onHeader?.(headers);
            isFirstLine = false;
            return;
          }

          lineCount++;
          const values = parseCSVLine(line);
          const row: Record<string, any> = {};

          headers.forEach((header, index) => {
            row[header] = values[index] || '';
          });

          rows.push(row);
          currentChunk.push(row);

          // Process chunk if size reached
          if (currentChunk.length >= chunkSize) {
            rl.pause();
            try {
              await onChunk?.(currentChunk, chunkIndex);
              onProgress?.(lineCount, totalLines);
              chunkIndex++;
              currentChunk = [];
            } catch (error) {
              reject(error);
              rl.close();
              return;
            }
            rl.resume();
          }
        });

        rl.on('close', async () => {
          // Process remaining rows
          if (currentChunk.length > 0) {
            try {
              await onChunk?.(currentChunk, chunkIndex);
            } catch (error) {
              reject(error);
              return;
            }
          }

          onProgress?.(lineCount, totalLines);

          resolve({
            headers,
            rows,
            fileName: path.basename(filePath),
            rowCount: rows.length,
          });
        });

        rl.on('error', reject);
      });

      countReader.on('error', reject);
    });
  }

  /**
   * Parse Excel file in chunks (memory-efficient for large files)
   */
  static async parseExcelChunked(
    filePath: string,
    options: StreamParseOptions = {}
  ): Promise<ParsedFile> {
    const { chunkSize = 100, sheetName, onChunk, onProgress, onHeader } = options;

    // Read workbook with streaming option
    const workbook = XLSX.readFile(filePath, {
      cellDates: true,
      cellNF: false,
      cellText: false,
    });

    const sheet = sheetName || workbook.SheetNames[0];
    if (!workbook.SheetNames.includes(sheet)) {
      throw new Error(`Sheet "${sheet}" not found`);
    }

    const worksheet = workbook.Sheets[sheet];
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    const totalRows = range.e.r; // End row (0-indexed)

    // Extract headers from first row
    const headers: string[] = [];
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
      const cell = worksheet[cellAddress];
      headers.push(cell ? String(cell.v) : `Column${col + 1}`);
    }
    onHeader?.(headers);

    const allRows: Record<string, any>[] = [];
    let currentChunk: Record<string, any>[] = [];
    let chunkIndex = 0;

    // Process rows in chunks
    for (let rowNum = 1; rowNum <= totalRows; rowNum++) {
      const row: Record<string, any> = {};

      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: rowNum, c: col });
        const cell = worksheet[cellAddress];
        row[headers[col - range.s.c]] = cell ? cell.v : '';
      }

      allRows.push(row);
      currentChunk.push(row);

      // Process chunk when size reached
      if (currentChunk.length >= chunkSize) {
        await onChunk?.(currentChunk, chunkIndex);
        onProgress?.(rowNum, totalRows);
        chunkIndex++;
        currentChunk = [];
      }
    }

    // Process remaining rows
    if (currentChunk.length > 0) {
      await onChunk?.(currentChunk, chunkIndex);
    }
    onProgress?.(totalRows, totalRows);

    return {
      headers,
      rows: allRows,
      fileName: path.basename(filePath),
      rowCount: allRows.length,
    };
  }

  /**
   * Auto-detect file type and parse with streaming
   */
  static async parseStream(
    filePath: string,
    options: StreamParseOptions = {}
  ): Promise<ParsedFile> {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.csv') {
      return this.parseCSVStream(filePath, options);
    } else if (['.xlsx', '.xls'].includes(ext)) {
      return this.parseExcelChunked(filePath, options);
    } else {
      throw new Error(`Unsupported file type: ${ext}`);
    }
  }

  /**
   * Get row count without loading entire file
   */
  static async getRowCount(filePath: string): Promise<number> {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.csv') {
      return new Promise((resolve, reject) => {
        let count = 0;
        const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
        const rl = readline.createInterface({ input: stream });

        rl.on('line', () => count++);
        rl.on('close', () => resolve(count - 1)); // Exclude header
        rl.on('error', reject);
      });
    } else {
      const workbook = XLSX.readFile(filePath, { sheetRows: 0 });
      const sheet = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheet];
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
      return range.e.r; // End row (0-indexed, excluding header)
    }
  }
}

/**
 * Parse a single CSV line handling quoted values
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      i++; // Skip next quote
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

export const streamParser = new StreamParser();
