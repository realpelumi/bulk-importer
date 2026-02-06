import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { ParsedFile } from '../types/import.types';

export class FileParser {
  /**
   * Parse CSV or Excel file and return structured data
   */
  static parse(filePath: string, sheetName?: string): ParsedFile {
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const workbook = XLSX.readFile(filePath);
    
    // Get sheet name - use provided or default to first sheet
    const sheet = sheetName || workbook.SheetNames[0];
    
    if (!workbook.SheetNames.includes(sheet)) {
      throw new Error(`Sheet "${sheet}" not found. Available sheets: ${workbook.SheetNames.join(', ')}`);
    }

    const worksheet = workbook.Sheets[sheet];
    
    // Convert to JSON with header option
    const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, {
      defval: '', // Default value for empty cells
      raw: false, // Return formatted strings
    });

    if (jsonData.length === 0) {
      return {
        headers: [],
        rows: [],
        fileName,
        rowCount: 0,
      };
    }

    // Extract headers from first row keys
    const headers = Object.keys(jsonData[0] || {});

    return {
      headers,
      rows: jsonData,
      fileName,
      rowCount: jsonData.length,
    };
  }

  /**
   * Get available sheet names from Excel file
   */
  static getSheetNames(filePath: string): string[] {
    const workbook = XLSX.readFile(filePath);
    return workbook.SheetNames;
  }

  /**
   * Parse file with preview limit
   */
  static parsePreview(filePath: string, limit: number = 100, sheetName?: string): ParsedFile {
    const full = this.parse(filePath, sheetName);
    return {
      ...full,
      rows: full.rows.slice(0, limit),
    };
  }

  /**
   * Check if file is a valid CSV/Excel file
   */
  static isValidFileType(fileName: string): boolean {
    const validExtensions = ['.csv', '.xlsx', '.xls'];
    const ext = path.extname(fileName).toLowerCase();
    return validExtensions.includes(ext);
  }

  /**
   * Export data to CSV format
   */
  static exportToCsv(data: Record<string, any>[], filePath: string): void {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const csvContent = XLSX.utils.sheet_to_csv(worksheet);
    fs.writeFileSync(filePath, csvContent, 'utf-8');
  }

  /**
   * Export data to Excel format
   */
  static exportToExcel(data: Record<string, any>[], filePath: string, sheetName: string = 'Sheet1'): void {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    XLSX.writeFile(workbook, filePath);
  }
}
