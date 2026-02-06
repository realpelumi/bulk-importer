# Bulk Importer API

A robust CSV/Excel file upload, validation, preview, and save system built with Express.js and TypeScript.

## Features

- ✅ **Upload CSV/Excel files** - Parse and preview data
- ✅ **Row-level validation** - Configurable validation rules with detailed error reports
- ✅ **Dry-run mode** - Preview what would be saved without actually saving
- ✅ **Background processing** - Handle large files asynchronously with progress tracking
- ✅ **Export failed rows** - Download validation failures as CSV/Excel for correction
- ✅ **Streaming/Chunk parsing** - Memory-efficient processing for large files
- ✅ **Real-time progress tracking** - Server-Sent Events (SSE) for live updates
- ✅ **Job management** - Track, list, and cancel background jobs
- ✅ **Partial success mode** - Continue saving even if some rows fail
- ✅ **Transactional mode** - Rollback all if any row fails
- ✅ **Retry failed rows** - Re-attempt saving rows that failed previously

## Project Structure

```
src/
├── app.ts                      # Main application entry point
├── config/
│   └── index.ts                # Configuration management
├── middleware/
│   └── errorHandler.ts         # Error handling middleware
├── modules/
│   └── import/
│       ├── index.ts            # Module exports
│       ├── import.controller.ts # Request handlers
│       ├── import.routes.ts    # API routes
│       └── import.service.ts   # Business logic
├── types/
│   ├── api.types.ts            # API response types
│   └── import.types.ts         # Import-related types
└── utils/
    ├── fileParser.ts           # CSV/Excel parsing utilities
    ├── streamParser.ts         # Streaming/chunk parser for large files
    ├── progressTracker.ts      # Real-time progress tracking with EventEmitter
    └── validators.ts           # Validation utilities
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
npm install
```

### Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Available configuration options:

| Variable             | Default   | Description                              |
| -------------------- | --------- | ---------------------------------------- |
| PORT                 | 3000      | Server port                              |
| UPLOAD_DIR           | uploads   | Directory for uploaded files             |
| MAX_FILE_SIZE        | 10485760  | Maximum file size (10MB)                 |
| REDIS_HOST           | localhost | Redis host (for background jobs)         |
| REDIS_PORT           | 6379      | Redis port                               |
| MAX_ROWS_PREVIEW     | 100       | Maximum rows in preview                  |
| LARGE_FILE_THRESHOLD | 1000      | Rows threshold for background processing |

### Running the Server

```bash
# Development mode
npm run dev

# Development with watch
npm run dev:watch

# Production
npm run build
npm start
```

## API Endpoints

### Upload File

```http
POST /api/import/upload
Content-Type: multipart/form-data
```

**Form Data:**

- `file` (required): CSV or Excel file
- `sheetName` (optional): Excel sheet name to process

**Response:**

```json
{
  "success": true,
  "message": "File uploaded successfully",
  "data": {
    "importId": "uuid",
    "fileName": "data.csv",
    "rowCount": 100,
    "headers": ["name", "email", "age"],
    "previewRows": [...]
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Validate Data

```http
POST /api/import/:importId/validate
Content-Type: application/json
```

**Request Body:**

```json
{
  "rules": [
    { "field": "name", "required": true, "type": "string", "minLength": 2 },
    { "field": "email", "required": true, "type": "email" },
    { "field": "age", "type": "number", "min": 0, "max": 120 }
  ],
  "streaming": true,
  "chunkSize": 100
}
```

**Options:**

- `streaming`: Enable streaming validation for large files (default: false)
- `chunkSize`: Number of rows to process per chunk (default: 100)

**Response:**

```json
{
  "success": true,
  "message": "Validation completed with 5 error(s)",
  "data": {
    "importId": "uuid",
    "totalRows": 100,
    "validRows": 95,
    "invalidRows": 5,
    "errors": [
      {
        "rowNumber": 3,
        "errors": [
          { "field": "email", "message": "email must be a valid email address" }
        ]
      }
    ],
    "isValid": false
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Get Validation Errors (Paginated)

```http
GET /api/import/:importId/errors?page=1&limit=50
```

### Save Data

```http
POST /api/import/:importId/save
Content-Type: application/json
```

**Request Body:**

```json
{
  "dryRun": false,
  "saveMode": "partial"
}
```

**Save Modes:**

- `partial` (default): Continue saving valid rows even if some fail
- `transactional`: Rollback all rows if any single row fails to save

**Response:**

```json
{
  "success": true,
  "message": "Save complete: 95 rows saved, 5 failed",
  "data": {
    "importId": "uuid",
    "savedCount": 95,
    "failedCount": 5,
    "message": "Data saved successfully",
    "mode": "partial",
    "rolledBack": false
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Retry Failed Rows

```http
POST /api/import/:importId/retry
Content-Type: application/json
```

**Request Body:**

```json
{
  "saveMode": "partial"
}
```

### Export Failed Rows

```http
GET /api/import/:importId/export-failed?format=csv
```

**Query Parameters:**

- `format`: `csv` or `xlsx` (default: `csv`)

### Get Import Summary

```http
GET /api/import/:importId/summary
```

### Delete Import

```http
DELETE /api/import/:importId
```

---

## Background Jobs API

### Create Background Job

```http
POST /api/import/jobs
Content-Type: multipart/form-data
```

**Form Data:**

- `file` (required): CSV or Excel file
- `rules` (optional): JSON string of validation rules
- `sheetName` (optional): Excel sheet name
- `saveMode` (optional): `partial` or `transactional`
- `dryRun` (optional): `true` to skip saving
- `chunkSize` (optional): rows per chunk (default: 100)

**Response:**

```json
{
  "success": true,
  "message": "Background job created",
  "data": {
    "jobId": "uuid",
    "status": "pending",
    "totalRows": 5000,
    "saveMode": "partial",
    "message": "Your file is being processed..."
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Get All Jobs

```http
GET /api/import/jobs?status=pending,processing
```

**Query Parameters:**

- `status`: Comma-separated filter (pending, queued, parsing, validating, validated, saving, completed, partial_success, failed, cancelled)

### Get Job Status

```http
GET /api/import/jobs/:jobId
```

**Response:**

```json
{
  "success": true,
  "message": "Job status: completed",
  "data": {
    "jobId": "uuid",
    "status": "completed",
    "phase": "completed",
    "progress": 100,
    "totalRows": 5000,
    "processedRows": 5000,
    "validRows": 4995,
    "invalidRows": 5,
    "savedRows": 4995,
    "failedSaveRows": 5,
    "saveMode": "partial",
    "result": {
      "totalRows": 5000,
      "validRows": 4995,
      "invalidRows": 5
    },
    "createdAt": "2024-01-01T00:00:00.000Z",
    "startedAt": "2024-01-01T00:00:01.000Z",
    "completedAt": "2024-01-01T00:00:05.000Z",
    "updatedAt": "2024-01-01T00:00:05.000Z"
  },
  "timestamp": "2024-01-01T00:00:05.000Z"
}
```

### Stream Job Progress (SSE)

```http
GET /api/import/jobs/:jobId/stream
```

Returns Server-Sent Events stream with real-time progress updates:

```javascript
// Client-side JavaScript
const eventSource = new EventSource("/api/import/jobs/uuid/stream");

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(`Progress: ${data.progress}% - ${data.message}`);

  if (data.type === "complete") {
    eventSource.close();
  }
};
```

**Event Types:**

- `connected`: Initial connection established
- `progress`: Progress update with current stats
- `complete`: Job finished (success, failure, or cancelled)

### Cancel Job

```http
POST /api/import/jobs/:jobId/cancel
```

---

## Job Statuses

| Status            | Description                        |
| ----------------- | ---------------------------------- |
| `pending`         | Job created but not started        |
| `queued`          | Job is queued for processing       |
| `parsing`         | File is being parsed               |
| `validating`      | Rows are being validated           |
| `validated`       | Validation complete, ready to save |
| `saving`          | Data is being saved                |
| `completed`       | All operations successful          |
| `partial_success` | Some rows saved, some failed       |
| `failed`          | Job failed with error              |
| `cancelled`       | Job cancelled by user              |

---

## Save Modes

### Partial Mode (Default)

- Saves all valid rows, even if some fail
- Failed rows are collected for retry or export
- Best for: Large imports where some failures are acceptable

```json
{
  "saveMode": "partial"
}
```

### Transactional Mode

- All rows must save successfully, or all are rolled back
- Provides data consistency guarantee
- Best for: Critical data where partial imports are not acceptable

```json
{
  "saveMode": "transactional"
}
```

---

## Validation Rules

### Available Rule Options

| Property    | Type     | Description                                                     |
| ----------- | -------- | --------------------------------------------------------------- |
| `field`     | string   | Field name to validate                                          |
| `required`  | boolean  | Whether the field is required                                   |
| `type`      | string   | Type validation: `string`, `number`, `email`, `date`, `boolean` |
| `minLength` | number   | Minimum string length                                           |
| `maxLength` | number   | Maximum string length                                           |
| `min`       | number   | Minimum numeric value                                           |
| `max`       | number   | Maximum numeric value                                           |
| `pattern`   | RegExp   | Custom regex pattern                                            |
| `custom`    | function | Custom validation function                                      |

### Examples

```javascript
// Required email
{ "field": "email", "required": true, "type": "email" }

// Optional number with range
{ "field": "age", "type": "number", "min": 18, "max": 100 }

// String with length constraints
{ "field": "username", "required": true, "type": "string", "minLength": 3, "maxLength": 50 }
```

---

## Typical Workflows

### Standard Import

1. **Upload** - `POST /api/import/upload`
2. **Validate** - `POST /api/import/:importId/validate`
3. **Dry Run** - `POST /api/import/:importId/save` with `dryRun: true`
4. **Save** - `POST /api/import/:importId/save` with `dryRun: false`
5. **Export Failed** - `GET /api/import/:importId/export-failed`

### Large File Import (Background)

1. **Create Job** - `POST /api/import/jobs`
2. **Stream Progress** - `GET /api/import/jobs/:jobId/stream`
3. **Check Status** - `GET /api/import/jobs/:jobId`
4. **Export Failed** - `GET /api/import/:jobId/export-failed`

### Retry Failed Rows

1. **Get Errors** - `GET /api/import/:importId/errors`
2. **Fix Source** or **Retry** - `POST /api/import/:importId/retry`

---

## Error Handling

All errors follow a consistent format:

```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error message",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### HTTP Status Codes

| Code | Description                                 |
| ---- | ------------------------------------------- |
| 200  | Success                                     |
| 202  | Accepted (background job created)           |
| 400  | Bad request (e.g., no file, invalid params) |
| 404  | Resource not found                          |
| 413  | File too large                              |
| 500  | Internal server error                       |

## License

ISC
