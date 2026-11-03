export interface TableLink {
  id: string;
  spreadsheetId: string;
  spreadsheetTitle: string;
  tabId: number;
  tabTitle: string;
}

export interface SpreadsheetInfo {
  id: string;
  title: string;
  tabs: Array<{ id: number; title: string }>;
}

export interface TableData {
  headers: string[];
  rows: string[][];
}

export interface GoogleApiError {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
}
